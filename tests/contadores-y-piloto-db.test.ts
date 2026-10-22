import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { conectar, sembrarEscenario } from "./helpers/db";

/**
 * RPC de las migraciones 20261023300000_contadores_de_citas.sql (FIC-12) y
 * 20261023300100_resultados_del_piloto.sql (INF-14). Las dos son SECURITY
 * INVOKER: además de los números, se prueba que alguien de otra clínica no ve
 * nada, con el rol `authenticated` (la conexión de los tests es `postgres`,
 * dueña de las tablas, y un dueño saltea la RLS). Cada test corre en una
 * transacción que se descarta.
 */
describe("RPC de contadores de citas y resultados del piloto", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;
  let branchId: string;
  let profId: string;

  beforeAll(async () => {
    client = await conectar();
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('request.jwt.claims', '', true)`);
    const esc = await sembrarEscenario(client);
    clinicId = esc.clinicId;
    usuarios = esc.usuarios;
    await client.query(`UPDATE public.clinics SET timezone = 'America/Santiago' WHERE id = $1`, [
      clinicId,
    ]);
    [{ id: branchId }] = await filas<{ id: string }>(
      `INSERT INTO public.branches (clinic_id, name) VALUES ($1, 'Centro') RETURNING id`,
      [clinicId],
    );
    [{ id: profId }] = await filas<{ id: string }>(
      `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Prueba') RETURNING id`,
      [clinicId],
    );
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function filas<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await client.query(sql, params)).rows as T[];
  }

  async function paciente(nombre: string, origen: string | null = null): Promise<string> {
    const [{ id }] = await filas<{ id: string }>(
      `INSERT INTO public.patients (clinic_id, full_name, acquisition_source, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [clinicId, nombre, origen, usuarios.owner],
    );
    return id;
  }

  async function cita(pacienteId: string, inicio: string, estado: string, minutos = 30) {
    await client.query(
      `INSERT INTO public.appointments
         (clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at, status, created_by)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + make_interval(mins => $7),
               $6::public.appointment_status, $8)`,
      [clinicId, branchId, pacienteId, profId, inicio, estado, minutos, usuarios.owner],
    );
  }

  /** Corre la consulta como `authenticated` con la identidad dada. */
  async function como<T>(userId: string, sql: string, params: unknown[]): Promise<T[]> {
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("SAVEPOINT sp_rol");
    await client.query("SET LOCAL ROLE authenticated");
    try {
      return await filas<T>(sql, params);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT sp_rol");
    }
  }

  describe("patient_appointment_counters", () => {
    it("cuenta atendidas, inasistencias, anuladas, próximas y sin cerrar", async () => {
      const p = await paciente("Ana Contadora");
      const otro = await paciente("Otro paciente");
      await cita(p, "2025-05-01T13:00:00Z", "finalizada");
      await cita(p, "2026-03-10T13:00:00Z", "finalizada");
      await cita(p, "2026-04-10T13:00:00Z", "ausente");
      await cita(p, "2026-04-20T13:00:00Z", "cancelada");
      await cita(p, "2026-05-01T13:00:00Z", "confirmada"); // pasada sin cerrar
      await cita(p, "2099-01-10T13:00:00Z", "tentativa");
      await cita(p, "2099-02-10T13:00:00Z", "confirmada");
      await cita(p, "2099-03-10T13:00:00Z", "cancelada"); // futura anulada: no es próxima
      await cita(otro, "2026-03-11T13:00:00Z", "finalizada");

      const [c] = await filas<{
        attended: number;
        no_show: number;
        cancelled: number;
        upcoming: number;
        past_open: number;
        last_visit_at: Date;
        next_at: Date;
      }>(`SELECT * FROM public.patient_appointment_counters($1, $2)`, [clinicId, p]);
      expect(c).toMatchObject({
        attended: 2,
        no_show: 1,
        cancelled: 2,
        upcoming: 2,
        past_open: 1,
      });
      expect(new Date(c.last_visit_at).toISOString()).toBe("2026-03-10T13:00:00.000Z");
      expect(new Date(c.next_at).toISOString()).toBe("2099-01-10T13:00:00.000Z");
    });

    it("un miembro de la clínica lo ve; alguien de otra clínica no ve nada", async () => {
      const p = await paciente("Paciente RLS");
      await cita(p, "2026-03-10T13:00:00Z", "finalizada");
      const sql = `SELECT attended FROM public.patient_appointment_counters($1, $2)`;
      const [recepcion] = await como<{ attended: number }>(usuarios.reception, sql, [clinicId, p]);
      expect(recepcion.attended).toBe(1);
      const [externo] = await como<{ attended: number }>(usuarios.externo, sql, [clinicId, p]);
      expect(externo.attended).toBe(0);
    });
  });

  describe("pilot_results", () => {
    it("agrega el período en el huso de la clínica", async () => {
      const web = await paciente("Desde la web", "Instagram");
      const ig = await paciente("Otra de Instagram", "Instagram");
      const sinOrigen = await paciente("Sin origen");
      // Ficha fusionada en otra: era un duplicado, no es un paciente nuevo.
      const dup = await paciente("Duplicado", "Google");
      await client.query(
        `UPDATE public.patients SET merged_into = $1, merged_at = now() WHERE id = $2`,
        [web, dup],
      );

      // 1 de octubre 00:30 en Santiago (UTC-3) = 03:30 UTC: entra.
      await cita(web, "2026-10-01T03:30:00Z", "finalizada");
      // 30 de septiembre 23:30 en Santiago = 1 oct 02:30 UTC: queda afuera.
      await cita(web, "2026-10-01T02:30:00Z", "finalizada");
      await cita(ig, "2026-10-05T13:00:00Z", "ausente");
      await cita(ig, "2026-10-06T13:00:00Z", "confirmada");
      await cita(sinOrigen, "2026-10-07T13:00:00Z", "cancelada");

      const mensaje = (kind: string, status: string, direction = "outbound") =>
        client.query(
          `INSERT INTO public.messages
             (clinic_id, patient_id, channel, direction, status, template_kind, body, recipient, created_at)
           VALUES ($1, $2, 'whatsapp', $3::public.message_direction, $4::public.message_status,
                   $5::public.message_template_kind, 'hola', '+56900000000', '2026-10-03T15:00:00Z')`,
          [clinicId, web, direction, status, kind],
        );
      await mensaje("appointment_reminder", "sent");
      await mensaje("appointment_checkin", "delivered");
      await mensaje("appointment_reminder", "failed");
      await mensaje("hygiene_recall", "sent");

      const presupuesto = (status: string, total: number, n: string) =>
        client.query(
          `INSERT INTO public.quotes
             (clinic_id, patient_id, number, status, subtotal_cents, total_cents, created_by, created_at)
           VALUES ($1, $2, $3, $4::public.quote_status, $5, $5, $6, '2026-10-04T15:00:00Z')`,
          [clinicId, web, n, status, total, usuarios.owner],
        );
      await presupuesto("draft", 999_000, "P-1");
      await presupuesto("sent", 100_000, "P-2");
      await presupuesto("accepted", 250_000, "P-3");
      await presupuesto("converted", 50_000, "P-4");

      const pago = (cents: number, reversado: boolean) =>
        client.query(
          `INSERT INTO public.payments
             (clinic_id, patient_id, amount_cents, paid_at, created_by,
              reversed_at, reversed_by, reversal_reason)
           VALUES ($1, $2, $3, '2026-10-05T15:00:00Z', $4,
                   CASE WHEN $5 THEN now() END, CASE WHEN $5 THEN $4::uuid END,
                   CASE WHEN $5 THEN 'Cargado dos veces' END)`,
          [clinicId, web, cents, usuarios.owner, reversado],
        );
      await pago(80_000, false);
      await pago(20_000, false);
      await pago(500_000, true);

      const desde = "2026-10-01";
      const hasta = "2099-12-31";
      const [r] = await filas<Record<string, unknown>>(
        `SELECT * FROM public.pilot_results($1, $2::date, $3::date)`,
        [clinicId, desde, hasta],
      );
      expect(r).toMatchObject({
        appointments_scheduled: 3,
        appointments_attended: 1,
        appointments_no_show: 1,
        appointments_cancelled: 1,
        reminders_sent: 2,
        quotes_issued: 3,
        quotes_accepted: 2,
        payments_count: 2,
      });
      // bigint llega como string desde pg.
      expect(Number(r.quotes_issued_cents)).toBe(400_000);
      expect(Number(r.quotes_accepted_cents)).toBe(300_000);
      expect(Number(r.collected_cents)).toBe(100_000);
      // Los pacientes se crearon "ahora" (dentro del rango): 3, sin el duplicado.
      expect(r.patients_new).toBe(3);
      expect(r.patients_by_source).toEqual([
        { source: "Instagram", count: 2 },
        { source: null, count: 1 },
      ]);
    });

    it("alguien de otra clínica no ve nada", async () => {
      const p = await paciente("Paciente RLS", "Google");
      await cita(p, "2026-10-05T13:00:00Z", "finalizada");
      const sql = `SELECT appointments_scheduled, patients_new FROM public.pilot_results($1, '2026-01-01', '2099-12-31')`;
      const [owner] = await como<{ appointments_scheduled: number; patients_new: number }>(
        usuarios.owner,
        sql,
        [clinicId],
      );
      expect(owner).toEqual({ appointments_scheduled: 1, patients_new: 1 });
      const [externo] = await como<{ appointments_scheduled: number; patients_new: number }>(
        usuarios.externo,
        sql,
        [clinicId],
      );
      expect(externo).toEqual({ appointments_scheduled: 0, patients_new: 0 });
    });
  });
});
