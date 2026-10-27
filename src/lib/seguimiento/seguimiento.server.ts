/**
 * Lecturas de servidor de Seguimiento (Ola 8): datos de la clínica, link de
 * reserva por paciente y las lecturas agregadas. Corren con el cliente del
 * usuario (su RLS).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { appOrigin } from "@/lib/app-origin.server";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import {
  citasPorIds,
  inscripcionesVigentesDe,
} from "@/lib/clinic-operations/inscripciones-grupales";
import { mensajeDb } from "@/lib/db-errors";
import { leerTodasLasPaginas } from "@/lib/paginacion";
import { tokenRecallReserva } from "@/lib/reserva/enlace-cita.server";
import type { PlanActivo } from "@/lib/seguimiento/detenidos";

type Cliente = SupabaseClient<Database>;

export const ZONA_POR_DEFECTO = "America/Santiago";

export interface ClinicaDeSeguimiento {
  nombre: string;
  zona: string;
  hoy: string;
  pais: string | null;
  telefono: string | null;
  moneda: string;
}

export async function clinicaDeSeguimiento(
  supabase: Cliente,
  clinicId: string,
): Promise<ClinicaDeSeguimiento> {
  const [{ data, error }, { data: sucursal }] = await Promise.all([
    supabase
      .from("clinics")
      .select("name, timezone, country, currency")
      .eq("id", clinicId)
      .maybeSingle(),
    supabase
      .from("branches")
      .select("phone")
      .eq("clinic_id", clinicId)
      .not("phone", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (error || !data) {
    throw new Error(mensajeDb(error, "No pudimos cargar los datos de la clínica."));
  }
  const zona = data.timezone || ZONA_POR_DEFECTO;
  return {
    nombre: data.name,
    zona,
    hoy: hoyISO(zona),
    pais: data.country ?? null,
    telefono: (sucursal?.phone as string | null | undefined) ?? null,
    moneda: data.currency,
  };
}

/**
 * Arma el link de reserva de cada paciente (MKT-06): una sola lectura de la
 * configuración. Devuelve null si la reserva en línea está apagada.
 */
export async function generadorDeLinkDeReserva(
  supabase: Cliente,
  clinicId: string,
): Promise<((patientId: string) => string) | null> {
  const { data, error } = await supabase
    .from("online_booking_settings")
    .select("slug, enabled")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error || !data?.enabled || !data.slug) return null;
  const base = `${appOrigin()}/reservar/${data.slug}`;
  return (patientId: string) => `${base}?r=${tokenRecallReserva({ patientId, clinicId })}`;
}

export interface DatosDePaciente {
  patientId: string;
  nombre: string;
  telefono: string | null;
  creadoEl: string;
  ultimaVisita: string | null;
  visitas: number;
  tieneCitaFutura: boolean;
  inasistencias12m: number;
  cancelaciones12m: number;
  presupuestosRechazados12m: number;
}

export async function leerDatosDePacientes(
  supabase: Cliente,
  clinicId: string,
): Promise<DatosDePaciente[]> {
  const { filas, error } = await leerTodasLasPaginas((desde, hasta) =>
    supabase
      .rpc("seguimiento_datos_de_pacientes", { p_clinic_id: clinicId })
      .order("patient_id", { ascending: true })
      .range(desde, hasta),
  );
  if (error) throw new Error(mensajeDb(error, "No pudimos cargar los datos de los pacientes."));
  return filas.map((r) => ({
    patientId: r.patient_id,
    nombre: r.full_name,
    telefono: r.phone,
    creadoEl: r.created_at,
    ultimaVisita: r.last_visit_at,
    visitas: Number(r.visits ?? 0),
    tieneCitaFutura: Boolean(r.has_future),
    inasistencias12m: Number(r.no_shows_12m ?? 0),
    cancelaciones12m: Number(r.cancelled_12m ?? 0),
    presupuestosRechazados12m: Number(r.rejected_quotes_12m ?? 0),
  }));
}

export async function leerPlanesActivos(
  supabase: Cliente,
  clinicId: string,
): Promise<PlanActivo[]> {
  const { filas, error } = await leerTodasLasPaginas((desde, hasta) =>
    supabase
      .rpc("seguimiento_planes_activos", { p_clinic_id: clinicId })
      .order("plan_id", { ascending: true })
      .range(desde, hasta),
  );
  if (error) throw new Error(mensajeDb(error, "No pudimos cargar los planes de tratamiento."));
  return filas.map((r) => ({
    planId: r.plan_id,
    patientId: r.patient_id,
    patientName: r.patient_name,
    planName: r.plan_name,
    creadoEl: r.plan_created_at,
    iniciadoEl: r.plan_started_at,
    quoteId: r.quote_id,
    itemsPendientes: Number(r.pending_items ?? 0),
    itemsCompletados: Number(r.completed_items ?? 0),
    ultimoItemCompletadoEl: r.last_item_completed_at,
    ultimaVisitaEl: r.last_visit_at,
    tieneCitaFutura: Boolean(r.has_future),
  }));
}

/** Pacientes (de la lista dada) con una cita futura no cancelada. */
export async function pacientesConCitaFutura(
  supabase: Cliente,
  clinicId: string,
  patientIds: readonly string[],
): Promise<Set<string>> {
  const con = new Set<string>();
  const ids = [...new Set(patientIds)];
  const ahora = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 200) {
    const tanda = ids.slice(i, i + 200);
    const { data, error } = await supabase
      .from("appointments")
      .select("patient_id")
      .eq("clinic_id", clinicId)
      .in("patient_id", tanda)
      .gt("starts_at", ahora)
      .in("status", ["tentativa", "confirmada", "en-sala"]);
    if (error) throw new Error(mensajeDb(error, "No pudimos revisar las citas agendadas."));
    for (const r of data ?? []) con.add(r.patient_id);
  }
  // Citas grupales (AGE-22): `appointments.patient_id` es solo el titular; cada
  // inscrito vigente también tiene una próxima cita.
  const inscripciones = await inscripcionesVigentesDe(supabase, clinicId, ids);
  if (inscripciones.length > 0) {
    const futuras = new Set(
      (
        await citasPorIds(
          inscripciones.map((i) => i.appointment_id),
          (tanda) =>
            supabase
              .from("appointments")
              .select("id")
              .eq("clinic_id", clinicId)
              .in("id", tanda)
              .gt("starts_at", ahora)
              .in("status", ["tentativa", "confirmada", "en-sala"]),
          "No pudimos revisar las citas agendadas.",
        )
      ).map((c) => c.id),
    );
    for (const i of inscripciones) if (futuras.has(i.appointment_id)) con.add(i.patient_id);
  }
  return con;
}

/** Nombre y teléfono de pacientes por id, de a tandas (2 queries + Map, sin embebidos). */
export async function nombresDePacientes(
  supabase: Cliente,
  clinicId: string,
  patientIds: readonly string[],
): Promise<Map<string, { nombre: string; telefono: string | null; archivado: boolean }>> {
  const mapa = new Map<string, { nombre: string; telefono: string | null; archivado: boolean }>();
  const ids = [...new Set(patientIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const tanda = ids.slice(i, i + 200);
    const { data, error } = await supabase
      .from("patients")
      .select("id, full_name, phone, archived_at")
      .eq("clinic_id", clinicId)
      .in("id", tanda);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los pacientes."));
    for (const p of data ?? []) {
      mapa.set(p.id, { nombre: p.full_name, telefono: p.phone, archivado: Boolean(p.archived_at) });
    }
  }
  return mapa;
}
