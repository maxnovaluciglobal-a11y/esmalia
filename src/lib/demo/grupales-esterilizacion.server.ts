import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";

/**
 * Paso de `/api/demo-reset` para la Ola 14 · frente B:
 *
 * - AGE-22: una cita grupal hoy por la tarde ("Charla de higiene para
 *   escolares", cupo 12, cuatro inscritos) y otra de ayer con la asistencia
 *   ya pasada (dos asistieron, uno ausente), con pacientes de la semilla.
 * - MKT-10: ciclos de autoclave (ayer aprobado con biológico negativo, hoy
 *   aprobado con el biológico en incubación, una prueba Bowie-Dick y uno de
 *   hace 40 días), paquetes etiquetados (disponibles, por vencer, uno vencido
 *   y dos usados en pacientes con su cita).
 *
 * Todo pasa por los triggers reales (cupo, titular, correlativos,
 * vencimiento). Idempotente (si ya hay grupales o ciclos, no repite) y nunca
 * lanza: un error se registra y el reset sigue.
 */

type Admin = SupabaseClient<Database>;

function diaEn(zona: string, offset: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offset * 86_400_000));
}

export async function sembrarGrupalesYEsterilizacionDeLaDemo(admin: Admin): Promise<void> {
  try {
    const { data: clinica } = await admin
      .from("clinics")
      .select("id, timezone, created_by")
      .eq("is_demo", true)
      .limit(1)
      .maybeSingle();
    if (!clinica) return;
    const zona = clinica.timezone || "America/Santiago";
    const [{ data: pro }, { data: pacientes }] = await Promise.all([
      admin
        .from("professionals")
        .select("id, branch_id")
        .eq("clinic_id", clinica.id)
        .eq("is_active", true)
        .order("created_at")
        .limit(1)
        .maybeSingle(),
      admin
        .from("patients")
        .select("id")
        .eq("clinic_id", clinica.id)
        .is("archived_at", null)
        .is("merged_into", null)
        .order("created_at")
        .limit(8),
    ]);
    if (!pro?.branch_id || !pacientes || pacientes.length < 5) return;
    const ids = pacientes.map((p) => p.id);
    await sembrarGrupales(admin, clinica, zona, pro as { id: string; branch_id: string }, ids);
    await sembrarEsterilizacion(admin, clinica.id, zona, ids);
  } catch (e) {
    console.error("[demo-reset] grupales/esterilización:", e instanceof Error ? e.message : e);
  }
}

async function sembrarGrupales(
  admin: Admin,
  clinica: { id: string; created_by: string },
  zona: string,
  pro: { id: string; branch_id: string },
  pacientes: string[],
) {
  const { count } = await admin
    .from("appointment_groups")
    .select("appointment_id", { count: "exact", head: true })
    .eq("clinic_id", clinica.id);
  if (count) return;

  const crear = async (dia: number, hora: string, titulo: string, inscritos: string[]) => {
    const inicio = wallTimeInTzToUtc(`${diaEn(zona, dia)}T${hora}`, zona);
    const { data: cita, error } = await admin
      .from("appointments")
      .insert({
        clinic_id: clinica.id,
        branch_id: pro.branch_id,
        professional_id: pro.id,
        patient_id: inscritos[0],
        treatment_label: titulo,
        starts_at: inicio.toISOString(),
        ends_at: new Date(inicio.getTime() + 60 * 60_000).toISOString(),
        status: dia < 0 ? "finalizada" : "confirmada",
        created_by: clinica.created_by,
      })
      .select("id")
      .single();
    if (error || !cita) throw new Error(`cita grupal: ${error?.message}`);
    const { error: eg } = await admin.from("appointment_groups").insert({
      appointment_id: cita.id,
      clinic_id: clinica.id,
      title: titulo,
      capacity: 12,
    });
    if (eg) throw new Error(`grupo: ${eg.message}`);
    const { error: ep } = await admin.from("appointment_group_participants").insert(
      inscritos.slice(1).map((patient_id) => ({
        clinic_id: clinica.id,
        appointment_id: cita.id,
        patient_id,
      })),
    );
    if (ep) throw new Error(`inscritos: ${ep.message}`);
    return cita.id;
  };

  await crear(0, "17:00", "Charla de higiene para escolares", pacientes.slice(0, 4));
  const ayer = await crear(-1, "16:00", "Ortodoncia grupal: control de alineadores", [
    pacientes[4],
    pacientes[1],
    pacientes[2],
  ]);
  const { data: lista } = await admin
    .from("appointment_group_participants")
    .select("id, patient_id")
    .eq("appointment_id", ayer);
  const asistencia: Record<string, "asistio" | "ausente"> = {
    [pacientes[4]]: "asistio",
    [pacientes[1]]: "asistio",
    [pacientes[2]]: "ausente",
  };
  for (const p of lista ?? []) {
    await admin
      .from("appointment_group_participants")
      .update({ attendance: asistencia[p.patient_id] ?? "asistio" })
      .eq("id", p.id);
  }
}

