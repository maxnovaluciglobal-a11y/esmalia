import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";
import {
  hayFiltros,
  normalizarFiltros,
  type FiltrosDePacientes,
} from "@/lib/patients/filtros-pacientes";
import { resolverSegmento, type SegmentoResuelto } from "@/lib/patients/segmentos.server";

/**
 * Segmentos de pacientes guardados (PAC-06): CRUD. Los permisos los pone la
 * RLS de `patient_segments` (migración 20261105100000): leer, cualquier
 * miembro; crear y editar, `patients:manage`; borrar, quien lo creó u
 * owner/admin. Para resolver un segmento a su lista de pacientes desde el
 * servidor, ver `resolverSegmento` en `segmentos.server.ts`.
 */

export interface Segmento {
  id: string;
  nombre: string;
  descripcion: string | null;
  filtros: FiltrosDePacientes;
  creadoPor: string | null;
  actualizadoEl: string;
}

function mensajeSegmento(error: { code?: string; message?: string }, porDefecto: string) {
  if (error.code === "23505") return "Ya tienes un segmento con ese nombre.";
  return mensajeDb(error, porDefecto);
}

const Nombre = z
  .string()
  .transform((v) => v.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(2, "Ponle un nombre al segmento (al menos 2 letras).")
      .max(60, "Usa hasta 60 caracteres."),
  );

const Filtros = z
  .unknown()
  .transform((v) => normalizarFiltros(v))
  .refine(hayFiltros, { message: "Elige al menos un filtro antes de guardar el segmento." });

export const listPatientSegments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Segmento[]> => {
    const { data: filas, error } = await context.supabase
      .from("patient_segments")
      .select("id, name, description, filters, created_by, updated_at")
      .eq("clinic_id", data.clinicId)
      .order("name", { ascending: true })
      .limit(200);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los segmentos."));
    return (filas ?? []).map((f) => ({
      id: f.id,
      nombre: f.name,
      descripcion: f.description,
      filtros: normalizarFiltros(f.filters),
      creadoPor: f.created_by,
      actualizadoEl: f.updated_at,
    }));
  });

export const savePatientSegment = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        /** Sin id = segmento nuevo. */
        segmentId: z.string().uuid().optional(),
        nombre: Nombre,
        descripcion: z
          .string()
          .trim()
          .max(200)
          .optional()
          .transform((v) => v || null),
        filtros: Filtros,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const fila = {
      name: data.nombre,
      description: data.descripcion,
      filters: data.filtros as unknown as Json,
    };
    if (data.segmentId) {
      const { data: actualizado, error } = await context.supabase
        .from("patient_segments")
        .update(fila)
        .eq("id", data.segmentId)
        .eq("clinic_id", data.clinicId)
        .select("id")
        .maybeSingle();
      if (error)
        throw new Error(mensajeSegmento(error, "No tienes permisos para editar segmentos."));
      if (!actualizado) throw new Error("No tienes permisos para editar este segmento.");
      return { id: actualizado.id };
    }
    const { data: creado, error } = await context.supabase
      .from("patient_segments")
      .insert({ ...fila, clinic_id: data.clinicId })
      .select("id")
      .single();
    if (error) throw new Error(mensajeSegmento(error, "No tienes permisos para crear segmentos."));
    return { id: creado.id };
  });

export const deletePatientSegment = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), segmentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: fila, error } = await context.supabase
      .from("patient_segments")
      .delete()
      .eq("id", data.segmentId)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para borrar segmentos."));
    if (!fila)
      throw new Error(
        "Solo quien creó el segmento, el propietario o un administrador puede borrarlo.",
      );
    return { ok: true };
  });

/**
 * Lista de pacientes de un segmento, para el cliente (vista previa de una
 * campaña). Envuelve `resolverSegmento` con la sesión del usuario.
 */
export const resolvePatientSegment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), segmentId: z.string().uuid() }).parse(input),
  )
  .handler(({ data, context }): Promise<SegmentoResuelto> =>
    resolverSegmento(context.supabase, {
      clinicId: data.clinicId,
      userId: context.userId,
      segmentId: data.segmentId,
    }),
  );
