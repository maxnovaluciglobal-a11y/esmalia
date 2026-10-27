import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { TABLA_NOTAS, conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 9 · Frente C (migraciones 20261030300000 y 20261030300100), contra la
 * base efímera:
 *
 * - Catálogo de trabajos por laboratorio (LAB-07): lo ve la clínica, lo
 *   configuran owner y admin, otra clínica no ve nada, no se borra, la
 *   moneda sale de la clínica y no puede colgar de un laboratorio ajeno.
 * - Detalle técnico de la orden (LAB-03/04/05): CHECKs de guía, color,
 *   material y margen; una orden no cita un trabajo del catálogo de otra
 *   clínica.
 * - Portal del laboratorio (LAB-06): `portal_laboratorio_ordenes` devuelve
 *   solo las órdenes de ese laboratorio en esa clínica y calcula el atraso
 *   con la zona de la clínica; nadie más que service_role la ejecuta.
 * - Ortodoncia (ORT-02 a ORT-05): CHECKs de alineadores y etapas con
 *   historial que solo crece, aisladas por clínica.
 *
 * La conexión es `postgres` (salta la RLS): para probarla se asume
 * `authenticated` con la identidad de cada persona, igual que PostgREST.
 */

describe("laboratorio y ortodoncia (Ola 9 · C), en la base", () => {
  let client: Client;
  let clinicA: string;
  let clinicB: string;
  let usuariosA: Record<string, string>;
  let usuariosB: Record<string, string>;
  let pacienteA: string;
  let pacienteB: string;

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
      await client.query("RESET ROLE");
      return { filas: [], error: (e as Error).message };
    }
  }

  async function fallo(sql: string, params: unknown[] = []): Promise<string> {
    await client.query("SAVEPOINT sp_f");
    try {
      await client.query(sql, params);
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_f");
      return (e as Error).message;
    }
    await client.query("RELEASE SAVEPOINT sp_f");
    throw new Error("Se esperaba un error y la operación fue aceptada.");
  }

  async function crearPaciente(clinicId: string, owner: string, nombre: string) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [clinicId, nombre, owner],
    );
    return r.rows[0].id;
  }

  async function crearLab(clinicId: string, owner: string, nombre: string) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.labs (clinic_id, name, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [clinicId, nombre, owner],
    );
    return r.rows[0].id;
  }

  async function crearOrden(
    clinicId: string,
    owner: string,
    labId: string,
    patientId: string,
    extra: { due?: string | null; status?: string; descripcion?: string } = {},
  ) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.lab_orders
         (clinic_id, lab_id, patient_id, description, status, sent_on, due_on, cost_cents, created_by)
       VALUES ($1, $2, $3, $4, $5::public.lab_order_status, '2026-10-20', $6, 90000, $7)
       RETURNING id`,
      [
        clinicId,
        labId,
        patientId,
        extra.descripcion ?? "Corona",
        extra.status ?? "enviado",
        extra.due === undefined ? "2026-10-27" : extra.due,
        owner,
      ],
    );
    return r.rows[0].id;
  }

  beforeAll(async () => {
    client = await conectar();
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    const a = await sembrarEscenario(client);
    // sembrarEscenario crea una tabla temporal de notas que acá no se usa:
    // se descarta para poder sembrar la segunda clínica.
    await client.query(`DROP TABLE ${TABLA_NOTAS}`);
    const b = await sembrarEscenario(client);
    clinicA = a.clinicId;
    clinicB = b.clinicId;
    usuariosA = a.usuarios;
    usuariosB = b.usuarios;
    await client.query(
      `UPDATE public.clinics SET timezone = 'America/Santiago', currency = 'CLP' WHERE id = $1`,
      [clinicA],
    );
    await client.query(
      `UPDATE public.clinics SET timezone = 'America/Mexico_City', currency = 'MXN' WHERE id = $1`,
      [clinicB],
    );
    pacienteA = await crearPaciente(clinicA, usuariosA.owner, "Ana Pérez");
    pacienteB = await crearPaciente(clinicB, usuariosB.owner, "Beto Ruiz");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  // ─── LAB-07 · catálogo ────────────────────────────────────────────────

  describe("catálogo de trabajos por laboratorio", () => {
    it("owner y admin lo configuran; dentist, reception y otra clínica no", async () => {
      const lab = await crearLab(clinicA, usuariosA.owner, "Lab Sur");
      const insertar = (userId: string, nombre: string) =>
        como<{ id: string; currency: string }>(
          userId,
          `INSERT INTO public.lab_catalog_items (clinic_id, lab_id, name, cost_cents, typical_days, currency)
           VALUES ($1, $2, $3, 120000, 7, 'USD') RETURNING id, currency`,
          [clinicA, lab, nombre],
        );

      const owner = await insertar(usuariosA.owner, "Corona zirconia");
      expect(owner.error).toBe("");
      // La moneda la fija la clínica, no el cliente (regla 14).
      expect(owner.filas[0].currency).toBe("CLP");
      expect((await insertar(usuariosA.admin, "Carilla disilicato")).error).toBe("");
      expect((await insertar(usuariosA.dentist, "Incrustación")).error).toMatch(/row-level/);
      expect((await insertar(usuariosA.reception, "Provisorio")).error).toMatch(/row-level/);
      expect((await insertar(usuariosB.owner, "Intruso")).error).toMatch(/row-level/);
    });

    it("lo ve todo el equipo de la clínica y nadie de otra", async () => {
      const lab = await crearLab(clinicA, usuariosA.owner, "Lab Sur");
      await client.query(
        `INSERT INTO public.lab_catalog_items (clinic_id, lab_id, name, currency) VALUES ($1, $2, 'Corona', 'CLP')`,
        [clinicA, lab],
      );
      const ver = (u: string) =>
        como<{ name: string }>(u, `SELECT name FROM public.lab_catalog_items WHERE lab_id = $1`, [
          lab,
        ]);
      for (const rol of ["owner", "dentist", "assistant", "reception", "accounting"]) {
        expect((await ver(usuariosA[rol])).filas).toHaveLength(1);
      }
      expect((await ver(usuariosB.owner)).filas).toHaveLength(0);
      expect((await ver(usuariosA.externo)).filas).toHaveLength(0);
    });

    it("no se borra desde la app: se desactiva", async () => {
      const lab = await crearLab(clinicA, usuariosA.owner, "Lab Sur");
      const r = await client.query<{ id: string }>(
        `INSERT INTO public.lab_catalog_items (clinic_id, lab_id, name, currency) VALUES ($1, $2, 'Corona', 'CLP') RETURNING id`,
        [clinicA, lab],
      );
      const borrar = await como(
        usuariosA.owner,
        `DELETE FROM public.lab_catalog_items WHERE id = $1`,
        [r.rows[0].id],
      );
      expect(borrar.error).toMatch(/permission denied/);
      const desactivar = await como<{ is_active: boolean }>(
        usuariosA.admin,
        `UPDATE public.lab_catalog_items SET is_active = false WHERE id = $1 RETURNING is_active`,
        [r.rows[0].id],
      );
      expect(desactivar.filas[0].is_active).toBe(false);
    });

    it("no puede colgar de un laboratorio de otra clínica", async () => {
      const labB = await crearLab(clinicB, usuariosB.owner, "Lab Norte");
      const err = await fallo(
        `INSERT INTO public.lab_catalog_items (clinic_id, lab_id, name, currency) VALUES ($1, $2, 'Corona', 'CLP')`,
        [clinicA, labB],
      );
      expect(err).toMatch(/lab_catalog_items_lab_fk/);
    });

    it("rechaza plazo, costo o material fuera de rango", async () => {
      const lab = await crearLab(clinicA, usuariosA.owner, "Lab Sur");
      for (const [col, val] of [
        ["typical_days", -1],
        ["cost_cents", -5],
        ["material", "oro"],
      ] as const) {
        const err = await fallo(
          `INSERT INTO public.lab_catalog_items (clinic_id, lab_id, name, currency, ${col}) VALUES ($1, $2, 'X', 'CLP', $3)`,
          [clinicA, lab, val],
        );
        expect(err).toMatch(/check/i);
      }
    });
  });

  // ─── LAB-03/04/05 · detalle de la orden ────────────────────────────────

  describe("detalle técnico de la orden", () => {
    it("guarda color, material y margen válidos", async () => {
      const lab = await crearLab(clinicA, usuariosA.owner, "Lab Sur");
      const orden = await crearOrden(clinicA, usuariosA.owner, lab, pacienteA);
      const r = await como<{ shade: string }>(
        usuariosA.dentist,
        `UPDATE public.lab_orders
            SET shade_guide = 'vita_3d_master', shade = '2M2', material = 'zirconia', margin_type = 'chaflan'
          WHERE id = $1 RETURNING shade`,
        [orden],
      );
      expect(r.error).toBe("");
      expect(r.filas[0].shade).toBe("2M2");
    });

    it("rechaza un color sin guía, una guía, material o margen inventados", async () => {
      const lab = await crearLab(clinicA, usuariosA.owner, "Lab Sur");
      const orden = await crearOrden(clinicA, usuariosA.owner, lab, pacienteA);
      for (const set of [
        "shade = 'A2'",
        "shade_guide = 'chromascop'",
        "material = 'oro'",
        "margin_type = 'escalon'",
      ]) {
        const err = await fallo(`UPDATE public.lab_orders SET ${set} WHERE id = $1`, [orden]);
        expect(err).toMatch(/check/i);
      }
    });

    it("una orden no puede citar un trabajo del catálogo de otra clínica", async () => {
      const labA = await crearLab(clinicA, usuariosA.owner, "Lab Sur");
      const labB = await crearLab(clinicB, usuariosB.owner, "Lab Norte");
      const itemB = await client.query<{ id: string }>(
        `INSERT INTO public.lab_catalog_items (clinic_id, lab_id, name, currency) VALUES ($1, $2, 'Corona', 'MXN') RETURNING id`,
        [clinicB, labB],
      );
      const orden = await crearOrden(clinicA, usuariosA.owner, labA, pacienteA);
      const err = await fallo(`UPDATE public.lab_orders SET catalog_item_id = $1 WHERE id = $2`, [
        itemB.rows[0].id,
        orden,
      ]);
      expect(err).toMatch(/catálogo de esta clínica/);

      const itemA = await client.query<{ id: string }>(
        `INSERT INTO public.lab_catalog_items (clinic_id, lab_id, name, currency) VALUES ($1, $2, 'Corona', 'CLP') RETURNING id`,
        [clinicA, labA],
      );
      await client.query(`UPDATE public.lab_orders SET catalog_item_id = $1 WHERE id = $2`, [
        itemA.rows[0].id,
        orden,
      ]);
    });
  });

  // ─── LAB-06 · portal del laboratorio ──────────────────────────────────

  describe("portal del laboratorio", () => {
    it("devuelve solo las órdenes de ese laboratorio en esa clínica, sin costo", async () => {
      const labA1 = await crearLab(clinicA, usuariosA.owner, "Lab Sur");
      const labA2 = await crearLab(clinicA, usuariosA.owner, "Lab Centro");
      const labB = await crearLab(clinicB, usuariosB.owner, "Lab Norte");
      const propia = await crearOrden(clinicA, usuariosA.owner, labA1, pacienteA, {
        descripcion: "Corona propia",
      });
      await crearOrden(clinicA, usuariosA.owner, labA2, pacienteA, { descripcion: "De otro lab" });
      await crearOrden(clinicB, usuariosB.owner, labB, pacienteB, {
        descripcion: "De otra clínica",
      });

      const r = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.portal_laboratorio_ordenes($1, $2)`,
        [clinicA, labA1],
      );
      expect(r.rows.map((f) => f.id)).toEqual([propia]);
      expect(r.rows[0].patient_name).toBe("Ana Pérez");
      expect(Object.keys(r.rows[0])).not.toContain("cost_cents");

      // El laboratorio de la clínica B con el id de la clínica A no ve nada.
      const cruzado = await client.query(
        `SELECT * FROM public.portal_laboratorio_ordenes($1, $2)`,
        [clinicA, labB],
      );
      expect(cruzado.rows).toHaveLength(0);
    });

    it("calcula el atraso con el hoy de la clínica, no con el día UTC", async () => {
      const lab = await crearLab(clinicA, usuariosA.owner, "Lab Sur");
      await crearOrden(clinicA, usuariosA.owner, lab, pacienteA, { due: "2026-10-27" });
      const atraso = async (ahora: string) => {
        const r = await client.query<{ dias_atraso: number | null; hoy_clinica: string }>(
          `SELECT dias_atraso, hoy_clinica::text FROM public.portal_laboratorio_ordenes($1, $2, $3)`,
          [clinicA, lab, ahora],
        );
        return r.rows[0];
      };
      // 28-oct 02:00 UTC = 27-oct 23:00 en Santiago (UTC-3): vence hoy, no está atrasada.
      expect(await atraso("2026-10-28T02:00:00Z")).toEqual({
        dias_atraso: null,
        hoy_clinica: "2026-10-27",
      });
      // 28-oct 04:00 UTC = 28-oct 01:00 en Santiago: un día tarde.
      expect(await atraso("2026-10-28T04:00:00Z")).toEqual({
        dias_atraso: 1,
        hoy_clinica: "2026-10-28",
      });
    });

    it("lo recibido, lo cancelado y lo que no tiene plazo no está atrasado", async () => {
      const lab = await crearLab(clinicA, usuariosA.owner, "Lab Sur");
      await crearOrden(clinicA, usuariosA.owner, lab, pacienteA, { status: "recibido" });
      await crearOrden(clinicA, usuariosA.owner, lab, pacienteA, { status: "cancelado" });
      await crearOrden(clinicA, usuariosA.owner, lab, pacienteA, { due: null });
      await crearOrden(clinicA, usuariosA.owner, lab, pacienteA, { status: "reprocesar" });
      const r = await client.query<{ status: string; dias_atraso: number | null }>(
        `SELECT status::text, dias_atraso FROM public.portal_laboratorio_ordenes($1, $2, '2026-11-05T15:00:00Z')`,
        [clinicA, lab],
      );
      const atrasadas = r.rows.filter((f) => f.dias_atraso !== null);
      expect(atrasadas).toEqual([{ status: "reprocesar", dias_atraso: 9 }]);
    });

    it("solo service_role puede ejecutarla", async () => {
      for (const rol of ["anon", "authenticated"]) {
        const r = await client.query<{ ok: boolean }>(
          `SELECT has_function_privilege($1, 'public.portal_laboratorio_ordenes(uuid, uuid, timestamptz)', 'execute') AS ok`,
          [rol],
        );
        expect(r.rows[0].ok).toBe(false);
      }
      const sr = await client.query<{ ok: boolean }>(
        `SELECT has_function_privilege('service_role', 'public.portal_laboratorio_ordenes(uuid, uuid, timestamptz)', 'execute') AS ok`,
      );
      expect(sr.rows[0].ok).toBe(true);
    });
  });

  // ─── ORT-02 a ORT-05 ───────────────────────────────────────────────────

  describe("ortodoncia: sistema, alineadores y etapas", () => {
    async function crearCaso(clinicId: string, owner: string, patientId: string) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO public.ortho_cases (clinic_id, patient_id, kind, started_on, created_by, appliance_system, aligner_current, aligner_total, aligner_change_days, aligner_changed_on)
         VALUES ($1, $2, 'aligners', '2026-06-01', $3, 'alineadores', 1, 24, 14, '2026-06-01') RETURNING id`,
        [clinicId, patientId, owner],
      );
      return r.rows[0].id;
    }

    it("rechaza un alineador actual mayor que el total, un sistema o etapa inventados", async () => {
      const caso = await crearCaso(clinicA, usuariosA.owner, pacienteA);
      for (const set of [
        "aligner_current = 25",
        "aligner_change_days = 0",
        "appliance_system = 'invisible'",
      ]) {
        const err = await fallo(`UPDATE public.ortho_cases SET ${set} WHERE id = $1`, [caso]);
        expect(err).toMatch(/check/i);
      }
      const err = await fallo(
        `INSERT INTO public.ortho_stage_events (clinic_id, ortho_case_id, stage, started_on) VALUES ($1, $2, 'retencion', '2026-07-01')`,
        [clinicA, caso],
      );
      expect(err).toMatch(/check/i);
    });

    it("las etapas las registran los roles clínicos y no se editan ni se borran", async () => {
      const caso = await crearCaso(clinicA, usuariosA.owner, pacienteA);
      const registrar = (u: string, etapa: string) =>
        como<{ id: string; created_by: string }>(
          u,
          `INSERT INTO public.ortho_stage_events (clinic_id, ortho_case_id, stage, started_on)
           VALUES ($1, $2, $3, '2026-07-01') RETURNING id, created_by`,
          [clinicA, caso, etapa],
        );
      const dentist = await registrar(usuariosA.dentist, "alineacion");
      expect(dentist.error).toBe("");
      // Quién la registró lo pone la base.
      expect(dentist.filas[0].created_by).toBe(usuariosA.dentist);
      expect((await registrar(usuariosA.assistant, "nivelacion")).error).toBe("");
      expect((await registrar(usuariosA.reception, "nivelacion")).error).toMatch(/row-level/);
      expect((await registrar(usuariosB.owner, "nivelacion")).error).toMatch(/row-level/);

      const id = dentist.filas[0].id;
      const editar = await como(
        usuariosA.owner,
        `UPDATE public.ortho_stage_events SET stage = 'contencion' WHERE id = $1`,
        [id],
      );
      expect(editar.error).toMatch(/permission denied/);
      const borrar = await como(
        usuariosA.owner,
        `DELETE FROM public.ortho_stage_events WHERE id = $1`,
        [id],
      );
      expect(borrar.error).toMatch(/permission denied/);
    });

    it("otra clínica no ve las etapas ni puede colgarlas de un caso ajeno", async () => {
      const caso = await crearCaso(clinicA, usuariosA.owner, pacienteA);
      await client.query(
        `INSERT INTO public.ortho_stage_events (clinic_id, ortho_case_id, stage, started_on) VALUES ($1, $2, 'alineacion', '2026-06-01')`,
        [clinicA, caso],
      );
      const ver = (u: string) =>
        como(u, `SELECT id FROM public.ortho_stage_events WHERE ortho_case_id = $1`, [caso]);
      expect((await ver(usuariosA.reception)).filas).toHaveLength(1);
      expect((await ver(usuariosB.owner)).filas).toHaveLength(0);

      const err = await fallo(
        `INSERT INTO public.ortho_stage_events (clinic_id, ortho_case_id, stage, started_on) VALUES ($1, $2, 'alineacion', '2026-06-01')`,
        [clinicB, caso],
      );
      expect(err).toMatch(/ortho_stage_events_case_fk/);
    });
  });
});
