import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { requireClinicPermission, requireClinicRole } from "@/lib/access/clinic-guards.server";
import { mensajeDb } from "@/lib/db-errors";
import { ROLES_AFILIACION } from "@/lib/finance/empresas-convenio";
import { mesDe, sumarMeses } from "@/lib/finance/gastos-fijos";
import {
  PERIODOS_MEMBRESIA,
  beneficiosDesdeTexto,
  validarPlan,
  type EstadoCuota,
  type EstadoInscripcion,
} from "@/lib/finance/membresias";
import { enBloques } from "@/lib/paginacion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Membresías (Ola 10 · frente A: FIN-12, FIC-06). Sin cobro automático.
 *
 * - Planes: los administra quien ve finanzas (owner, admin, accounting); los
 *   leen además dentist y reception (la ficha muestra el plan).
 * - Inscribir, pausar o cancelar: el equipo que atiende y cobra (mismo público
 *   que la RLS: owner, admin, dentist, reception, accounting).
 * - Generar las cuotas del mes: `finance:view` (acción masiva con vista previa).
 * - Cobrar una cuota: `cash:manage` (quien cobra en caja). Anularla:
 *   `payments:reverse` (el mismo criterio que reversar un pago).
 */

type Supabase = SupabaseClient<Database>;
const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SIN_PERMISO = "No tienes permisos para administrar membresías.";

export interface PlanMembresia {
  id: string;
  name: string;
  description: string | null;
  benefits: string[];
  feeCents: number;
  currency: string;
  billingPeriod: string;
  treatmentDiscountPercent: number | null;
  active: boolean;
  inscritos: number;
}

export const listPlanesMembresia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PlanMembresia[]> => {
    const { supabase, userId } = context;
    await requireClinicRole(supabase, data.clinicId, userId, ROLES_AFILIACION, SIN_PERMISO);
    const { data: filas, error } = await supabase
      .from("membership_plans")
      .select(
        "id, name, description, benefits, fee_cents, currency, billing_period, treatment_discount_percent, active",
      )
      .eq("clinic_id", data.clinicId)
      .order("active", { ascending: false })
      .order("name")
      .limit(200);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los planes de membresía."));
    const { data: vigentes } = await supabase
      .from("patient_memberships")
      .select("plan_id")
      .eq("clinic_id", data.clinicId)
      .neq("status", "cancelled")
      .limit(1000);
    const conteo = new Map<string, number>();
    for (const v of vigentes ?? [])
      if (v.plan_id) conteo.set(v.plan_id, (conteo.get(v.plan_id) ?? 0) + 1);
    return (filas ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      benefits: f.benefits ?? [],
      feeCents: f.fee_cents,
      currency: f.currency,
      billingPeriod: f.billing_period,
      treatmentDiscountPercent:
        f.treatment_discount_percent === null ? null : Number(f.treatment_discount_percent),
      active: f.active,
      inscritos: conteo.get(f.id) ?? 0,
    }));
  });

export const savePlanMembresia = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).nullable(),
        benefitsText: z.string().max(4000),
        feeCents: z.number().int().positive(),
        billingPeriod: z.enum(PERIODOS_MEMBRESIA),
        treatmentDiscountPercent: z.number().min(0).max(100).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "finance:view", SIN_PERMISO);
    const errores = validarPlan(data);
    if (errores.length) throw new Error(errores[0]);
    const fila = {
      name: data.name,
      description: data.description || null,
      benefits: beneficiosDesdeTexto(data.benefitsText),
      fee_cents: data.feeCents,
      billing_period: data.billingPeriod,
      treatment_discount_percent: data.treatmentDiscountPercent,
    };
    const DUPLICADO = "Ya hay un plan con ese nombre.";
    if (data.id) {
      const { error } = await supabase
        .from("membership_plans")
        .update(fila)
        .eq("id", data.id)
        .eq("clinic_id", data.clinicId);
      if (error)
        throw new Error(
          error.code === "23505" ? DUPLICADO : mensajeDb(error, "No pudimos guardar el plan."),
        );
      return { id: data.id };
    }
    const { data: creado, error } = await supabase
      .from("membership_plans")
      .insert({ ...fila, clinic_id: data.clinicId, created_by: userId })
      .select("id")
      .single();
    if (error || !creado)
      throw new Error(
        error?.code === "23505" ? DUPLICADO : mensajeDb(error, "No pudimos guardar el plan."),
      );
    return { id: creado.id };
  });

