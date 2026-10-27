import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { mensajeDb } from "@/lib/db-errors";
import { requireFinanceView } from "@/lib/finance/finance-reports.functions";
import {
  gastosFijosDelMes,
  mesDe,
  validarGastoFijo,
  type GastoConfirmado,
  type GastoFijo,
  type GastoFijoDelMes,
} from "@/lib/finance/gastos-fijos";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Gastos fijos (Ola 10 · frente A: FIN-09).
 *
 * Mismo público que Gastos: `finance:view` (owner, admin, accounting) en el
 * servidor (regla 15) y en la RLS de `recurring_expenses` y `expenses`. Nada
 * se genera solo: `confirmarGastosFijos` crea los del mes que una persona
 * eligió, con el monto que confirmó, y la base no repite un mes ya cargado.
 */

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SIN_PERMISO = "No tienes permisos para ver ni cargar gastos.";

const COLUMNAS =
  "id, category, description, supplier, amount_cents, currency, payment_method_id, branch_id, day_of_month, starts_on, ends_on, active, notes";

type FilaGastoFijo = {
  id: string;
  category: string;
  description: string;
  supplier: string | null;
  amount_cents: number;
  currency: string;
  payment_method_id: string | null;
  branch_id: string | null;
  day_of_month: number;
  starts_on: string;
  ends_on: string | null;
  active: boolean;
  notes: string | null;
};

function aGastoFijo(f: FilaGastoFijo): GastoFijo {
  return {
    id: f.id,
    category: f.category,
    description: f.description,
    supplier: f.supplier,
    amountCents: f.amount_cents,
    currency: f.currency,
    paymentMethodId: f.payment_method_id,
    branchId: f.branch_id,
    dayOfMonth: f.day_of_month,
    startsOn: f.starts_on,
    endsOn: f.ends_on,
    active: f.active,
    notes: f.notes,
  };
}

export interface GastosFijosDelMes {
  mes: string;
  plantillas: GastoFijo[];
  delMes: GastoFijoDelMes[];
}

/** Plantillas de la clínica y el estado de cada una en el mes pedido. */
export const getGastosFijos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid(), mes: DIA }).parse(input))
  .handler(async ({ data, context }): Promise<GastosFijosDelMes> => {
    const { supabase, userId } = context;
    await requireFinanceView(supabase, data.clinicId, userId);
    const mes = mesDe(data.mes);

    const { data: filas, error } = await supabase
      .from("recurring_expenses")
      .select(COLUMNAS)
      .eq("clinic_id", data.clinicId)
      .order("day_of_month")
      .order("description")
      .limit(500);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los gastos fijos."));

    const { data: confirmados, error: errConf } = await supabase
      .from("expenses")
      .select("id, recurring_expense_id, amount_cents, incurred_on")
      .eq("clinic_id", data.clinicId)
      .eq("recurring_period", mes)
      .not("recurring_expense_id", "is", null)
      .limit(500);
    if (errConf) throw new Error(mensajeDb(errConf, "No pudimos cargar los gastos del mes."));

    const plantillas = ((filas ?? []) as FilaGastoFijo[]).map(aGastoFijo);
    const conf: GastoConfirmado[] = (confirmados ?? []).map((c) => ({
      id: c.id,
      recurringExpenseId: c.recurring_expense_id as string,
      amountCents: c.amount_cents,
      incurredOn: c.incurred_on,
    }));
    return { mes, plantillas, delMes: gastosFijosDelMes(plantillas, conf, mes) };
  });

const EntradaGastoFijo = z.object({
  clinicId: z.string().uuid(),
  id: z.string().uuid().optional(),
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(200),
  supplier: z.string().trim().max(120).nullable(),
  amountCents: z.number().int().positive(),
  paymentMethodId: z.string().uuid().nullable(),
  branchId: z.string().uuid().nullable(),
  dayOfMonth: z.number().int().min(1).max(28),
  startsOn: DIA,
  endsOn: DIA.nullable(),
  notes: z.string().trim().max(500).nullable(),
});

/** Crea o edita una plantilla. Editarla no cambia los gastos ya confirmados. */
export const saveGastoFijo = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => EntradaGastoFijo.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "finance:view", SIN_PERMISO);
    const errores = validarGastoFijo(data);
    if (errores.length) throw new Error(errores[0]);

    const fila = {
      category: data.category,
      description: data.description,
      supplier: data.supplier || null,
      amount_cents: data.amountCents,
      payment_method_id: data.paymentMethodId,
      branch_id: data.branchId,
      day_of_month: data.dayOfMonth,
      starts_on: mesDe(data.startsOn),
      ends_on: data.endsOn ? mesDe(data.endsOn) : null,
      notes: data.notes || null,
    };
    if (data.id) {
      const { error } = await supabase
        .from("recurring_expenses")
        .update(fila)
        .eq("id", data.id)
        .eq("clinic_id", data.clinicId);
      if (error) throw new Error(mensajeDb(error, "No pudimos guardar el gasto fijo."));
      return { id: data.id };
    }
    const { data: creado, error } = await supabase
      .from("recurring_expenses")
      .insert({ ...fila, clinic_id: data.clinicId, created_by: userId })
      .select("id")
      .single();
    if (error || !creado) throw new Error(mensajeDb(error, "No pudimos guardar el gasto fijo."));
    return { id: creado.id };
  });

/** Pausa o reanuda una plantilla (no se borra: los gastos confirmados la nombran). */
export const setGastoFijoActivo = createServerFn({ method: "POST" })
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
      .from("recurring_expenses")
      .update({ active: data.active })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos cambiar el gasto fijo."));
    return { ok: true };
  });

/**
 * Confirma los gastos fijos elegidos de un mes (acción masiva: la pantalla
 * muestra cuántos y cuánto antes de confirmar). Devuelve cuántos se crearon:
 * puede ser menos que los pedidos si otra persona ya los había confirmado.
 */
export const confirmarGastosFijos = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        mes: DIA,
        items: z
          .array(
            z.object({
              recurringExpenseId: z.string().uuid(),
              amountCents: z.number().int().positive().nullable(),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ creados: number }> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "finance:view", SIN_PERMISO);
    const { data: creados, error } = await supabase.rpc("confirmar_gastos_fijos", {
      p_clinic_id: data.clinicId,
      p_periodo: mesDe(data.mes),
      p_items: data.items.map((i) => ({
        recurring_expense_id: i.recurringExpenseId,
        ...(i.amountCents !== null ? { amount_cents: i.amountCents } : {}),
      })),
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos confirmar los gastos del mes."));
    return { creados: creados ?? 0 };
  });
