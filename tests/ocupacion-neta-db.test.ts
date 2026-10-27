import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar } from "./helpers/db";

/**
 * Cierre · Bloque 5 · ítem 8 (migración 20261113200300): el mapa de calor
 * descuenta bloqueos y feriados al calcular la disponibilidad.
 *
 * Escenario: un profesional atiende los lunes de 9:00 a 13:00 (Santiago). El
 * período trae tres lunes (5, 12 y 19 de octubre de 2026), así que sin
 * descuentos cada hora de 9 a 12 tiene 180 minutos de horario.
 */
interface Fila {
  dia_semana: number;
  hora: number;
  citas: string;
  minutos_ocupados: string;
  minutos_disponibles: string;
  minutos_bloqueados: string;
  minutos_feriado: string;
}

describe("ocupación neta de la agenda en la base", () => {
  let client: Client;
  let clinicId: string;
  let owner: string;
  let branchId: string;
  let profId: string;
  let boxId: string;

  async function sql<T = Record<string, unknown>>(texto: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    return (await client.query(texto, params)).rows as T[];
  }

  async function bloqueo(
    desde: string,
    hasta: string,
    extra: Partial<{
      profesional: string | null;
      sucursal: string | null;
      box: string | null;
      semanal: boolean;
      hastaFecha: string | null;
      clinica: string;
    }> = {},
  ) {
    await client.query(
      `INSERT INTO public.agenda_exceptions
         (clinic_id, kind, professional_id, branch_id, operatory_id, reason, starts_local, ends_local, repeat_weekly, repeat_until)
       VALUES ($1, 'bloqueo', $2, $3, $4, 'almuerzo', $5, $6, $7, $8)`,
      [
        extra.clinica ?? clinicId,
        extra.profesional === undefined ? profId : extra.profesional,
        extra.sucursal ?? null,
        extra.box ?? null,
        desde,
        hasta,
        extra.semanal ?? false,
        extra.hastaFecha ?? null,
      ],
    );
  }

  async function neta(feriados: string[] = [], profesional: string | null = null, clinica = clinicId) {
    const filas = await sql<Fila>(
      `SELECT * FROM public.informe_ocupacion_neta($1, '2026-10-05', '2026-10-25', NULL, $2, $3::date[])`,
      [clinica, profesional, feriados],
    );
    const porHora = new Map(
      filas.map((f) => [`${f.dia_semana}-${f.hora}`, {
        ocupados: Number(f.minutos_ocupados),
        disponibles: Number(f.minutos_disponibles),
        bloqueados: Number(f.minutos_bloqueados),
        feriado: Number(f.minutos_feriado),
      }]),
    );
    return (dow: number, hr: number) =>
      porHora.get(`${dow}-${hr}`) ?? { ocupados: 0, disponibles: 0, bloqueados: 0, feriado: 0 };
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
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by, timezone) VALUES ($1, 'Clínica Calor', $2, 'America/Santiago')`,
      [clinicId, owner],
    );
    branchId = (
      await sql<{ id: string }>(
        `INSERT INTO public.branches (clinic_id, name) VALUES ($1, 'Centro') RETURNING id`,
        [clinicId],
      )
    )[0].id;
    boxId = (
      await sql<{ id: string }>(
        `INSERT INTO public.operatories (clinic_id, branch_id, name) VALUES ($1, $2, 'Box 1') RETURNING id`,
        [clinicId, branchId],
      )
    )[0].id;
    profId = (
      await sql<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Calor') RETURNING id`,
        [clinicId],
      )
    )[0].id;
    await client.query(
      `INSERT INTO public.professional_schedules (clinic_id, professional_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, 1, '09:00', '13:00')`,
      [clinicId, profId],
    );
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("sin bloqueos ni feriados da lo mismo que el mapa de antes", async () => {
    const nueva = await neta();
    for (const hr of [9, 10, 11, 12]) {
      expect(nueva(1, hr)).toEqual({ ocupados: 0, disponibles: 180, bloqueados: 0, feriado: 0 });
    }
    expect(nueva(1, 13).disponibles).toBe(0);
    const vieja = await sql<{ hora: number; minutos_disponibles: string }>(
      `SELECT hora, minutos_disponibles FROM public.informe_ocupacion($1, '2026-10-05', '2026-10-25', NULL, NULL)
        WHERE dia_semana = 1 ORDER BY hora`,
      [clinicId],
    );
    expect(vieja.map((f) => Number(f.minutos_disponibles))).toEqual([180, 180, 180, 180]);
  });

  it("descuenta un bloqueo del profesional en el día que toca", async () => {
    await bloqueo("2026-10-12 10:00", "2026-10-12 11:00");
    const n = await neta();
    expect(n(1, 10)).toMatchObject({ disponibles: 120, bloqueados: 60 });
    expect(n(1, 9).disponibles).toBe(180);
  });

  it("descuenta un bloqueo que se repite cada semana (el almuerzo)", async () => {
    await bloqueo("2026-10-05 12:00", "2026-10-05 13:00", { semanal: true });
    const n = await neta();
    expect(n(1, 12)).toMatchObject({ disponibles: 0, bloqueados: 180 });
    // Un bloqueo semanal con fin: solo hasta esa fecha.
    await client.query(`DELETE FROM public.agenda_exceptions WHERE clinic_id = $1`, [clinicId]);
    await bloqueo("2026-10-05 12:00", "2026-10-05 13:00", { semanal: true, hastaFecha: "2026-10-12" });
    expect((await neta())(1, 12)).toMatchObject({ disponibles: 60, bloqueados: 120 });
  });

  it("unas vacaciones de varios días descuentan solo los días que tocan, recortadas a cada día", async () => {
    await bloqueo("2026-10-11 00:00", "2026-10-13 00:00", { profesional: profId });
    const n = await neta();
    for (const hr of [9, 10, 11, 12]) {
      expect(n(1, hr)).toMatchObject({ disponibles: 120, bloqueados: 60 });
    }
  });

  it("el bloqueo de toda la clínica y el de una sucursal le tocan al profesional; el de un box, no", async () => {
    await bloqueo("2026-10-05 11:00", "2026-10-05 12:00", { profesional: null });
    await bloqueo("2026-10-12 09:00", "2026-10-12 10:00", { profesional: null, sucursal: branchId });
    await bloqueo("2026-10-19 09:00", "2026-10-19 10:00", { profesional: null, box: boxId });
    const n = await neta();
    expect(n(1, 11)).toMatchObject({ disponibles: 120, bloqueados: 60 });
    // El bloqueo de sucursal solo descuenta cuando el horario es de esa sucursal o se filtra por ella.
    expect(n(1, 9).bloqueados).toBe(0);
    expect(n(1, 9).disponibles).toBe(180);
  });

  it("descuenta los feriados que manda el servidor, sin contarlos como bloqueo", async () => {
    const n = await neta(["2026-10-19"]);
    for (const hr of [9, 10, 11, 12]) {
      expect(n(1, hr)).toMatchObject({ disponibles: 120, bloqueados: 0, feriado: 60 });
    }
  });

  it("un feriado ya bloqueado no se descuenta dos veces", async () => {
    await bloqueo("2026-10-19 09:00", "2026-10-19 13:00");
    const n = await neta(["2026-10-19"]);
    expect(n(1, 10)).toMatchObject({ disponibles: 120, bloqueados: 0, feriado: 60 });
  });

  it("una apertura excepcional suma disponibilidad, también en un feriado", async () => {
    await client.query(
      `INSERT INTO public.agenda_exceptions (clinic_id, kind, professional_id, starts_local, ends_local)
       VALUES ($1, 'apertura', $2, '2026-10-10 09:00', '2026-10-10 10:00')`,
      [clinicId, profId],
    );
    const n = await neta(["2026-10-10"]);
    expect(n(6, 9).disponibles).toBe(60);
    // Una apertura que cae dentro de su propio horario no se cuenta dos veces.
    await client.query(
      `INSERT INTO public.agenda_exceptions (clinic_id, kind, professional_id, starts_local, ends_local)
       VALUES ($1, 'apertura', $2, '2026-10-05 09:00', '2026-10-05 10:00')`,
      [clinicId, profId],
    );
    expect((await neta())(1, 9).disponibles).toBe(180);
  });

  it("lo agendado dentro de un tramo descontado queda sobre el horario (más de 100 %)", async () => {
    await bloqueo("2026-10-12 10:00", "2026-10-12 11:00");
    const pac = (
      await sql<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Paciente', $2) RETURNING id`,
        [clinicId, owner],
      )
    )[0].id;
    await client.query(
      `INSERT INTO public.appointments (clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, $4, '2026-10-12 10:00-03', '2026-10-12 10:30-03', $5)`,
      [clinicId, branchId, pac, profId, owner],
    );
    const n = await neta();
    expect(n(1, 10)).toMatchObject({ ocupados: 30, disponibles: 120, bloqueados: 60 });
  });

  it("filtra por profesional: el bloqueo de otro no descuenta", async () => {
    const otro = (
      await sql<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dr. Otro') RETURNING id`,
        [clinicId],
      )
    )[0].id;
    await client.query(
      `INSERT INTO public.professional_schedules (clinic_id, professional_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, 1, '09:00', '13:00')`,
      [clinicId, otro],
    );
    await bloqueo("2026-10-12 09:00", "2026-10-12 13:00", { profesional: otro });
    const soloElla = await neta([], profId);
    expect(soloElla(1, 9)).toMatchObject({ disponibles: 180, bloqueados: 0 });
    const ambos = await neta();
    expect(ambos(1, 9)).toMatchObject({ disponibles: 300, bloqueados: 60 });
  });

  it("otra clínica no aporta ni recibe nada, y quien no es miembro ve el mapa vacío (RLS)", async () => {
    const otraClinica = randomUUID();
    const otroOwner = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by, timezone) VALUES ($1, 'Ajena', $2, 'America/Santiago')`,
      [otraClinica, otroOwner],
    );
    const proAjeno = (
      await sql<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Ajeno') RETURNING id`,
        [otraClinica],
      )
    )[0].id;
    await client.query(
      `INSERT INTO public.professional_schedules (clinic_id, professional_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, 1, '09:00', '13:00')`,
      [otraClinica, proAjeno],
    );
    // Un bloqueo de la otra clínica no toca a esta.
    await bloqueo("2026-10-05 09:00", "2026-10-26 00:00", { profesional: null, clinica: otraClinica });
    expect((await neta())(1, 9).disponibles).toBe(180);
    // Con la identidad de la dueña de la otra clínica, esta clínica no devuelve filas.
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: otroOwner, role: "authenticated" }),
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query("SET LOCAL ROLE authenticated");
    const ajena = await client.query(
      `SELECT * FROM public.informe_ocupacion_neta($1, '2026-10-05', '2026-10-25')`,
      [clinicId],
    );
    await client.query("RESET ROLE");
    await client.query("RELEASE SAVEPOINT sp_rls");
    expect(ajena.rows).toHaveLength(0);
  });

  it("rechaza un período inválido", async () => {
    await expect(
      client.query(`SELECT * FROM public.informe_ocupacion_neta($1, '2026-10-25', '2026-10-05')`, [clinicId]),
    ).rejects.toThrow(/período no es válido/);
  });
});
