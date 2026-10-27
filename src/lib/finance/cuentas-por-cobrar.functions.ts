import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { tienePermisoEnClinica } from "@/lib/access/clinic-guards.server";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { mensajeDb } from "@/lib/db-errors";
import {
  MAX_CUOTAS,
  armarCuentas,
  esDiaIso,
  validarCuotas,
  type CuentaPorCobrar,
  type FilaCuenta,
  type FilaCuota,
  type FilaPagado,
} from "@/lib/finance/cuentas-por-cobrar";
import { requireFinanceView } from "@/lib/finance/finance-reports.functions";
import { enBloques, leerTodasLasPaginas } from "@/lib/paginacion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Cuentas por cobrar (Ola 3 · Frente Cobros: FIN-02, FIN-03, PLA-07).
 *
 * Lecturas:
 * - `listCuentasPorCobrar`: la cartera de toda la clínica para `/cuentas-por-cobrar`.
 *   Par en el servidor de `requirePermission("finance:view")` (regla 15) con el
 *   mismo gate que Morosidad (`requireFinanceView`: rol + suscripción).
 * - `listCuentasDelPaciente`: las del paciente para su ficha. Como
 *   `listPayments`, solo RLS: la ve quien ve los pagos del paciente (todos los
 *   roles menos assistant, regla 2).
 *
 * Todo lo que es dinero agregado se lee de a páginas (`leerTodasLasPaginas`) y
 * lo pagado sale de `receivable_paid_totals`, en SQL: nada se corta en
 * silencio en `max_rows`.
 */

type Supabase = SupabaseClient<Database>;

const COLUMNAS_CUENTA =
  "id, patient_id, quote_id, treatment_plan_id, description, amount_cents, currency, issued_on, due_on, voided_at, void_reason, created_at";
const COLUMNAS_CUOTA = "id, receivable_id, number, due_on, amount_cents";

const ERROR_LECTURA = "No pudimos cargar las cuentas por cobrar.";

/** Hoy en la zona horaria de la clínica (regla 7), no el día UTC del servidor. */
async function hoyDeLaClinica(supabase: Supabase, clinicId: string): Promise<string> {
  const { data } = await supabase
    .from("clinics")
    .select("timezone")
    .eq("id", clinicId)
    .maybeSingle();
  return hoyISO(data?.timezone || "America/Santiago");
}

async function leerCuotas(
  supabase: Supabase,
  clinicId: string,
  idsCuentas: string[] | null,
): Promise<FilaCuota[]> {
  if (idsCuentas) {
    const filas: FilaCuota[] = [];
    for (const bloque of enBloques(idsCuentas)) {
      const { filas: parte, error } = await leerTodasLasPaginas<FilaCuota>((desde, hasta) =>
        supabase
          .from("receivable_installments")
          .select(COLUMNAS_CUOTA)
          .eq("clinic_id", clinicId)
          .in("receivable_id", bloque)
          .order("id")
          .range(desde, hasta),
      );
      if (error) throw new Error(mensajeDb(error, ERROR_LECTURA));
      filas.push(...parte);
    }
    return filas;
  }
  const { filas, error } = await leerTodasLasPaginas<FilaCuota>((desde, hasta) =>
    supabase
      .from("receivable_installments")
      .select(COLUMNAS_CUOTA)
      .eq("clinic_id", clinicId)
      .order("id")
      .range(desde, hasta),
  );
  if (error) throw new Error(mensajeDb(error, ERROR_LECTURA));
  return filas;
}

async function leerPagados(
  supabase: Supabase,
  clinicId: string,
  idsCuentas: string[] | null,
): Promise<FilaPagado[]> {
  const bloques = idsCuentas ? enBloques(idsCuentas) : [null];
  const filas: FilaPagado[] = [];
  for (const bloque of bloques) {
    const { filas: parte, error } = await leerTodasLasPaginas<FilaPagado>((desde, hasta) =>
      supabase
        .rpc("receivable_paid_totals", {
          p_clinic_id: clinicId,
          ...(bloque ? { p_receivable_ids: bloque } : {}),
        })
        .order("receivable_id")
        .range(desde, hasta),
    );
    if (error) throw new Error(mensajeDb(error, ERROR_LECTURA));
    filas.push(...parte);
  }
  return filas;
}

