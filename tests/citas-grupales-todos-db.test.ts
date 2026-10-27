import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar } from "./helpers/db";

/**
 * Cierre · Bloque 5 · ítems 4 y 7 (migraciones 20261113200100 y
 * 20261113200200), contra la base efímera.
 *
 * Ítem 4 — la cita grupal para TODOS los inscritos, no solo el titular
 * (`appointments.patient_id`):
 *  - seguimiento / recall: «tiene próxima cita», última visita, inasistencias.
 *  - informes de asistencia: atenciones y ausencias por inscrito; citas y
 *    horas siguen contando la sesión una vez.
 *  - embudo: el inscrito cuenta como paciente con cita y atendido.
 *  - confirmación por inscrito (no marca la cita entera).
 * Ítem 7 — sexo opcional y su corte en Informes.
 * Aislamiento: otra clínica no ve nada de esto.
 */
describe("citas grupales para todos los inscritos y sexo, en la base", () => {
  let client: Client;
  let clinicId: string;
  let owner: string;
  let reception: string;
  let assistant: string;
  let branchId: string;
  let profId: string;
  let p1: string; // titular de las dos grupales
  let p2: string;
  let p3: string;
  let p4: string; // se retiró
  let grupalFutura: string;
  let grupalPasada: string;

  async function servicio<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    return (await client.query(sql, params)).rows as T[];
  }

  async function como<T = Record<string, unknown>>(
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
      return { filas: [] as T[], error: (e as Error).message };
    }
  }

  async function paciente(nombre: string, extra = ""): Promise<string> {
    const r = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by, wa_opt_in, created_at ${extra ? ", sex" : ""})
       VALUES ($1, $2, $3, true, now() ${extra ? ", $4" : ""}) RETURNING id`,
      extra ? [clinicId, nombre, owner, extra] : [clinicId, nombre, owner],
    );
    return r[0].id;
  }

  async function cita(titular: string, inicio: string, estado: string): Promise<string> {
    const r = await servicio<{ id: string }>(
      `INSERT INTO public.appointments (clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at, status, created_by)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '60 min', $6::public.appointment_status, $7) RETURNING id`,
      [clinicId, branchId, titular, profId, inicio, estado, owner],
    );
    return r[0].id;
  }

  async function volverGrupal(citaId: string, inscritos: string[]) {
    await servicio(
      `INSERT INTO public.appointment_groups (appointment_id, clinic_id, title, capacity) VALUES ($1, $2, 'Charla de higiene', 10)`,
      [citaId, clinicId],
    );
    for (const p of inscritos) {
      await servicio(
        `INSERT INTO public.appointment_group_participants (clinic_id, appointment_id, patient_id) VALUES ($1, $2, $3)
         ON CONFLICT (appointment_id, patient_id) DO NOTHING`,
        [clinicId, citaId, p],
      );
    }
  }

  async function asistencia(citaId: string, pac: string, valor: string) {
    await servicio(
      `UPDATE public.appointment_group_participants SET attendance = $3 WHERE appointment_id = $1 AND patient_id = $2`,
      [citaId, pac, valor],
    );
  }

  beforeAll(async () => {
    client = await conectar();
  });
  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await client.query("BEGIN");
    clinicId = randomUUID();
    owner = randomUUID();
    reception = randomUUID();
    assistant = randomUUID();
    await servicio(
      `INSERT INTO public.clinics (id, name, created_by, timezone) VALUES ($1, 'Clínica Grupal', $2, 'America/Santiago')`,
      [clinicId, owner],
    );
    await servicio(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role)
       SELECT $1, u, r::public.app_role FROM unnest($2::uuid[], $3::text[]) AS t(u, r)
       ON CONFLICT DO NOTHING`,
      [clinicId, [owner, reception, assistant], ["owner", "reception", "assistant"]],
    );
    branchId = (
      await servicio<{ id: string }>(
        `INSERT INTO public.branches (clinic_id, name, timezone) VALUES ($1, 'Matriz', 'America/Santiago') RETURNING id`,
        [clinicId],
      )
    )[0].id;
    profId = (
      await servicio<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, branch_id, full_name) VALUES ($1, $2, 'Dra. Grupal') RETURNING id`,
        [clinicId, branchId],
      )
    )[0].id;
    p1 = await paciente("Titular Uno");
    p2 = await paciente("Inscrita Dos");
    p3 = await paciente("Inscrito Tres");
    p4 = await paciente("Retirada Cuatro");

    // Una grupal de mañana y otra de ayer (ya finalizada), con los mismos inscritos.
    grupalFutura = await cita(p1, new Date(Date.now() + 26 * 3600_000).toISOString(), "confirmada");
    await volverGrupal(grupalFutura, [p1, p2, p3, p4]);
    await servicio(
      `UPDATE public.appointment_group_participants SET withdrawn_at = now() WHERE appointment_id = $1 AND patient_id = $2`,
      [grupalFutura, p4],
    );
    grupalPasada = await cita(p1, new Date(Date.now() - 30 * 3600_000).toISOString(), "finalizada");
    await volverGrupal(grupalPasada, [p1, p2, p3]);
    await asistencia(grupalPasada, p1, "asistio");
    await asistencia(grupalPasada, p2, "ausente");
    // p3 queda sin marcar en una sesión finalizada.
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  // ─── Recall / seguimiento ──────────────────────────────────────────────

  it("seguimiento: cada inscrito tiene su próxima cita, su visita y su inasistencia", async () => {
    const r = await servicio<{
      patient_id: string;
      visits: number;
      has_future: boolean;
      no_shows_12m: number;
      last_visit_at: string | null;
    }>(`SELECT * FROM public.seguimiento_datos_de_pacientes($1)`, [clinicId]);
    const de = (id: string) => r.find((f) => f.patient_id === id)!;
    // Antes del cambio solo el titular (p1) tenía «próxima cita».
    expect(de(p1).has_future).toBe(true);
    expect(de(p2).has_future).toBe(true);
    expect(de(p3).has_future).toBe(true);
    expect(de(p4).has_future).toBe(false); // retirada: no está en la cita
    expect(de(p1).visits).toBe(1); // asistió
    expect(de(p2).visits).toBe(0);
    expect(de(p2).no_shows_12m).toBe(1); // ausente en SU asistencia
    expect(de(p3).visits).toBe(1); // sin marcar en una sesión finalizada
    expect(de(p1).no_shows_12m).toBe(0);
  });

  it("recall de higiene: la última visita y «ya viene de vuelta» son por inscrito", async () => {
    const r = await servicio<{
      patient_id: string;
      last_visit_at: string | null;
      has_future: boolean;
    }>(`SELECT * FROM public.outreach_patient_visits($1)`, [clinicId]);
    const de = (id: string) => r.find((f) => f.patient_id === id);
    expect(de(p1)?.last_visit_at).not.toBeNull();
    expect(de(p3)?.last_visit_at).not.toBeNull();
    expect(de(p3)?.has_future).toBe(true);
    // p2 estuvo ausente: sin visita, no entra al recall.
    expect(de(p2)).toBeUndefined();
  });

  it("la lista de pacientes ve la última y la próxima cita de cada inscrito", async () => {
    const r = await como<{
      patient_id: string;
      last_appointment_at: string | null;
      last_appointment_status: string | null;
      next_appointment_at: string | null;
    }>(owner, `SELECT * FROM public.list_patients_with_last_and_next_appointment($1)`, [clinicId]);
    expect(r.error).toBe("");
    const de = (id: string) => r.filas.find((f) => f.patient_id === id)!;
    expect(de(p2).next_appointment_at).not.toBeNull();
    expect(de(p3).next_appointment_at).not.toBeNull();
    expect(de(p2).last_appointment_status).toBe("ausente");
    expect(de(p3).last_appointment_status).toBe("finalizada");
    expect(de(p4).next_appointment_at).toBeNull();
  });

  it("planes detenidos: el inscrito con un plan activo ya no figura sin cita", async () => {
    const plan = await servicio<{ id: string }>(
      `INSERT INTO public.treatment_plans (clinic_id, patient_id, name, status, created_by)
       VALUES ($1, $2, 'Plan', 'active', $3) RETURNING id`,
      [clinicId, p2, owner],
    );
    const r = await servicio<{ plan_id: string; has_future: boolean }>(
      `SELECT * FROM public.seguimiento_planes_activos($1)`,
      [clinicId],
    );
    expect(r.find((f) => f.plan_id === plan[0].id)?.has_future).toBe(true);
  });

  // ─── Informes de asistencia ────────────────────────────────────────────

  async function metrica(metrica: string, corte = "total") {
    const hoy = new Date().toISOString().slice(0, 10);
    const desde = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const hasta = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    void hoy;
    return servicio<{ clave: string | null; valor: string; n: string; pacientes: string }>(
      `SELECT * FROM public.informe_metrica($1, $2, $3::date, $4::date, $5)`,
      [clinicId, metrica, desde, hasta, corte],
    );
  }

  it("atenciones y ausencias cuentan a cada inscrito; citas y horas, la sesión una vez", async () => {
    const atenciones = await metrica("atenciones");
    // p1 asistió y p3 quedó sin marcar en una sesión finalizada: dos atenciones (antes: una sola, la del titular).
    expect(Number(atenciones[0].valor)).toBe(2);
    expect(Number(atenciones[0].pacientes)).toBe(2);
    const ausencias = await metrica("ausencias");
    expect(Number(ausencias[0].valor)).toBe(1);
    const citas = await metrica("citas");
    expect(Number(citas[0].valor)).toBe(2); // las dos sesiones, una vez cada una
    const horas = await metrica("horas_agendadas");
    expect(Number(horas[0].valor)).toBe(120); // 2 sesiones de 60 min: no se duplican por inscrito
  });

  it("el detalle de las atenciones trae un registro por inscrito, con ids distintos", async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    void hoy;
    const desde = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const hasta = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const filas = await servicio<{ ref_id: string; patient_id: string; estado: string }>(
      `SELECT ref_id, patient_id, estado FROM public.informe_detalle($1, 'atenciones', $2::date, $3::date)`,
      [clinicId, desde, hasta],
    );
    expect(new Set(filas.map((f) => f.ref_id)).size).toBe(filas.length);
    expect(filas.map((f) => f.patient_id).sort()).toEqual([p1, p3].sort());
  });

  it("el embudo cuenta al inscrito como paciente con cita y atendido", async () => {
    const hasta = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const desde = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const r = await como<{ contactos: string; con_cita: string; atendidos: string }>(
      owner,
      `SELECT * FROM public.informe_embudo($1, $2::date, $3::date)`,
      [clinicId, desde, hasta],
    );
    expect(r.error).toBe("");
    const total = r.filas.reduce(
      (s, f) => ({
        contactos: s.contactos + Number(f.contactos),
        con_cita: s.con_cita + Number(f.con_cita),
        atendidos: s.atendidos + Number(f.atendidos),
      }),
      { contactos: 0, con_cita: 0, atendidos: 0 },
    );
    expect(total.contactos).toBe(4);
    expect(total.con_cita).toBe(4); // p4 se retiró pero estuvo inscrita
    expect(total.atendidos).toBe(2); // p1 y p3; p2 estuvo ausente
  });

  // ─── Confirmación por inscrito ─────────────────────────────────────────

  it("el aviso del paciente es por inscrito y no marca la cita entera", async () => {
    await servicio(
      `UPDATE public.appointment_group_participants
          SET patient_confirmed_at = now(), patient_confirmed_via = 'whatsapp'
        WHERE appointment_id = $1 AND patient_id = $2`,
      [grupalFutura, p2],
    );
    const filas = await servicio<{ patient_id: string; patient_confirmed_at: string | null }>(
      `SELECT patient_id, patient_confirmed_at FROM public.appointment_group_participants WHERE appointment_id = $1`,
      [grupalFutura],
    );
    expect(filas.find((f) => f.patient_id === p2)?.patient_confirmed_at).not.toBeNull();
    expect(filas.find((f) => f.patient_id === p3)?.patient_confirmed_at).toBeNull();
    const cabecera = await servicio<{ patient_confirmed_at: string | null }>(
      `SELECT patient_confirmed_at FROM public.appointments WHERE id = $1`,
      [grupalFutura],
    );
    expect(cabecera[0].patient_confirmed_at).toBeNull();
  });

  it("anotar el aviso lo puede hacer recepción pero no un asistente (mismo permiso que inscribir)", async () => {
    const sql = `UPDATE public.appointment_group_participants
                    SET patient_confirmed_at = now(), patient_confirmed_via = 'telefono'
                  WHERE appointment_id = $1 AND patient_id = $2 RETURNING id`;
    const recepcion = await como(reception, sql, [grupalFutura, p2]);
    expect(recepcion.filas).toHaveLength(1);
    const asistente = await como(assistant, sql, [grupalFutura, p3]);
    expect(asistente.filas).toHaveLength(0);
  });

  // ─── Sexo (ítem 7) ─────────────────────────────────────────────────────

  it("el sexo es opcional y solo admite las opciones del formulario", async () => {
    await servicio(`UPDATE public.patients SET sex = 'prefiere_no_decir' WHERE id = $1`, [p1]);
    await servicio(`UPDATE public.patients SET sex = NULL WHERE id = $1`, [p1]);
    await client.query("SAVEPOINT sp_sex");
    await expect(
      client.query(`UPDATE public.patients SET sex = 'x' WHERE id = $1`, [p1]),
    ).rejects.toThrow(/patients_sex_check|check constraint/i);
    await client.query("ROLLBACK TO SAVEPOINT sp_sex");
  });

  it("Informes corta por sexo: «prefiere no decir» es una respuesta y lo no registrado sale como sin dato", async () => {
    await servicio(`UPDATE public.patients SET sex = 'femenino' WHERE id = ANY($1)`, [[p1, p2]]);
    await servicio(`UPDATE public.patients SET sex = 'prefiere_no_decir' WHERE id = $1`, [p3]);
    const hasta = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const desde = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const filas = await servicio<{ clave: string | null; valor: string }>(
      `SELECT clave, valor FROM public.informe_metrica($1, 'pacientes_nuevos', $2::date, $3::date, 'sexo')`,
      [clinicId, desde, hasta],
    );
    const por = new Map(filas.map((f) => [f.clave, Number(f.valor)]));
    expect(por.get("femenino")).toBe(2);
    expect(por.get("prefiere_no_decir")).toBe(1);
    expect(por.get(null)).toBe(1); // p4 sin registrar
    // Una métrica de agenda también admite el corte (atenciones por sexo).
    const atenciones = await servicio<{ clave: string | null; valor: string }>(
      `SELECT clave, valor FROM public.informe_metrica($1, 'atenciones', $2::date, $3::date, 'sexo')`,
      [clinicId, desde, hasta],
    );
    const poSexo = new Map(atenciones.map((f) => [f.clave, Number(f.valor)]));
    expect(poSexo.get("femenino")).toBe(1); // p1
    expect(poSexo.get("prefiere_no_decir")).toBe(1); // p3
  });

  // ─── Aislamiento entre clínicas ────────────────────────────────────────

  it("otra clínica no ve nada: ni seguimiento, ni lista, ni informes de esta", async () => {
    const otraClinica = randomUUID();
    const otroOwner = randomUUID();
    await servicio(
      `INSERT INTO public.clinics (id, name, created_by, timezone) VALUES ($1, 'Ajena', $2, 'America/Santiago')`,
      [otraClinica, otroOwner],
    );
    const seguimiento = await como(
      otroOwner,
      `SELECT * FROM public.seguimiento_datos_de_pacientes($1)`,
      [clinicId],
    );
    expect(seguimiento.filas).toHaveLength(0);
    const lista = await como(
      otroOwner,
      `SELECT * FROM public.list_patients_with_last_and_next_appointment($1)`,
      [clinicId],
    );
    expect(lista.error).toMatch(/No tienes permisos/);
    const desde = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const hasta = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const informe = await como(
      otroOwner,
      `SELECT * FROM public.informe_metrica($1, 'atenciones', $2::date, $3::date)`,
      [clinicId, desde, hasta],
    );
    expect(informe.filas).toHaveLength(0);
    const inscritos = await como(
      otroOwner,
      `SELECT * FROM public.appointment_group_participants WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(inscritos.filas).toHaveLength(0);
    const edicion = await como(
      otroOwner,
      `UPDATE public.appointment_group_participants SET patient_confirmed_at = now() WHERE clinic_id = $1 RETURNING id`,
      [clinicId],
    );
    expect(edicion.filas).toHaveLength(0);
  });
});
