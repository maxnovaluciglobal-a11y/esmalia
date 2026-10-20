import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { suggestRecipeRecalibration } from "@/lib/clinic-operations/recipe-recalibration";
import { mensajeDb } from "@/lib/db-errors";
import { mapConLimite } from "@/lib/paginacion";

export interface RecipeRecalibrationSuggestion {
  itemId: string;
  itemName: string;
  unit: string;
  currentQuantity: number;
  suggestedQuantity: number;
}

const MIN_COUNTS_FOR_SUGGESTION = 3;

/**
 * Sugerencias de recalibración para la receta de UN procedimiento (Tanda 4).
 * Solo insumos `variable` usados en exactamente este procedimiento — si un
 * insumo aparece en más de una receta, la diferencia de conteo no se le
 * puede atribuir a ninguna en particular sin adivinar, así que se descarta
 * en vez de sugerir algo potencialmente equivocado. Solo usa conteos de
 * clínica completa (`warehouse_id` null): mezclar conteos parciales de
 * distintas bodegas en una sola suma no sería una comparación válida.
 * Nunca aplica nada sola: quien llama decide si "Aplicar" solo prellena el
 * borrador de la receta (ver RecetaDialog en aranceles.tsx) — todavía hace
 * falta guardar para que quede en firme.
 */
export const listRecipeRecalibrationSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), procedureId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ suggestions: RecipeRecalibrationSuggestion[] }> => {
    const { data: recipe, error: recipeError } = await context.supabase
      .from("procedure_supplies")
      .select("item_id, quantity")
      .eq("clinic_id", data.clinicId)
      .eq("procedure_id", data.procedureId);
    if (recipeError)
      throw new Error(mensajeDb(recipeError, "No pudimos calcular sugerencias de receta."));
    if (!recipe || recipe.length === 0) return { suggestions: [] };

    const itemIds = recipe.map((r) => r.item_id);
    const { data: items, error: itemsError } = await context.supabase
      .from("inventory_items")
      .select("id, name, unit, consumption_type")
      .eq("clinic_id", data.clinicId)
      .in("id", itemIds);
    // Pre-migración (Tanda 2) o error al leer: sin consumption_type no hay
    // forma de saber cuáles son `variable` — sin sugerencias, no error.
    if (itemsError || !items) return { suggestions: [] };
    const variableItemIds = new Set(
      items.filter((i) => i.consumption_type === "variable").map((i) => i.id),
    );
    if (variableItemIds.size === 0) return { suggestions: [] };

    // Atribución sin ambigüedad: el insumo tiene que estar en la receta de
    // este procedimiento y de ningún otro.
    const { data: allUsages, error: usagesError } = await context.supabase
      .from("procedure_supplies")
      .select("item_id, procedure_id")
      .eq("clinic_id", data.clinicId)
      .in("item_id", [...variableItemIds]);
    if (usagesError)
      throw new Error(mensajeDb(usagesError, "No pudimos calcular sugerencias de receta."));
    const proceduresByItem = new Map<string, Set<string>>();
    for (const u of allUsages ?? []) {
      const set = proceduresByItem.get(u.item_id) ?? new Set<string>();
      set.add(u.procedure_id);
      proceduresByItem.set(u.item_id, set);
    }
    const unambiguousItemIds = [...variableItemIds].filter(
      (id) => (proceduresByItem.get(id)?.size ?? 0) === 1,
    );
    if (unambiguousItemIds.length === 0) return { suggestions: [] };

    // Un insumo no depende de otro: hasta 4 en paralelo en vez de dos
    // consultas en serie por insumo. El orden del resultado se conserva.
    const porInsumo = await mapConLimite(
      unambiguousItemIds,
      4,
      async (itemId): Promise<RecipeRecalibrationSuggestion | null> => {
        const { data: counts, error: countsError } = await context.supabase
          .from("inventory_counts")
          .select("difference, counted_quantity, theoretical_quantity, counted_at")
          .eq("clinic_id", data.clinicId)
          .eq("item_id", itemId)
          .is("warehouse_id", null)
          .order("counted_at", { ascending: false })
          .limit(MIN_COUNTS_FOR_SUGGESTION);
        // Pre-migración (tabla todavía no existe) o pocos conteos: sin
        // sugerencia posible todavía, no es un error.
        if (countsError || !counts || counts.length < MIN_COUNTS_FOR_SUGGESTION) return null;

        const oldest = counts[counts.length - 1].counted_at;
        const newest = counts[0].counted_at;
        const { count: completionsInWindow, error: completionsError } = await context.supabase
          .from("treatment_items")
          .select("id", { count: "exact", head: true })
          .eq("clinic_id", data.clinicId)
          .eq("procedure_id", data.procedureId)
          .eq("status", "completed")
          .gte("completed_at", oldest)
          .lte("completed_at", newest);
        if (completionsError) return null;

        const recipeRow = recipe.find((r) => r.item_id === itemId);
        const item = items.find((i) => i.id === itemId);
        if (!recipeRow || !item) return null;

        const suggestion = suggestRecipeRecalibration({
          // Ver la nota en inventory-counts.functions.ts: columna generada, nullable
          // por catálogo pero nunca null de verdad.
          recentDifferences: counts.map(
            (c) => c.difference ?? c.counted_quantity - c.theoretical_quantity,
          ),
          currentRecipeQuantity: recipeRow.quantity,
          completionsInWindow: completionsInWindow ?? 0,
        });
        if (suggestion.kind !== "suggest") return null;
        return {
          itemId,
          itemName: item.name,
          unit: item.unit,
          currentQuantity: recipeRow.quantity,
          suggestedQuantity: suggestion.suggestedQuantity,
        };
      },
    );
    const suggestions = porInsumo.filter((s): s is RecipeRecalibrationSuggestion => s !== null);

    return { suggestions };
  });
