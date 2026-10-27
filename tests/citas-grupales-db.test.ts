import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";

import { conectar } from "./helpers/db";

/**
 * Ola 14 · frente B · AGE-22 citas grupales (migración 20261110200000),
 * contra la base efímera:
 *
 * - Aislamiento: otra clínica no ve ni escribe grupos ni inscritos; asistente
 *   y contabilidad ven pero no inscriben; "quitar agendar" por persona corta.
 * - Cupo: no se inscribe a nadie con la cita llena (tampoco reincorporando) y
 *   el cupo no baja de los inscritos vigentes.
 * - Asistencia individual: cada inscrito tiene la suya, solo desde que empezó
 *   la cita; un retiro la vuelve a pendiente; la cita entera no se marca
 *   ausente. El titular (`appointments.patient_id`) sigue al primer inscrito.
 * - Contadores de la ficha: cada participante cuenta su propia asistencia.
 * - La reserva en línea ve la cita grupal como un horario ocupado (una sola
 *   vez) y sigue reservando en otro horario.
 */

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

interface Clinica {
  clinicId: string;
  owner: string;
  reception: string;
  assistant: string;
  accounting: string;
  branchId: string;
  profId: string;
  boxId: string;
  tipoId: string;
  slug: string;
  pacientes: string[];
}

