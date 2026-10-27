import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, esperaFallo, sembrarEscenario } from "./helpers/db";

/**
 * Cierre · Bloque 5 · ítem 3 (migración 20261113200000): la fusión de fichas
 * mueve también la afiliación a empresa con convenio, la membresía, sus
 * cuotas y las inscripciones a citas grupales.
 *
 * - Todo viaja a la ficha que queda; la absorbida queda marcada, no borrada.
 * - Conflictos con salida clara y sin dejar la fusión a medias (dos
 *   membresías vigentes; dos empresas distintas).
 * - Cita grupal con las dos fichas inscritas: no se duplica el cupo.
 * - Las notas firmadas no se mueven (siguen en la ficha vieja).
 * - Otra clínica no se toca; quien no es owner/admin no puede fusionar.
 * - La marca de la fusión no sirve fuera de ella: cambiar el paciente de una
 *   cuota o de una inscripción a mano sigue prohibido.
 */
describe("fusión de fichas completa en la base", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let pacA: string; // la que se absorbe
  let pacB: string; // la que queda

  async function comoOwner() {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: usuarios.owner, role: "authenticated" }),
    ]);
  }

  async function fusionar(origen: string, destino: string, clinica = clinicId) {
    await comoOwner();
    await client.query(`SELECT public.merge_patients($1, $2, $3)`, [clinica, origen, destino]);
  }

  async function paciente(nombre: string): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [clinicId, nombre, usuarios.owner],
    );
    return r.rows[0].id;
  }

  async function empresa(nombre: string): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.partner_companies (clinic_id, name, discount_kind, discount_percent, currency, created_by)
       VALUES ($1, $2, 'percent', 10, 'CLP', $3) RETURNING id`,
      [clinicId, nombre, usuarios.owner],
    );
    return r.rows[0].id;
  }

  async function afiliar(pac: string, empresaId: string) {
    await client.query(
      `INSERT INTO public.partner_company_patients (clinic_id, company_id, patient_id, created_by)
       VALUES ($1, $2, $3, $4)`,
      [clinicId, empresaId, pac, usuarios.owner],
    );
  }

  async function plan(): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.membership_plans (clinic_id, name, fee_cents, currency, created_by)
       VALUES ($1, 'Plan sonrisa', 15000, 'CLP', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    return r.rows[0].id;
  }

  async function inscribir(pac: string, planId: string, estado = "active"): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.patient_memberships (clinic_id, patient_id, plan_id, plan_name_snapshot, fee_cents, currency, billing_period, starts_on, status, created_by)
       VALUES ($1, $2, $3, 'x', 1, 'CLP', 'monthly', '2026-10-01', $5, $4) RETURNING id`,
      [clinicId, pac, planId, usuarios.owner, estado],
    );
    return r.rows[0].id;
  }

  async function cuota(membresia: string, mes: string): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.membership_charges (clinic_id, membership_id, patient_id, period_start, period_end, amount_cents, currency, created_by)
       VALUES ($1, $2, $3, $4::date, ($4::date + interval '1 month - 1 day')::date, 15000, 'CLP', $5) RETURNING id`,
      [clinicId, membresia, pacA, mes, usuarios.owner],
    );
    return r.rows[0].id;
  }

  async function citaGrupal(cupo = 10): Promise<string> {
    const branch = await client.query<{ id: string }>(
      `INSERT INTO public.branches (clinic_id, name, timezone) VALUES ($1, 'Matriz', 'America/Santiago') RETURNING id`,
      [clinicId],
    );
    const prof = await client.query<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, branch_id, full_name) VALUES ($1, $2, 'Dra. Grupal') RETURNING id`,
      [clinicId, branch.rows[0].id],
    );
    const cita = await client.query<{ id: string }>(
      `INSERT INTO public.appointments (clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at, status, created_by)
       VALUES ($1, $2, $3, $4, now() - interval '3 hours', now() - interval '2 hours', 'confirmada', $5) RETURNING id`,
      [clinicId, branch.rows[0].id, pacA, prof.rows[0].id, usuarios.owner],
    );
    await client.query(
      `INSERT INTO public.appointment_groups (appointment_id, clinic_id, title, capacity)
       VALUES ($1, $2, 'Charla de higiene', $3)`,
      [cita.rows[0].id, clinicId, cupo],
    );
    return cita.rows[0].id;
  }

  async function inscrito(citaId: string, pac: string) {
    await client.query(
      `INSERT INTO public.appointment_group_participants (clinic_id, appointment_id, patient_id) VALUES ($1, $2, $3)
       ON CONFLICT (appointment_id, patient_id) DO NOTHING`,
      [clinicId, citaId, pac],
    );
  }

  async function filas<T>(sql: string, params: unknown[]): Promise<T[]> {
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
    pacA = await paciente("Ana Duplicada");
    pacB = await paciente("Ana Duplicada");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("mueve la afiliación a empresa a la ficha que queda", async () => {
    const e = await empresa("Minera Norte");
    await afiliar(pacA, e);
    await fusionar(pacA, pacB);
    const r = await filas<{ patient_id: string }>(
      `SELECT patient_id FROM public.partner_company_patients WHERE company_id = $1`,
      [e],
    );
    expect(r).toEqual([{ patient_id: pacB }]);
  });

  it("misma empresa en las dos fichas: no falla y la fila absorbida se queda (no se borra)", async () => {
    const e = await empresa("Minera Norte");
    await afiliar(pacA, e);
    await afiliar(pacB, e);
    await fusionar(pacA, pacB);
    const r = await filas<{ patient_id: string }>(
      `SELECT patient_id FROM public.partner_company_patients WHERE company_id = $1 ORDER BY patient_id`,
      [e],
    );
    expect(r.map((x) => x.patient_id).sort()).toEqual([pacA, pacB].sort());
  });

  it("empresas distintas: avisa y no deja la fusión a medias", async () => {
    await afiliar(pacA, await empresa("Minera Norte"));
    await afiliar(pacB, await empresa("Banco Sur"));
    const f = await esperaFallo(client, () => fusionar(pacA, pacB));
    expect(f.message).toMatch(/empresas con convenio distintas/);
    const quedo = await filas<{ merged_into: string | null }>(
      `SELECT merged_into FROM public.patients WHERE id = $1`,
      [pacA],
    );
    expect(quedo[0].merged_into).toBeNull();
  });

  it("mueve la membresía (con su historial cancelado) y todas sus cuotas", async () => {
    const p = await plan();
    const vieja = await inscribir(pacA, p, "cancelled");
    const vigente = await inscribir(pacA, p);
    const c1 = await cuota(vieja, "2026-08-01");
    const c2 = await cuota(vigente, "2026-10-01");
    await fusionar(pacA, pacB);
    const m = await filas<{ id: string; patient_id: string }>(
      `SELECT id, patient_id FROM public.patient_memberships WHERE id = ANY($1)`,
      [[vieja, vigente]],
    );
    expect(m.every((x) => x.patient_id === pacB)).toBe(true);
    const c = await filas<{ id: string; patient_id: string }>(
      `SELECT id, patient_id FROM public.membership_charges WHERE id = ANY($1)`,
      [[c1, c2]],
    );
    expect(c).toHaveLength(2);
    expect(c.every((x) => x.patient_id === pacB)).toBe(true);
  });

  it("dos membresías vigentes: avisa que cancele una y no mueve nada", async () => {
    const p = await plan();
    const mA = await inscribir(pacA, p);
    await inscribir(pacB, p, "paused");
    const f = await esperaFallo(client, () => fusionar(pacA, pacB));
    expect(f.message).toMatch(/membresía vigente/);
    const r = await filas<{ patient_id: string }>(
      `SELECT patient_id FROM public.patient_memberships WHERE id = $1`,
      [mA],
    );
    expect(r[0].patient_id).toBe(pacA);
  });

  it("una membresía cancelada en la que queda no estorba a la vigente de la absorbida", async () => {
    const p = await plan();
    await inscribir(pacB, p, "cancelled");
    const vigente = await inscribir(pacA, p);
    await fusionar(pacA, pacB);
    const r = await filas<{ patient_id: string }>(
      `SELECT patient_id FROM public.patient_memberships WHERE id = $1`,
      [vigente],
    );
    expect(r[0].patient_id).toBe(pacB);
  });

  it("mueve las inscripciones a citas grupales con su asistencia y sin tocar el cupo", async () => {
    const cita = await citaGrupal(3);
    await inscrito(cita, pacA);
    await inscrito(cita, await paciente("Otra Persona"));
    await client.query(
      `UPDATE public.appointment_group_participants SET attendance = 'asistio' WHERE appointment_id = $1 AND patient_id = $2`,
      [cita, pacA],
    );
    await fusionar(pacA, pacB);
    const r = await filas<{ patient_id: string; attendance: string; withdrawn_at: string | null }>(
      `SELECT patient_id, attendance, withdrawn_at FROM public.appointment_group_participants
        WHERE appointment_id = $1 ORDER BY enrolled_at`,
      [cita],
    );
    expect(r).toHaveLength(2);
    const suya = r.find((x) => x.patient_id === pacB);
    expect(suya?.attendance).toBe("asistio");
    expect(suya?.withdrawn_at).toBeNull();
    expect(r.some((x) => x.patient_id === pacA)).toBe(false);
    const cupo = await filas<{ n: string }>(
      `SELECT count(*) AS n FROM public.appointment_group_participants WHERE appointment_id = $1 AND withdrawn_at IS NULL`,
      [cita],
    );
    expect(Number(cupo[0].n)).toBe(2);
  });

  it("las dos fichas inscritas en la misma cita: la absorbida se retira y el cupo no se duplica", async () => {
    const cita = await citaGrupal(3);
    await inscrito(cita, pacA);
    await inscrito(cita, pacB);
    await fusionar(pacA, pacB);
    const r = await filas<{ patient_id: string; withdrawn_at: string | null; reason: string | null }>(
      `SELECT patient_id, withdrawn_at, withdraw_reason AS reason FROM public.appointment_group_participants WHERE appointment_id = $1`,
      [cita],
    );
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.patient_id === pacB)?.withdrawn_at).toBeNull();
    const absorbida = r.find((x) => x.patient_id === pacA);
    expect(absorbida?.withdrawn_at).not.toBeNull();
    expect(absorbida?.reason).toMatch(/Ficha fusionada/);
    // La cita sigue teniendo como titular a una ficha que está inscrita.
    const titular = await filas<{ patient_id: string }>(
      `SELECT patient_id FROM public.appointments WHERE id = $1`,
      [cita],
    );
    expect(titular[0].patient_id).toBe(pacB);
  });

  it("no mueve las notas firmadas: siguen colgando de la ficha vieja y la absorbida queda marcada", async () => {
    const nota = randomUUID();
    await client.query(
      `INSERT INTO public.clinical_notes (id, clinic_id, patient_ref, title, content, status, created_by)
       VALUES ($1, $2, $3, 'Control', 'Sin novedades', 'draft', $4)`,
      [nota, clinicId, pacA, usuarios.dentist],
    );
    await fusionar(pacA, pacB);
    const p = await filas<{ merged_into: string | null; status: string }>(
      `SELECT merged_into, status FROM public.patients WHERE id = $1`,
      [pacA],
    );
    expect(p[0].merged_into).toBe(pacB);
    expect(p[0].status).toBe("inactive");
    const n = await filas<{ patient_ref: string }>(
      `SELECT patient_ref FROM public.clinical_notes WHERE id = $1`,
      [nota],
    );
    expect(n[0].patient_ref).toBe(pacA);
  });

  it("solo owner o admin fusionan", async () => {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: usuarios.reception, role: "authenticated" }),
    ]);
    await client.query("SAVEPOINT sp_rol");
    await client.query("SET LOCAL ROLE authenticated");
    let mensaje = "";
    try {
      await client.query(`SELECT public.merge_patients($1, $2, $3)`, [clinicId, pacA, pacB]);
    } catch (e) {
      mensaje = (e as Error).message;
    }
    await client.query("ROLLBACK TO SAVEPOINT sp_rol");
    await client.query("RESET ROLE");
    expect(mensaje).toMatch(/No tienes permisos/);
  });

  it("no cruza clínicas: una ficha de otra clínica no se puede fusionar", async () => {
    const otraClinica = randomUUID();
    const otroUsuario = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra', $2)`,
      [otraClinica, otroUsuario],
    );
    const ajena = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Ajena', $2) RETURNING id`,
      [otraClinica, otroUsuario],
    );
    const f = await esperaFallo(client, () => fusionar(ajena.rows[0].id, pacB));
    expect(f.message).toMatch(/pertenece a esta clínica|No tienes permisos|no pertenece/);
  });

  it("la marca de la fusión no vale fuera de ella: cambiar a mano el paciente de una cuota o de una inscripción falla", async () => {
    const p = await plan();
    const m = await inscribir(pacA, p);
    const c = await cuota(m, "2026-10-01");
    const f1 = await esperaFallo(client, () =>
      client.query(`UPDATE public.membership_charges SET patient_id = $1 WHERE id = $2`, [pacB, c]),
    );
    expect(f1.message).toMatch(/no se editan/);
    const cita = await citaGrupal();
    await inscrito(cita, pacA);
    const f2 = await esperaFallo(client, () =>
      client.query(
        `UPDATE public.appointment_group_participants SET patient_id = $1 WHERE appointment_id = $2 AND patient_id = $3`,
        [pacB, cita, pacA],
      ),
    );
    expect(f2.message).toMatch(/no se cambian/);
  });
});