export const setPlanMembresiaActivo = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), id: z.string().uuid(), active: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "finance:view", SIN_PERMISO);
    const { error } = await supabase
      .from("membership_plans")
      .update({ active: data.active })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos cambiar el plan."));
    return { ok: true };
  });

// ─── Inscripción del paciente (FIC-06) ─────────────────────────────────────

export interface CuotaMembresia {
  id: string;
  membershipId: string;
  patientId: string;
  patientName: string;
  planName: string;
  periodStart: string;
  periodEnd: string;
  amountCents: number;
  currency: string;
  status: EstadoCuota;
  paidAt: string | null;
  methodName: string | null;
  reference: string | null;
  voidReason: string | null;
}

export interface MembresiaDelPaciente {
  id: string;
  planId: string | null;
  planName: string;
  feeCents: number;
  currency: string;
  billingPeriod: string;
  startsOn: string;
  endsOn: string | null;
  status: EstadoInscripcion;
  benefits: string[];
  treatmentDiscountPercent: number | null;
  cuotas: CuotaMembresia[];
}

const COLUMNAS_CUOTA =
  "id, membership_id, patient_id, period_start, period_end, amount_cents, currency, status, paid_at, method_name_snapshot, reference, void_reason";

type FilaCuota = {
  id: string;
  membership_id: string;
  patient_id: string;
  period_start: string;
  period_end: string;
  amount_cents: number;
  currency: string;
  status: string;
  paid_at: string | null;
  method_name_snapshot: string | null;
  reference: string | null;
  void_reason: string | null;
};

function aCuota(f: FilaCuota, nombre: string, plan: string): CuotaMembresia {
  return {
    id: f.id,
    membershipId: f.membership_id,
    patientId: f.patient_id,
    patientName: nombre,
    planName: plan,
    periodStart: f.period_start,
    periodEnd: f.period_end,
    amountCents: f.amount_cents,
    currency: f.currency,
    status: f.status as EstadoCuota,
    paidAt: f.paid_at,
    methodName: f.method_name_snapshot,
    reference: f.reference,
    voidReason: f.void_reason,
  };
}

export const getMembresiaDelPaciente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<MembresiaDelPaciente | null> => {
    const { supabase, userId } = context;
    await requireClinicRole(supabase, data.clinicId, userId, ROLES_AFILIACION, SIN_PERMISO);
    const { data: m, error } = await supabase
      .from("patient_memberships")
      .select(
        "id, plan_id, plan_name_snapshot, fee_cents, currency, billing_period, starts_on, ends_on, status",
      )
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .neq("status", "cancelled")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la membresía del paciente."));
    if (!m) return null;
    const [{ data: plan }, { data: cuotas }] = await Promise.all([
      m.plan_id
        ? supabase
            .from("membership_plans")
            .select("benefits, treatment_discount_percent")
            .eq("id", m.plan_id)
            .eq("clinic_id", data.clinicId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("membership_charges")
        .select(COLUMNAS_CUOTA)
        .eq("clinic_id", data.clinicId)
        .eq("membership_id", m.id)
        .order("period_start", { ascending: false })
        .limit(12),
    ]);
    return {
      id: m.id,
      planId: m.plan_id,
      planName: m.plan_name_snapshot,
      feeCents: m.fee_cents,
      currency: m.currency,
      billingPeriod: m.billing_period,
      startsOn: m.starts_on,
      endsOn: m.ends_on,
      status: m.status as EstadoInscripcion,
      benefits: plan?.benefits ?? [],
      treatmentDiscountPercent:
        plan?.treatment_discount_percent == null ? null : Number(plan.treatment_discount_percent),
      cuotas: ((cuotas ?? []) as FilaCuota[]).map((c) => aCuota(c, "", m.plan_name_snapshot)),
    };
  });

