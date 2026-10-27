import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { leerTodasLasPaginas } from "@/lib/paginacion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";
import {
  COLORES_ETIQUETA,
  colorEtiqueta,
  LARGO_MAXIMO_ETIQUETA,
  limpiarNombreEtiqueta,
  ordenarEtiquetas,
  type Etiqueta,
} from "@/lib/patients/etiquetas";

/**
 * Etiquetas de pacientes (PAC-07): catálogo por clínica y asignación. Los
 * permisos reales los pone la RLS de `patient_labels` y
 * `patient_label_assignments` (migración 20261105100000): leer, cualquier
 * miembro; crear y asignar, los roles con `patients:manage`; borrar del
 * catálogo, owner/admin. Acá se valida la forma y se traduce el error.
 */

/** Unicidad del nombre (índice `patient_labels_nombre_unico`). */
function mensajeEtiqueta(error: { code?: string; message?: string }, porDefecto: string) {
  if (error.code === "23505") return "Ya existe una etiqueta con ese nombre.";
  return mensajeDb(error, porDefecto);
}

const Nombre = z
  .string()
  .transform(limpiarNombreEtiqueta)
  .pipe(z.string().min(1, "Escribe el nombre de la etiqueta.").max(LARGO_MAXIMO_ETIQUETA));

export const listPatientLabels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Etiqueta[]> => {
    const { data: filas, error } = await context.supabase
      .from("patient_labels")
      .select("id, name, color")
      .eq("clinic_id", data.clinicId)
      .order("name", { ascending: true })
      .limit(500);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las etiquetas."));
    return ordenarEtiquetas(
      (filas ?? []).map((f) => ({ id: f.id, nombre: f.name, color: colorEtiqueta(f.color) })),
    );
  });

export const createPatientLabel = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        nombre: Nombre,
        color: z.enum(COLORES_ETIQUETA),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<Etiqueta> => {
    const { data: fila, error } = await context.supabase
      .from("patient_labels")
      .insert({ clinic_id: data.clinicId, name: data.nombre, color: data.color })
      .select("id, name, color")
      .single();
    if (error) throw new Error(mensajeEtiqueta(error, "No tienes permisos para crear etiquetas."));
    return { id: fila.id, nombre: fila.name, color: colorEtiqueta(fila.color) };
  });

export const updatePatientLabel = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        labelId: z.string().uuid(),
        nombre: Nombre,
        color: z.enum(COLORES_ETIQUETA),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: fila, error } = await context.supabase
      .from("patient_labels")
      .update({ name: data.nombre, color: data.color })
      .eq("id", data.labelId)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeEtiqueta(error, "No tienes permisos para editar etiquetas."));
    if (!fila) throw new Error("No tienes permisos para editar esta etiqueta.");
    return { ok: true };
  });

/** Borra la etiqueta del catálogo y, por la FK, de todas las fichas. Solo owner/admin (RLS). */
export const deletePatientLabel = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), labelId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: fila, error } = await context.supabase
      .from("patient_labels")
      .delete()
      .eq("id", data.labelId)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para borrar etiquetas."));
    if (!fila) throw new Error("Solo el propietario o un administrador puede borrar etiquetas.");
    return { ok: true };
  });

/** Ids de las etiquetas de un paciente (encabezado de la ficha). */
export const listLabelsOfPatient = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<string[]> => {
    const { data: filas, error } = await context.supabase
      .from("patient_label_assignments")
      .select("label_id")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .limit(200);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las etiquetas."));
    return (filas ?? []).map((f) => f.label_id);
  });

/** Tope de fichas por cambio masivo de etiquetas. */
export const TOPE_ETIQUETADO_MASIVO = 500;

/**
 * Pone y saca etiquetas a una o varias fichas (PAC-07, también masivo desde
 * la selección de la lista). `agregar` se inserta sin duplicar; `quitar` se
 * borra. Devuelve cuántas asignaciones cambiaron.
 */
export const setPatientsLabels = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientIds: z.array(z.string().uuid()).min(1).max(TOPE_ETIQUETADO_MASIVO),
        agregar: z.array(z.string().uuid()).max(50).default([]),
        quitar: z.array(z.string().uuid()).max(50).default([]),
      })
      .refine((d) => d.agregar.length + d.quitar.length > 0, {
        message: "Elige qué etiquetas poner o sacar.",
      })
      .refine((d) => !d.agregar.some((id) => d.quitar.includes(id)), {
        message: "Una etiqueta no se puede poner y sacar a la vez.",
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ agregadas: number; quitadas: number }> => {
    const { supabase } = context;
    const pacientes = [...new Set(data.patientIds)];
    let agregadas = 0;
    let quitadas = 0;

    if (data.agregar.length > 0) {
      const filas = pacientes.flatMap((patient_id) =>
        data.agregar.map((label_id) => ({ clinic_id: data.clinicId, patient_id, label_id })),
      );
      const { data: insertadas, error } = await supabase
        .from("patient_label_assignments")
        .upsert(filas, { onConflict: "patient_id,label_id", ignoreDuplicates: true })
        .select("patient_id");
      if (error) throw new Error(mensajeDb(error, "No tienes permisos para etiquetar pacientes."));
      agregadas = insertadas?.length ?? 0;
    }

    if (data.quitar.length > 0) {
      const { data: borradas, error } = await supabase
        .from("patient_label_assignments")
        .delete()
        .eq("clinic_id", data.clinicId)
        .in("patient_id", pacientes)
        .in("label_id", data.quitar)
        .select("patient_id");
      if (error) throw new Error(mensajeDb(error, "No tienes permisos para quitar etiquetas."));
      quitadas = borradas?.length ?? 0;
    }
    return { agregadas, quitadas };
  });

/** Cuántas fichas tiene cada etiqueta (gestión del catálogo). */
export const countPatientLabelUses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Record<string, number>> => {
    const { filas, error } = await leerTodasLasPaginas((desde, hasta) =>
      context.supabase
        .from("patient_label_assignments")
        .select("label_id, patient_id")
        .eq("clinic_id", data.clinicId)
        .order("label_id", { ascending: true })
        .order("patient_id", { ascending: true })
        .range(desde, hasta),
    );
    if (error) throw new Error(mensajeDb(error, "No pudimos contar las etiquetas."));
    const usos: Record<string, number> = {};
    for (const f of filas) usos[f.label_id] = (usos[f.label_id] ?? 0) + 1;
    return usos;
  });
