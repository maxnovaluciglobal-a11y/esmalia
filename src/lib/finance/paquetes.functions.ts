import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicRole } from "@/lib/access/clinic-guards.server";
import { isUndefinedTableError, mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Paquetes de prestaciones (PLA-12): combos del arancel con precio cerrado.
 * Se arman en /presupuestos/paquetes y se suman al presupuesto de una vez
 * desde el editor (las líneas se copian: `lineasDePaquete` en
 * calculo-presupuesto.ts).
 */
export interface LineaPaquete {
  id: string;
  procedureId: string | null;
  nameSnapshot: string;
  quantity: number;
  position: number;
}

export interface Paquete {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  isActive: boolean;
  position: number;
  items: LineaPaquete[];
}

/** Mismos roles que escriben el arancel (`procedures`) y la RLS de los paquetes. */
const ROLES_ARANCEL = ["owner", "admin", "dentist"] as const;

export const listPaquetes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), incluirInactivos: z.boolean().default(false) })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<Paquete[]> => {
    const { supabase } = context;
    let consulta = supabase
      .from("procedure_packages")
      .select("id, name, description, price_cents, currency, is_active, position")
      .eq("clinic_id", data.clinicId)
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (!data.incluirInactivos) consulta = consulta.eq("is_active", true);
    const { data: filas, error } = await consulta;
    // Base sin la migración 20261024200100: no hay paquetes todavía.
    if (error && isUndefinedTableError(error)) return [];
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los paquetes."));
    if (!filas?.length) return [];

    const { data: lineas, error: lErr } = await supabase
      .from("procedure_package_items")
      .select("id, package_id, procedure_id, name_snapshot, quantity, position")
      .eq("clinic_id", data.clinicId)
      .order("position", { ascending: true });
    if (lErr)
      throw new Error(mensajeDb(lErr, "No pudimos cargar las prestaciones de los paquetes."));

    const porPaquete = new Map<string, LineaPaquete[]>();
    for (const l of lineas ?? []) {
      const arr = porPaquete.get(l.package_id) ?? [];
      arr.push({
        id: l.id,
        procedureId: l.procedure_id,
        nameSnapshot: l.name_snapshot,
        quantity: l.quantity,
        position: l.position,
      });
      porPaquete.set(l.package_id, arr);
    }
    return filas.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priceCents: p.price_cents,
      currency: p.currency,
      isActive: p.is_active,
      position: p.position,
      items: porPaquete.get(p.id) ?? [],
    }));
  });

const LineaInput = z.object({
  procedureId: z.string().uuid().nullish(),
  nameSnapshot: z.string().trim().min(1, "Cada prestación necesita un nombre.").max(200),
  quantity: z.number().int().min(1).max(20).default(1),
});

/** Crea o edita un paquete. Las líneas se reemplazan enteras (es un catálogo). */
export const guardarPaquete = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1, "Ponle un nombre al paquete.").max(120),
        description: z.string().trim().max(500).optional(),
        priceCents: z.number().int().min(0),
        items: z.array(LineaInput).min(1, "Agrega al menos una prestación.").max(30),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    await requireClinicRole(
      supabase,
      data.clinicId,
      userId,
      ROLES_ARANCEL,
      "No tienes permisos para editar los paquetes.",
    );

    const fila = {
      name: data.name,
      description: data.description || null,
      price_cents: data.priceCents,
    };
    let id = data.id;
    if (id) {
      const { error } = await supabase
        .from("procedure_packages")
        .update(fila)
        .eq("id", id)
        .eq("clinic_id", data.clinicId);
      if (error) throw new Error(mensajeDb(error, "No pudimos guardar el paquete."));
      const { error: delErr } = await supabase
        .from("procedure_package_items")
        .delete()
        .eq("package_id", id)
        .eq("clinic_id", data.clinicId);
      if (delErr) throw new Error(mensajeDb(delErr, "No pudimos actualizar las prestaciones."));
    } else {
      const { data: nuevo, error } = await supabase
        .from("procedure_packages")
        .insert({ ...fila, clinic_id: data.clinicId })
        .select("id")
        .single();
      if (error) throw new Error(mensajeDb(error, "No pudimos crear el paquete."));
      id = nuevo.id;
    }

    const { error: insErr } = await supabase.from("procedure_package_items").insert(
      data.items.map((it, i) => ({
        clinic_id: data.clinicId,
        package_id: id!,
        procedure_id: it.procedureId ?? null,
        name_snapshot: it.nameSnapshot,
        quantity: it.quantity,
        position: i,
      })),
    );
    if (insErr)
      throw new Error(mensajeDb(insErr, "No pudimos guardar las prestaciones del paquete."));
    return { id: id! };
  });

/** Activa o desactiva un paquete. Los presupuestos que ya lo usan no cambian. */
export const setPaqueteActivo = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), id: z.string().uuid(), isActive: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await requireClinicRole(
      supabase,
      data.clinicId,
      userId,
      ROLES_ARANCEL,
      "No tienes permisos para editar los paquetes.",
    );
    const { error } = await supabase
      .from("procedure_packages")
      .update({ is_active: data.isActive })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos cambiar el paquete."));
    return { ok: true };
  });
