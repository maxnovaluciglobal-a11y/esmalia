import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import type { Database } from "@/integrations/supabase/types";
import { resolveEmailRecipient, type EmailSandboxConfig } from "@/lib/messaging/email-sandbox";
import type { sendEmail } from "@/lib/messaging/email.server";
import { correrCorreosAPacientes } from "@/lib/notificaciones-pacientes/cron.server";

import { conectar } from "./helpers/db";

/**
 * Ola 14 · frente B · AGE-22: una cita grupal no rompe los correos
 * automáticos a pacientes (Ola 7). La corrida de punta a punta (PostgREST con
 * la service key, envío simulado) manda la confirmación de la cita individual
 * y NO manda nada por la grupal: su `patient_id` es solo el titular y un
 * "tu cita" a él solo sería engañoso. Sin errores en la corrida.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} (ver docs/TESTS.md).`);
  return value;
}

const H = 3_600_000;

function husoDeDia(ahora: Date): string {
  for (const tz of [
    "America/Santiago",
    "Europe/Madrid",
    "Asia/Tokyo",
    "America/Los_Angeles",
    "Asia/Kolkata",
    "Pacific/Auckland",
  ]) {
    const h = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(
        ahora,
      ),
    );
    if (h >= 10 && h <= 18) return tz;
  }
  return "America/Santiago";
}

describe("citas grupales y correos automáticos (REST)", () => {
  const SUPABASE_URL = requiredEnv("SUPABASE_URL");
  const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const ahora = new Date();
  const zona = husoDeDia(ahora);

  let admin: SupabaseClient<Database>;
  let pg: Client;
  let ownerId = "";
  let clinicId = "";
  const ids: Record<string, string> = {};
  const enviados: { to: string }[] = [];

  const enviar: typeof sendEmail = async (params, sandbox) => {
    const d = resolveEmailRecipient(params.to, sandbox);
    if (d.action === "block") return { ok: false, reason: d.reason };
    enviados.push({ to: d.recipient });
    return {
      ok: true,
      externalId: `fake-${enviados.length}`,
      recipient: d.recipient,
      redirected: false,
    };
  };

  const sandboxProduccion = async (): Promise<EmailSandboxConfig> => ({
    mode: "production",
    redirectTo: "",
    allowlist: [],
    redirectEnabled: false,
    prefixSubject: false,
    minEntregasProduccion: 3,
  });

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    pg = await conectar();
    const { data: u, error } = await admin.auth.admin.createUser({
      email: `grupal-correos-${randomUUID()}@esmalia-test.invalid`,
      password: `Gc-${randomUUID()}`,
      email_confirm: true,
    });
    if (error || !u.user) throw new Error(`usuario: ${error?.message}`);
    ownerId = u.user.id;

    const { data: clinica } = await admin
      .from("clinics")
      .insert({ name: "Clínica Grupal Correos", created_by: ownerId, timezone: zona })
      .select("id")
      .single();
    clinicId = clinica!.id;
    const { data: branch } = await admin
      .from("branches")
      .insert({ clinic_id: clinicId, name: "Centro" })
      .select("id")
      .single();
    const { data: pro } = await admin
      .from("professionals")
      .insert({ clinic_id: clinicId, full_name: "Dra. Grupal" })
      .select("id")
      .single();
    await admin.from("email_sandbox_config").upsert({ clinic_id: clinicId, mode: "production" });
    await admin.from("patient_notification_settings").insert({
      clinic_id: clinicId,
      confirmation_enabled: true,
      reminder_enabled: true,
      reminder_hours: [24],
      intake_form_mode: "off",
      nps_enabled: false,
    });
    await pg.query(`set session_replication_role = replica`);
    await pg.query(
      `update public.patient_notification_settings
          set confirmation_enabled_at = now() - interval '30 days' where clinic_id = $1`,
      [clinicId],
    );
    await pg.query(`set session_replication_role = origin`);

    const paciente = async (nombre: string, email: string) => {
      const { data } = await admin
        .from("patients")
        .insert({ clinic_id: clinicId, full_name: nombre, email, created_by: ownerId })
        .select("id")
        .single();
      return data!.id;
    };
    const cita = async (pacienteId: string, empiezaEnH: number) => {
      const { data, error: e } = await admin
        .from("appointments")
        .insert({
          clinic_id: clinicId,
          branch_id: branch!.id,
          professional_id: pro!.id,
          patient_id: pacienteId,
          starts_at: new Date(ahora.getTime() + empiezaEnH * H).toISOString(),
          ends_at: new Date(ahora.getTime() + (empiezaEnH + 1) * H).toISOString(),
          treatment_label: "Control",
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (e || !data) throw new Error(`cita: ${e?.message}`);
      return data.id;
    };

    const individual = await paciente("Ana Individual", "ana@paciente.cl");
    const titular = await paciente("Beto Titular", "beto@paciente.cl");
    const segundo = await paciente("Carla Inscrita", "carla@paciente.cl");
    ids.individual = await cita(individual, 72);
    ids.grupal = await cita(titular, 10);
    const { error: eg } = await admin.from("appointment_groups").insert({
      appointment_id: ids.grupal,
      clinic_id: clinicId,
      title: "Charla de higiene",
      capacity: 10,
    });
    if (eg) throw new Error(`grupo: ${eg.message}`);
    const { error: ep } = await admin.from("appointment_group_participants").insert({
      clinic_id: clinicId,
      appointment_id: ids.grupal,
      patient_id: segundo,
    });
    if (ep) throw new Error(`inscrito: ${ep.message}`);
  });

  afterAll(async () => {
    if (clinicId) {
      await pg.query(`delete from public.patient_email_dispatches where clinic_id = $1`, [
        clinicId,
      ]);
      await pg.query(`delete from public.messages where clinic_id = $1`, [clinicId]);
      await admin.from("clinics").delete().eq("id", clinicId);
    }
    if (ownerId) await admin.auth.admin.deleteUser(ownerId);
    await pg?.end();
  });

  it("manda la confirmación de la individual, nada por la grupal y sin errores", async () => {
    const r = await correrCorreosAPacientes(admin, ahora, {
      appUrl: "https://esmalia.test",
      topeClinicas: 500,
      topeCorreos: 500,
      enlaceGestion: ({ appointmentId }) => `https://esmalia.test/mi-cita/${appointmentId}`,
      cargarSandbox: sandboxProduccion,
      enviar,
    });
    expect(r.errores).toBe(0);
    const propios = enviados.map((e) => e.to);
    expect(propios).toContain("ana@paciente.cl");
    expect(propios).not.toContain("beto@paciente.cl");
    expect(propios).not.toContain("carla@paciente.cl");

    const { data } = await admin
      .from("patient_email_dispatches")
      .select("appointment_id")
      .eq("clinic_id", clinicId);
    expect((data ?? []).map((d) => d.appointment_id)).not.toContain(ids.grupal);
  });
});