async function sembrarEsterilizacion(
  admin: Admin,
  clinicId: string,
  zona: string,
  pacientes: string[],
) {
  const { count } = await admin
    .from("sterilization_cycles")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId);
  if (count) return;

  const ciclo = async (dia: number, hora: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await admin
      .from("sterilization_cycles")
      .insert({
        clinic_id: clinicId,
        equipment: "Autoclave clase B · 23 L",
        equipment_serial: "AC-2291",
        run_at: wallTimeInTzToUtc(`${diaEn(zona, dia)}T${hora}`, zona).toISOString(),
        cycle_type: "envuelto",
        temperature_c: 134,
        pressure_bar: 2.1,
        exposure_minutes: 5.5,
        chemical_indicator: "aprobado",
        chemical_indicator_class: "clase 5",
        biological_indicator: "no_aplica",
        result: "aprobado",
        responsible_name: "Camila Fuentes (asistente)",
        ...extra,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`ciclo: ${error?.message}`);
    return data.id;
  };
  const paquetes = async (cycleId: string, contenido: string, dias: number, n: number) => {
    const { data, error } = await admin
      .from("sterilization_packages")
      .insert(
        Array.from({ length: n }, () => ({
          clinic_id: clinicId,
          cycle_id: cycleId,
          contents: contenido,
          shelf_life_days: dias,
        })),
      )
      .select("id");
    if (error) throw new Error(`paquetes: ${error.message}`);
    return (data ?? []).map((p) => p.id);
  };

  const viejo = await ciclo(-40, "09:00");
  await paquetes(viejo, "Kit de examen (espejo, sonda, pinza)", 30, 1);
  await ciclo(-10, "08:00", {
    cycle_type: "bowie_dick",
    temperature_c: 134,
    exposure_minutes: 3.5,
    chemical_indicator: "aprobado",
  });
  const ayer = await ciclo(-1, "08:30", {
    biological_indicator: "aprobado",
    biological_lot: "BI-4471",
  });
  const usados = await paquetes(ayer, "Kit de examen (espejo, sonda, pinza)", 30, 4);
  await paquetes(ayer, "Kit de extracción simple", 7, 2);
  const hoy = await ciclo(0, "08:15", {
    biological_indicator: "pendiente",
    biological_lot: "BI-4472",
  });
  await paquetes(hoy, "Kit de profilaxis", 30, 3);

  // Dos paquetes de ayer usados en pacientes (con su cita de ayer o de hoy si la hay).
  for (const [i, pkgId] of usados.slice(0, 2).entries()) {
    const paciente = pacientes[i + 5] ?? pacientes[i];
    const { data: cita } = await admin
      .from("appointments")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("patient_id", paciente)
      .gte("starts_at", new Date(Date.now() - 36 * 3_600_000).toISOString())
      .lte("starts_at", new Date(Date.now() + 12 * 3_600_000).toISOString())
      .limit(1)
      .maybeSingle();
    await admin
      .from("sterilization_packages")
      .update({
        status: "usado",
        used_patient_id: paciente,
        used_appointment_id: cita?.id ?? null,
        used_at: new Date().toISOString(),
      })
      .eq("id", pkgId);
  }
}
