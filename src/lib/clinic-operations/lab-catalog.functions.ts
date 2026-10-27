import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicRole, tienePermisoEnClinica } from "@/lib/access/clinic-guards.server";
import { mensajeDb } from "@/lib/db-errors";
import {
  MATERIALES,
  type ItemCatalogoLab,
  type Material,
} from "@/lib/clinic-operations/lab-orden-detalle";
import { ROLES_GESTIONAN_CATALOGO_LABORATORIO } from "@/lib/clinic-operations/lab-portal-roles";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Ola 9 · LAB-07: catálogo de trabajos de cada laboratorio (precio de costo
 * y plazo típico). Lo ve todo el equipo para precargar la orden; el precio,
 * solo quien tiene `finance:view` (igual que el costo de `lab_orders`). Lo
 * configuran owner y admin (`can_manage_clinic`, par de servidor del botón).
 */

const COLUMNAS = "id, lab_id, name, cost_cents, currency, typical_days, material, notes, is_active";

export const listLabCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        labId: z.string().uuid().nullish(),
        incluirInactivos: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ItemCatalogoLab[]> => {
    const { supabase, userId } = context;
    const puedeVerCostos = await tienePermisoEnClinica(
      supabase,
      data.clinicId,
      userId,
      "finance:view",
    );

    let query = supabase.from("lab_catalog_items").select(COLUMNAS).eq("clinic_id", data.clinicId);
    if (data.labId) query = query.eq("lab_id", data.labId);
    if (!data.incluirInactivos) query = query.eq("is_active", true);
    const { data: rows, error } = await query.order("name", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el catálogo del laboratorio."));
    return (rows ?? []).map((r) => ({
      id: r.id,
      labId: r.lab_id,
      name: r.name,
      costCents: puedeVerCostos ? r.cost_cents : null,
      currency: r.currency,
      typicalDays: r.typical_days,
      material: (MATERIALES as readonly string[]).includes(r.material ?? "")
        ? (r.material as Material)
        : null,
      notes: r.notes,
      isActive: r.is_active,
    }));
  });

const CamposItem = {
  name: z.string().trim().min(1, "Ponle nombre al trabajo.").max(120),
  costCents: z.number().int().min(0).nullish(),
  typicalDays: z.number().int().min(0).max(365).nullish(),
  material: z.enum(MATERIALES).nullish(),
  notes: z.string().trim().max(500).nullish(),
};

/** Crea un trabajo en el catálogo, o lo edita si viene `id`. */
export const saveLabCatalogItem = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        labId: z.string().uuid(),
        id: z.string().uuid().nullish(),
        ...CamposItem,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await requireClinicRole(
      context.supabase,
      data.clinicId,
      context.userId,
      ROLES_GESTIONAN_CATALOGO_LABORATORIO,
      "No tienes permisos para editar el catálogo del laboratorio.",
    );
    const fila = {
      name: data.name,
      cost_cents: data.costCents ?? null,
      typical_days: data.typicalDays ?? null,
      material: data.material ?? null,
      notes: data.notes?.trim() || null,
    };
    const { data: guardado, error } = data.id
      ? await context.supabase
          .from("lab_catalog_items")
          .update(fila)
          .eq("id", data.id)
          .eq("clinic_id", data.clinicId)
          .eq("lab_id", data.labId)
          .select("id")
          .maybeSingle()
      : await context.supabase
          .from("lab_catalog_items")
          .insert({ ...fila, clinic_id: data.clinicId, lab_id: data.labId })
          .select("id")
          .single();
    if (error) {
      if (error.code === "23505")
        throw new Error(`Ese laboratorio ya tiene un trabajo llamado "${data.name}".`);
      throw new Error(mensajeDb(error, "No pudimos guardar el trabajo del catálogo."));
    }
    if (!guardado) throw new Error("Ese trabajo no existe.");
    return { id: guardado.id };
  });

/** No se borra (las órdenes guardan su nombre): se desactiva o reactiva. */
export const setLabCatalogItemActive = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), id: z.string().uuid(), isActive: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireClinicRole(
      context.supabase,
      data.clinicId,
      context.userId,
      ROLES_GESTIONAN_CATALOGO_LABORATORIO,
      "No tienes permisos para editar el catálogo del laboratorio.",
    );
    const { data: fila, error } = await context.supabase
      .from("lab_catalog_items")
      .update({ is_active: data.isActive })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos actualizar el trabajo."));
    if (!fila) throw new Error("Ese trabajo no existe.");
    return { ok: true };
  });
