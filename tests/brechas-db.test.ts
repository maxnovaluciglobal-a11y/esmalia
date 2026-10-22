import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * SEG-06 (migración 20261026200100), contra la base:
 *
 * - Solo owner/admin de la clínica leen y registran incidentes y
 *   seguimientos; otra clínica no los ve.
 * - Bitácora inmutable: ni la app ni el rol de servicio editan o borran
 *   (salvo la cascada al borrar la clínica entera).
 * - Autor y fecha los estampa la base; nada con fecha futura; un
 *   seguimiento no se cuelga de un incidente de otra clínica.
 */

describe("registro de brechas en la base", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let otraClinica: string;
  let otroOwner: string;

  async function como<T>(
    userId: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ filas: T[]; error: string }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "",
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query(userId ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE service_role");
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

  function registrar(userId: string, clinica = clinicId, extra = "") {
    return como<{ id: string; created_by: string | null }>(
      userId,
      `INSERT INTO public.security_incidents
         (clinic_id, detected_at, title, description, data_categories, responsible_name, created_by ${extra ? ", created_at" : ""})
       VALUES ($1, now() - interval '1 hour', 'Correo a destinatario equivocado',
               'Se envió el PDF de una ficha a otro paciente.', '{identificacion,salud}', 'Ana Owner', $2
               ${extra ? ", '2000-01-01'" : ""})
       RETURNING id, created_by`,
      [clinica, otroOwner],
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
    const esc = await sembrarEscenario(client);
    clinicId = esc.clinicId;
    usuarios = esc.usuarios;
    otroOwner = randomUUID();
    otraClinica = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraClinica, otroOwner],
    );
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("owner y admin registran; la base estampa el autor real", async () => {
    for (const rol of ["owner", "admin"]) {
      const r = await registrar(usuarios[rol], clinicId, "fecha falsa");
      expect(r.error, rol).toBe("");
      expect(r.filas[0].created_by, rol).toBe(usuarios[rol]);
    }
    const fecha = await client.query<{ y: number }>(
      `SELECT min(extract(year from created_at))::int AS y FROM public.security_incidents WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(fecha.rows[0].y).toBeGreaterThan(2000);
  });

  it("los demás roles y otra clínica no registran ni ven", async () => {
    const id = (await registrar(usuarios.owner)).filas[0].id;
    for (const rol of ["dentist", "assistant", "reception", "accounting", "externo"]) {
      expect((await registrar(usuarios[rol])).error, rol).not.toBe("");
      const r = await como(
        usuarios[rol],
        `SELECT id FROM public.security_incidents WHERE id = $1`,
        [id],
      );
      expect(r.filas, rol).toHaveLength(0);
    }
    const otro = await como(otroOwner, `SELECT id FROM public.security_incidents WHERE id = $1`, [
      id,
    ]);
    expect(otro.filas).toHaveLength(0);
    // Tampoco puede colgarle un seguimiento desde su clínica.
    const cruzado = await como(
      otroOwner,
      `INSERT INTO public.security_incident_updates (clinic_id, incident_id, note) VALUES ($1, $2, 'Intento cruzado')`,
      [otraClinica, id],
    );
    expect(cruzado.error).toMatch(/no pertenece a esta clínica/);
  });

  it("seguimientos: owner/admin los agregan; nadie edita ni borra nada", async () => {
    const id = (await registrar(usuarios.owner)).filas[0].id;
    const seg = await como<{ id: string; created_by: string }>(
      usuarios.admin,
      `INSERT INTO public.security_incident_updates
         (clinic_id, incident_id, note, status, notify_agency, agency_notified_at)
       VALUES ($1, $2, 'Se notificó a la Agencia', 'contenido', 'si', now() - interval '10 minutes')
       RETURNING id, created_by`,
      [clinicId, id],
    );
    expect(seg.error).toBe("");
    expect(seg.filas[0].created_by).toBe(usuarios.admin);
    const dentista = await como(
      usuarios.dentist,
      `INSERT INTO public.security_incident_updates (clinic_id, incident_id, note) VALUES ($1, $2, 'No debería')`,
      [clinicId, id],
    );
    expect(dentista.error).not.toBe("");

    for (const quien of [usuarios.owner, null]) {
      const u1 = await como(
        quien,
        `UPDATE public.security_incidents SET title = 'Otro título' WHERE id = $1`,
        [id],
      );
      expect(u1.error).not.toBe("");
      const u2 = await como(
        quien,
        `UPDATE public.security_incident_updates SET note = 'Reescrito' WHERE id = $1`,
        [seg.filas[0].id],
      );
      expect(u2.error).not.toBe("");
      const d1 = await como(quien, `DELETE FROM public.security_incidents WHERE id = $1`, [id]);
      expect(d1.error).not.toBe("");
    }
    const servicio = await como(
      null,
      `DELETE FROM public.security_incident_updates WHERE id = $1`,
      [seg.filas[0].id],
    );
    expect(servicio.error).toMatch(/no se borra ni se edita/);
  });

  it("nada con fecha futura ni ocurrido después de detectado", async () => {
    const futura = await como(
      usuarios.owner,
      `INSERT INTO public.security_incidents (clinic_id, detected_at, title, description, responsible_name)
       VALUES ($1, now() + interval '2 days', 'Futuro', 'Una detección en el futuro', 'Ana')`,
      [clinicId],
    );
    expect(futura.error).toMatch(/futura/);
    const alReves = await como(
      usuarios.owner,
      `INSERT INTO public.security_incidents (clinic_id, detected_at, occurred_at, title, description, responsible_name)
       VALUES ($1, now() - interval '2 days', now() - interval '1 day', 'Al revés', 'Ocurrió después de detectarse', 'Ana')`,
      [clinicId],
    );
    expect(alReves.error).toMatch(/revisa las fechas/);
    const categoria = await como(
      usuarios.owner,
      `INSERT INTO public.security_incidents (clinic_id, detected_at, title, description, responsible_name, data_categories)
       VALUES ($1, now(), 'Categoría', 'Una categoría que no existe', 'Ana', '{inventada}')`,
      [clinicId],
    );
    expect(categoria.error).not.toBe("");
  });

  it("borrar la clínica entera sí arrastra su registro", async () => {
    await registrar(usuarios.owner);
    await client.query(`DELETE FROM public.clinics WHERE id = $1`, [clinicId]);
    const r = await client.query(`SELECT 1 FROM public.security_incidents WHERE clinic_id = $1`, [
      clinicId,
    ]);
    expect(r.rowCount).toBe(0);
  });
});
