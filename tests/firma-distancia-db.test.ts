import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";
import { bloquesAHtml, renderPlantilla } from "@/lib/documentos/motor";
import { contextoDeEjemplo } from "@/lib/documentos/variables";
import { huellaDeEvidencia } from "@/lib/firma-distancia/evidencia";
import {
  generarCodigo,
  generarSecreto,
  huellaDeCodigo,
  huellaDeSecreto,
} from "@/lib/firma-distancia/token";

/**
 * Ola 5 · Firma a distancia (migraciones 20261026100000 y 20261026100100),
 * contra la base:
 *
 * - Crear: la base copia el documento emitido (no el cliente), calcula la
 *   huella, decide quién firma (paciente o tutor) y exige RUT y correo. Una
 *   sola solicitud abierta por documento; reenviar reemplaza la anterior.
 * - RLS: roles clínicos ven las de documentos; recepción no; otra clínica
 *   tampoco. Nadie del staff lee las huellas del token, la sesión o el código.
 * - Página pública (funciones del rol de servicio): RUT con 5 intentos y
 *   bloqueo, sesión, código con 5 intentos, un solo uso, vencimiento.
 * - Evidencia: la huella de la base es la de `huellaDeEvidencia`.
 * - Inmutabilidad: lo pedido no cambia; una firmada no se edita; la copia
 *   firmada se registra una vez.
 * - Presupuesto: firmar = aceptarlo (se crea el plan); si cambió después de
 *   pedir la firma, no se acepta.
 */

const RUT = "12.345.678-5";
const IP = "203.0.113.7";
const UA = "Mozilla/5.0 (iPhone) Prueba";

