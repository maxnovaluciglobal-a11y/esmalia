import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";
import { PLANTILLA_PRESUPUESTO } from "@/lib/documentos/presupuesto";

/**
 * Ola 4 · Frente Presupuesto PDF y correo (migraciones 20261025200000-200200),
 * contra la base:
 *
 * - PLA-08: una clínica nueva nace con su plantilla "Presupuesto" (kind
 *   'presupuesto', versión 1, el texto de PLANTILLA_PRESUPUESTO); sembrar de
 *   nuevo no duplica.
 * - PLA-09: `registrar_envio_de_presupuesto` deja el evento 'envio' (quién,
 *   cuándo, a qué correo) y marca el presupuesto como enviado, solo a partir
 *   de un correo enviado por quien llama; es idempotente.
 * - DOC-07: `messages.issued_document_id` solo apunta a documentos de la
 *   misma clínica.
 * - Baja de correos del paciente: `patients.email_opt_out_at`.
 * - Demo: el rol de servicio emite el documento de ejemplo solo en la clínica
 *   demo y a nombre del usuario del profesional.
 */

describe("presupuesto PDF y correo en la base", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let pacienteId: string;

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

  /** Como el rol de servicio de PostgREST (service key, sin usuario). */
  async function comoServicio<T>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ filas: T[]; error: string }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ role: "service_role" }),
    ]);
    await client.query("SAVEPOINT sp_srv");
    await client.query("SET LOCAL ROLE service_role");
    try {
      const r = await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT sp_srv");
      await client.query("RESET ROLE");
      return { filas: r.rows as T[], error: "" };
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_srv");
      await client.query("RESET ROLE");
      return { filas: [], error: (e as Error).message };
    }
  }

  async function crearPresupuesto(status: "draft" | "sent" | "accepted" = "draft") {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.quotes (clinic_id, patient_id, number, status, total_cents, created_by)
       VALUES ($1, $2, $3, $4::public.quote_status, 150000, $5) RETURNING id`,
      [clinicId, pacienteId, `P-${randomUUID().slice(0, 6)}`, status, usuarios.owner],
    );
    return r.rows[0].id;
  }

  async function crearMensaje(
    quoteId: string | null,
    sentBy: string,
    extra: { status?: string; channel?: string } = {},
  ) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.messages
         (clinic_id, patient_id, quote_id, channel, direction, status, recipient, body, sent_by, sent_at)
       VALUES ($1, $2, $3, $4::public.message_channel, 'outbound', $5::public.message_status,
               'ana@correo.cl', '<p>hola</p>', $6, now())
       RETURNING id`,
      [clinicId, pacienteId, quoteId, extra.channel ?? "email", extra.status ?? "sent", sentBy],
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
    const esc = await sembrarEscenario(client);
    clinicId = esc.clinicId;
    usuarios = esc.usuarios;
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, email, created_by)
       VALUES ($1, 'Ana Pérez', 'ana@correo.cl', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    pacienteId = r.rows[0].id;
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  // ─── PLA-08 ────────────────────────────────────────────────────────────────

  it("una clínica nueva nace con su plantilla Presupuesto (versión 1, texto modelo)", async () => {
    const r = await client.query<{ kind: string; source: string; version: number; body: string }>(
      `SELECT t.kind, t.source, v.version, v.body
         FROM public.document_templates t
         JOIN public.document_template_versions v ON v.id = t.current_version_id
        WHERE t.clinic_id = $1 AND t.seed_key = 'presupuesto'`,
      [clinicId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ kind: "presupuesto", source: "esmalia_model", version: 1 });
    expect(r.rows[0].body).toBe(PLANTILLA_PRESUPUESTO);

    const otra = await client.query<{ n: number }>(
      `SELECT public.seed_clinic_quote_template($1) AS n`,
      [clinicId],
    );
    expect(otra.rows[0].n).toBe(0);
  });

  it("el kind 'presupuesto' se acepta en plantillas nuevas y los de siempre siguen", async () => {
    const def = await client.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'document_templates_kind_check'`,
    );
    for (const k of ["certificado_atencion", "reembolso", "otro", "presupuesto"]) {
      expect(def.rows[0].def).toContain(`'${k}'`);
    }
    const ins = await como(
      usuarios.admin,
      `INSERT INTO public.document_templates (clinic_id, kind, title) VALUES ($1, 'presupuesto', 'Presupuesto 2')`,
      [clinicId],
    );
    expect(ins.error).toBe("");
  });

  // ─── PLA-09 ────────────────────────────────────────────────────────────────

  it("registrar el envío deja el evento con quién y a qué correo, y marca enviado", async () => {
    const quoteId = await crearPresupuesto("draft");
    const msg = await crearMensaje(quoteId, usuarios.reception);
    const r = await como(usuarios.reception, `SELECT public.registrar_envio_de_presupuesto($1)`, [
      msg,
    ]);
    expect(r.error).toBe("");

    const q = await client.query<{ status: string; sent_at: string | null }>(
      `SELECT status, sent_at FROM public.quotes WHERE id = $1`,
      [quoteId],
    );
    expect(q.rows[0].status).toBe("sent");
    expect(q.rows[0].sent_at).not.toBeNull();

    const ev = await client.query<{
      kind: string;
      note: string;
      actor_id: string;
      message_id: string;
    }>(
      `SELECT kind, note, actor_id, message_id FROM public.quote_events
        WHERE quote_id = $1 AND kind IN ('envio', 'estado') ORDER BY created_at`,
      [quoteId],
    );
    const envio = ev.rows.find((e) => e.kind === "envio");
    expect(envio).toMatchObject({
      note: "Por correo a ana@correo.cl",
      actor_id: usuarios.reception,
      message_id: msg,
    });
    // El paso de borrador a enviado también queda, con quien envió.
    expect(ev.rows.find((e) => e.kind === "estado")?.actor_id).toBe(usuarios.reception);

    // Idempotente: el mismo mensaje no duplica el evento.
    await como(usuarios.reception, `SELECT public.registrar_envio_de_presupuesto($1)`, [msg]);
    const n = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.quote_events WHERE quote_id = $1 AND kind = 'envio'`,
      [quoteId],
    );
    expect(Number(n.rows[0].n)).toBe(1);
  });

  it("en modo de prueba anota adónde llegó, y un presupuesto aceptado no cambia de estado", async () => {
    const quoteId = await crearPresupuesto("accepted");
    const msg = await crearMensaje(quoteId, usuarios.owner);
    const r = await como(
      usuarios.owner,
      `SELECT public.registrar_envio_de_presupuesto($1, 'pruebas@clinica.cl')`,
      [msg],
    );
    expect(r.error).toBe("");
    const q = await client.query<{ status: string; sent_at: string | null }>(
      `SELECT status, sent_at FROM public.quotes WHERE id = $1`,
      [quoteId],
    );
    expect(q.rows[0].status).toBe("accepted");
    expect(q.rows[0].sent_at).not.toBeNull();
    const ev = await client.query<{ note: string }>(
      `SELECT note FROM public.quote_events WHERE quote_id = $1 AND kind = 'envio'`,
      [quoteId],
    );
    expect(ev.rows[0].note).toBe(
      "Por correo a ana@correo.cl (modo de prueba del correo: llegó a pruebas@clinica.cl)",
    );
  });

  it("nadie fabrica un envío: mensaje ajeno, fallido, de WhatsApp o sin presupuesto", async () => {
    const quoteId = await crearPresupuesto("draft");
    const ajeno = await crearMensaje(quoteId, usuarios.owner);
    const fallido = await crearMensaje(quoteId, usuarios.reception, { status: "failed" });
    const whatsapp = await crearMensaje(quoteId, usuarios.reception, { channel: "whatsapp" });
    const sinPresupuesto = await crearMensaje(null, usuarios.reception);
    for (const msg of [ajeno, fallido, whatsapp, sinPresupuesto]) {
      const r = await como(usuarios.reception, `SELECT public.registrar_envio_de_presupuesto($1)`, [
        msg,
      ]);
      expect(r.error).toMatch(/No encontramos ese envío/);
    }
    // Un rol que no escribe presupuestos tampoco, aunque el mensaje sea suyo.
    const deAsistente = await crearMensaje(quoteId, usuarios.assistant);
    const r = await como(usuarios.assistant, `SELECT public.registrar_envio_de_presupuesto($1)`, [
      deAsistente,
    ]);
    expect(r.error).toMatch(/No tienes permisos/);
    const n = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.quote_events WHERE quote_id = $1 AND kind = 'envio'`,
      [quoteId],
    );
    expect(Number(n.rows[0].n)).toBe(0);
  });

  it("anon no puede ejecutar la función y los eventos siguen sin escritura directa", async () => {
    const priv = await client.query<{ anon: boolean; auth: boolean }>(
      `SELECT has_function_privilege('anon', 'public.registrar_envio_de_presupuesto(uuid, text)', 'execute') AS anon,
              has_function_privilege('authenticated', 'public.registrar_envio_de_presupuesto(uuid, text)', 'execute') AS auth`,
    );
    expect(priv.rows[0]).toEqual({ anon: false, auth: true });
    const quoteId = await crearPresupuesto("draft");
    const ins = await como(
      usuarios.owner,
      `INSERT INTO public.quote_events (clinic_id, quote_id, kind, note) VALUES ($1, $2, 'envio', 'falso')`,
      [clinicId, quoteId],
    );
    expect(ins.error).not.toBe("");
  });

  // ─── DOC-07 y baja ─────────────────────────────────────────────────────────

  it("un mensaje solo apunta a un documento emitido de su misma clínica", async () => {
    // Otra clínica, con su dueño y una dentista.
    const otra = {
      clinicId: randomUUID(),
      usuarios: { owner: randomUUID(), dentist: randomUUID() },
    };
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otra.clinicId, otra.usuarios.owner],
    );
    await client.query(
      `INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES ($1, $2, 'dentist')`,
      [otra.clinicId, otra.usuarios.dentist],
    );
    const pac = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Otro', $2) RETURNING id`,
      [otra.clinicId, otra.usuarios.owner],
    );
    const prof = await client.query<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name, user_id, sis_registry_number)
       VALUES ($1, 'Dra. Otra', $2, '999') RETURNING id`,
      [otra.clinicId, otra.usuarios.dentist],
    );
    const version = await client.query<{ current_version_id: string }>(
      `SELECT current_version_id FROM public.document_templates
        WHERE clinic_id = $1 AND seed_key = 'certificado-atencion'`,
      [otra.clinicId],
    );
    const doc = await como<{ id: string }>(
      otra.usuarios.dentist,
      `INSERT INTO public.issued_documents
         (clinic_id, patient_id, template_version_id, professional_id, content_blocks, content_html, issued_by)
       VALUES ($1, $2, $3, $4, '[]'::jsonb, '<p>x</p>', $5) RETURNING id`,
      [
        otra.clinicId,
        pac.rows[0].id,
        version.rows[0].current_version_id,
        prof.rows[0].id,
        otra.usuarios.dentist,
      ],
    );
    expect(doc.error).toBe("");
    const cruzado = await como(
      usuarios.owner,
      `INSERT INTO public.messages (clinic_id, patient_id, channel, direction, status, recipient, body, issued_document_id)
       VALUES ($1, $2, 'email', 'outbound', 'sent', 'ana@correo.cl', 'x', $3)`,
      [clinicId, pacienteId, doc.filas[0].id],
    );
    expect(cruzado.error).toMatch(/no pertenece a esta clínica/);
  });

  it("la baja de correos del paciente es una fecha nullable", async () => {
    const r = await client.query<{ email_opt_out_at: string | null }>(
      `UPDATE public.patients SET email_opt_out_at = now() WHERE id = $1 RETURNING email_opt_out_at`,
      [pacienteId],
    );
    expect(r.rows[0].email_opt_out_at).not.toBeNull();
  });

  // ─── Demo ──────────────────────────────────────────────────────────────────

  it("el rol de servicio emite solo en la demo y a nombre del usuario del profesional", async () => {
    const prof = await client.query<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name, user_id, sis_registry_number)
       VALUES ($1, 'Dra. Demo', $2, 'EJEMPLO-000000') RETURNING id`,
      [clinicId, usuarios.dentist],
    );
    const version = await client.query<{ current_version_id: string }>(
      `SELECT current_version_id FROM public.document_templates
        WHERE clinic_id = $1 AND seed_key = 'certificado-atencion'`,
      [clinicId],
    );
    const insertar = (issuedBy: string) =>
      comoServicio<{
        id: string;
        number: number;
        issued_by: string;
        professional_registry_snapshot: string;
      }>(
        `INSERT INTO public.issued_documents
           (clinic_id, patient_id, template_version_id, professional_id, content_blocks, content_html, issued_by)
         VALUES ($1, $2, $3, $4, '[]'::jsonb, '<p>x</p>', $5)
         RETURNING id, number, issued_by, professional_registry_snapshot`,
        [clinicId, pacienteId, version.rows[0].current_version_id, prof.rows[0].id, issuedBy],
      );

    // Clínica que no es la demo: rechazado, como siempre sin sesión.
    const noDemo = await insertar(usuarios.dentist);
    expect(noDemo.error).toMatch(/con su propia cuenta/);

    await client.query(`UPDATE public.clinics SET is_demo = true WHERE id = $1`, [clinicId]);
    const ajeno = await insertar(usuarios.owner);
    expect(ajeno.error).toMatch(/propia ficha de profesional/);

    const ok = await insertar(usuarios.dentist);
    expect(ok.error).toBe("");
    expect(ok.filas[0]).toMatchObject({
      number: 1,
      issued_by: usuarios.dentist,
      professional_registry_snapshot: "EJEMPLO-000000",
    });
  });
});