export const inscribirEnMembresia = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        planId: z.string().uuid(),
        startsOn: DIA,
        notes: z.string().trim().max(500).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    await requireClinicRole(supabase, data.clinicId, userId, ROLES_AFILIACION, SIN_PERMISO);
    // plan_name_snapshot, fee_cents, currency y billing_period los fija la base
    // desde el plan (trigger `patient_memberships_preparar`).
    const { data: creada, error } = await supabase
      .from("patient_memberships")
      .insert({
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        plan_id: data.planId,
        starts_on: mesDe(data.startsOn),
        notes: data.notes || null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !creada)
      throw new Error(
        error?.code === "23505"
          ? "El paciente ya tiene una membresía vigente: cancélala antes de inscribirlo en otro plan."
          : mensajeDb(error, "No pudimos inscribir al paciente."),
      );
    return { id: creada.id };
  });

export const cambiarEstadoMembresia = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        id: z.string().uuid(),
        status: z.enum(["active", "paused", "cancelled"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicRole(supabase, data.clinicId, userId, ROLES_AFILIACION, SIN_PERMISO);
    const { error } = await supabase
      .from("patient_memberships")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos cambiar la membresía."));
    return { ok: true };
  });

// ─── Cuotas (FIN-12) ───────────────────────────────────────────────────────

async function nombresDePacientes(
  supabase: Supabase,
  clinicId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const nombres = new Map<string, string>();
  for (const bloque of enBloques([...new Set(ids)])) {
    const { data } = await supabase
      .from("patients")
      .select("id, full_name")
      .eq("clinic_id", clinicId)
      .in("id", bloque);
    for (const p of data ?? []) nombres.set(p.id, p.full_name);
  }
  return nombres;
}

async function planesDeInscripciones(
  supabase: Supabase,
  clinicId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const planes = new Map<string, string>();
  for (const bloque of enBloques([...new Set(ids)])) {
    const { data } = await supabase
      .from("patient_memberships")
      .select("id, plan_name_snapshot")
      .eq("clinic_id", clinicId)
      .in("id", bloque);
    for (const m of data ?? []) planes.set(m.id, m.plan_name_snapshot);
  }
  return planes;
}

/**
 * Cuotas del mes pedido más las pendientes de meses anteriores (atrasadas),
 * para la pantalla de Membresías. La ve quien cobra (`cash:manage`).
 */
export const listCuotasMembresia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid(), mes: DIA }).parse(input))
  .handler(async ({ data, context }): Promise<CuotaMembresia[]> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "cash:manage", SIN_PERMISO);
    const mes = mesDe(data.mes);
    const [{ data: delMes, error }, { data: atrasadas, error: err2 }] = await Promise.all([
      supabase
        .from("membership_charges")
        .select(COLUMNAS_CUOTA)
        .eq("clinic_id", data.clinicId)
        .eq("period_start", mes)
        .limit(1000),
      supabase
        .from("membership_charges")
        .select(COLUMNAS_CUOTA)
        .eq("clinic_id", data.clinicId)
        .eq("status", "pending")
        .lt("period_start", mes)
        .limit(1000),
    ]);
    if (error || err2)
      throw new Error(mensajeDb(error ?? err2, "No pudimos cargar las cuotas de membresía."));
    const filas = [...((atrasadas ?? []) as FilaCuota[]), ...((delMes ?? []) as FilaCuota[])];
    const [nombres, planes] = await Promise.all([
      nombresDePacientes(
        supabase,
        data.clinicId,
        filas.map((f) => f.patient_id),
      ),
      planesDeInscripciones(
        supabase,
        data.clinicId,
        filas.map((f) => f.membership_id),
      ),
    ]);
    return filas
      .map((f) => aCuota(f, nombres.get(f.patient_id) ?? "—", planes.get(f.membership_id) ?? "—"))
      .sort(
        (a, b) =>
          a.periodStart.localeCompare(b.periodStart) || a.patientName.localeCompare(b.patientName),
      );
  });

