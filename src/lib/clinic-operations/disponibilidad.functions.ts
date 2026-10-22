import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { addDaysISO } from "@/lib/clinic-operations/agenda-fechas";
import {
  COLUMNAS_EXCEPCION,
  conNombresDeBox,
  leerAjustesAgenda,
} from "@/lib/clinic-operations/disponibilidad-db";
import {
  INTERVALOS_GRILLA,
  MOTIVOS_BLOQUEO,
  problemaDeExcepcion,
  tramoDelDia,
  type AjustesAgenda,
  type BloqueSemanal,
  type ExcepcionAgenda,
} from "@/lib/clinic-operations/disponibilidad";
import { mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Server functions de disponibilidad de la agenda (Ola 2): bloqueos y
 * aperturas (AGE-07, AGE-08) y configuración de la agenda (AGE-10).
 *
 * Escribir es de owner y admin: lo exige la RLS de las tres tablas
 * (`can_manage_clinic`), que es el par en el servidor del `settings:manage`
 * de la UI. Un UPDATE o DELETE que la RLS filtra no da error, solo no toca
 * filas: por eso se pide la fila de vuelta y, si no vuelve, se avisa.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

const SIN_PERMISO_BLOQUEOS =
  "No tienes permisos para bloquear o abrir horarios. Pídeselo a quien administra la clínica.";
const SIN_PERMISO_AJUSTES =
  "No tienes permisos para cambiar la configuración de la agenda. Pídeselo a quien administra la clínica.";

// ─── BLOQUEOS Y APERTURAS ────────────────────────────────────────────────

/**
 * Bloqueos y aperturas que tocan el rango de fechas (inclusive), incluidas
 * las que se repiten cada semana. Sin `hasta`: todas las vigentes desde
 * `desde` (la pantalla de configuración). `desde` lo pone quien llama con el
 * hoy de la clínica (regla 7), no el reloj UTC del servidor.
 */
export const listAgendaExceptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        desde: z.string().regex(ISO_DATE),
        hasta: z.string().regex(ISO_DATE).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ExcepcionAgenda[]> => {
    const desde = data.desde;
    let query = context.supabase
      .from("agenda_exceptions")
      .select(COLUMNAS_EXCEPCION)
      .eq("clinic_id", data.clinicId)
      .or(`repeat_weekly.eq.true,ends_local.gt.${desde}T00:00`);
    if (data.hasta) query = query.lt("starts_local", `${addDaysISO(data.hasta, 1)}T00:00`);
    const { data: filas, error } = await query
      .order("starts_local", { ascending: true })
      .limit(1000);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los bloqueos de la agenda."));
    const vigentes = (filas ?? []).filter(
      (f) => !f.repeat_weekly || !f.repeat_until || f.repeat_until >= desde,
    );
    const excepciones = await conNombresDeBox(context.supabase, vigentes);
    if (!data.hasta) return excepciones;
    // Las semanales solo si caen algún día del rango (máximo 7 días a mirar).
    const hasta = data.hasta;
    return excepciones.filter((e) => {
      if (!e.repetirSemanal) return true;
      for (let f = desde, i = 0; f <= hasta && i < 7; f = addDaysISO(f, 1), i++) {
        if (tramoDelDia(e, f)) return true;
      }
      return false;
    });
  });

const excepcionSchema = z
  .object({
    clinicId: z.string().uuid(),
    tipo: z.enum(["bloqueo", "apertura"]),
    motivo: z.enum(MOTIVOS_BLOQUEO).nullable(),
    nota: z.string().trim().max(200).nullish(),
    profesionalId: z.string().uuid().nullable(),
    sucursalId: z.string().uuid().nullable(),
    boxId: z.string().uuid().nullable(),
    inicio: z.string().regex(ISO_LOCAL, "Fecha y hora de inicio inválida."),
    fin: z.string().regex(ISO_LOCAL, "Fecha y hora de término inválida."),
    repetirSemanal: z.boolean(),
    repetirHasta: z.string().regex(ISO_DATE).nullable(),
  })
  .superRefine((v, ctx) => {
    const problema = problemaDeExcepcion({
      tipo: v.tipo,
      motivo: v.tipo === "bloqueo" ? v.motivo : null,
      profesionalId: v.profesionalId,
      inicio: v.inicio,
      fin: v.fin,
      repetirSemanal: v.repetirSemanal,
      repetirHasta: v.repetirHasta,
    });
    if (problema) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problema });
  });

