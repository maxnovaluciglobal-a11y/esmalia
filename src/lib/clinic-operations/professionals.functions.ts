import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { atiendePacientes } from "@/lib/clinic-operations/cita-formulario";
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
  /** EQU-04: marca explícita (null = se deduce del rol). */
  attendsPatients: boolean | null;
  /** Lo que vale hoy: la marca o, sin marca, lo deducido del rol (AGE-17). */
  atiende: boolean;
};

/** Bloque de horario de un día de la semana. 0 = domingo … 6 = sábado
 * (igual que Date.getDay()). Un día sin bloque = no atiende ese día.
 * `branchId` (AGE-23): sucursal donde atiende ese bloque; null = cualquiera
 * (las filas anteriores a la Ola 2). */
export type ScheduleBlock = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  branchId: string | null;
};

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
        "id, full_name, email, phone, license_number, color, is_active, branch_id, specialty_id, user_id, attends_patients",
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

    const userIds = [...new Set((rows ?? []).map((r) => r.user_id).filter(Boolean))] as string[];

    const [
      { data: branches, error: branchErr },
      { data: specialties, error: specErr },
      { data: miembros, error: miembrosErr },
    ] = await Promise.all([
      supabase
        .from("branches")
        .select("id, name")
        .in("id", branchIds.length ? branchIds : [""]),
      supabase
        .from("specialties")
        .select("id, name")
        .in("id", specialtyIds.length ? specialtyIds : [""]),
      supabase
        .from("clinic_members")
        .select("user_id, role")
        .eq("clinic_id", data.clinicId)
        .in("user_id", userIds.length ? userIds : [""]),
    ]);
    if (branchErr) throw new Error(mensajeDb(branchErr, "No pudimos cargar las sucursales."));
    if (specErr) throw new Error(mensajeDb(specErr, "No pudimos cargar las especialidades."));
    if (miembrosErr)
      throw new Error(mensajeDb(miembrosErr, "No pudimos cargar los roles del equipo."));
    const rolPorUsuario = new Map((miembros ?? []).map((m) => [m.user_id, m.role]));

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
      attendsPatients: r.attends_patients,
      atiende: atiendePacientes(
        r.user_id ? (rolPorUsuario.get(r.user_id) ?? null) : null,
        r.attends_patients,
      ),
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

/**
 * EQU-04: marca "Atiende pacientes". true/false manda sobre el rol; null
 * vuelve a deducirlo del rol (AGE-17). Solo owner/admin (par de la RLS de
 * `professionals`, que ya restringe el UPDATE).
 */
export const setAtiendePacientes = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        professionalId: z.string().uuid(),
        atiende: z.boolean().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireClinicPermission(
      context.supabase,
      data.clinicId,
      context.userId,
      "settings:manage",
      "No tienes permisos para cambiar quién atiende pacientes.",
    );
    const { data: fila, error } = await context.supabase
      .from("professionals")
      .update({ attends_patients: data.atiende })
      .eq("id", data.professionalId)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error || !fila) throw new Error("No tienes permisos para editar este profesional.");
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
      .select("day_of_week, start_time, end_time, branch_id")
      .eq("clinic_id", data.clinicId)
      .eq("professional_id", data.professionalId)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el horario del profesional."));
    return (rows ?? []).map((r) => ({
      dayOfWeek: r.day_of_week,
      startTime: r.start_time.slice(0, 5),
      endTime: r.end_time.slice(0, 5),
      branchId: r.branch_id,
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
      .select("professional_id, day_of_week, start_time, end_time, branch_id")
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
        branchId: r.branch_id,
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
              // AGE-23. Ausente (cliente anterior) = cualquier sucursal.
              branchId: z.string().uuid().nullish(),
            }),
          )
          .max(42)
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
          branch_id: b.branchId ?? null,
        })),
      );
      if (insertError)
        throw new Error(mensajeDb(insertError, "No pudimos guardar el horario del profesional."));
    }

    return { ok: true };
  });
