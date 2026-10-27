import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 8 · frente A (migraciones 20261105100000 y 20261105100100), contra la
 * base efímera (SQL directo con `SET LOCAL ROLE authenticated` y el `sub`
 * del JWT, como llega por PostgREST):
 *
 * - PAC-07 etiquetas y PAC-06 segmentos: aislamiento entre clínicas, quién
 *   crea, asigna y borra; una etiqueta de otra clínica no se puede asignar.
 * - PAC-08 valor histórico: solo owner/admin/accounting (finance:view); a
 *   dentist, reception, assistant y a otra clínica la función les falla.
 * - PAC-15 archivar nunca borra: la ficha sigue ahí con fecha, actor y
 *   motivo; nadie la borra con su JWT; el motivo no se reescribe y se va al
 *   restaurar; el archivo masivo cuenta solo las que archivó.
 */

describe("Ola 8 · pacientes (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let otraClinica: string;
  let usuarios: Record<string, string>;
  let otroOwner: string;
  let pacienteA: string;
  let pacienteB: string;
  let pacienteOtra: string;

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

    otraClinica = randomUUID();
    otroOwner = randomUUID();
    await servicio(`INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra', $2)`, [
      otraClinica,
      otroOwner,
    ]);
    await servicio(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES ($1, $2, 'owner')
       ON CONFLICT DO NOTHING`,
      [otraClinica, otroOwner],
    );
    const p = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by)
       VALUES ($1, 'Ana Pérez', $2), ($1, 'Beto Rojas', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    pacienteA = p[0].id;
    pacienteB = p[1].id;
    const p2 = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by)
       VALUES ($1, 'Otro Paciente', $2) RETURNING id`,
      [otraClinica, otroOwner],
    );
    pacienteOtra = p2[0].id;
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function crearEtiqueta(userId: string, nombre = "VIP", clinica = clinicId) {
    return como<{ id: string }>(
      userId,
      `INSERT INTO public.patient_labels (clinic_id, name, color) VALUES ($1, $2, 'ocre') RETURNING id`,
      [clinica, nombre],
    );
  }

  // ── PAC-07 ────────────────────────────────────────────────────────────

  describe("PAC-07 etiquetas", () => {
    it("crean y asignan los roles con patients:manage; assistant y accounting no", async () => {
      for (const rol of ["owner", "admin", "dentist", "reception"]) {
        const r = await crearEtiqueta(usuarios[rol], `Etiqueta ${rol}`);
        expect(r.error, rol).toBe("");
      }
      for (const rol of ["assistant", "accounting"]) {
        const r = await crearEtiqueta(usuarios[rol], `Etiqueta ${rol}`);
        expect(r.error, rol).toMatch(/row-level security/);
      }
      const etq = (await crearEtiqueta(usuarios.owner, "Orto")).filas[0].id;
      const asignar = (userId: string) =>
        como(
          userId,
          `INSERT INTO public.patient_label_assignments (clinic_id, patient_id, label_id)
           VALUES ($1, $2, $3) RETURNING created_by`,
          [clinicId, pacienteA, etq],
        );
      expect((await asignar(usuarios.assistant)).error).toMatch(/row-level security/);
      const ok = await asignar(usuarios.reception);
      expect(ok.error).toBe("");
      // El autor lo pone la base.
      expect(ok.filas[0]).toMatchObject({ created_by: usuarios.reception });
    });

    it("el nombre es único por clínica sin distinguir mayúsculas; otra clínica puede repetirlo", async () => {
      expect((await crearEtiqueta(usuarios.owner, "VIP")).error).toBe("");
      expect((await crearEtiqueta(usuarios.admin, " vip ")).error).toMatch(/duplicate key/);
      expect((await crearEtiqueta(otroOwner, "VIP", otraClinica)).error).toBe("");
    });

    it("aislamiento: otra clínica no ve ni toca las etiquetas, asignaciones ni segmentos", async () => {
      const etq = (await crearEtiqueta(usuarios.owner)).filas[0].id;
      await servicio(
        `INSERT INTO public.patient_label_assignments (clinic_id, patient_id, label_id) VALUES ($1, $2, $3)`,
        [clinicId, pacienteA, etq],
      );
      await servicio(
        `INSERT INTO public.patient_segments (clinic_id, name, filters) VALUES ($1, 'Con saldo', '{"conSaldo":true}')`,
        [clinicId],
      );
      for (const tabla of ["patient_labels", "patient_label_assignments", "patient_segments"]) {
        const r = await como(otroOwner, `SELECT * FROM public.${tabla} WHERE clinic_id = $1`, [
          clinicId,
        ]);
        expect(r.filas, tabla).toHaveLength(0);
        // Un usuario sin membresía tampoco.
        const ext = await como(usuarios.externo, `SELECT * FROM public.${tabla}`);
        expect(ext.filas, `${tabla} externo`).toHaveLength(0);
      }
      expect((await crearEtiqueta(otroOwner, "Intrusa")).error).toMatch(/row-level security/);
      const borrar = await como(
        otroOwner,
        `DELETE FROM public.patient_labels WHERE id = $1 RETURNING id`,
        [etq],
      );
      expect(borrar.filas).toHaveLength(0);
    });

    it("no se asigna una etiqueta de otra clínica ni a un paciente de otra clínica", async () => {
      const etqOtra = (await crearEtiqueta(otroOwner, "Ajena", otraClinica)).filas[0].id;
      const etq = (await crearEtiqueta(usuarios.owner)).filas[0].id;
      // Etiqueta de otra clínica con la clínica propia: la FK compuesta lo frena.
      const r1 = await como(
        usuarios.owner,
        `INSERT INTO public.patient_label_assignments (clinic_id, patient_id, label_id) VALUES ($1, $2, $3)`,
        [clinicId, pacienteA, etqOtra],
      );
      expect(r1.error).toMatch(/foreign key/);
      // Paciente de otra clínica con una etiqueta propia: el trigger lo frena.
      const r2 = await como(
        usuarios.owner,
        `INSERT INTO public.patient_label_assignments (clinic_id, patient_id, label_id) VALUES ($1, $2, $3)`,
        [clinicId, pacienteOtra, etq],
      );
      expect(r2.error).toMatch(/no es de esta clínica/);
    });

    it("borrar del catálogo: solo owner/admin, y se va de todas las fichas", async () => {
      const etq = (await crearEtiqueta(usuarios.reception)).filas[0].id;
      await servicio(
        `INSERT INTO public.patient_label_assignments (clinic_id, patient_id, label_id)
         VALUES ($1, $2, $3), ($1, $4, $3)`,
        [clinicId, pacienteA, etq, pacienteB],
      );
      const rec = await como(
        usuarios.reception,
        `DELETE FROM public.patient_labels WHERE id = $1 RETURNING id`,
        [etq],
      );
      expect(rec.filas).toHaveLength(0);
      const own = await como(
        usuarios.owner,
        `DELETE FROM public.patient_labels WHERE id = $1 RETURNING id`,
        [etq],
      );
      expect(own.filas).toHaveLength(1);
      const quedan = await servicio(
        `SELECT 1 FROM public.patient_label_assignments WHERE label_id = $1`,
        [etq],
      );
      expect(quedan).toHaveLength(0);
      // Las fichas siguen ahí.
      const fichas = await servicio(`SELECT id FROM public.patients WHERE id = ANY($1)`, [
        [pacienteA, pacienteB],
      ]);
      expect(fichas).toHaveLength(2);
    });

    it("el color sale de la paleta cerrada", async () => {
      const r = await como(
        usuarios.owner,
        `INSERT INTO public.patient_labels (clinic_id, name, color) VALUES ($1, 'Hex', '#ff0000')`,
        [clinicId],
      );
      expect(r.error).toMatch(/patient_labels_color_check/);
    });
  });

  // ── PAC-06 ────────────────────────────────────────────────────────────

  describe("PAC-06 segmentos", () => {
    const crearSegmento = (userId: string, nombre: string, filtros = '{"menores":true}') =>
      como<{ id: string; created_by: string }>(
        userId,
        `INSERT INTO public.patient_segments (clinic_id, name, filters) VALUES ($1, $2, $3::jsonb)
         RETURNING id, created_by`,
        [clinicId, nombre, filtros],
      );

    it("crean los roles con patients:manage; el autor lo pone la base", async () => {
      const r = await crearSegmento(usuarios.dentist, "Menores");
      expect(r.error).toBe("");
      expect(r.filas[0].created_by).toBe(usuarios.dentist);
      expect((await crearSegmento(usuarios.assistant, "No")).error).toMatch(/row-level security/);
      expect((await crearSegmento(usuarios.accounting, "No")).error).toMatch(/row-level security/);
    });

    it("los filtros son un objeto; el nombre, único por clínica", async () => {
      expect((await crearSegmento(usuarios.owner, "Lista", "[1,2]")).error).toMatch(
        /patient_segments_filters_check/,
      );
      expect((await crearSegmento(usuarios.owner, "Fonasa")).error).toBe("");
      expect((await crearSegmento(usuarios.admin, "fonasa")).error).toMatch(/duplicate key/);
    });

    it("borrar: el autor u owner/admin; otro rol no borra el segmento ajeno", async () => {
      const id = (await crearSegmento(usuarios.dentist, "Del dentista")).filas[0].id;
      const borrar = (userId: string) =>
        como(userId, `DELETE FROM public.patient_segments WHERE id = $1 RETURNING id`, [id]);
      expect((await borrar(usuarios.reception)).filas).toHaveLength(0);
      expect((await borrar(usuarios.dentist2)).filas).toHaveLength(0);
      expect((await borrar(usuarios.dentist)).filas).toHaveLength(1);
      const otro = (await crearSegmento(usuarios.reception, "De recepción")).filas[0].id;
      const own = await como(
        usuarios.admin,
        `DELETE FROM public.patient_segments WHERE id = $1 RETURNING id`,
        [otro],
      );
      expect(own.filas).toHaveLength(1);
    });
  });

  // ── PAC-08 ────────────────────────────────────────────────────────────

  describe("PAC-08 valor histórico", () => {
    beforeEach(async () => {
      await servicio(
        `INSERT INTO public.payments (clinic_id, patient_id, amount_cents, method, created_by)
         VALUES ($1, $2, 10000, 'cash', $3), ($1, $2, 2500, 'cash', $3), ($1, $4, 7000, 'cash', $3)`,
        [clinicId, pacienteA, usuarios.owner, pacienteB],
      );
      // Un pago reversado no suma.
      await servicio(
        `INSERT INTO public.payments (clinic_id, patient_id, amount_cents, method, created_by, reversed_at, reversed_by, reversal_reason)
         VALUES ($1, $2, 99999, 'cash', $3, now(), $3, 'Error de digitación')`,
        [clinicId, pacienteA, usuarios.owner],
      );
    });

    it("owner, admin y accounting ven el total pagado (sin reversados)", async () => {
      for (const rol of ["owner", "admin", "accounting"]) {
        const r = await como<{ patient_id: string; paid_cents: string; payments_count: number }>(
          usuarios[rol],
          `SELECT * FROM public.patient_lifetime_values($1) ORDER BY patient_id`,
          [clinicId],
        );
        expect(r.error, rol).toBe("");
        const porPaciente = Object.fromEntries(
          r.filas.map((f) => [f.patient_id, [Number(f.paid_cents), f.payments_count]]),
        );
        expect(porPaciente[pacienteA], rol).toEqual([12500, 2]);
        expect(porPaciente[pacienteB], rol).toEqual([7000, 1]);
      }
    });

    it("dentist, reception y assistant no lo ven (aunque la RLS de payments deje leer a algunos)", async () => {
      for (const rol of ["dentist", "reception", "assistant"]) {
        const r = await como(usuarios[rol], `SELECT * FROM public.patient_lifetime_values($1)`, [
          clinicId,
        ]);
        expect(r.error, rol).toMatch(/No tienes permisos/);
      }
    });

    it("otra clínica no ve el valor histórico ajeno", async () => {
      const r = await como(otroOwner, `SELECT * FROM public.patient_lifetime_values($1)`, [
        clinicId,
      ]);
      expect(r.error).toMatch(/No tienes permisos/);
    });

    it("anon no puede ejecutarla", async () => {
      const r = await client.query<{ puede: boolean }>(
        `SELECT has_function_privilege('anon', 'public.patient_lifetime_values(uuid, uuid[])', 'EXECUTE') AS puede`,
      );
      expect(r.rows[0].puede).toBe(false);
    });

    it("filtra por pacientes cuando se pide", async () => {
      const r = await como<{ patient_id: string }>(
        usuarios.owner,
        `SELECT patient_id FROM public.patient_lifetime_values($1, $2)`,
        [clinicId, [pacienteB]],
      );
      expect(r.filas.map((f) => f.patient_id)).toEqual([pacienteB]);
    });
  });

  // ── PAC-15 ────────────────────────────────────────────────────────────

  describe("PAC-15 archivar nunca borra", () => {
    it("archivar deja la ficha con fecha, actor y motivo; sigue existiendo", async () => {
      const r = await como<{ archived_at: string; archived_by: string; archive_reason: string }>(
        usuarios.owner,
        `UPDATE public.patients SET archived_at = now(), archive_reason = '  Ficha duplicada '
          WHERE id = $1 RETURNING archived_at, archived_by, archive_reason`,
        [pacienteA],
      );
      expect(r.error).toBe("");
      expect(r.filas[0].archived_by).toBe(usuarios.owner);
      expect(r.filas[0].archive_reason).toBe("Ficha duplicada");
      const sigue = await servicio(`SELECT id FROM public.patients WHERE id = $1`, [pacienteA]);
      expect(sigue).toHaveLength(1);
    });

    it("nadie borra una ficha con su JWT, ni siquiera el owner", async () => {
      for (const rol of ["owner", "admin", "reception"]) {
        const r = await como(usuarios[rol], `DELETE FROM public.patients WHERE id = $1`, [
          pacienteA,
        ]);
        expect(r.error, rol).toMatch(/permission denied/);
      }
      const sigue = await servicio(`SELECT id FROM public.patients WHERE id = $1`, [pacienteA]);
      expect(sigue).toHaveLength(1);
    });

    it("solo owner/admin archivan; recepción no", async () => {
      const r = await como(
        usuarios.reception,
        `UPDATE public.patients SET archived_at = now(), archive_reason = 'x x x' WHERE id = $1`,
        [pacienteA],
      );
      expect(r.error).toMatch(/Solo el propietario o un administrador/);
    });

    it("el motivo no se reescribe con la ficha archivada y se va al restaurar", async () => {
      await como(
        usuarios.owner,
        `UPDATE public.patients SET archived_at = now(), archive_reason = 'Falleció' WHERE id = $1`,
        [pacienteA],
      );
      const reescribir = await como<{ archive_reason: string }>(
        usuarios.admin,
        `UPDATE public.patients SET archive_reason = 'Otro motivo' WHERE id = $1 RETURNING archive_reason`,
        [pacienteA],
      );
      expect(reescribir.filas[0].archive_reason).toBe("Falleció");
      const restaurar = await como<{ archived_at: string | null; archive_reason: string | null }>(
        usuarios.owner,
        `UPDATE public.patients SET archived_at = null WHERE id = $1 RETURNING archived_at, archive_reason`,
        [pacienteA],
      );
      expect(restaurar.filas[0]).toEqual({ archived_at: null, archive_reason: null });
    });

    it("un motivo sin archivar no queda guardado", async () => {
      const r = await como<{ archive_reason: string | null }>(
        usuarios.reception,
        `UPDATE public.patients SET archive_reason = 'Colado' WHERE id = $1 RETURNING archive_reason`,
        [pacienteA],
      );
      expect(r.filas[0].archive_reason).toBeNull();
    });

    it("archivo masivo: cuenta solo las que archivó y no toca otra clínica", async () => {
      await como(
        usuarios.owner,
        `UPDATE public.patients SET archived_at = now(), archive_reason = 'Antes' WHERE id = $1`,
        [pacienteB],
      );
      const r = await como<{ id: string }>(
        usuarios.owner,
        `UPDATE public.patients SET archived_at = now(), archive_reason = 'Masivo'
          WHERE clinic_id = $1 AND id = ANY($2) AND archived_at IS NULL RETURNING id`,
        [clinicId, [pacienteA, pacienteB, pacienteOtra]],
      );
      expect(r.filas.map((f) => f.id)).toEqual([pacienteA]);
      const otra = await servicio<{ archived_at: string | null }>(
        `SELECT archived_at FROM public.patients WHERE id = $1`,
        [pacienteOtra],
      );
      expect(otra[0].archived_at).toBeNull();
      const b = await servicio<{ archive_reason: string }>(
        `SELECT archive_reason FROM public.patients WHERE id = $1`,
        [pacienteB],
      );
      expect(b[0].archive_reason).toBe("Antes");
    });
  });
});
