import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { mensajeDb } from "@/lib/db-errors";
import { permissionsForRole, type ClinicRole } from "@/lib/access/access";
import {
  diferenciaDeArqueo,
  esCobroEnEfectivo,
  esperadoEnCaja,
  MENSAJE_MOTIVO_OBLIGATORIO,
  motivoFaltante,
  type CashRegister,
  type CashRegisterMethodBreakdown,
} from "@/lib/finance/cash-registers";
import {
  leerDetalle,
  validarConteo,
  type DetalleDenominaciones,
} from "@/lib/finance/denominaciones";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

const SIN_PERMISOS_CAJA = "No tienes permisos para operar la caja.";

/**
 * Igual que `requireFinanceViewRole` (finance-reports.functions.ts) pero para
 * `cash:manage` — regla 15 de CLAUDE.md, el par en el servidor del gate de
 * UI. La RLS de `cash_registers` ya exige owner/admin/reception/accounting,
 * pero ese chequeo vive en Postgres: repetirlo acá da un mensaje que se
 * entiende en vez de un error genérico de policy.
 */
async function requireCashManageRole(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
) {
  const { data: membership } = await supabase
    .from("clinic_members")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  const canManage = membership?.role
    ? permissionsForRole(membership.role as ClinicRole).includes("cash:manage")
    : false;
  if (!canManage) throw new Error(SIN_PERMISOS_CAJA);
}

type CashRegisterRow = {
  id: string;
  clinic_id: string;
  branch_id: string | null;
  status: "open" | "closed";
  currency: string;
  opening_amount_cents: number;
  opened_by: string;
  opened_at: string;
  opening_notes: string | null;
  expected_closing_cents: number | null;
  declared_closing_cents: number | null;
  difference_cents: number | null;
  closed_by: string | null;
  closed_at: string | null;
  closing_notes: string | null;
  closing_denominations: unknown;
};

function mapCashRegister(row: CashRegisterRow): CashRegister {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    branchId: row.branch_id,
    status: row.status,
    currency: row.currency,
    openingAmountCents: row.opening_amount_cents,
    openedById: row.opened_by,
    openedAt: row.opened_at,
    openingNotes: row.opening_notes,
    expectedClosingCents: row.expected_closing_cents,
    declaredClosingCents: row.declared_closing_cents,
    differenceCents: row.difference_cents,
    closedById: row.closed_by,
    closedAt: row.closed_at,
    closingNotes: row.closing_notes,
    closingDenominations: leerDetalle(row.closing_denominations),
  };
}

// Un solo literal (no concatenado con `+`): Supabase infiere el tipo de
// retorno a partir del literal exacto de la cadena. Concatenar rompe esa
// inferencia y cada `.select()` cae a un tipo genérico de error.
const CASH_REGISTER_COLUMNS =
  "id, clinic_id, branch_id, status, currency, opening_amount_cents, opened_by, opened_at, opening_notes, expected_closing_cents, declared_closing_cents, difference_cents, closed_by, closed_at, closing_notes, closing_denominations";

/** Caja abierta ahora mismo para la clínica/sucursal, o `null` si no hay ninguna. */
export const getOpenCashRegister = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        branchId: z.string().uuid().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CashRegister | null> => {
    let query = context.supabase
      .from("cash_registers")
      .select(CASH_REGISTER_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .eq("status", "open");
    query = data.branchId ? query.eq("branch_id", data.branchId) : query.is("branch_id", null);
    const { data: row, error } = await query.maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos revisar el estado de caja."));
    return row ? mapCashRegister(row as CashRegisterRow) : null;
  });

export const listCashRegisters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        branchId: z.string().uuid().nullish(),
        limit: z.number().int().positive().max(200).default(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CashRegister[]> => {
    let query = context.supabase
      .from("cash_registers")
      .select(CASH_REGISTER_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .order("opened_at", { ascending: false })
      .limit(data.limit);
    if (data.branchId) query = query.eq("branch_id", data.branchId);
    const { data: rows, error } = await query;
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el historial de caja."));
    return (rows ?? []).map((row) => mapCashRegister(row as CashRegisterRow));
  });

export const openCashRegister = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        branchId: z.string().uuid().nullish(),
        openingAmountCents: z.number().int().min(0, "El monto inicial no puede ser negativo."),
        notes: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireCashManageRole(context.supabase, data.clinicId, context.userId);

    const { data: inserted, error } = await context.supabase
      .from("cash_registers")
      .insert({
        clinic_id: data.clinicId,
        branch_id: data.branchId ?? null,
        opening_amount_cents: data.openingAmountCents,
        opened_by: context.userId,
        opening_notes: data.notes || null,
      })
      .select("id")
      .single();

    if (error) {
      // El índice único parcial (una sola caja abierta por sucursal) es la
      // causa más probable de un 23505 acá — dos personas abriendo a la vez.
      if (error.code === "23505") {
        throw new Error("Ya hay una caja abierta para esta sucursal. Actualizá la página.");
      }
      throw new Error(mensajeDb(error, "No pudimos abrir la caja."));
    }
    return { id: inserted.id };
  });

