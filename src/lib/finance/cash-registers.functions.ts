import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { mensajeDb } from "@/lib/db-errors";
import { permissionsForRole, type ClinicRole } from "@/lib/access/access";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import {
  cajaDeLaPersona,
  diferenciaDeArqueo,
  esCobroEnEfectivo,
  esperadoConMovimientos,
  MENSAJE_MOTIVO_OBLIGATORIO,
  motivoFaltante,
  puedeCerrarCaja,
  sumarMovimientos,
  type CashMovement,
  type CashMovementKind,
  type CashRegister,
  type CashRegisterMethodBreakdown,
} from "@/lib/finance/cash-registers";
import {
  leerDetalle,
  validarConteo,
  type DetalleDenominaciones,
} from "@/lib/finance/denominaciones";
import { diaSiguiente } from "@/lib/finance/comisiones-vigencia";
import { enBloques } from "@/lib/paginacion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

const SIN_PERMISOS_CAJA = "No tienes permisos para operar la caja.";

/** Rol de quien llama en la clínica, o null si no es miembro. */
async function rolEnLaClinica(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
): Promise<ClinicRole | null> {
  const { data: membership } = await supabase
    .from("clinic_members")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  return (membership?.role as ClinicRole | undefined) ?? null;
}

/** owner/admin: ven y cierran todas las cajas (mismo criterio que `can_manage_clinic`). */
function esGestorDeCaja(rol: ClinicRole | null): boolean {
  return rol === "owner" || rol === "admin";
}

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
): Promise<ClinicRole> {
  const rol = await rolEnLaClinica(supabase, clinicId, userId);
  if (!rol || !permissionsForRole(rol).includes("cash:manage")) throw new Error(SIN_PERMISOS_CAJA);
  return rol;
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
  operator_id: string | null;
  operator_name_snapshot: string | null;
  cash_collected_cents: number | null;
  movements_in_cents: number | null;
  movements_out_cents: number | null;
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
    operatorId: row.operator_id,
    operatorName: row.operator_name_snapshot,
    cashCollectedCents: row.cash_collected_cents,
    movementsInCents: row.movements_in_cents,
    movementsOutCents: row.movements_out_cents,
  };
}

// Un solo literal (no concatenado con `+`): Supabase infiere el tipo de
// retorno a partir del literal exacto de la cadena. Concatenar rompe esa
// inferencia y cada `.select()` cae a un tipo genérico de error.
const CASH_REGISTER_COLUMNS =
  "id, clinic_id, branch_id, status, currency, opening_amount_cents, opened_by, opened_at, opening_notes, expected_closing_cents, declared_closing_cents, difference_cents, closed_by, closed_at, closing_notes, closing_denominations, operator_id, operator_name_snapshot, cash_collected_cents, movements_in_cents, movements_out_cents";

const CASH_MOVEMENT_COLUMNS =
  "id, kind, from_register_id, to_register_id, amount_cents, currency, reason, reference, created_by, created_at";

type CashMovementRow = {
  id: string;
  kind: string;
  from_register_id: string;
  to_register_id: string | null;
  amount_cents: number;
  currency: string;
  reason: string;
  reference: string | null;
  created_by: string;
  created_at: string;
};

