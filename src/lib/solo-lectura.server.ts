/**
 * El chequeo central del modo solo lectura (servidor). Lo usan los
 * middlewares de `solo-lectura.middleware.ts`; vive aparte para poder
 * probarlo con un cliente simulado, sin contexto de TanStack Start.
 *
 * Regla 15 de la casa: el gate de la UI (banner, botones deshabilitados) no
 * protege nada por sí solo, porque cualquier miembro puede llamar la server
 * function directo con su JWT. Este es el par en el servidor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { mapSubscription, SUBSCRIPTION_SELECT } from "@/lib/billing.functions";
import {
  esCitaEnCurso,
  MENSAJE_SOLO_LECTURA,
  soloLectura,
  URGENCIA_MARGEN_ANTES_MS,
  URGENCIA_MARGEN_DESPUES_MS,
} from "@/lib/solo-lectura";
import { capturarErrorDelServidor } from "@/lib/sentry.server";

type Supabase = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidDe(valor: unknown): string | null {
  return typeof valor === "string" && UUID.test(valor) ? valor : null;
}

/** Programación: una server function de escritura sin forma de saber la clínica. */
export const MENSAJE_SIN_CLINICA = "No pudimos identificar la clínica de esta operación.";

/**
 * ¿La clínica está en solo lectura? Lee `subscriptions` con el cliente del
 * usuario (RLS: cualquier miembro la ve, igual que el banner).
 *
 * Si la lectura falla, NO bloquea: es un gate de cobro, no de seguridad (la
 * RLS sigue decidiendo quién escribe qué), y cortar la operación de toda una
 * clínica por un error pasajero de la base es peor que dejar pasar una
 * escritura de una clínica morosa. Se reporta a Sentry.
 */
export async function clinicaEnSoloLectura(
  supabase: Supabase,
  clinicId: string,
  ahora: Date = new Date(),
): Promise<boolean> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(SUBSCRIPTION_SELECT)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) {
    await capturarErrorDelServidor(error, { ruta: "solo-lectura" });
    return false;
  }
  // Sin fila: clínicas piloto anteriores al trigger, acceso completo.
  if (!data) return false;
  return soloLectura(mapSubscription(data as Parameters<typeof mapSubscription>[0]), ahora);
}

/**
 * ¿El paciente tiene una cita en curso en esa clínica? (Excepción de
 * urgencia clínica: ver `esCitaEnCurso`.) La consulta acota por la ventana
 * y la función pura decide, así el criterio vive en un solo lugar.
 */
export async function pacienteConCitaEnCurso(
  supabase: Supabase,
  clinicId: string,
  patientRef: string,
  ahora: Date = new Date(),
): Promise<boolean> {
  const patientId = uuidDe(patientRef);
  if (!patientId) return false;
  const t = ahora.getTime();
  const { data, error } = await supabase
    .from("appointments")
    .select("starts_at, ends_at, status")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .lte("starts_at", new Date(t + URGENCIA_MARGEN_ANTES_MS).toISOString())
    .gte("ends_at", new Date(t - URGENCIA_MARGEN_DESPUES_MS).toISOString())
    .limit(20);
  if (error || !data) return false;
  return data.some((cita) => esCitaEnCurso(cita, ahora));
}

/**
 * Lanza `MENSAJE_SOLO_LECTURA` si la clínica está en solo lectura, salvo que
 * `excepcion` diga que esta escritura puntual está permitida (se consulta
 * solo cuando hace falta).
 */
export async function exigirEscritura(
  supabase: Supabase,
  clinicId: string,
  opciones: { ahora?: Date; excepcion?: () => Promise<boolean> } = {},
): Promise<void> {
  const ahora = opciones.ahora ?? new Date();
  if (!(await clinicaEnSoloLectura(supabase, clinicId, ahora))) return;
  if (opciones.excepcion && (await opciones.excepcion())) return;
  throw new Error(MENSAJE_SOLO_LECTURA);
}

/** Clínica dueña de una fila, leída con la RLS del usuario. `null` si no la ve. */
export async function clinicaDeLaFila(
  supabase: Supabase,
  tabla: TablaConClinica,
  id: string,
): Promise<string | null> {
  const { data } = await (supabase.from(tabla) as unknown as ConsultaClinica)
    .select("clinic_id")
    .eq("id", id)
    .maybeSingle();
  return data?.clinic_id ?? null;
}

/** Tablas que usan las server functions que reciben el id de una fila y no `clinicId`. */
export type TablaConClinica =
  | "appointments"
  | "clinic_members"
  | "clinical_note_entities"
  | "clinical_note_versions"
  | "clinical_notes"
  | "quotes"
  | "treatment_items"
  | "treatment_plans";

type ConsultaClinica = {
  select: (columnas: "clinic_id") => {
    eq: (
      columna: "id",
      valor: string,
    ) => { maybeSingle: () => PromiseLike<{ data: { clinic_id: string } | null }> };
  };
};

/**
 * Excepción de urgencia para las notas clínicas: resuelve clínica y paciente
 * (de la nota si ya existe, así no se puede apuntar el `patientRef` a otro
 * paciente para editar una nota ajena) y deja pasar si hay cita en curso.
 */
export async function exigirEscrituraDeNotaClinica(
  supabase: Supabase,
  datos: { clinicId?: unknown; patientRef?: unknown; noteId?: unknown },
  ahora: Date = new Date(),
): Promise<void> {
  let clinicId = uuidDe(datos.clinicId);
  let patientRef = typeof datos.patientRef === "string" ? datos.patientRef : null;
  const noteId = uuidDe(datos.noteId);
  if (noteId) {
    const { data: nota } = await supabase
      .from("clinical_notes")
      .select("clinic_id, patient_ref")
      .eq("id", noteId)
      .maybeSingle();
    if (nota) {
      clinicId = nota.clinic_id;
      patientRef = nota.patient_ref;
    }
  }
  if (!clinicId) throw new Error(MENSAJE_SIN_CLINICA);
  const clinica = clinicId;
  await exigirEscritura(supabase, clinica, {
    ahora,
    excepcion: patientRef
      ? () => pacienteConCitaEnCurso(supabase, clinica, patientRef, ahora)
      : undefined,
  });
}
