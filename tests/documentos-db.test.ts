import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";
import { huellaDocumento } from "@/lib/documentos/huella";
import { bloquesAHtml, renderPlantilla } from "@/lib/documentos/motor";
import { contextoDeEjemplo } from "@/lib/documentos/variables";

/**
 * Ola 4 · Motor de plantillas y documentos (migraciones 20261025100000-100200),
 * contra la base:
 *
 * - DOC-02: una clínica nueva nace con sus siete plantillas, cada una con su
 *   versión 1 vigente.
 * - DOC-01: editar = versión nueva (numerada por la base); una versión no se
 *   edita. El documento emitido guarda la versión, los datos copiados por la
 *   base, el correlativo y la huella sha256 (igual a la de huella.ts).
 * - Emitir: solo con la propia ficha de profesional y con registro.
 * - DOC-06: la firma la registra el propio profesional y se copia al emitir.
 * - DOC-08: un documento no se edita ni se borra; se anula una vez, con
 *   motivo, por quien lo emitió o un administrador.
 * - RLS: roles clínicos leen; recepción no; otra clínica tampoco.
 * - FIN-16: el RUT de la empresa (Chile) se valida al cambiarlo.
 *
 * La conexión es `postgres` (salta la RLS): para probarla se asume
 * `authenticated` con la identidad de cada persona, igual que PostgREST.
 */