describe("citas grupales en la base", () => {
  let client: Client;
  let a: Clinica;
  let b: Clinica;

  async function servicio<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const r = await client.query(sql, params);
    return r.rows as T[];
  }

  async function como<T = Record<string, unknown>>(
    userId: string,
    sql: string,
    params: unknown[] = [],
  ) {
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

  async function sembrarClinica(slug: string): Promise<Clinica> {
    const clinicId = randomUUID();
    const owner = randomUUID();
    const reception = randomUUID();
    const assistant = randomUUID();
    const accounting = randomUUID();
    const branchId = randomUUID();
    const profId = randomUUID();
    const boxId = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by, country, timezone) VALUES ($1, $2, $3, 'CL', 'America/Santiago')`,
      [clinicId, `Clínica ${slug}`, owner],
    );
    await client.query(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role)
       SELECT $1, u, r::public.app_role FROM unnest($2::uuid[], $3::text[]) AS t(u, r)
       ON CONFLICT DO NOTHING`,
      [
        clinicId,
        [owner, reception, assistant, accounting],
        ["owner", "reception", "assistant", "accounting"],
      ],
    );
    await client.query(
      `INSERT INTO public.branches (id, clinic_id, name, timezone) VALUES ($1, $2, 'Matriz', 'America/Santiago')`,
      [branchId, clinicId],
    );
    await client.query(
      `INSERT INTO public.operatories (id, clinic_id, branch_id, name) VALUES ($1, $2, $3, 'Box 1')`,
      [boxId, clinicId, branchId],
    );
    await client.query(
      `INSERT INTO public.professionals (id, clinic_id, branch_id, full_name, color) VALUES ($1, $2, $3, 'Dra. Grupal', '#a06f24')`,
      [profId, clinicId, branchId],
    );
    const t = await client.query<{ id: string }>(
      `INSERT INTO public.appointment_types (clinic_id, name, position) VALUES ($1, 'Evaluación', 99) RETURNING id`,
      [clinicId],
    );
    await client.query(
      `INSERT INTO public.online_booking_settings (clinic_id, enabled, slug, min_notice_hours, bookable_appointment_type_ids)
       VALUES ($1, true, $2, 2, ARRAY[$3]::uuid[])`,
      [clinicId, slug, t.rows[0].id],
    );
    const pacientes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = await client.query<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [clinicId, `Paciente ${i + 1}`, owner],
      );
      pacientes.push(p.rows[0].id);
    }
    return {
      clinicId,
      owner,
      reception,
      assistant,
      accounting,
      branchId,
      profId,
      boxId,
      tipoId: t.rows[0].id,
      slug,
      pacientes,
    };
  }

  /** Inicio a N días (negativo = pasado), a las 15:00 UTC. */
  const enDias = (n: number, hora = 15) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    d.setUTCHours(hora, 0, 0, 0);
    return d.toISOString();
  };

  async function cita(c: Clinica, inicio: string, pacienteIdx = 0, minutos = 60) {
    const fin = new Date(Date.parse(inicio) + minutos * 60_000).toISOString();
    const [r] = await servicio<{ id: string }>(
      `INSERT INTO public.appointments (clinic_id, branch_id, patient_id, professional_id, operatory_id, treatment_label, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 'Charla de higiene', $6, $7, $8) RETURNING id`,
      [c.clinicId, c.branchId, c.pacientes[pacienteIdx], c.profId, c.boxId, inicio, fin, c.owner],
    );
    return r.id;
  }

  async function grupal(c: Clinica, inicio: string, cupo = 3) {
    const id = await cita(c, inicio);
    const r = await como(
      c.reception,
      `INSERT INTO public.appointment_groups (appointment_id, clinic_id, title, capacity) VALUES ($1, $2, 'Charla de higiene', $3)`,
      [id, c.clinicId, cupo],
    );
    expect(r.error).toBe("");
    return id;
  }

  const inscribir = (c: Clinica, userId: string, citaId: string, pacienteIdx: number) =>
    como(
      userId,
      `INSERT INTO public.appointment_group_participants (clinic_id, appointment_id, patient_id) VALUES ($1, $2, $3) RETURNING id`,
      [c.clinicId, citaId, c.pacientes[pacienteIdx]],
    );

  async function participante(citaId: string, patientId: string) {
    const [r] = await servicio<{ id: string; attendance: string; withdrawn_at: string | null }>(
      `SELECT id, attendance, withdrawn_at FROM public.appointment_group_participants WHERE appointment_id = $1 AND patient_id = $2`,
      [citaId, patientId],
    );
    return r;
  }

  beforeAll(async () => {
    client = await conectar();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    a = await sembrarClinica(`grupal-a-${randomUUID().slice(0, 8)}`);
    b = await sembrarClinica(`grupal-b-${randomUUID().slice(0, 8)}`);
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("convertir en grupal inscribe al paciente de la cita como primer participante", async () => {
    const id = await grupal(a, enDias(2));
    const filas = await servicio<{ patient_id: string; attendance: string }>(
      `SELECT patient_id, attendance FROM public.appointment_group_participants WHERE appointment_id = $1`,
      [id],
    );
    expect(filas).toEqual([{ patient_id: a.pacientes[0], attendance: "pendiente" }]);
  });

  it("aislamiento: otra clínica no ve, no convierte ni inscribe; asistente y contabilidad solo ven", async () => {
    const id = await grupal(a, enDias(2));
    const ajenaVe = await como(
      b.owner,
      `SELECT * FROM public.appointment_group_participants WHERE appointment_id = $1`,
      [id],
    );
    expect(ajenaVe.filas).toHaveLength(0);
    const ajenoGrupo = await como(
      b.owner,
      `SELECT * FROM public.appointment_groups WHERE appointment_id = $1`,
      [id],
    );
    expect(ajenoGrupo.filas).toHaveLength(0);

    // Con su propia clínica en la fila: el trigger ve que la cita es de otra.
    const otra = await cita(a, enDias(4));
    const convierte = await como(
      b.owner,
      `INSERT INTO public.appointment_groups (appointment_id, clinic_id, title, capacity) VALUES ($1, $2, 'X', 3)`,
      [otra, b.clinicId],
    );
    expect(convierte.error).not.toBe("");

    const ajenoInscribe = await como(
      b.owner,
      `INSERT INTO public.appointment_group_participants (clinic_id, appointment_id, patient_id) VALUES ($1, $2, $3)`,
      [b.clinicId, id, b.pacientes[0]],
    );
    expect(ajenoInscribe.error).not.toBe("");
    // Paciente de otra clínica en un grupo propio.
    const pacienteAjeno = await como(
      a.reception,
      `INSERT INTO public.appointment_group_participants (clinic_id, appointment_id, patient_id) VALUES ($1, $2, $3)`,
      [a.clinicId, id, b.pacientes[0]],
    );
    expect(pacienteAjeno.error).toMatch(/no es de esta clínica/);

    const asistenteVe = await como(
      a.assistant,
      `SELECT * FROM public.appointment_group_participants WHERE appointment_id = $1`,
      [id],
    );
    expect(asistenteVe.filas).toHaveLength(1);
    expect((await inscribir(a, a.assistant, id, 1)).error).toMatch(/row-level security/);
    expect((await inscribir(a, a.accounting, id, 1)).error).toMatch(/row-level security/);
    expect((await inscribir(a, a.reception, id, 1)).error).toBe("");
  });

  it("EQU-01: a quien se le quitó agendar no inscribe", async () => {
    const id = await grupal(a, enDias(2));
    await servicio(
      `INSERT INTO public.clinic_member_permission_overrides (clinic_id, member_id, permission, effect)
       SELECT $1, m.id, 'agenda:manage', 'revoke' FROM public.clinic_members m
        WHERE m.clinic_id = $1 AND m.user_id = $2`,
      [a.clinicId, a.reception],
    );
    expect((await inscribir(a, a.reception, id, 1)).error).toMatch(/row-level security/);
  });

  it("cupo: llena, no inscribe ni reincorpora; el cupo no baja de los inscritos", async () => {
    const id = await grupal(a, enDias(2), 3);
    expect((await inscribir(a, a.reception, id, 1)).error).toBe("");
    expect((await inscribir(a, a.reception, id, 2)).error).toBe("");
    const llena = await inscribir(a, a.reception, id, 3);
    expect(llena.error).toMatch(/está llena: tiene 3 de 3/);

    const baja = await como(
      a.reception,
      `UPDATE public.appointment_groups SET capacity = 2 WHERE appointment_id = $1`,
      [id],
    );
    expect(baja.error).toMatch(/por debajo de los 3/);

    // Retiro libera un cupo; entra el cuarto; el retirado ya no puede volver.
    const p2 = await participante(id, a.pacientes[1]);
    const retiro = await como(
      a.reception,
      `UPDATE public.appointment_group_participants SET withdrawn_at = now(), withdraw_reason = 'Se cambió de curso' WHERE id = $1`,
      [p2.id],
    );
    expect(retiro.error).toBe("");
    expect((await inscribir(a, a.reception, id, 3)).error).toBe("");
    const vuelve = await como(
      a.reception,
      `UPDATE public.appointment_group_participants SET withdrawn_at = null WHERE id = $1`,
      [p2.id],
    );
    expect(vuelve.error).toMatch(/está llena/);

    // Subir el cupo sí deja volver.
    await como(
      a.reception,
      `UPDATE public.appointment_groups SET capacity = 4 WHERE appointment_id = $1`,
      [id],
    );
    const ahora = await como(
      a.reception,
      `UPDATE public.appointment_group_participants SET withdrawn_at = null WHERE id = $1`,
      [p2.id],
    );
    expect(ahora.error).toBe("");
  });

  it("no inscribe en una cita cancelada y no vacía la cita retirando al último", async () => {
    const id = await grupal(a, enDias(2), 3);
    const unico = await participante(id, a.pacientes[0]);
    const vacia = await como(
      a.reception,
      `UPDATE public.appointment_group_participants SET withdrawn_at = now() WHERE id = $1`,
      [unico.id],
    );
    expect(vacia.error).toMatch(/al menos un paciente/);

    await servicio(`UPDATE public.appointments SET status = 'cancelada' WHERE id = $1`, [id]);
    expect((await inscribir(a, a.reception, id, 1)).error).toMatch(/cancelada/);
  });

  it("asistencia individual: desde que empieza la cita, cada uno la suya; la cita entera no se marca ausente", async () => {
    const futura = await grupal(a, enDias(2), 4);
    expect((await inscribir(a, a.reception, futura, 1)).error).toBe("");
    const pf = await participante(futura, a.pacientes[1]);
    const antes = await como(
      a.reception,
      `UPDATE public.appointment_group_participants SET attendance = 'asistio' WHERE id = $1`,
      [pf.id],
    );
    expect(antes.error).toMatch(/desde que empieza/);

    const pasada = await grupal(a, enDias(-1), 4);
    expect((await inscribir(a, a.reception, pasada, 1)).error).toBe("");
    expect((await inscribir(a, a.reception, pasada, 2)).error).toBe("");
    const p0 = await participante(pasada, a.pacientes[0]);
    const p1 = await participante(pasada, a.pacientes[1]);
    await como(
      a.reception,
      `UPDATE public.appointment_group_participants SET attendance = 'asistio' WHERE id = $1`,
      [p0.id],
    );
    await como(
      a.reception,
      `UPDATE public.appointment_group_participants SET attendance = 'ausente' WHERE id = $1`,
      [p1.id],
    );
    const filas = await servicio<{ patient_id: string; attendance: string; marcada: boolean }>(
      `SELECT patient_id, attendance, attendance_marked_at IS NOT NULL AS marcada
         FROM public.appointment_group_participants WHERE appointment_id = $1 ORDER BY enrolled_at, id`,
      [pasada],
    );
    expect(filas.map((f) => [f.patient_id, f.attendance, f.marcada])).toEqual([
      [a.pacientes[0], "asistio", true],
      [a.pacientes[1], "ausente", true],
      [a.pacientes[2], "pendiente", false],
    ]);

    // Retirar a quien asistió vuelve su asistencia a pendiente; retirado no marca.
    await como(
      a.reception,
      `UPDATE public.appointment_group_participants SET withdrawn_at = now() WHERE id = $1`,
      [p0.id],
    );
    expect((await participante(pasada, a.pacientes[0])).attendance).toBe("pendiente");
    const marcaRetirado = await como(
      a.reception,
      `UPDATE public.appointment_group_participants SET attendance = 'asistio' WHERE id = $1`,
      [p0.id],
    );
    expect(marcaRetirado.error).toMatch(/retirado/);

    const ausenteEntera = await como(
      a.reception,
      `UPDATE public.appointments SET status = 'ausente' WHERE id = $1`,
      [pasada],
    );
    expect(ausenteEntera.error).toMatch(/por paciente/);
    // Una cita individual sí se sigue marcando ausente.
    const individual = await cita(a, enDias(-2));
    const indiv = await como(
      a.reception,
      `UPDATE public.appointments SET status = 'ausente' WHERE id = $1`,
      [individual],
    );
    expect(indiv.error).toBe("");
  });

  it("el titular de la cita sigue al primer inscrito vigente", async () => {
    const id = await grupal(a, enDias(2), 4);
    expect((await inscribir(a, a.reception, id, 1)).error).toBe("");
    const p0 = await participante(id, a.pacientes[0]);
    await como(
      a.reception,
      `UPDATE public.appointment_group_participants SET withdrawn_at = now() WHERE id = $1`,
      [p0.id],
    );
    const [c] = await servicio<{ patient_id: string }>(
      `SELECT patient_id FROM public.appointments WHERE id = $1`,
      [id],
    );
    expect(c.patient_id).toBe(a.pacientes[1]);
  });

  it("contadores de la ficha: cada participante cuenta su asistencia, sin duplicar la cita del titular", async () => {
    const pasada = await grupal(a, enDias(-1), 4);
    expect((await inscribir(a, a.reception, pasada, 1)).error).toBe("");
    const p0 = await participante(pasada, a.pacientes[0]);
    const p1 = await participante(pasada, a.pacientes[1]);
    await como(
      a.reception,
      `UPDATE public.appointment_group_participants SET attendance = 'asistio' WHERE id = $1`,
      [p0.id],
    );
    await como(
      a.reception,
      `UPDATE public.appointment_group_participants SET attendance = 'ausente' WHERE id = $1`,
      [p1.id],
    );
    const futura = await grupal(a, enDias(3), 4);
    expect((await inscribir(a, a.reception, futura, 1)).error).toBe("");

    type Fila = { attended: number; no_show: number; upcoming: number };
    const contar = async (idx: number) =>
      (
        await como<Fila>(
          a.reception,
          `SELECT attended, no_show, upcoming FROM public.patient_appointment_counters($1, $2)`,
          [a.clinicId, a.pacientes[idx]],
        )
      ).filas[0];
    expect(await contar(0)).toEqual({ attended: 1, no_show: 0, upcoming: 1 });
    expect(await contar(1)).toEqual({ attended: 0, no_show: 1, upcoming: 1 });
    expect(await contar(2)).toEqual({ attended: 0, no_show: 0, upcoming: 0 });
    // Otra clínica no cuenta nada (RLS de quien llama).
    const ajena = await como<Fila>(
      b.owner,
      `SELECT attended, no_show, upcoming FROM public.patient_appointment_counters($1, $2)`,
      [a.clinicId, a.pacientes[0]],
    );
    expect(ajena.filas[0]).toEqual({ attended: 0, no_show: 0, upcoming: 0 });
  });

  it("la reserva en línea ve la cita grupal como horario ocupado y sigue reservando en otro", async () => {
    const inicio = enDias(3);
    await grupal(a, inicio, 5);

    async function reservar(starts_at: string, email: string) {
      const req = sha(randomUUID());
      const codigo = "123456";
      const [p] = await servicio<{ r: Record<string, unknown> }>(
        `SELECT public.reserva_en_linea_preparar_codigo($1, $2, $3, $4, $5, $6) AS r`,
        [
          a.clinicId,
          req,
          sha(`${req}:${codigo}`),
          sha(`${a.clinicId}:${email}`),
          sha(`${a.clinicId}:+569${email.length}2345678`),
          "198.51.100.20",
        ],
      );
      expect(p.r.ok).toBe(true);
      const [c] = await servicio<{ r: Record<string, unknown> }>(
        `SELECT public.reserva_en_linea_confirmar($1, $2, $3, $4::jsonb) AS r`,
        [
          p.r.id,
          req,
          sha(`${req}:${codigo}`),
          JSON.stringify({
            branch_id: a.branchId,
            professional_id: a.profId,
            appointment_type_id: a.tipoId,
            procedure_id: null,
            operatory_id: a.boxId,
            starts_at,
            nombre: "Paciente Reserva",
            email,
            telefono: `+569${email.length}2345678`,
            rut: null,
            nota: null,
          }),
        ],
      );
      return c.r;
    }

    const choque = await reservar(inicio, "choque@example.com");
    expect(choque.motivo).toBe("ocupado");
    const otra = await reservar(enDias(3, 18), "libre@example.com");
    expect(otra.ok).toBe(true);
  });
});
