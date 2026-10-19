import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

export interface EntradaEspera {
  id: string;
  nombre: string;
  motivo: string;
  espera: string;
  /** null = entrada sin paciente vinculado (ej. un interesado sin ficha todavía) — no se le puede avisar por WhatsApp. */
  patientId: string | null;
  patientPhone: string | null;
}

function tiempoDeEspera(waitSince: string): string {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(waitSince).getTime()) / 60_000));
  if (minutos < 1) return "—";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.round(minutos / 60);
  return `${horas} h`;
}

/** Lista de espera activa de la clínica. */
export const listWaitlist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<EntradaEspera[]> => {
    const { data: rows, error } = await context.supabase
      .from("waitlist_entries")
      .select("id, full_name, reason, wait_since, patient_id")
      .eq("clinic_id", data.clinicId)
      .eq("status", "waiting")
      .order("wait_since", { ascending: true })
      .limit(100);

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la lista de espera."));
    const entries = rows ?? [];
    if (entries.length === 0) return [];

    const patientIds = [
      ...new Set(entries.map((e) => e.patient_id).filter((id): id is string => !!id)),
    ];
    const { data: patients, error: patErr } =
      patientIds.length === 0
        ? { data: [], error: null }
        : await context.supabase
            .from("patients")
            .select("id, phone")
            .eq("clinic_id", data.clinicId)
            .in("id", patientIds);
    if (patErr) throw new Error(mensajeDb(patErr, "No pudimos cargar la lista de espera."));
    const phoneById = new Map((patients ?? []).map((p) => [p.id, p.phone]));

    return entries.map((r) => ({
      id: r.id,
      nombre: r.full_name,
      motivo: r.reason ?? "Sin motivo registrado",
      espera: tiempoDeEspera(r.wait_since),
      patientId: r.patient_id,
      patientPhone: r.patient_id ? (phoneById.get(r.patient_id) ?? null) : null,
    }));
  });

/**
 * Agrega a la lista de espera. `patientId` es opcional (se puede anotar a
 * alguien sin ficha todavía, ej. un interesado que llamó) pero sin él no
 * hay teléfono, así que la fila no va a poder recibir el aviso por
 * WhatsApp — la UI lo deja claro en vez de fingir que sí puede.
 */
export const createWaitlistEntry = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid().optional(),
        fullName: z.string().trim().min(1).max(200).optional(),
        reason: z.string().trim().max(300).optional(),
        branchId: z.string().uuid().optional(),
      })
      .refine((v) => v.patientId || v.fullName, {
        message: "Elige un paciente existente o escribe un nombre.",
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    let fullName = data.fullName?.trim() ?? "";

    if (data.patientId) {
      const { data: patient, error } = await supabase
        .from("patients")
        .select("full_name")
        .eq("clinic_id", data.clinicId)
        .eq("id", data.patientId)
        .maybeSingle();
      if (error)
        throw new Error(
          mensajeDb(error, "No pudimos buscar el paciente para agregarlo a la lista de espera."),
        );
      if (!patient) throw new Error("Paciente no encontrado.");
      fullName = patient.full_name;
    }
    if (!fullName) throw new Error("Falta el nombre.");

    const { data: inserted, error: insertErr } = await supabase
      .from("waitlist_entries")
      .insert({
        clinic_id: data.clinicId,
        branch_id: data.branchId ?? null,
        patient_id: data.patientId ?? null,
        full_name: fullName,
        reason: data.reason?.trim() || null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (insertErr) {
      throw new Error("No pudimos agregar a la lista de espera. " + insertErr.message);
    }
    return { id: inserted.id };
  });

/** Saca de la lista de espera (soft: status='cancelled', no borra la fila). */
export const removeWaitlistEntry = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<void> => {
    const { error } = await context.supabase
      .from("waitlist_entries")
      .update({ status: "cancelled" })
      .eq("clinic_id", data.clinicId)
      .eq("id", data.id);
    if (error)
      throw new Error(mensajeDb(error, "No pudimos sacar a este paciente de la lista de espera."));
  });
