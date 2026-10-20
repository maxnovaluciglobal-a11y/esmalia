import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { isUndefinedColumnError, mensajeDb } from "@/lib/db-errors";
import {
  applyYield,
  computeReversalLines,
  type ConsumptionType,
  type SupplyMovementRecord,
} from "@/lib/clinic-operations/procedure-supply-consumption";
import { requireEscritura } from "@/lib/solo-lectura.middleware";
import { mapConLimite } from "@/lib/paginacion";

export type ProcedureSupply = {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  consumptionType: ConsumptionType;
  /** `quantity` ya ajustada por el rendimiento del insumo (Tanda 2) — la
   * cantidad real que se descuenta si nadie la edita a mano. */
  adjustedQuantity: number;
};

/** Receta de insumos de un procedimiento, con nombre/unidad/tipo del insumo
 * para mostrar en la UI. RLS: mismo set operativo que inventory_items
 * (SELECT). */
export const listProcedureSupplies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), procedureId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ supplies: ProcedureSupply[] }> => {
    const { data: rows, error } = await context.supabase
      .from("procedure_supplies")
      .select("item_id, quantity")
      .eq("clinic_id", data.clinicId)
      .eq("procedure_id", data.procedureId);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la receta del procedimiento."));
    if (!rows || rows.length === 0) return { supplies: [] };

    const itemIds = rows.map((r) => r.item_id);
    type InventoryItemLookupRow = {
      id: string;
      name: string;
      unit: string;
      consumption_type?: string | null;
      yield_pct?: number | null;
    };
    const first = await context.supabase
      .from("inventory_items")
      .select("id, name, unit, consumption_type, yield_pct")
      .eq("clinic_id", data.clinicId)
      .in("id", itemIds);
    let items: InventoryItemLookupRow[] | null = first.data;
    let itemsError = first.error;
    if (itemsError && isUndefinedColumnError(itemsError)) {
      // Pre-migración (Tanda 2): consumption_type/yield_pct todavía no se
      // aplicaron al Supabase real — degradar a fixed/100 (mismo default de
      // las columnas) en vez de romper "marcar como realizado" para
      // procedimientos con receta ya configurada (Tanda 1, en producción).
      const fallback = await context.supabase
        .from("inventory_items")
        .select("id, name, unit")
        .eq("clinic_id", data.clinicId)
        .in("id", itemIds);
      items = fallback.data;
      itemsError = fallback.error;
    }
    if (itemsError)
      throw new Error(mensajeDb(itemsError, "No pudimos cargar la receta del procedimiento."));
    const itemById = new Map((items ?? []).map((i) => [i.id, i]));

    const supplies: ProcedureSupply[] = rows
      .map((r) => {
        const item = itemById.get(r.item_id);
        if (!item) return null;
        const consumptionType = (item.consumption_type as ConsumptionType | null) ?? "fixed";
        const yieldPct = item.yield_pct ?? 100;
        return {
          itemId: r.item_id,
          itemName: item.name,
          unit: item.unit,
          quantity: r.quantity,
          consumptionType,
          adjustedQuantity: applyYield(r.quantity, yieldPct),
        };
      })
      .filter((x): x is ProcedureSupply => x !== null);
    return { supplies };
  });

/** Reemplaza la receta completa de un procedimiento (borra + inserta de
 * nuevo — son pocas líneas de configuración, no eventos históricos). RLS
 * (`procedure_supplies_{insert,delete}_managers`) ya exige owner/admin/dentist. */
export const setProcedureSupplies = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        procedureId: z.string().uuid(),
        supplies: z
          .array(
            z.object({
              itemId: z.string().uuid(),
              quantity: z.number().positive("La cantidad debe ser mayor a 0."),
            }),
          )
          .max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error: deleteError } = await context.supabase
      .from("procedure_supplies")
      .delete()
      .eq("clinic_id", data.clinicId)
      .eq("procedure_id", data.procedureId);
    if (deleteError)
      throw new Error(mensajeDb(deleteError, "No pudimos guardar la receta del procedimiento."));

    if (data.supplies.length === 0) return { ok: true };

    const { error: insertError } = await context.supabase.from("procedure_supplies").insert(
      data.supplies.map((s) => ({
        clinic_id: data.clinicId,
        procedure_id: data.procedureId,
        item_id: s.itemId,
        quantity: s.quantity,
      })),
    );
    if (insertError)
      throw new Error(mensajeDb(insertError, "No pudimos guardar la receta del procedimiento."));
    return { ok: true };
  });

/**
 * Consume los insumos de la receta del procedimiento para un treatment_item
 * que acaba de completarse. Llamada desde setTreatmentItemStatus, nunca
 * expuesta directo al cliente. Sin procedimiento vinculado, o sin receta
 * configurada para ese procedimiento, no hace nada — es el caso normal
 * (`treatment_items.procedure_id` es nullable), no un error.
 *
 * `overrides` (Tanda 2): cantidad final por insumo, tal como la confirmó el
 * dentista en el diálogo de ajuste (solo se le muestran los insumos
 * `variable`). Si un insumo no tiene override, se calcula con la receta
 * ajustada por rendimiento (`applyYield`) — el camino sin fricción de la
 * Tanda 1 para insumos `fixed`, o cuando no hubo diálogo porque la receta
 * completa era `fixed`.
 *
 * Si algún insumo queda con stock negativo, ese movimiento puntual se omite
 * en vez de abortar todo (mismo principio que el descuento de stock en
 * DypOS): completar la atención al paciente no puede depender de que el
 * inventario cuadre. `skippedCount` le avisa a quien llama para mostrar un
 * aviso, no para bloquear nada.
 */
