/**
 * FIC-15 · Protocolos clínicos: server functions. RLS del usuario: los leen
 * los roles clínicos (owner/admin/dentist/assistant) y los administran
 * owner/admin/dentist. No se borran: se desactivan.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { leerPasos, protocoloSchema, type ProtocoloClinico } from "@/lib/clinical/protocolos";
import { mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

const SIN_PERMISO = "No tienes permisos para editar los protocolos clínicos.";

export const listProtocolosClinicos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), soloActivos: z.boolean().default(true) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ProtocoloClinico[]> => {
    let consulta = context.supabase
      .from("clinical_protocols")
      .select("id, name, procedure_label, steps, indications, active, updated_at")
      .eq("clinic_id", data.clinicId)
      .order("name", { ascending: true });
    if (data.soloActivos) consulta = consulta.eq("active", true);
    const { data: filas, error } = await consulta;
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los protocolos clínicos."));
    return (filas ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      procedureLabel: p.procedure_label,
      steps: leerPasos(p.steps),
      indications: p.indications,
      active: p.active,
      updatedAt: p.updated_at,
    }));
  });

export const guardarProtocoloClinico = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), protocolId: z.string().uuid().optional() })
      .and(protocoloSchema)
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const valores = {
      name: data.name,
      procedure_label: data.procedureLabel ?? null,
      steps: data.steps,
      indications: data.indications ?? null,
    };
    const duplicado = (m?: string) =>
      /clinical_protocols_nombre_unico|duplicate key/i.test(m ?? "")
        ? "Ya hay un protocolo con ese nombre."
        : null;
    if (data.protocolId) {
      const { data: filas, error } = await context.supabase
        .from("clinical_protocols")
        .update(valores)
        .eq("id", data.protocolId)
        .eq("clinic_id", data.clinicId)
        .select("id");
      if (error) throw new Error(duplicado(error.message) ?? mensajeDb(error, SIN_PERMISO));
      if (!filas?.length) throw new Error(SIN_PERMISO);
      return { id: data.protocolId };
    }
    const { data: fila, error } = await context.supabase
      .from("clinical_protocols")
      .insert({ ...valores, clinic_id: data.clinicId, created_by: context.userId })
      .select("id")
      .single();
    if (error || !fila) throw new Error(duplicado(error?.message) ?? mensajeDb(error, SIN_PERMISO));
    return { id: fila.id };
  });

export const setProtocoloActivo = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        protocolId: z.string().uuid(),
        active: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: filas, error } = await context.supabase
      .from("clinical_protocols")
      .update({ active: data.active })
      .eq("id", data.protocolId)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    if (!filas?.length) throw new Error(SIN_PERMISO);
    return { ok: true };
  });