async function leerNombres(
  supabase: Supabase,
  clinicId: string,
  idsPacientes: string[],
): Promise<Map<string, string>> {
  const nombres = new Map<string, string>();
  for (const bloque of enBloques(idsPacientes)) {
    const { data, error } = await supabase
      .from("patients")
      .select("id, full_name")
      .eq("clinic_id", clinicId)
      .in("id", bloque);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los pacientes."));
    for (const p of data ?? []) nombres.set(p.id, p.full_name);
  }
  return nombres;
}

/** Cartera de la clínica: todas las cuentas (también pagadas y anuladas). */
export const listCuentasPorCobrar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ cuentas: CuentaPorCobrar[]; hoy: string }> => {
    const { supabase, userId } = context;
    await requireFinanceView(supabase, data.clinicId, userId);

    const hoy = await hoyDeLaClinica(supabase, data.clinicId);
    const { filas, error } = await leerTodasLasPaginas<FilaCuenta>((desde, hasta) =>
      supabase
        .from("receivables")
        .select(COLUMNAS_CUENTA)
        .eq("clinic_id", data.clinicId)
        .order("issued_on", { ascending: false })
        .order("id")
        .range(desde, hasta),
    );
    if (error) throw new Error(mensajeDb(error, ERROR_LECTURA));

    const [cuotas, pagados, nombres] = await Promise.all([
      leerCuotas(supabase, data.clinicId, null),
      leerPagados(supabase, data.clinicId, null),
      leerNombres(supabase, data.clinicId, [...new Set(filas.map((f) => f.patient_id))]),
    ]);
    return { cuentas: armarCuentas(filas, cuotas, pagados, nombres, hoy), hoy };
  });

/** Cuentas de un paciente, para su ficha. */
export const listCuentasDelPaciente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ cuentas: CuentaPorCobrar[]; hoy: string }> => {
    const { supabase } = context;
    const hoy = await hoyDeLaClinica(supabase, data.clinicId);
    const { data: filas, error } = await supabase
      .from("receivables")
      .select(COLUMNAS_CUENTA)
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .order("issued_on", { ascending: false })
      .order("id");
    if (error) throw new Error(mensajeDb(error, ERROR_LECTURA));
    const cuentasFilas = (filas ?? []) as FilaCuenta[];
    if (cuentasFilas.length === 0) return { cuentas: [], hoy };

    const ids = cuentasFilas.map((f) => f.id);
    const [cuotas, pagados] = await Promise.all([
      leerCuotas(supabase, data.clinicId, ids),
      leerPagados(supabase, data.clinicId, ids),
    ]);
    // El nombre no hace falta en la ficha: es la del propio paciente.
    return { cuentas: armarCuentas(cuentasFilas, cuotas, pagados, new Map(), hoy), hoy };
  });

/**
 * Crea la cuenta por cobrar de un plan de tratamiento que no tiene una (los
 * planes anteriores a PLA-07, o el de un presupuesto cuya cuenta se anuló).
 * El monto es la parte del paciente de las líneas del plan, la misma fórmula
 * del saldo (`patient_cents ?? price_cents`).
 */
export const crearCuentaDesdePlan = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        planId: z.string().uuid(),
        dueOn: z.string().refine(esDiaIso, "Fecha de vencimiento inválida.").nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase } = context;
    const { data: plan, error: errPlan } = await supabase
      .from("treatment_plans")
      .select("id, patient_id, name, status")
      .eq("id", data.planId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (errPlan) throw new Error(mensajeDb(errPlan, "No pudimos leer el plan."));
    if (!plan) throw new Error("Ese plan no existe.");
    if (plan.status === "cancelled")
      throw new Error("El plan está cancelado: no genera deuda que cobrar.");

    const { data: items, error: errItems } = await supabase
      .from("treatment_items")
      .select("price_cents, patient_cents")
      .eq("clinic_id", data.clinicId)
      .eq("plan_id", data.planId);
    if (errItems) throw new Error(mensajeDb(errItems, "No pudimos leer el plan."));
    // `??`: con convenio, `patient_cents` = 0 es real (regla 12).
    const monto = (items ?? []).reduce((s, it) => s + (it.patient_cents ?? it.price_cents), 0);
    if (monto <= 0) throw new Error("Este plan no tiene nada que cobrarle al paciente.");

    const hoy = await hoyDeLaClinica(supabase, data.clinicId);
    const { data: creada, error } = await supabase
      .from("receivables")
      .insert({
        clinic_id: data.clinicId,
        patient_id: plan.patient_id,
        treatment_plan_id: plan.id,
        description: plan.name.slice(0, 200),
        amount_cents: monto,
        issued_on: hoy,
        due_on: data.dueOn ?? null,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("Ese plan ya tiene una cuenta por cobrar.");
      throw new Error(
        mensajeDb(error, "No pudimos crear la cuenta. Puede que tu rol no pueda hacerlo."),
      );
    }
    return { id: creada.id };
  });

