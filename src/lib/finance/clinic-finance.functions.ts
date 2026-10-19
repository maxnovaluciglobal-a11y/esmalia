import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { mensajeDb } from "@/lib/db-errors";
import type {
  Agreement,
  AgreementCoverage,
  Expense,
  PaymentMethodConfig,
} from "@/lib/finance/finance";
import { throwIfTrialBlocksInformes } from "@/lib/finance/finance-reports.functions";
import { writePatientFields } from "@/lib/patients/patients.functions";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Medios de pago configurables por clínica y módulo de gastos (Tanda B).
 *
 * Viven acá y no en `finance.functions.ts` porque ese archivo ya concentra
 * arancel, presupuestos, planes y pagos; estos dos son configuración y
 * contabilidad de la clínica, no del paciente.
 */

// ─── MEDIOS DE PAGO ──────────────────────────────────────────────────────

const PAYMENT_METHOD_COLUMNS =
  "id, name, retention_pct, allows_refund, is_active, position, legacy_key";

type PaymentMethodRow = {
  id: string;
  name: string;
  retention_pct: number;
  allows_refund: boolean;
  is_active: boolean;
  position: number;
  legacy_key: string | null;
};

function mapPaymentMethod(row: PaymentMethodRow): PaymentMethodConfig {
  return {
    id: row.id,
    name: row.name,
    // `numeric` de Postgres llega como string por PostgREST en algunos casos;
    // Number() lo normaliza y un NaN cae a 0 en vez de romper el cálculo.
    retentionPct: Number(row.retention_pct) || 0,
    allowsRefund: row.allows_refund,
    isActive: row.is_active,
    position: row.position,
    legacyKey: row.legacy_key as PaymentMethodConfig["legacyKey"],
  };
}

export const listPaymentMethods = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        /** La pantalla de configuración necesita ver los deshabilitados. */
        incluirInactivos: z.boolean().default(false),
        /**
         * Revisión final de rama (Critical #1): el gate de trial de Task 11
         * se filtraba a callers operativos que no son un "informe" —
         * `finance-section.tsx` en `/pacientes/:id` (diálogo de pago) llama
         * esta misma función, y `/pacientes/:id` está en `ABIERTO_SIEMPRE`
         * (regla no-negociable #3, nunca se gatea). Como nadie capturaba el
         * error ahí, el fallo era silencioso: la lista vacía hacía caer el
         * diálogo al `<select>` legacy y `registerPayment` recibía
         * `paymentMethodId: undefined`, omitiendo la retención sin avisar.
         *
         * Por eso el gate ahora es opt-in: solo la pantalla de INFORME
         * (`/medios-de-pago`) pasa `paraInforme: true`. Sin este flag la
         * función se comporta como antes de Task 11 — sin gate — que es lo
         * correcto para un caller operativo.
         */
        paraInforme: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PaymentMethodConfig[]> => {
    // Task 11, fix round 1 (Important #2) + revisión final (Critical #1):
    // esta función solo tenía `requireSupabaseAuth` + RLS — sin chequeo de
    // rol propio, así que no pasa por `requireFinanceView` (cambiaría a
    // quién le permite llamarla). El gate de trial solo se aplica cuando el
    // caller es la pantalla de informe (ver `paraInforme` arriba) — el par
    // en el servidor de regla 15 ahora es este flag explícito, no un gate
    // incondicional en la función compartida.
    if (data.paraInforme) await throwIfTrialBlocksInformes(context.supabase, data.clinicId);

    let query = context.supabase
      .from("payment_methods")
      .select(PAYMENT_METHOD_COLUMNS)
      .eq("clinic_id", data.clinicId);
    if (!data.incluirInactivos) query = query.eq("is_active", true);

    const { data: rows, error } = await query
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los medios de pago."));
    return (rows ?? []).map((r) => mapPaymentMethod(r as PaymentMethodRow));
  });

const PaymentMethodFields = {
  name: z.string().trim().min(1, "El nombre es obligatorio."),
  retentionPct: z.number().min(0).max(100).default(0),
  allowsRefund: z.boolean().default(false),
  position: z.number().int().min(0).max(999).default(0),
};

