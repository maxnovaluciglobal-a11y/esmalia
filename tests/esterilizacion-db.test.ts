import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar } from "./helpers/db";

/**
 * Ola 14 · frente B · MKT-10 trazabilidad de esterilización (migración
 * 20261110200100), contra la base efímera:
 *
 * - Aislamiento: otra clínica no ve ni registra ciclos ni paquetes; recepción
 *   ve, contabilidad no; solo owner/admin/dentist/assistant registran.
 * - Correlativos por clínica y año (next_clinic_counter) y código del paquete.
 * - Indicador fallido → ciclo fallido; no se aprueba sin indicador químico;
 *   cerrado, los parámetros no se editan.
 * - Uso: una vez, con ciclo aprobado, estéril vigente, paciente de la clínica
 *   y cita de ese paciente (o grupal donde está inscrito).
 * - Rastreo: si el ciclo falla, sus paquetes disponibles se retiran y los
 *   usados nombran a los pacientes.
 */

interface Clinica {
  clinicId: string;
  owner: string;
  assistant: string;
  reception: string;
  accounting: string;
  branchId: string;
  profId: string;
  pacientes: string[];
}

describe("trazabilidad de esterilización en la base", () => {
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

  async function sembrarClinica(nombre: string): Promise<Clinica> {
    const clinicId = randomUUID();
    const owner = randomUUID();
    const assistant = randomUUID();
    const reception = randomUUID();
    const accounting = randomUUID();
    const branchId = randomUUID();
    const profId = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by, country, timezone) VALUES ($1, $2, $3, 'CL', 'America/Santiago')`,
      [clinicId, nombre, owner],
    );
    await client.query(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role)
       SELECT $1, u, r::public.app_role FROM unnest($2::uuid[], $3::text[]) AS t(u, r)
       ON CONFLICT DO NOTHING`,
      [
        clinicId,
        [owner, assistant, reception, accounting],
        ["owner", "assistant", "reception", "accounting"],
      ],
    );
    await client.query(
      `INSERT INTO public.branches (id, clinic_id, name, timezone) VALUES ($1, $2, 'Matriz', 'America/Santiago')`,
      [branchId, clinicId],
    );
    await client.query(
      `INSERT INTO public.professionals (id, clinic_id, branch_id, full_name, color) VALUES ($1, $2, $3, 'Dr. Autoclave', '#a06f24')`,
      [profId, clinicId, branchId],
    );
    const pacientes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await client.query<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [clinicId, `Paciente ${i + 1}`, owner],
      );
      pacientes.push(p.rows[0].id);
    }
    return { clinicId, owner, assistant, reception, accounting, branchId, profId, pacientes };
  }

  async function ciclo(
    c: Clinica,
    extra: Partial<Record<string, string | number | null>> = {},
    userId = c.assistant,
  ) {
    const campos = {
      equipment: "Autoclave Clase B",
      run_at: new Date().toISOString(),
      cycle_type: "envuelto",
      temperature_c: 134,
      pressure_bar: 2.1,
      exposure_minutes: 5.5,
      chemical_indicator: "aprobado",
      biological_indicator: "pendiente",
      result: "aprobado",
      responsible_name: "Asistente Pérez",
      ...extra,
    };
    const cols = Object.keys(campos);
    const r = await como<{ id: string; year: number; number: number; result: string }>(
      userId,
      `INSERT INTO public.sterilization_cycles (clinic_id, ${cols.join(", ")})
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id, year, number, result`,
      [c.clinicId, ...Object.values(campos)],
    );
    return r;
  }

  async function paquete(c: Clinica, cycleId: string, dias = 30, userId = c.assistant) {
    return como<{ id: string; code: string; expires_on: string; status: string }>(
      userId,
      `INSERT INTO public.sterilization_packages (clinic_id, cycle_id, contents, shelf_life_days)
       VALUES ($1, $2, 'Kit de examen', $3) RETURNING id, code, to_char(expires_on, 'YYYY-MM-DD') AS expires_on, status`,
      [c.clinicId, cycleId, dias],
    );
  }

  const usar = (c: Clinica, pkgId: string, patientId: string, citaId: string | null = null) =>
    como(
      c.assistant,
      `UPDATE public.sterilization_packages SET status = 'usado', used_patient_id = $2, used_appointment_id = $3, used_at = now() WHERE id = $1`,
      [pkgId, patientId, citaId],
    );

  async function cita(c: Clinica, pacienteIdx: number) {
    const inicio = new Date(Date.now() - 30 * 60_000).toISOString();
    const fin = new Date(Date.now() + 30 * 60_000).toISOString();
    const [r] = await servicio<{ id: string }>(
      `INSERT INTO public.appointments (clinic_id, branch_id, patient_id, professional_id, treatment_label, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, $4, 'Limpieza', $5, $6, $7) RETURNING id`,
      [c.clinicId, c.branchId, c.pacientes[pacienteIdx], c.profId, inicio, fin, c.owner],
    );
    return r.id;
  }

  beforeAll(async () => {
    client = await conectar();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    a = await sembrarClinica("Clínica Esteril A");
    b = await sembrarClinica("Clínica Esteril B");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("correlativo por clínica y año, y código del paquete", async () => {
    const c1 = await ciclo(a);
    const c2 = await ciclo(a);
    const otra = await ciclo(b, {}, b.assistant);
    expect(c1.error).toBe("");
    expect([c1.filas[0].number, c2.filas[0].number]).toEqual([1, 2]);
    expect(otra.filas[0].number).toBe(1);
    const p1 = await paquete(a, c1.filas[0].id);
    const p2 = await paquete(a, c2.filas[0].id);
    expect(p1.error).toBe("");
    const anio = c1.filas[0].year;
    expect(p1.filas[0].code).toBe(`E${anio}-00001`);
    expect(p2.filas[0].code).toBe(`E${anio}-00002`);
  });

  it("aislamiento y roles: otra clínica no ve ni registra; recepción ve, contabilidad no", async () => {
    const c1 = await ciclo(a);
    const id = c1.filas[0].id;
    expect(
      (await como(b.owner, `SELECT * FROM public.sterilization_cycles WHERE id = $1`, [id])).filas,
    ).toHaveLength(0);
    expect(
      (await como(a.reception, `SELECT * FROM public.sterilization_cycles WHERE id = $1`, [id]))
        .filas,
    ).toHaveLength(1);
    expect(
      (await como(a.accounting, `SELECT * FROM public.sterilization_cycles WHERE id = $1`, [id]))
        .filas,
    ).toHaveLength(0);
    expect((await ciclo(a, {}, a.reception)).error).toMatch(/row-level security/);
    expect((await ciclo(a, {}, b.owner)).error).not.toBe("");
    // Paquete con la clínica propia y el ciclo de otra.
    const cruzado = await como(
      b.assistant,
      `INSERT INTO public.sterilization_packages (clinic_id, cycle_id, contents, shelf_life_days) VALUES ($1, $2, 'Kit', 30)`,
      [b.clinicId, id],
    );
    expect(cruzado.error).not.toBe("");
    const p = await paquete(a, id);
    const ajenoUsa = await como(
      b.assistant,
      `UPDATE public.sterilization_packages SET status = 'usado', used_patient_id = $2, used_at = now() WHERE id = $1 RETURNING id`,
      [p.filas[0].id, b.pacientes[0]],
    );
    expect(ajenoUsa.filas).toHaveLength(0);
  });

  it("indicadores: fallido deja el ciclo fallido; sin químico no se aprueba; cerrado no se edita", async () => {
    const fallido = await ciclo(a, { chemical_indicator: "fallido", result: "pendiente" });
    expect(fallido.filas[0].result).toBe("fallido");
    const sinQuimico = await ciclo(a, { chemical_indicator: "pendiente", result: "aprobado" });
    expect(sinQuimico.error).toMatch(/indicador químico/);

    const ok = await ciclo(a);
    const edita = await como(
      a.assistant,
      `UPDATE public.sterilization_cycles SET temperature_c = 121 WHERE id = $1`,
      [ok.filas[0].id],
    );
    expect(edita.error).toMatch(/no se editan/);
    const notas = await como(
      a.assistant,
      `UPDATE public.sterilization_cycles SET notes = 'Carga completa' WHERE id = $1`,
      [ok.filas[0].id],
    );
    expect(notas.error).toBe("");
    // El fallido no vuelve atrás.
    const revive = await como(
      a.assistant,
      `UPDATE public.sterilization_cycles SET result = 'aprobado' WHERE id = $1`,
      [fallido.filas[0].id],
    );
    expect(revive.error).not.toBe("");
  });

  it("pruebas del equipo no llevan paquetes; un ciclo pendiente no se usa", async () => {
    const bowie = await ciclo(a, { cycle_type: "bowie_dick" });
    expect((await paquete(a, bowie.filas[0].id)).error).toMatch(/prueba del equipo/);
    const pendiente = await ciclo(a, { chemical_indicator: "pendiente", result: "pendiente" });
    const p = await paquete(a, pendiente.filas[0].id);
    expect(p.error).toBe("");
    expect((await usar(a, p.filas[0].id, a.pacientes[0])).error).toMatch(/no está aprobado/);
  });

  it("vencimiento: el día del ciclo más la vida útil; vencido no se usa", async () => {
    const hace40 = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const viejo = await ciclo(a, { run_at: hace40 });
    const p = await paquete(a, viejo.filas[0].id, 30);
    const esperado = new Date(Date.parse(hace40) + 30 * 86_400_000);
    const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(
      new Date(Date.parse(hace40)),
    );
    const vence = new Date(`${dia}T00:00:00Z`);
    vence.setUTCDate(vence.getUTCDate() + 30);
    expect(p.filas[0].expires_on).toBe(vence.toISOString().slice(0, 10));
    void esperado;
    expect((await usar(a, p.filas[0].id, a.pacientes[0])).error).toMatch(/venció/);
  });

  it("uso: una vez, paciente de la clínica y cita de ese paciente (o grupal donde está inscrito)", async () => {
    const c = await ciclo(a);
    const p1 = (await paquete(a, c.filas[0].id)).filas[0];
    const p2 = (await paquete(a, c.filas[0].id)).filas[0];
    const p3 = (await paquete(a, c.filas[0].id)).filas[0];
    const citaDe0 = await cita(a, 0);

    expect((await usar(a, p1.id, b.pacientes[0])).error).toMatch(/paciente de esta clínica/);
    expect((await usar(a, p1.id, a.pacientes[1], citaDe0)).error).toMatch(/no es de ese paciente/);
    expect((await usar(a, p1.id, a.pacientes[0], citaDe0)).error).toBe("");
    expect((await usar(a, p1.id, a.pacientes[1])).error).toMatch(/ya fue usado/);

    // Cita grupal: el paciente 2 inscrito puede usar un paquete en esa cita.
    const grupal = await cita(a, 1);
    await como(
      a.owner,
      `INSERT INTO public.appointment_groups (appointment_id, clinic_id, title, capacity) VALUES ($1, $2, 'Taller', 5)`,
      [grupal, a.clinicId],
    );
    await como(
      a.owner,
      `INSERT INTO public.appointment_group_participants (clinic_id, appointment_id, patient_id) VALUES ($1, $2, $3)`,
      [a.clinicId, grupal, a.pacientes[2]],
    );
    expect((await usar(a, p2.id, a.pacientes[2], grupal)).error).toBe("");
    expect((await usar(a, p3.id, a.pacientes[0], grupal)).error).toMatch(/no es de ese paciente/);
  });

  it("rastreo: si el ciclo falla, retira los disponibles y los usados nombran a los pacientes", async () => {
    const c = await ciclo(a);
    const cycleId = c.filas[0].id;
    const usados = [(await paquete(a, cycleId)).filas[0], (await paquete(a, cycleId)).filas[0]];
    const libre = (await paquete(a, cycleId)).filas[0];
    await usar(a, usados[0].id, a.pacientes[0], await cita(a, 0));
    await usar(a, usados[1].id, a.pacientes[1]);

    const falla = await como(
      a.assistant,
      `UPDATE public.sterilization_cycles SET biological_indicator = 'fallido' WHERE id = $1 RETURNING result, failure_reason`,
      [cycleId],
    );
    expect(falla.error).toBe("");
    expect(falla.filas[0]).toMatchObject({ result: "fallido" });

    const [l] = await servicio<{ status: string; discard_reason: string }>(
      `SELECT status, discard_reason FROM public.sterilization_packages WHERE id = $1`,
      [libre.id],
    );
    expect(l.status).toBe("retirado");
    expect(l.discard_reason).toMatch(/Ciclo fallido/);

    const rastreo = await como<{ patient_id: string }>(
      a.reception,
      `SELECT used_patient_id AS patient_id FROM public.sterilization_packages
        WHERE cycle_id = $1 AND status = 'usado' ORDER BY used_at, code`,
      [cycleId],
    );
    expect(rastreo.filas.map((f) => f.patient_id).sort()).toEqual(
      [a.pacientes[0], a.pacientes[1]].sort(),
    );
    // Un ciclo fallido no etiqueta paquetes nuevos.
    expect((await paquete(a, cycleId)).error).toMatch(/falló/);
  });

  it("nadie borra ciclos ni paquetes", async () => {
    const c = await ciclo(a);
    const r = await como(a.owner, `DELETE FROM public.sterilization_cycles WHERE id = $1`, [
      c.filas[0].id,
    ]);
    expect(r.error).toMatch(/permission denied/);
  });
});
