import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, esperaFallo, sembrarEscenario } from "./helpers/db";

/**
 * Ola 2 · frente Disponibilidad (migraciones 20261023100000, 20261023100100
 * y 20261023100200):
 *
 * - `agenda_exceptions`, `clinic_agenda_settings` y `branch_hours`: RLS
 *   activa; leen los miembros, escriben owner y admin, y nadie ve ni toca lo
 *   de otra clínica (cross-tenant).
 * - Los CHECK de los bloqueos (motivo, profesional de una apertura, rango,
 *   repetición de un solo día).
 * - Profesional, sucursal y box de otra clínica no se pueden colgar de un
 *   bloqueo, de un horario de sucursal ni del horario de un profesional.
 *
 * La conexión de los tests es `postgres` (salta la RLS): para probarla de
 * verdad se asume el rol `authenticated` con la identidad de cada persona.
 */

describe("disponibilidad de la agenda: tablas, RLS y triggers", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let otra: { clinicId: string; owner: string; branchId: string; profesionalId: string };
  let branchId: string;
  let profesionalId: string;

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
      return { filas: [], error: (e as Error).message };
    }
  }

  async function sucursalYProfesional(clinica: string) {
    const b = await client.query<{ id: string }>(
      `INSERT INTO public.branches (clinic_id, name) VALUES ($1, 'Sede') RETURNING id`,
      [clinica],
    );
    const p = await client.query<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Prueba') RETURNING id`,
      [clinica],
    );
    return { branchId: b.rows[0].id, profesionalId: p.rows[0].id };
  }

  const BLOQUEO = `INSERT INTO public.agenda_exceptions
      (clinic_id, kind, reason, professional_id, branch_id, operatory_id, starts_local, ends_local, repeat_weekly, repeat_until)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`;

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
    ({ branchId, profesionalId } = await sucursalYProfesional(clinicId));
    const otraId = randomUUID();
    const otroOwner = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraId, otroOwner],
    );
    otra = { clinicId: otraId, owner: otroOwner, ...(await sucursalYProfesional(otraId)) };
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("las tres tablas tienen RLS activa", async () => {
    const r = await client.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE oid IN ('public.agenda_exceptions'::regclass, 'public.clinic_agenda_settings'::regclass,
                      'public.branch_hours'::regclass)`,
    );
    expect(r.rows).toHaveLength(3);
    for (const fila of r.rows) expect(fila.relrowsecurity, fila.relname).toBe(true);
  });

  it("bloqueos: owner y admin escriben; dentista y recepción solo leen", async () => {
    for (const rol of ["owner", "admin"]) {
      const r = await como(usuarios[rol], BLOQUEO, [
        clinicId,
        "bloqueo",
        "almuerzo",
        profesionalId,
        null,
        null,
        "2026-10-26 13:00",
        "2026-10-26 14:00",
        true,
        null,
      ]);
      expect(r.error, rol).toBe("");
    }
    for (const rol of ["dentist", "reception", "assistant", "accounting"]) {
      const r = await como(usuarios[rol], BLOQUEO, [
        clinicId,
        "bloqueo",
        "almuerzo",
        profesionalId,
        null,
        null,
        "2026-10-26 13:00",
        "2026-10-26 14:00",
        false,
        null,
      ]);
      expect(r.error, rol).toMatch(/row-level security/);
      const lectura = await como<{ n: string }>(
        usuarios[rol],
        `SELECT count(*) AS n FROM public.agenda_exceptions WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(Number(lectura.filas[0].n), rol).toBe(2);
    }
  });

  it("nadie ve ni borra los bloqueos de otra clínica", async () => {
    await client.query(BLOQUEO, [
      otra.clinicId,
      "bloqueo",
      "vacaciones",
      otra.profesionalId,
      null,
      null,
      "2026-10-26 00:00",
      "2026-10-28 00:00",
      false,
      null,
    ]);
    const lectura = await como<{ n: string }>(
      usuarios.owner,
      `SELECT count(*) AS n FROM public.agenda_exceptions WHERE clinic_id = $1`,
      [otra.clinicId],
    );
    expect(Number(lectura.filas[0].n)).toBe(0);
    const borrado = await como<{ id: string }>(
      usuarios.owner,
      `DELETE FROM public.agenda_exceptions WHERE clinic_id = $1 RETURNING id`,
      [otra.clinicId],
    );
    expect(borrado.filas).toHaveLength(0);
  });

  it("un profesional, sucursal o box de otra clínica no se cuelga de un bloqueo", async () => {
    const conProfesionalAjeno = await esperaFallo(client, () =>
      client.query(BLOQUEO, [
        clinicId,
        "bloqueo",
        "otro",
        otra.profesionalId,
        null,
        null,
        "2026-10-26 13:00",
        "2026-10-26 14:00",
        false,
        null,
      ]),
    );
    expect(conProfesionalAjeno.message).toMatch(/profesional no es de esta clínica/);
    const conSucursalAjena = await esperaFallo(client, () =>
      client.query(BLOQUEO, [
        clinicId,
        "bloqueo",
        "otro",
        null,
        otra.branchId,
        null,
        "2026-10-26 13:00",
        "2026-10-26 14:00",
        false,
        null,
      ]),
    );
    expect(conSucursalAjena.message).toMatch(/sucursal no es de esta clínica/);
    const box = await client.query<{ id: string }>(
      `INSERT INTO public.operatories (clinic_id, branch_id, name) VALUES ($1, $2, 'Box 1') RETURNING id`,
      [otra.clinicId, otra.branchId],
    );
    const conBoxAjeno = await esperaFallo(client, () =>
      client.query(BLOQUEO, [
        clinicId,
        "bloqueo",
        "otro",
        null,
        null,
        box.rows[0].id,
        "2026-10-26 13:00",
        "2026-10-26 14:00",
        false,
        null,
      ]),
    );
    expect(conBoxAjeno.message).toMatch(/box no es de esta clínica/);
  });

  it("el box completa la sucursal del bloqueo", async () => {
    const box = await client.query<{ id: string }>(
      `INSERT INTO public.operatories (clinic_id, branch_id, name) VALUES ($1, $2, 'Box 1') RETURNING id`,
      [clinicId, branchId],
    );
    const r = await client.query<{ id: string }>(BLOQUEO, [
      clinicId,
      "bloqueo",
      "capacitacion",
      null,
      null,
      box.rows[0].id,
      "2026-10-26 13:00",
      "2026-10-26 14:00",
      false,
      null,
    ]);
    const fila = await client.query<{ branch_id: string }>(
      `SELECT branch_id FROM public.agenda_exceptions WHERE id = $1`,
      [r.rows[0].id],
    );
    expect(fila.rows[0].branch_id).toBe(branchId);
  });

  it("los CHECK: motivo del bloqueo, profesional de la apertura, rango y repetición", async () => {
    const casos: unknown[][] = [
      // Bloqueo sin motivo.
      [
        clinicId,
        "bloqueo",
        null,
        profesionalId,
        null,
        null,
        "2026-10-26 13:00",
        "2026-10-26 14:00",
        false,
        null,
      ],
      // Apertura sin profesional.
      [
        clinicId,
        "apertura",
        null,
        null,
        null,
        null,
        "2026-10-31 09:00",
        "2026-10-31 13:00",
        false,
        null,
      ],
      // Termina antes de empezar.
      [
        clinicId,
        "bloqueo",
        "otro",
        profesionalId,
        null,
        null,
        "2026-10-26 14:00",
        "2026-10-26 13:00",
        false,
        null,
      ],
      // Se repite y cruza de día.
      [
        clinicId,
        "bloqueo",
        "otro",
        profesionalId,
        null,
        null,
        "2026-10-26 22:00",
        "2026-10-27 02:00",
        true,
        null,
      ],
      // Fin de repetición sin repetición.
      [
        clinicId,
        "bloqueo",
        "otro",
        profesionalId,
        null,
        null,
        "2026-10-26 13:00",
        "2026-10-26 14:00",
        false,
        "2026-12-01",
      ],
      // Más de 120 días.
      [
        clinicId,
        "bloqueo",
        "vacaciones",
        profesionalId,
        null,
        null,
        "2026-10-26 00:00",
        "2027-06-01 00:00",
        false,
        null,
      ],
    ];
    for (const params of casos) {
      const r = await esperaFallo(client, () => client.query(BLOQUEO, params));
      expect(r.code, JSON.stringify(params)).toBe("23514");
    }
    // Repetir hasta la medianoche sí se puede (tramo que termina a las 24:00).
    await client.query(BLOQUEO, [
      clinicId,
      "bloqueo",
      "otro",
      profesionalId,
      null,
      null,
      "2026-10-26 20:00",
      "2026-10-27 00:00",
      true,
      "2026-12-31",
    ]);
  });

  it("configuración de la agenda: una fila por clínica, valores acotados, solo owner/admin", async () => {
    const insertar = `INSERT INTO public.clinic_agenda_settings (clinic_id, slot_minutes, default_duration_min, allow_overbooking)
      VALUES ($1, $2, $3, $4)`;
    expect((await como(usuarios.reception, insertar, [clinicId, 15, 30, false])).error).toMatch(
      /row-level security/,
    );
    expect((await como(usuarios.admin, insertar, [clinicId, 20, 45, false])).error).toBe("");
    const intervaloRaro = await esperaFallo(client, () =>
      client.query(
        `UPDATE public.clinic_agenda_settings SET slot_minutes = 25 WHERE clinic_id = $1`,
        [clinicId],
      ),
    );
    expect(intervaloRaro.code).toBe("23514");
    const lectura = await como<{ slot_minutes: number }>(
      usuarios.dentist,
      `SELECT slot_minutes FROM public.clinic_agenda_settings WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(lectura.filas[0].slot_minutes).toBe(20);
    const ajena = await como(usuarios.owner, insertar, [otra.clinicId, 15, 30, true]);
    expect(ajena.error).toMatch(/row-level security/);
  });

  it("horario de sucursal: la sucursal tiene que ser de la clínica", async () => {
    const insertar = `INSERT INTO public.branch_hours (clinic_id, branch_id, day_of_week, opens_at, closes_at)
      VALUES ($1, $2, $3, $4, $5)`;
    expect(
      (await como(usuarios.owner, insertar, [clinicId, branchId, 1, "09:00", "19:00"])).error,
    ).toBe("");
    expect(
      (await como(usuarios.reception, insertar, [clinicId, branchId, 2, "09:00", "19:00"])).error,
    ).toMatch(/row-level security/);
    const ajena = await esperaFallo(client, () =>
      client.query(insertar, [clinicId, otra.branchId, 1, "09:00", "19:00"]),
    );
    expect(ajena.message).toMatch(/sucursal no es de esta clínica/);
    const alReves = await esperaFallo(client, () =>
      client.query(insertar, [clinicId, branchId, 3, "19:00", "09:00"]),
    );
    expect(alReves.code).toBe("23514");
  });

  it("horario del profesional por sucursal (AGE-23): NULL sigue valiendo y la sucursal es de la clínica", async () => {
    const insertar = `INSERT INTO public.professional_schedules
      (clinic_id, professional_id, day_of_week, start_time, end_time, branch_id) VALUES ($1, $2, $3, $4, $5, $6)`;
    await client.query(insertar, [clinicId, profesionalId, 1, "09:00", "13:00", null]);
    await client.query(insertar, [clinicId, profesionalId, 2, "09:00", "13:00", branchId]);
    const ajena = await esperaFallo(client, () =>
      client.query(insertar, [clinicId, profesionalId, 3, "09:00", "13:00", otra.branchId]),
    );
    expect(ajena.message).toMatch(/sucursal no es de esta clínica/);
  });
});