export const createPaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), ...PaymentMethodFields }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: inserted, error } = await context.supabase
      .from("payment_methods")
      .insert({
        clinic_id: data.clinicId,
        name: data.name,
        retention_pct: data.retentionPct,
        allows_refund: data.allowsRefund,
        position: data.position,
      })
      .select("id")
      .single();
    if (error) {
      // 23505 = unique_violation sobre (clinic_id, name).
      if (error.code === "23505")
        throw new Error(`Ya existe un medio de pago llamado "${data.name}".`);
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda configurar los medios de pago.",
        ),
      );
    }
    return { id: inserted.id };
  });

export const updatePaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        paymentMethodId: z.string().uuid(),
        ...PaymentMethodFields,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("payment_methods")
      .update({
        name: data.name,
        retention_pct: data.retentionPct,
        allows_refund: data.allowsRefund,
        position: data.position,
      })
      .eq("id", data.paymentMethodId)
      .eq("clinic_id", data.clinicId);
    if (error) {
      if (error.code === "23505")
        throw new Error(`Ya existe un medio de pago llamado "${data.name}".`);
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda configurar los medios de pago.",
        ),
      );
    }
    return { ok: true };
  });

/**
 * Deshabilita o rehabilita un medio de pago. No se borra: los pagos
 * históricos lo referencian, y aunque `method_name_snapshot` protege el
 * recibo, borrarlo pierde el vínculo con lo ya cobrado.
 */
export const setPaymentMethodActive = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        paymentMethodId: z.string().uuid(),
        isActive: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("payment_methods")
      .update({ is_active: data.isActive })
      .eq("id", data.paymentMethodId)
      .eq("clinic_id", data.clinicId);
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda configurar los medios de pago.",
        ),
      );
    return { ok: true };
  });

// ─── GASTOS ──────────────────────────────────────────────────────────────

const EXPENSE_COLUMNS =
  "id, branch_id, category, description, supplier, amount_cents, currency, payment_method_id, method_name_snapshot, incurred_on, notes, created_at";

type ExpenseRow = {
  id: string;
  branch_id: string | null;
  category: string;
  description: string;
  supplier: string | null;
  amount_cents: number;
  currency: string;
  payment_method_id: string | null;
  method_name_snapshot: string | null;
  incurred_on: string;
  notes: string | null;
  created_at: string;
};

function mapExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    branchId: row.branch_id,
    category: row.category,
    description: row.description,
    supplier: row.supplier,
    amountCents: row.amount_cents,
    currency: row.currency,
    paymentMethodId: row.payment_method_id,
    methodNameSnapshot: row.method_name_snapshot,
    incurredOn: row.incurred_on,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

/**
 * Gastos del período. `desde`/`hasta` se comparan contra `incurred_on`, que es
 * un `date`: la comparación es de día calendario y no arrastra el problema de
 * timezone que sí tienen los reportes que filtran por `timestamptz`.
 */
export const listExpenses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<Expense[]> => {
    // Task 11, fix round 1 (Important #2): ídem `listPaymentMethods` — sin
    // chequeo de rol propio, se le agrega solo la capa de trial.
    await throwIfTrialBlocksInformes(context.supabase, data.clinicId);

    const { data: rows, error } = await context.supabase
      .from("expenses")
      .select(EXPENSE_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .gte("incurred_on", data.desde)
      .lte("incurred_on", data.hasta)
      .order("incurred_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los gastos del período."));
    return (rows ?? []).map((r) => mapExpense(r as ExpenseRow));
  });

const ExpenseFields = {
  // Sin `currency`: la fija el trigger `moneda_desde_la_clinica` desde
  // `clinics.currency`. En qué moneda está una fila no lo decide el cliente.
  branchId: z.string().uuid().nullish(),
  category: z.string().trim().min(1, "La categoría es obligatoria.").max(80),
  description: z.string().trim().min(1, "La descripción es obligatoria.").max(300),
  supplier: z.string().trim().max(120).nullish(),
  amountCents: z.number().int().positive("El monto tiene que ser mayor a cero."),
  paymentMethodId: z.string().uuid().nullish(),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  notes: z.string().trim().max(500).nullish(),
};

/**
 * Resuelve el nombre del medio de pago para congelarlo en el gasto (regla 10):
 * renombrar "Transferencia" a "Transferencia bancaria" no puede reescribir un
 * comprobante ya cargado.
 */
