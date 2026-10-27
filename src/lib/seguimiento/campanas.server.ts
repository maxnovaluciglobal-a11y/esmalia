/**
 * CRM-04 · Quién recibe una campaña (Ola 8). Una sola puerta,
 * `resolverDestinatarios`, para la vista previa y para la confirmación: lo
 * que se mostró es lo que se confirma.
 *
 * El grupo sale de `SegmentoCampana`:
 *  - `filtro`: el filtro propio de la campaña (`cumpleFiltro`).
 *  - `segmento`: un segmento guardado de Pacientes (PAC-06). Quién entra lo
 *    decide `resolverSegmento` (src/lib/patients/segmentos.server.ts), la
 *    misma regla que la lista de /pacientes. Ese resolvedor no filtra por
 *    consentimiento: las bajas por canal las aplica `elegibilidad` acá.
 *
 * Corre con el cliente del usuario (RLS de la clínica). Los menores con tutor
 * vigente reciben en el contacto del tutor (CLI-11), leyendo los tutores de una
 * vez para todo el grupo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { mensajeDb } from "@/lib/db-errors";
import { normalizeToWaMe } from "@/lib/messaging/telefonos";
import { resolverSegmento } from "@/lib/patients/segmentos.server";
import { leerTodasLasPaginas } from "@/lib/paginacion";
import {
  destinatarioDeComunicaciones,
  esMenorDeEdad,
  type Parentesco,
  type Tutor,
} from "@/lib/patients/tutor";
import {
  cumpleFiltro,
  elegibilidad,
  MAXIMO_DESTINATARIOS,
  type CanalDeCampana,
  type Elegibilidad,
  type PacienteParaCampana,
  type SegmentoCampana,
} from "@/lib/seguimiento/campanas";
import { leerDatosDePacientes } from "@/lib/seguimiento/seguimiento.server";

type Cliente = SupabaseClient<Database>;

export interface DestinatarioEvaluado {
  paciente: PacienteParaCampana;
  elegibilidad: Elegibilidad;
}

async function leerPacientesParaCampana(
  supabase: Cliente,
  clinicId: string,
): Promise<PacienteParaCampana[]> {
  const [{ filas, error }, datos, presupuestos] = await Promise.all([
    leerTodasLasPaginas((desde, hasta) =>
      supabase
        .from("patients")
        .select(
          "id, full_name, phone, email, birth_date, wa_opt_in, wa_opt_out_at, email_opt_out_at",
        )
        .eq("clinic_id", clinicId)
        .is("archived_at", null)
        .order("id", { ascending: true })
        .range(desde, hasta),
    ),
    leerDatosDePacientes(supabase, clinicId),
    leerTodasLasPaginas((desde, hasta) =>
      supabase
        .from("quotes")
        .select("id, patient_id")
        .eq("clinic_id", clinicId)
        .in("status", ["sent", "draft"])
        .is("accepted_at", null)
        .order("id", { ascending: true })
        .range(desde, hasta),
    ),
  ]);
  if (error) throw new Error(mensajeDb(error, "No pudimos cargar los pacientes."));
  if (presupuestos.error) {
    throw new Error(mensajeDb(presupuestos.error, "No pudimos cargar los presupuestos."));
  }
  const porPaciente = new Map(datos.map((d) => [d.patientId, d]));
  const conPresupuesto = new Set(presupuestos.filas.map((q) => q.patient_id));
  return filas.map((p) => {
    const d = porPaciente.get(p.id);
    return {
      id: p.id,
      nombre: p.full_name,
      telefono: p.phone,
      email: p.email,
      fechaNacimiento: p.birth_date,
      waOptIn: Boolean(p.wa_opt_in),
      waOptOutAt: p.wa_opt_out_at,
      emailOptOutAt: p.email_opt_out_at,
      ultimaVisita: d?.ultimaVisita ?? null,
      tieneCitaFutura: d?.tieneCitaFutura ?? false,
      tienePresupuestoPendiente: conPresupuesto.has(p.id),
    };
  });
}

/**
 * Pacientes de un segmento guardado (PAC-06): sus ids, con la regla de
 * /pacientes. Si la clínica tiene más fichas que el tope de lectura, avisa
 * en vez de mandar a una lista incompleta.
 */
