import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

export type ProfessionalDetail = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  licenseNumber: string | null;
  color: string;
  isActive: boolean;
  branchId: string | null;
  branchName: string | null;
  specialtyId: string | null;
  specialtyName: string | null;
};

/** Bloque de horario de un día de la semana. 0 = domingo … 6 = sábado
 * (igual que Date.getDay()). Un día sin bloque = no atiende ese día. */
export type ScheduleBlock = { dayOfWeek: number; startTime: string; endTime: string };

const timeRegex = /^\d{2}:\d{2}$/;

/** Profesionales con detalle completo (incluye inactivos) para la pantalla
 * de administración. listProfessionals en clinic-catalog.functions.ts es la
 * versión liviana usada por la agenda (solo activos). */
export const listProfessionalsDetailed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ProfessionalDetail[]> => {
    const { supabase } = context;

    const { data: rows, error } = await supabase
      .from("professionals")
      .select(
        "id, full_name, email, phone, license_number, color, is_active, branch_id, specialty_id",
      )
      .eq("clinic_id", data.clinicId)
      .order("full_name", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los profesionales."));

    const branchIds = [
      ...new Set((rows ?? []).map((r) => r.branch_id).filter(Boolean)),
    ] as string[];
    const specialtyIds = [
      ...new Set((rows ?? []).map((r) => r.specialty_id).filter(Boolean)),
    ] as string[];

    const [{ data: branches, error: branchErr }, { data: specialties, error: specErr }] =
      await Promise.all([
        supabase
          .from("branches")
          .select("id, name")
          .in("id", branchIds.length ? branchIds : [""]),
        supabase
          .from("specialties")
          .select("id, name")
          .in("id", specialtyIds.length ? specialtyIds : [""]),
      ]);
    if (branchErr) throw new Error(mensajeDb(branchErr, "No pudimos cargar las sucursales."));
    if (specErr) throw new Error(mensajeDb(specErr, "No pudimos cargar las especialidades."));

    const branchById = new Map((branches ?? []).map((b) => [b.id, b.name]));
    const specialtyById = new Map((specialties ?? []).map((s) => [s.id, s.name]));

    return (rows ?? []).map((r) => ({
      id: r.id,
      fullName: r.full_name,
      email: r.email,
      phone: r.phone,
      licenseNumber: r.license_number,
      color: r.color,
      isActive: r.is_active,
      branchId: r.branch_id,
      branchName: r.branch_id ? (branchById.get(r.branch_id) ?? null) : null,
      specialtyId: r.specialty_id,
      specialtyName: r.specialty_id ? (specialtyById.get(r.specialty_id) ?? null) : null,
    }));
  });

const professionalInputSchema = z.object({
  fullName: z.string().trim().min(2, "Nombre requerido").max(120),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  licenseNumber: z.string().trim().max(60).optional().or(z.literal("")),
  color: z.string().trim().min(1).max(20),
  branchId: z.string().uuid().nullable(),
  specialtyId: z.string().uuid().nullable(),
});

/** Alta de profesional fuera del onboarding inicial — mismo gap que
 * branches.functions.ts::createBranch: antes solo se podían cargar
 * profesionales durante el wizard de primera configuración. */
export const createProfessional = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), professional: professionalInputSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("professionals").insert({
      clinic_id: data.clinicId,
      full_name: data.professional.fullName.trim(),
      email: data.professional.email?.trim() || null,
      phone: data.professional.phone?.trim() || null,
      license_number: data.professional.licenseNumber?.trim() || null,
      color: data.professional.color,
      branch_id: data.professional.branchId,
      specialty_id: data.professional.specialtyId,
    });
    if (error) throw new Error("No tienes permisos para agregar profesionales.");
    return { ok: true };
  });

export const updateProfessional = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        professionalId: z.string().uuid(),
        professional: professionalInputSchema,
        isActive: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("professionals")
      .update({
        full_name: data.professional.fullName.trim(),
        email: data.professional.email?.trim() || null,
        phone: data.professional.phone?.trim() || null,
        license_number: data.professional.licenseNumber?.trim() || null,
        color: data.professional.color,
        branch_id: data.professional.branchId,
        specialty_id: data.professional.specialtyId,
        is_active: data.isActive,
      })
      .eq("id", data.professionalId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error("No tienes permisos para editar este profesional.");
    return { ok: true };
  });

/** Horario semanal declarado de un profesional. Array vacío = sin
 * restricción declarada (createAppointment no bloquea nada en ese caso). */
export const getProfessionalSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), professionalId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ScheduleBlock[]> => {
    const { data: rows, error } = await context.supabase
      .from("professional_schedules")
      .select("day_of_week, start_time, end_time")
      .eq("clinic_id", data.clinicId)
      .eq("professional_id", data.professionalId)
      .order("day_of_week", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el horario del profesional."));
    return (rows ?? []).map((r) => ({
      dayOfWeek: r.day_of_week,
      startTime: r.start_time.slice(0, 5),
      endTime: r.end_time.slice(0, 5),
    }));
  });

/**
 * Horario declarado de TODOS los profesionales de la clínica, en una sola
 * consulta: la agenda lo usa para el arrastre (límites y colación) y para la
 * ocupación por día de la semana. profesionalId → bloques; un profesional sin
 * filas no aparece (= sin restricción declarada).
 */
export const listProfessionalSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Record<string, ScheduleBlock[]>> => {
    const { data: rows, error } = await context.supabase
      .from("professional_schedules")
      .select("professional_id, day_of_week, start_time, end_time")
      .eq("clinic_id", data.clinicId)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los horarios de la clínica."));
    const porProfesional: Record<string, ScheduleBlock[]> = {};
    for (const r of rows ?? []) {
      (porProfesional[r.professional_id] ??= []).push({
        dayOfWeek: r.day_of_week,
        startTime: r.start_time.slice(0, 5),
        endTime: r.end_time.slice(0, 5),
      });
    }
    return porProfesional;
  });

/** Reemplaza el horario completo del profesional (delete + insert) — más
 * simple y a prueba de duplicados que un diff incremental para una grilla
 * de 7 días que el usuario edita como un todo. */
export const setProfessionalSchedule = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        professionalId: z.string().uuid(),
        blocks: z
          .array(
            z.object({
              dayOfWeek: z.number().int().min(0).max(6),
              startTime: z.string().regex(timeRegex),
              endTime: z.string().regex(timeRegex),
            }),
          )
          .refine((blocks) => blocks.every((b) => b.startTime < b.endTime), {
            message: "La hora de inicio debe ser antes que la de cierre.",
          }),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { error: deleteError } = await supabase
      .from("professional_schedules")
      .delete()
      .eq("clinic_id", data.clinicId)
      .eq("professional_id", data.professionalId);
    if (deleteError) throw new Error("No tienes permisos para editar este horario.");

    if (data.blocks.length > 0) {
      const { error: insertError } = await supabase.from("professional_schedules").insert(
        data.blocks.map((b) => ({
          clinic_id: data.clinicId,
          professional_id: data.professionalId,
          day_of_week: b.dayOfWeek,
          start_time: b.startTime,
          end_time: b.endTime,
        })),
      );
      if (insertError)
        throw new Error(mensajeDb(insertError, "No pudimos guardar el horario del profesional."));
    }

    return { ok: true };
  });
