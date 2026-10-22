import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, esperaFallo, sembrarEscenario } from "./helpers/db";

/**
 * Ola 1 · frente cita (migraciones 20261022200000 y 20261022200100):
 *
 * - Toda clínica nueva nace con su lista de tipos de cita (AGE-11).
 * - La RLS de `appointment_types`: leen los miembros, escriben owner y admin,
 *   y nadie ve ni toca los de otra clínica (cross-tenant).
 * - La cita guarda el tipo y una copia de su nombre (regla 10): renombrar o
 *   borrar el tipo no cambia lo que dice la cita, y un tipo de otra clínica
 *   no se puede colgar de una cita.
 * - `procedures.is_favorite` y `procedimientos_frecuentes` (AGE-12).
 *
 * La conexión de los tests es `postgres` (salta la RLS): para probarla de
 * verdad se asume el rol `authenticated` con la identidad de cada persona,
 * igual que PostgREST.
 */

const TIPOS_BASE = [
  "1ª evaluación",
  "Control",
  "Urgencia",
  "Presupuesto",
  "Tratamiento",
  "Retiro de puntos",
  "Otro",
];

describe("tipos de cita y procedimientos frecuentes", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let otra: { clinicId: string; usuarios: Record<string, string> };

  /** Corre `sql` como `authenticated` con la identidad del usuario; devuelve filas o el error. */
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

  async function tipoId(clinica: string, nombre: string): Promise<string> {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM public.appointment_types WHERE clinic_id = $1 AND name = $2`,
      [clinica, nombre],
    );
    return r.rows[0].id;
  }

  async function crearCita(clinica: string, creador: string, extra: { tipo?: string | null } = {}) {
    const branch = await client.query<{ id: string }>(
      `INSERT INTO public.branches (clinic_id, name) VALUES ($1, 'Sede') RETURNING id`,
      [clinica],
    );
    const pro = await client.query<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Prueba') RETURNING id`,
      [clinica],
    );
    const pac = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Paciente', $2) RETURNING id`,
      [clinica, creador],
    );
    const r = await client.query<{ id: string; appointment_type_name: string | null }>(
      `INSERT INTO public.appointments
         (clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at,
          treatment_label, created_by, appointment_type_id, appointment_type_name)
       VALUES ($1, $2, $3, $4, now() - interval '1 day', now() - interval '1 day' + interval '30 min',
               'Control', $5, $6, 'nombre inventado')
       RETURNING id, appointment_type_name`,
      [clinica, branch.rows[0].id, pac.rows[0].id, pro.rows[0].id, creador, extra.tipo ?? null],
    );
    return r.rows[0];
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
    // Segunda clínica, solo con su owner (el trigger de clínicas lo hace
    // miembro). `sembrarEscenario` no se puede llamar dos veces por
    // transacción: crea una tabla temporal.
    const otraId = randomUUID();
    const otroOwner = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraId, otroOwner],
    );
    otra = { clinicId: otraId, usuarios: { owner: otroOwner } };
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("una clínica nueva nace con los siete tipos base, en orden", async () => {
    const r = await client.query<{ name: string }>(
      `SELECT name FROM public.appointment_types WHERE clinic_id = $1 ORDER BY position`,
      [clinicId],
    );
    expect(r.rows.map((x) => x.name)).toEqual(TIPOS_BASE);
  });

  it("la tabla tiene RLS y la función de siembra no es ejecutable por anon", async () => {
    const rls = await client.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.appointment_types'::regclass`,
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const anon = await client.query<{ ok: boolean }>(
      `SELECT has_function_privilege('anon', 'public.seed_clinic_appointment_types()', 'execute') AS ok`,
    );
    expect(anon.rows[0].ok).toBe(false);
  });

  it("todos los miembros leen los tipos de su clínica, y solo de su clínica", async () => {
    for (const rol of ["owner", "dentist", "reception", "accounting"]) {
      const { filas, error } = await como<{ clinic_id: string }>(
        usuarios[rol],
        `SELECT clinic_id FROM public.appointment_types WHERE clinic_id IN ($1, $2)`,
        [clinicId, otra.clinicId],
      );
      expect(error, rol).toBe("");
      expect(filas.length, rol).toBe(TIPOS_BASE.length);
      expect(new Set(filas.map((f) => f.clinic_id)), rol).toEqual(new Set([clinicId]));
    }
    const externo = await como(usuarios.externo, `SELECT id FROM public.appointment_types`);
    expect(externo.filas).toEqual([]);
  });

  it("solo owner y admin crean o renombran tipos", async () => {
    for (const rol of ["owner", "admin"]) {
      const { error } = await como(
        usuarios[rol],
        `INSERT INTO public.appointment_types (clinic_id, name) VALUES ($1, $2)`,
        [clinicId, `Nuevo ${rol}`],
      );
      expect(error, rol).toBe("");
    }
    for (const rol of ["dentist", "assistant", "reception", "accounting"]) {
      const { error } = await como(
        usuarios[rol],
        `INSERT INTO public.appointment_types (clinic_id, name) VALUES ($1, $2)`,
        [clinicId, `Nuevo ${rol}`],
      );
      expect(error, rol).toMatch(/row-level security/i);
      const upd = await como<{ id: string }>(
        usuarios[rol],
        `UPDATE public.appointment_types SET name = 'Cambiado' WHERE clinic_id = $1 RETURNING id`,
        [clinicId],
      );
      expect(upd.filas, rol).toEqual([]);
    }
  });

  it("el owner de otra clínica no puede tocar estos tipos (cross-tenant)", async () => {
    const ins = await como(
      otra.usuarios.owner,
      `INSERT INTO public.appointment_types (clinic_id, name) VALUES ($1, 'Intruso')`,
      [clinicId],
    );
    expect(ins.error).toMatch(/row-level security/i);
    const upd = await como<{ id: string }>(
      otra.usuarios.owner,
      `UPDATE public.appointment_types SET is_active = false WHERE clinic_id = $1 RETURNING id`,
      [clinicId],
    );
    expect(upd.filas).toEqual([]);
    const del = await como<{ id: string }>(
      otra.usuarios.owner,
      `DELETE FROM public.appointment_types WHERE clinic_id = $1 RETURNING id`,
      [clinicId],
    );
    expect(del.filas).toEqual([]);
  });

  it("el nombre no se repite en la misma clínica (sin importar mayúsculas)", async () => {
    const fallo = await esperaFallo(client, () =>
      client.query(
        `INSERT INTO public.appointment_types (clinic_id, name) VALUES ($1, ' control ')`,
        [clinicId],
      ),
    );
    expect(fallo.code).toBe("23505");
  });

  it("la cita guarda el nombre del tipo (snapshot) y lo conserva al renombrar o borrar", async () => {
    const control = await tipoId(clinicId, "Control");
    const cita = await crearCita(clinicId, usuarios.owner, { tipo: control });
    // El nombre lo pone la base, no el cliente.
    expect(cita.appointment_type_name).toBe("Control");

    await client.query(`UPDATE public.appointment_types SET name = 'Control anual' WHERE id = $1`, [
      control,
    ]);
    await client.query(`UPDATE public.appointments SET treatment_label = 'Otro' WHERE id = $1`, [
      cita.id,
    ]);
    let fila = await client.query<{ appointment_type_name: string }>(
      `SELECT appointment_type_name FROM public.appointments WHERE id = $1`,
      [cita.id],
    );
    expect(fila.rows[0].appointment_type_name).toBe("Control");

    // Tampoco se reescribe mandando solo el nombre.
    await client.query(
      `UPDATE public.appointments SET appointment_type_name = 'Falso' WHERE id = $1`,
      [cita.id],
    );
    fila = await client.query(
      `SELECT appointment_type_name FROM public.appointments WHERE id = $1`,
      [cita.id],
    );
    expect(fila.rows[0].appointment_type_name).toBe("Control");

    await client.query(`DELETE FROM public.appointment_types WHERE id = $1`, [control]);
    const tras = await client.query<{
      appointment_type_id: string | null;
      appointment_type_name: string;
    }>(`SELECT appointment_type_id, appointment_type_name FROM public.appointments WHERE id = $1`, [
      cita.id,
    ]);
    expect(tras.rows[0]).toEqual({ appointment_type_id: null, appointment_type_name: "Control" });
  });

  it("sin tipo, la cita no guarda nombre aunque el cliente lo mande", async () => {
    const cita = await crearCita(clinicId, usuarios.owner, { tipo: null });
    expect(cita.appointment_type_name).toBeNull();
  });

  it("un tipo de otra clínica no se puede usar en una cita", async () => {
    const ajeno = await tipoId(otra.clinicId, "Urgencia");
    const fallo = await esperaFallo(client, () =>
      crearCita(clinicId, usuarios.owner, { tipo: ajeno }),
    );
    expect(fallo.message).toMatch(/no es de esta clínica/);
  });

  it("procedimientos: favoritos y los más agendados en 90 días, respetando la RLS", async () => {
    const col = await client.query<{ column_default: string; is_nullable: string }>(
      `SELECT column_default, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'procedures' AND column_name = 'is_favorite'`,
    );
    expect(col.rows[0]).toEqual({ column_default: "false", is_nullable: "NO" });

    const p = await client.query<{ id: string }>(
      `INSERT INTO public.procedures (clinic_id, name, created_by, duration_min)
       VALUES ($1, 'Limpieza', $2, 45) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    const cita = await crearCita(clinicId, usuarios.owner);
    await client.query(`UPDATE public.appointments SET procedure_id = $1 WHERE id = $2`, [
      p.rows[0].id,
      cita.id,
    ]);

    const desde = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const propia = await como<{ procedure_id: string; usos: string }>(
      usuarios.reception,
      `SELECT procedure_id, usos FROM public.procedimientos_frecuentes($1, $2, 12)`,
      [clinicId, desde],
    );
    expect(propia.error).toBe("");
    expect(propia.filas).toEqual([{ procedure_id: p.rows[0].id, usos: "1" }]);

    // Otra clínica pidiendo los de esta: la RLS de appointments no le deja ver nada.
    const ajena = await como(
      otra.usuarios.owner,
      `SELECT * FROM public.procedimientos_frecuentes($1, $2, 12)`,
      [clinicId, desde],
    );
    expect(ajena.filas).toEqual([]);

    const anon = await client.query<{ ok: boolean }>(
      `SELECT has_function_privilege('anon', 'public.procedimientos_frecuentes(uuid, timestamptz, integer)', 'execute') AS ok`,
    );
    expect(anon.rows[0].ok).toBe(false);
  });

  it("la clínica nueva no hereda tipos de nadie ni falla si ya los tiene", async () => {
    const id = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Tercera', $2)`,
      [id, usuarios.owner],
    );
    const r = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.appointment_types WHERE clinic_id = $1`,
      [id],
    );
    expect(Number(r.rows[0].n)).toBe(TIPOS_BASE.length);
  });
});
