import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  CUPO_MAXIMO,
  CUPO_MINIMO,
  TITULO_MAXIMO,
  type Asistencia,
  type InfoGrupal,
  type ParticipanteGrupal,
} from "@/lib/clinic-operations/citas-grupales";
import { mensajeDb } from "@/lib/db-errors";
import { enBloques, mapConLimite } from "@/lib/paginacion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Citas grupales (AGE-22): convertir una cita en grupal, inscribir y retirar
 * pacientes y pasar lista. Todo con la sesión del usuario: la RLS y los
 * triggers de la migración 20261110200000 deciden (cupo, retiro del último,
 * asistencia desde que empieza la cita, permisos de agenda y MFA). Los
 * mensajes de los triggers se muestran tal cual (tienen causa y salida);
 * los de permisos, con el genérico.
 */

type Db = SupabaseClient<Database>;

const SIN_PERMISO = "No tienes permisos para cambiar esta cita grupal.";

const campos = {
  clinicId: z.string().uuid(),
  appointmentId: z.string().uuid(),
};

const grupo = z.object({
  ...campos,
  titulo: z.string().trim().min(2, "Ponle un nombre a la actividad.").max(TITULO_MAXIMO),
  cupo: z.number().int().min(CUPO_MINIMO).max(CUPO_MAXIMO),
});

/** Info grupal de las citas que cargó la agenda (para el bloque y los choques). */
export async function infoGrupalDeCitas(
  supabase: Db,
  clinicId: string,
  appointmentIds: string[],
): Promise<Map<string, InfoGrupal>> {
  const salida = new Map<string, InfoGrupal>();
  if (appointmentIds.length === 0) return salida;
  // Las grupales son pocas: se leen todas las de la clínica y se cruzan acá
  // (miles de ids de citas no entran en un `.in()`).
  const { data: grupos, error } = await supabase
    .from("appointment_groups")
    .select("appointment_id, title, capacity")
    .eq("clinic_id", clinicId);
  if (error) throw new Error(mensajeDb(error, "No pudimos cargar las citas grupales."));
  const pedidas = new Set(appointmentIds);
  const visibles = (grupos ?? []).filter((g) => pedidas.has(g.appointment_id));
  if (visibles.length === 0) return salida;

  const bloques = await mapConLimite(enBloques(visibles.map((g) => g.appointment_id)), 4, (ids) =>
    supabase
      .from("appointment_group_participants")
      .select("appointment_id, patient_id")
      .eq("clinic_id", clinicId)
      .is("withdrawn_at", null)
      .in("appointment_id", ids),
  );
  const errorP = bloques.find((b) => b.error)?.error;
  if (errorP) throw new Error(mensajeDb(errorP, "No pudimos cargar los inscritos."));
  const porCita = new Map<string, string[]>();
  for (const p of bloques.flatMap((b) => b.data ?? [])) {
    const lista = porCita.get(p.appointment_id) ?? [];
    lista.push(p.patient_id);
    porCita.set(p.appointment_id, lista);
  }
  for (const g of visibles) {
    const pacienteIds = porCita.get(g.appointment_id) ?? [];
    salida.set(g.appointment_id, {
      titulo: g.title,
      cupo: g.capacity,
      inscritos: pacienteIds.length,
      pacienteIds,
    });
  }
  return salida;
}

export const convertirEnGrupal = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => grupo.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("appointment_groups").insert({
      appointment_id: data.appointmentId,
      clinic_id: data.clinicId,
      title: data.titulo,
      capacity: data.cupo,
    });
    if (error) {
      if (error.code === "23505") throw new Error("Esta cita ya es grupal.");
      throw new Error(mensajeDb(error, SIN_PERMISO));
    }
    return { ok: true };
  });

export const editarGrupal = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => grupo.parse(input))
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await context.supabase
      .from("appointment_groups")
      .update({ title: data.titulo, capacity: data.cupo })
      .eq("appointment_id", data.appointmentId)
      .eq("clinic_id", data.clinicId)
      .select("appointment_id");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    if (!filas?.length) throw new Error(SIN_PERMISO);
    return { ok: true };
  });

