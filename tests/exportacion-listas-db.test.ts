import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * EXP-04 (migración 20261027200000): `registrar_exportacion_de_lista` anota
 * cada CSV bajado desde una lista en `clinic_data_exports`. Se prueba como
 * `authenticated` (igual que PostgREST), con la identidad de cada persona.
 */
describe("registro de exportaciones de listas", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let otraClinica: string;

  async function como<T>(
    userId: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ filas: T[]; error: string }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      userId ? JSON.stringify({ sub: userId, role: "authenticated", aal: "aal1" }) : "",
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query(`SET LOCAL ROLE ${userId ? "authenticated" : "anon"}`);
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

  const REGISTRAR = `SELECT public.registrar_exportacion_de_lista($1, $2, $3, $4::jsonb) AS id`;

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
    // `actor_id` apunta a auth.users: los usuarios del escenario tienen que existir.
    await client.query(
      `INSERT INTO auth.users (id) SELECT unnest($1::uuid[]) ON CONFLICT (id) DO NOTHING`,
      [Object.values(usuarios)],
    );
    otraClinica = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraClinica, randomUUID()],
    );
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("es SECURITY DEFINER y anon no la puede ejecutar", async () => {
    const r = await client.query<{ definer: boolean; anon: boolean; auth: boolean }>(
      `SELECT p.prosecdef AS definer,
              has_function_privilege('anon', p.oid, 'execute') AS anon,
              has_function_privilege('authenticated', p.oid, 'execute') AS auth
         FROM pg_proc p WHERE p.oid = 'public.registrar_exportacion_de_lista(uuid,text,integer,jsonb)'::regprocedure`,
    );
    expect(r.rows[0]).toEqual({ definer: true, anon: false, auth: true });
  });

  it("cualquier miembro anota su exportación, con su actor y formato lista_csv", async () => {
    for (const rol of ["reception", "dentist", "accounting"]) {
      const r = await como<{ id: string }>(usuarios[rol], REGISTRAR, [
        clinicId,
        "pacientes",
        12,
        JSON.stringify({ filtros: { q: "ana" } }),
      ]);
      expect(r.error, rol).toBe("");
      const fila = await client.query(
        `SELECT actor_id, formato, patient_id, detalle FROM public.clinic_data_exports WHERE id = $1`,
        [r.filas[0].id],
      );
      expect(fila.rows[0]).toMatchObject({
        actor_id: usuarios[rol],
        formato: "lista_csv",
        patient_id: null,
        detalle: { lista: "pacientes", filas: 12, filtros: { q: "ana" } },
      });
    }
  });

  it("el detalle no puede pisar la lista ni las filas", async () => {
    const r = await como<{ id: string }>(usuarios.owner, REGISTRAR, [
      clinicId,
      "citas",
      3,
      JSON.stringify({ lista: "otra", filas: 999 }),
    ]);
    const fila = await client.query(
      `SELECT detalle FROM public.clinic_data_exports WHERE id = $1`,
      [r.filas[0].id],
    );
    expect(fila.rows[0].detalle).toMatchObject({ lista: "citas", filas: 3 });
  });

  it("no se puede anotar en otra clínica ni sin sesión (aislamiento)", async () => {
    const ajena = await como(usuarios.owner, REGISTRAR, [otraClinica, "pacientes", 1, "{}"]);
    expect(ajena.error).toMatch(/sin permiso/);
    const externo = await como(usuarios.externo, REGISTRAR, [clinicId, "pacientes", 1, "{}"]);
    expect(externo.error).toMatch(/sin permiso/);
    const anon = await como(null, REGISTRAR, [clinicId, "pacientes", 1, "{}"]);
    expect(anon.error).toMatch(/permission denied|sin permiso/);
    const n = await client.query(
      `SELECT count(*)::int AS n FROM public.clinic_data_exports WHERE clinic_id = ANY($1)`,
      [[clinicId, otraClinica]],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("valida la forma: lista, filas y tamaño del detalle", async () => {
    const mala = await como(usuarios.owner, REGISTRAR, [clinicId, "Pacientes; drop", 1, "{}"]);
    expect(mala.error).toMatch(/lista invalida/);
    const negativa = await como(usuarios.owner, REGISTRAR, [clinicId, "pacientes", -1, "{}"]);
    expect(negativa.error).toMatch(/filas invalida/);
    const grande = await como(usuarios.owner, REGISTRAR, [
      clinicId,
      "pacientes",
      1,
      JSON.stringify({ x: "a".repeat(9000) }),
    ]);
    expect(grande.error).toMatch(/detalle invalido/);
    const lista = await como(usuarios.owner, REGISTRAR, [clinicId, "pacientes", 1, "[1]"]);
    expect(lista.error).toMatch(/detalle invalido/);
  });

  it("nadie inserta directo en el registro, y cada uno ve solo lo suyo salvo owner/admin", async () => {
    const directo = await como(
      usuarios.owner,
      `INSERT INTO public.clinic_data_exports (clinic_id, actor_id, formato) VALUES ($1, $2, 'lista_csv')`,
      [clinicId, usuarios.owner],
    );
    expect(directo.error).toMatch(/permission denied|row-level security/);

    await como(usuarios.reception, REGISTRAR, [clinicId, "citas", 1, "{}"]);
    await como(usuarios.dentist, REGISTRAR, [clinicId, "pacientes", 2, "{}"]);
    const SELECT = `SELECT actor_id FROM public.clinic_data_exports WHERE clinic_id = $1`;
    const propias = await como<{ actor_id: string }>(usuarios.reception, SELECT, [clinicId]);
    expect(propias.filas.map((f) => f.actor_id)).toEqual([usuarios.reception]);
    const todas = await como<{ actor_id: string }>(usuarios.admin, SELECT, [clinicId]);
    expect(todas.filas).toHaveLength(2);
  });
});
