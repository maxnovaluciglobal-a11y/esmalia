import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import type { Database } from "@/integrations/supabase/types";
import { proximasCitasConGrupales } from "@/lib/clinic-operations/inscripciones-grupales";
import { leerFilasDelTitular } from "@/lib/derechos/mis-datos.server";
import { inscritosDeCitasGrupales } from "@/lib/messaging/messaging.functions";
import { anotarConfirmacionDelPaciente } from "@/lib/messaging/confirmacion-del-paciente.server";
import { pacientesConCitaFutura } from "@/lib/seguimiento/seguimiento.server";
import { conectar } from "./helpers/db";

/**
 * Cierre · Bloque 5 · ítem 4: el código de la aplicación que lee las citas de
 * un paciente (portal, «mis datos», recall, recordatorios y la confirmación
 * por WhatsApp) ve las citas grupales de CADA inscrito, no solo del titular.
 * Corre las funciones reales con el cliente de servicio contra la base
 * efímera (los datos se confirman para que PostgREST los vea y se borran al
 * final). Sin enviar nada: todo es lectura, salvo el aviso del paciente.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en el entorno (ver docs/TESTS.md).`);
  return value;
}

describe("citas grupales para todos los inscritos, en el código de la aplicación", () => {
  let admin: SupabaseClient<Database>;
  let client: Client;
  let clinicId: string;
  let otraClinicId: string;
  let branchId: string;
  let profId: string;
  let owner: string;
  let titular: string;
  let inscrita: string;
  let retirada: string;
  let ajeno: string;
  let grupalFutura: string;
  let grupalCancelada: string;
  let individualLejana: string;

  async function sql<T = Record<string, unknown>>(texto: string, params: unknown[] = []) {
    return (await client.query(texto, params)).rows as T[];
  }

  async function paciente(nombre: string, clinica = clinicId): Promise<string> {
    return (
      await sql<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [clinica, nombre, owner],
      )
    )[0].id;
  }

  async function cita(
    paciente: string,
    horas: number,
    estado = "confirmada",
    minutos = 60,
  ): Promise<string> {
    return (
      await sql<{ id: string }>(
        `INSERT INTO public.appointments (clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at, status, created_by, treatment_label)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval, now() + ($5 || ' hours')::interval + ($6 || ' minutes')::interval, $7::public.appointment_status, $8, 'Control')
         RETURNING id`,
        [clinicId, branchId, paciente, profId, String(horas), String(minutos), estado, owner],
      )
    )[0].id;
  }

  async function grupal(citaId: string, titulo: string, inscritos: string[]) {
    await sql(
      `INSERT INTO public.appointment_groups (appointment_id, clinic_id, title, capacity) VALUES ($1, $2, $3, 10)`,
      [citaId, clinicId, titulo],
    );
    for (const p of inscritos) {
      await sql(
        `INSERT INTO public.appointment_group_participants (clinic_id, appointment_id, patient_id) VALUES ($1, $2, $3)
         ON CONFLICT (appointment_id, patient_id) DO NOTHING`,
        [clinicId, citaId, p],
      );
    }
  }

  beforeAll(async () => {
    admin = createClient<Database>(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    client = await conectar();
    clinicId = randomUUID();
    otraClinicId = randomUUID();
    owner = randomUUID();
    await sql(
      `INSERT INTO public.clinics (id, name, created_by, timezone) VALUES ($1, 'Clínica Grupal App', $2, 'America/Santiago'), ($3, 'Otra Clínica', $2, 'America/Santiago')`,
      [clinicId, owner, otraClinicId],
    );
    branchId = (
      await sql<{ id: string }>(
        `INSERT INTO public.branches (clinic_id, name, timezone) VALUES ($1, 'Matriz', 'America/Santiago') RETURNING id`,
        [clinicId],
      )
    )[0].id;
    profId = (
      await sql<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, branch_id, full_name) VALUES ($1, $2, 'Dra. Grupal') RETURNING id`,
        [clinicId, branchId],
      )
    )[0].id;
    titular = await paciente("Titular App");
    inscrita = await paciente("Inscrita App");
    retirada = await paciente("Retirada App");
    ajeno = await paciente("Ajeno App", otraClinicId);

    grupalFutura = await cita(titular, 30);
    await grupal(grupalFutura, "Charla de higiene", [titular, inscrita, retirada]);
    await sql(
      `UPDATE public.appointment_group_participants SET withdrawn_at = now() WHERE appointment_id = $1 AND patient_id = $2`,
      [grupalFutura, retirada],
    );
    grupalCancelada = await cita(titular, 50, "cancelada");
    // Una grupal cancelada no se puede crear sobre una cita cancelada: se cancela después.
    const apoyo = await cita(titular, 60);
    await grupal(apoyo, "Ortodoncia grupal", [titular, inscrita]);
    await sql(`UPDATE public.appointments SET status = 'cancelada' WHERE id = $1`, [apoyo]);
    grupalCancelada = apoyo;
    individualLejana = await cita(inscrita, 24 * 40); // fuera de la ventana de 30 días del «sí»
  });

  afterAll(async () => {
    try {
      await sql(`DELETE FROM public.appointment_group_participants WHERE clinic_id = $1`, [
        clinicId,
      ]);
      await sql(`DELETE FROM public.appointment_groups WHERE clinic_id = $1`, [clinicId]);
      await sql(`DELETE FROM public.appointments WHERE clinic_id = $1`, [clinicId]);
      await sql(`DELETE FROM public.patients WHERE clinic_id = ANY($1)`, [
        [clinicId, otraClinicId],
      ]);
      await sql(`DELETE FROM public.clinics WHERE id = ANY($1)`, [[clinicId, otraClinicId]]);
    } finally {
      await client.end();
    }
  });

  it("portal: la inscrita ve la charla (con el nombre de la actividad); la retirada y la cancelada no", async () => {
    const delTitular = await admin
      .from("appointments")
      .select("id, treatment_label, starts_at, ends_at, status, branch_id, professional_id")
      .eq("clinic_id", clinicId)
      .eq("patient_id", inscrita)
      .gte("starts_at", new Date().toISOString())
      .neq("status", "cancelada");
    const inscritaVe = await proximasCitasConGrupales(
      admin,
      clinicId,
      inscrita,
      delTitular.data ?? [],
      new Date().toISOString(),
    );
    const ids = inscritaVe.map((c) => c.id);
    expect(ids).toContain(grupalFutura);
    expect(ids).toContain(individualLejana);
    expect(ids).not.toContain(grupalCancelada);
    expect(inscritaVe.find((c) => c.id === grupalFutura)?.treatment_label).toBe(
      "Charla de higiene",
    );

    const retiradaVe = await proximasCitasConGrupales(
      admin,
      clinicId,
      retirada,
      [],
      new Date().toISOString(),
    );
    expect(retiradaVe).toEqual([]);

    // El titular la ve una sola vez aunque aparezca por las dos vías.
    const individualesTitular = (
      await admin
        .from("appointments")
        .select("id, treatment_label, starts_at, ends_at, status, branch_id, professional_id")
        .eq("clinic_id", clinicId)
        .eq("patient_id", titular)
        .gte("starts_at", new Date().toISOString())
        .neq("status", "cancelada")
    ).data;
    const titularVe = await proximasCitasConGrupales(
      admin,
      clinicId,
      titular,
      individualesTitular ?? [],
      new Date().toISOString(),
    );
    expect(titularVe.filter((c) => c.id === grupalFutura)).toHaveLength(1);
  });

  it("portal: otra clínica no ve las citas de esta", async () => {
    const ajenoVe = await proximasCitasConGrupales(
      admin,
      otraClinicId,
      inscrita,
      [],
      new Date().toISOString(),
    );
    expect(ajenoVe).toEqual([]);
    const ajenoPropio = await proximasCitasConGrupales(
      admin,
      otraClinicId,
      ajeno,
      [],
      new Date().toISOString(),
    );
    expect(ajenoPropio).toEqual([]);
  });

  it("«mis datos»: la inscrita recibe la charla con su propia asistencia y el titular no la duplica", async () => {
    await sql(
      `UPDATE public.appointment_group_participants SET attendance = 'pendiente' WHERE appointment_id = $1`,
      [grupalFutura],
    );
    const { filas } = await leerFilasDelTitular(admin, clinicId, inscrita);
    const charla = filas.citas.filter((c) => c.treatment_label === "Charla de higiene");
    expect(charla).toHaveLength(1);
    expect(charla[0].patient_id).toBe(inscrita);
    // Nada del titular ni de los demás inscritos.
    expect(filas.citas.every((c) => c.patient_id === inscrita)).toBe(true);

    const delTitular = await leerFilasDelTitular(admin, clinicId, titular);
    expect(
      delTitular.filas.citas.filter((c) => c.treatment_label === "Charla de higiene"),
    ).toHaveLength(1);
  });

  it("recall: quien está inscrito tiene próxima cita; el retirado no", async () => {
    const con = await pacientesConCitaFutura(admin, clinicId, [titular, inscrita, retirada]);
    expect(con.has(titular)).toBe(true);
    expect(con.has(inscrita)).toBe(true);
    expect(con.has(retirada)).toBe(false);
  });

  it("recordatorios: la charla sale una vez por inscrito vigente, con el nombre de la actividad", async () => {
    const m = await inscritosDeCitasGrupales(admin, clinicId, [grupalFutura, individualLejana]);
    expect(m.has(individualLejana)).toBe(false);
    const g = m.get(grupalFutura);
    expect(g?.titulo).toBe("Charla de higiene");
    expect([...(g?.inscritos ?? [])].sort()).toEqual([titular, inscrita].sort());
    expect(g?.inscritos).not.toContain(retirada);
    const ajenaClinica = await inscritosDeCitasGrupales(admin, otraClinicId, [grupalFutura]);
    expect(ajenaClinica.size).toBe(0);
  });

  it("WhatsApp: el «sí» de la inscrita marca SU inscripción, no la cita ni la del titular", async () => {
    const fecha = await anotarConfirmacionDelPaciente(admin, clinicId, inscrita, "sí, voy");
    expect(fecha).not.toBeNull();
    const filas = await sql<{
      patient_id: string;
      patient_confirmed_at: string | null;
      via: string | null;
    }>(
      `SELECT patient_id, patient_confirmed_at, patient_confirmed_via AS via
         FROM public.appointment_group_participants WHERE appointment_id = $1`,
      [grupalFutura],
    );
    expect(filas.find((f) => f.patient_id === inscrita)?.patient_confirmed_at).not.toBeNull();
    expect(filas.find((f) => f.patient_id === inscrita)?.via).toBe("whatsapp");
    expect(filas.find((f) => f.patient_id === titular)?.patient_confirmed_at).toBeNull();
    const cabecera = await sql<{ patient_confirmed_at: string | null }>(
      `SELECT patient_confirmed_at FROM public.appointments WHERE id = $1`,
      [grupalFutura],
    );
    expect(cabecera[0].patient_confirmed_at).toBeNull();
    // Un segundo «sí» no pisa la marca ni vuelve a avisar al equipo.
    expect(await anotarConfirmacionDelPaciente(admin, clinicId, inscrita, "sí")).toBeNull();
  });

  it("WhatsApp: el titular de la grupal también marca su inscripción, no la cita entera", async () => {
    expect(
      await anotarConfirmacionDelPaciente(admin, clinicId, titular, "confirmo"),
    ).not.toBeNull();
    const cabecera = await sql<{ patient_confirmed_at: string | null }>(
      `SELECT patient_confirmed_at FROM public.appointments WHERE id = $1`,
      [grupalFutura],
    );
    expect(cabecera[0].patient_confirmed_at).toBeNull();
    const suya = await sql<{ patient_confirmed_at: string | null }>(
      `SELECT patient_confirmed_at FROM public.appointment_group_participants WHERE appointment_id = $1 AND patient_id = $2`,
      [grupalFutura, titular],
    );
    expect(suya[0].patient_confirmed_at).not.toBeNull();
  });

  it("WhatsApp: con una cita individual más cercana, el «sí» va a esa cita", async () => {
    const pronta = await cita(retirada, 2);
    expect(await anotarConfirmacionDelPaciente(admin, clinicId, retirada, "sí")).not.toBeNull();
    const r = await sql<{ patient_confirmed_at: string | null }>(
      `SELECT patient_confirmed_at FROM public.appointments WHERE id = $1`,
      [pronta],
    );
    expect(r[0].patient_confirmed_at).not.toBeNull();
  });

  it("WhatsApp: un mensaje que no es una confirmación no marca nada", async () => {
    const nueva = await paciente("Sin Confirmar");
    const grupalNueva = await cita(nueva, 10);
    await grupal(grupalNueva, "Control escolar", [nueva]);
    expect(
      await anotarConfirmacionDelPaciente(admin, clinicId, nueva, "hola, una consulta"),
    ).toBeNull();
    const r = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM public.appointment_group_participants WHERE appointment_id = $1 AND patient_confirmed_at IS NOT NULL`,
      [grupalNueva],
    );
    expect(Number(r[0].n)).toBe(0);
  });
});