function mapCashMovement(row: CashMovementRow): CashMovement {
  return {
    id: row.id,
    kind: row.kind as CashMovementKind,
    fromRegisterId: row.from_register_id,
    toRegisterId: row.to_register_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    reason: row.reason,
    reference: row.reference,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Caja abierta de quien consulta (CAJ-02): su caja propia; si no tiene, la
 * general abierta (la de antes de las cajas por persona, para poder
 * cerrarla); si no, `null`. Con `mine: false` mantiene el comportamiento
 * anterior (la caja abierta sin dueño de la sucursal).
 */
export const getOpenCashRegister = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        branchId: z.string().uuid().nullish(),
        mine: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CashRegister | null> => {
    if (data.mine) {
      const { data: rows, error } = await context.supabase
        .from("cash_registers")
        .select(CASH_REGISTER_COLUMNS)
        .eq("clinic_id", data.clinicId)
        .eq("status", "open")
        .or(`operator_id.eq.${context.userId},operator_id.is.null`);
      if (error) throw new Error(mensajeDb(error, "No pudimos revisar el estado de caja."));
      const cajas = (rows ?? []).map((row) => mapCashRegister(row as CashRegisterRow));
      return cajaDeLaPersona(cajas, context.userId);
    }
    let query = context.supabase
      .from("cash_registers")
      .select(CASH_REGISTER_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .eq("status", "open")
      .is("operator_id", null);
    query = data.branchId ? query.eq("branch_id", data.branchId) : query.is("branch_id", null);
    const { data: row, error } = await query.maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos revisar el estado de caja."));
    return row ? mapCashRegister(row as CashRegisterRow) : null;
  });

/** Todas las cajas abiertas de la clínica (destino de un traspaso). */
export const listOpenCashRegisters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CashRegister[]> => {
    await requireCashManageRole(context.supabase, data.clinicId, context.userId);
    const { data: rows, error } = await context.supabase
      .from("cash_registers")
      .select(CASH_REGISTER_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .eq("status", "open")
      .order("opened_at", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las cajas abiertas."));
    return (rows ?? []).map((row) => mapCashRegister(row as CashRegisterRow));
  });

/**
 * Historial de turnos. owner/admin/contabilidad ven todas las cajas; quien
 * opera caja sin ver finanzas (recepción) ve las suyas y las generales.
 */
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
    const rol = await rolEnLaClinica(context.supabase, data.clinicId, context.userId);
    const veTodas = rol ? permissionsForRole(rol).includes("finance:view") : false;
    let query = context.supabase
      .from("cash_registers")
      .select(CASH_REGISTER_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .order("opened_at", { ascending: false })
      .limit(data.limit);
    if (data.branchId) query = query.eq("branch_id", data.branchId);
    if (!veTodas) query = query.or(`operator_id.eq.${context.userId},operator_id.is.null`);
    const { data: rows, error } = await query;
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el historial de caja."));
    return (rows ?? []).map((row) => mapCashRegister(row as CashRegisterRow));
  });

/** Abre la caja de quien llama (CAJ-02). Una por persona a la vez. */
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

    const { data: perfil } = await context.supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    const nombre = (perfil?.full_name?.trim() || perfil?.email?.split("@")[0] || "").slice(0, 120);

    const { data: inserted, error } = await context.supabase
      .from("cash_registers")
      .insert({
        clinic_id: data.clinicId,
        branch_id: data.branchId ?? null,
        opening_amount_cents: data.openingAmountCents,
        opened_by: context.userId,
        operator_id: context.userId,
        operator_name_snapshot: nombre || null,
        opening_notes: data.notes || null,
      })
      .select("id")
      .single();

    if (error) {
      // El índice único parcial (una caja abierta por persona) es la causa
      // más probable de un 23505 acá: doble clic o dos pestañas.
      if (error.code === "23505") {
        throw new Error("Ya tienes una caja abierta. Actualiza la página.");
      }
      throw new Error(mensajeDb(error, "No pudimos abrir la caja."));
    }
    return { id: inserted.id };
  });

