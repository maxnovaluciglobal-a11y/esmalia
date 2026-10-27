import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { appOrigin } from "@/lib/app-origin.server";
import { atiendePacientes } from "@/lib/clinic-operations/cita-formulario";
import { mensajeDb } from "@/lib/db-errors";
import {
  normalizarSlug,
  problemaDeSlug,
  slugsDeProfesionales,
  type MotivoReserva,
} from "@/lib/reserva/reserva";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Configuración de la reserva en línea (RES-02/06, `/reserva-en-linea`).
 * Solo owner/admin (`settings:manage`): el gate de la UI tiene su par acá y
 * en la RLS de `online_booking_settings` (`can_manage_clinic`).
 */

const SIN_PERMISOS = "No tienes permisos para configurar la reserva en línea.";

export interface ConfiguracionReserva {
  existe: boolean;
  enabled: boolean;
  slug: string;
  minNoticeHours: number;
  maxDaysAhead: number;
  procedimientoIds: string[];
  tipoIds: string[];
  nota: string;
  /** Origen público para armar el link, el widget y el QR. */
  origen: string;
  clinica: string;
  procedimientos: MotivoReserva[];
  tipos: MotivoReserva[];
  profesionales: { id: string; nombre: string; slug: string; tieneHorario: boolean }[];
  /** Sucursales sin horario declarado y profesionales sin horario: no ofrecen horas. */
  sucursalesConHorario: number;
  sucursales: number;
}

export const getConfiguracionReserva = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ConfiguracionReserva> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage", SIN_PERMISOS);

    const [
      ajustes,
      clinica,
      procs,
      tipos,
      profs,
      miembros,
      horarios,
      sucursales,
      horasSuc,
      agenda,
    ] = await Promise.all([
      supabase
        .from("online_booking_settings")
        .select("*")
        .eq("clinic_id", data.clinicId)
        .maybeSingle(),
      supabase.from("clinics").select("name").eq("id", data.clinicId).maybeSingle(),
      supabase
        .from("procedures")
        .select("id, name, duration_min, position")
        .eq("clinic_id", data.clinicId)
        .eq("is_active", true)
        .order("position", { ascending: true, nullsFirst: false })
        .order("name", { ascending: true }),
      supabase
        .from("appointment_types")
        .select("id, name, position")
        .eq("clinic_id", data.clinicId)
        .eq("is_active", true)
        .order("position", { ascending: true }),
      supabase
        .from("professionals")
        .select("id, full_name, user_id, attends_patients")
        .eq("clinic_id", data.clinicId)
        .eq("is_active", true)
        .order("full_name", { ascending: true }),
      supabase.from("clinic_members").select("user_id, role").eq("clinic_id", data.clinicId),
      supabase
        .from("professional_schedules")
        .select("professional_id")
        .eq("clinic_id", data.clinicId),
      supabase.from("branches").select("id").eq("clinic_id", data.clinicId).eq("is_active", true),
      supabase.from("branch_hours").select("branch_id").eq("clinic_id", data.clinicId),
      supabase
        .from("clinic_agenda_settings")
        .select("default_duration_min")
        .eq("clinic_id", data.clinicId)
        .maybeSingle(),
    ]);
    for (const r of [
      ajustes,
      clinica,
      procs,
      tipos,
      profs,
      miembros,
      horarios,
      sucursales,
      horasSuc,
      agenda,
    ]) {
      if (r.error) throw new Error(mensajeDb(r.error, "No pudimos cargar la reserva en línea."));
    }

    const duracionAgenda = agenda.data?.default_duration_min ?? 30;
    const rol = new Map((miembros.data ?? []).map((m) => [m.user_id, m.role]));
    const atienden = (profs.data ?? []).filter((p) =>
      atiendePacientes(p.user_id ? (rol.get(p.user_id) ?? null) : null, p.attends_patients),
    );
    const slugs = slugsDeProfesionales(atienden.map((p) => ({ id: p.id, nombre: p.full_name })));
    const conHorario = new Set((horarios.data ?? []).map((h) => h.professional_id));
    const sucursalesConHorario = new Set((horasSuc.data ?? []).map((h) => h.branch_id));
    const nombre = clinica.data?.name ?? "Clínica";
    const s = ajustes.data;

    return {
      existe: Boolean(s),
      enabled: s?.enabled ?? false,
      slug: s?.slug ?? normalizarSlug(nombre),
      minNoticeHours: s?.min_notice_hours ?? 2,
      maxDaysAhead: s?.max_days_ahead ?? 30,
      procedimientoIds: s?.bookable_procedure_ids ?? [],
      tipoIds: s?.bookable_appointment_type_ids ?? [],
      nota: s?.welcome_note ?? "",
      origen: appOrigin(),
      clinica: nombre,
      procedimientos: (procs.data ?? []).map((p) => ({
        tipo: "procedimiento" as const,
        id: p.id,
        nombre: p.name,
        duracion: Math.min(480, Math.max(5, p.duration_min ?? duracionAgenda)),
      })),
      tipos: (tipos.data ?? []).map((t) => ({
        tipo: "tipo" as const,
        id: t.id,
        nombre: t.name,
        duracion: duracionAgenda,
      })),
      profesionales: atienden.map((p) => ({
        id: p.id,
        nombre: p.full_name,
        slug: slugs.get(p.id) ?? p.id,
        tieneHorario: conHorario.has(p.id),
      })),
      sucursalesConHorario: (sucursales.data ?? []).filter((b) => sucursalesConHorario.has(b.id))
        .length,
      sucursales: (sucursales.data ?? []).length,
    };
  });