describe("motor de documentos en la base", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let pacienteId: string;
  let profDentist: string;
  let profDentist2: string;

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
    extra: Record<string, string | null> = {},
  ) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name, user_id, license_number, sis_registry_number)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [clinicId, nombre, userId, extra.license ?? null, extra.sis ?? null],
    );
    return r.rows[0].id;
  }

  async function plantilla(seedKey: string) {
    const r = await client.query<{ id: string; current_version_id: string }>(
      `SELECT id, current_version_id FROM public.document_templates WHERE clinic_id = $1 AND seed_key = $2`,
      [clinicId, seedKey],
    );
    return r.rows[0];
  }

  /** Emite como `userId` un documento con la versión vigente de la plantilla. */
  async function emitir(
    userId: string,
    profesionalId: string,
    extra: { versionId?: string; html?: string } = {},
  ) {
    const p = await plantilla("certificado-atencion");
    const bloques = renderPlantilla(
      "# Certificado\n{{paciente.nombre}}",
      contextoDeEjemplo(),
    ).bloques;
    return como<{
      id: string;
      number: number;
      year: number;
      content_sha256: string;
      content_html: string;
      signature_sha256: string | null;
      professional_name_snapshot: string;
      professional_registry_snapshot: string | null;
      patient_name_snapshot: string;
      clinic_name_snapshot: string;
      title: string;
      kind: string;
      template_id: string;
      issued_by: string;
    }>(
      userId,
      `INSERT INTO public.issued_documents
         (clinic_id, patient_id, template_version_id, professional_id, content_blocks, content_html,
          professional_name_snapshot, clinic_name_snapshot, patient_name_snapshot, title, kind,
          year, number, content_sha256, issued_by, issued_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'Falso', 'Falsa', 'Falso', 'Falso', 'otro',
               1999, 1, 'falsa', $7, '2000-01-01')
       RETURNING id, number, year, content_sha256, content_html, signature_sha256,
                 professional_name_snapshot, professional_registry_snapshot, patient_name_snapshot,
                 clinic_name_snapshot, title, kind, template_id, issued_by`,
      [
        clinicId,
        pacienteId,
        extra.versionId ?? p.current_version_id,
        profesionalId,
        JSON.stringify(bloques),
        extra.html ?? bloquesAHtml(bloques),
        userId,
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
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Ana Pérez', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    pacienteId = r.rows[0].id;
    profDentist = await crearProfesional(usuarios.dentist, "Dra. Ana Soto", { sis: "123456" });
    profDentist2 = await crearProfesional(usuarios.dentist2, "Dr. Luis Rojas", { license: "L-99" });
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  // ─── DOC-02 ────────────────────────────────────────────────────────────────

  it("una clínica nueva nace con sus siete plantillas, cada una con su versión 1", async () => {
    const r = await client.query<{
      seed_key: string;
      version: number;
      title: string;
      vtitle: string;
    }>(
      `SELECT t.seed_key, v.version, t.title, v.title AS vtitle
         FROM public.document_templates t
         JOIN public.document_template_versions v ON v.id = t.current_version_id
        WHERE t.clinic_id = $1
          -- Las de otros frentes tienen su propia siembra y su propio test
          -- (presupuesto: tests/presupuesto-envio-db.test.ts).
          AND t.kind <> 'presupuesto'
        ORDER BY t.seed_key`,
      [clinicId],
    );
    expect(r.rows.map((x) => x.seed_key)).toEqual([
      "alta",
      "certificado-atencion",
      "consentimiento-simple",
      "derivacion",
      "informe",
      "reembolso-seguro",
      "reposo",
    ]);
    for (const x of r.rows) {
      expect(x.version).toBe(1);
      expect(x.title).toBe(x.vtitle);
    }
  });

  it("sembrar de nuevo no duplica nada", async () => {
    const r = await client.query<{ n: number }>(
      `SELECT public.seed_clinic_document_templates($1) AS n`,
      [clinicId],
    );
    expect(r.rows[0].n).toBe(0);
  });

  // ─── Versiones ─────────────────────────────────────────────────────────────

  it("editar crea una versión nueva numerada por la base y pasa a ser la vigente", async () => {
    const p = await plantilla("reposo");
    const ins = await como<{ id: string; version: number }>(
      usuarios.admin,
      `INSERT INTO public.document_template_versions (clinic_id, template_id, version, title, body)
       VALUES ($1, $2, 99, 'Reposo (v2)', '# Reposo\n{{paciente.nombre}}') RETURNING id, version`,
      [clinicId, p.id],
    );
    expect(ins.error).toBe("");
    expect(ins.filas[0].version).toBe(2);
    const t = await client.query<{ current_version_id: string; title: string }>(
      `SELECT current_version_id, title FROM public.document_templates WHERE id = $1`,
      [p.id],
    );
    expect(t.rows[0]).toEqual({ current_version_id: ins.filas[0].id, title: "Reposo (v2)" });
  });

  it("una versión no se edita ni se borra, y solo gestión crea versiones", async () => {
    const p = await plantilla("reposo");
    const upd = await como(
      usuarios.admin,
      `UPDATE public.document_template_versions SET body = 'x' WHERE id = $1`,
      [p.current_version_id],
    );
    expect(upd.error).toMatch(/permission denied|no se edita/);
    const del = await como(
      usuarios.owner,
      `DELETE FROM public.document_template_versions WHERE id = $1`,
      [p.current_version_id],
    );
    expect(del.error).toMatch(/permission denied/);
    const dentista = await como(
      usuarios.dentist,
      `INSERT INTO public.document_template_versions (clinic_id, template_id, title, body)
       VALUES ($1, $2, 'X', 'x')`,
      [clinicId, p.id],
    );
    expect(dentista.error).toMatch(/row-level security/);
  });

  it("la versión vigente tiene que ser de la misma plantilla; el origen no se reescribe", async () => {
    const a = await plantilla("reposo");
    const b = await plantilla("alta");
    const r = await como(
      usuarios.admin,
      `UPDATE public.document_templates SET current_version_id = $1 WHERE id = $2`,
      [b.current_version_id, a.id],
    );
    expect(r.error).toMatch(/versión vigente tiene que ser de esta plantilla/);
    await como(
      usuarios.admin,
      `UPDATE public.document_templates SET source = 'clinic', seed_key = NULL WHERE id = $1`,
      [a.id],
    );
    const t = await client.query(
      `SELECT source, seed_key FROM public.document_templates WHERE id = $1`,
      [a.id],
    );
    expect(t.rows[0]).toEqual({ source: "esmalia_model", seed_key: "reposo" });
  });

  // ─── Emisión ───────────────────────────────────────────────────────────────

  it("al emitir, la base copia los datos, pone correlativo y huella (igual a huella.ts)", async () => {
    const r = await emitir(usuarios.dentist, profDentist);
    expect(r.error).toBe("");
    const d = r.filas[0];
    expect(d.professional_name_snapshot).toBe("Dra. Ana Soto");
    expect(d.professional_registry_snapshot).toBe("123456");
    expect(d.patient_name_snapshot).toBe("Ana Pérez");
    expect(d.clinic_name_snapshot).toBe("Clínica Test");
    expect(d.title).toBe("Certificado de atención");
    expect(d.kind).toBe("certificado_atencion");
    expect(d.issued_by).toBe(usuarios.dentist);
    expect(d.number).toBe(1);
    expect(d.year).toBeGreaterThan(2025);
    expect(d.content_sha256).toBe(await huellaDocumento(d.content_html, d.signature_sha256));

    const segundo = await emitir(usuarios.dentist, profDentist);
    expect(segundo.filas[0].number).toBe(2);
  });

  it("solo se emite con la propia ficha de profesional y con registro", async () => {
    const ajena = await emitir(usuarios.dentist, profDentist2);
    expect(ajena.error).toMatch(/propia ficha de profesional/);

    const sinRegistro = await crearProfesional(usuarios.admin, "Admin Sin Registro");
    const r = await emitir(usuarios.admin, sinRegistro);
    expect(r.error).toMatch(/registro de la Superintendencia de Salud/);

    // Sin SIS pero con registro general: se usa ese.
    const conLicencia = await emitir(usuarios.dentist2, profDentist2);
    expect(conLicencia.error).toBe("");
    expect(conLicencia.filas[0].professional_registry_snapshot).toBe("L-99");
  });

  it("recepción y asistente no emiten; otra clínica no puede usar estas plantillas", async () => {
    const profRecepcion = await crearProfesional(usuarios.reception, "Recepción", { sis: "1" });
    const rec = await emitir(usuarios.reception, profRecepcion);
    expect(rec.error).toMatch(/row-level security/);

    const otraClinica = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraClinica, randomUUID()],
    );
    const otraP = await client.query<{ current_version_id: string }>(
      `SELECT current_version_id FROM public.document_templates WHERE clinic_id = $1 LIMIT 1`,
      [otraClinica],
    );
    const r = await emitir(usuarios.dentist, profDentist, {
      versionId: otraP.rows[0].current_version_id,
    });
    expect(r.error).toMatch(/no existe en esta clínica/);
  });

  // ─── RLS de lectura ────────────────────────────────────────────────────────

  it("leen los roles clínicos; recepción, contabilidad y otra clínica no", async () => {
    const r = await emitir(usuarios.dentist, profDentist);
    const id = r.filas[0].id;
    for (const rol of ["owner", "admin", "dentist", "assistant"]) {
      const v = await como(usuarios[rol], `SELECT id FROM public.issued_documents WHERE id = $1`, [
        id,
      ]);
      expect(v.filas, rol).toHaveLength(1);
    }
    for (const rol of ["reception", "accounting", "externo"]) {
      const v = await como(usuarios[rol], `SELECT id FROM public.issued_documents WHERE id = $1`, [
        id,
      ]);
      expect(v.filas, rol).toHaveLength(0);
      const t = await como(
        usuarios[rol],
        `SELECT id FROM public.document_templates WHERE clinic_id = $1`,
        [clinicId],
      );
      expect(t.filas, rol).toHaveLength(0);
    }
  });

  // ─── DOC-08 ────────────────────────────────────────────────────────────────

  it("un documento emitido no se edita ni se borra", async () => {
    const id = (await emitir(usuarios.dentist, profDentist)).filas[0].id;
    const edit = await como(
      usuarios.admin,
      `UPDATE public.issued_documents SET content_html = '<p>otro</p>' WHERE id = $1`,
      [id],
    );
    expect(edit.error).toMatch(/no se edita/);
    const del = await como(usuarios.owner, `DELETE FROM public.issued_documents WHERE id = $1`, [
      id,
    ]);
    expect(del.error).toMatch(/permission denied/);
  });

  it("se anula una vez, con motivo; quién y cuándo los pone la base", async () => {
    const id = (await emitir(usuarios.dentist, profDentist)).filas[0].id;
    const sinMotivo = await como(
      usuarios.dentist,
      `UPDATE public.issued_documents SET voided_at = now(), void_reason = ' ' WHERE id = $1`,
      [id],
    );
    expect(sinMotivo.error).toMatch(/motivo/);

    const ok = await como<{ voided_by: string; void_reason: string; voided_at: string }>(
      usuarios.dentist,
      `UPDATE public.issued_documents
          SET voided_at = '2000-01-01', voided_by = $2, void_reason = '  Fecha equivocada '
        WHERE id = $1 RETURNING voided_by, void_reason, voided_at`,
      [id, usuarios.owner],
    );
    expect(ok.error).toBe("");
    expect(ok.filas[0].voided_by).toBe(usuarios.dentist);
    expect(ok.filas[0].void_reason).toBe("Fecha equivocada");
    expect(new Date(ok.filas[0].voided_at).getFullYear()).toBeGreaterThan(2025);

    const otraVez = await como(
      usuarios.admin,
      `UPDATE public.issued_documents SET voided_at = now(), void_reason = 'otra' WHERE id = $1`,
      [id],
    );
    expect(otraVez.error).toMatch(/ya está anulado/);
  });

  it("otro profesional no anula un documento ajeno; un administrador sí", async () => {
    const id = (await emitir(usuarios.dentist, profDentist)).filas[0].id;
    const ajeno = await como(
      usuarios.dentist2,
      `UPDATE public.issued_documents SET voided_at = now(), void_reason = 'error' WHERE id = $1`,
      [id],
    );
    expect(ajeno.error).toMatch(/Solo quien emitió el documento o un administrador/);
    const admin = await como(
      usuarios.admin,
      `UPDATE public.issued_documents SET voided_at = now(), void_reason = 'error' WHERE id = $1`,
      [id],
    );
    expect(admin.error).toBe("");
  });

  it("borrar la ficha del profesional deja el documento con su snapshot", async () => {
    const id = (await emitir(usuarios.dentist, profDentist)).filas[0].id;
    await client.query(`DELETE FROM public.professionals WHERE id = $1`, [profDentist]);
    const d = await client.query(
      `SELECT professional_id, professional_name_snapshot FROM public.issued_documents WHERE id = $1`,
      [id],
    );
    expect(d.rows[0]).toEqual({
      professional_id: null,
      professional_name_snapshot: "Dra. Ana Soto",
    });
  });

  // ─── DOC-06 ────────────────────────────────────────────────────────────────

  it("el profesional registra su propia firma y se copia (con su huella) al emitir", async () => {
    const path = `${clinicId}/${profDentist}/${randomUUID()}.png`;
    await client.query(
      `INSERT INTO storage.objects (bucket_id, name) VALUES ('professional-signatures', $1)`,
      [path],
    );
    const sha = "b".repeat(64);
    const r = await como(
      usuarios.dentist,
      `SELECT public.registrar_mi_firma($1, $2, $3, '654321')`,
      [clinicId, path, sha],
    );
    expect(r.error).toBe("");
    const p = await client.query(
      `SELECT signature_storage_path, signature_sha256, sis_registry_number, signature_updated_at IS NOT NULL AS fecha
         FROM public.professionals WHERE id = $1`,
      [profDentist],
    );
    expect(p.rows[0]).toEqual({
      signature_storage_path: path,
      signature_sha256: sha,
      sis_registry_number: "654321",
      fecha: true,
    });

    const d = (await emitir(usuarios.dentist, profDentist)).filas[0];
    expect(d.signature_sha256).toBe(sha);
    expect(d.professional_registry_snapshot).toBe("654321");
    expect(d.content_sha256).toBe(await huellaDocumento(d.content_html, sha));
  });

  it("la firma exige un archivo existente en la carpeta propia; nadie registra la de otro", async () => {
    const inexistente = await como(
      usuarios.dentist,
      `SELECT public.registrar_mi_firma($1, $2, $3, '')`,
      [clinicId, `${clinicId}/${profDentist}/nada.png`, "c".repeat(64)],
    );
    expect(inexistente.error).toMatch(/No encontramos el archivo/);

    const ajena = `${clinicId}/${profDentist2}/${randomUUID()}.png`;
    await client.query(
      `INSERT INTO storage.objects (bucket_id, name) VALUES ('professional-signatures', $1)`,
      [ajena],
    );
    const carpetaAjena = await como(
      usuarios.dentist,
      `SELECT public.registrar_mi_firma($1, $2, $3, '')`,
      [clinicId, ajena, "c".repeat(64)],
    );
    expect(carpetaAjena.error).toMatch(/carpeta del profesional/);

    const admin = await como(
      usuarios.admin,
      `UPDATE public.professionals SET signature_storage_path = $2, signature_sha256 = $3 WHERE id = $1`,
      [profDentist2, ajena, "c".repeat(64)],
    );
    expect(admin.error).toMatch(/Solo el propio profesional/);
  });

  it("subir a la carpeta de firmas: solo el propio profesional", async () => {
    const propia = await como(
      usuarios.dentist,
      `SELECT public.firma_es_de_mi_profesional($1) AS ok`,
      [`${clinicId}/${profDentist}/x.png`],
    );
    expect((propia.filas[0] as { ok: boolean }).ok).toBe(true);
    const ajena = await como(
      usuarios.dentist,
      `SELECT public.firma_es_de_mi_profesional($1) AS ok`,
      [`${clinicId}/${profDentist2}/x.png`],
    );
    expect((ajena.filas[0] as { ok: boolean }).ok).toBe(false);
  });

  // ─── FIN-16 ────────────────────────────────────────────────────────────────

  it("el RUT de la empresa de una clínica de Chile se valida al cambiarlo", async () => {
    await client.query(`UPDATE public.clinics SET country = 'CL', tax_id = NULL WHERE id = $1`, [
      clinicId,
    ]);
    const malo = await como(
      usuarios.owner,
      `UPDATE public.clinics SET tax_id = '76.123.456-1' WHERE id = $1`,
      [clinicId],
    );
    expect(malo.error).toMatch(/RUT de la empresa no es válido/);
    const bueno = await como(
      usuarios.owner,
      `UPDATE public.clinics
          SET tax_id = '76.123.456-0', business_activity = 'Servicios odontológicos',
              tax_address = 'Av. Providencia 1234', tax_commune = 'Providencia', tax_receipt_kind = 'exenta'
        WHERE id = $1`,
      [clinicId],
    );
    expect(bueno.error).toBe("");
    const tipo = await como(
      usuarios.owner,
      `UPDATE public.clinics SET tax_receipt_kind = 'factura' WHERE id = $1`,
      [clinicId],
    );
    expect(tipo.error).toMatch(/tax_receipt_kind_check/);
  });

  it("un RUT viejo mal escrito no bloquea editar el resto; fuera de Chile es texto libre", async () => {
    // Un RUT mal escrito de antes de esta migración (el trigger solo mira cuando cambia).
    await client.query(`UPDATE public.clinics SET country = 'MX', tax_id = 'mal' WHERE id = $1`, [
      clinicId,
    ]);
    await client.query(`UPDATE public.clinics SET country = 'CL' WHERE id = $1`, [clinicId]);
    const nombre = await como(
      usuarios.owner,
      `UPDATE public.clinics SET name = 'Otra' WHERE id = $1`,
      [clinicId],
    );
    expect(nombre.error).toBe("");
    await client.query(`UPDATE public.clinics SET country = 'MX' WHERE id = $1`, [clinicId]);
    const rfc = await como(
      usuarios.owner,
      `UPDATE public.clinics SET tax_id = 'XAXX010101000' WHERE id = $1`,
      [clinicId],
    );
    expect(rfc.error).toBe("");
  });
});
