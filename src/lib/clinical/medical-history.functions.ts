import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { alergiasConFusionadas, cargarFusiones, fichasAbsorbidas } from "@/lib/patients/fusion";

export type MedicalHistory = {
  allergies: string[];
  chronicMedications: string[];
  conditions: string[];
  notes: string | null;
  updatedAt: string | null;
  /**
   * CLI-06: anamnesis de las fichas que se fusionaron en esta. No se combina
   * sola (nadie la revisó), pero se muestra como alerta en la ficha que quedó.
   */
  deFichasFusionadas: AnamnesisDeFichaFusionada[];
};

export type AnamnesisDeFichaFusionada = {
  patientId: string;
  nombre: string;
  fusionadaEl: string | null;
  allergies: string[];
  chronicMedications: string[];
  conditions: string[];
  notes: string | null;
};

const EMPTY_HISTORY: MedicalHistory = {
  allergies: [],
  chronicMedications: [],
  conditions: [],
  notes: null,
  updatedAt: null,
  deFichasFusionadas: [],
};

/** Antecedentes médicos del paciente — 1 fila, no versionada (a diferencia
 * de clinical_notes/odontogram_marks). Ausencia de fila = sin antecedentes
 * cargados todavía, no "sin alergias confirmadas" (regla #11: no fabricar
 * un negativo que nadie confirmó). */
export const getMedicalHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<MedicalHistory> => {
    const [{ data: row, error }, fusiones] = await Promise.all([
      context.supabase
        .from("patient_medical_history")
        .select("allergies, chronic_medications, conditions, notes, updated_at")
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .maybeSingle(),
      cargarFusiones(context.supabase, data.clinicId),
    ]);
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar los antecedentes médicos del paciente."));

    const deFichasFusionadas = await anamnesisDeFichasAbsorbidas(
      context.supabase,
      data.clinicId,
      fichasAbsorbidas(data.patientId, fusiones),
    );

    if (!row) return { ...EMPTY_HISTORY, deFichasFusionadas };
    return {
      allergies: row.allergies ?? [],
      chronicMedications: row.chronic_medications ?? [],
      conditions: row.conditions ?? [],
      notes: row.notes,
      updatedAt: row.updated_at,
      deFichasFusionadas,
    };
  });

async function anamnesisDeFichasAbsorbidas(
  supabase: Parameters<typeof cargarFusiones>[0],
  clinicId: string,
  ids: string[],
): Promise<AnamnesisDeFichaFusionada[]> {
  if (!ids.length) return [];
  const [{ data: historias, error }, { data: fichas }] = await Promise.all([
    supabase
      .from("patient_medical_history")
      .select("patient_id, allergies, chronic_medications, conditions, notes")
      .eq("clinic_id", clinicId)
      .in("patient_id", ids),
    supabase
      .from("patients")
      .select("id, full_name, merged_at")
      .eq("clinic_id", clinicId)
      .in("id", ids),
  ]);
  if (error)
    throw new Error(
      mensajeDb(error, "No pudimos cargar los antecedentes de las fichas fusionadas."),
    );
  const fichaPorId = new Map((fichas ?? []).map((f) => [f.id, f]));
  return (historias ?? [])
    .filter(
      (h) =>
        (h.allergies?.length ?? 0) +
          (h.chronic_medications?.length ?? 0) +
          (h.conditions?.length ?? 0) >
          0 || Boolean(h.notes?.trim()),
    )
    .map((h) => ({
      patientId: h.patient_id,
      nombre: fichaPorId.get(h.patient_id)?.full_name ?? "Ficha fusionada",
      fusionadaEl: fichaPorId.get(h.patient_id)?.merged_at ?? null,
      allergies: h.allergies ?? [],
      chronicMedications: h.chronic_medications ?? [],
      conditions: h.conditions ?? [],
      notes: h.notes,
    }));
}

/**
 * Alergias por paciente para toda la clínica, en 1 query — pensado para
 * agenda.tsx (producto-1/ux-1: el dato clínico de mayor riesgo no llegaba
 * al punto de atención, recepción/dentista tenían que abrir la ficha
 * completa para enterarse). Solo trae `patient_id` + `allergies`, no el
 * resto de la anamnesis — es un aviso liviano para un banner/badge, no el
 * detalle completo. Un solo `.eq("clinic_id", …)` + Map en el cliente
 * (nunca N+1 por cita, ver CLAUDE.md).
 *
 * Mismo gate de RLS que `getMedicalHistory` (owner/admin/dentist/assistant,
 * ver migración 20260826180000): reception/accounting reciben `{}` siempre,
 * es el comportamiento esperado de esa policy, no un bug de este query.
 */
export const listAllergyAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Record<string, string[]>> => {
    const [{ data: rows, error }, fusiones] = await Promise.all([
      context.supabase
        .from("patient_medical_history")
        .select("patient_id, allergies")
        .eq("clinic_id", data.clinicId),
      cargarFusiones(context.supabase, data.clinicId),
    ]);
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar las alertas de alergias de la clínica."));
    const byPatient: Record<string, string[]> = {};
    for (const row of rows ?? []) {
      if (row.allergies && row.allergies.length > 0) byPatient[row.patient_id] = row.allergies;
    }
    // CLI-06: la ficha que quedó de una fusión avisa también las alergias
    // que se cargaron en la ficha absorbida.
    return alergiasConFusionadas(byPatient, fusiones);
  });

const listField = z.array(z.string().trim().min(1).max(80)).max(30);

/** Upsert por patient_id (UNIQUE) — perfil editable, no un historial de
 * eventos: no tiene sentido guardar "versión anterior" de una alergia. */
export const setMedicalHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        allergies: listField,
        chronicMedications: listField,
        conditions: listField,
        notes: z.string().trim().max(2000).optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("patient_medical_history").upsert(
      {
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        allergies: data.allergies,
        chronic_medications: data.chronicMedications,
        conditions: data.conditions,
        notes: data.notes?.trim() || null,
        updated_by: context.userId,
      },
      { onConflict: "patient_id" },
    );
    if (error) throw new Error("No tienes permisos para editar los antecedentes médicos.");
    return { ok: true };
  });
