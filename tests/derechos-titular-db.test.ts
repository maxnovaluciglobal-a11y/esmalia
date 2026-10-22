import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";
import { venceEl } from "@/lib/derechos/derechos";

/**
 * SEG-09 (migración 20261026200000), contra la base:
 *
 * - RLS: solo owner/admin de la clínica leen y gestionan; ni los demás roles
 *   ni otra clínica ven una solicitud. La bitácora, igual.
 * - Portal: solo el rol de servicio inserta solicitudes del portal (el
 *   portal no tiene sesión de Supabase); el equipo solo registra las que
 *   llegan por otro canal.
 * - El plazo lo fija la base (30 días corridos en el huso de la clínica) y
 *   coincide con `venceEl` de la app. Prórroga única, antes de vencer.
 * - Estados: transiciones válidas, cierre con respuesta, quién respondió lo
 *   estampa la base; cerrada no se edita; nada se borra.
 * - La bitácora la escribe el trigger y no se edita.
 * - El correo de la respuesta tiene que ser de esa clínica y ese paciente.
 *
 * La conexión es `postgres` (salta la RLS): para probarla se asume el rol
 * de cada persona, igual que PostgREST.
 */

describe("solicitudes del titular en la base", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let pacienteId: string;
  let otraClinica: string;
  let otroOwner: string;

  async function como<T>(
    userId: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ filas: T[]; error: string }> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "",
    ]);
    await client.query("SAVEPOINT sp_rls");
    await client.query(userId ? "SET LOCAL ROLE authenticated" : "SET LOCAL ROLE service_role");
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

  type Fila = {
    id: string;
    status: string;
    due_date: string;
    extended_due_date: string | null;
    responded_by: string | null;
    responded_at: string | null;
    received_at: string;
    response: string | null;
    registered_by: string | null;
  };
  const COLS =
    "id, status, due_date::text, extended_due_date::text, responded_by, responded_at, received_at, response, registered_by";

  /** Solicitud del portal (rol de servicio). */
  function desdeElPortal(extra: { kind?: string; channel?: string; response?: string } = {}) {
    return como<Fila>(
      null,
      `INSERT INTO public.data_subject_requests (clinic_id, patient_id, kind, channel, detail, response)
       VALUES ($1, $2, $3, $4, 'Mi correo es otro', $5) RETURNING ${COLS}`,
      [
        clinicId,
        pacienteId,
        extra.kind ?? "rectificacion",
        extra.channel ?? "portal",
        extra.response ?? null,
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
    await client.query(`UPDATE public.clinics SET timezone = 'America/Mexico_City' WHERE id = $1`, [
      clinicId,
    ]);
    const r = await client.query<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Ana Pérez', $2) RETURNING id`,
      [clinicId, usuarios.owner],
    );
    pacienteId = r.rows[0].id;

    otroOwner = randomUUID();
    otraClinica = randomUUID();
    await client.query(
      `INSERT INTO public.clinics (id, name, created_by) VALUES ($1, 'Otra clínica', $2)`,
      [otraClinica, otroOwner],
    );
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  // ─── Portal y plazo ────────────────────────────────────────────────────────

  it("el portal registra con el rol de servicio; el plazo coincide con el de la app", async () => {
    const r = await desdeElPortal();
    expect(r.error).toBe("");
    const s = r.filas[0];
    expect(s.status).toBe("recibida");
    expect(s.registered_by).toBeNull();
    const { rows } = await client.query<{ ahora: Date }>("SELECT now() AS ahora");
    expect(s.due_date).toBe(venceEl(rows[0].ahora, "America/Mexico_City"));
  });

  it("una resuelta en el portal entra respondida y exige el detalle de lo entregado", async () => {
    const sin = await desdeElPortal({ kind: "acceso", channel: "portal_automatico" });
    expect(sin.error).toMatch(/detalle de lo entregado/);
    const con = await desdeElPortal({
      kind: "acceso",
      channel: "portal_automatico",
      response: "Descargó sus datos en PDF.",
    });
    expect(con.error).toBe("");
    expect(con.filas[0].status).toBe("respondida");
    expect(con.filas[0].responded_at).not.toBeNull();
  });

  it("nadie del equipo puede hacerse pasar por el portal", async () => {
    const r = await como(
      usuarios.owner,
      `INSERT INTO public.data_subject_requests (clinic_id, patient_id, kind, channel)
       VALUES ($1, $2, 'supresion', 'portal')`,
      [clinicId, pacienteId],
    );
    expect(r.error).not.toBe("");
  });

  it("el paciente tiene que ser de la clínica", async () => {
    const r = await como(
      null,
      `INSERT INTO public.data_subject_requests (clinic_id, patient_id, kind, channel)
       VALUES ($1, $2, 'acceso', 'portal')`,
      [otraClinica, pacienteId],
    );
    expect(r.error).toMatch(/no pertenece a esta clínica/);
  });

  it("owner/admin registran una recibida por otro canal, con fecha de hasta 90 días atrás", async () => {
    const hace10 = await como<Fila>(
      usuarios.admin,
      `INSERT INTO public.data_subject_requests (clinic_id, patient_id, kind, channel, detail, received_at, status, response)
       VALUES ($1, $2, 'acceso', 'clinica', 'Pidió copia por correo', now() - interval '10 days', 'respondida', 'trampa')
       RETURNING ${COLS}`,
      [clinicId, pacienteId],
    );
    expect(hace10.error).toBe("");
    const s = hace10.filas[0];
    expect(s.status).toBe("recibida"); // no se puede crear ya cerrada
    expect(s.response).toBeNull();
    expect(s.registered_by).toBe(usuarios.admin);
    expect(s.due_date).toBe(venceEl(new Date(s.received_at), "America/Mexico_City"));

    const vieja = await como(
      usuarios.owner,
      `INSERT INTO public.data_subject_requests (clinic_id, patient_id, kind, channel, received_at)
       VALUES ($1, $2, 'acceso', 'clinica', now() - interval '120 days')`,
      [clinicId, pacienteId],
    );
    expect(vieja.error).toMatch(/90 días/);

    for (const rol of ["dentist", "reception", "assistant", "accounting"]) {
      const r = await como(
        usuarios[rol],
        `INSERT INTO public.data_subject_requests (clinic_id, patient_id, kind, channel)
         VALUES ($1, $2, 'acceso', 'clinica')`,
        [clinicId, pacienteId],
      );
      expect(r.error, rol).not.toBe("");
    }
  });

  // ─── RLS ──────────────────────────────────────────────────────────────────

  it("solo owner/admin de la clínica ven las solicitudes y su bitácora", async () => {
    const id = (await desdeElPortal()).filas[0].id;
    for (const rol of ["owner", "admin"]) {
      const r = await como(
        usuarios[rol],
        `SELECT id FROM public.data_subject_requests WHERE id = $1`,
        [id],
      );
      expect(r.filas, rol).toHaveLength(1);
      const e = await como(
        usuarios[rol],
        `SELECT id FROM public.data_subject_request_events WHERE request_id = $1`,
        [id],
      );
      expect(e.filas.length, rol).toBeGreaterThan(0);
    }
    for (const rol of ["dentist", "dentist2", "assistant", "reception", "accounting", "externo"]) {
      const r = await como(
        usuarios[rol],
        `SELECT id FROM public.data_subject_requests WHERE id = $1`,
        [id],
      );
      expect(r.filas, rol).toHaveLength(0);
      const e = await como(
        usuarios[rol],
        `SELECT id FROM public.data_subject_request_events WHERE request_id = $1`,
        [id],
      );
      expect(e.filas, rol).toHaveLength(0);
    }
    const otro = await como(
      otroOwner,
      `SELECT id FROM public.data_subject_requests WHERE id = $1`,
      [id],
    );
    expect(otro.filas).toHaveLength(0);
    const upd = await como(
      otroOwner,
      `UPDATE public.data_subject_requests SET status = 'en_revision' WHERE id = $1 RETURNING id`,
      [id],
    );
    expect(upd.filas).toHaveLength(0);
  });

  it("anon no lee ni escribe", async () => {
    const id = (await desdeElPortal()).filas[0].id;
    await client.query("SAVEPOINT sp_anon");
    await client.query("SET LOCAL ROLE anon");
    let error = "";
    try {
      await client.query(`SELECT id FROM public.data_subject_requests WHERE id = $1`, [id]);
    } catch (e) {
      error = (e as Error).message;
    }
    await client.query("ROLLBACK TO SAVEPOINT sp_anon");
    await client.query("RESET ROLE");
    expect(error).toMatch(/permission denied/);
  });

  // ─── Estados, respuesta y prórroga ─────────────────────────────────────────

  it("responder exige texto, estampa quién y cuándo, y deja todo en la bitácora", async () => {
    const id = (await desdeElPortal()).filas[0].id;
    const corta = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET status = 'respondida', response = 'ok' WHERE id = $1`,
      [id],
    );
    expect(corta.error).toMatch(/al menos 10/);

    const rev = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET status = 'en_revision' WHERE id = $1 RETURNING ${COLS}`,
      [id],
    );
    expect(rev.filas[0].status).toBe("en_revision");

    const resp = await como<Fila>(
      usuarios.admin,
      `UPDATE public.data_subject_requests
          SET status = 'rechazada', response = 'Tu ficha clínica se conserva 15 años (Decreto 41).',
              responded_by = $2, responded_at = '2000-01-01'
        WHERE id = $1 RETURNING ${COLS}`,
      [id, usuarios.owner],
    );
    expect(resp.error).toBe("");
    expect(resp.filas[0].responded_by).toBe(usuarios.admin); // no se puede atribuir a otro
    expect(new Date(resp.filas[0].responded_at!).getFullYear()).toBeGreaterThan(2000);

    const eventos = await client.query<{ event: string; actor_id: string | null }>(
      `SELECT event, actor_id FROM public.data_subject_request_events WHERE request_id = $1 ORDER BY created_at, event`,
      [id],
    );
    expect(eventos.rows.map((e) => e.event).sort()).toEqual([
      "en_revision",
      "rechazada",
      "recibida",
    ]);
    expect(eventos.rows.find((e) => e.event === "rechazada")?.actor_id).toBe(usuarios.admin);
  });

  it("no vuelve atrás ni se edita una vez cerrada; lo pedido nunca se edita", async () => {
    const id = (await desdeElPortal()).filas[0].id;
    const detalle = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET detail = 'otra cosa' WHERE id = $1`,
      [id],
    );
    expect(detalle.error).toMatch(/no se edita/);
    const plazo = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET due_date = due_date + 100 WHERE id = $1`,
      [id],
    );
    expect(plazo.error).toMatch(/no se edita/);

    await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET status = 'respondida', response = 'Corregimos tu correo.' WHERE id = $1`,
      [id],
    );
    const reabrir = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET status = 'en_revision' WHERE id = $1`,
      [id],
    );
    expect(reabrir.error).toMatch(/ya respondida/);
    const reescribir = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET response = 'Otra respuesta distinta' WHERE id = $1`,
      [id],
    );
    expect(reescribir.error).toMatch(/ya respondida/);
  });

  it("nada se borra, ni con el rol de servicio", async () => {
    const id = (await desdeElPortal()).filas[0].id;
    const app = await como(
      usuarios.owner,
      `DELETE FROM public.data_subject_requests WHERE id = $1`,
      [id],
    );
    expect(app.error).not.toBe("");
    const servicio = await como(null, `DELETE FROM public.data_subject_requests WHERE id = $1`, [
      id,
    ]);
    expect(servicio.error).toMatch(/no se borra/);
    const bitacora = await como(
      null,
      `UPDATE public.data_subject_request_events SET note = 'x' WHERE request_id = $1`,
      [id],
    );
    expect(bitacora.error).toMatch(/no se borra ni se edita/);
  });

  it("prórroga: una vez, +30 días sobre el vencimiento, con motivo y antes de vencer", async () => {
    const s = (await desdeElPortal()).filas[0];
    const sinMotivo = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET extended_due_date = '2099-01-01' WHERE id = $1`,
      [s.id],
    );
    expect(sinMotivo.error).not.toBe("");

    const ok = await como<Fila>(
      usuarios.owner,
      `UPDATE public.data_subject_requests
          SET extended_due_date = '2099-01-01', extension_reason = 'Hay que reunir imágenes del laboratorio'
        WHERE id = $1 RETURNING ${COLS}`,
      [s.id],
    );
    expect(ok.error).toBe("");
    const esperado = new Date(`${s.due_date}T00:00:00Z`);
    esperado.setUTCDate(esperado.getUTCDate() + 30);
    expect(ok.filas[0].extended_due_date).toBe(esperado.toISOString().slice(0, 10));

    const otra = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests
          SET extended_due_date = '2099-02-01', extension_reason = 'Segunda prórroga, no debería'
        WHERE id = $1`,
      [s.id],
    );
    expect(otra.error).toMatch(/una vez/);

    const vencida = await como<Fila>(
      usuarios.owner,
      `INSERT INTO public.data_subject_requests (clinic_id, patient_id, kind, channel, detail, received_at)
       VALUES ($1, $2, 'acceso', 'clinica', 'Llegó por carta', now() - interval '60 days') RETURNING ${COLS}`,
      [clinicId, pacienteId],
    );
    const tarde = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests
          SET extended_due_date = '2099-01-01', extension_reason = 'Ya venció, no debería poder'
        WHERE id = $1`,
      [vencida.filas[0].id],
    );
    expect(tarde.error).toMatch(/ya venció/);
  });

  it("el correo de la respuesta tiene que ser de esa clínica, ese paciente y quien lo anota", async () => {
    const id = (await desdeElPortal()).filas[0].id;
    await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET status = 'respondida', response = 'Corregimos tu correo.' WHERE id = $1`,
      [id],
    );
    const mensaje = async (sentBy: string, channel = "email") => {
      const r = await client.query<{ id: string }>(
        `INSERT INTO public.messages (clinic_id, patient_id, channel, direction, status, recipient, body, sent_by, sent_at)
         VALUES ($1, $2, $3::public.message_channel, 'outbound', 'sent', 'ana@correo.cl', '<p>x</p>', $4, now())
         RETURNING id`,
        [clinicId, pacienteId, channel, sentBy],
      );
      return r.rows[0].id;
    };
    const ajeno = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET response_message_id = $2 WHERE id = $1`,
      [id, await mensaje(usuarios.admin)],
    );
    expect(ajeno.error).toMatch(/no corresponde/);
    const whatsapp = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET response_message_id = $2 WHERE id = $1`,
      [id, await mensaje(usuarios.owner, "whatsapp")],
    );
    expect(whatsapp.error).toMatch(/no corresponde/);
    const propio = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET response_message_id = $2 WHERE id = $1`,
      [id, await mensaje(usuarios.owner)],
    );
    expect(propio.error).toBe("");
    const ev = await client.query(
      `SELECT 1 FROM public.data_subject_request_events WHERE request_id = $1 AND event = 'correo_enviado'`,
      [id],
    );
    expect(ev.rowCount).toBe(1);
    const otraVez = await como(
      usuarios.owner,
      `UPDATE public.data_subject_requests SET response_message_id = $2 WHERE id = $1`,
      [id, await mensaje(usuarios.owner)],
    );
    expect(otraVez.error).toMatch(/ya quedó registrado|ya respondida/);
  });

  it("borrar la clínica entera sí arrastra las solicitudes y su bitácora", async () => {
    const id = (await desdeElPortal()).filas[0].id;
    await client.query(`DELETE FROM public.clinics WHERE id = $1`, [clinicId]);
    const r = await client.query(
      `SELECT 1 FROM public.data_subject_request_events WHERE request_id = $1`,
      [id],
    );
    expect(r.rowCount).toBe(0);
  });

  it("la clínica demo no escribe", async () => {
    await client.query(`UPDATE public.clinics SET is_demo = true WHERE id = $1`, [clinicId]);
    const r = await como(
      usuarios.owner,
      `INSERT INTO public.data_subject_requests (clinic_id, patient_id, kind, channel, detail)
       VALUES ($1, $2, 'acceso', 'clinica', 'Demo')`,
      [clinicId, pacienteId],
    );
    expect(r.error).toMatch(/demo/i);
  });
});