/** Crea un bloqueo (AGE-07) o una apertura excepcional (AGE-08). */
export const createAgendaException = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => excepcionSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: filas, error } = await context.supabase
      .from("agenda_exceptions")
      .insert({
        clinic_id: data.clinicId,
        kind: data.tipo,
        reason: data.tipo === "bloqueo" ? data.motivo : null,
        note: data.nota || null,
        professional_id: data.profesionalId,
        // Una apertura es del profesional: la sucursal no la acota.
        branch_id: data.tipo === "apertura" ? null : data.sucursalId,
        operatory_id: data.tipo === "apertura" ? null : data.boxId,
        starts_local: data.inicio,
        ends_local: data.fin,
        repeat_weekly: data.repetirSemanal,
        repeat_until: data.repetirSemanal ? data.repetirHasta : null,
      })
      .select("id");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO_BLOQUEOS));
    const id = filas?.[0]?.id;
    if (!id) throw new Error(SIN_PERMISO_BLOQUEOS);
    return { id };
  });

/** Quita un bloqueo o una apertura. Las citas no se tocan. */
export const deleteAgendaException = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), exceptionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: filas, error } = await context.supabase
      .from("agenda_exceptions")
      .delete()
      .eq("id", data.exceptionId)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO_BLOQUEOS));
    if (!filas?.length) throw new Error(SIN_PERMISO_BLOQUEOS);
    return { ok: true };
  });

// ─── CONFIGURACIÓN DE LA AGENDA (AGE-10) ─────────────────────────────────

export const getAgendaSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<AjustesAgenda> =>
    leerAjustesAgenda(context.supabase, data.clinicId),
  );

export const saveAgendaSettings = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        pasoMin: z
          .number()
          .int()
          .refine((n) => (INTERVALOS_GRILLA as readonly number[]).includes(n), {
            message: "El intervalo tiene que ser de 10, 15, 20 o 30 minutos.",
          }),
        duracionPorDefecto: z.number().int().min(5).max(480),
        permiteSobrecupos: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: filas, error } = await context.supabase
      .from("clinic_agenda_settings")
      .upsert(
        {
          clinic_id: data.clinicId,
          slot_minutes: data.pasoMin,
          default_duration_min: data.duracionPorDefecto,
          allow_overbooking: data.permiteSobrecupos,
          updated_by: context.userId,
        },
        { onConflict: "clinic_id" },
      )
      .select("clinic_id");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO_AJUSTES));
    if (!filas?.length) throw new Error(SIN_PERMISO_AJUSTES);
    return { ok: true };
  });

/** Horario de atención por sucursal: sucursal → bloques semanales. Sin filas = no declarado. */
export const listBranchHours = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Record<string, BloqueSemanal[]>> => {
    const { data: filas, error } = await context.supabase
      .from("branch_hours")
      .select("branch_id, day_of_week, opens_at, closes_at")
      .eq("clinic_id", data.clinicId)
      .order("day_of_week", { ascending: true })
      .order("opens_at", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el horario de las sucursales."));
    const out: Record<string, BloqueSemanal[]> = {};
    for (const f of filas ?? []) {
      (out[f.branch_id] ??= []).push({
        dayOfWeek: f.day_of_week,
        startTime: f.opens_at.slice(0, 5),
        endTime: f.closes_at.slice(0, 5),
      });
    }
    return out;
  });

/** Reemplaza el horario de atención de una sucursal (delete + insert, como el del profesional). */
export const setBranchHours = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        branchId: z.string().uuid(),
        bloques: z
          .array(
            z.object({
              dayOfWeek: z.number().int().min(0).max(6),
              startTime: z.string().regex(HHMM),
              endTime: z.string().regex(HHMM),
            }),
          )
          .max(28)
          .refine((b) => b.every((x) => x.startTime < x.endTime), {
            message: "La hora de apertura tiene que ser antes que la de cierre.",
          }),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase } = context;
    // La sucursal tiene que ser de la clínica (y visible para quien escribe).
    const { data: sucursal, error: sucErr } = await supabase
      .from("branches")
      .select("id")
      .eq("clinic_id", data.clinicId)
      .eq("id", data.branchId)
      .maybeSingle();
    if (sucErr) throw new Error(mensajeDb(sucErr, "No pudimos verificar la sucursal."));
    if (!sucursal) throw new Error("La sucursal no existe o no es tuya.");

    const { error: delErr } = await supabase
      .from("branch_hours")
      .delete()
      .eq("clinic_id", data.clinicId)
      .eq("branch_id", data.branchId);
    if (delErr) throw new Error(mensajeDb(delErr, SIN_PERMISO_AJUSTES));
    if (data.bloques.length === 0) return { ok: true };

    const { data: filas, error } = await supabase
      .from("branch_hours")
      .insert(
        data.bloques.map((b) => ({
          clinic_id: data.clinicId,
          branch_id: data.branchId,
          day_of_week: b.dayOfWeek,
          opens_at: b.startTime,
          closes_at: b.endTime,
        })),
      )
      .select("id");
    if (error) {
      if (error.code === "23505") throw new Error("Hay dos tramos que empiezan a la misma hora.");
      throw new Error(mensajeDb(error, SIN_PERMISO_AJUSTES));
    }
    if (!filas?.length) throw new Error(SIN_PERMISO_AJUSTES);
    return { ok: true };
  });
