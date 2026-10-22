import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { conectar, sembrarEscenario } from "./helpers/db";
import { huellaDocumento } from "@/lib/documentos/huella";
import { bloquesAHtml, renderPlantilla } from "@/lib/documentos/motor";
import { contextoDeEjemplo } from "@/lib/documentos/variables";

/**
 * Ola 4 · Frente Receta (migraciones 20261025300000-300200), contra la base:
 *
 * - La clínica nace con su plantilla "Receta" (kind 'receta').
 * - `emitir_receta` escribe documento + receta en una transacción, con la
 *   identidad y la RLS de quien llama: solo owner/admin/dentist, con su propia
 *   ficha, y en Chile con registro de la Superintendencia de Salud.
 * - La base copia el RUT del paciente y el registro SIS, exige la vía de cada
 *   medicamento y valida que el documento sea la receta de esa misma emisión.
 * - Inmutable: no se edita ni se borra; anular la receta anula el documento
 *   y al revés, con el mismo motivo.
 * - Vademécum de la clínica: leen los roles clínicos, escriben quienes
 *   recetan, nadie borra, otra clínica no ve nada.
 * - El flujo anterior (receta sin documento) sigue igual.
 *
 * La conexión es `postgres` (salta la RLS): para probarla se asume
 * `authenticated` con la identidad de cada persona, igual que PostgREST.
 */