export interface CuotaPorGenerar {
  membershipId: string;
  patientId: string;
  patientName: string;
  amountCents: number;
  periodStart: string;
  periodEnd: string;
}

/** Vista previa: qué cuotas crearía "Generar cuotas" para el mes (no escribe). */
export const previsualizarCuotasMembresia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid(), mes: DIA }).parse(input))
  .handler(async ({ data, context }): Promise<CuotaPorGenerar[]> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "finance:view", SIN_PERMISO);
    const { data: filas, error } = await supabase
      .rpc("generar_cuotas_de_membresia", {
        p_clinic_id: data.clinicId,
        p_periodo: mesDe(data.mes),
        p_confirmar: false,
      })
      .limit(1000);
    if (error) throw new Error(mensajeDb(error, "No pudimos calcular las cuotas del mes."));
    const nombres = await nombresDePacientes(
      supabase,
      data.clinicId,
      (filas ?? []).map((f) => f.patient_id),
    );
    return (filas ?? []).map((f) => ({
      membershipId: f.membership_id,
      patientId: f.patient_id,
      patientName: nombres.get(f.patient_id) ?? "—",
      amountCents: Number(f.amount_cents),
      periodStart: f.period_start,
      periodEnd: f.period_end,
    }));
  });

/** Crea las cuotas del mes (idempotente). Devuelve cuántas creó. */
export const generarCuotasMembresia = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid(), mes: DIA }).parse(input))
  .handler(async ({ data, context }): Promise<{ creadas: number }> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "finance:view", SIN_PERMISO);
    const { data: filas, error } = await supabase.rpc("generar_cuotas_de_membresia", {
      p_clinic_id: data.clinicId,
      p_periodo: mesDe(data.mes),
      p_confirmar: true,
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos generar las cuotas del mes."));
    return { creadas: (filas ?? []).length };
  });

/** Registra que una persona cobró la cuota (no crea un pago de tratamiento). */
export const cobrarCuotaMembresia = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        id: z.string().uuid(),
        paymentMethodId: z.string().uuid().nullable(),
        reference: z.string().trim().max(120).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(
      supabase,
      data.clinicId,
      userId,
      "cash:manage",
      "No tienes permisos para cobrar.",
    );
    let medio: string | null = null;
    if (data.paymentMethodId) {
      const { data: pm } = await supabase
        .from("payment_methods")
        .select("name")
        .eq("id", data.paymentMethodId)
        .eq("clinic_id", data.clinicId)
        .maybeSingle();
      if (!pm) throw new Error("Ese medio de pago no existe en esta clínica.");
      medio = pm.name;
    }
    const { data: fila, error } = await supabase
      .from("membership_charges")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_method_id: data.paymentMethodId,
        method_name_snapshot: medio,
        reference: data.reference || null,
      })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos registrar el cobro."));
    if (!fila) throw new Error("Esa cuota ya no está por cobrar: recarga la lista.");
    return { ok: true };
  });

export const anularCuotaMembresia = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        id: z.string().uuid(),
        reason: z.string().trim().min(3).max(300),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(
      supabase,
      data.clinicId,
      userId,
      "payments:reverse",
      "No tienes permisos para anular cuotas.",
    );
    const { error } = await supabase
      .from("membership_charges")
      .update({ status: "void", void_reason: data.reason, voided_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos anular la cuota."));
    return { ok: true };
  });

/** Meses para el selector: los 6 anteriores, el actual y el siguiente. */
export function mesesParaSelector(mesActual: string): string[] {
  const base = mesDe(mesActual);
  return Array.from({ length: 8 }, (_, i) => sumarMeses(base, i - 6)).reverse();
}
