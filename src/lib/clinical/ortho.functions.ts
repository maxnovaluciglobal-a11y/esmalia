import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import {
  ORTHO_CASE_KINDS,
  ORTHO_CASE_STATUSES,
  type OrthoCase,
  type OrthoCaseKind,
  type OrthoCaseStatus,
  type OrthoControl,
} from "@/lib/clinical/ortho";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

const ORTHO_CASE_COLUMNS =
  "id, patient_id, professional_id, treatment_plan_id, kind, status, started_on, expected_end_on, currency, monthly_fee_cents, notes";

type OrthoCaseRow = {
  id: string;
  patient_id: string;
  professional_id: string | null;
  treatment_plan_id: string | null;
  kind: OrthoCaseKind;
  status: OrthoCaseStatus;
  started_on: string;
  expected_end_on: string | null;
  currency: string;
  monthly_fee_cents: number | null;
  notes: string | null;
};

export const listOrthoCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid().nullish(),
        estado: z.enum(ORTHO_CASE_STATUSES).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<OrthoCase[]> => {
    const { supabase } = context;
    let query = supabase
      .from("ortho_cases")
      .select(ORTHO_CASE_COLUMNS)
      .eq("clinic_id", data.clinicId);
    if (data.patientId) query = query.eq("patient_id", data.patientId);
    if (data.estado) query = query.eq("status", data.estado);

    const { data: rows, error } = await query.order("started_on", { ascending: false });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los casos de ortodoncia."));

    const caseIds = (rows ?? []).map((r) => r.id);
    const patientIds = [...new Set((rows ?? []).map((r) => r.patient_id))];

    const [{ data: pacientes }, { data: controles, error: controlesError }] = await Promise.all([
      patientIds.length
        ? supabase.from("patients").select("id, full_name").in("id", patientIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      caseIds.length
        ? supabase
            .from("ortho_controls")
            .select("ortho_case_id, control_date")
            .in("ortho_case_id", caseIds)
            .order("control_date", { ascending: false })
        : Promise.resolve({
            data: [] as { ortho_case_id: string; control_date: string }[],
            error: null,
          }),
    ]);
    if (controlesError)
      throw new Error(mensajeDb(controlesError, "No pudimos cargar los controles de ortodoncia."));

    const nombres = new Map((pacientes ?? []).map((p) => [p.id, p.full_name]));
    const ultimoControl = new Map<string, string>();
    for (const c of controles ?? []) {
      if (!ultimoControl.has(c.ortho_case_id)) ultimoControl.set(c.ortho_case_id, c.control_date);
    }

    return (rows ?? []).map((r: OrthoCaseRow) => ({
      id: r.id,
      patientId: r.patient_id,
      patientName: nombres.get(r.patient_id) ?? "Paciente",
      professionalId: r.professional_id,
      treatmentPlanId: r.treatment_plan_id,
      kind: r.kind,
      status: r.status,
      startedOn: r.started_on,
      expectedEndOn: r.expected_end_on,
      currency: r.currency,
      monthlyFeeCents: r.monthly_fee_cents,
      notes: r.notes,
      lastControlOn: ultimoControl.get(r.id) ?? null,
    }));
  });

export const createOrthoCase = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        professionalId: z.string().uuid().nullish(),
        treatmentPlanId: z.string().uuid().nullish(),
        kind: z.enum(ORTHO_CASE_KINDS),
        startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        expectedEndOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        monthlyFeeCents: z.number().int().min(0).nullish(),
        notes: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: inserted, error } = await context.supabase
      .from("ortho_cases")
      .insert({
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        professional_id: data.professionalId ?? null,
        treatment_plan_id: data.treatmentPlanId ?? null,
        kind: data.kind,
        started_on: data.startedOn,
        expected_end_on: data.expectedEndOn ?? null,
        monthly_fee_cents: data.monthlyFeeCents ?? null,
        notes: data.notes || null,
      })
      .select("id")
      .single();
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos crear el caso. Puede que tu rol no pueda registrar ortodoncia.",
        ),
      );
    return { id: inserted.id };
  });

export const setOrthoCaseStatus = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        caseId: z.string().uuid(),
        status: z.enum(ORTHO_CASE_STATUSES),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("ortho_cases")
      .update({ status: data.status })
      .eq("id", data.caseId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos actualizar el estado del caso."));
    return { ok: true };
  });

export const listOrthoControls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), orthoCaseId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<OrthoControl[]> => {
    const { data: rows, error } = await context.supabase
      .from("ortho_controls")
      .select("id, ortho_case_id, control_date, attended, payment_id, notes")
      .eq("clinic_id", data.clinicId)
      .eq("ortho_case_id", data.orthoCaseId)
      .order("control_date", { ascending: false });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los controles."));
    return (rows ?? []).map((r) => ({
      id: r.id,
      orthoCaseId: r.ortho_case_id,
      controlDate: r.control_date,
      attended: r.attended,
      paymentId: r.payment_id,
      notes: r.notes,
    }));
  });

/**
 * Registra un control. `paymentId` es opcional: la clínica cobra la cuota
 * por separado en Finanzas (registerPayment) y solo vincula acá el pago ya
 * hecho — este endpoint no cobra nada por sí mismo, para no duplicar el
 * único motor de pagos que ya existe.
 */
export const addOrthoControl = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        orthoCaseId: z.string().uuid(),
        controlDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        attended: z.boolean().default(true),
        paymentId: z.string().uuid().nullish(),
        notes: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: inserted, error } = await context.supabase
      .from("ortho_controls")
      .insert({
        clinic_id: data.clinicId,
        ortho_case_id: data.orthoCaseId,
        control_date: data.controlDate,
        attended: data.attended,
        payment_id: data.paymentId ?? null,
        notes: data.notes || null,
      })
      .select("id")
      .single();
    if (error) throw new Error(mensajeDb(error, "No pudimos registrar el control."));
    return { id: inserted.id };
  });
