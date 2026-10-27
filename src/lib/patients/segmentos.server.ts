import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { mensajeDb } from "@/lib/db-errors";
import { cargarPacientes } from "@/lib/patients/patients.functions";
import {
  normalizarFiltros,
  pasaFiltros,
  usaFinanzas,
  type FiltrosDePacientes,
} from "@/lib/patients/filtros-pacientes";

/**
 * Resolver un segmento de pacientes (PAC-06) a la lista de pacientes que
 * entran HOY. Es la función que reutiliza el frente B (campañas, CRM-04):
 * el segmento guarda solo filtros, y la lista se calcula al usarlo con la
 * misma regla que la pantalla /pacientes (`pasaFiltros`), así la lista y la
 * campaña nunca cuentan distinto.
 *
 * - Corre con el cliente Supabase del USUARIO (el `context.supabase` de una
 *   server function con `requireSupabaseAuth`): la RLS aplica, así que un
 *   usuario de otra clínica no obtiene nada y el segmento de otra clínica
 *   no se encuentra.
 * - Solo fichas activas: las archivadas nunca entran en un segmento.
 * - Un segmento que filtra por saldo necesita `finance:view` (regla 15):
 *   sin el permiso, lanza `SEGMENTO_REQUIERE_FINANZAS` en vez de devolver
 *   una lista sin ese filtro (que sería otra lista).
 * - No filtra por consentimiento: devuelve `waOptOut`/`emailOptOut` y si
 *   tiene tutor, para que quien envía decida por canal.
 */

export const SEGMENTO_REQUIERE_FINANZAS =
  "Este segmento filtra por saldo y necesitas permiso de finanzas para usarlo.";
export const SEGMENTO_NO_ENCONTRADO = "No encontramos ese segmento en tu clínica.";

/** Un paciente de un segmento resuelto: lo justo para escribirle. */
export interface PacienteDeSegmento {
  id: string;
  nombre: string;
  /** E.164 cuando se pudo leer; "" sin teléfono. */
  telefono: string;
  email: string;
  /** YYYY-MM-DD o null. */
  fechaNacimiento: string | null;
  /** Dio de baja WhatsApp (`wa_opt_out_at`): no se le escribe por ese canal. */
  waOptOut: boolean;
  /** Dio de baja el correo (`email_opt_out_at`). */
  emailOptOut: boolean;
  /** Consentimiento de outreach por WhatsApp (`wa_opt_in`). */
  waOptIn: boolean;
  /** Tiene tutor registrado (menor o representado): los mensajes van al tutor. */
  tieneTutor: boolean;
}

export interface SegmentoResuelto {
  segmento: { id: string; nombre: string; filtros: FiltrosDePacientes };
  pacientes: PacienteDeSegmento[];
  /** La clínica tiene más fichas que el tope de lectura: la lista puede estar incompleta. */
  truncado: boolean;
}

/**
 * Resuelve un segmento guardado (`patient_segments`) a su lista de pacientes.
 *
 * @throws `SEGMENTO_NO_ENCONTRADO` si no existe o es de otra clínica (RLS).
 * @throws `SEGMENTO_REQUIERE_FINANZAS` si filtra por saldo y el usuario no tiene `finance:view`.
 */
export async function resolverSegmento(
  supabase: SupabaseClient<Database>,
  args: { clinicId: string; userId: string; segmentId: string },
): Promise<SegmentoResuelto> {
  const { data: fila, error } = await supabase
    .from("patient_segments")
    .select("id, name, filters")
    .eq("id", args.segmentId)
    .eq("clinic_id", args.clinicId)
    .maybeSingle();
  if (error) throw new Error(mensajeDb(error, SEGMENTO_NO_ENCONTRADO));
  if (!fila) throw new Error(SEGMENTO_NO_ENCONTRADO);
  const filtros = normalizarFiltros(fila.filters);
  const { pacientes, truncado } = await resolverFiltros(supabase, {
    clinicId: args.clinicId,
    userId: args.userId,
    filtros,
  });
  return { segmento: { id: fila.id, nombre: fila.name, filtros }, pacientes, truncado };
}

/**
 * Lo mismo que `resolverSegmento`, para filtros sueltos (los de la URL de
 * /pacientes, sin guardarlos). Mismas reglas.
 */
export async function resolverFiltros(
  supabase: SupabaseClient<Database>,
  args: { clinicId: string; userId: string; filtros: unknown },
): Promise<{ pacientes: PacienteDeSegmento[]; truncado: boolean }> {
  const filtros = normalizarFiltros(args.filtros);
  const finanzas = usaFinanzas(filtros);

  const listado = await cargarPacientes(supabase, args.userId, {
    clinicId: args.clinicId,
    archivo: "activas",
    conSaldos: finanzas,
    conCompletitud: Boolean(filtros.incompletas),
    conEtiquetas: Boolean(filtros.etiqueta),
  });
  if (finanzas && !listado.veFinanzas) throw new Error(SEGMENTO_REQUIERE_FINANZAS);

  const { data: clinica } = await supabase
    .from("clinics")
    .select("timezone")
    .eq("id", args.clinicId)
    .maybeSingle();
  const zona = clinica?.timezone || "America/Santiago";
  const ctx = { hoy: hoyISO(zona), zona };

  const ids = listado.items.filter((p) => pasaFiltros(p, filtros, ctx)).map((p) => p.id);
  if (ids.length === 0) return { pacientes: [], truncado: listado.truncated };

  // Bajas y tutor: no vienen en el listado. De a 200 ids por consulta (URL).
  const bajas = new Map<string, { wa: boolean; email: boolean }>();
  const conTutor = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const [{ data: filas, error }, { data: tutores, error: tutorError }] = await Promise.all([
      supabase
        .from("patients")
        .select("id, wa_opt_out_at, email_opt_out_at")
        .eq("clinic_id", args.clinicId)
        .in("id", lote),
      supabase
        .from("patient_guardians")
        .select("patient_id")
        .eq("clinic_id", args.clinicId)
        .is("archived_at", null)
        .in("patient_id", lote),
    ]);
    if (error) throw new Error(mensajeDb(error, "No pudimos leer los contactos del segmento."));
    if (tutorError)
      throw new Error(mensajeDb(tutorError, "No pudimos leer los tutores del segmento."));
    for (const f of filas ?? [])
      bajas.set(f.id, { wa: Boolean(f.wa_opt_out_at), email: Boolean(f.email_opt_out_at) });
    for (const t of tutores ?? []) conTutor.add(t.patient_id);
  }

  const porId = new Map(listado.items.map((p) => [p.id, p]));
  const pacientes = ids.map((id): PacienteDeSegmento => {
    const p = porId.get(id)!;
    const baja = bajas.get(id);
    return {
      id,
      nombre: p.nombre,
      telefono: p.telefono,
      email: p.email,
      fechaNacimiento: p.fechaNacimiento ?? null,
      waOptOut: baja?.wa ?? false,
      emailOptOut: baja?.email ?? false,
      waOptIn: p.waOptIn,
      tieneTutor: conTutor.has(id),
    };
  });
  return { pacientes, truncado: listado.truncated };
}
