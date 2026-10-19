import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { reconcileCount } from "@/lib/clinic-operations/inventory-reconciliation";
import { isUndefinedTableError, mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

export interface InventoryCount {
  id: string;
  itemId: string;
  warehouseId: string | null;
  theoreticalQuantity: number;
  countedQuantity: number;
  difference: number;
  notes: string | null;
  countedBy: string;
  countedAt: string;
}

const MIGRATION_PENDING_MESSAGE =
  "No pudimos guardar el conteo: falta aplicar la migración de conteo físico. Avísale al soporte de Esmalia.";

/**
 * Registra un conteo físico de un insumo (clínica entera, o de una bodega
 * puntual si la clínica tiene más de una) y, si hay diferencia contra lo
 * teórico, dispara el entrada/salida que corrige el stock — ver
 * inventory-reconciliation.ts. Nunca usa `ajuste`: reutiliza el trigger de
 * stock por bodega ya probado, tanto para el total de la clínica como para
 * el saldo puntual de la bodega contada.
 */
export const recordInventoryCount = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        itemId: z.string().uuid(),
        // null/omitido = conteo del total de la clínica (todas las bodegas
        // juntas) — el caso normal en una clínica de una sola bodega.
        warehouseId: z.string().uuid().nullable().optional(),
        countedQuantity: z.number().min(0, "La cantidad contada no puede ser negativa."),
        notes: z.string().trim().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ countId: string; reconciled: boolean }> => {
    const warehouseId = data.warehouseId ?? null;

    let theoreticalQuantity: number;
    if (warehouseId) {
      const { data: stockRow, error: stockError } = await context.supabase
        .from("inventory_stock")
        .select("current_stock")
        .eq("clinic_id", data.clinicId)
        .eq("item_id", data.itemId)
        .eq("warehouse_id", warehouseId)
        .maybeSingle();
      if (stockError)
        throw new Error(mensajeDb(stockError, "No pudimos leer el stock de la bodega."));
      // Sin fila todavía = ese ítem nunca tuvo un movimiento en esa bodega,
      // el teórico es 0 (no un error).
      theoreticalQuantity = stockRow?.current_stock ?? 0;
    } else {
      const { data: itemRow, error: itemError } = await context.supabase
        .from("inventory_items")
        .select("current_stock")
        .eq("clinic_id", data.clinicId)
        .eq("id", data.itemId)
        .single();
      if (itemError) throw new Error(mensajeDb(itemError, "No pudimos leer el stock del ítem."));
      theoreticalQuantity = itemRow.current_stock;
    }

    const reconciliation = reconcileCount(theoreticalQuantity, data.countedQuantity);

    let movementId: string | null = null;
    if (reconciliation.kind !== "match") {
      const { data: movementRow, error: movementError } = await context.supabase
        .from("inventory_movements")
        .insert({
          clinic_id: data.clinicId,
          item_id: data.itemId,
          kind: reconciliation.kind,
          quantity: reconciliation.quantity,
          reason: "Ajuste por conteo físico",
          warehouse_id: warehouseId,
        })
        .select("id")
        .single();
      if (movementError) {
        // 23514 = check_violation: mismo caso que registerInventoryMovement
        // — una salida que dejaría el stock en negativo.
        if (movementError.code === "23514") {
          throw new Error(
            "Ese conteo generaría una salida que deja el stock en negativo — revisa la cantidad contada.",
          );
        }
        throw new Error(mensajeDb(movementError, "No pudimos registrar el ajuste del conteo."));
      }
      movementId = movementRow.id;
    }

    const { data: countRow, error: countError } = await context.supabase
      .from("inventory_counts")
      .insert({
        clinic_id: data.clinicId,
        item_id: data.itemId,
        warehouse_id: warehouseId,
        theoretical_quantity: theoreticalQuantity,
        counted_quantity: data.countedQuantity,
        notes: data.notes || null,
        movement_id: movementId,
      })
      .select("id")
      .single();
    if (countError) {
      if (isUndefinedTableError(countError)) throw new Error(MIGRATION_PENDING_MESSAGE);
      throw new Error(mensajeDb(countError, "No pudimos guardar el conteo físico."));
    }

    return { countId: countRow.id, reconciled: reconciliation.kind !== "match" };
  });

/** Historial de conteos de un ítem, más reciente primero. RLS: mismo set
 * que inventory_items/inventory_movements (SELECT). Pre-migración (tabla
 * todavía no aplicada) degrada a lista vacía — "sin conteos todavía" es la
 * lectura correcta en los dos casos. */
export const listInventoryCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), itemId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ counts: InventoryCount[] }> => {
    const { data: rows, error } = await context.supabase
      .from("inventory_counts")
      .select(
        "id, item_id, warehouse_id, theoretical_quantity, counted_quantity, difference, notes, counted_by, counted_at",
      )
      .eq("clinic_id", data.clinicId)
      .eq("item_id", data.itemId)
      .order("counted_at", { ascending: false })
      .limit(50);
    if (error) {
      if (isUndefinedTableError(error)) return { counts: [] };
      throw new Error(mensajeDb(error, "No pudimos cargar el historial de conteos."));
    }
    return {
      counts: (rows ?? []).map((r) => ({
        id: r.id,
        itemId: r.item_id,
        warehouseId: r.warehouse_id,
        theoreticalQuantity: r.theoretical_quantity,
        countedQuantity: r.counted_quantity,
        // `difference` es GENERATED ALWAYS AS (counted - theoretical) sobre dos
        // columnas NOT NULL, así que en la práctica nunca es null — pero Postgres
        // marca nullable a toda columna generada y los tipos lo reflejan. Se deriva
        // con la misma fórmula en vez de asumir un 0, que diría "no hubo diferencia".
        difference: r.difference ?? r.counted_quantity - r.theoretical_quantity,
        notes: r.notes,
        countedBy: r.counted_by,
        countedAt: r.counted_at,
      })),
    };
  });