export const guardarConfiguracionReserva = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        enabled: z.boolean(),
        slug: z.string().trim().toLowerCase(),
        minNoticeHours: z.number().int().min(0).max(720),
        maxDaysAhead: z.number().int().min(1).max(180),
        procedimientoIds: z.array(z.string().uuid()).max(60),
        tipoIds: z.array(z.string().uuid()).max(30),
        nota: z.string().trim().max(400, "La nota admite hasta 400 caracteres."),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage", SIN_PERMISOS);
    const problema = problemaDeSlug(data.slug);
    if (problema) throw new Error(problema);
    if (data.enabled && data.procedimientoIds.length + data.tipoIds.length === 0) {
      throw new Error("Elige al menos un procedimiento o tipo de cita para que se pueda reservar.");
    }

    // Los ids tienen que ser de esta clínica (la base no lo puede revisar en
    // un arreglo): se quedan solo los que existen acá.
    const [procs, tipos] = await Promise.all([
      data.procedimientoIds.length
        ? supabase
            .from("procedures")
            .select("id")
            .eq("clinic_id", data.clinicId)
            .in("id", data.procedimientoIds)
        : Promise.resolve({ data: [], error: null }),
      data.tipoIds.length
        ? supabase
            .from("appointment_types")
            .select("id")
            .eq("clinic_id", data.clinicId)
            .in("id", data.tipoIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (procs.error || tipos.error) throw new Error("No pudimos revisar los procedimientos.");

    const fila = {
      clinic_id: data.clinicId,
      enabled: data.enabled,
      slug: data.slug,
      min_notice_hours: data.minNoticeHours,
      max_days_ahead: data.maxDaysAhead,
      bookable_procedure_ids: (procs.data ?? []).map((p) => p.id),
      bookable_appointment_type_ids: (tipos.data ?? []).map((t) => t.id),
      welcome_note: data.nota || null,
      updated_by: userId,
    };
    const { data: guardada, error } = await supabase
      .from("online_booking_settings")
      .upsert(fila, { onConflict: "clinic_id" })
      .select("clinic_id")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") {
        throw new Error("Esa dirección ya la usa otra clínica. Prueba con otra.");
      }
      throw new Error(mensajeDb(error, SIN_PERMISOS));
    }
    if (!guardada) throw new Error(SIN_PERMISOS);
    return { ok: true };
  });
