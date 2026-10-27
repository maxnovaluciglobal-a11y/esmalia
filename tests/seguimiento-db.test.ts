import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * Ola 8 · frente B (migración 20261105200000), contra la base efímera de tests
 * (SQL directo con `SET LOCAL ROLE authenticated` y el `sub` del JWT):
 *
 * - Aislamiento entre clínicas en las 5 tablas nuevas y en las lecturas
 *   agregadas.
 * - Permisos por rol: controles y tareas para owner/admin/dentist/reception;
 *   plantillas las escriben owner/admin; campañas solo owner/admin.
 * - Reglas de la tarea (asignada del equipo, paciente de la clínica, una tarea
 *   abierta por control, posponer y completar los anota la base).
 * - Campañas: confirmada no se edita, un destinatario por paciente, el
 *   reclamo del correo no repite y WhatsApp nunca se despacha sin una persona.
 */

describe("Ola 8 · seguimiento de pacientes (SQL)", () => {
  let client: Client;
  let clinicId: string;
  let otraClinica: string;
  let usuarios: Record<string, string>;
  let otroOwner: string;
  let pacientes: string[];
  let pacienteOtraClinica: string;

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

  /** Sin identidad (como un proceso de servidor con el rol de servicio). */
  async function servicio<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const r = await client.query(sql, params);
    return r.rows as T[];
  }

  async function servicioConError(sql: string, params: unknown[] = []): Promise<string> {
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    await client.query("SAVEPOINT sp_srv");
    try {
      await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT sp_srv");
      return "";
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT sp_srv");
      return (e as Error).message;
    }
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
    pacientes = [];
    for (const nombre of ["Ana Pérez", "Beto Soto", "Caro Díaz"]) {
      const p = await servicio<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [clinicId, nombre, usuarios.owner],
      );
      pacientes.push(p[0].id);
    }
    const p2 = await servicio<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, created_by)
       VALUES ($1, 'Otro Paciente', $2) RETURNING id`,
      [otraClinica, otroOwner],
    );
    pacienteOtraClinica = p2[0].id;
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  // ── Aislamiento ─────────────────────────────────────────────────────────

  describe("aislamiento entre clínicas", () => {
    it("nadie lee filas de otra clínica en las tablas nuevas", async () => {
      await servicio(
        `INSERT INTO public.patient_controls (clinic_id, patient_id, reason, due_on, created_by)
         VALUES ($1, $2, 'Control ajeno', current_date, $3)`,
        [otraClinica, pacienteOtraClinica, otroOwner],
      );
      await servicio(
        `INSERT INTO public.followup_tasks (clinic_id, title, due_on, created_by)
         VALUES ($1, 'Tarea ajena', current_date, $2)`,
        [otraClinica, otroOwner],
      );
      await servicio(
        `INSERT INTO public.outreach_templates (clinic_id, name, channel, body, created_by)
         VALUES ($1, 'Ajena', 'whatsapp', 'Hola', $2)`,
        [otraClinica, otroOwner],
      );
      const camp = await servicio<{ id: string }>(
        `INSERT INTO public.outreach_campaigns (clinic_id, name, channel, body, created_by)
         VALUES ($1, 'Ajena', 'whatsapp', 'Hola', $2) RETURNING id`,
        [otraClinica, otroOwner],
      );
      await servicio(
        `INSERT INTO public.outreach_campaign_recipients (clinic_id, campaign_id, patient_id, channel, destination)
         VALUES ($1, $2, $3, 'whatsapp', '+56911111111')`,
        [otraClinica, camp[0].id, pacienteOtraClinica],
      );
      for (const tabla of [
        "patient_controls",
        "followup_tasks",
        "outreach_templates",
        "outreach_campaigns",
        "outreach_campaign_recipients",
      ]) {
        const r = await como(
          usuarios.owner,
          `SELECT id FROM public.${tabla} WHERE clinic_id = $1`,
          [otraClinica],
        );
        expect(r.error, tabla).toBe("");
        expect(r.filas, tabla).toHaveLength(0);
      }
    });

    it("no se escribe en otra clínica ni con un paciente de otra clínica", async () => {
      const ajena = await como(
        usuarios.owner,
        `INSERT INTO public.followup_tasks (clinic_id, title, due_on, created_by)
         VALUES ($1, 'Intruso', current_date, $2)`,
        [otraClinica, usuarios.owner],
      );
      expect(ajena.error).toMatch(/row-level security/);
      const control = await como(
        usuarios.owner,
        `INSERT INTO public.patient_controls (clinic_id, patient_id, reason, due_on, created_by)
         VALUES ($1, $2, 'Cruzado', current_date, $3)`,
        [clinicId, pacienteOtraClinica, usuarios.owner],
      );
      expect(control.error).toMatch(/row-level security/);
      const tarea = await como(
        usuarios.owner,
        `INSERT INTO public.followup_tasks (clinic_id, title, due_on, patient_id, created_by)
         VALUES ($1, 'Cruzada', current_date, $2, $3)`,
        [clinicId, pacienteOtraClinica, usuarios.owner],
      );
      expect(tarea.error).toMatch(/no es de esta clínica/);
    });

    it("las lecturas agregadas no devuelven pacientes de otra clínica", async () => {
      const datos = await como(
        usuarios.owner,
        `SELECT patient_id FROM public.seguimiento_datos_de_pacientes($1)`,
        [otraClinica],
      );
      expect(datos.error).toBe("");
      expect(datos.filas).toHaveLength(0);
      const propios = await como<{ patient_id: string }>(
        usuarios.reception,
        `SELECT patient_id FROM public.seguimiento_datos_de_pacientes($1)`,
        [clinicId],
      );
      expect(propios.filas.map((f) => f.patient_id).sort()).toEqual([...pacientes].sort());
      const planes = await como(
        usuarios.owner,
        `SELECT plan_id FROM public.seguimiento_planes_activos($1)`,
        [otraClinica],
      );
      expect(planes.error).toBe("");
      expect(planes.filas).toHaveLength(0);
    });
  });

  // ── Permisos por rol ────────────────────────────────────────────────────

  describe("permisos por rol", () => {
    it("controles y tareas: owner, admin, dentist y reception; no assistant ni accounting", async () => {
      for (const rol of ["owner", "admin", "dentist", "reception"]) {
        const r = await como(
          usuarios[rol],
          `INSERT INTO public.patient_controls (clinic_id, patient_id, reason, due_on, created_by)
           VALUES ($1, $2, 'Control de ' || $4, current_date + 30, $3) RETURNING id`,
          [clinicId, pacientes[0], usuarios[rol], rol],
        );
        expect(r.error, rol).toBe("");
      }
      for (const rol of ["assistant", "accounting"]) {
        const ins = await como(
          usuarios[rol],
          `INSERT INTO public.followup_tasks (clinic_id, title, due_on, created_by)
           VALUES ($1, 'No debería', current_date, $2)`,
          [clinicId, usuarios[rol]],
        );
        expect(ins.error, rol).toMatch(/row-level security/);
        const ver = await como(
          usuarios[rol],
          `SELECT id FROM public.patient_controls WHERE clinic_id = $1`,
          [clinicId],
        );
        expect(ver.filas, rol).toHaveLength(0);
      }
    });

    it("plantillas: las lee recepción, las escriben owner y admin", async () => {
      const recep = await como(
        usuarios.reception,
        `INSERT INTO public.outreach_templates (clinic_id, name, channel, body, created_by)
         VALUES ($1, 'Recepción', 'whatsapp', 'Hola', $2)`,
        [clinicId, usuarios.reception],
      );
      expect(recep.error).toMatch(/row-level security/);
      const admin = await como(
        usuarios.admin,
        `INSERT INTO public.outreach_templates (clinic_id, name, channel, subject, body, created_by)
         VALUES ($1, 'Control anual', 'correo', 'Tu control', 'Hola {{paciente.primer_nombre}}', $2) RETURNING id`,
        [clinicId, usuarios.admin],
      );
      expect(admin.error).toBe("");
      const lee = await como(usuarios.reception, `SELECT name FROM public.outreach_templates`);
      expect(lee.filas).toEqual([{ name: "Control anual" }]);
      const sinAsunto = await como(
        usuarios.admin,
        `INSERT INTO public.outreach_templates (clinic_id, name, channel, body, created_by)
         VALUES ($1, 'Sin asunto', 'correo', 'Hola', $2)`,
        [clinicId, usuarios.admin],
      );
      expect(sinAsunto.error).toMatch(/outreach_templates_subject_check/);
    });

    it("campañas y destinatarios: solo owner y admin", async () => {
      for (const rol of ["dentist", "reception", "accounting"]) {
        const r = await como(
          usuarios[rol],
          `INSERT INTO public.outreach_campaigns (clinic_id, name, channel, body, created_by)
           VALUES ($1, 'X', 'whatsapp', 'Hola', $2)`,
          [clinicId, usuarios[rol]],
        );
        expect(r.error, rol).toMatch(/row-level security/);
      }
      const ok = await como(
        usuarios.admin,
        `INSERT INTO public.outreach_campaigns (clinic_id, name, channel, body, created_by)
         VALUES ($1, 'Reactivación', 'whatsapp', 'Hola', $2) RETURNING id`,
        [clinicId, usuarios.admin],
      );
      expect(ok.error).toBe("");
      const verRecepcion = await como(
        usuarios.reception,
        `SELECT id FROM public.outreach_campaigns`,
      );
      expect(verRecepcion.filas).toHaveLength(0);
    });
  });

  // ── Tareas ──────────────────────────────────────────────────────────────

  describe("CRM-02 · reglas de la tarea", () => {
    it("la persona asignada tiene que ser del equipo", async () => {
      const r = await como(
        usuarios.reception,
        `INSERT INTO public.followup_tasks (clinic_id, title, due_on, assigned_to, created_by)
         VALUES ($1, 'Llamar', current_date, $2, $3)`,
        [clinicId, usuarios.externo, usuarios.reception],
      );
      expect(r.error).toMatch(/no es del equipo/);
    });

    it("posponer suma una vez, completar anota quién y cuándo, reabrir lo borra", async () => {
      const t = await como<{ id: string }>(
        usuarios.reception,
        `INSERT INTO public.followup_tasks (clinic_id, title, due_on, assigned_to, created_by)
         VALUES ($1, 'Llamar a Ana', current_date, $2, $2) RETURNING id`,
        [clinicId, usuarios.reception],
      );
      const id = t.filas[0].id;
      await como(
        usuarios.reception,
        `UPDATE public.followup_tasks SET due_on = current_date + 3 WHERE id = $1`,
        [id],
      );
      const hecha = await como<{
        postponed_count: number;
        completed_by: string;
        completed_at: string;
      }>(
        usuarios.dentist,
        `UPDATE public.followup_tasks SET status = 'hecha', postponed_count = 99 WHERE id = $1
         RETURNING postponed_count, completed_by, completed_at`,
        [id],
      );
      expect(hecha.filas[0].postponed_count).toBe(1);
      expect(hecha.filas[0].completed_by).toBe(usuarios.dentist);
      expect(hecha.filas[0].completed_at).toBeTruthy();
      const reabierta = await como<{ completed_at: string | null }>(
        usuarios.reception,
        `UPDATE public.followup_tasks SET status = 'pendiente' WHERE id = $1 RETURNING completed_at`,
        [id],
      );
      expect(reabierta.filas[0].completed_at).toBeNull();
    });

    it("un control tiene a lo más una tarea abierta", async () => {
      const c = await como<{ id: string }>(
        usuarios.dentist,
        `INSERT INTO public.patient_controls (clinic_id, patient_id, reason, due_on, created_by)
         VALUES ($1, $2, 'Endodoncia', current_date + 90, $3) RETURNING id`,
        [clinicId, pacientes[0], usuarios.dentist],
      );
      const insertar = () =>
        como(
          usuarios.reception,
          `INSERT INTO public.followup_tasks (clinic_id, title, kind, patient_id, control_id, due_on, created_by)
           VALUES ($1, 'Agendar control', 'control', $2, $3, current_date, $4)`,
          [clinicId, pacientes[0], c.filas[0].id, usuarios.reception],
        );
      expect((await insertar()).error).toBe("");
      expect((await insertar()).error).toMatch(/followup_tasks_control_abierto_uidx/);
      const ajeno = await como(
        usuarios.reception,
        `INSERT INTO public.followup_tasks (clinic_id, title, kind, patient_id, control_id, due_on, created_by)
         VALUES ($1, 'Control de otro paciente', 'control', $2, $3, current_date, $4)`,
        [clinicId, pacientes[1], c.filas[0].id, usuarios.reception],
      );
      expect(ajeno.error).toMatch(/no es de este paciente/);
    });

    it("resolver un control anota quién lo resolvió", async () => {
      const c = await como<{ id: string }>(
        usuarios.dentist,
        `INSERT INTO public.patient_controls (clinic_id, patient_id, reason, due_on, created_by)
         VALUES ($1, $2, 'Control', current_date, $3) RETURNING id`,
        [clinicId, pacientes[0], usuarios.dentist],
      );
      const r = await como<{ resolved_by: string }>(
        usuarios.reception,
        `UPDATE public.patient_controls SET status = 'descartado' WHERE id = $1 RETURNING resolved_by`,
        [c.filas[0].id],
      );
      expect(r.filas[0].resolved_by).toBe(usuarios.reception);
      const cambio = await como(
        usuarios.reception,
        `UPDATE public.patient_controls SET patient_id = $2 WHERE id = $1`,
        [c.filas[0].id, pacientes[1]],
      );
      expect(cambio.error).toMatch(/no se cambian/);
    });
  });

  // ── Campañas ────────────────────────────────────────────────────────────

  describe("CRM-04 · campañas", () => {
    async function campana(canal: "correo" | "whatsapp") {
      const c = await como<{ id: string }>(
        usuarios.owner,
        `INSERT INTO public.outreach_campaigns (clinic_id, name, channel, subject, body, created_by)
         VALUES ($1, 'Campaña', $2, CASE WHEN $2 = 'correo' THEN 'Asunto' END, 'Hola {{paciente.primer_nombre}}', $3)
         RETURNING id`,
        [clinicId, canal, usuarios.owner],
      );
      expect(c.error).toBe("");
      const id = c.filas[0].id;
      for (const p of pacientes) {
        const r = await como(
          usuarios.owner,
          `INSERT INTO public.outreach_campaign_recipients (clinic_id, campaign_id, patient_id, channel, destination)
           VALUES ($1, $2, $3, 'correo', $4)`,
          [clinicId, id, p, canal === "correo" ? `${p.slice(0, 8)}@ejemplo.cl` : "+56912345678"],
        );
        expect(r.error).toBe("");
      }
      const conf = await como<{ confirmed_by: string }>(
        usuarios.owner,
        `UPDATE public.outreach_campaigns SET status = 'confirmada', recipients_count = 3 WHERE id = $1
         RETURNING confirmed_by`,
        [id],
      );
      expect(conf.filas[0].confirmed_by).toBe(usuarios.owner);
      return id;
    }

    it("el canal del destinatario sale de la campaña y no se repite un paciente", async () => {
      const id = await campana("whatsapp");
      const canales = await servicio<{ channel: string }>(
        `SELECT DISTINCT channel FROM public.outreach_campaign_recipients WHERE campaign_id = $1`,
        [id],
      );
      expect(canales).toEqual([{ channel: "whatsapp" }]);
      const repetido = await servicioConError(
        `INSERT INTO public.outreach_campaign_recipients (clinic_id, campaign_id, patient_id, channel, destination)
         VALUES ($1, $2, $3, 'whatsapp', '+56912345678')`,
        [clinicId, id, pacientes[0]],
      );
      expect(repetido).toMatch(/outreach_campaign_recipients_unico/);
    });

    it("confirmada ya no cambia de texto ni suma destinatarios", async () => {
      const id = await campana("correo");
      const texto = await como(
        usuarios.owner,
        `UPDATE public.outreach_campaigns SET body = 'Otro texto' WHERE id = $1`,
        [id],
      );
      expect(texto.error).toMatch(/ya no cambia/);
      const nuevo = await servicio<{ id: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, created_by) VALUES ($1, 'Dani', $2) RETURNING id`,
        [clinicId, usuarios.owner],
      );
      const agregar = await como(
        usuarios.owner,
        `INSERT INTO public.outreach_campaign_recipients (clinic_id, campaign_id, patient_id, channel, destination)
         VALUES ($1, $2, $3, 'correo', 'dani@ejemplo.cl')`,
        [clinicId, id, nuevo[0].id],
      );
      expect(agregar.error).toMatch(/row-level security/);
      const sinPersona = await servicioConError(
        `UPDATE public.outreach_campaigns SET status = 'borrador' WHERE id = $1`,
        [id],
      );
      expect(sinPersona).toMatch(/no puede pasar/);
    });

    it("correo: el reclamo reparte la cola sin repetir y no vuelve a tomar lo reclamado", async () => {
      const id = await campana("correo");
      const a = await como<{ id: string; status: string }>(
        usuarios.owner,
        `SELECT id, status FROM public.reclamar_envios_de_campana($1, 2)`,
        [id],
      );
      const b = await como<{ id: string }>(
        usuarios.admin,
        `SELECT id FROM public.reclamar_envios_de_campana($1, 2)`,
        [id],
      );
      const c = await como<{ id: string }>(
        usuarios.owner,
        `SELECT id FROM public.reclamar_envios_de_campana($1, 2)`,
        [id],
      );
      expect(a.filas).toHaveLength(2);
      expect(a.filas.every((f) => f.status === "enviando")).toBe(true);
      expect(b.filas).toHaveLength(1);
      expect(c.filas).toHaveLength(0);
      const ids = new Set([...a.filas, ...b.filas].map((f) => f.id));
      expect(ids.size).toBe(3);
      const enviado = await como(
        usuarios.owner,
        `UPDATE public.outreach_campaign_recipients SET status = 'enviado' WHERE id = $1`,
        [a.filas[0].id],
      );
      expect(enviado.error).toBe("");
      const devuelta = await como(
        usuarios.owner,
        `UPDATE public.outreach_campaign_recipients SET status = 'pendiente' WHERE id = $1`,
        [a.filas[0].id],
      );
      expect(devuelta.error).toMatch(/no puede pasar/);
      const otraClinicaReclama = await como(
        otroOwner,
        `SELECT id FROM public.reclamar_envios_de_campana($1, 50)`,
        [id],
      );
      expect(otraClinicaReclama.filas).toHaveLength(0);
    });

    it("WhatsApp: nada sale solo; el reclamo del correo no lo toca y abrir exige una persona", async () => {
      const id = await campana("whatsapp");
      const reclamo = await como(
        usuarios.owner,
        `SELECT id FROM public.reclamar_envios_de_campana($1, 50)`,
        [id],
      );
      expect(reclamo.filas).toHaveLength(0);
      const [r1, r2] = await servicio<{ id: string }>(
        `SELECT id FROM public.outreach_campaign_recipients WHERE campaign_id = $1 ORDER BY id`,
        [id],
      );
      const enviando = await como(
        usuarios.owner,
        `UPDATE public.outreach_campaign_recipients SET status = 'enviando' WHERE id = $1`,
        [r1.id],
      );
      expect(enviando.error).toMatch(/pendiente a abierto u omitido/);
      // Un proceso sin usuario (cron con el rol de servicio) no puede despacharla.
      const cron = await servicioConError(
        `UPDATE public.outreach_campaign_recipients SET status = 'abierto' WHERE id = $1`,
        [r1.id],
      );
      expect(cron).toMatch(/nunca un proceso automático/);
      const persona = await como<{ processed_by: string }>(
        usuarios.owner,
        `UPDATE public.outreach_campaign_recipients SET status = 'abierto' WHERE id = $1 RETURNING processed_by`,
        [r1.id],
      );
      expect(persona.error).toBe("");
      expect(persona.filas[0].processed_by).toBe(usuarios.owner);
      const omitido = await como(
        usuarios.admin,
        `UPDATE public.outreach_campaign_recipients SET status = 'omitido', reason = 'A mano' WHERE id = $1`,
        [r2.id],
      );
      expect(omitido.error).toBe("");
    });
  });
});
