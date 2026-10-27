import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 9 · frente B (migraciones 20261030200000 a 20261030200300), contra la
 * base efímera de tests (SQL directo con `SET LOCAL ROLE authenticated` y el
 * `sub` del JWT, como llega por PostgREST):
 *
 * - FIC-11: una evolución restringida no la ven otro dentista, el asistente
 *   ni recepción (ni la nota, ni sus versiones, ni su bitácora); la ven su
 *   autor y owner/admin; solo ellos cambian la restricción; la bitácora la
 *   escribe la base (restringir y cada acceso); una adenda hereda la
 *   restricción; la ficha recibe solo el número de notas ocultas.
 * - FIC-14, FIC-15, MKT-09: aislamiento entre clínicas, permisos por rol,
 *   transiciones de la interconsulta, documento de otro paciente rechazado,
 *   búsqueda por lote sin distinguir mayúsculas y el control que cambia el
 *   estado del implante.
 */

describe("Ola 9 · ficha clínica (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let otraClinica: string;
  let usuarios: Record<string, string>;
  let otroOwner: string;
  let pacienteId: string;
  let pacienteOtraClinica: string;
  let noteId: string;
  let patientRef: string;

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
    noteId = esc.noteId;
    patientRef = esc.patientRef;

    otraClinica = randomUUID();
    otroOwner = randomUUID();
    await servicio(`INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra', $2)`, [
      otraClinica,
      otroOwner,
    ]);
    const p = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by)
       VALUES ($1, 'Ana Pérez', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    pacienteId = p[0].id;
    const p2 = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by)
       VALUES ($1, 'Otro Paciente', $2) RETURNING id`,
      [otraClinica, otroOwner],
    );
    pacienteOtraClinica = p2[0].id;

    // La nota sembrada (autor: dentist) con su versión y una entidad.
    await servicio(
      `INSERT INTO public.clinical_note_versions (note_id, clinic_id, version, title, content, author_id)
       VALUES ($1, $2, 1, 'Nota de prueba', 'Contenido inicial', $3)`,
      [noteId, clinicId, usuarios.dentist],
    );
    await servicio(
      `INSERT INTO public.clinical_note_entities (note_id, clinic_id, patient_ref, kind, term)
       VALUES ($1, $2, $3, 'diagnosis', 'Caries')`,
      [noteId, clinicId, patientRef],
    );
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  const veNota = async (userId: string) =>
    (await como(userId, `SELECT id FROM public.clinical_notes WHERE id = $1`, [noteId])).filas
      .length === 1;

  // ── FIC-11 ──────────────────────────────────────────────────────────────

  describe("FIC-11 evolución restringida", () => {
    async function restringirComoAutor() {
      const r = await como(
        usuarios.dentist,
        `UPDATE public.clinical_notes SET restricted = true WHERE id = $1 RETURNING restricted_by, restricted_at`,
        [noteId],
      );
      expect(r.error).toBe("");
      return r.filas[0] as { restricted_by: string; restricted_at: string };
    }

    it("sin restringir, todo el equipo clínico la ve (no cambia lo existente)", async () => {
      for (const rol of ["owner", "admin", "dentist", "dentist2", "assistant"]) {
        expect(await veNota(usuarios[rol]), rol).toBe(true);
      }
      expect(await veNota(usuarios.reception)).toBe(false);
    });

    it("restringida: la ven su autor y owner/admin; no otro dentista, ni el asistente, ni recepción", async () => {
      const marca = await restringirComoAutor();
      expect(marca.restricted_by).toBe(usuarios.dentist);
      expect(marca.restricted_at).toBeTruthy();

      expect(await veNota(usuarios.dentist)).toBe(true);
      expect(await veNota(usuarios.owner)).toBe(true);
      expect(await veNota(usuarios.admin)).toBe(true);
      expect(await veNota(usuarios.dentist2)).toBe(false);
      expect(await veNota(usuarios.assistant)).toBe(false);
      expect(await veNota(usuarios.reception)).toBe(false);
      expect(await veNota(usuarios.accounting)).toBe(false);
    });

    it("tampoco se filtra por versiones, entidades ni bitácora", async () => {
      await restringirComoAutor();
      for (const tabla of [
        "clinical_note_versions",
        "clinical_note_entities",
        "clinical_note_audit",
      ]) {
        const otro = await como(
          usuarios.dentist2,
          `SELECT 1 FROM public.${tabla} WHERE note_id = $1`,
          [noteId],
        );
        expect(otro.filas, tabla).toHaveLength(0);
        const autor = await como(
          usuarios.dentist,
          `SELECT 1 FROM public.${tabla} WHERE note_id = $1`,
          [noteId],
        );
        expect(autor.filas.length, tabla).toBeGreaterThan(0);
      }
    });

    it("otro dentista no puede restringir ni editar una nota ajena restringida", async () => {
      const intento = await como(
        usuarios.dentist2,
        `UPDATE public.clinical_notes SET restricted = true WHERE id = $1`,
        [noteId],
      );
      expect(intento.error).toMatch(/row-level security|quien escribió la nota/i);

      await restringirComoAutor();
      const editar = await como(
        usuarios.dentist2,
        `UPDATE public.clinical_notes SET restricted = false WHERE id = $1 RETURNING id`,
        [noteId],
      );
      // Invisible: el UPDATE no encuentra la fila.
      expect(editar.filas).toHaveLength(0);
      expect(await veNota(usuarios.dentist2)).toBe(false);
    });

    it("el owner puede quitar la restricción, y quién y cuándo los estampa la base", async () => {
      await restringirComoAutor();
      const falso = await como(
        usuarios.dentist,
        `UPDATE public.clinical_notes SET restricted_by = $2 WHERE id = $1 RETURNING restricted_by`,
        [noteId, usuarios.owner],
      );
      expect((falso.filas[0] as { restricted_by: string }).restricted_by).toBe(usuarios.dentist);

      const quitar = await como(
        usuarios.owner,
        `UPDATE public.clinical_notes SET restricted = false WHERE id = $1 RETURNING restricted_by`,
        [noteId],
      );
      expect(quitar.error).toBe("");
      expect((quitar.filas[0] as { restricted_by: string | null }).restricted_by).toBeNull();
      expect(await veNota(usuarios.dentist2)).toBe(true);
    });

    it("la bitácora la escribe la base: restringir, quitar y cada acceso (deduplicado)", async () => {
      await restringirComoAutor();
      const acceso = await como<{ n: number }>(
        usuarios.owner,
        `SELECT public.registrar_acceso_a_notas_restringidas($1, ARRAY[$2]::uuid[]) AS n`,
        [clinicId, noteId],
      );
      expect(acceso.error).toBe("");
      expect(acceso.filas[0].n).toBe(1);
      // Una segunda apertura dentro de 15 min no duplica.
      const otra = await como<{ n: number }>(
        usuarios.owner,
        `SELECT public.registrar_acceso_a_notas_restringidas($1, ARRAY[$2]::uuid[]) AS n`,
        [clinicId, noteId],
      );
      expect(otra.filas[0].n).toBe(0);
      // Quien no la ve no deja rastro (ni sabe que existe).
      const ajeno = await como<{ n: number }>(
        usuarios.dentist2,
        `SELECT public.registrar_acceso_a_notas_restringidas($1, ARRAY[$2]::uuid[]) AS n`,
        [clinicId, noteId],
      );
      expect(ajeno.filas[0].n).toBe(0);
      // Recepción no puede llamarla.
      const recepcion = await como(
        usuarios.reception,
        `SELECT public.registrar_acceso_a_notas_restringidas($1, ARRAY[$2]::uuid[])`,
        [clinicId, noteId],
      );
      expect(recepcion.error).toMatch(/permisos/);

      await como(
        usuarios.dentist,
        `UPDATE public.clinical_notes SET restricted = false WHERE id = $1`,
        [noteId],
      );
      const acciones = await servicio<{ action: string; actor_id: string }>(
        `SELECT action, actor_id FROM public.clinical_note_audit
          WHERE note_id = $1 AND action IN ('restrict', 'unrestrict', 'restricted_view')
          ORDER BY created_at, action`,
        [noteId],
      );
      expect(acciones.map((a) => a.action).sort()).toEqual([
        "restrict",
        "restricted_view",
        "unrestrict",
      ]);
      expect(acciones.find((a) => a.action === "restricted_view")?.actor_id).toBe(usuarios.owner);
      // La app no puede escribir la bitácora directo (regla 16).
      const directo = await como(
        usuarios.owner,
        `INSERT INTO public.clinical_note_audit (note_id, clinic_id, patient_ref, action, actor_id)
         VALUES ($1, $2, $3, 'restricted_view', $4)`,
        [noteId, clinicId, patientRef, usuarios.owner],
      );
      expect(directo.error).not.toBe("");
    });

    it("cuenta las notas ocultas sin mostrar nada (y 0 para recepción)", async () => {
      await restringirComoAutor();
      const contar = async (u: string) =>
        (
          await como<{ n: number }>(
            u,
            `SELECT public.contar_notas_restringidas_ocultas($1, ARRAY[$2]::text[]) AS n`,
            [clinicId, patientRef],
          )
        ).filas[0]?.n;
      expect(await contar(usuarios.dentist2)).toBe(1);
      expect(await contar(usuarios.assistant)).toBe(1);
      expect(await contar(usuarios.dentist)).toBe(0);
      expect(await contar(usuarios.owner)).toBe(0);
      expect(await contar(usuarios.reception)).toBe(0);
    });

    it("una adenda de una nota restringida nace restringida: la ven el autor de la nota y owner/admin, no otro dentista", async () => {
      await restringirComoAutor();
      await servicio(`UPDATE public.clinical_notes SET status = 'signed' WHERE id = $1`, [noteId]);
      const adenda = randomUUID();
      await servicio(
        `INSERT INTO public.clinical_notes (id, clinic_id, patient_ref, title, content, created_by, addendum_of)
         VALUES ($1, $2, $3, 'Adenda', 'Corrección', $4, $5)`,
        [adenda, clinicId, patientRef, usuarios.owner, noteId],
      );
      const fila = await servicio<{ restricted: boolean }>(
        `SELECT restricted FROM public.clinical_notes WHERE id = $1`,
        [adenda],
      );
      expect(fila[0].restricted).toBe(true);
      const ve = async (u: string) =>
        (await como(u, `SELECT id FROM public.clinical_notes WHERE id = $1`, [adenda])).filas
          .length === 1;
      expect(await ve(usuarios.dentist)).toBe(true);
      expect(await ve(usuarios.owner)).toBe(true);
      expect(await ve(usuarios.dentist2)).toBe(false);
    });

    it("otra clínica no ve la nota (aislamiento intacto)", async () => {
      expect(await veNota(otroOwner)).toBe(false);
    });
  });

  // ── FIC-14 ──────────────────────────────────────────────────────────────

  describe("FIC-14 interconsultas", () => {
    async function crear(userId: string) {
      return como<{ id: string; status: string }>(
        userId,
        `INSERT INTO public.patient_referrals (clinic_id, patient_id, specialty, reason, requested_by)
         VALUES ($1, $2, 'Cirugía maxilofacial', 'Tercer molar incluido', $3) RETURNING id, status`,
        [clinicId, pacienteId, userId],
      );
    }

    it("roles clínicos crean y leen; recepción y contabilidad no; otra clínica no ve nada", async () => {
      for (const rol of ["owner", "admin", "dentist", "assistant"]) {
        const r = await crear(usuarios[rol]);
        expect(r.error, rol).toBe("");
        expect(r.filas[0].status).toBe("pedida");
      }
      expect((await crear(usuarios.reception)).error).toMatch(/row-level security/);
      expect((await crear(usuarios.accounting)).error).toMatch(/row-level security/);
      const ve = async (u: string) =>
        (await como(u, `SELECT id FROM public.patient_referrals WHERE clinic_id = $1`, [clinicId]))
          .filas.length;
      expect(await ve(usuarios.dentist)).toBe(4);
      expect(await ve(usuarios.reception)).toBe(0);
      expect(await ve(otroOwner)).toBe(0);
      // No se pide para un paciente de otra clínica.
      const cruzada = await como(
        usuarios.dentist,
        `INSERT INTO public.patient_referrals (clinic_id, patient_id, specialty, reason, requested_by)
         VALUES ($1, $2, 'Endodoncia', 'Motivo', $3)`,
        [clinicId, pacienteOtraClinica, usuarios.dentist],
      );
      expect(cruzada.error).toMatch(/row-level security/);
      // Nadie borra.
      const id = (await crear(usuarios.dentist)).filas[0].id;
      const borrar = await como(
        usuarios.owner,
        `DELETE FROM public.patient_referrals WHERE id = $1`,
        [id],
      );
      expect(borrar.error).toMatch(/permission denied/);
    });

    it("las transiciones las valida la base", async () => {
      const id = (await crear(usuarios.dentist)).filas[0].id;
      const set = (sql: string) =>
        como(
          usuarios.dentist,
          `UPDATE public.patient_referrals SET ${sql} WHERE id = $1 RETURNING *`,
          [id],
        );
      expect((await set(`status = 'cerrada'`)).error).toMatch(/No se puede pasar/);
      expect((await set(`status = 'respondida'`)).error).toMatch(/respuesta del especialista/);
      expect((await set(`status = 'cancelada'`)).error).toMatch(/por qué se cancela/);
      const enviada = await set(`status = 'enviada'`);
      expect(enviada.error).toBe("");
      expect((enviada.filas[0] as { sent_at: string }).sent_at).toBeTruthy();
      const respondida = await set(`status = 'respondida', response = 'Se realizó la exodoncia.'`);
      expect(respondida.error).toBe("");
      const fila = respondida.filas[0] as { response_recorded_by: string; responded_at: string };
      expect(fila.response_recorded_by).toBe(usuarios.dentist);
      expect((await set(`reason = 'Otro motivo'`)).error).toMatch(/ya fue respondida/);
      expect((await set(`status = 'cerrada'`)).error).toBe("");
      expect((await set(`status = 'enviada'`)).error).toMatch(/ya está cerrada/);
    });

    it("el documento enlazado tiene que ser del mismo paciente", async () => {
      const id = (await crear(usuarios.dentist)).filas[0].id;
      // Un documento que no es de este paciente (acá, uno que no existe): lo
      // rechaza el trigger antes que el FK.
      const ajeno = randomUUID();
      const r = await como(
        usuarios.dentist,
        `UPDATE public.patient_referrals SET issued_document_id = $2 WHERE id = $1`,
        [id, ajeno],
      );
      expect(r.error).toMatch(/no es de este paciente/);
    });
  });

  // ── FIC-15 ──────────────────────────────────────────────────────────────

  describe("FIC-15 protocolos clínicos", () => {
    const crear = (userId: string, nombre = "Post exodoncia") =>
      como<{ id: string; updated_by: string }>(
        userId,
        `INSERT INTO public.clinical_protocols (clinic_id, name, steps, created_by)
         VALUES ($1, $2, '["Anestesia","Extracción"]'::jsonb, $3) RETURNING id, updated_by`,
        [clinicId, nombre, userId],
      );

    it("owner/admin/dentist los crean; el asistente los lee pero no los crea; recepción no los ve", async () => {
      const r = await crear(usuarios.dentist);
      expect(r.error).toBe("");
      expect(r.filas[0].updated_by).toBe(usuarios.dentist);
      expect((await crear(usuarios.admin, "Blanqueamiento")).error).toBe("");
      expect((await crear(usuarios.assistant, "Otro")).error).toMatch(/row-level security/);
      const lee = async (u: string) =>
        (await como(u, `SELECT id FROM public.clinical_protocols WHERE clinic_id = $1`, [clinicId]))
          .filas.length;
      expect(await lee(usuarios.assistant)).toBe(2);
      expect(await lee(usuarios.reception)).toBe(0);
      expect(await lee(otroOwner)).toBe(0);
    });

    it("nombre único por clínica (sin distinguir mayúsculas) y al menos un paso", async () => {
      expect((await crear(usuarios.dentist)).error).toBe("");
      expect((await crear(usuarios.dentist, " post EXODONCIA ")).error).toMatch(/duplicate key/);
      const sinPasos = await como(
        usuarios.dentist,
        `INSERT INTO public.clinical_protocols (clinic_id, name, steps, created_by)
         VALUES ($1, 'Vacío', '[]'::jsonb, $2)`,
        [clinicId, usuarios.dentist],
      );
      expect(sinPasos.error).toMatch(/clinical_protocols_steps_check/);
    });
  });

  // ── MKT-09 ──────────────────────────────────────────────────────────────

  describe("MKT-09 seguimiento de implantes", () => {
    const crear = (userId: string, lote: string, clinica = clinicId, paciente = pacienteId) =>
      como<{ id: string; professional_name: string | null }>(
        userId,
        `INSERT INTO public.patient_implants (clinic_id, patient_id, tooth, brand, lot, placed_on, created_by)
         VALUES ($1, $2, 36, 'Straumann', $3, current_date, $4) RETURNING id, professional_name`,
        [clinica, paciente, lote, userId],
      );

    it("roles clínicos registran (el asistente también); recepción y otra clínica no", async () => {
      expect((await crear(usuarios.dentist, "LOT-AB123")).error).toBe("");
      expect((await crear(usuarios.assistant, "LOT-AB124")).error).toBe("");
      expect((await crear(usuarios.reception, "LOT-X")).error).toMatch(/row-level security/);
      expect((await crear(otroOwner, "LOT-X", clinicId)).error).toMatch(/row-level security/);
      const pieza = await como(
        usuarios.dentist,
        `INSERT INTO public.patient_implants (clinic_id, patient_id, tooth, brand, lot, placed_on, created_by)
         VALUES ($1, $2, 19, 'Straumann', 'L', current_date, $3)`,
        [clinicId, pacienteId, usuarios.dentist],
      );
      expect(pieza.error).toMatch(/patient_implants_tooth_check/);
    });

    it("búsqueda por lote: sin distinguir mayúsculas y solo dentro de la clínica", async () => {
      await crear(usuarios.dentist, "LOT-AB123");
      await crear(usuarios.dentist, "zz-999");
      // Mismo lote en otra clínica: no aparece.
      await servicio(
        `INSERT INTO public.patient_implants (clinic_id, patient_id, tooth, brand, lot, placed_on, created_by)
         VALUES ($1, $2, 11, 'Otra', 'LOT-AB123', current_date, $3)`,
        [otraClinica, pacienteOtraClinica, otroOwner],
      );
      const buscar = async (u: string, patron: string) =>
        (
          await como<{ lot: string }>(
            u,
            `SELECT lot FROM public.patient_implants WHERE clinic_id = $1 AND lot ILIKE $2`,
            [clinicId, patron],
          )
        ).filas;
      expect((await buscar(usuarios.dentist, "%ab12%")).map((f) => f.lot)).toEqual(["LOT-AB123"]);
      expect(await buscar(usuarios.reception, "%ab12%")).toHaveLength(0);
      const todos = await como(
        usuarios.dentist,
        `SELECT lot FROM public.patient_implants WHERE lot ILIKE '%ab123%'`,
      );
      expect(todos.filas).toHaveLength(1);
    });

    it("el profesional tiene que ser de la clínica y su nombre queda como snapshot", async () => {
      const prof = await servicio<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Rojas') RETURNING id`,
        [clinicId],
      );
      const ajeno = await servicio<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dr. Ajeno') RETURNING id`,
        [otraClinica],
      );
      const ok = await como<{ professional_name: string }>(
        usuarios.dentist,
        `INSERT INTO public.patient_implants (clinic_id, patient_id, tooth, brand, lot, placed_on, professional_id, created_by)
         VALUES ($1, $2, 46, 'Nobel', 'L1', current_date, $3, $4) RETURNING professional_name`,
        [clinicId, pacienteId, prof[0].id, usuarios.dentist],
      );
      expect(ok.error).toBe("");
      expect(ok.filas[0].professional_name).toBe("Dra. Rojas");
      const mal = await como(
        usuarios.dentist,
        `INSERT INTO public.patient_implants (clinic_id, patient_id, tooth, brand, lot, placed_on, professional_id, created_by)
         VALUES ($1, $2, 46, 'Nobel', 'L2', current_date, $3, $4)`,
        [clinicId, pacienteId, ajeno[0].id, usuarios.dentist],
      );
      expect(mal.error).toMatch(/no es de esta clínica/);
    });

    it("un control con estado actualiza el implante; los controles no se editan ni borran", async () => {
      const id = (await crear(usuarios.dentist, "L-55")).filas[0].id;
      const control = await como<{ id: string }>(
        usuarios.assistant,
        `INSERT INTO public.patient_implant_controls (clinic_id, patient_id, implant_id, controlled_on, finding, isq, status_after, recorded_by)
         VALUES ($1, $2, $3, current_date, 'Movilidad, se retira', 40, 'retirado', $4) RETURNING id`,
        [clinicId, pacienteId, id, usuarios.assistant],
      );
      expect(control.error).toBe("");
      const imp = await servicio<{ status: string; removed_on: string | null }>(
        `SELECT status, removed_on FROM public.patient_implants WHERE id = $1`,
        [id],
      );
      expect(imp[0].status).toBe("retirado");
      expect(imp[0].removed_on).not.toBeNull();
      const editar = await como(
        usuarios.owner,
        `UPDATE public.patient_implant_controls SET finding = 'otro' WHERE id = $1`,
        [control.filas[0].id],
      );
      expect(editar.error).toMatch(/permission denied/);
      // Un control para un paciente que no es el del implante: rechazado.
      const cruzado = await como(
        usuarios.dentist,
        `INSERT INTO public.patient_implant_controls (clinic_id, patient_id, implant_id, controlled_on, finding, recorded_by)
         VALUES ($1, $2, $3, current_date, 'x control', $4)`,
        [clinicId, pacienteOtraClinica, id, usuarios.dentist],
      );
      expect(cruzado.error).toMatch(/row-level security/);
    });
  });

  it("las funciones nuevas no las ejecuta anon", async () => {
    const { rows } = await client.query<{ fn: string; anon: boolean }>(`
      select p.oid::regprocedure::text as fn, has_function_privilege('anon', p.oid, 'execute') as anon
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('puede_ver_nota_clinica', 'registrar_acceso_a_notas_restringidas',
                           'contar_notas_restringidas_ocultas')
    `);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.anon, r.fn).toBe(false);
  });
});