/**
 * Cierra una caja: calcula lo esperado (apertura + pagos vinculados a esta
 * sesión), lo compara contra lo declarado por el cajero y guarda ambos como
 * snapshot. No se puede volver a abrir la misma fila — un turno nuevo abre
 * una caja nueva, la historia queda intacta.
 *
 * Arqueo v2 (flag `caja-arqueo-v2`, solo UI): el cliente puede mandar el
 * conteo por billete y moneda. El servidor lo vuelve a sumar con su propia
 * tabla de la moneda de la caja y exige que coincida con lo declarado. Con
 * o sin conteo, si no cuadra el motivo es obligatorio (lo decide la
 * diferencia que calcula el servidor, no la de la pantalla).
 */
export const closeCashRegister = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        clinicId: z.string().uuid(),
        declaredClosingCents: z.number().int().min(0, "El monto contado no puede ser negativo."),
        notes: z.string().trim().max(500).optional(),
        denominations: z
          .array(
            z.object({
              valorCents: z.number().int().positive(),
              tipo: z.enum(["billete", "moneda"]),
              cantidad: z.number().int().min(0),
            }),
          )
          .max(40)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ differenceCents: number }> => {
    await requireCashManageRole(context.supabase, data.clinicId, context.userId);

    const { data: register, error: fetchError } = await context.supabase
      .from("cash_registers")
      .select("id, status, opening_amount_cents, currency")
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (fetchError) throw new Error(mensajeDb(fetchError, "No pudimos leer la caja."));
    if (!register) throw new Error("Esa caja no existe.");
    if (register.status === "closed") throw new Error("Esa caja ya está cerrada.");

    // El conteo se valida contra la moneda de la caja (la fijó la base al
    // abrir, regla 14), nunca contra una moneda que mande el cliente.
    let detalle: DetalleDenominaciones | null = null;
    if (data.denominations) {
      const resultado = validarConteo(data.denominations, register.currency);
      if (!resultado.ok) throw new Error(resultado.error);
      if (resultado.detalle.totalCents !== data.declaredClosingCents) {
        throw new Error("El total no coincide con el conteo por billete. Vuelve a contar.");
      }
      detalle = resultado.detalle;
    }

    const { data: cobros, error: cobrosError } = await context.supabase
      .from("payments")
      .select("amount_cents, method")
      .eq("cash_register_id", data.id)
      // Un pago reversado no debe estar en caja: si se sumara, lo esperado
      // del cierre incluiría plata que en realidad se devolvió/anuló.
      .is("reversed_at", null);
    if (cobrosError)
      throw new Error(mensajeDb(cobrosError, "No pudimos sumar los cobros de la caja."));

    // Solo el efectivo está en el cajón: tarjetas y transferencias se
    // concilian con el banco y no entran a la diferencia del arqueo.
    const cobradoEnEfectivoCents = (cobros ?? [])
      .filter((p) => esCobroEnEfectivo(p.method))
      .reduce((sum, p) => sum + p.amount_cents, 0);
    const expectedCents = esperadoEnCaja(register.opening_amount_cents, cobradoEnEfectivoCents);
    const differenceCents = diferenciaDeArqueo(data.declaredClosingCents, expectedCents);

    if (motivoFaltante(differenceCents, data.notes)) throw new Error(MENSAJE_MOTIVO_OBLIGATORIO);

    const { error: updateError } = await context.supabase
      .from("cash_registers")
      .update({
        status: "closed",
        expected_closing_cents: expectedCents,
        declared_closing_cents: data.declaredClosingCents,
        difference_cents: differenceCents,
        closed_by: context.userId,
        closed_at: new Date().toISOString(),
        closing_notes: data.notes || null,
        closing_denominations: detalle as unknown as Json | null,
      })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId)
      // Dos personas cerrando a la vez: solo gana la primera.
      .eq("status", "open");
    if (updateError) throw new Error(mensajeDb(updateError, "No pudimos cerrar la caja."));

    return { differenceCents };
  });

/** Desglose por medio de pago de lo cobrado durante una sesión de caja (abierta o cerrada). */
export const getCashRegisterBreakdown = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ cashRegisterId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CashRegisterMethodBreakdown[]> => {
    const { data: rows, error } = await context.supabase
      .from("payments")
      .select("amount_cents, method, method_name_snapshot")
      .eq("cash_register_id", data.cashRegisterId)
      .is("reversed_at", null);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el desglose de la caja."));

    const porMetodo = new Map<string, CashRegisterMethodBreakdown>();
    for (const row of rows ?? []) {
      const nombre = row.method_name_snapshot || row.method;
      const enEfectivo = esCobroEnEfectivo(row.method);
      // Un medio propio llamado igual que otro no mezcla efectivo con banco.
      const key = `${enEfectivo ? "cash" : "banco"}|${nombre}`;
      const actual = porMetodo.get(key) ?? { method: nombre, amountCents: 0, count: 0, enEfectivo };
      actual.amountCents += row.amount_cents;
      actual.count += 1;
      porMetodo.set(key, actual);
    }
    // Efectivo primero (es lo que se cuenta), después lo que va al banco.
    return Array.from(porMetodo.values()).sort(
      (a, b) => Number(b.enEfectivo) - Number(a.enEfectivo) || b.amountCents - a.amountCents,
    );
  });
