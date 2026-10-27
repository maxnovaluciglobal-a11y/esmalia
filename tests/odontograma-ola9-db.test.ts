import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 9 · frente odontograma (migración 20261030100000).
 *
 * ODO-08: la observación por pieza es una marca `observacion` de
 * `odontogram_marks`. Se prueba en la base:
 * - entra como pieza completa y existente; ni "por realizar" ni en una cara;
 * - una observación nueva cierra la anterior de la misma pieza (INSERT +
 *   cierre, nunca UPDATE: regla 9) y no toca nada más;
 * - ni "sano" ni "ausente" cierran la observación;
 * - hereda la RLS clínica: escriben owner/admin/dentist, lee además
 *   assistant, recepción y contabilidad no ven nada, y nadie de otra clínica.
 *
 * ODO-05: el lote de varias piezas es un INSERT de varias filas; cada fila
 * cierra lo que reemplaza en su pieza, igual que una marca suelta.
 */
describe("odontograma Ola 9: observación por pieza y lote de varias piezas", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let patientId: string;

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

  async function marcar(
    autor: string,
    tooth: number,
    condition: string,
    {
      surface = "whole",
      status = "existente",
      notes = null,
    }: { surface?: string; status?: string; notes?: string | null } = {},
  ) {
    return como<{ id: string }>(
      autor,
      `INSERT INTO public.odontogram_marks
         (clinic_id, patient_id, tooth_number, surface, condition, status, notes, recorded_by)
       VALUES ($1, $2, $3, $4, $5::public.tooth_condition, $6, $7, $8) RETURNING id`,
      [clinicId, patientId, tooth, surface, condition, status, notes, autor],
    );
  }

  async function vigentes(tooth: number) {
    const r = await client.query<{ condition: string; surface: string; notes: string | null }>(
      `SELECT condition::text, surface::text, notes FROM public.odontogram_marks
        WHERE patient_id = $1 AND tooth_number = $2 AND superseded_at IS NULL
        ORDER BY condition, surface`,
      [patientId, tooth],
    );
    return r.rows;
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
    const p = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by)
       VALUES ($1, 'Paciente Ola 9', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    patientId = p.rows[0].id;
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("el catálogo tiene la observación como hallazgo de pieza completa", async () => {
    const r = await client.query(
      `SELECT alcance, grupo, categoria, superficies
         FROM public.odontogram_condition_catalog WHERE condition = 'observacion'`,
    );
    expect(r.rows).toEqual([
      { alcance: "pieza", grupo: "observacion", categoria: "hallazgo", superficies: null },
    ]);
  });

  it("la observación va en la pieza completa y nunca por realizar", async () => {
    expect((await marcar(usuarios.dentist, 21, "observacion", { notes: "ok" })).error).toBe("");
    const enCara = await marcar(usuarios.dentist, 21, "observacion", {
      surface: "oclusal",
      notes: "x",
    });
    expect(enCara.error).toMatch(/pieza completa/);
    const planificada = await marcar(usuarios.dentist, 21, "observacion", {
      status: "planificado",
      notes: "x",
    });
    expect(planificada.error).toMatch(/por realizar/);
  });

  it("una observación nueva cierra la anterior de la misma pieza y nada más", async () => {
    await marcar(usuarios.dentist, 36, "sano");
    await marcar(usuarios.dentist, 36, "caries", { surface: "oclusal" });
    await marcar(usuarios.dentist, 37, "observacion", { notes: "otra pieza" });
    await marcar(usuarios.dentist, 36, "observacion", { notes: "primera" });
    await marcar(usuarios.dentist, 36, "observacion", { notes: "segunda" });

    // La caries cerró el "sano" de la pieza (regla de siempre); las
    // observaciones no tocaron ni la caries ni la observación de la 37.
    expect(await vigentes(36)).toEqual([
      { condition: "caries", surface: "oclusal", notes: null },
      { condition: "observacion", surface: "whole", notes: "segunda" },
    ]);
    expect(await vigentes(37)).toEqual([
      { condition: "observacion", surface: "whole", notes: "otra pieza" },
    ]);
    const historia = await client.query(
      `SELECT count(*)::int AS n FROM public.odontogram_marks
        WHERE patient_id = $1 AND tooth_number = 36 AND condition::text = 'observacion'`,
      [patientId],
    );
    expect(historia.rows[0].n).toBe(2);
  });

  it("una observación no cierra el 'sano' de la pieza", async () => {
    await marcar(usuarios.dentist, 11, "sano");
    await marcar(usuarios.dentist, 11, "observacion", { notes: "control" });
    expect((await vigentes(11)).map((m) => m.condition)).toEqual(["observacion", "sano"]);
  });

  it("ni 'sano' ni 'ausente' cierran la observación", async () => {
    await marcar(usuarios.dentist, 46, "observacion", { notes: "indicación del ortodoncista" });
    await marcar(usuarios.dentist, 46, "caries", { surface: "mesial" });
    await marcar(usuarios.dentist, 46, "sano");
    await marcar(usuarios.dentist, 46, "ausente");
    expect(await vigentes(46)).toEqual([
      { condition: "ausente", surface: "whole", notes: null },
      { condition: "observacion", surface: "whole", notes: "indicación del ortodoncista" },
    ]);
  });

  it("escriben owner, admin y dentist; assistant solo lee; recepción y contabilidad nada", async () => {
    for (const rol of ["owner", "admin", "dentist"]) {
      const r = await marcar(usuarios[rol], 12, "observacion", { notes: `de ${rol}` });
      expect(r.error, rol).toBe("");
    }
    const asistente = await marcar(usuarios.assistant, 12, "observacion", { notes: "x" });
    expect(asistente.error).toMatch(/row-level security/);

    const leeAsistente = await como<{ notes: string }>(
      usuarios.assistant,
      `SELECT notes FROM public.odontogram_marks
        WHERE patient_id = $1 AND superseded_at IS NULL`,
      [patientId],
    );
    expect(leeAsistente.filas).toEqual([{ notes: "de dentist" }]);

    for (const rol of ["reception", "accounting"]) {
      const r = await como(
        usuarios[rol],
        `SELECT 1 FROM public.odontogram_marks WHERE patient_id = $1`,
        [patientId],
      );
      expect(r.filas, rol).toEqual([]);
      const w = await marcar(usuarios[rol], 13, "observacion", { notes: "x" });
      expect(w.error, rol).toMatch(/row-level security/);
    }
  });

  it("nadie de otra clínica ve ni escribe observaciones de esta", async () => {
    await marcar(usuarios.dentist, 21, "observacion", { notes: "privada" });
    // Dentista de otra clínica: miembro con rol clínico, pero en la suya.
    const otraClinica = randomUUID();
    const ajeno = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraClinica, ajeno],
    );
    await client.query(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES ($1, $2, 'dentist')
       ON CONFLICT DO NOTHING`,
      [otraClinica, ajeno],
    );
    for (const intruso of [ajeno, usuarios.externo]) {
      const lee = await como(
        intruso,
        `SELECT 1 FROM public.odontogram_marks WHERE patient_id = $1`,
        [patientId],
      );
      expect(lee.filas).toEqual([]);
      const escribe = await marcar(intruso, 22, "observacion", { notes: "intrusa" });
      expect(escribe.error).toMatch(/row-level security/);
    }
  });

  it("un lote de varias piezas cierra en cada pieza lo que reemplaza", async () => {
    await marcar(usuarios.dentist, 16, "sellante", { surface: "oclusal" });
    await marcar(usuarios.dentist, 26, "observacion", { notes: "se queda" });
    const lote = await como<{ id: string }>(
      usuarios.dentist,
      `INSERT INTO public.odontogram_marks
         (clinic_id, patient_id, tooth_number, surface, condition, status, recorded_by)
       SELECT $1, $2, t, 'oclusal', 'caries', 'existente', $3
         FROM unnest($4::smallint[]) AS t
       RETURNING id`,
      [clinicId, patientId, usuarios.dentist, [16, 26, 36]],
    );
    expect(lote.error).toBe("");
    expect(lote.filas).toHaveLength(3);
    expect(await vigentes(16)).toEqual([{ condition: "caries", surface: "oclusal", notes: null }]);
    expect((await vigentes(26)).map((m) => m.condition)).toEqual(["caries", "observacion"]);
  });

  it("un lote con una fila inválida no guarda ninguna", async () => {
    const lote = await como(
      usuarios.dentist,
      `INSERT INTO public.odontogram_marks
         (clinic_id, patient_id, tooth_number, surface, condition, status, recorded_by)
       VALUES ($1, $2, 11, 'whole', 'corona', 'existente', $3),
              ($1, $2, 21, 'oclusal', 'corona', 'existente', $3)`,
      [clinicId, patientId, usuarios.dentist],
    );
    expect(lote.error).toMatch(/pieza completa/);
    const r = await client.query(
      `SELECT count(*)::int AS n FROM public.odontogram_marks WHERE patient_id = $1`,
      [patientId],
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("la función de cierre sigue sin poder llamarse por RPC", async () => {
    const r = await client.query(
      `SELECT has_function_privilege('anon', 'public.close_previous_odontogram_mark()', 'execute') AS anon,
              has_function_privilege('authenticated', 'public.close_previous_odontogram_mark()', 'execute') AS auth`,
    );
    expect(r.rows[0]).toEqual({ anon: false, auth: false });
  });
});