/**
 * Cierra una caja (CAJ-03): calcula lo esperado (apertura + efectivo
 * cobrado + traspasos recibidos − lo que salió), lo compara contra lo
 * declarado y guarda todo como snapshot. La base vuelve a hacer la misma
 * cuenta y rechaza el cierre si entró algo mientras se contaba. No se puede
 * volver a abrir la misma fila: un turno nuevo abre una caja nueva.
 *
 * La caja de una persona la cierra ella u owner/admin; la general, cualquiera
 * que opere caja (como antes).
 *
 * Arqueo por denominación (PR 12 del rediseño A+): el cliente puede mandar el
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
    const rol = await requireCashManageRole(context.supabase, data.clinicId, context.userId);

    const { data: register, error: fetchError } = await context.supabase
      .from("cash_registers")
      .select("id, status, opening_amount_cents, currency, operator_id")
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (fetchError) throw new Error(mensajeDb(fetchError, "No pudimos leer la caja."));
    if (!register) throw new Error("Esa caja no existe.");
    if (register.status === "closed") throw new Error("Esa caja ya está cerrada.");
    if (
      !puedeCerrarCaja({ operatorId: register.operator_id }, context.userId, esGestorDeCaja(rol))
    ) {
      throw new Error("Esa caja es de otra persona: la cierra ella o la administración.");
    }

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

    const [cobrosRes, movimientosRes] = await Promise.all([
      context.supabase
        .from("payments")
        .select("amount_cents, method")
        .eq("cash_register_id", data.id)
        // Un pago reversado no debe estar en caja: si se sumara, lo esperado
        // del cierre incluiría plata que en realidad se devolvió/anuló.
        .is("reversed_at", null),
      context.supabase
        .from("cash_movements")
        .select("from_register_id, to_register_id, amount_cents")
        .eq("clinic_id", data.clinicId)
        .or(`from_register_id.eq.${data.id},to_register_id.eq.${data.id}`),
    ]);
    if (cobrosRes.error)
      throw new Error(mensajeDb(cobrosRes.error, "No pudimos sumar los cobros de la caja."));
    if (movimientosRes.error)
      throw new Error(
        mensajeDb(movimientosRes.error, "No pudimos sumar los movimientos de la caja."),
      );

    // Solo el efectivo está en el cajón: tarjetas y transferencias se
    // concilian con el banco y no entran a la diferencia del arqueo.
    const cobradoEnEfectivoCents = (cobrosRes.data ?? [])
      .filter((p) => esCobroEnEfectivo(p.method))
      .reduce((sum, p) => sum + p.amount_cents, 0);
    const movimientos = sumarMovimientos(
      (movimientosRes.data ?? []).map((m) => ({
        fromRegisterId: m.from_register_id,
        toRegisterId: m.to_register_id,
        amountCents: m.amount_cents,
      })),
      data.id,
    );
    const expectedCents = esperadoConMovimientos(
      register.opening_amount_cents,
      cobradoEnEfectivoCents,
      movimientos,
    );
    const differenceCents = diferenciaDeArqueo(data.declaredClosingCents, expectedCents);

    if (motivoFaltante(differenceCents, data.notes)) throw new Error(MENSAJE_MOTIVO_OBLIGATORIO);

    const { data: cerradas, error: updateError } = await context.supabase
      .from("cash_registers")
      .update({
        status: "closed",
        expected_closing_cents: expectedCents,
        declared_closing_cents: data.declaredClosingCents,
        difference_cents: differenceCents,
        cash_collected_cents: cobradoEnEfectivoCents,
        movements_in_cents: movimientos.entradasCents,
        movements_out_cents: movimientos.salidasCents,
        closed_by: context.userId,
        closed_at: new Date().toISOString(),
        closing_notes: data.notes || null,
        closing_denominations: detalle as unknown as Json | null,
      })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId)
      // Dos personas cerrando a la vez: solo gana la primera.
      .eq("status", "open")
      .select("id");
    if (updateError) throw new Error(mensajeDb(updateError, "No pudimos cerrar la caja."));
    if (!cerradas || cerradas.length === 0) {
      throw new Error("No pudimos cerrar la caja: puede que ya la haya cerrado otra persona.");
    }

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

// ─── Movimientos entre cajas (CAJ-04) ────────────────────────────────────

/** Movimientos que salieron de una caja o entraron a ella. */
export const listCashMovements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), cashRegisterId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<CashMovement[]> => {
    await requireCashManageRole(context.supabase, data.clinicId, context.userId);
    const { data: rows, error } = await context.supabase
      .from("cash_movements")
      .select(CASH_MOVEMENT_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .or(`from_register_id.eq.${data.cashRegisterId},to_register_id.eq.${data.cashRegisterId}`)
      .order("created_at", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los movimientos de la caja."));
    return (rows ?? []).map((r) => mapCashMovement(r as CashMovementRow));
  });

/**
 * Registra un traspaso a otra caja, un retiro o un depósito (CAJ-04). La base
 * exige que las dos cajas estén abiertas, que la de origen sea de quien lo
 * hace (o una general, u owner/admin) y que haya efectivo suficiente.
 */
export const createCashMovement = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        kind: z.enum(["traspaso", "retiro", "deposito"]),
        fromRegisterId: z.string().uuid(),
        toRegisterId: z.string().uuid().nullish(),
        amountCents: z.number().int().positive("El monto tiene que ser mayor que cero."),
        reason: z
          .string()
          .trim()
          .min(4, "Escribe el motivo del movimiento (al menos 4 letras).")
          .max(300),
        reference: z.string().trim().max(80).optional(),
      })
      .refine((d) => (d.kind === "traspaso" ? Boolean(d.toRegisterId) : !d.toRegisterId), {
        message: "Elige la caja que recibe el traspaso.",
      })
      .refine((d) => d.toRegisterId !== d.fromRegisterId, {
        message: "La caja que recibe tiene que ser otra.",
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const rol = await requireCashManageRole(context.supabase, data.clinicId, context.userId);

    const { data: origen } = await context.supabase
      .from("cash_registers")
      .select("id, operator_id, status")
      .eq("id", data.fromRegisterId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (!origen) throw new Error("La caja de origen no existe.");
    if (origen.status !== "open") throw new Error("La caja de origen ya está cerrada.");
    if (!puedeCerrarCaja({ operatorId: origen.operator_id }, context.userId, esGestorDeCaja(rol))) {
      throw new Error("Solo puedes sacar efectivo de tu propia caja.");
    }

    const { data: inserted, error } = await context.supabase
      .from("cash_movements")
      .insert({
        clinic_id: data.clinicId,
        kind: data.kind,
        from_register_id: data.fromRegisterId,
        to_register_id: data.kind === "traspaso" ? (data.toRegisterId ?? null) : null,
        amount_cents: data.amountCents,
        reason: data.reason,
        reference: data.reference || null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(mensajeDb(error, "No pudimos registrar el movimiento."));
    return { id: inserted.id };
  });

// ─── Vista del día por caja (CAJ-05) ─────────────────────────────────────

export interface CajaDelDiaFila {
  id: string;
  nombre: string;
  operatorId: string | null;
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  aperturaCents: number;
  efectivoCents: number;
  efectivoCantidad: number;
  otrosMediosCents: number;
  otrosMediosCantidad: number;
  entradasCents: number;
  salidasCents: number;
  /** Abierta: lo que debería haber ahora. Cerrada: el esperado guardado al cerrar. */
  esperadoCents: number;
  contadoCents: number | null;
  diferenciaCents: number | null;
  motivo: string | null;
}

export interface CajasDelDia {
  fecha: string;
  currency: string;
  cajas: CajaDelDiaFila[];
  /** Cobros de hoy que no quedaron en ninguna caja (quien cobró no tenía caja abierta). */
  sinCaja: { cents: number; cantidad: number; efectivoCents: number };
  movimientos: (CashMovement & { desde: string; hacia: string | null })[];
}

/**
 * Las cajas del día de la clínica, una fila por caja (CAJ-05). Solo
 * owner/admin (regla 15: el par en el servidor de la vista de la pantalla).
 * Entra toda caja abierta (aunque se haya abierto otro día) y toda caja que
 * se abrió o cerró hoy en el huso de la clínica (regla 7).
 */
export const getCajasDelDia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CajasDelDia> => {
    const { supabase, userId } = context;
    const rol = await rolEnLaClinica(supabase, data.clinicId, userId);
    if (!esGestorDeCaja(rol)) throw new Error("Solo la administración ve todas las cajas del día.");

    const { data: clinic, error: clinicError } = await supabase
      .from("clinics")
      .select("timezone, currency")
      .eq("id", data.clinicId)
      .maybeSingle();
    if (clinicError) throw new Error(mensajeDb(clinicError, "No pudimos leer la clínica."));
    const timeZone = clinic?.timezone || "America/Santiago";
    const currency = clinic?.currency ?? "CLP";
    const fecha = hoyISO(timeZone);
    const desde = wallTimeInTzToUtc(`${fecha}T00:00:00`, timeZone).toISOString();
    const hasta = wallTimeInTzToUtc(`${diaSiguiente(fecha)}T00:00:00`, timeZone).toISOString();

    const { data: filas, error } = await supabase
      .from("cash_registers")
      .select(CASH_REGISTER_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .or(
        `status.eq.open,and(opened_at.gte.${desde},opened_at.lt.${hasta}),and(closed_at.gte.${desde},closed_at.lt.${hasta})`,
      )
      .order("opened_at", { ascending: true })
      .limit(100);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las cajas del día."));
    const cajas = (filas ?? []).map((r) => mapCashRegister(r as CashRegisterRow));
    const ids = cajas.map((c) => c.id);

    const [bloquesPagos, movimientosRes, sinCajaRes] = await Promise.all([
      Promise.all(
        enBloques(ids).map((bloque) =>
          supabase
            .from("payments")
            .select("cash_register_id, amount_cents, method")
            .eq("clinic_id", data.clinicId)
            .in("cash_register_id", bloque)
            .is("reversed_at", null),
        ),
      ),
      ids.length
        ? supabase
            .from("cash_movements")
            .select(CASH_MOVEMENT_COLUMNS)
            .eq("clinic_id", data.clinicId)
            .or(`from_register_id.in.(${ids.join(",")}),to_register_id.in.(${ids.join(",")})`)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as CashMovementRow[], error: null }),
      supabase
        .from("payments")
        .select("amount_cents, method")
        .eq("clinic_id", data.clinicId)
        .is("cash_register_id", null)
        .is("reversed_at", null)
        .gte("paid_at", desde)
        .lt("paid_at", hasta),
    ]);
    const pagos: { cash_register_id: string | null; amount_cents: number; method: string }[] = [];
    for (const r of bloquesPagos) {
      if (r.error) throw new Error(mensajeDb(r.error, "No pudimos sumar los cobros de las cajas."));
      pagos.push(...(r.data ?? []));
    }
    if (movimientosRes.error)
      throw new Error(mensajeDb(movimientosRes.error, "No pudimos cargar los movimientos."));
    if (sinCajaRes.error)
      throw new Error(mensajeDb(sinCajaRes.error, "No pudimos sumar los cobros sin caja."));
    const movimientos = (movimientosRes.data ?? []).map((m) =>
      mapCashMovement(m as CashMovementRow),
    );

    const nombreDe = (c: CashRegister) =>
      c.operatorId ? (c.operatorName?.trim() || "Otra persona") : "Caja general";

    const salida: CajaDelDiaFila[] = cajas.map((c) => {
      const propios = pagos.filter((p) => p.cash_register_id === c.id);
      const efectivo = propios.filter((p) => esCobroEnEfectivo(p.method));
      const otros = propios.filter((p) => !esCobroEnEfectivo(p.method));
      const efectivoCents = efectivo.reduce((s, p) => s + p.amount_cents, 0);
      const mov = sumarMovimientos(movimientos, c.id);
      const abierta = c.status === "open";
      return {
        id: c.id,
        nombre: nombreDe(c),
        operatorId: c.operatorId,
        status: c.status,
        openedAt: c.openedAt,
        closedAt: c.closedAt,
        aperturaCents: c.openingAmountCents,
        efectivoCents: abierta ? efectivoCents : (c.cashCollectedCents ?? efectivoCents),
        efectivoCantidad: efectivo.length,
        otrosMediosCents: otros.reduce((s, p) => s + p.amount_cents, 0),
        otrosMediosCantidad: otros.length,
        entradasCents: abierta ? mov.entradasCents : (c.movementsInCents ?? mov.entradasCents),
        salidasCents: abierta ? mov.salidasCents : (c.movementsOutCents ?? mov.salidasCents),
        esperadoCents:
          !abierta && c.expectedClosingCents !== null
            ? c.expectedClosingCents
            : esperadoConMovimientos(c.openingAmountCents, efectivoCents, mov),
        contadoCents: c.declaredClosingCents,
        diferenciaCents: c.differenceCents,
        motivo: c.closingNotes,
      };
    });

    const porId = new Map(cajas.map((c) => [c.id, c]));
    const sinCaja = (sinCajaRes.data ?? []).reduce(
      (acc, p) => ({
        cents: acc.cents + p.amount_cents,
        cantidad: acc.cantidad + 1,
        efectivoCents: acc.efectivoCents + (esCobroEnEfectivo(p.method) ? p.amount_cents : 0),
      }),
      { cents: 0, cantidad: 0, efectivoCents: 0 },
    );

    return {
      fecha,
      currency,
      cajas: salida,
      sinCaja,
      movimientos: movimientos.map((m) => {
        const origen = porId.get(m.fromRegisterId);
        const destino = m.toRegisterId ? porId.get(m.toRegisterId) : undefined;
        return {
          ...m,
          desde: origen ? nombreDe(origen) : "Otra caja",
          hacia: m.toRegisterId ? (destino ? nombreDe(destino) : "Otra caja") : null,
        };
      }),
    };
  });
