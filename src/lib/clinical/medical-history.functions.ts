import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  VENTANA_CITA_MS,
  alergiasSchema,
  citaDeLaAtencion,
  conciliarAlergias,
  cuestionarioSchema,
  leerCuestionario,
  leerDetallesDeAlergias,
  nombresDeAlergias,
  signosVitalesSchema,
  type AlergiaDetallada,
  type CuestionarioRiesgo,
} from "@/lib/clinical/anamnesis";
import { isUndefinedColumnError, isUndefinedTableError, mensajeDb } from "@/lib/db-errors";

export type MedicalHistory = {
  allergies: string[];
  /** Mismas alergias que `allergies`, en el mismo orden, con su severidad. */
  allergyDetails: AlergiaDetallada[];
  chronicMedications: string[];
  conditions: string[];
  notes: string | null;
  riskQuestionnaire: CuestionarioRiesgo;
  updatedAt: string | null;
  /**
   * `false` mientras la migración 20261019180000 no esté aplicada: la ficha
   * sigue mostrando la anamnesis de texto y esconde el cuestionario.
   */
  estructuradaDisponible: boolean;
};

const EMPTY_HISTORY: MedicalHistory = {
  allergies: [],
  allergyDetails: [],
  chronicMedications: [],
  conditions: [],
  notes: null,
  riskQuestionnaire: {},
  updatedAt: null,
  estructuradaDisponible: true,
};

const COLUMNAS_BASE = "allergies, chronic_medications, conditions, notes, updated_at";

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
    const consulta = (columnas: string) =>
      context.supabase
        .from("patient_medical_history")
        .select(columnas)
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .maybeSingle();

    let estructuradaDisponible = true;
    let { data: row, error } = await consulta(
      `${COLUMNAS_BASE}, allergy_details, risk_questionnaire`,
    );
    if (error && isUndefinedColumnError(error)) {
      estructuradaDisponible = false;
      ({ data: row, error } = await consulta(COLUMNAS_BASE));
    }
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar los antecedentes médicos del paciente."));
    if (!row) return { ...EMPTY_HISTORY, estructuradaDisponible };
    const fila = row as unknown as {
      allergies: string[] | null;
      allergy_details?: unknown;
      chronic_medications: string[] | null;
      conditions: string[] | null;
      notes: string | null;
      risk_questionnaire?: unknown;
      updated_at: string;
    };
    const allergies = fila.allergies ?? [];
    return {
      allergies,
      allergyDetails: conciliarAlergias(allergies, leerDetallesDeAlergias(fila.allergy_details)),
      chronicMedications: fila.chronic_medications ?? [],
      conditions: fila.conditions ?? [],
      notes: fila.notes,
      riskQuestionnaire: leerCuestionario(fila.risk_questionnaire),
      updatedAt: fila.updated_at,
      estructuradaDisponible,
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

/**
 * Upsert por patient_id (UNIQUE). La auditoría (`patient_medical_history_audit`)
 * la escribe un trigger, con el actor tomado de la sesión.
 *
 * `allergyDetails` y `riskQuestionnaire` son opcionales: una edición que
 * quedó en la cola offline antes de este cambio llega solo con `allergies`,
 * y tiene que seguir guardándose. En ese caso la severidad de las alergias
 * que siguen se conserva, y el cuestionario no se toca (PostgREST solo
 * actualiza las columnas que van en el payload).
 */
export const setMedicalHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        allergies: listField,
        allergyDetails: alergiasSchema.optional(),
        chronicMedications: listField,
        conditions: listField,
        notes: z.string().trim().max(2000).optional().or(z.literal("")),
        riskQuestionnaire: cuestionarioSchema.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; estructuradaPendiente: boolean }> => {
    const base = {
      clinic_id: data.clinicId,
      patient_id: data.patientId,
      chronic_medications: data.chronicMedications,
      conditions: data.conditions,
      notes: data.notes?.trim() || null,
      updated_by: context.userId,
    };

    let detalles: AlergiaDetallada[];
    if (data.allergyDetails) {
      detalles = conciliarAlergias(nombresDeAlergias(data.allergyDetails), data.allergyDetails);
    } else {
      const { data: actual, error: lecturaError } = await context.supabase
        .from("patient_medical_history")
        .select("allergy_details")
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .maybeSingle();
      const previos =
        lecturaError || !actual
          ? []
          : leerDetallesDeAlergias((actual as { allergy_details?: unknown }).allergy_details);
      detalles = conciliarAlergias(data.allergies, previos);
    }

    const estructurada = {
      ...base,
      allergies: detalles.map((d) => d.name),
      allergy_details: detalles,
      ...(data.riskQuestionnaire ? { risk_questionnaire: data.riskQuestionnaire } : {}),
    };
    const { error } = await context.supabase
      .from("patient_medical_history")
      .upsert(estructurada as never, { onConflict: "patient_id" });

    if (error && isUndefinedColumnError(error)) {
      // Migración 20261019180000 sin aplicar: se guarda lo que la tabla ya
      // tiene (las alergias por nombre) y se avisa que lo estructurado no.
      const { error: errorBase } = await context.supabase
        .from("patient_medical_history")
        .upsert({ ...base, allergies: detalles.map((d) => d.name) }, { onConflict: "patient_id" });
      if (errorBase) throw new Error("No tienes permisos para editar los antecedentes médicos.");
      return { ok: true, estructuradaPendiente: true };
    }
    if (error) throw new Error("No tienes permisos para editar los antecedentes médicos.");
    return { ok: true, estructuradaPendiente: false };
  });

