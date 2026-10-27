import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import {
  ORTHO_CASE_KINDS,
  ORTHO_CASE_STATUSES,
  ORTHO_STAGES,
  ORTHO_SYSTEMS,
  etapaVigente,
  kindDelSistema,
  type OrthoCaseConSeguimiento,
  type OrthoCaseKind,
  type OrthoCaseStatus,
  type OrthoControl,
  type OrthoStage,
  type OrthoStageEvent,
  type OrthoSystem,
} from "@/lib/clinical/ortho";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

const ORTHO_CASE_COLUMNS =
  "id, patient_id, professional_id, treatment_plan_id, kind, status, started_on, expected_end_on, currency, monthly_fee_cents, notes, appliance_system, aligner_current, aligner_total, aligner_change_days, aligner_changed_on";

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
  appliance_system: string | null;
  aligner_current: number | null;
  aligner_total: number | null;
  aligner_change_days: number | null;
  aligner_changed_on: string | null;
};

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function sistemaDeFila(v: string | null): OrthoSystem | null {
  return (ORTHO_SYSTEMS as readonly string[]).includes(v ?? "") ? (v as OrthoSystem) : null;
}

function etapaDeFila(v: string): OrthoStage | null {
  return (ORTHO_STAGES as readonly string[]).includes(v) ? (v as OrthoStage) : null;
}

/**
 * Alineadores coherentes antes de ir a la base (el CHECK repite lo mismo):
 * el actual no pasa del total y los dos van con el sistema de alineadores.
 */
const AlineadoresSchema = z
  .object({
    alignerCurrent: z.number().int().min(0).max(200).nullish(),
    alignerTotal: z.number().int().min(1).max(200).nullish(),
    alignerChangeDays: z.number().int().min(1).max(60).nullish(),
    alignerChangedOn: FECHA.nullish(),
  })
  .refine(
    (a) => a.alignerCurrent == null || a.alignerTotal == null || a.alignerCurrent <= a.alignerTotal,
    { message: "El alineador actual no puede pasar del total." },
  );

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
  .handler(async ({ data, context }): Promise<OrthoCaseConSeguimiento[]> => {
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

    const [
      { data: pacientes },
      { data: controles, error: controlesError },
      { data: etapas, error: etapasError },
    ] = await Promise.all([
      patientIds.length
        ? supabase
            .from("patients")
            .select("id, full_name")
            .eq("clinic_id", data.clinicId)
            .in("id", patientIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      caseIds.length
        ? supabase
            .from("ortho_controls")
            .select("ortho_case_id, control_date")
            .eq("clinic_id", data.clinicId)
            .in("ortho_case_id", caseIds)
            .order("control_date", { ascending: false })
        : Promise.resolve({
            data: [] as { ortho_case_id: string; control_date: string }[],
            error: null,
          }),
      caseIds.length
        ? supabase
            .from("ortho_stage_events")
            .select("ortho_case_id, stage, started_on, created_at")
            .eq("clinic_id", data.clinicId)
            .in("ortho_case_id", caseIds)
        : Promise.resolve({
            data: [] as {
              ortho_case_id: string;
              stage: string;
              started_on: string;
              created_at: string;
            }[],
            error: null,
          }),
    ]);
    if (controlesError)
      throw new Error(mensajeDb(controlesError, "No pudimos cargar los controles de ortodoncia."));
    if (etapasError)
      throw new Error(mensajeDb(etapasError, "No pudimos cargar las etapas de ortodoncia."));

    const nombres = new Map((pacientes ?? []).map((p) => [p.id, p.full_name]));
    const ultimoControl = new Map<string, string>();
    for (const c of controles ?? []) {
      if (!ultimoControl.has(c.ortho_case_id)) ultimoControl.set(c.ortho_case_id, c.control_date);
    }
    const etapasPorCaso = new Map<
      string,
      { stage: OrthoStage; startedOn: string; createdAt: string }[]
    >();
    for (const e of etapas ?? []) {
      const stage = etapaDeFila(e.stage);
      if (!stage) continue;
      const lista = etapasPorCaso.get(e.ortho_case_id) ?? [];
      lista.push({ stage, startedOn: e.started_on, createdAt: e.created_at });
      etapasPorCaso.set(e.ortho_case_id, lista);
    }

    return (rows ?? []).map((r: OrthoCaseRow) => {
      const vigente = etapaVigente(etapasPorCaso.get(r.id) ?? []);
      return {
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
        system: sistemaDeFila(r.appliance_system),
        alignerCurrent: r.aligner_current,
        alignerTotal: r.aligner_total,
        alignerChangeDays: r.aligner_change_days,
        alignerChangedOn: r.aligner_changed_on,
        stage: vigente?.stage ?? null,
        stageSince: vigente?.startedOn ?? null,
      };
    });
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
        /** ORT-02. Si viene, manda sobre `kind` (alineadores → aligners). */
        system: z.enum(ORTHO_SYSTEMS).nullish(),
        startedOn: FECHA,
        expectedEndOn: FECHA.nullish(),
        monthlyFeeCents: z.number().int().min(0).nullish(),
        notes: z.string().trim().max(500).optional(),
        alineadores: AlineadoresSchema.optional(),
        /** ORT-05: etapa con la que arranca (queda como primer evento). */
        stage: z.enum(ORTHO_STAGES).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const kind = data.system ? kindDelSistema(data.system) : data.kind;
    const a = kind === "aligners" ? (data.alineadores ?? {}) : {};
    const { data: inserted, error } = await context.supabase
      .from("ortho_cases")
      .insert({
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        professional_id: data.professionalId ?? null,
        treatment_plan_id: data.treatmentPlanId ?? null,
        kind,
        appliance_system: data.system ?? null,
        started_on: data.startedOn,
        expected_end_on: data.expectedEndOn ?? null,
        monthly_fee_cents: data.monthlyFeeCents ?? null,
        notes: data.notes || null,
        aligner_current: a.alignerCurrent ?? null,
        aligner_total: a.alignerTotal ?? null,
        aligner_change_days: a.alignerChangeDays ?? null,
        aligner_changed_on: a.alignerChangedOn ?? null,
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
    if (data.stage) {
      const { error: etapaError } = await context.supabase.from("ortho_stage_events").insert({
        clinic_id: data.clinicId,
        ortho_case_id: inserted.id,
        stage: data.stage,
        started_on: data.startedOn,
      });
      if (etapaError)
        throw new Error(
          mensajeDb(etapaError, "Creamos el caso, pero no pudimos registrar la etapa inicial."),
        );
    }
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

/**
 * ORT-02/03/04: sistema, alineadores y término estimado de un caso. Lo que
 * no viene no se toca; `null` lo borra.
 */
export const updateOrthoTracking = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        caseId: z.string().uuid(),
        system: z.enum(ORTHO_SYSTEMS).nullish(),
        expectedEndOn: FECHA.nullish(),
        alineadores: AlineadoresSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const a = data.alineadores;
    const cambios: {
      appliance_system?: string | null;
      kind?: OrthoCaseKind;
      expected_end_on?: string | null;
      aligner_current?: number | null;
      aligner_total?: number | null;
      aligner_change_days?: number | null;
      aligner_changed_on?: string | null;
    } = {};
    if (data.system !== undefined) {
      cambios.appliance_system = data.system;
      if (data.system) cambios.kind = kindDelSistema(data.system);
    }
    if (data.expectedEndOn !== undefined) cambios.expected_end_on = data.expectedEndOn;
    if (a.alignerCurrent !== undefined) cambios.aligner_current = a.alignerCurrent;
    if (a.alignerTotal !== undefined) cambios.aligner_total = a.alignerTotal;
    if (a.alignerChangeDays !== undefined) cambios.aligner_change_days = a.alignerChangeDays;
    if (a.alignerChangedOn !== undefined) cambios.aligner_changed_on = a.alignerChangedOn;

    const { data: fila, error } = await context.supabase
      .from("ortho_cases")
      .update(cambios)
      .eq("id", data.caseId)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar el seguimiento. Revisa que el alineador actual no pase del total.",
        ),
      );
    if (!fila) throw new Error("No tienes permisos para editar este caso.");
    return { ok: true };
  });

/**
 * ORT-03: el paciente pasó al alineador siguiente hoy (o el día indicado).
 * Atómico en la base: `aligner_current + 1`, acotado por el CHECK del total.
 */
export const advanceOrthoAligner = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), caseId: z.string().uuid(), changedOn: FECHA })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ alignerCurrent: number }> => {
    const { data: caso, error: leerError } = await context.supabase
      .from("ortho_cases")
      .select("aligner_current, aligner_total")
      .eq("id", data.caseId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (leerError) throw new Error(mensajeDb(leerError, "No pudimos leer el caso."));
    if (!caso) throw new Error("Ese caso no existe.");
    const siguiente = (caso.aligner_current ?? 0) + 1;
    if (caso.aligner_total !== null && siguiente > caso.aligner_total) {
      throw new Error("Ya va en el último alineador del plan.");
    }
    // Compara contra el valor leído: si otra persona avanzó en el medio, no
    // se salta un alineador.
    let update = context.supabase
      .from("ortho_cases")
      .update({ aligner_current: siguiente, aligner_changed_on: data.changedOn })
      .eq("id", data.caseId)
      .eq("clinic_id", data.clinicId);
    update =
      caso.aligner_current === null
        ? update.is("aligner_current", null)
        : update.eq("aligner_current", caso.aligner_current);
    const { data: fila, error } = await update.select("aligner_current").maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos registrar el cambio de alineador."));
    if (!fila)
      throw new Error(
        "No se registró el cambio: el caso cambió mientras lo editabas o tu rol no puede editarlo.",
      );
    return { alignerCurrent: fila.aligner_current ?? siguiente };
  });

