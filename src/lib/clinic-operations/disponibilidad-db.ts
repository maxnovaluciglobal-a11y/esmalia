import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { HORA_INICIO } from "@/lib/clinic-operations/clinic-data";
import { mensajeDb } from "@/lib/db-errors";
import {
  AJUSTES_POR_DEFECTO,
  aperturasDelDia,
  bloqueosQueChocan,
  cabeEn,
  describirBloqueo,
  esIntervaloGrilla,
  MOTIVOS_BLOQUEO,
  partirLocal,
  sumarMinutosLocal,
  type AjustesAgenda,
  type ExcepcionAgenda,
  type MotivoBloqueo,
} from "@/lib/clinic-operations/disponibilidad";

/**
 * Lecturas de disponibilidad compartidas por las server functions de la
 * agenda (`disponibilidad.functions.ts`) y la validación de una cita
 * (`validarHorarioYSolapamiento` en appointments.functions.ts). Reciben el
 * cliente con la RLS del usuario: no saltan nada.
 */

type Db = SupabaseClient<Database>;

export const COLUMNAS_EXCEPCION =
  "id, kind, reason, note, professional_id, branch_id, operatory_id, starts_local, ends_local, repeat_weekly, repeat_until";

type FilaExcepcion = {
  id: string;
  kind: string;
  reason: string | null;
  note: string | null;
  professional_id: string | null;
  branch_id: string | null;
  operatory_id: string | null;
  starts_local: string;
  ends_local: string;
  repeat_weekly: boolean;
  repeat_until: string | null;
};

function esMotivo(m: string | null): m is MotivoBloqueo {
  return Boolean(m && (MOTIVOS_BLOQUEO as readonly string[]).includes(m));
}

export function mapExcepcion(r: FilaExcepcion, boxNombre?: string | null): ExcepcionAgenda {
  return {
    id: r.id,
    tipo: r.kind === "apertura" ? "apertura" : "bloqueo",
    motivo: esMotivo(r.reason) ? r.reason : null,
    nota: r.note,
    profesionalId: r.professional_id,
    sucursalId: r.branch_id,
    boxId: r.operatory_id,
    boxNombre: boxNombre ?? null,
    // `timestamp` llega como "2026-10-23T13:00:00": la hora de pared sin segundos.
    inicio: r.starts_local.slice(0, 16),
    fin: r.ends_local.slice(0, 16),
    repetirSemanal: r.repeat_weekly,
    repetirHasta: r.repeat_until,
  };
}

/** Nombres de los boxes de las excepciones (2 consultas + Map, sin embedded select). */
export async function conNombresDeBox(
  supabase: Db,
  filas: FilaExcepcion[],
): Promise<ExcepcionAgenda[]> {
  const ids = [...new Set(filas.map((f) => f.operatory_id).filter((v): v is string => Boolean(v)))];
  let nombres = new Map<string, string>();
  if (ids.length > 0) {
    const { data, error } = await supabase.from("operatories").select("id, name").in("id", ids);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los boxes."));
    nombres = new Map((data ?? []).map((o) => [o.id, o.name]));
  }
  return filas.map((f) => mapExcepcion(f, f.operatory_id ? nombres.get(f.operatory_id) : null));
}

export async function leerAjustesAgenda(supabase: Db, clinicId: string): Promise<AjustesAgenda> {
  const { data, error } = await supabase
    .from("clinic_agenda_settings")
    .select("slot_minutes, default_duration_min, allow_overbooking")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) throw new Error(mensajeDb(error, "No pudimos leer la configuración de la agenda."));
  if (!data) return AJUSTES_POR_DEFECTO;
  return {
    pasoMin: esIntervaloGrilla(data.slot_minutes) ? data.slot_minutes : AJUSTES_POR_DEFECTO.pasoMin,
    duracionPorDefecto: data.default_duration_min,
    permiteSobrecupos: data.allow_overbooking,
  };
}

export interface DisponibilidadDeCita {
  ajustes: AjustesAgenda;
  /** Bloqueos que pisan la cita, ya descritos ("Almuerzo, 13:00–14:00"). No impiden guardar. */
  bloqueos: string[];
  /** Una apertura excepcional del profesional cubre la cita entera (AGE-08). */
  aperturaCubre: boolean;
}

/**
 * Lo que la agenda sabe del horario pedido además del horario semanal:
 * ajustes de la clínica, bloqueos que lo pisan y si una apertura excepcional
 * lo habilita. `startsAtRaw` es la hora de pared de la sucursal, igual que
 * `agenda_exceptions.starts_local`: se comparan sin convertir husos.
 */
export async function revisarDisponibilidad(
  supabase: Db,
  p: {
    clinicId: string;
    branchId: string;
    professionalId: string;
    startsAtRaw: string;
    duracionMin: number;
    operatoryId?: string | null;
  },
): Promise<DisponibilidadDeCita> {
  const inicioLocal = p.startsAtRaw.slice(0, 16);
  const finLocal = sumarMinutosLocal(inicioLocal, p.duracionMin);
  const partes = partirLocal(inicioLocal);

  const [ajustes, excRes] = await Promise.all([
    leerAjustesAgenda(supabase, p.clinicId),
    supabase
      .from("agenda_exceptions")
      .select(COLUMNAS_EXCEPCION)
      .eq("clinic_id", p.clinicId)
      .or(`professional_id.eq.${p.professionalId},professional_id.is.null`)
      .lt("starts_local", finLocal),
  ]);
  if (excRes.error)
    throw new Error(mensajeDb(excRes.error, "No pudimos revisar los bloqueos de la agenda."));
  if (!partes) return { ajustes, bloqueos: [], aperturaCubre: false };

  const excepciones = (excRes.data ?? [])
    .filter((f) => f.repeat_weekly || f.ends_local.slice(0, 16) > inicioLocal)
    .map((f) => mapExcepcion(f));
  const fecha = partes.fecha;
  const inicio = partes.minutos - HORA_INICIO * 60;
  const bloqueos = bloqueosQueChocan(excepciones, {
    profesionalId: p.professionalId,
    sucursalId: p.branchId,
    boxId: p.operatoryId ?? null,
    fecha,
    inicio,
    duracion: p.duracionMin,
  }).map(describirBloqueo);
  const aperturaCubre = cabeEn(
    { inicio, fin: inicio + p.duracionMin },
    aperturasDelDia(excepciones, fecha, p.professionalId),
  );
  return { ajustes, bloqueos, aperturaCubre };
}