export async function applyTreatmentItemSupplyConsumption(
  supabase: SupabaseClient<Database>,
  params: {
    clinicId: string;
    treatmentItemId: string;
    procedureId: string | null;
    overrides?: Record<string, number>;
  },
): Promise<{ skippedCount: number }> {
  if (!params.procedureId) return { skippedCount: 0 };

  const { data: supplies, error } = await supabase
    .from("procedure_supplies")
    .select("item_id, quantity")
    .eq("clinic_id", params.clinicId)
    .eq("procedure_id", params.procedureId);
  if (error)
    throw new Error(mensajeDb(error, "No pudimos leer la receta de insumos del procedimiento."));
  if (!supplies || supplies.length === 0) return { skippedCount: 0 };

  const itemIds = supplies.map((s) => s.item_id);
  type YieldLookupRow = { id: string; yield_pct?: number | null };
  const first = await supabase
    .from("inventory_items")
    .select("id, yield_pct")
    .eq("clinic_id", params.clinicId)
    .in("id", itemIds);
  let items: YieldLookupRow[] | null = first.data;
  let itemsError = first.error;
  if (itemsError && isUndefinedColumnError(itemsError)) {
    // Pre-migración (Tanda 2): yield_pct todavía no existe — cada insumo
    // consume la cantidad de receta sin ajuste (100 = sin merma, el mismo
    // default que tendrá la columna una vez migrada).
    const fallback = await supabase
      .from("inventory_items")
      .select("id")
      .eq("clinic_id", params.clinicId)
      .in("id", itemIds);
    items = fallback.data;
    itemsError = fallback.error;
  }
  if (itemsError)
    throw new Error(
      mensajeDb(itemsError, "No pudimos leer la receta de insumos del procedimiento."),
    );
  const yieldByItem = new Map((items ?? []).map((i) => [i.id, i.yield_pct ?? 100]));

  // En paralelo (hasta 4 a la vez) y no uno por uno: cada insumo es un
  // movimiento independiente — la receta no repite insumo (UNIQUE
  // procedure_id + item_id), así que no compiten por el mismo saldo. Sigue
  // siendo un INSERT por insumo y no uno solo en lote a propósito: si a un
  // insumo no le alcanza el stock, se omite ese y no todo el consumo.
  const resultados = await mapConLimite(supplies, 4, async (supply) => {
    const override = params.overrides?.[supply.item_id];
    const quantity =
      override ?? applyYield(supply.quantity, yieldByItem.get(supply.item_id) ?? 100);
    const { error: insertError } = await supabase.from("inventory_movements").insert({
      clinic_id: params.clinicId,
      item_id: supply.item_id,
      kind: "salida",
      quantity,
      reason: "Consumo automático por procedimiento",
      treatment_item_id: params.treatmentItemId,
    });
    return insertError;
  });

  let skippedCount = 0;
  for (const insertError of resultados) {
    if (!insertError) continue;
    // 23514 = check_violation: la clínica no tenía ese insumo en ninguna
    // bodega. El movimiento no manda warehouse_id, así que el trigger lo
    // descuenta de las bodegas con saldo en orden de posición y solo
    // rechaza cuando no alcanza el total — no cuando falta en una bodega
    // puntual. Se omite ese insumo, no todo el consumo: mismo criterio que
    // registerInventoryMovement usa para el mensaje al usuario, pero acá no
    // hay usuario esperando en un diálogo, el tratamiento se completa igual.
    if (insertError.code === "23514") {
      skippedCount += 1;
      continue;
    }
    throw new Error(mensajeDb(insertError, "No pudimos descontar los insumos del procedimiento."));
  }
  return { skippedCount };
}

/**
 * Revierte el consumo automático de insumos de un treatment_item que se
 * des-completó. Idempotente (ver computeReversalLines): si ya no queda nada
 * pendiente de revertir — por ejemplo, si se llama dos veces por error — no
 * genera movimientos nuevos.
 */
export async function reverseTreatmentItemSupplyConsumption(
  supabase: SupabaseClient<Database>,
  params: { clinicId: string; treatmentItemId: string },
): Promise<void> {
  const { data: movements, error } = await supabase
    .from("inventory_movements")
    .select("item_id, kind, quantity")
    .eq("clinic_id", params.clinicId)
    .eq("treatment_item_id", params.treatmentItemId);
  if (error)
    throw new Error(
      mensajeDb(error, "No pudimos leer los movimientos de inventario del tratamiento."),
    );
  if (!movements || movements.length === 0) return;

  const records: SupplyMovementRecord[] = movements.map((m) => ({
    itemId: m.item_id,
    kind: m.kind as "entrada" | "salida",
    quantity: m.quantity,
  }));
  const toReverse = computeReversalLines(records);
  if (toReverse.length === 0) return;

  const { error: insertError } = await supabase.from("inventory_movements").insert(
    toReverse.map((line) => ({
      clinic_id: params.clinicId,
      item_id: line.itemId,
      kind: "entrada" as const,
      quantity: line.quantity,
      reason: "Reversión de consumo automático por procedimiento",
      treatment_item_id: params.treatmentItemId,
    })),
  );
  if (insertError)
    throw new Error(mensajeDb(insertError, "No pudimos revertir el consumo de insumos."));
}
