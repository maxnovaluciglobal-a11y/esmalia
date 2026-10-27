import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 12 · frente A (migraciones 20261108100000 y 20261108100100), contra la
 * base efímera de tests:
 *
 * - help_progress: cada persona lee, marca y desmarca solo lo suyo; nadie
 *   ve ni toca el avance de otro; anon no ve nada.
 * - feedback_reports: un miembro crea reportes de su clínica a su nombre;
 *   no puede crearlos para otra clínica ni a nombre de otro; nadie de la
 *   clínica los lee, cambia ni borra (ni quien lo escribió); el servicio
 *   (staff de Esmalia vía servidor) sí los lee. La demo no escribe.
 * - El bucket privado de capturas existe y no es público.
 */

describe("Ola 12 · ayuda (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let otraClinica: string;
  let usuarios: Record<string, string>;
  let otroOwner: string;

  async function como<T = Record<string, unknown>>(
    userId: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ filas: T[]; error: string; cuenta: number }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      userId
        ? JSON.stringify({ sub: userId, role: "authenticated" })
        : JSON.stringify({ role: "anon" }),
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query(userId ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE anon");
    try {
      const r = await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: r.rows as T[], error: "", cuenta: r.rowCount ?? 0 };
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: [], error: (e as Error).message, cuenta: 0 };
    }
  }

  async function servicio<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
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
    otroOwner = randomUUID();
    otraClinica = randomUUID();
    for (const id of [...Object.values(usuarios), otroOwner]) {
      await servicio(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [id]);
    }
    await servicio(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraClinica, otroOwner],
    );
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  describe("help_progress", () => {
    it("cada persona marca, lee y desmarca solo lo suyo", async () => {
      const r1 = await como(
        usuarios.reception,
        `INSERT INTO public.help_progress (kind, item_key) VALUES ('tour', 'agenda'), ('leccion', 'primer-dia')`,
      );
      expect(r1.error).toBe("");
      const propias = await como<{ kind: string; item_key: string; user_id: string }>(
        usuarios.reception,
        `SELECT kind, item_key, user_id FROM public.help_progress ORDER BY kind`,
      );
      expect(propias.filas.map((f) => `${f.kind}:${f.item_key}`)).toEqual([
        "leccion:primer-dia",
        "tour:agenda",
      ]);
      expect(propias.filas.every((f) => f.user_id === usuarios.reception)).toBe(true);

      const borrar = await como(
        usuarios.reception,
        `DELETE FROM public.help_progress WHERE kind = 'tour' AND item_key = 'agenda'`,
      );
      expect(borrar.cuenta).toBe(1);
    });

    it("nadie ve, marca ni borra el avance de otro (ni el dueño de su clínica)", async () => {
      await como(
        usuarios.reception,
        `INSERT INTO public.help_progress (kind, item_key) VALUES ('novedad', 'reserva-en-linea')`,
      );
      const ajeno = await como(usuarios.owner, `SELECT * FROM public.help_progress`);
      expect(ajeno.filas).toEqual([]);

      const aNombreDeOtro = await como(
        usuarios.owner,
        `INSERT INTO public.help_progress (user_id, kind, item_key) VALUES ($1, 'tour', 'caja')`,
        [usuarios.reception],
      );
      expect(aNombreDeOtro.error).toMatch(/row-level security/);

      const borrarAjeno = await como(usuarios.owner, `DELETE FROM public.help_progress`);
      expect(borrarAjeno.cuenta).toBe(0);
      const sigue = await servicio(`SELECT count(*)::int AS n FROM public.help_progress`);
      expect(sigue[0].n).toBe(1);
    });

    it("anon no lee el avance", async () => {
      await como(
        usuarios.dentist,
        `INSERT INTO public.help_progress (kind, item_key) VALUES ('tour', 'ficha')`,
      );
      const anon = await como(null, `SELECT * FROM public.help_progress`);
      expect(anon.filas.length === 0 || anon.error !== "").toBe(true);
    });

    it("rechaza tipos e ids fuera de formato", async () => {
      const malo = await como(
        usuarios.dentist,
        `INSERT INTO public.help_progress (kind, item_key) VALUES ('otro', 'x')`,
      );
      expect(malo.error).toMatch(/check/i);
      const id = await como(
        usuarios.dentist,
        `INSERT INTO public.help_progress (kind, item_key) VALUES ('tour', 'Con Espacios')`,
      );
      expect(id.error).toMatch(/check/i);
    });
  });

  describe("feedback_reports", () => {
    const insertar = (clinica: string, autor?: string) =>
      autor
        ? `INSERT INTO public.feedback_reports (clinic_id, created_by, kind, message)
           VALUES ('${clinica}', '${autor}', 'problema', 'Al cerrar la caja aparece un error')`
        : `INSERT INTO public.feedback_reports (clinic_id, kind, message)
           VALUES ('${clinica}', 'sugerencia', 'Me gustaría ver los cumpleaños')`;

    it("un miembro crea un reporte de su clínica a su nombre", async () => {
      const r = await como(usuarios.reception, insertar(clinicId));
      expect(r.error).toBe("");
      const filas = await servicio<{ created_by: string; status: string }>(
        `SELECT created_by, status FROM public.feedback_reports WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(filas).toEqual([{ created_by: usuarios.reception, status: "nuevo" }]);
    });

    it("no puede crear reportes para otra clínica ni a nombre de otro", async () => {
      const otra = await como(usuarios.owner, insertar(otraClinica));
      expect(otra.error).toMatch(/row-level security/);
      const suplantar = await como(usuarios.reception, insertar(clinicId, usuarios.owner));
      expect(suplantar.error).toMatch(/row-level security/);
      const externo = await como(usuarios.externo, insertar(clinicId));
      expect(externo.error).toMatch(/row-level security/);
    });

    it("nadie de la clínica lo lee, cambia ni borra; solo el servicio lo ve", async () => {
      await como(usuarios.reception, insertar(clinicId));
      for (const quien of [usuarios.reception, usuarios.owner, usuarios.admin]) {
        const leer = await como(quien, `SELECT * FROM public.feedback_reports`);
        expect(leer.filas.length === 0 || /permission denied/.test(leer.error)).toBe(true);
        const cambiar = await como(quien, `UPDATE public.feedback_reports SET status = 'resuelto'`);
        expect(cambiar.cuenta === 0 || /permission denied/.test(cambiar.error)).toBe(true);
        const borrar = await como(quien, `DELETE FROM public.feedback_reports`);
        expect(borrar.cuenta === 0 || /permission denied/.test(borrar.error)).toBe(true);
      }
      const staff = await servicio(`SELECT status FROM public.feedback_reports`);
      expect(staff).toEqual([{ status: "nuevo" }]);
    });

    it("no se puede crear ya resuelto", async () => {
      const r = await como(
        usuarios.reception,
        `INSERT INTO public.feedback_reports (clinic_id, kind, message, status)
         VALUES ('${clinicId}', 'problema', 'Mensaje de prueba', 'resuelto')`,
      );
      expect(r.error).toMatch(/row-level security/);
    });

    it("la demo no escribe reportes", async () => {
      await servicio(`UPDATE public.clinics SET is_demo = true WHERE id = $1`, [clinicId]);
      const r = await como(usuarios.reception, insertar(clinicId));
      expect(r.error).not.toBe("");
    });

    it("el bucket de capturas existe y es privado", async () => {
      const b = await servicio<{ public: boolean }>(
        `SELECT public FROM storage.buckets WHERE id = 'reportes-de-ayuda'`,
      );
      expect(b).toEqual([{ public: false }]);
    });
  });
});