export const listOrthoStages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), orthoCaseId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<OrthoStageEvent[]> => {
    const { data: rows, error } = await context.supabase
      .from("ortho_stage_events")
      .select("id, ortho_case_id, stage, started_on, notes, created_at")
      .eq("clinic_id", data.clinicId)
      .eq("ortho_case_id", data.orthoCaseId)
      .order("started_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las etapas."));
    return (rows ?? []).flatMap((r) => {
      const stage = etapaDeFila(r.stage);
      return stage
        ? [
            {
              id: r.id,
              orthoCaseId: r.ortho_case_id,
              stage,
              startedOn: r.started_on,
              notes: r.notes,
              createdAt: r.created_at,
            },
          ]
        : [];
    });
  });

/** ORT-05: el caso pasa a otra etapa. Solo se agrega; el historial no se edita. */
export const addOrthoStage = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        orthoCaseId: z.string().uuid(),
        stage: z.enum(ORTHO_STAGES),
        startedOn: FECHA,
        notes: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: inserted, error } = await context.supabase
      .from("ortho_stage_events")
      .insert({
        clinic_id: data.clinicId,
        ortho_case_id: data.orthoCaseId,
        stage: data.stage,
        started_on: data.startedOn,
        notes: data.notes || null,
      })
      .select("id")
      .single();
    if (error)
      throw new Error(
        mensajeDb(error, "No pudimos registrar la etapa. Puede que tu rol no pueda hacerlo."),
      );
    return { id: inserted.id };
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
        controlDate: FECHA,
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
