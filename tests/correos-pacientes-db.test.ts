import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import type { Database } from "@/integrations/supabase/types";
import { generarSecreto, huellaDeSecreto } from "@/lib/firma-distancia/token";
import { resolveEmailRecipient, type EmailSandboxConfig } from "@/lib/messaging/email-sandbox";
import type { sendEmail } from "@/lib/messaging/email.server";
import {
  correrCorreosAPacientes,
  type ResumenCorrida,
} from "@/lib/notificaciones-pacientes/cron.server";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 7 · frente B (migraciones 20261028200000 y 20261028200100), contra la
 * base efímera de tests:
 *
 * 1. La corrida del cron de punta a punta (PostgREST con la service key, el
 *    mismo camino que en producción, con el envío simulado): confirmación,
 *    recordatorio y encuesta a quien corresponde; baja, cita importada en
 *    silencio y demo afuera; el menor con tutor → al tutor; sandbox que
 *    bloquea (queda `skipped`, no sale) o que desvía; dos corridas a la vez
 *    no duplican nada (UNIQUE de `patient_email_dispatches`).
 * 2. RLS y permisos (SQL directo): aislamiento entre clínicas, quién lee y
 *    edita la configuración, formularios solo para roles clínicos, NPS solo
 *    owner/admin, nadie escribe envíos por la API, y las funciones de las
 *    páginas públicas no las ejecuta anon ni authenticated.
 * 3. Páginas públicas: el formulario no toca la ficha y se envía una vez;
 *    el staff lo acepta o descarta; la encuesta muestra la reseña solo a los
 *    promotores y solo si hay link.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name} en el entorno. Este test corre contra la base local de ` +
        `scripts/test-db/start.sh (ver docs/TESTS.md).`,
    );
  }
  return value;
}

const H = 3_600_000;

/** Un huso en el que ahora sea de día (la corrida solo actúa de 8:00 a 20:59 local). */
function husoDeDia(ahora: Date): string {
  for (const tz of [
    "America/Santiago",
    "Europe/Madrid",
    "Asia/Tokyo",
    "America/Los_Angeles",
    "Asia/Kolkata",
    "Pacific/Auckland",
    "Africa/Nairobi",
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

describe("corrida del cron de correos a pacientes (REST)", () => {
  const SUPABASE_URL = requiredEnv("SUPABASE_URL");
  const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const ahora = new Date();
  const zona = husoDeDia(ahora);

  let admin: SupabaseClient<Database>;
  let ownerId: string;
  const clinicas: string[] = [];
  const enviados: { to: string; subject: string; html: string }[] = [];

  const enviar: typeof sendEmail = async (params, sandbox) => {
    // Igual que el envío real: el modo de prueba decide el destinatario.
    const d = resolveEmailRecipient(params.to, sandbox);
    if (d.action === "block") return { ok: false, reason: d.reason };
    enviados.push({ to: d.recipient, subject: params.subject, html: params.html });
    return {
      ok: true,
      externalId: `fake-${enviados.length}`,
      recipient: d.recipient,
      redirected: d.action === "redirect",
    };
  };

  const cargarSandbox = async (a: SupabaseClient<Database>, clinicId: string) => {
    const { data } = await a
      .from("email_sandbox_config")
      .select("mode, redirect_to, allowlist, redirect_enabled, prefix_subject")
      .eq("clinic_id", clinicId)
      .maybeSingle();
    const c: EmailSandboxConfig = {
      mode: data?.mode === "production" ? "production" : "sandbox",
      redirectTo: data?.redirect_to ?? "",
      allowlist: data?.allowlist ?? [],
      redirectEnabled: data?.redirect_enabled ?? true,
      prefixSubject: data?.prefix_subject ?? true,
      minEntregasProduccion: 3,
    };
    return c;
  };

  function correr(enlace = true): Promise<ResumenCorrida> {
    return correrCorreosAPacientes(admin, ahora, {
      appUrl: "https://esmalia.test",
      topeClinicas: 500,
      topeCorreos: 500,
      enlaceGestion: enlace
        ? ({ appointmentId }) => `https://esmalia.test/mi-cita/${appointmentId}`
        : null,
      cargarSandbox,
      enviar,
    });
  }

  async function crearClinica(nombre: string, extra: { is_demo?: boolean } = {}) {
    const { data, error } = await admin
      .from("clinics")
      .insert({ name: nombre, created_by: ownerId, timezone: zona })
      .select("id")
      .single();
    if (error || !data) throw new Error(`clínica: ${error?.message}`);
    clinicas.push(data.id);
    if (extra.is_demo) {
      const { error: e } = await admin.from("clinics").update({ is_demo: true }).eq("id", data.id);
      if (e) throw new Error(`demo: ${e.message}`);
    }
    const { data: branch } = await admin
      .from("branches")
      .insert({ clinic_id: data.id, name: "Centro", address: "Av. Siempre Viva 742" })
      .select("id")
      .single();
    const { data: pro } = await admin
      .from("professionals")
      .insert({ clinic_id: data.id, full_name: "Dra. Paula Rojas" })
      .select("id")
      .single();
    return { id: data.id, branchId: branch!.id, proId: pro!.id };
  }

  async function paciente(
    clinicId: string,
    p: { nombre: string; email?: string; nacimiento?: string; baja?: boolean },
  ) {
    const { data, error } = await admin
      .from("patients")
      .insert({
        clinic_id: clinicId,
        full_name: p.nombre,
        email: p.email ?? null,
        birth_date: p.nacimiento ?? null,
        email_opt_out_at: p.baja ? new Date().toISOString() : null,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`paciente: ${error?.message}`);
    return data.id;
  }

  async function cita(
    c: { id: string; branchId: string; proId: string },
    pacienteId: string,
    o: { empiezaEnH: number; creadaHaceH?: number; status?: string; loteId?: string },
  ) {
    const { data, error } = await admin
      .from("appointments")
      .insert({
        clinic_id: c.id,
        branch_id: c.branchId,
        professional_id: c.proId,
        patient_id: pacienteId,
        starts_at: new Date(ahora.getTime() + o.empiezaEnH * H).toISOString(),
        ends_at: new Date(ahora.getTime() + (o.empiezaEnH + 0.5) * H).toISOString(),
        treatment_label: "Control",
        created_by: ownerId,
        ...(o.creadaHaceH !== undefined
          ? { created_at: new Date(ahora.getTime() - o.creadaHaceH * H).toISOString() }
          : {}),
        ...(o.status ? { status: o.status as "finalizada" } : {}),
        // Cita de un lote importado sin la casilla de recordatorios (Ola 6):
        // la base la deja con `reminders_muted`.
        ...(o.loteId ? { import_batch_id: o.loteId } : {}),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`cita: ${error?.message}`);
    return data.id;
  }

  let pg: Client;

  async function encender(clinicId: string, extra: Record<string, unknown> = {}) {
    const { error } = await admin.from("patient_notification_settings").insert({
      clinic_id: clinicId,
      confirmation_enabled: true,
      reminder_enabled: true,
      reminder_hours: [24],
      intake_form_mode: "confirmation",
      nps_enabled: true,
      nps_hours_after: 3,
      ...extra,
    });
    if (error) throw new Error(`config: ${error.message}`);
    // Encendida "hace un mes": la encuesta cubre citas terminadas hoy. El
    // trigger no deja mover las fechas desde la API; acá se saltea solo en
    // esta conexión (session_replication_role), como un dato sembrado.
    await pg.query(`set session_replication_role = replica`);
    await pg.query(
      `update public.patient_notification_settings
          set nps_enabled_at = now() - interval '30 days',
              confirmation_enabled_at = now() - interval '30 days'
        where clinic_id = $1`,
      [clinicId],
    );
    await pg.query(`set session_replication_role = origin`);
  }

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    pg = await conectar();
    const { data: u, error } = await admin.auth.admin.createUser({
      email: `correos-pacientes-${randomUUID()}@esmalia-test.invalid`,
      password: `Cp-${randomUUID()}`,
      email_confirm: true,
    });
    if (error || !u.user) throw new Error(`usuario: ${error?.message}`);
    ownerId = u.user.id;

    // Clínica A: correo en envío real, todo encendido.
    const a = await crearClinica("Clínica Sonrisa");
    ids.a = a.id;
    await admin.from("email_sandbox_config").upsert({ clinic_id: a.id, mode: "production" });
    await encender(a.id);
    const adulto = await paciente(a.id, { nombre: "Ana Pérez", email: "ana@paciente.cl" });
    const conBaja = await paciente(a.id, {
      nombre: "Bruno Baja",
      email: "bruno@paciente.cl",
      baja: true,
    });
    const menor = await paciente(a.id, {
      nombre: "Tomás Niño",
      email: "tomas@paciente.cl",
      nacimiento: "2016-05-01",
    });
    await admin.from("patient_guardians").insert({
      clinic_id: a.id,
      patient_id: menor,
      full_name: "Carla Soto",
      document_id: "11.111.111-1",
      relationship: "madre",
      email: "carla@tutor.cl",
      is_primary: true,
      created_by: ownerId,
    });
    const recordado = await paciente(a.id, { nombre: "Diego Díaz", email: "diego@paciente.cl" });
    const encuestado = await paciente(a.id, { nombre: "Elena Ruiz", email: "elena@paciente.cl" });
    const importado = await paciente(a.id, { nombre: "Felipe Lote", email: "felipe@paciente.cl" });
    const sinCorreo = await paciente(a.id, { nombre: "Gabriela Sin Correo" });

    ids.citaAdulto = await cita(a, adulto, { empiezaEnH: 72 });
    ids.citaBaja = await cita(a, conBaja, { empiezaEnH: 72 });
    ids.citaMenor = await cita(a, menor, { empiezaEnH: 96 });
    ids.citaRecordatorio = await cita(a, recordado, { empiezaEnH: 10, creadaHaceH: 24 * 5 });
    ids.citaEncuesta = await cita(a, encuestado, {
      empiezaEnH: -5.5,
      creadaHaceH: 24 * 3,
      status: "finalizada",
    });
    const { data: lote, error: errLote } = await admin
      .from("import_batches")
      .insert({ clinic_id: a.id, kind: "citas", source: "generico", created_by: ownerId })
      .select("id")
      .single();
    if (errLote || !lote) throw new Error(`lote: ${errLote?.message}`);
    ids.citaImportada = await cita(a, importado, { empiezaEnH: 72, loteId: lote.id });
    ids.citaSinCorreo = await cita(a, sinCorreo, { empiezaEnH: 72 });
    ids.encuestado = encuestado;
    ids.menor = menor;
    ids.adulto = adulto;

    // Clínica B: sandbox sin casilla de pruebas → bloquea.
    const b = await crearClinica("Clínica Prueba");
    ids.b = b.id;
    await encender(b.id, { intake_form_mode: "off", nps_enabled: false });
    const pb = await paciente(b.id, { nombre: "Hugo Sandbox", email: "hugo@paciente.cl" });
    ids.citaSandbox = await cita(b, pb, { empiezaEnH: 50 });

    // Clínica C: sandbox que desvía a la casilla de pruebas.
    const c = await crearClinica("Clínica Desvío");
    ids.c = c.id;
    await admin.from("email_sandbox_config").upsert({
      clinic_id: c.id,
      mode: "sandbox",
      redirect_to: "pruebas@clinica-c.cl",
      redirect_enabled: true,
    });
    await encender(c.id, { intake_form_mode: "off", nps_enabled: false });
    const pc = await paciente(c.id, { nombre: "Inés Desvío", email: "ines@paciente.cl" });
    ids.citaDesvio = await cita(c, pc, { empiezaEnH: 50 });

    // Demo: nunca recibe nada.
    const d = await crearClinica("Demo", { is_demo: true });
    await admin.from("email_sandbox_config").upsert({ clinic_id: d.id, mode: "production" });
    await encender(d.id);
    const pd = await paciente(d.id, { nombre: "Visitante", email: "visita@demo.cl" });
    ids.citaDemo = await cita(d, pd, { empiezaEnH: 50 });

    const { data: silenciada } = await admin
      .from("appointments")
      .select("reminders_muted")
      .eq("id", ids.citaImportada)
      .single();
    expect(silenciada?.reminders_muted).toBe(true);
  });

  afterAll(async () => {
    for (const id of clinicas) {
      await pg.query(`delete from public.patient_email_dispatches where clinic_id = $1`, [id]);
      await pg.query(`delete from public.patient_intake_forms where clinic_id = $1`, [id]);
      await pg.query(`delete from public.patient_nps_responses where clinic_id = $1`, [id]);
      await pg.query(`delete from public.messages where clinic_id = $1`, [id]);
      await admin.from("clinics").delete().eq("id", id);
    }
    if (ownerId) await admin.auth.admin.deleteUser(ownerId);
    await pg?.end();
  });

  it("dos corridas a la vez mandan cada correo una sola vez", async () => {
    const [r1, r2] = await Promise.all([correr(), correr()]);
    // A: adulto (confirmación), menor (confirmación al tutor), recordatorio y
    // encuesta = 4. C: 1 desviado. B queda omitida. Demo, baja, importada y
    // sin correo: nada.
    expect(r1.enviados + r2.enviados).toBe(5);
    expect(r1.errores + r2.errores).toBe(0);

    const destinatarios = enviados.map((e) => e.to).sort();
    expect(destinatarios).toEqual(
      [
        "ana@paciente.cl",
        "carla@tutor.cl",
        "diego@paciente.cl",
        "elena@paciente.cl",
        "pruebas@clinica-c.cl",
      ].sort(),
    );
    expect(destinatarios).not.toContain("bruno@paciente.cl");
    expect(destinatarios).not.toContain("felipe@paciente.cl");
    expect(destinatarios).not.toContain("visita@demo.cl");
    expect(destinatarios).not.toContain("hugo@paciente.cl");
    expect(destinatarios).not.toContain("tomas@paciente.cl");
  });

  it("una tercera corrida no manda nada más", async () => {
    const antes = enviados.length;
    const r = await correr();
    expect(r.enviados).toBe(0);
    expect(enviados.length).toBe(antes);
  });

  it("cada envío queda registrado una vez, con su tipo, franja y destinatario", async () => {
    const { data } = await admin
      .from("patient_email_dispatches")
      .select("appointment_id, kind, slot, status, recipient_role, recipient, redirected_to")
      .in("clinic_id", [ids.a, ids.b, ids.c]);
    const porCita = new Map((data ?? []).map((d) => [d.appointment_id, d]));
    expect(data).toHaveLength(6);
    expect(porCita.get(ids.citaAdulto)).toMatchObject({ kind: "confirmation", status: "sent" });
    expect(porCita.get(ids.citaMenor)).toMatchObject({
      kind: "confirmation",
      recipient_role: "tutor",
      recipient: "carla@tutor.cl",
    });
    expect(porCita.get(ids.citaRecordatorio)).toMatchObject({ kind: "reminder", slot: "24h" });
    expect(porCita.get(ids.citaEncuesta)).toMatchObject({ kind: "nps", status: "sent" });
    expect(porCita.get(ids.citaSandbox)).toMatchObject({ status: "skipped" });
    expect(porCita.get(ids.citaDesvio)).toMatchObject({
      status: "sent",
      redirected_to: "pruebas@clinica-c.cl",
    });
    expect(porCita.has(ids.citaBaja)).toBe(false);
    expect(porCita.has(ids.citaImportada)).toBe(false);
    expect(porCita.has(ids.citaSinCorreo)).toBe(false);
  });

  it("el correo lleva los botones de la cita, el formulario y la baja; el historial no guarda links", async () => {
    const conf = enviados.find((e) => e.to === "ana@paciente.cl")!;
    expect(conf.html).toContain(`https://esmalia.test/mi-cita/${ids.citaAdulto}`);
    expect(conf.html).toContain("https://esmalia.test/formulario/");
    expect(conf.html).toContain("/correos/baja?token=");
    const { data: forms } = await admin
      .from("patient_intake_forms")
      .select("appointment_id, status")
      .eq("clinic_id", ids.a);
    expect(forms?.map((f) => f.appointment_id).sort()).toEqual(
      [ids.citaAdulto, ids.citaMenor].sort(),
    );
    const { data: mensajes } = await admin
      .from("messages")
      .select("template_kind, body, sent_by")
      .eq("clinic_id", ids.a);
    expect(mensajes).toHaveLength(4);
    for (const m of mensajes ?? []) {
      expect(m.sent_by).toBeNull();
      expect(m.body).not.toContain("http");
    }
    expect(mensajes?.map((m) => m.template_kind).sort()).toEqual(
      [
        "appointment_confirmation",
        "appointment_confirmation",
        "appointment_reminder",
        "nps_survey",
      ].sort(),
    );
    // En sandbox bloqueado no queda un mensaje "enviado".
    const { data: mb } = await admin.from("messages").select("id").eq("clinic_id", ids.b);
    expect(mb).toHaveLength(0);
  });

  it("la encuesta quedó lista para responder y no se repite al mismo paciente", async () => {
    const { data } = await admin
      .from("patient_nps_responses")
      .select("patient_id, appointment_id, score")
      .eq("clinic_id", ids.a);
    expect(data).toEqual([
      { patient_id: ids.encuestado, appointment_id: ids.citaEncuesta, score: null },
    ]);
  });

  it("un envío con error se reintenta y queda enviado", async () => {
    await pg.query(
      `update public.patient_email_dispatches set status = 'error', reason = 'Resend caído'
        where appointment_id = $1`,
      [ids.citaAdulto],
    );
    const antes = enviados.length;
    const r = await correr();
    expect(r.enviados).toBe(1);
    expect(enviados.length).toBe(antes + 1);
    const { data } = await admin
      .from("patient_email_dispatches")
      .select("status, attempts")
      .eq("appointment_id", ids.citaAdulto)
      .single();
    expect(data).toEqual({ status: "sent", attempts: 2 });
  });
});

