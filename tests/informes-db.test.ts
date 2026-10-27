import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 11 · frente A (migraciones 20261107100000 y 20261107100100), contra la
 * base efímera de tests:
 *
 * - Aislamiento entre clínicas: las lecturas de informes (SECURITY INVOKER)
 *   no cuentan filas de otra clínica, ni aunque se pida su id.
 * - Sin finanzas no hay dinero: las métricas en cents fallan con 42501 para
 *   dentist, assistant y reception; "pagados" del embudo es NULL.
 * - Zona horaria: una cita a las 23:30 de Santiago cae en su día civil, no
 *   en el siguiente día UTC.
 * - Mapa de calor, uso por box y embudo con datos conocidos.
 * - Informes guardados: cada uno ve los suyos y los compartidos; solo quien
 *   lo creó lo cambia; aislamiento entre clínicas.
 */

describe("Ola 11 · informes (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let otraClinica: string;
  let usuarios: Record<string, string>;
  let otroOwner: string;
  let sucursal: string;
  let box: string;
  let profesional: string;
  let pacientes: string[];

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
      return { filas: [], error: (e as Error).message };
    }
  }

  async function servicio<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const r = await client.query(sql, params);
    return r.rows as T[];
  }

  async function cita(
    clinica: string,
    rama: string,
    paciente: string,
    pro: string,
    inicio: string,
    minutos: number,
    estado = "finalizada",
    operatoria: string | null = null,
    origen: string | null = null,
  ) {
    const r = await servicio<{ id: string }>(
      `INSERT INTO public.appointments
         (clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at,
          treatment_label, created_by, status, operatory_id, booking_source)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + make_interval(mins => $6),
               'Control', $7, $8::public.appointment_status, $9, $10)
       RETURNING id`,
      [clinica, rama, paciente, pro, inicio, minutos, usuarios.owner, estado, operatoria, origen],
    );
    return r[0].id;
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
    await servicio(
      `UPDATE public.clinics SET timezone = 'America/Santiago', currency = 'CLP' WHERE id = $1`,
      [clinicId],
    );
    sucursal = (
      await servicio<{ id: string }>(
        `INSERT INTO public.branches (clinic_id, name) VALUES ($1, 'Centro') RETURNING id`,
        [clinicId],
      )
    )[0].id;
    box = (
      await servicio<{ id: string }>(
        `INSERT INTO public.operatories (clinic_id, branch_id, name) VALUES ($1, $2, 'Box 1') RETURNING id`,
        [clinicId, sucursal],
      )
    )[0].id;
    profesional = (
      await servicio<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Soto') RETURNING id`,
        [clinicId],
      )
    )[0].id;
    pacientes = [];
    const datos: [string, string | null, string | null, string | null][] = [
      ["Ana Pérez", "1990-05-01", "Providencia", "fonasa"],
      ["Beto Soto", "2015-01-10", "providencia ", "isapre"],
      ["Caro Díaz", null, null, null],
    ];
    for (const [nombre, nacimiento, comuna, prevision] of datos) {
      const p = await servicio<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, birth_date, commune, health_plan, branch_id, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, '2026-10-05 12:00-03', $7) RETURNING id`,
        [clinicId, nombre, nacimiento, comuna, prevision, sucursal, usuarios.owner],
      );
      pacientes.push(p[0].id);
    }

    // Otra clínica con datos propios (no deben aparecer nunca).
    otraClinica = randomUUID();
    otroOwner = randomUUID();
    await servicio(
      `INSERT INTO public.clinics (id, name, created_by, timezone) VALUES ($1, 'Otra', $2, 'America/Santiago')`,
      [otraClinica, otroOwner],
    );
    const ramaOtra = (
      await servicio<{ id: string }>(
        `INSERT INTO public.branches (clinic_id, name) VALUES ($1, 'Ajena') RETURNING id`,
        [otraClinica],
      )
    )[0].id;
    const proOtra = (
      await servicio<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Ajeno') RETURNING id`,
        [otraClinica],
      )
    )[0].id;
    const pacOtra = (
      await servicio<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, created_by, created_at)
         VALUES ($1, 'Ajeno', $2, '2026-10-05 12:00-03') RETURNING id`,
        [otraClinica, otroOwner],
      )
    )[0].id;
    for (let i = 0; i < 3; i++) {
      await servicio(
        `INSERT INTO public.appointments
           (clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at, treatment_label, created_by, status)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '30 min', 'X', $6, 'finalizada')`,
        [otraClinica, ramaOtra, pacOtra, proOtra, `2026-10-1${i} 10:00-03`, otroOwner],
      );
    }
    await servicio(
      `INSERT INTO public.payments (clinic_id, patient_id, amount_cents, paid_at, created_by)
       VALUES ($1, $2, 99999, '2026-10-10 10:00-03', $3)`,
      [otraClinica, pacOtra, otroOwner],
    );

    // Agenda de la clínica: lunes 5 oct 9:00 (60 min) y 10:00 (30), martes 6
    // ausente, una cancelada, y una a las 23:30 del 31 oct (Santiago).
    await cita(
      clinicId,
      sucursal,
      pacientes[0],
      profesional,
      "2026-10-05 09:00-03",
      60,
      "finalizada",
      box,
      "reserva_en_linea",
    );
    await cita(
      clinicId,
      sucursal,
      pacientes[1],
      profesional,
      "2026-10-05 10:00-03",
      30,
      "finalizada",
      box,
    );
    await cita(clinicId, sucursal, pacientes[2], profesional, "2026-10-06 09:00-03", 30, "ausente");
    await cita(
      clinicId,
      sucursal,
      pacientes[2],
      profesional,
      "2026-10-07 09:00-03",
      30,
      "cancelada",
    );
    await cita(
      clinicId,
      sucursal,
      pacientes[1],
      profesional,
      "2026-10-31 23:30-03",
      15,
      "tentativa",
    );
    await servicio(
      `INSERT INTO public.payments (clinic_id, patient_id, amount_cents, paid_at, created_by)
       VALUES ($1, $2, 15000, '2026-10-05 11:00-03', $3)`,
      [clinicId, pacientes[0], usuarios.owner],
    );
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  const METRICA = `SELECT clave, clave2, valor::int, n::int, pacientes::int
                     FROM public.informe_metrica($1, $2, $3, $4, $5, $6)`;

  it("cuenta la agenda por estado y suma minutos", async () => {
    const citas = await como(usuarios.reception, METRICA, [
      clinicId,
      "citas",
      "2026-10-01",
      "2026-10-31",
      "total",
      "total",
    ]);
    expect(citas.error).toBe("");
    expect(citas.filas).toEqual([
      { clave: "total", clave2: "total", valor: 4, n: 4, pacientes: 3 },
    ]);
    const horas = await como<{ valor: number }>(usuarios.reception, METRICA, [
      clinicId,
      "horas_agendadas",
      "2026-10-01",
      "2026-10-31",
      "total",
      "total",
    ]);
    expect(horas.filas[0].valor).toBe(135);
    const estados = await como<{ clave: string; valor: number }>(usuarios.dentist, METRICA, [
      clinicId,
      "citas",
      "2026-10-01",
      "2026-10-31",
      "estado",
      "total",
    ]);
    expect(Object.fromEntries(estados.filas.map((f) => [f.clave, f.valor]))).toEqual({
      finalizada: 2,
      ausente: 1,
      tentativa: 1,
    });
  });

  it("aislamiento: no cuenta filas de otra clínica, ni pidiéndola por id", async () => {
    const ajena = await como(usuarios.owner, METRICA, [
      otraClinica,
      "citas",
      "2026-10-01",
      "2026-10-31",
      "total",
      "total",
    ]);
    expect(ajena.error).toBe("");
    expect(ajena.filas).toEqual([]);
    const ajenaDinero = await como(usuarios.owner, METRICA, [
      otraClinica,
      "cobrado",
      "2026-10-01",
      "2026-10-31",
      "total",
      "total",
    ]);
    expect(ajenaDinero.error).toMatch(/permisos/);
    const detalle = await como(
      usuarios.owner,
      `SELECT * FROM public.informe_detalle($1, 'atenciones', '2026-10-01', '2026-10-31')`,
      [otraClinica],
    );
    expect(detalle.filas).toEqual([]);
    const embudo = await como(
      usuarios.owner,
      `SELECT * FROM public.informe_embudo($1, '2026-10-01', '2026-10-31')`,
      [otraClinica],
    );
    expect(embudo.filas).toEqual([]);
    const calor = await como(
      usuarios.owner,
      `SELECT * FROM public.informe_ocupacion($1, '2026-10-01', '2026-10-31')`,
      [otraClinica],
    );
    expect(calor.filas).toEqual([]);
    const boxes = await como(
      usuarios.owner,
      `SELECT * FROM public.informe_uso_box($1, '2026-10-01', '2026-10-31')`,
      [otraClinica],
    );
    expect(boxes.filas).toEqual([]);
    const cobrado = await como<{ valor: number }>(usuarios.owner, METRICA, [
      clinicId,
      "cobrado",
      "2026-10-01",
      "2026-10-31",
      "total",
      "total",
    ]);
    expect(cobrado.filas).toEqual([
      { clave: "total", clave2: "total", valor: 15000, n: 1, pacientes: 1 },
    ]);
    const externo = await como(usuarios.externo, METRICA, [
      clinicId,
      "citas",
      "2026-10-01",
      "2026-10-31",
      "total",
      "total",
    ]);
    expect(externo.filas).toEqual([]);
  });

  it("sin finanzas no hay dinero: 42501 en métricas en cents y NULL en pagados", async () => {
    for (const rol of ["dentist", "assistant", "reception"]) {
      for (const m of ["produccion", "cobrado", "presupuestado"]) {
        const r = await como(usuarios[rol], METRICA, [
          clinicId,
          m,
          "2026-10-01",
          "2026-10-31",
          "total",
          "total",
        ]);
        expect(r.error, `${rol} ${m}`).toMatch(/permisos para ver montos/);
      }
      const d = await como(
        usuarios[rol],
        `SELECT * FROM public.informe_detalle($1, 'cobrado', '2026-10-01', '2026-10-31')`,
        [clinicId],
      );
      expect(d.error).toMatch(/permisos/);
      const e = await como<{ pagados: number | null }>(
        usuarios[rol],
        `SELECT * FROM public.informe_embudo($1, '2026-10-01', '2026-10-31')`,
        [clinicId],
      );
      expect(e.error).toBe("");
      expect(e.filas.every((f) => f.pagados === null)).toBe(true);
    }
    for (const rol of ["owner", "admin", "accounting"]) {
      const r = await como(usuarios[rol], METRICA, [
        clinicId,
        "cobrado",
        "2026-10-01",
        "2026-10-31",
        "total",
        "total",
      ]);
      expect(r.error, rol).toBe("");
    }
    const e = await como<{ canal: string; pagados: number }>(
      usuarios.owner,
      `SELECT canal, pagados::int FROM public.informe_embudo($1, '2026-10-01', '2026-10-31')`,
      [clinicId],
    );
    expect(e.filas.find((f) => f.canal === "reserva_en_linea")?.pagados).toBe(1);
  });

  it("zona horaria: la cita de las 23:30 de Santiago cuenta el 31, no el 1 de noviembre", async () => {
    const dias = await como<{ clave: string }>(usuarios.owner, METRICA, [
      clinicId,
      "citas",
      "2026-10-31",
      "2026-11-01",
      "dia",
      "total",
    ]);
    expect(dias.filas.map((f) => f.clave)).toEqual(["2026-10-31"]);
    const noviembre = await como(usuarios.owner, METRICA, [
      clinicId,
      "citas",
      "2026-11-01",
      "2026-11-30",
      "total",
      "total",
    ]);
    expect(noviembre.filas).toEqual([]);
    const hora = await como<{ clave: string }>(usuarios.owner, METRICA, [
      clinicId,
      "citas",
      "2026-10-31",
      "2026-10-31",
      "hora",
      "total",
    ]);
    expect(hora.filas.map((f) => f.clave)).toEqual(["23"]);
  });

  it("cortes demográficos con 'sin dato' explícito", async () => {
    const edad = await como<{ clave: string | null; valor: number }>(usuarios.reception, METRICA, [
      clinicId,
      "pacientes_nuevos",
      "2026-10-01",
      "2026-10-31",
      "edad",
      "total",
    ]);
    expect(Object.fromEntries(edad.filas.map((f) => [f.clave ?? "null", f.valor]))).toEqual({
      "30-44": 1,
      "0-11": 1,
      null: 1,
    });
    const comuna = await como<{ clave: string | null; valor: number }>(
      usuarios.reception,
      METRICA,
      [clinicId, "pacientes_nuevos", "2026-10-01", "2026-10-31", "comuna", "total"],
    );
    expect(Object.fromEntries(comuna.filas.map((f) => [f.clave ?? "null", f.valor]))).toEqual({
      Providencia: 2,
      null: 1,
    });
  });

  it("valida métrica, corte y período (lista cerrada)", async () => {
    const r1 = await como(usuarios.owner, METRICA, [
      clinicId,
      "citas; drop table x",
      "2026-10-01",
      "2026-10-31",
      "total",
      "total",
    ]);
    expect(r1.error).toMatch(/Métrica desconocida/);
    const r2 = await como(usuarios.owner, METRICA, [
      clinicId,
      "produccion",
      "2026-10-01",
      "2026-10-31",
      "hora",
      "total",
    ]);
    expect(r2.error).toMatch(/no aplica/);
    const r3 = await como(usuarios.owner, METRICA, [
      clinicId,
      "citas",
      "2026-10-31",
      "2026-10-01",
      "total",
      "total",
    ]);
    expect(r3.error).toMatch(/período/);
  });

  it("detalle: los registros de una celda, con el total", async () => {
    const d = await como<{ patient_id: string; total: number }>(
      usuarios.dentist,
      `SELECT patient_id, total::int FROM public.informe_detalle($1, 'atenciones', '2026-10-01', '2026-10-31', 'dia_semana', '1')`,
      [clinicId],
    );
    expect(d.error).toBe("");
    expect(d.filas).toHaveLength(2);
    expect(d.filas[0].total).toBe(2);
    const sinBox = await como(
      usuarios.dentist,
      `SELECT * FROM public.informe_detalle($1, 'citas', '2026-10-01', '2026-10-31', 'box', NULL)`,
      [clinicId],
    );
    expect(sinBox.filas).toHaveLength(2);
  });

  it("mapa de calor: minutos por franja y horario declarado", async () => {
    await servicio(
      `INSERT INTO public.professional_schedules (clinic_id, professional_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, 1, '09:00', '11:00')`,
      [clinicId, profesional],
    );
    const r = await como<{
      dia_semana: number;
      hora: number;
      minutos_ocupados: number;
      minutos_disponibles: number;
      citas: number;
    }>(
      usuarios.assistant,
      `SELECT dia_semana, hora, citas::int, minutos_ocupados::int, minutos_disponibles::int
         FROM public.informe_ocupacion($1, '2026-10-05', '2026-10-05')
        ORDER BY dia_semana, hora`,
      [clinicId],
    );
    expect(r.error).toBe("");
    expect(r.filas).toEqual([
      { dia_semana: 1, hora: 9, citas: 1, minutos_ocupados: 60, minutos_disponibles: 60 },
      { dia_semana: 1, hora: 10, citas: 1, minutos_ocupados: 30, minutos_disponibles: 60 },
    ]);
  });

  it("uso por box: tiempo del box y apertura de su sucursal", async () => {
    await servicio(
      `INSERT INTO public.branch_hours (clinic_id, branch_id, day_of_week, opens_at, closes_at)
       VALUES ($1, $2, 1, '09:00', '13:00')`,
      [clinicId, sucursal],
    );
    const r = await como<{
      operatory_id: string | null;
      citas: number;
      minutos_ocupados: number;
      minutos_abiertos: number | null;
    }>(
      usuarios.reception,
      `SELECT operatory_id, citas::int, minutos_ocupados::int, minutos_abiertos::int
         FROM public.informe_uso_box($1, '2026-10-05', '2026-10-11')`,
      [clinicId],
    );
    expect(r.error).toBe("");
    const delBox = r.filas.find((f) => f.operatory_id === box);
    expect(delBox).toEqual({
      operatory_id: box,
      citas: 2,
      minutos_ocupados: 90,
      minutos_abiertos: 240,
    });
    const sinBox = r.filas.find((f) => f.operatory_id === null);
    expect(sinBox?.citas).toBe(1); // la ausente; la cancelada no cuenta
    expect(sinBox?.minutos_abiertos).toBeNull();
  });

  it("embudo: fichas nuevas por canal y pasos", async () => {
    const r = await como<{ canal: string; contactos: number; con_cita: number; atendidos: number }>(
      usuarios.dentist,
      `SELECT canal, contactos::int, con_cita::int, atendidos::int FROM public.informe_embudo($1, '2026-10-01', '2026-10-31')`,
      [clinicId],
    );
    expect(r.error).toBe("");
    const porCanal = Object.fromEntries(r.filas.map((f) => [f.canal, f]));
    expect(porCanal.reserva_en_linea).toMatchObject({ contactos: 1, con_cita: 1, atendidos: 1 });
    expect(porCanal.otros).toMatchObject({ contactos: 2, con_cita: 2, atendidos: 1 });
  });

  describe("informes guardados", () => {
    const CONFIG = JSON.stringify({ metrica: "citas", corte: "dia", periodo: "mes" });

    async function guardar(userId: string, clinica: string, compartido: boolean) {
      return como<{ id: string }>(
        userId,
        `INSERT INTO public.saved_reports (clinic_id, name, config, shared, created_by)
         VALUES ($1, 'Mi informe', $2::jsonb, $3, $4) RETURNING id`,
        [clinica, CONFIG, compartido, userId],
      );
    }

    it("cada uno ve los suyos y los compartidos; solo quien lo creó lo cambia", async () => {
      const privado = await guardar(usuarios.dentist, clinicId, false);
      const compartido = await guardar(usuarios.reception, clinicId, true);
      expect(privado.error).toBe("");
      expect(compartido.error).toBe("");
      const verAsistente = await como<{ id: string }>(
        usuarios.assistant,
        `SELECT id FROM public.saved_reports WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(verAsistente.filas.map((f) => f.id)).toEqual([compartido.filas[0].id]);
      const verDentista = await como(
        usuarios.dentist,
        `SELECT id FROM public.saved_reports WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(verDentista.filas).toHaveLength(2);
      const editarAjeno = await como(
        usuarios.dentist,
        `UPDATE public.saved_reports SET name = 'x' WHERE id = $1 RETURNING id`,
        [compartido.filas[0].id],
      );
      expect(editarAjeno.filas).toEqual([]);
      const borrarAjeno = await como(
        usuarios.assistant,
        `DELETE FROM public.saved_reports WHERE id = $1 RETURNING id`,
        [compartido.filas[0].id],
      );
      expect(borrarAjeno.filas).toEqual([]);
      const borrarAdmin = await como(
        usuarios.admin,
        `DELETE FROM public.saved_reports WHERE id = $1 RETURNING id`,
        [compartido.filas[0].id],
      );
      expect(borrarAdmin.filas).toHaveLength(1);
    });

    it("no se puede guardar a nombre de otro ni en otra clínica, ni verlos desde afuera", async () => {
      const aNombreDeOtro = await como(
        usuarios.dentist,
        `INSERT INTO public.saved_reports (clinic_id, name, config, created_by) VALUES ($1, 'x', $2::jsonb, $3)`,
        [clinicId, CONFIG, usuarios.owner],
      );
      expect(aNombreDeOtro.error).toMatch(/row-level security/);
      const enOtra = await guardar(usuarios.owner, otraClinica, true);
      expect(enOtra.error).toMatch(/row-level security/);
      await servicio(
        `INSERT INTO public.saved_reports (clinic_id, name, config, shared, created_by) VALUES ($1, 'Ajeno', $2::jsonb, true, $3)`,
        [otraClinica, CONFIG, otroOwner],
      );
      const ver = await como(
        usuarios.owner,
        `SELECT id FROM public.saved_reports WHERE clinic_id = $1`,
        [otraClinica],
      );
      expect(ver.filas).toEqual([]);
    });

    it("la configuración tiene que ser un objeto chico", async () => {
      const r = await como(
        usuarios.owner,
        `INSERT INTO public.saved_reports (clinic_id, name, config, created_by) VALUES ($1, 'x', '[1,2]'::jsonb, $2)`,
        [clinicId, usuarios.owner],
      );
      expect(r.error).toMatch(/check/i);
    });
  });
});