describe("firma a distancia en la base", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let pacienteId: string;
  let profDentist: string;

  async function como<T>(
    userId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ filas: T[]; error: string; code: string }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query("SET LOCAL ROLE authenticated");
    try {
      const r = await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      return { filas: r.rows as T[], error: "", code: "" };
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_rls");
      await client.query("RESET ROLE");
      const err = e as Error & { code?: string };
      return { filas: [], error: err.message, code: err.code ?? "" };
    }
  }

  /** Como el rol de servicio (sin identidad): así llama el servidor. */
  async function servicio<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const r = await client.query(sql, params);
    return r.rows as T[];
  }

  async function emitir(seedKey: string, paciente = pacienteId) {
    const p = await client.query<{ current_version_id: string }>(
      `SELECT current_version_id FROM public.document_templates WHERE clinic_id = $1 AND seed_key = $2`,
      [clinicId, seedKey],
    );
    const bloques = renderPlantilla(
      "# Consentimiento\nYo, {{paciente.nombre}}, acepto.",
      contextoDeEjemplo(),
    ).bloques;
    const r = await como<{ id: string; content_sha256: string }>(
      usuarios.dentist,
      `INSERT INTO public.issued_documents
         (clinic_id, patient_id, template_version_id, professional_id, content_blocks, content_html,
          professional_name_snapshot, clinic_name_snapshot, patient_name_snapshot, title, kind,
          year, number, content_sha256, issued_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'x', 'x', 'x', 'x', 'otro', 1999, 1, 'x', $7)
       RETURNING id, content_sha256`,
      [
        clinicId,
        paciente,
        p.rows[0].current_version_id,
        profDentist,
        JSON.stringify(bloques),
        bloquesAHtml(bloques),
        usuarios.dentist,
      ],
    );
    expect(r.error).toBe("");
    return r.filas[0];
  }

  /** Pide la firma como `userId`. Devuelve la fila (sin las huellas secretas) y el token. */
  async function pedir(
    userId: string,
    objetivo: { documento?: string; presupuesto?: string },
    extra: { reemplaza?: string; contenido?: string } = {},
  ) {
    const token = generarSecreto();
    const tokenHash = await huellaDeSecreto(token);
    const r = await como<{
      id: string;
      status: string;
      title: string;
      document_sha256: string;
      signer_role: string;
      signer_expected_name: string;
      code_recipient_masked: string;
      expires_at: Date;
      created_at: Date;
      patient_id: string;
    }>(
      userId,
      `INSERT INTO public.patient_signature_requests
         (clinic_id, patient_id, kind, issued_document_id, quote_id, replaces_request_id, title,
          sheet, content_blocks, content_html, document_sha256, signer_role,
          signer_expected_name, link_channel, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'Falso', '{}'::jsonb, '[]'::jsonb, $7, 'falsa', 'paciente',
               'Falso', 'whatsapp', $8, now() + interval '1 year', $9)
       RETURNING id, status, title, document_sha256, signer_role, signer_expected_name,
                 code_recipient_masked, expires_at, created_at, patient_id`,
      [
        clinicId,
        pacienteId,
        objetivo.documento ? "documento" : "presupuesto",
        objetivo.documento ?? null,
        objetivo.presupuesto ?? null,
        extra.reemplaza ?? null,
        extra.contenido ?? "<p>Presupuesto</p>",
        tokenHash,
        userId,
      ],
    );
    return { ...r, token, tokenHash };
  }

  async function abrir(tokenHash: string) {
    const [f] = await servicio<{ j: Record<string, unknown> }>(
      `SELECT public.firma_remota_abrir($1, $2, $3) AS j`,
      [tokenHash, IP, UA],
    );
    return f.j;
  }

  async function verificar(tokenHash: string, rut: string, sesionHash: string) {
    const [f] = await servicio<{ j: Record<string, unknown> }>(
      `SELECT public.firma_remota_verificar_rut($1, $2, $3, $4, $5) AS j`,
      [tokenHash, rut, sesionHash, IP, UA],
    );
    return f.j;
  }

  async function prepararCodigo(tokenHash: string, sesionHash: string, codigo: string) {
    const [f] = await servicio<{ j: Record<string, unknown> }>(
      `SELECT public.firma_remota_preparar_codigo($1, $2, $3, $4, $5) AS j`,
      [tokenHash, sesionHash, await huellaDeCodigo(tokenHash, codigo), IP, UA],
    );
    return f.j;
  }

  async function firmar(
    tokenHash: string,
    sesionHash: string,
    codigo: string,
    extra: { path?: string | null; sha?: string | null } = {},
  ) {
    const [f] = await servicio<{ j: Record<string, unknown> }>(
      `SELECT public.firma_remota_firmar($1, $2, $3, $4, $5, $6, $7, $8, $9) AS j`,
      [
        tokenHash,
        sesionHash,
        await huellaDeCodigo(tokenHash, codigo),
        "Ana Pérez Soto",
        "Leí completo el documento y lo acepto.",
        extra.path ?? null,
        extra.sha ?? null,
        IP,
        UA,
      ],
    );
    return f.j;
  }

  /** Lleva una solicitud hasta tener sesión y código. */
  async function hastaElCodigo(tokenHash: string) {
    const sesion = await huellaDeSecreto(generarSecreto());
    const v = await verificar(tokenHash, RUT, sesion);
    expect(v.ok).toBe(true);
    const codigo = generarCodigo();
    const c = await prepararCodigo(tokenHash, sesion, codigo);
    expect(c.ok).toBe(true);
    return { sesion, codigo };
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
      `INSERT INTO public.patients (clinic_id, full_name, document_id, email, birth_date, created_by)
       VALUES ($1, 'Ana Pérez Soto', $2, 'ana@paciente.test', '1990-05-04', $3) RETURNING id`,
      [clinicId, RUT, usuarios.owner],
    );
    pacienteId = r.rows[0].id;
    const p = await client.query<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name, user_id, sis_registry_number)
       VALUES ($1, 'Dra. Ana Soto', $2, '123456') RETURNING id`,
      [clinicId, usuarios.dentist],
    );
    profDentist = p.rows[0].id;
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  describe("crear", () => {
    it("copia el documento emitido, su huella y decide quién firma", async () => {
      const doc = await emitir("consentimiento-simple");
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      expect(r.error).toBe("");
      const f = r.filas[0];
      expect(f.status).toBe("enviada");
      expect(f.title).not.toBe("Falso");
      expect(f.document_sha256).toBe(doc.content_sha256);
      expect(f.signer_role).toBe("paciente");
      expect(f.signer_expected_name).toBe("Ana Pérez Soto");
      expect(f.code_recipient_masked).toBe("a•••@paciente.test");
      // 72 h desde ahora, no lo que mandó el cliente.
      const horas = (f.expires_at.getTime() - f.created_at.getTime()) / 3_600_000;
      expect(horas).toBeCloseTo(72, 3);
      const ev = await client.query(
        `SELECT kind FROM public.patient_signature_events WHERE request_id = $1`,
        [f.id],
      );
      expect(ev.rows.map((x) => x.kind)).toEqual(["creada"]);
    });

    it("solo documentos que requieren la firma del paciente", async () => {
      const cert = await emitir("certificado-atencion");
      expect((await pedir(usuarios.dentist, { documento: cert.id })).error).toMatch(
        /no requiere la firma/,
      );
      await client.query(
        `UPDATE public.document_templates SET requires_patient_signature = true
          WHERE clinic_id = $1 AND seed_key = 'certificado-atencion'`,
        [clinicId],
      );
      expect((await pedir(usuarios.dentist, { documento: cert.id })).error).toBe("");
    });

    it("exige RUT y correo del paciente; un menor firma por su tutor", async () => {
      const doc = await emitir("consentimiento-simple");
      await client.query(`UPDATE public.patients SET email = NULL WHERE id = $1`, [pacienteId]);
      expect((await pedir(usuarios.dentist, { documento: doc.id })).error).toMatch(/correo/);
      await client.query(
        `UPDATE public.patients SET email = 'ana@paciente.test', document_id = NULL WHERE id = $1`,
        [pacienteId],
      );
      expect((await pedir(usuarios.dentist, { documento: doc.id })).error).toMatch(/RUT/);

      await client.query(
        `UPDATE public.patients SET document_id = $2, birth_date = current_date - interval '10 years'
          WHERE id = $1`,
        [pacienteId, RUT],
      );
      expect((await pedir(usuarios.dentist, { documento: doc.id })).error).toMatch(/tutor/);
      await client.query(
        `INSERT INTO public.patient_guardians
           (clinic_id, patient_id, full_name, document_id, relationship, email, is_primary, created_by)
         VALUES ($1, $2, 'Marta Soto', '11.111.111-1', 'madre', 'marta@tutor.test', true, $3)`,
        [clinicId, pacienteId, usuarios.owner],
      );
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      expect(r.error).toBe("");
      expect(r.filas[0].signer_role).toBe("tutor");
      expect(r.filas[0].signer_expected_name).toBe("Marta Soto");
      expect(r.filas[0].code_recipient_masked).toBe("m•••@tutor.test");
      // El RUT que se pide es el del tutor, no el del paciente.
      const sesion = await huellaDeSecreto(generarSecreto());
      expect((await verificar(r.tokenHash, RUT, sesion)).ok).toBe(false);
      expect((await verificar(r.tokenHash, "11111111-1", sesion)).ok).toBe(true);
    });

    it("una sola abierta por documento; reenviar reemplaza la anterior", async () => {
      const doc = await emitir("consentimiento-simple");
      const a = await pedir(usuarios.dentist, { documento: doc.id });
      const b = await pedir(usuarios.dentist, { documento: doc.id });
      expect(b.code).toBe("23505");
      const c = await pedir(usuarios.dentist, { documento: doc.id }, { reemplaza: a.filas[0].id });
      expect(c.error).toBe("");
      const viejo = await client.query(
        `SELECT status FROM public.patient_signature_requests WHERE id = $1`,
        [a.filas[0].id],
      );
      expect(viejo.rows[0].status).toBe("reemplazada");
      expect((await abrir(a.tokenHash)).estado).toBe("reemplazada");
      expect((await abrir(c.tokenHash)).estado).toBe("abierta");
    });

    it("la clínica demo no pide firmas", async () => {
      const doc = await emitir("consentimiento-simple");
      await client.query(`UPDATE public.clinics SET is_demo = true WHERE id = $1`, [clinicId]);
      expect((await pedir(usuarios.dentist, { documento: doc.id })).error).toMatch(/demo/);
    });
  });

  describe("RLS y privilegios", () => {
    it("clínicos ven las de documentos; recepción y otra clínica no", async () => {
      const doc = await emitir("consentimiento-simple");
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      const sql = `SELECT id FROM public.patient_signature_requests WHERE id = $1`;
      for (const rol of ["owner", "admin", "dentist", "assistant"]) {
        expect((await como(usuarios[rol], sql, [r.filas[0].id])).filas, rol).toHaveLength(1);
      }
      expect((await como(usuarios.reception, sql, [r.filas[0].id])).filas).toHaveLength(0);
      expect((await como(usuarios.externo, sql, [r.filas[0].id])).filas).toHaveLength(0);
      const ev = await como(
        usuarios.reception,
        `SELECT id FROM public.patient_signature_events WHERE request_id = $1`,
        [r.filas[0].id],
      );
      expect(ev.filas).toHaveLength(0);
    });

    it("asistente y recepción no piden firma de un documento", async () => {
      const doc = await emitir("consentimiento-simple");
      expect((await pedir(usuarios.assistant, { documento: doc.id })).error).toMatch(
        /row-level security/,
      );
      expect((await pedir(usuarios.reception, { documento: doc.id })).error).toMatch(
        /row-level security/,
      );
    });

    it("nadie del staff lee las huellas del token, la sesión ni el código", async () => {
      const doc = await emitir("consentimiento-simple");
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      for (const col of ["token_hash", "session_hash", "code_hash"]) {
        const x = await como(
          usuarios.owner,
          `SELECT ${col} FROM public.patient_signature_requests WHERE id = $1`,
          [r.filas[0].id],
        );
        expect(x.error, col).toMatch(/permission denied/);
      }
    });

    it("sin UPDATE ni DELETE desde la API; cancelar es una función", async () => {
      const doc = await emitir("consentimiento-simple");
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      const id = r.filas[0].id;
      expect(
        (
          await como(
            usuarios.owner,
            `UPDATE public.patient_signature_requests SET status = 'cancelada' WHERE id = $1`,
            [id],
          )
        ).error,
      ).toMatch(/permission denied/);
      expect(
        (
          await como(
            usuarios.owner,
            `DELETE FROM public.patient_signature_requests WHERE id = $1`,
            [id],
          )
        ).error,
      ).toMatch(/permission denied/);
      expect(
        (await como(usuarios.reception, `SELECT public.firma_remota_cancelar($1, 'x')`, [id]))
          .error,
      ).toMatch(/permisos/);
      expect(
        (
          await como(usuarios.dentist, `SELECT public.firma_remota_cancelar($1, 'Se equivocó')`, [
            id,
          ])
        ).error,
      ).toBe("");
      expect((await abrir(r.tokenHash)).estado).toBe("cancelada");
    });

    it("las funciones de la página pública solo las ejecuta el rol de servicio", async () => {
      const r = await client.query<{ f: string; anon: boolean; authn: boolean; srv: boolean }>(`
        SELECT p.oid::regprocedure::text AS f,
               has_function_privilege('anon', p.oid, 'execute') AS anon,
               has_function_privilege('authenticated', p.oid, 'execute') AS authn,
               has_function_privilege('service_role', p.oid, 'execute') AS srv
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname LIKE 'firma_remota_%'
           AND p.proname NOT IN ('firma_remota_cancelar', 'firma_remota_huella_evidencia',
                                 'firma_remota_estado_visible', 'firma_remota_ip_limitada')`);
      expect(r.rows).toHaveLength(6);
      for (const f of r.rows) {
        expect(f.anon, f.f).toBe(false);
        expect(f.authn, f.f).toBe(false);
        expect(f.srv, f.f).toBe(true);
      }
    });
  });

  describe("página pública", () => {
    it("un token que no existe no dice nada", async () => {
      expect(await abrir("0".repeat(64))).toEqual({ estado: "invalida" });
      expect(await abrir("no-es-hex")).toEqual({ estado: "invalida" });
    });

    it("abrir no muestra el documento ni datos del paciente", async () => {
      const doc = await emitir("consentimiento-simple");
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      const a = await abrir(r.tokenHash);
      expect(a.estado).toBe("abierta");
      expect(a.clinica).toBe("Clínica Test");
      expect(JSON.stringify(a)).not.toMatch(/Ana|Consentimiento|bloques/);
    });

    it("RUT: 5 intentos y bloqueo de 15 minutos", async () => {
      const doc = await emitir("consentimiento-simple");
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      const sesion = await huellaDeSecreto(generarSecreto());
      for (let i = 4; i >= 1; i--) {
        const v = await verificar(r.tokenHash, "9.999.999-3", sesion);
        expect(v.ok).toBe(false);
        expect(v.restantes).toBe(i);
      }
      const ultimo = await verificar(r.tokenHash, "9.999.999-3", sesion);
      expect(ultimo.restantes).toBe(0);
      expect(ultimo.bloqueada_hasta).toBeTruthy();
      // Bloqueada: ni el RUT correcto pasa.
      const v = await verificar(r.tokenHash, RUT, sesion);
      expect(v.ok).toBe(false);
      expect(v.bloqueada_hasta).toBeTruthy();
    });

    it("RUT correcto (en cualquier formato) abre la sesión y entrega el documento", async () => {
      const doc = await emitir("consentimiento-simple");
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      const sesion = await huellaDeSecreto(generarSecreto());
      const v = await verificar(r.tokenHash, "12345678-5", sesion);
      expect(v.ok).toBe(true);
      expect(v.documento_sha256).toBe(doc.content_sha256);
      expect(Array.isArray(v.bloques)).toBe(true);
      const fila = await client.query(
        `SELECT signer_rut_masked, signer_rut_sha256 FROM public.patient_signature_requests WHERE id = $1`,
        [r.filas[0].id],
      );
      expect(fila.rows[0].signer_rut_masked).toBe("•••6785");
      expect(fila.rows[0].signer_rut_sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("código: sin sesión no hay; uno por minuto; 5 intentos y bloqueo", async () => {
      const doc = await emitir("consentimiento-simple");
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      const otra = await huellaDeSecreto(generarSecreto());
      expect((await prepararCodigo(r.tokenHash, otra, "123456")).motivo).toBe("sesion");

      const { sesion, codigo } = await hastaElCodigo(r.tokenHash);
      const c = await prepararCodigo(r.tokenHash, sesion, "000000");
      expect(c.ok).toBe(false);
      expect(c.motivo).toBe("espera");

      const malo = codigo === "000001" ? "000002" : "000001";
      for (let i = 4; i >= 1; i--) {
        const f = await firmar(r.tokenHash, sesion, malo);
        expect(f.motivo).toBe("codigo_incorrecto");
        expect(f.restantes).toBe(i);
      }
      const bloqueo = await firmar(r.tokenHash, sesion, malo);
      expect(bloqueo.motivo).toBe("bloqueada");
      // El código bueno ya no sirve: se borró al bloquear.
      expect((await firmar(r.tokenHash, sesion, codigo)).ok).toBe(false);
    });

    it("firma, guarda la evidencia con la huella de evidencia.ts y es de un solo uso", async () => {
      const doc = await emitir("consentimiento-simple");
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      const { sesion, codigo } = await hastaElCodigo(r.tokenHash);
      const path = `${clinicId}/${pacienteId}/firmas-a-distancia/${randomUUID()}.png`;
      await client.query(
        `INSERT INTO storage.objects (bucket_id, name) VALUES ('clinical-documents', $1)`,
        [path],
      );
      const sha = "a".repeat(64);
      const f = await firmar(r.tokenHash, sesion, codigo, { path, sha });
      expect(f.ok).toBe(true);

      const fila = (
        await client.query(`SELECT * FROM public.patient_signature_requests WHERE id = $1`, [
          r.filas[0].id,
        ])
      ).rows[0];
      expect(fila.status).toBe("firmada");
      expect(fila.signed_ip).toBe(IP);
      expect(fila.signed_user_agent).toBe(UA);
      expect(fila.signer_name).toBe("Ana Pérez Soto");
      expect(fila.signature_storage_path).toBe(path);
      expect(fila.signed_at_local).toMatch(/\(America\/Santiago\)$/);
      expect(fila.session_hash).toBeNull();
      expect(fila.code_hash).toBeNull();

      const ts = await huellaDeEvidencia({
        id: fila.id,
        documentSha256: fila.document_sha256,
        signerRole: fila.signer_role,
        signerName: fila.signer_name,
        signerRutSha256: fila.signer_rut_sha256,
        signerRutMasked: fila.signer_rut_masked,
        codeChannel: fila.code_channel,
        codeRecipientMasked: fila.code_recipient_masked,
        signedAt: (fila.signed_at as Date).toISOString(),
        signedIp: fila.signed_ip,
        signedUserAgent: fila.signed_user_agent,
        acceptedText: fila.accepted_text,
        signatureSha256: fila.signature_sha256,
      });
      expect(ts).toBe(fila.evidence_sha256);
      expect(f.evidencia_sha256).toBe(fila.evidence_sha256);

      // Un solo uso: el link ya no firma ni verifica.
      expect((await firmar(r.tokenHash, sesion, codigo)).motivo).toBe("firmada");
      expect((await verificar(r.tokenHash, RUT, sesion)).estado).toBe("firmada");
      // Y el documento no se vuelve a pedir.
      expect((await pedir(usuarios.dentist, { documento: doc.id })).error).toMatch(/ya firmó/);
    });

    it("una firma no se edita; la copia firmada se registra una vez", async () => {
      const doc = await emitir("consentimiento-simple");
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      const { sesion, codigo } = await hastaElCodigo(r.tokenHash);
      expect((await firmar(r.tokenHash, sesion, codigo)).ok).toBe(true);
      const id = r.filas[0].id;

      for (const set of ["signer_name = 'Otra persona'", "status = 'cancelada'", "title = 'X'"]) {
        await client.query("SAVEPOINT sp");
        await expect(
          client.query(`UPDATE public.patient_signature_requests SET ${set} WHERE id = $1`, [id]),
        ).rejects.toThrow(/no se edita/);
        await client.query("ROLLBACK TO SAVEPOINT sp");
      }

      const copia = `${clinicId}/${pacienteId}/firmas-a-distancia/${id}.pdf`;
      await client.query(
        `INSERT INTO storage.objects (bucket_id, name) VALUES ('clinical-documents', $1)`,
        [copia],
      );
      await servicio(`SELECT public.firma_remota_guardar_copia($1, $2, $3)`, [
        r.tokenHash,
        copia,
        "b".repeat(64),
      ]);
      await client.query("SAVEPOINT sp");
      await expect(
        servicio(`SELECT public.firma_remota_guardar_copia($1, $2, $3)`, [
          r.tokenHash,
          copia,
          "c".repeat(64),
        ]),
      ).rejects.toThrow(/ya está guardada/);
      await client.query("ROLLBACK TO SAVEPOINT sp");
      const ev = await client.query(
        `SELECT kind FROM public.patient_signature_events WHERE request_id = $1 ORDER BY created_at`,
        [id],
      );
      expect(ev.rows.map((x) => x.kind)).toEqual(
        expect.arrayContaining([
          "creada",
          "rut_correcto",
          "codigo_enviado",
          "firmada",
          "copia_guardada",
        ]),
      );
      await client.query("SAVEPOINT sp");
      await expect(
        client.query(
          `UPDATE public.patient_signature_events SET kind = 'firmada' WHERE request_id = $1`,
          [id],
        ),
      ).rejects.toThrow(/no se edita/);
      await client.query("ROLLBACK TO SAVEPOINT sp");
    });

    it("lo pedido no cambia aunque siga abierta", async () => {
      const doc = await emitir("consentimiento-simple");
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      await client.query("SAVEPOINT sp");
      await expect(
        client.query(
          `UPDATE public.patient_signature_requests SET content_html = '<p>otro</p>' WHERE id = $1`,
          [r.filas[0].id],
        ),
      ).rejects.toThrow(/no se edita/);
      await client.query("ROLLBACK TO SAVEPOINT sp");
    });

    it("vencida: no verifica ni firma", async () => {
      const doc = await emitir("consentimiento-simple");
      const r = await pedir(usuarios.dentist, { documento: doc.id });
      const { sesion, codigo } = await hastaElCodigo(r.tokenHash);
      await client.query(
        `ALTER TABLE public.patient_signature_requests DISABLE TRIGGER patient_signature_requests_proteger`,
      );
      await client.query(
        `UPDATE public.patient_signature_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [r.filas[0].id],
      );
      await client.query(
        `ALTER TABLE public.patient_signature_requests ENABLE TRIGGER patient_signature_requests_proteger`,
      );
      expect((await abrir(r.tokenHash)).estado).toBe("vencida");
      expect((await firmar(r.tokenHash, sesion, codigo)).motivo).toBe("vencida");
    });
  });

  describe("presupuesto", () => {
    async function presupuesto() {
      const q = await client.query<{ id: string }>(
        `INSERT INTO public.quotes
           (clinic_id, patient_id, number, status, valid_until, subtotal_cents, total_cents, created_by)
         VALUES ($1, $2, $3, 'draft', current_date + 30, 100000, 100000, $4) RETURNING id`,
        [clinicId, pacienteId, `P-${randomUUID().slice(0, 8)}`, usuarios.owner],
      );
      await client.query(
        `INSERT INTO public.quote_items
           (clinic_id, quote_id, name_snapshot, unit_price_cents, total_cents, position)
         VALUES ($1, $2, 'Resina', 100000, 100000, 0)`,
        [clinicId, q.rows[0].id],
      );
      return q.rows[0].id;
    }

    it("pedirla lo deja enviado; firmar lo acepta y crea el plan", async () => {
      const quoteId = await presupuesto();
      const r = await pedir(usuarios.reception, { presupuesto: quoteId });
      expect(r.error).toBe("");
      expect(r.filas[0].document_sha256).toMatch(/^[0-9a-f]{64}$/);
      const q1 = await client.query(`SELECT status FROM public.quotes WHERE id = $1`, [quoteId]);
      expect(q1.rows[0].status).toBe("sent");

      const { sesion, codigo } = await hastaElCodigo(r.tokenHash);
      expect((await firmar(r.tokenHash, sesion, codigo)).ok).toBe(true);
      const q2 = await client.query(
        `SELECT status, accepted_by_name, accepted_ip FROM public.quotes WHERE id = $1`,
        [quoteId],
      );
      expect(q2.rows[0].status).toBe("converted");
      expect(q2.rows[0].accepted_by_name).toBe("Ana Pérez Soto");
      expect(q2.rows[0].accepted_ip).toBe(IP);
      const plan = await client.query(`SELECT id FROM public.treatment_plans WHERE quote_id = $1`, [
        quoteId,
      ]);
      expect(plan.rows).toHaveLength(1);
    });

    it("si el presupuesto cambió después de pedir la firma, no se acepta", async () => {
      const quoteId = await presupuesto();
      const r = await pedir(usuarios.dentist, { presupuesto: quoteId });
      const { sesion, codigo } = await hastaElCodigo(r.tokenHash);
      await client.query(
        `UPDATE public.quote_items SET unit_price_cents = 50000, total_cents = 50000 WHERE quote_id = $1`,
        [quoteId],
      );
      expect((await firmar(r.tokenHash, sesion, codigo)).motivo).toBe("presupuesto_cambio");
      const q = await client.query(`SELECT status FROM public.quotes WHERE id = $1`, [quoteId]);
      expect(q.rows[0].status).toBe("sent");
    });

    it("todos los miembros ven la de un presupuesto; asistente no la pide", async () => {
      const quoteId = await presupuesto();
      const r = await pedir(usuarios.reception, { presupuesto: quoteId });
      const sel = await como(
        usuarios.accounting,
        `SELECT id FROM public.patient_signature_requests WHERE id = $1`,
        [r.filas[0].id],
      );
      expect(sel.filas).toHaveLength(1);
      expect(
        (await pedir(usuarios.assistant, { presupuesto: quoteId }, { reemplaza: r.filas[0].id }))
          .error,
      ).toMatch(/row-level security/);
    });
  });
});