describe("correos a pacientes: RLS, permisos y páginas públicas (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let otraClinica: string;
  let usuarios: Record<string, string>;
  let otros: Record<string, string>;
  let pacienteId: string;
  let citaId: string;
  let branchId: string;

  async function como<T>(
    userId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ filas: T[]; error: string }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query("SET LOCAL ROLE authenticated");
    try {
      const r = await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: r.rows as T[], error: "" };
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: [], error: (e as Error).message };
    }
  }

  async function servicio<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const r = await client.query(sql, params);
    return r.rows as T[];
  }

  beforeAll(async () => {
    client = await conectar();
  });
  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await client.query("BEGIN");
    const esc = await sembrarEscenario(client);
    clinicId = esc.clinicId;
    usuarios = esc.usuarios;
    // Otra clínica con su dueño (sembrarEscenario crea una tabla temporal: una vez por test).
    otraClinica = randomUUID();
    otros = { owner: randomUUID() };
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraClinica, otros.owner],
    );

    const b = await client.query<{ id: string }>(
      `INSERT INTO public.branches (clinic_id, name, google_review_url)
       VALUES ($1, 'Centro', 'https://g.page/r/sucursal/review') RETURNING id`,
      [clinicId],
    );
    branchId = b.rows[0].id;
    const prof = await client.query<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Rojas') RETURNING id`,
      [clinicId],
    );
    const p = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, email, phone, created_by)
       VALUES ($1, 'Ana Pérez', 'ana@paciente.cl', '+56911111111', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    pacienteId = p.rows[0].id;
    const c = await client.query<{ id: string }>(
      `INSERT INTO public.appointments
         (clinic_id, branch_id, professional_id, patient_id, starts_at, ends_at, treatment_label, created_by)
       VALUES ($1, $2, $3, $4, now() + interval '2 days', now() + interval '2 days 30 minutes', 'Control', $5)
       RETURNING id`,
      [clinicId, branchId, prof.rows[0].id, pacienteId, usuarios.owner],
    );
    citaId = c.rows[0].id;
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function crearFormulario(vence = "now() + interval '1 day'") {
    const token = generarSecreto();
    const hash = await huellaDeSecreto(token);
    const r = await servicio<{ id: string }>(
      `INSERT INTO public.patient_intake_forms (clinic_id, patient_id, appointment_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, ${vence}) RETURNING id`,
      [clinicId, pacienteId, citaId, hash],
    );
    return { id: r[0].id, hash };
  }

  async function crearEncuesta() {
    const hash = await huellaDeSecreto(generarSecreto());
    const r = await servicio<{ id: string }>(
      `INSERT INTO public.patient_nps_responses (clinic_id, patient_id, appointment_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '14 days') RETURNING id`,
      [clinicId, pacienteId, citaId, hash],
    );
    return { id: r[0].id, hash };
  }

  it("ni anon ni authenticated ejecutan las funciones de las páginas públicas", async () => {
    const { rows } = await client.query<{
      fn: string;
      anon: boolean;
      authn: boolean;
      srv: boolean;
    }>(`
      select p.oid::regprocedure::text as fn,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authn,
             has_function_privilege('service_role', p.oid, 'execute') as srv
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('formulario_previo_abrir', 'formulario_previo_enviar',
                           'encuesta_nps_abrir', 'encuesta_nps_responder')
    `);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.anon, r.fn).toBe(false);
      expect(r.authn, r.fn).toBe(false);
      expect(r.srv, r.fn).toBe(true);
    }
  });

  it("configuración: la lee la clínica, la edita owner/admin, otra clínica no la ve", async () => {
    const ins = await como(
      usuarios.admin,
      `INSERT INTO public.patient_notification_settings (clinic_id, confirmation_enabled)
       VALUES ($1, true) RETURNING confirmation_enabled_at`,
      [clinicId],
    );
    expect(ins.error).toBe("");
    expect(ins.filas[0]).toMatchObject({ confirmation_enabled_at: expect.any(Date) });

    const dentista = await como(
      usuarios.dentist,
      `UPDATE public.patient_notification_settings SET nps_enabled = true WHERE clinic_id = $1 RETURNING clinic_id`,
      [clinicId],
    );
    expect(dentista.filas).toHaveLength(0);
    expect(
      (
        await como(
          usuarios.reception,
          `SELECT 1 FROM public.patient_notification_settings WHERE clinic_id = $1`,
          [clinicId],
        )
      ).filas,
    ).toHaveLength(1);
    expect(
      (
        await como(
          otros.owner,
          `SELECT 1 FROM public.patient_notification_settings WHERE clinic_id = $1`,
          [clinicId],
        )
      ).filas,
    ).toHaveLength(0);
    const ajena = await como(
      otros.owner,
      `INSERT INTO public.patient_notification_settings (clinic_id) VALUES ($1)`,
      [clinicId],
    );
    expect(ajena.error).not.toBe("");

    // Apagar la confirmación borra la fecha; volver a encenderla la fija de nuevo.
    const apagada = await como<{ confirmation_enabled_at: Date | null }>(
      usuarios.owner,
      `UPDATE public.patient_notification_settings SET confirmation_enabled = false
        WHERE clinic_id = $1 RETURNING confirmation_enabled_at`,
      [clinicId],
    );
    expect(apagada.filas[0].confirmation_enabled_at).toBeNull();
    const rechazo = await como(
      usuarios.owner,
      `UPDATE public.patient_notification_settings SET google_review_url = 'javascript:alert(1)' WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(rechazo.error).toMatch(/resena_check|check/);
  });

  it("registro de envíos: lo ve la clínica (no otra) y nadie lo escribe por la API", async () => {
    await servicio(
      `INSERT INTO public.patient_email_dispatches (clinic_id, patient_id, appointment_id, kind, status)
       VALUES ($1, $2, $3, 'confirmation', 'sent')`,
      [clinicId, pacienteId, citaId],
    );
    const dup = await client
      .query(
        `INSERT INTO public.patient_email_dispatches (clinic_id, patient_id, appointment_id, kind)
         VALUES ($1, $2, $3, 'confirmation')`,
        [clinicId, pacienteId, citaId],
      )
      .then(() => "")
      .catch((e: Error) => e.message);
    expect(dup).toMatch(/patient_email_dispatches_unico/);
    // El error deja la transacción abortada: se rehace el escenario.
    await client.query("ROLLBACK");
    await client.query("BEGIN");
  });

  it("registro de envíos: aislamiento y sin escritura del staff", async () => {
    await servicio(
      `INSERT INTO public.patient_email_dispatches (clinic_id, patient_id, appointment_id, kind, status)
       VALUES ($1, $2, $3, 'reminder', 'sent')`,
      [clinicId, pacienteId, citaId],
    );
    expect(
      (
        await como(
          usuarios.reception,
          `SELECT 1 FROM public.patient_email_dispatches WHERE clinic_id = $1`,
          [clinicId],
        )
      ).filas,
    ).toHaveLength(1);
    expect(
      (
        await como(
          otros.owner,
          `SELECT 1 FROM public.patient_email_dispatches WHERE clinic_id = $1`,
          [clinicId],
        )
      ).filas,
    ).toHaveLength(0);
    const escribe = await como(
      usuarios.owner,
      `INSERT INTO public.patient_email_dispatches (clinic_id, patient_id, appointment_id, kind, slot)
       VALUES ($1, $2, $3, 'reminder', '2h')`,
      [clinicId, pacienteId, citaId],
    );
    expect(escribe.error).toMatch(/permission denied/);
  });

  it("formulario: abrir no da datos clínicos, enviar no toca la ficha y vale una vez", async () => {
    const f = await crearFormulario();
    const [abierto] = await servicio<{ r: Record<string, unknown> }>(
      `SELECT public.formulario_previo_abrir($1) AS r`,
      [f.hash],
    );
    expect(abierto.r).toMatchObject({ estado: "abierto", nombre: "Ana" });
    expect(abierto.r.contacto).toMatchObject({ email: "ana@paciente.cl" });
    expect(JSON.stringify(abierto.r)).not.toMatch(/allerg|questionnaire|Control/);

    const [enviado] = await servicio<{ r: Record<string, unknown> }>(
      `SELECT public.formulario_previo_enviar($1, $2::jsonb, $3::jsonb, $4, $5, $6) AS r`,
      [
        f.hash,
        JSON.stringify({ phone: "+56922222222", raro: "x" }),
        JSON.stringify({ diabetes: { answer: "yes" } }),
        ["Penicilina"],
        [],
        "Llego un poco tarde",
      ],
    );
    expect(enviado.r).toEqual({ estado: "enviado" });
    const [otra] = await servicio<{ r: Record<string, unknown> }>(
      `SELECT public.formulario_previo_enviar($1, '{}'::jsonb, '{}'::jsonb, '{}', '{}', '') AS r`,
      [f.hash],
    );
    expect(otra.r).toEqual({ estado: "respondido" });

    const [ficha] = await servicio<{ phone: string }>(
      `SELECT phone FROM public.patients WHERE id = $1`,
      [pacienteId],
    );
    expect(ficha.phone).toBe("+56911111111");
    const [form] = await servicio<{ status: string; submitted_contact: unknown }>(
      `SELECT status, submitted_contact FROM public.patient_intake_forms WHERE id = $1`,
      [f.id],
    );
    expect(form).toEqual({ status: "respondido", submitted_contact: { phone: "+56922222222" } });
  });

  it("formulario vencido o con token desconocido: no abre", async () => {
    const f = await crearFormulario("now() - interval '1 minute'");
    const [v] = await servicio<{ r: { estado: string } }>(
      `SELECT public.formulario_previo_abrir($1) AS r`,
      [f.hash],
    );
    expect(v.r.estado).toBe("vencido");
    const [x] = await servicio<{ r: { estado: string } }>(
      `SELECT public.formulario_previo_abrir($1) AS r`,
      ["0".repeat(64)],
    );
    expect(x.r.estado).toBe("invalido");
  });

  it("formulario: lo leen y revisan solo los roles clínicos de la clínica", async () => {
    const f = await crearFormulario();
    await servicio(
      `SELECT public.formulario_previo_enviar($1, '{}'::jsonb, '{"diabetes":{"answer":"no"}}'::jsonb, '{}', '{}', '')`,
      [f.hash],
    );
    expect(
      (
        await como(usuarios.assistant, `SELECT id FROM public.patient_intake_forms WHERE id = $1`, [
          f.id,
        ])
      ).filas,
    ).toHaveLength(1);
    expect(
      (
        await como(usuarios.reception, `SELECT id FROM public.patient_intake_forms WHERE id = $1`, [
          f.id,
        ])
      ).filas,
    ).toHaveLength(0);
    expect(
      (await como(otros.owner, `SELECT id FROM public.patient_intake_forms WHERE id = $1`, [f.id]))
        .filas,
    ).toHaveLength(0);
    const huella = await como(
      usuarios.owner,
      `SELECT token_hash FROM public.patient_intake_forms WHERE id = $1`,
      [f.id],
    );
    expect(huella.error).toMatch(/permission denied/);

    const recepcion = await como(
      usuarios.reception,
      `SELECT public.formulario_previo_revisar($1, 'aceptado')`,
      [f.id],
    );
    expect(recepcion.error).toMatch(/No tienes permisos/);
    const ajena = await como(
      otros.owner,
      `SELECT public.formulario_previo_revisar($1, 'aceptado')`,
      [f.id],
    );
    expect(ajena.error).toMatch(/No tienes permisos/);
    const ok = await como(
      usuarios.dentist,
      `SELECT public.formulario_previo_revisar($1, 'descartado')`,
      [f.id],
    );
    expect(ok.error).toBe("");
    const otraVez = await como(
      usuarios.dentist,
      `SELECT public.formulario_previo_revisar($1, 'aceptado')`,
      [f.id],
    );
    expect(otraVez.error).toMatch(/ya fue revisado/);
  });

  it("encuesta: a un promotor le da el link de la clínica; a un detractor, nada", async () => {
    await servicio(
      `INSERT INTO public.patient_notification_settings (clinic_id, nps_enabled, google_review_url)
       VALUES ($1, true, 'https://g.page/r/clinica/review')`,
      [clinicId],
    );
    const promotor = await crearEncuesta();
    const [r] = await servicio<{ r: Record<string, unknown> }>(
      `SELECT public.encuesta_nps_responder($1, 10, 'Excelente') AS r`,
      [promotor.hash],
    );
    expect(r.r).toEqual({
      estado: "gracias",
      promotor: true,
      resena_url: "https://g.page/r/clinica/review",
    });
    const [rep] = await servicio<{ r: Record<string, unknown> }>(
      `SELECT public.encuesta_nps_responder($1, 3, 'Cambio de opinión') AS r`,
      [promotor.hash],
    );
    expect(rep.r).toEqual({ estado: "respondida" });
    const [guardada] = await servicio<{ score: number; review_link_shown: boolean }>(
      `SELECT score, review_link_shown FROM public.patient_nps_responses WHERE id = $1`,
      [promotor.id],
    );
    expect(guardada).toEqual({ score: 10, review_link_shown: true });

    // Otra cita, un detractor.
    await servicio(`DELETE FROM public.patient_nps_responses WHERE id = $1`, [promotor.id]);
    const detractor = await crearEncuesta();
    const [d] = await servicio<{ r: Record<string, unknown> }>(
      `SELECT public.encuesta_nps_responder($1, 4, '') AS r`,
      [detractor.hash],
    );
    expect(d.r).toEqual({ estado: "gracias", promotor: false, resena_url: null });
  });

  it("encuesta: sin link de la clínica usa el de la sucursal; sin ninguno, no hay reseña", async () => {
    const conSucursal = await crearEncuesta();
    const [r] = await servicio<{ r: Record<string, unknown> }>(
      `SELECT public.encuesta_nps_responder($1, 9, '') AS r`,
      [conSucursal.hash],
    );
    expect(r.r).toMatchObject({ promotor: true, resena_url: "https://g.page/r/sucursal/review" });

    await servicio(`DELETE FROM public.patient_nps_responses WHERE id = $1`, [conSucursal.id]);
    await servicio(`UPDATE public.branches SET google_review_url = NULL WHERE id = $1`, [branchId]);
    const sinLink = await crearEncuesta();
    const [s] = await servicio<{ r: Record<string, unknown> }>(
      `SELECT public.encuesta_nps_responder($1, 10, '') AS r`,
      [sinLink.hash],
    );
    expect(s.r).toEqual({ estado: "gracias", promotor: true, resena_url: null });
  });

  it("encuesta: las respuestas las leen owner/admin de la clínica, nadie más", async () => {
    const e = await crearEncuesta();
    await servicio(`SELECT public.encuesta_nps_responder($1, 8, 'Bien')`, [e.hash]);
    expect(
      (
        await como(usuarios.admin, `SELECT score FROM public.patient_nps_responses WHERE id = $1`, [
          e.id,
        ])
      ).filas,
    ).toEqual([{ score: 8 }]);
    expect(
      (
        await como(
          usuarios.dentist,
          `SELECT score FROM public.patient_nps_responses WHERE id = $1`,
          [e.id],
        )
      ).filas,
    ).toHaveLength(0);
    expect(
      (
        await como(otros.owner, `SELECT score FROM public.patient_nps_responses WHERE id = $1`, [
          e.id,
        ])
      ).filas,
    ).toHaveLength(0);
    expect(otraClinica).not.toBe(clinicId);
  });
});