describe("receta con el motor de documentos, en la base", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let pacienteId: string;
  let profDentist: string;
  let profSinSis: string;

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

  async function crearProfesional(
    userId: string | null,
    nombre: string,
    extra: { license?: string | null; sis?: string | null } = {},
  ) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name, user_id, license_number, sis_registry_number)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [clinicId, nombre, userId, extra.license ?? null, extra.sis ?? null],
    );
    return r.rows[0].id;
  }

  async function versionDe(seedKey: string) {
    const r = await client.query<{ current_version_id: string }>(
      `SELECT current_version_id FROM public.document_templates WHERE clinic_id = $1 AND seed_key = $2`,
      [clinicId, seedKey],
    );
    return r.rows[0].current_version_id;
  }

  const ITEM = {
    medication: "Amoxicilina",
    presentation: "500 mg cápsulas",
    route: "oral",
    dose: "1 cápsula",
    frequency: "cada 8 horas",
    duration: "por 7 días",
    catalog: "esmalia:amoxicilina-500-caps",
    atc: "J01CA04",
    group: "penicilinas",
    timing: { frequency: 1, period: 8, period_unit: "h" },
  };

  type Emision = {
    r: {
      document_id: string;
      prescription_id: string;
      year: number;
      number: number;
      content_sha256: string;
    };
  };

  async function emitirReceta(
    userId: string,
    profesionalId: string,
    extra: { items?: unknown[]; versionId?: string; alertas?: string[] | null } = {},
  ) {
    const bloques = renderPlantilla(
      "# Receta\n{{paciente.nombre}}\n\n{{receta.medicamentos}}",
      contextoDeEjemplo(),
    ).bloques;
    return como<Emision>(
      userId,
      `SELECT public.emitir_receta($1, $2, $3, $4, '{}'::jsonb, $5::jsonb, $6, $7::jsonb, 'Dieta blanda.', $8::jsonb) AS r`,
      [
        clinicId,
        pacienteId,
        profesionalId,
        extra.versionId ?? (await versionDe("receta")),
        JSON.stringify(bloques),
        bloquesAHtml(bloques),
        JSON.stringify(extra.items ?? [ITEM]),
        extra.alertas === undefined ? null : JSON.stringify(extra.alertas),
      ],
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
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by, document_type, document_id, birth_date)
       VALUES ($1, 'Ana Pérez', $2, 'rut', '123456785', '1990-03-04') RETURNING id`,
      [clinicId, usuarios.owner],
    );
    pacienteId = r.rows[0].id;
    profDentist = await crearProfesional(usuarios.dentist, "Dra. Ana Soto", {
      sis: "123456",
      license: "COL-1",
    });
    profSinSis = await crearProfesional(usuarios.dentist2, "Dr. Luis Rojas", { license: "L-99" });
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  // ─── Plantilla ─────────────────────────────────────────────────────────────

  it("la clínica nace con su plantilla de receta (versión 1) y sembrar de nuevo no duplica", async () => {
    const r = await client.query<{ kind: string; source: string; version: number }>(
      `SELECT t.kind, t.source, v.version
         FROM public.document_templates t
         JOIN public.document_template_versions v ON v.id = t.current_version_id
        WHERE t.clinic_id = $1 AND t.seed_key = 'receta'`,
      [clinicId],
    );
    expect(r.rows).toEqual([{ kind: "receta", source: "esmalia_model", version: 1 }]);
    const otra = await client.query<{ n: number }>(
      `SELECT public.seed_clinic_prescription_template($1) AS n`,
      [clinicId],
    );
    expect(otra.rows[0].n).toBe(0);
  });

  it("las funciones de siembra y emisión no se pueden llamar como anon", async () => {
    const r = await client.query<{ f: string; anon: boolean }>(
      `SELECT f, has_function_privilege('anon', f, 'execute') AS anon FROM unnest(array[
         'public.emitir_receta(uuid, uuid, uuid, uuid, jsonb, jsonb, text, jsonb, text, jsonb)',
         'public.seed_clinic_prescription_template(uuid)'
       ]) AS f`,
    );
    for (const x of r.rows) expect(x.anon, x.f).toBe(false);
  });

  // ─── Emitir ────────────────────────────────────────────────────────────────

  it("un dentista emite: documento + receta, con RUT, registro SIS y huellas de la base", async () => {
    const { filas, error } = await emitirReceta(usuarios.dentist, profDentist, {
      alertas: ["Amoxicilina: alergia anotada a penicilina"],
    });
    expect(error).toBe("");
    const { r } = filas[0];

    const doc = await client.query(
      `SELECT kind, title, patient_id, professional_registry_snapshot, issued_by, content_html,
              content_sha256, signature_sha256, year, number
         FROM public.issued_documents WHERE id = $1`,
      [r.document_id],
    );
    const d = doc.rows[0];
    expect(d.kind).toBe("receta");
    expect(d.title).toBe("Receta");
    expect(d.issued_by).toBe(usuarios.dentist);
    expect(d.professional_registry_snapshot).toBe("123456");
    expect(r.number).toBe(d.number);
    expect(d.content_sha256).toBe(await huellaDocumento(d.content_html, d.signature_sha256));

    const presc = await client.query(
      `SELECT issued_document_id, patient_document_type_snapshot, patient_document_id_snapshot,
              professional_sis_snapshot, professional_license_snapshot, allergy_alerts, items,
              instructions, issued_by, content_sha256
         FROM public.prescriptions WHERE id = $1`,
      [r.prescription_id],
    );
    const p = presc.rows[0];
    expect(p.issued_document_id).toBe(r.document_id);
    expect(p.patient_document_type_snapshot).toBe("rut");
    expect(p.patient_document_id_snapshot).toBe("123456785");
    expect(p.professional_sis_snapshot).toBe("123456");
    expect(p.professional_license_snapshot).toBe("COL-1");
    expect(p.allergy_alerts).toEqual(["Amoxicilina: alergia anotada a penicilina"]);
    expect(p.items[0]).toMatchObject({ route: "oral", atc: "J01CA04" });
    expect(p.instructions).toBe("Dieta blanda.");
    expect(p.issued_by).toBe(usuarios.dentist);
    expect(p.content_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("asistente, recepción y alguien de otra clínica no emiten", async () => {
    const profAsistente = await crearProfesional(usuarios.assistant, "Asistente", { sis: "9" });
    const profRecepcion = await crearProfesional(usuarios.reception, "Recepción", { sis: "8" });
    expect((await emitirReceta(usuarios.assistant, profAsistente)).error).toMatch(
      /row-level security|permission/i,
    );
    // Recepción ni siquiera ve las plantillas de documentos.
    expect((await emitirReceta(usuarios.reception, profRecepcion)).error).toMatch(
      /row-level security|permission|plantilla de receta/i,
    );
    expect((await emitirReceta(usuarios.externo, profDentist)).error).not.toBe("");
    const n = await client.query(
      `SELECT count(*)::int AS n FROM public.issued_documents WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("solo con la propia ficha de profesional", async () => {
    const r = await emitirReceta(usuarios.dentist, profSinSis);
    expect(r.error).toMatch(/propia ficha/);
  });

  it("en Chile exige el registro de la Superintendencia de Salud; en otro país alcanza el general", async () => {
    const chile = await emitirReceta(usuarios.dentist2, profSinSis);
    expect(chile.error).toMatch(/Superintendencia de Salud/);
    await client.query(`UPDATE public.clinics SET country = 'MX' WHERE id = $1`, [clinicId]);
    const mexico = await emitirReceta(usuarios.dentist2, profSinSis);
    expect(mexico.error).toBe("");
  });

  it("exige la vía de cada medicamento, y si falla no queda el documento a medias", async () => {
    const { route: _sinVia, ...sinVia } = ITEM;
    const r = await emitirReceta(usuarios.dentist, profDentist, { items: [sinVia] });
    expect(r.error).toMatch(/vía de administración/);
    const otra = await emitirReceta(usuarios.dentist, profDentist, {
      items: [{ ...ITEM, route: "intravenosa" }],
    });
    expect(otra.error).toMatch(/vía de administración/);
    const n = await client.query(
      `SELECT count(*)::int AS n FROM public.issued_documents WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("no emite con una plantilla que no es de receta", async () => {
    const r = await emitirReceta(usuarios.dentist, profDentist, {
      versionId: await versionDe("certificado-atencion"),
    });
    expect(r.error).toMatch(/plantilla de receta/);
  });

  it("una receta no se puede colgar de otro documento (certificado, de otro paciente o de otra persona)", async () => {
    const { filas } = await emitirReceta(usuarios.dentist, profDentist);
    const docReceta = filas[0].r.document_id;
    // Ya tiene su receta: una segunda fila con el mismo documento choca.
    const repetida = await como(
      usuarios.dentist,
      `INSERT INTO public.prescriptions (clinic_id, patient_id, professional_id, items, issued_document_id, issued_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [clinicId, pacienteId, profDentist, JSON.stringify([ITEM]), docReceta, usuarios.dentist],
    );
    expect(repetida.error).toMatch(/prescriptions_issued_document_uniq|duplicate/);

    // Un certificado no es una receta.
    const bloques = renderPlantilla("# Certificado", contextoDeEjemplo()).bloques;
    const cert = await como<{ id: string }>(
      usuarios.dentist,
      `INSERT INTO public.issued_documents
         (clinic_id, patient_id, template_version_id, professional_id, content_blocks, content_html, issued_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id`,
      [
        clinicId,
        pacienteId,
        await versionDe("certificado-atencion"),
        profDentist,
        JSON.stringify(bloques),
        bloquesAHtml(bloques),
        usuarios.dentist,
      ],
    );
    expect(cert.error).toBe("");
    const colgada = await como(
      usuarios.dentist,
      `INSERT INTO public.prescriptions (clinic_id, patient_id, professional_id, items, issued_document_id, issued_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        clinicId,
        pacienteId,
        profDentist,
        JSON.stringify([ITEM]),
        cert.filas[0].id,
        usuarios.dentist,
      ],
    );
    expect(colgada.error).toMatch(/no corresponde/);

    // La receta de otro paciente, tampoco.
    const otro = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Otro', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    const ajena = await como(
      usuarios.dentist,
      `INSERT INTO public.prescriptions (clinic_id, patient_id, professional_id, items, issued_document_id, issued_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [clinicId, otro.rows[0].id, profDentist, JSON.stringify([ITEM]), docReceta, usuarios.dentist],
    );
    expect(ajena.error).not.toBe("");
  });

  it("el flujo anterior (receta sin documento) sigue igual", async () => {
    const r = await como<{ issued_document_id: string | null; number: number }>(
      usuarios.dentist2,
      `INSERT INTO public.prescriptions (clinic_id, patient_id, professional_id, items, issued_by)
       VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING issued_document_id, number`,
      [
        clinicId,
        pacienteId,
        profSinSis,
        JSON.stringify([
          { medication: "Ibuprofeno", dose: "1", frequency: "c/8 h", duration: "3 días" },
        ]),
        usuarios.dentist2,
      ],
    );
    expect(r.error).toBe("");
    expect(r.filas[0].issued_document_id).toBeNull();
  });

  // ─── Inmutable y anulación ─────────────────────────────────────────────────

  it("no se edita ni se borra", async () => {
    const { filas } = await emitirReceta(usuarios.dentist, profDentist);
    const { prescription_id: id } = filas[0].r;
    const editar = await como(
      usuarios.dentist,
      `UPDATE public.prescriptions SET instructions = 'otra cosa' WHERE id = $1`,
      [id],
    );
    expect(editar.error).toMatch(/no se edita/);
    const borrar = await como(usuarios.owner, `DELETE FROM public.prescriptions WHERE id = $1`, [
      id,
    ]);
    expect(borrar.error).toMatch(/permission denied/);
  });

  it("anular la receta anula su documento con el mismo motivo", async () => {
    const { filas } = await emitirReceta(usuarios.dentist, profDentist);
    const { prescription_id, document_id } = filas[0].r;
    const r = await como(
      usuarios.dentist,
      `UPDATE public.prescriptions SET voided_at = now(), void_reason = 'Error en la dosis' WHERE id = $1`,
      [prescription_id],
    );
    expect(r.error).toBe("");
    const d = await client.query(
      `SELECT voided_at IS NOT NULL AS anulado, void_reason, voided_by FROM public.issued_documents WHERE id = $1`,
      [document_id],
    );
    expect(d.rows[0]).toEqual({
      anulado: true,
      void_reason: "Error en la dosis",
      voided_by: usuarios.dentist,
    });
    const otra = await como(
      usuarios.dentist,
      `UPDATE public.prescriptions SET voided_at = now(), void_reason = 'de nuevo' WHERE id = $1`,
      [prescription_id],
    );
    expect(otra.error).toMatch(/ya está anulada/);
  });

  it("anular el documento (por un administrador) anula la receta", async () => {
    const { filas } = await emitirReceta(usuarios.dentist, profDentist);
    const { prescription_id, document_id } = filas[0].r;
    const ajeno = await como(
      usuarios.dentist2,
      `UPDATE public.issued_documents SET voided_at = now(), void_reason = 'No es mía' WHERE id = $1`,
      [document_id],
    );
    expect(ajeno.error).toMatch(/Solo quien emitió/);
    const r = await como(
      usuarios.admin,
      `UPDATE public.issued_documents SET voided_at = now(), void_reason = 'Paciente equivocado' WHERE id = $1`,
      [document_id],
    );
    expect(r.error).toBe("");
    const p = await client.query(
      `SELECT voided_at IS NOT NULL AS anulada, void_reason, voided_by FROM public.prescriptions WHERE id = $1`,
      [prescription_id],
    );
    expect(p.rows[0]).toEqual({
      anulada: true,
      void_reason: "Paciente equivocado",
      voided_by: usuarios.admin,
    });
  });

  it("recepción y otra clínica no ven recetas ni documentos de receta", async () => {
    await emitirReceta(usuarios.dentist, profDentist);
    for (const rol of ["reception", "accounting", "externo"]) {
      const p = await como(
        usuarios[rol],
        `SELECT id FROM public.prescriptions WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(p.filas, rol).toHaveLength(0);
      const d = await como(
        usuarios[rol],
        `SELECT id FROM public.issued_documents WHERE clinic_id = $1 AND kind = 'receta'`,
        [clinicId],
      );
      expect(d.filas, rol).toHaveLength(0);
    }
    const asistente = await como(
      usuarios.assistant,
      `SELECT id FROM public.prescriptions WHERE clinic_id = $1`,
      [clinicId],
    );
    expect(asistente.filas).toHaveLength(1);
  });

  // ─── Vademécum de la clínica ───────────────────────────────────────────────

  it("vademécum: escriben quienes recetan, el asistente solo lee, nadie borra", async () => {
    const insertar = (userId: string, nombre: string) =>
      como<{ id: string; created_by: string }>(
        userId,
        `INSERT INTO public.clinic_medications (clinic_id, active_ingredient, concentration, form, route, dose, frequency, duration, created_by)
         VALUES ($1, $2, '500 mg', 'cápsulas', 'oral', '1 cápsula', 'cada 8 horas', 'por 7 días', $3)
         RETURNING id, created_by`,
        [clinicId, nombre, usuarios.owner],
      );
    const dentista = await insertar(usuarios.dentist, "Amoxicilina genérica");
    expect(dentista.error).toBe("");
    // created_by lo pone la base, no el cliente.
    expect(dentista.filas[0].created_by).toBe(usuarios.dentist);
    expect((await insertar(usuarios.assistant, "Otra")).error).toMatch(/row-level security/);
    expect((await insertar(usuarios.reception, "Otra")).error).toMatch(/row-level security/);

    const id = dentista.filas[0].id;
    const leeAsistente = await como(
      usuarios.assistant,
      `SELECT id FROM public.clinic_medications WHERE id = $1`,
      [id],
    );
    expect(leeAsistente.filas).toHaveLength(1);
    for (const rol of ["reception", "externo"]) {
      const r = await como(
        usuarios[rol],
        `SELECT id FROM public.clinic_medications WHERE id = $1`,
        [id],
      );
      expect(r.filas, rol).toHaveLength(0);
    }
    const desactivar = await como(
      usuarios.dentist2,
      `UPDATE public.clinic_medications SET active = false WHERE id = $1 RETURNING active`,
      [id],
    );
    expect(desactivar.filas).toEqual([{ active: false }]);
    const borrar = await como(
      usuarios.owner,
      `DELETE FROM public.clinic_medications WHERE id = $1`,
      [id],
    );
    expect(borrar.error).toMatch(/permission denied/);
  });

  it("vademécum: la base valida vía, familia y código ATC", async () => {
    const r = (campos: string) =>
      como(
        usuarios.dentist,
        `INSERT INTO public.clinic_medications (clinic_id, active_ingredient, ${campos.split("=")[0]})
         VALUES ($1, 'Algo', $2)`,
        [clinicId, campos.split("=")[1]],
      );
    expect((await r("route=intravenosa")).error).toMatch(/route_check/);
    expect((await r("pharmacological_group=vitaminas")).error).toMatch(/group_check/);
    expect((await r("atc_code=amoxi")).error).toMatch(/atc_check/);
    expect((await r("atc_code=J01CA04")).error).toBe("");
  });
});