export const listarParticipantes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object(campos).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      grupo: { titulo: string; cupo: number } | null;
      participantes: ParticipanteGrupal[];
    }> => {
      const { supabase } = context;
      const [{ data: g, error: errG }, { data: filas, error: errP }] = await Promise.all([
        supabase
          .from("appointment_groups")
          .select("title, capacity")
          .eq("clinic_id", data.clinicId)
          .eq("appointment_id", data.appointmentId)
          .maybeSingle(),
        supabase
          .from("appointment_group_participants")
          .select(
            "id, patient_id, attendance, enrolled_at, withdrawn_at, withdraw_reason, patient_confirmed_at",
          )
          .eq("clinic_id", data.clinicId)
          .eq("appointment_id", data.appointmentId)
          .order("enrolled_at", { ascending: true }),
      ]);
      if (errG || errP) {
        throw new Error(mensajeDb(errG ?? errP, "No pudimos cargar los inscritos de la cita."));
      }
      if (!g) return { grupo: null, participantes: [] };
      const ids = [...new Set((filas ?? []).map((f) => f.patient_id))];
      const { data: pacientes, error: errN } = ids.length
        ? await supabase.from("patients").select("id, full_name").in("id", ids)
        : { data: [] as { id: string; full_name: string }[], error: null };
      if (errN) throw new Error(mensajeDb(errN, "No pudimos cargar los nombres de los pacientes."));
      const nombre = new Map((pacientes ?? []).map((p) => [p.id, p.full_name]));
      return {
        grupo: { titulo: g.title, cupo: g.capacity },
        participantes: (filas ?? []).map((f) => ({
          id: f.id,
          pacienteId: f.patient_id,
          paciente: nombre.get(f.patient_id) ?? "Paciente",
          asistencia: f.attendance as Asistencia,
          inscritoEn: f.enrolled_at,
          retiradoEn: f.withdrawn_at,
          motivoRetiro: f.withdraw_reason,
          avisoEl: f.patient_confirmed_at,
        })),
      };
    },
  );

export const inscribirEnGrupal = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => z.object({ ...campos, patientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Si estuvo y se retiró, se reincorpora (la fila es única por paciente).
    const { data: previa } = await supabase
      .from("appointment_group_participants")
      .select("id, withdrawn_at")
      .eq("clinic_id", data.clinicId)
      .eq("appointment_id", data.appointmentId)
      .eq("patient_id", data.patientId)
      .maybeSingle();
    if (previa && !previa.withdrawn_at) throw new Error("Ese paciente ya está inscrito.");
    const { error } = previa
      ? await supabase
          .from("appointment_group_participants")
          // Reincorporado: el aviso anterior ya no vale.
          .update({ withdrawn_at: null, patient_confirmed_at: null, patient_confirmed_via: null })
          .eq("id", previa.id)
          .eq("clinic_id", data.clinicId)
      : await supabase.from("appointment_group_participants").insert({
          clinic_id: data.clinicId,
          appointment_id: data.appointmentId,
          patient_id: data.patientId,
        });
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    return { ok: true };
  });

export const retirarDeGrupal = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        participanteId: z.string().uuid(),
        motivo: z.string().trim().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await context.supabase
      .from("appointment_group_participants")
      .update({ withdrawn_at: new Date().toISOString(), withdraw_reason: data.motivo || null })
      .eq("id", data.participanteId)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    if (!filas?.length) throw new Error(SIN_PERMISO);
    return { ok: true };
  });

export const marcarAsistenciaGrupal = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        participanteId: z.string().uuid(),
        asistencia: z.enum(["pendiente", "asistio", "ausente"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await context.supabase
      .from("appointment_group_participants")
      .update({ attendance: data.asistencia })
      .eq("id", data.participanteId)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    if (!filas?.length) throw new Error(SIN_PERMISO);
    return { ok: true };
  });

/**
 * Anota (o quita) a mano el aviso de UN inscrito: llamó por teléfono o lo dijo
 * en el mostrador. Es el par por persona de `setPatientConfirmation` (que marca
 * la cita individual); en una grupal el aviso es de cada inscrito. No cambia el
 * estado de la cita ni la asistencia.
 */
export const anotarAvisoDeInscrito = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        participanteId: z.string().uuid(),
        avisado: z.boolean(),
        via: z.enum(["telefono", "presencial", "portal", "whatsapp"]).default("telefono"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await context.supabase
      .from("appointment_group_participants")
      .update(
        data.avisado
          ? { patient_confirmed_at: new Date().toISOString(), patient_confirmed_via: data.via }
          : { patient_confirmed_at: null, patient_confirmed_via: null },
      )
      .eq("id", data.participanteId)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    if (!filas?.length) throw new Error(SIN_PERMISO);
    return { ok: true };
  });
