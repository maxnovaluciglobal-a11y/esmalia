import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";
import { SLUGS_ESPECIALIDAD } from "../src/lib/arancel/especialidades";

/**
 * Ola 3 · Frente Arancel, contra la base efímera (migraciones 20261024100000,
 * 20261024100100 y 20261024100200):
 *
 * - ADM-02: siembra idempotente de especialidades, que reconoce las que ya
 *   tenía la clínica (onboarding) en vez de duplicarlas, y ubica las
 *   prestaciones por su categoría. Una prestación no puede colgar de una
 *   especialidad de otra clínica.
 * - ADM-04: `realinear_precios` aplica todo o nada, rechaza una vista previa
 *   vieja, solo la usa quien administra la clínica y deja registro a su
 *   nombre, que no se puede editar ni borrar.
 * - MKT-03: el CHECK de `payments` exige que bono y copago cuadren.
 *
 * La conexión es `postgres` (salta la RLS): para probarla se asume el rol
 * `authenticated` con la identidad de cada persona, igual que PostgREST.
 */

describe("arancel de la Ola 3", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;

  async function como<T>(
    userId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ filas: T[]; error: string; filasAfectadas: number }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query("SET LOCAL ROLE authenticated");
    try {
      const r = await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: r.rows as T[], error: "", filasAfectadas: r.rowCount ?? 0 };
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_rls");
      return { filas: [], error: (e as Error).message, filasAfectadas: 0 };
    }
  }

  async function prestacion(nombre: string, precio: number, categoria: string | null = null) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.procedures (clinic_id, name, category, default_price_cents, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [clinicId, nombre, categoria, precio, usuarios.owner],
    );
    return r.rows[0].id;
  }

  async function precioDe(id: string) {
    const r = await client.query<{ p: string }>(
      `SELECT default_price_cents AS p FROM public.procedures WHERE id = $1`,
      [id],
    );
    return Number(r.rows[0].p);
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
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  describe("especialidades (ADM-02)", () => {
    it("siembra las doce estándar una sola vez, sin duplicar las del onboarding", async () => {
      // Lo que crea el onboarding: nombres sueltos, sin slug.
      await client.query(
        `INSERT INTO public.specialties (clinic_id, name) VALUES ($1, 'Endodoncia'), ($1, 'Cirugía maxilofacial')`,
        [clinicId],
      );
      const protesis = await prestacion("Corona", 250_000, "Prótesis");
      const sinCat = await prestacion("Algo", 1_000, "Categoría propia");

      const primera = await como<{ n: number }>(
        usuarios.reception,
        `SELECT public.asegurar_especialidades($1) AS n`,
        [clinicId],
      );
      expect(primera.error).toBe("");
      expect(primera.filas[0].n).toBeGreaterThan(0);

      const r = await client.query<{ slug: string; name: string }>(
        `SELECT slug, name FROM public.specialties WHERE clinic_id = $1 AND slug IS NOT NULL ORDER BY position`,
        [clinicId],
      );
      expect(r.rows.map((x) => x.slug).sort()).toEqual([...SLUGS_ESPECIALIDAD].sort());
      // Reconoció las que ya existían en vez de crear otras.
      expect(r.rows.find((x) => x.slug === "endodoncia")?.name).toBe("Endodoncia");
      expect(r.rows.find((x) => x.slug === "cirugia")?.name).toBe("Cirugía maxilofacial");
      const total = await client.query(
        `SELECT count(*)::int AS n FROM public.specialties WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(total.rows[0].n).toBe(12);

      // La categoría "Prótesis" cae en Rehabilitación oral; una propia, en ninguna.
      const ubicadas = await client.query<{ id: string; slug: string | null }>(
        `SELECT p.id, s.slug FROM public.procedures p
           LEFT JOIN public.specialties s ON s.id = p.specialty_id
          WHERE p.id = ANY($1::uuid[])`,
        [[protesis, sinCat]],
      );
      expect(ubicadas.rows.find((x) => x.id === protesis)?.slug).toBe("rehabilitacion");
      expect(ubicadas.rows.find((x) => x.id === sinCat)?.slug).toBeNull();

      // Idempotente.
      const segunda = await como<{ n: number }>(
        usuarios.owner,
        `SELECT public.asegurar_especialidades($1) AS n`,
        [clinicId],
      );
      expect(segunda.filas[0].n).toBe(0);
    });

    it("no ubica de nuevo una prestación que la clínica dejó sin especialidad", async () => {
      await como(usuarios.owner, `SELECT public.asegurar_especialidades($1)`, [clinicId]);
      const id = await prestacion("Control", 20_000, "Prevención");
      await como(usuarios.owner, `SELECT public.asegurar_especialidades($1)`, [clinicId]);
      const r = await client.query(`SELECT specialty_id FROM public.procedures WHERE id = $1`, [
        id,
      ]);
      expect(r.rows[0].specialty_id).toBeNull();
    });

    it("alguien de afuera no puede sembrar, y anon no puede llamarla", async () => {
      const r = await como(usuarios.externo, `SELECT public.asegurar_especialidades($1)`, [
        clinicId,
      ]);
      expect(r.error).toMatch(/permisos/);
      const anon = await client.query<{ ok: boolean }>(
        `SELECT has_function_privilege('anon', 'public.asegurar_especialidades(uuid)', 'execute') AS ok,
                has_function_privilege('authenticated', 'public.sembrar_especialidades(uuid)', 'execute') AS interna`,
      );
      expect(anon.rows[0].ok).toBe(false);
      expect((anon.rows[0] as unknown as { interna: boolean }).interna).toBe(false);
    });

    it("una prestación no puede colgar de una especialidad de otra clínica", async () => {
      const otra = randomUUID();
      await client.query(
        `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra', $2)`,
        [otra, randomUUID()],
      );
      const ajena = await client.query<{ id: string }>(
        `INSERT INTO public.specialties (clinic_id, name) VALUES ($1, 'Ajena') RETURNING id`,
        [otra],
      );
      const id = await prestacion("Resina", 40_000);
      const r = await como(
        usuarios.owner,
        `UPDATE public.procedures SET specialty_id = $1 WHERE id = $2`,
        [ajena.rows[0].id, id],
      );
      expect(r.error).toMatch(/no pertenece a esta clínica/);
    });
  });

  describe("realinear precios (ADM-04)", () => {
    it("aplica todo junto y deja registro a nombre de quien lo hizo", async () => {
      const a = await prestacion("Resina", 45_000);
      const b = await prestacion("Endodoncia", 210_000);
      const r = await como<{ id: string }>(
        usuarios.admin,
        `SELECT public.realinear_precios($1, 'percent', 10, NULL, 100, 'Todo el arancel', $2::jsonb) AS id`,
        [
          clinicId,
          JSON.stringify([
            { procedure_id: a, old_cents: 45_000, new_cents: 49_500 },
            { procedure_id: b, old_cents: 210_000, new_cents: 231_000 },
          ]),
        ],
      );
      expect(r.error).toBe("");
      expect(await precioDe(a)).toBe(49_500);
      expect(await precioDe(b)).toBe(231_000);

      const log = await client.query(
        `SELECT created_by, mode, percent::float AS percent, affected_count, currency, items
           FROM public.procedure_price_realignments WHERE id = $1`,
        [r.filas[0].id],
      );
      expect(log.rows[0]).toMatchObject({
        created_by: usuarios.admin,
        mode: "percent",
        percent: 10,
        affected_count: 2,
        currency: "CLP",
      });
      expect(log.rows[0].items[0]).toMatchObject({ name: "Resina", old_cents: 45_000 });
    });

    it("si un precio cambió desde la vista previa, no cambia ninguno", async () => {
      const a = await prestacion("Resina", 45_000);
      const b = await prestacion("Endodoncia", 210_000);
      const r = await como(
        usuarios.owner,
        `SELECT public.realinear_precios($1, 'amount', NULL, 1000, NULL, 'Elegidas', $2::jsonb)`,
        [
          clinicId,
          JSON.stringify([
            { procedure_id: a, old_cents: 45_000, new_cents: 46_000 },
            { procedure_id: b, old_cents: 999, new_cents: 1_999 },
          ]),
        ],
      );
      expect(r.error).toMatch(/cambió mientras revisabas/);
      expect(await precioDe(a)).toBe(45_000);
      const n = await client.query(
        `SELECT count(*)::int AS n FROM public.procedure_price_realignments WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(n.rows[0].n).toBe(0);
    });

    it("recepción y odontología no pueden realinear", async () => {
      const a = await prestacion("Resina", 45_000);
      for (const rol of ["reception", "dentist", "accounting", "assistant"]) {
        const r = await como(
          usuarios[rol],
          `SELECT public.realinear_precios($1, 'percent', 5, NULL, NULL, 'x', $2::jsonb)`,
          [clinicId, JSON.stringify([{ procedure_id: a, old_cents: 45_000, new_cents: 47_250 }])],
        );
        expect(r.error, rol).toMatch(/permisos/);
      }
      expect(await precioDe(a)).toBe(45_000);
    });

    it("el historial no se edita ni se borra, y otra clínica no lo ve", async () => {
      const a = await prestacion("Resina", 45_000);
      const r = await como<{ id: string }>(
        usuarios.owner,
        `SELECT public.realinear_precios($1, 'percent', 5, NULL, NULL, 'x', $2::jsonb) AS id`,
        [clinicId, JSON.stringify([{ procedure_id: a, old_cents: 45_000, new_cents: 47_250 }])],
      );
      const id = r.filas[0].id;
      const upd = await como(
        usuarios.owner,
        `UPDATE public.procedure_price_realignments SET scope_label = 'otro' WHERE id = $1`,
        [id],
      );
      expect(upd.error !== "" || upd.filasAfectadas === 0).toBe(true);
      const del = await como(
        usuarios.owner,
        `DELETE FROM public.procedure_price_realignments WHERE id = $1`,
        [id],
      );
      expect(del.error !== "" || del.filasAfectadas === 0).toBe(true);

      const lecturaPropia = await como(
        usuarios.reception,
        `SELECT id FROM public.procedure_price_realignments WHERE id = $1`,
        [id],
      );
      expect(lecturaPropia.filas).toHaveLength(1);
      const ajena = await como(
        usuarios.externo,
        `SELECT id FROM public.procedure_price_realignments WHERE id = $1`,
        [id],
      );
      expect(ajena.filas).toHaveLength(0);
    });

    it("nadie inserta en el historial a nombre de otro", async () => {
      const r = await como(
        usuarios.owner,
        `INSERT INTO public.procedure_price_realignments
           (clinic_id, created_by, mode, percent, scope_label, affected_count, items)
         VALUES ($1, $2, 'percent', 5, 'x', 1, '[]'::jsonb)`,
        [clinicId, usuarios.admin],
      );
      expect(r.error).not.toBe("");
    });
  });

  describe("bono y copago en payments (MKT-03)", () => {
    async function paciente() {
      const r = await client.query<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Paciente', $2) RETURNING id`,
        [clinicId, usuarios.owner],
      );
      return r.rows[0].id;
    }

    it("bono + copago que cuadran entran; un desglose que no cuadra se rechaza", async () => {
      const pac = await paciente();
      const grupo = randomUUID();
      const ok = await como(
        usuarios.reception,
        `INSERT INTO public.payments
           (clinic_id, patient_id, amount_cents, method, coverage_group_id, coverage_kind,
            coverage_role, voucher_number, coverage_price_cents, voucher_cents, created_by)
         VALUES ($1, $2, 12350, 'other', $3, 'fonasa_mle', 'bono', '123', 45000, 12350, $4),
                ($1, $2, 32650, 'cash',  $3, 'fonasa_mle', 'copago', '123', 45000, 12350, $4)`,
        [clinicId, pac, grupo, usuarios.reception],
      );
      expect(ok.error).toBe("");

      const malo = await como(
        usuarios.reception,
        `INSERT INTO public.payments
           (clinic_id, patient_id, amount_cents, method, coverage_group_id, coverage_kind,
            coverage_role, voucher_number, coverage_price_cents, voucher_cents, created_by)
         VALUES ($1, $2, 30000, 'cash', $3, 'isapre', 'copago', '9', 45000, 12350, $4)`,
        [clinicId, pac, randomUUID(), usuarios.reception],
      );
      expect(malo.error).toMatch(/payments_bono_coherente/);
    });

    it("un pago normal (sin bono) sigue igual", async () => {
      const pac = await paciente();
      const r = await como(
        usuarios.reception,
        `INSERT INTO public.payments (clinic_id, patient_id, amount_cents, method, created_by)
         VALUES ($1, $2, 5000, 'cash', $3)`,
        [clinicId, pac, usuarios.reception],
      );
      expect(r.error).toBe("");
    });
  });
});