async function snapshotMedioDePago(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  paymentMethodId: string | null | undefined,
): Promise<string | null> {
  if (!paymentMethodId) return null;
  const { data } = await supabase
    .from("payment_methods")
    .select("name")
    .eq("id", paymentMethodId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  return data?.name ?? null;
}

export const createExpense = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), ...ExpenseFields }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase } = context;
    const methodName = await snapshotMedioDePago(supabase, data.clinicId, data.paymentMethodId);

    const { data: inserted, error } = await supabase
      .from("expenses")
      .insert({
        clinic_id: data.clinicId,
        branch_id: data.branchId ?? null,
        category: data.category,
        description: data.description,
        supplier: data.supplier?.trim() || null,
        amount_cents: data.amountCents,
        payment_method_id: data.paymentMethodId ?? null,
        method_name_snapshot: methodName,
        incurred_on: data.incurredOn,
        notes: data.notes?.trim() || null,
      })
      .select("id")
      .single();
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda registrar gastos.",
        ),
      );
    return { id: inserted.id };
  });

export const updateExpense = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), expenseId: z.string().uuid(), ...ExpenseFields })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase } = context;
    const methodName = await snapshotMedioDePago(supabase, data.clinicId, data.paymentMethodId);

    const { error } = await supabase
      .from("expenses")
      .update({
        branch_id: data.branchId ?? null,
        category: data.category,
        description: data.description,
        supplier: data.supplier?.trim() || null,
        amount_cents: data.amountCents,
        payment_method_id: data.paymentMethodId ?? null,
        method_name_snapshot: methodName,
        incurred_on: data.incurredOn,
        notes: data.notes?.trim() || null,
      })
      .eq("id", data.expenseId)
      .eq("clinic_id", data.clinicId);
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda editar gastos.",
        ),
      );
    return { ok: true };
  });

/**
 * A diferencia de casi todo el resto del sistema, un gasto SÍ se borra: no es
 * un evento clínico ni un cobro al paciente, es un asiento de la clínica que
 * puede haberse cargado por error y no tiene contraparte externa que proteger.
 */
export const deleteExpense = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), expenseId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("expenses")
      .delete()
      .eq("id", data.expenseId)
      .eq("clinic_id", data.clinicId);
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda borrar gastos.",
        ),
      );
    return { ok: true };
  });

// ─── CONVENIOS Y COBERTURA ───────────────────────────────────────────────

const AGREEMENT_COLUMNS =
  "id, name, kind, contact_name, contact_phone, contact_email, notes, is_active";

type AgreementRow = {
  id: string;
  name: string;
  kind: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  notes: string | null;
  is_active: boolean;
};

function mapAgreement(row: AgreementRow): Agreement {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    notes: row.notes,
    isActive: row.is_active,
  };
}

export const listAgreements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        incluirInactivos: z.boolean().default(false),
        /**
         * Revisión final de rama (Critical #1): mismo problema que
         * `listPaymentMethods` — `pacientes.$pacienteId.tsx` (selector de
         * convenio en la ficha, `ABIERTO_SIEMPRE`) llama esta función. Solo
         * `/convenios` (la pantalla de INFORME) pasa `paraInforme: true`.
         */
        paraInforme: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<Agreement[]> => {
    // Task 11, fix round 1 (Important #2) + revisión final (Critical #1):
    // ídem `listPaymentMethods` — sin chequeo de rol propio, el gate de
    // trial solo se aplica cuando el caller es la pantalla de informe.
    if (data.paraInforme) await throwIfTrialBlocksInformes(context.supabase, data.clinicId);

    let query = context.supabase
      .from("agreements")
      .select(AGREEMENT_COLUMNS)
      .eq("clinic_id", data.clinicId);
    if (!data.incluirInactivos) query = query.eq("is_active", true);

    const { data: rows, error } = await query.order("name", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los convenios."));
    return (rows ?? []).map((r) => mapAgreement(r as AgreementRow));
  });

const AgreementFields = {
  name: z.string().trim().min(1, "El nombre del convenio es obligatorio."),
  kind: z.string().trim().max(60).nullish(),
  contactName: z.string().trim().max(120).nullish(),
  contactPhone: z.string().trim().max(40).nullish(),
  contactEmail: z.string().trim().max(160).nullish(),
  notes: z.string().trim().max(1000).nullish(),
};

