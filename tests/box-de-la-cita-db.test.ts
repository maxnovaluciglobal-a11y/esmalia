import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, esperaFallo, sembrarEscenario } from "./helpers/db";

/**
 * Ola 2 · frente boxes y grilla (migraciones 20261023200000 y 20261023200100):
 *
 * - La cita guarda su box (`operatory_id`) y una copia del nombre
 *   (`operatory_name`, regla 10) que pone la base.
 * - El box tiene que ser de la misma clínica y de la misma sucursal, y estar
 *   activo al elegirlo. Un box que se desactiva después sigue valiendo para
 *   las citas que ya lo tienen.
 * - Si la cita cambia de sucursal sin cambiar de box, el box se suelta.
 * - Los boxes tienen orden por sucursal (`position`) y su RLS no cambió:
 *   solo owner y admin los editan.
 */

describe("box de la cita y orden de boxes", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let sede: string;
  let otraSede: string;
  let box1: string;
  let box2: string;
  let boxOtraSede: string;
  let profesional: string;
  let paciente: string;

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

  async function nuevaSede(clinica: string, nombre: string): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.branches (clinic_id, name) VALUES ($1, $2) RETURNING id`,
      [clinica, nombre],
    );
    return r.rows[0].id;
  }

  async function nuevoBox(clinica: string, sucursal: string, nombre: string): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.operatories (clinic_id, branch_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [clinica, sucursal, nombre],
    );
    return r.rows[0].id;
  }

  async function crearCita(box: string | null, sucursal = sede) {
    const r = await client.query<{
      id: string;
      operatory_id: string | null;
      operatory_name: string | null;
    }>(
      `INSERT INTO public.appointments
         (clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at,
          treatment_label, created_by, operatory_id, operatory_name)
       VALUES ($1, $2, $3, $4, now() + interval '1 day', now() + interval '1 day 30 min',
               'Control', $5, $6, 'nombre inventado')
       RETURNING id, operatory_id, operatory_name`,
      [clinicId, sucursal, paciente, profesional, usuarios.owner, box],
    );
    return r.rows[0];
  }

  async function leer(id: string) {
    const r = await client.query<{
      branch_id: string;
      operatory_id: string | null;
      operatory_name: string | null;
    }>(`SELECT branch_id, operatory_id, operatory_name FROM public.appointments WHERE id = $1`, [
      id,
    ]);
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
    sede = await nuevaSede(clinicId, "Centro");
    otraSede = await nuevaSede(clinicId, "Providencia");
    box1 = await nuevoBox(clinicId, sede, "Box 1");
    box2 = await nuevoBox(clinicId, sede, "Box 2");
    boxOtraSede = await nuevoBox(clinicId, otraSede, "Box P");
    const pro = await client.query<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Prueba') RETURNING id`,
      [clinicId],
    );
    profesional = pro.rows[0].id;
    const pac = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Paciente', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    paciente = pac.rows[0].id;
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("la cita guarda el box y el nombre lo pone la base, no el cliente", async () => {
    const cita = await crearCita(box1);
    expect(cita.operatory_id).toBe(box1);
    expect(cita.operatory_name).toBe("Box 1");

    const sinBox = await crearCita(null);
    expect(sinBox.operatory_name).toBeNull();
  });

  it("el nombre guardado no cambia al renombrar el box ni mandando solo el nombre", async () => {
    const cita = await crearCita(box1);
    await client.query(`UPDATE public.operatories SET name = 'Box 1 nuevo' WHERE id = $1`, [box1]);
    await client.query(`UPDATE public.appointments SET treatment_label = 'Otro' WHERE id = $1`, [
      cita.id,
    ]);
    await client.query(`UPDATE public.appointments SET operatory_name = 'Falso' WHERE id = $1`, [
      cita.id,
    ]);
    expect((await leer(cita.id)).operatory_name).toBe("Box 1");
  });

  it("cambiar de box actualiza el nombre; borrar el box conserva el nombre (ON DELETE SET NULL)", async () => {
    const cita = await crearCita(box1);
    await client.query(`UPDATE public.appointments SET operatory_id = $1 WHERE id = $2`, [
      box2,
      cita.id,
    ]);
    expect((await leer(cita.id)).operatory_name).toBe("Box 2");
    await client.query(`DELETE FROM public.operatories WHERE id = $1`, [box2]);
    expect(await leer(cita.id)).toMatchObject({ operatory_id: null, operatory_name: "Box 2" });
  });

  it("rechaza un box de otra sucursal o de otra clínica", async () => {
    const deOtraSede = await esperaFallo(client, () => crearCita(boxOtraSede));
    expect(deOtraSede.message).toMatch(/no es de la sucursal/);

    const otraClinica = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra', $2)`,
      [otraClinica, randomUUID()],
    );
    const sedeAjena = await nuevaSede(otraClinica, "Ajena");
    const boxAjeno = await nuevoBox(otraClinica, sedeAjena, "Box ajeno");
    const ajeno = await esperaFallo(client, () => crearCita(boxAjeno));
    expect(ajeno.message).toMatch(/no es de esta clínica/);
  });

  it("un box desactivado no se puede elegir, pero las citas que ya lo tienen lo conservan", async () => {
    const cita = await crearCita(box1);
    await client.query(`UPDATE public.operatories SET is_active = false WHERE id = $1`, [box1]);
    // Editar otra cosa de la cita no la rompe.
    await client.query(`UPDATE public.appointments SET notes = 'nota' WHERE id = $1`, [cita.id]);
    expect((await leer(cita.id)).operatory_id).toBe(box1);
    const nueva = await esperaFallo(client, () => crearCita(box1));
    expect(nueva.message).toMatch(/desactivado/);
  });

  it("al cambiar de sucursal sin cambiar de box, el box se suelta", async () => {
    const cita = await crearCita(box1);
    await client.query(`UPDATE public.appointments SET branch_id = $1 WHERE id = $2`, [
      otraSede,
      cita.id,
    ]);
    expect(await leer(cita.id)).toEqual({
      branch_id: otraSede,
      operatory_id: null,
      operatory_name: null,
    });
    // Con el box de la sucursal nueva en el mismo UPDATE, queda ese.
    const otra = await crearCita(box2);
    await client.query(
      `UPDATE public.appointments SET branch_id = $1, operatory_id = $2 WHERE id = $3`,
      [otraSede, boxOtraSede, otra.id],
    );
    expect(await leer(otra.id)).toEqual({
      branch_id: otraSede,
      operatory_id: boxOtraSede,
      operatory_name: "Box P",
    });
  });

  it("los boxes tienen orden y solo owner y admin lo cambian", async () => {
    const col = await client.query<{ column_default: string; is_nullable: string }>(
      `SELECT column_default, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'operatories' AND column_name = 'position'`,
    );
    expect(col.rows[0]).toEqual({ column_default: "0", is_nullable: "NO" });

    for (const rol of ["owner", "admin"]) {
      const { filas, error } = await como<{ id: string }>(
        usuarios[rol],
        `UPDATE public.operatories SET position = 5 WHERE id = $1 RETURNING id`,
        [box1],
      );
      expect(error, rol).toBe("");
      expect(filas.length, rol).toBe(1);
    }
    for (const rol of ["dentist", "assistant", "reception", "accounting"]) {
      const { filas } = await como<{ id: string }>(
        usuarios[rol],
        `UPDATE public.operatories SET position = 9, name = 'X' WHERE id = $1 RETURNING id`,
        [box1],
      );
      expect(filas, rol).toEqual([]);
    }
  });

  it("la función del trigger no es SECURITY DEFINER", async () => {
    const r = await client.query<{ prosecdef: boolean }>(
      `SELECT prosecdef FROM pg_proc WHERE proname = 'appointments_box_de_la_cita'`,
    );
    expect(r.rows[0].prosecdef).toBe(false);
  });
});