/**
 * Plan de pago de una cuenta (FIN-03): N cuotas con fecha, o ninguna y un
 * vencimiento único (opcional). Las cuotas reemplazan a las anteriores; lo ya
 * pagado se vuelve a imputar solo, a la cuota más antigua.
 */
export const definirPlanDePago = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        receivableId: z.string().uuid(),
        /** Vencimiento de la cuenta entera. Solo aplica sin cuotas. */
        dueOn: z.string().refine(esDiaIso, "Fecha de vencimiento inválida.").nullish(),
        cuotas: z
          .array(
            z.object({
              dueOn: z.string().refine(esDiaIso, "Fecha de cuota inválida."),
              amountCents: z.number().int().positive("Cada cuota tiene que ser mayor que cero."),
            }),
          )
          .max(MAX_CUOTAS),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase } = context;
    const { data: cuenta, error: errCuenta } = await supabase
      .from("receivables")
      .select("id, amount_cents, voided_at")
      .eq("id", data.receivableId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (errCuenta) throw new Error(mensajeDb(errCuenta, "No pudimos leer la cuenta."));
    if (!cuenta) throw new Error("Esa cuenta por cobrar no existe.");
    if (cuenta.voided_at) throw new Error("La cuenta está anulada.");

    // Las cuotas se numeran por fecha: la 1 es la primera que vence.
    const cuotas = [...data.cuotas].sort((a, b) =>
      a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0,
    );
    const motivo = validarCuotas(cuotas, cuenta.amount_cents);
    if (motivo) throw new Error(motivo);

    const { error: errVence } = await supabase
      .from("receivables")
      .update({ due_on: cuotas.length > 0 ? null : (data.dueOn ?? null) })
      .eq("id", data.receivableId)
      .eq("clinic_id", data.clinicId);
    if (errVence) throw new Error(mensajeDb(errVence, "No pudimos guardar el vencimiento."));

    const { error } = await supabase.rpc("definir_cuotas", {
      p_receivable_id: data.receivableId,
      p_cuotas: cuotas.map((c) => ({ due_on: c.dueOn, amount_cents: c.amountCents })),
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos guardar las cuotas."));
    return { ok: true };
  });

/**
 * Anula una cuenta (FIN-02). No la borra: queda con quién, cuándo y por qué,
 * y deja de contar como deuda en la cartera. Los pagos que tenía no se tocan
 * (si hay que devolver plata, se reversan aparte). Mismo permiso que reversar
 * un pago: deshacer deuda es de quien audita las finanzas.
 */
export const anularCuenta = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        receivableId: z.string().uuid(),
        reason: z.string().trim().min(3, "Cuenta por qué se anula.").max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const puede = await tienePermisoEnClinica(supabase, data.clinicId, userId, "payments:reverse");
    if (!puede) throw new Error("No tienes permisos para anular cuentas por cobrar.");

    const { data: anuladas, error } = await supabase
      .from("receivables")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: userId,
        void_reason: data.reason,
      })
      .eq("id", data.receivableId)
      .eq("clinic_id", data.clinicId)
      .is("voided_at", null)
      .select("id");
    if (error) throw new Error(mensajeDb(error, "No pudimos anular la cuenta."));
    if (!anuladas?.length) throw new Error("Esa cuenta no existe o ya estaba anulada.");
    return { ok: true };
  });