function agreementRow(d: {
  name: string;
  kind?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
}) {
  return {
    name: d.name,
    kind: d.kind?.trim() || null,
    contact_name: d.contactName?.trim() || null,
    contact_phone: d.contactPhone?.trim() || null,
    contact_email: d.contactEmail?.trim() || null,
    notes: d.notes?.trim() || null,
  };
}

export const createAgreement = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), ...AgreementFields }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: inserted, error } = await context.supabase
      .from("agreements")
      .insert({ clinic_id: data.clinicId, ...agreementRow(data) })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error(`Ya existe un convenio llamado "${data.name}".`);
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda configurar convenios.",
        ),
      );
    }
    return { id: inserted.id };
  });

export const updateAgreement = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        agreementId: z.string().uuid(),
        ...AgreementFields,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("agreements")
      .update(agreementRow(data))
      .eq("id", data.agreementId)
      .eq("clinic_id", data.clinicId);
    if (error) {
      if (error.code === "23505") throw new Error(`Ya existe un convenio llamado "${data.name}".`);
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda configurar convenios.",
        ),
      );
    }
    return { ok: true };
  });

export const setAgreementActive = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        agreementId: z.string().uuid(),
        isActive: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("agreements")
      .update({ is_active: data.isActive })
      .eq("id", data.agreementId)
      .eq("clinic_id", data.clinicId);
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda configurar convenios.",
        ),
      );
    return { ok: true };
  });

/** Cobertura de un convenio, prestación por prestación. */
export const listAgreementCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), agreementId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<AgreementCoverage[]> => {
    const { data: rows, error } = await context.supabase
      .from("agreement_coverage")
      .select("id, agreement_id, procedure_id, coverage_pct, coverage_fixed_cents")
      .eq("clinic_id", data.clinicId)
      .eq("agreement_id", data.agreementId);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la cobertura del convenio."));
    return (rows ?? []).map((r) => ({
      id: r.id,
      agreementId: r.agreement_id,
      procedureId: r.procedure_id,
      coveragePct: r.coverage_pct === null ? null : Number(r.coverage_pct),
      coverageFixedCents: r.coverage_fixed_cents,
    }));
  });

/**
 * Define (o quita) la cobertura de una prestación en un convenio.
 *
 * Pasar ambas formas en `null` BORRA la fila en vez de guardar una cobertura
 * vacía: una prestación sin cobertura definida es una que el convenio no
 * cubre, y eso se representa con la ausencia de fila, no con ceros que después
 * hay que interpretar.
 */
export const setAgreementCoverage = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        agreementId: z.string().uuid(),
        procedureId: z.string().uuid(),
        coveragePct: z.number().min(0).max(100).nullish(),
        coverageFixedCents: z.number().int().min(0).nullish(),
      })
      .refine(
        (v) =>
          !(
            v.coveragePct !== null &&
            v.coveragePct !== undefined &&
            v.coverageFixedCents !== null &&
            v.coverageFixedCents !== undefined
          ),
        "Elige porcentaje o monto fijo, no las dos cosas.",
      )
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase } = context;
    const pct = data.coveragePct ?? null;
    const fijo = data.coverageFixedCents ?? null;

    if (pct === null && fijo === null) {
      const { error } = await supabase
        .from("agreement_coverage")
        .delete()
        .eq("clinic_id", data.clinicId)
        .eq("agreement_id", data.agreementId)
        .eq("procedure_id", data.procedureId);
      if (error)
        throw new Error(
          mensajeDb(
            error,
            "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda editar la cobertura.",
          ),
        );
      return { ok: true };
    }

    const { error } = await supabase.from("agreement_coverage").upsert(
      {
        clinic_id: data.clinicId,
        agreement_id: data.agreementId,
        procedure_id: data.procedureId,
        coverage_pct: pct,
        coverage_fixed_cents: fijo,
      },
      { onConflict: "agreement_id,procedure_id" },
    );
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda editar la cobertura.",
        ),
      );
    return { ok: true };
  });

/** Asigna (o quita) el convenio de un paciente. */
export const setPatientAgreement = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        agreementId: z.string().uuid().nullish(),
        memberId: z.string().trim().max(60).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await writePatientFields(context.supabase, data.clinicId, data.patientId, {
      agreement_id: data.agreementId ?? null,
      agreement_member_id: data.memberId?.trim() || null,
    });
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda editar el paciente.",
        ),
      );
    return { ok: true };
  });