async function pacientesDelSegmentoGuardado(
  supabase: Cliente,
  args: { clinicId: string; userId: string; segmentId: string },
): Promise<Set<string>> {
  const r = await resolverSegmento(supabase, args);
  if (r.truncado) {
    throw new Error(
      "La clínica tiene más fichas de las que se pueden revisar de una vez: el segmento podría quedar incompleto. Usa el filtro de la campaña.",
    );
  }
  return new Set(r.pacientes.map((p) => p.id));
}

async function tutoresDe(
  supabase: Cliente,
  clinicId: string,
  patientIds: readonly string[],
): Promise<Map<string, Tutor[]>> {
  const mapa = new Map<string, Tutor[]>();
  for (let i = 0; i < patientIds.length; i += 200) {
    const tanda = patientIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("patient_guardians")
      .select(
        "id, patient_id, full_name, document_id, relationship, relationship_detail, phone, email, is_primary, archived_at",
      )
      .eq("clinic_id", clinicId)
      .in("patient_id", tanda)
      .is("archived_at", null);
    // Igual que `resolverDestinatario`: si no se pueden leer, cae al paciente.
    if (error) continue;
    for (const r of data ?? []) {
      const lista = mapa.get(r.patient_id) ?? [];
      lista.push({
        id: r.id,
        fullName: r.full_name,
        documentId: r.document_id,
        relationship: r.relationship as Parentesco,
        relationshipDetail: r.relationship_detail,
        phone: r.phone,
        email: r.email,
        isPrimary: r.is_primary,
        archivedAt: r.archived_at,
      });
      mapa.set(r.patient_id, lista);
    }
  }
  return mapa;
}

export async function resolverDestinatarios(
  supabase: Cliente,
  args: {
    clinicId: string;
    userId: string;
    segmento: SegmentoCampana;
    canal: CanalDeCampana;
    hoy: string;
    pais: string | null;
  },
): Promise<DestinatarioEvaluado[]> {
  const todos = await leerPacientesParaCampana(supabase, args.clinicId);
  let grupo: PacienteParaCampana[];
  if (args.segmento.tipo === "segmento") {
    const ids = await pacientesDelSegmentoGuardado(supabase, {
      clinicId: args.clinicId,
      userId: args.userId,
      segmentId: args.segmento.segmentoId,
    });
    grupo = todos.filter((p) => ids.has(p.id));
  } else {
    const filtro = args.segmento.filtro;
    grupo = todos.filter((p) => cumpleFiltro(p, filtro, args.hoy));
  }
  grupo.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const menores = grupo
    .filter((p) => esMenorDeEdad(p.fechaNacimiento, args.hoy) === true)
    .map((p) => p.id);
  const tutores = menores.length ? await tutoresDe(supabase, args.clinicId, menores) : new Map();

  return grupo.map((p) => {
    const contacto = destinatarioDeComunicaciones({
      fechaNacimiento: p.fechaNacimiento,
      hoy: args.hoy,
      telefonoPaciente: p.telefono,
      emailPaciente: p.email,
      tutores: tutores.get(p.id) ?? [],
    });
    return {
      paciente: p,
      elegibilidad: elegibilidad({
        paciente: p,
        canal: args.canal,
        contacto,
        telefonoValido: (t) => normalizeToWaMe(t, args.pais) !== null,
      }),
    };
  });
}

export function excedeTope(elegibles: number): string | null {
  return elegibles > MAXIMO_DESTINATARIOS
    ? `La campaña alcanza a ${elegibles} pacientes y el tope es ${MAXIMO_DESTINATARIOS}. Afina el grupo o pártela en dos.`
    : null;
}