// ---------------------------------------------------------------
// Signos vitales por atención (append-only)
// ---------------------------------------------------------------

export type SignosVitales = {
  id: string;
  appointmentId: string | null;
  measuredAt: string;
  systolicMmhg: number;
  diastolicMmhg: number;
  heartRateBpm: number;
  temperatureC: number | null;
  notes: string | null;
};

/**
 * Últimas mediciones del paciente, la más reciente primero. `disponible:
 * false` mientras la tabla no exista (migración sin aplicar). Mismo gate de
 * RLS que la anamnesis: solo roles clínicos.
 */
export const listVitalSigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ disponible: boolean; items: SignosVitales[] }> => {
    const { data: rows, error } = await context.supabase
      .from("patient_vital_signs")
      .select(
        "id, appointment_id, measured_at, systolic_mmhg, diastolic_mmhg, heart_rate_bpm, temperature_c, notes",
      )
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .order("measured_at", { ascending: false })
      .limit(20);
    if (error && isUndefinedTableError(error)) return { disponible: false, items: [] };
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los signos vitales."));
    return {
      disponible: true,
      items: (rows ?? []).map((r) => ({
        id: r.id,
        appointmentId: r.appointment_id,
        measuredAt: r.measured_at,
        systolicMmhg: r.systolic_mmhg,
        diastolicMmhg: r.diastolic_mmhg,
        heartRateBpm: r.heart_rate_bpm,
        temperatureC: r.temperature_c,
        notes: r.notes,
      })),
    };
  });

/** Una medición nueva. No hay edición: un error se corrige registrando otra. */
export const recordVitalSigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        appointmentId: z.string().uuid().optional(),
      })
      .and(signosVitalesSchema)
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Sin cita explícita, se asocia a la atención en curso: la cita del
    // paciente más cercana a ahora (± 6 h). Si no hay, queda sin cita.
    let appointmentId = data.appointmentId ?? null;
    if (!appointmentId) {
      const ahora = new Date();
      const { data: citas } = await context.supabase
        .from("appointments")
        .select("id, starts_at, status")
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .gte("starts_at", new Date(ahora.getTime() - VENTANA_CITA_MS).toISOString())
        .lte("starts_at", new Date(ahora.getTime() + VENTANA_CITA_MS).toISOString());
      appointmentId = citaDeLaAtencion(citas ?? [], ahora);
    }
    const { error } = await context.supabase.from("patient_vital_signs").insert({
      clinic_id: data.clinicId,
      patient_id: data.patientId,
      appointment_id: appointmentId,
      systolic_mmhg: data.systolicMmhg,
      diastolic_mmhg: data.diastolicMmhg,
      heart_rate_bpm: data.heartRateBpm,
      temperature_c: data.temperatureC ?? null,
      notes: data.notes?.trim() || null,
      recorded_by: context.userId,
    });
    if (error && isUndefinedTableError(error))
      throw new Error("El registro de signos vitales todavía no está habilitado.");
    if (error) throw new Error("No tienes permisos para registrar signos vitales.");
    return { ok: true };
  });
