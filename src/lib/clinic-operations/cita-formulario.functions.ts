import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Datos del formulario de cita (Ola 1 · frente cita): tipos de cita
 * (AGE-11), procedimientos frecuentes (AGE-12), boxes (AGE-14) y lo que el
 * diálogo de edición necesita de una cita y no viaja en el listado de la
 * agenda (tipo, box y observaciones internas).
 */

// ─── TIPOS DE CITA ───────────────────────────────────────────────────────

export interface TipoDeCita {
  id: string;
  nombre: string;
  activo: boolean;
  posicion: number;
}

export const listAppointmentTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), incluirInactivos: z.boolean().default(false) })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<TipoDeCita[]> => {
    let query = context.supabase
      .from("appointment_types")
      .select("id, name, is_active, position")
      .eq("clinic_id", data.clinicId);
    if (!data.incluirInactivos) query = query.eq("is_active", true);
    const { data: rows, error } = await query
      .order("position", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los tipos de cita."));
    return (rows ?? []).map((r) => ({
      id: r.id,
      nombre: r.name,
      activo: r.is_active,
      posicion: r.position,
    }));
  });

const SIN_PERMISO_TIPOS =
  "No tienes permisos para configurar los tipos de cita. Pídeselo a quien administra la clínica.";

/**
 * Crear o renombrar un tipo de cita. Solo owner y admin: lo exige la RLS de
 * `appointment_types` (`can_manage_clinic`), que es el par en el servidor del
 * `settings:manage` de la pantalla. Un UPDATE que la RLS filtra no da error,
 * solo no toca filas: por eso se pide la fila de vuelta y, si no vuelve, se
 * avisa que no hay permiso.
 */
export const upsertAppointmentType = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        typeId: z.string().uuid().nullish(),
        nombre: z.string().trim().min(1, "El nombre es obligatorio.").max(60),
        posicion: z.number().int().min(0).max(999).default(99),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const fila = { name: data.nombre, position: data.posicion };
    const { data: filas, error } = data.typeId
      ? await context.supabase
          .from("appointment_types")
          .update(fila)
          .eq("id", data.typeId)
          .eq("clinic_id", data.clinicId)
          .select("id")
      : await context.supabase
          .from("appointment_types")
          .insert({ clinic_id: data.clinicId, ...fila })
          .select("id");
    if (error) {
      if (error.code === "23505") throw new Error(`Ya existe un tipo llamado "${data.nombre}".`);
      throw new Error(mensajeDb(error, SIN_PERMISO_TIPOS));
    }
    const id = filas?.[0]?.id;
    if (!id) throw new Error(SIN_PERMISO_TIPOS);
    return { id };
  });

/** Deshabilitar saca el tipo de los botones del formulario; las citas que ya lo tienen lo conservan. */
export const setAppointmentTypeActive = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), typeId: z.string().uuid(), activo: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: filas, error } = await context.supabase
      .from("appointment_types")
      .update({ is_active: data.activo })
      .eq("id", data.typeId)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO_TIPOS));
    if (!filas?.length) throw new Error(SIN_PERMISO_TIPOS);
    return { ok: true };
  });

// ─── PROCEDIMIENTOS FRECUENTES ───────────────────────────────────────────

/** Ventana del "más agendados": los últimos 90 días. */
export const DIAS_FRECUENTES = 90;

export interface UsoDeProcedimientos {
  /** Ids marcados con estrella en el arancel. */
  favoritos: string[];
  /** Citas por procedimiento en los últimos 90 días, de más a menos. */
  usos: { procedureId: string; usos: number }[];
}

/**
 * Insumos de los botones de procedimientos frecuentes. Los junta y ordena
 * `elegirProcedimientosFrecuentes` (cita-formulario.ts) en el cliente, que ya
 * tiene el arancel cargado para el autocompletado. El conteo lo hace la base
 * (`procedimientos_frecuentes`, SECURITY INVOKER): miles de citas no viajan.
 */
export const listFrequentProcedures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<UsoDeProcedimientos> => {
    const desde = new Date(Date.now() - DIAS_FRECUENTES * 86_400_000).toISOString();
    const [favoritosRes, usosRes] = await Promise.all([
      context.supabase
        .from("procedures")
        .select("id")
        .eq("clinic_id", data.clinicId)
        .eq("is_active", true)
        .eq("is_favorite", true),
      context.supabase.rpc("procedimientos_frecuentes", {
        p_clinic_id: data.clinicId,
        p_desde: desde,
        p_limite: 12,
      }),
    ]);
    if (favoritosRes.error)
      throw new Error(
        mensajeDb(favoritosRes.error, "No pudimos cargar los favoritos del arancel."),
      );
    if (usosRes.error)
      throw new Error(mensajeDb(usosRes.error, "No pudimos cargar los procedimientos frecuentes."));
    return {
      favoritos: (favoritosRes.data ?? []).map((r) => r.id),
      usos: (usosRes.data ?? []).map((r) => ({
        procedureId: r.procedure_id,
        usos: Number(r.usos),
      })),
    };
  });

/** Marca o desmarca un procedimiento del arancel como favorito (estrella). */
export const setProcedureFavorite = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        procedureId: z.string().uuid(),
        favorito: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: filas, error } = await context.supabase
      .from("procedures")
      .update({ is_favorite: data.favorito })
      .eq("id", data.procedureId)
      .eq("clinic_id", data.clinicId)
      .select("id");
    const sinPermiso = "No tienes permisos para editar el arancel.";
    if (error) throw new Error(mensajeDb(error, sinPermiso));
    if (!filas?.length) throw new Error(sinPermiso);
    return { ok: true };
  });

// ─── BOXES ───────────────────────────────────────────────────────────────

export interface Box {
  id: string;
  nombre: string;
  sucursalId: string;
}

/** Boxes activos de la clínica, para el selector del formulario de cita (AGE-14). */
export const listOperatories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Box[]> => {
    const { data: rows, error } = await context.supabase
      .from("operatories")
      .select("id, name, branch_id")
      .eq("clinic_id", data.clinicId)
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los boxes."));
    return (rows ?? []).map((r) => ({ id: r.id, nombre: r.name, sucursalId: r.branch_id }));
  });

// ─── DETALLE PARA EDITAR ─────────────────────────────────────────────────

export interface DetalleCitaFormulario {
  tipoId: string | null;
  tipoNombre: string | null;
  boxId: string | null;
  observaciones: string;
}

/**
 * Lo que el diálogo "Editar cita" necesita y el listado de la agenda no trae.
 * Las observaciones internas no viajan en el listado a propósito: no se
 * guardan en la caché sin conexión del equipo ni salen en ningún aviso.
 */
export const getAppointmentFormDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), appointmentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<DetalleCitaFormulario> => {
    const { data: fila, error } = await context.supabase
      .from("appointments")
      .select("appointment_type_id, appointment_type_name, operatory_id, notes")
      .eq("clinic_id", data.clinicId)
      .eq("id", data.appointmentId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos leer la cita."));
    if (!fila) throw new Error("La cita no existe o no es tuya.");
    return {
      tipoId: fila.appointment_type_id,
      tipoNombre: fila.appointment_type_name,
      boxId: fila.operatory_id,
      observaciones: fila.notes ?? "",
    };
  });
