import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";

export type MedicalHistory = {
  allergies: string[];
  chronicMedications: string[];
  conditions: string[];
  notes: string | null;
  updatedAt: string | null;
};

const EMPTY_HISTORY: MedicalHistory = {
  allergies: [],
  chronicMedications: [],
  conditions: [],
  notes: null,
  updatedAt: null,
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
    // SEG-02: en paralelo con la carga; se espera antes de responder.
    const lectura = registrarLecturaDeFicha(context.supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "anamnesis",
    });
    const { data: row, error } = await context.supabase
      .from("patient_medical_history")
      .select("allergies, chronic_medications, conditions, notes, updated_at")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .maybeSingle();
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar los antecedentes médicos del paciente."));
    await lectura;
    if (!row) return EMPTY_HISTORY;
    return {
      allergies: row.allergies ?? [],
      chronicMedications: row.chronic_medications ?? [],
      conditions: row.conditions ?? [],
      notes: row.notes,
      updatedAt: row.updated_at,
    };
  });

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
    const { data: rows, error } = await context.supabase
      .from("patient_medical_history")
      .select("patient_id, allergies")
      .eq("clinic_id", data.clinicId);
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar las alertas de alergias de la clínica."));
    const byPatient: Record<string, string[]> = {};
    for (const row of rows ?? []) {
      if (row.allergies && row.allergies.length > 0) byPatient[row.patient_id] = row.allergies;
    }
    return byPatient;
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
