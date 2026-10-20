import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { conectar, sembrarEscenario } from "./helpers/db";
import {
  versionVigente,
  versionVigenteSegunCoincidencia,
} from "../src/lib/clinical/clinical-notes";

/**
 * RPC de la migración 20261020140000_consultas_agregadas.sql (auditoría de
 * rendimiento, 20-oct-2026). `patient_balances` tiene su propio test contra la
 * suma en JS de antes (fetch-patient-balances.test.ts); acá van las otras dos.
 * Cada test corre en una transacción que se descarta.
 */
describe("RPC de consultas agregadas", () => {
  let client: Client;
  let clinicId: string;
  let usuarios: Record<string, string>;

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
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function filas<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await client.query(sql, params)).rows as T[];
  }

  describe("clinical_note_versions_meta", () => {
    it("marca la vigente igual que versionVigente y no devuelve el contenido entero", async () => {
      const [{ id: noteId }] = await filas<{ id: string }>(
        `INSERT INTO public.clinical_notes (clinic_id, patient_ref, title, content, status, created_by)
         VALUES ($1, 'pac-agg', 'Control', 'vigente', 'draft', $2) RETURNING id`,
        [clinicId, usuarios.dentist],
      );
      const largo = "x".repeat(1_000);
      const versiones = [
        { version: 1, title: "Control", content: largo },
        { version: 2, title: "Control", content: "vigente" },
        // Guardado offline en conflicto: número más alto, contenido que no quedó.
        { version: 3, title: "Control", content: "huérfana" },
      ];
      for (const v of versiones) {
        await client.query(
          `INSERT INTO public.clinical_note_versions (note_id, clinic_id, version, title, content, author_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [noteId, clinicId, v.version, v.title, v.content, usuarios.dentist],
        );
      }

      const meta = await filas<{ version: number; preview: string; matches_note: boolean }>(
        `SELECT version, preview, matches_note
         FROM public.clinical_note_versions_meta($1, ARRAY[$2]::uuid[]) ORDER BY version`,
        [clinicId, noteId],
      );
      expect(meta.map((m) => m.matches_note)).toEqual([false, true, false]);
      expect(meta[0].preview).toHaveLength(280);
      expect(
        versionVigenteSegunCoincidencia(
          meta.map((m) => ({ version: m.version, coincide: m.matches_note })),
        ),
      ).toBe(versionVigente({ title: "Control", content: "vigente" }, versiones));
    });

    it("no devuelve versiones de otra clínica aunque se pase el id de la nota", async () => {
      const [{ id: otraClinica }] = await filas<{ id: string }>(
        `INSERT INTO public.clinics (name, created_by) VALUES ('Otra clínica', $1) RETURNING id`,
        [usuarios.externo],
      );
      const [{ id: notaAjena }] = await filas<{ id: string }>(
        `INSERT INTO public.clinical_notes (clinic_id, patient_ref, title, content, status, created_by)
         VALUES ($1, 'pac-ajeno', 'Ajena', 'texto', 'draft', $2) RETURNING id`,
        [otraClinica, usuarios.externo],
      );
      await client.query(
        `INSERT INTO public.clinical_note_versions (note_id, clinic_id, version, title, content, author_id)
         VALUES ($1, $2, 1, 'Ajena', 'texto', $3)`,
        [notaAjena, otraClinica, usuarios.externo],
      );
      const meta = await filas(
        `SELECT * FROM public.clinical_note_versions_meta($1, ARRAY[$2]::uuid[])`,
        [clinicId, notaAjena],
      );
      expect(meta).toHaveLength(0);
    });
  });

  describe("outreach_patient_visits", () => {
    it("última visita finalizada y cita futura, solo de pacientes con WhatsApp habilitado", async () => {
      const [{ id: branchId }] = await filas<{ id: string }>(
        `INSERT INTO public.branches (clinic_id, name) VALUES ($1, 'Centro') RETURNING id`,
        [clinicId],
      );
      const [{ id: profId }] = await filas<{ id: string }>(
        `INSERT INTO public.professionals (clinic_id, full_name) VALUES ($1, 'Dra. Prueba') RETURNING id`,
        [clinicId],
      );
      const pacientes = await filas<{ id: string; full_name: string }>(
        `INSERT INTO public.patients (clinic_id, full_name, wa_opt_in, wa_opt_out_at, created_by)
         VALUES ($1, 'Con visitas', true, null, $2),
                ($1, 'De baja', true, now(), $2),
                ($1, 'Sin opt-in', false, null, $2),
                ($1, 'Sin finalizadas', true, null, $2)
         RETURNING id, full_name`,
        [clinicId, usuarios.owner],
      );
      const id = (nombre: string) => pacientes.find((p) => p.full_name === nombre)!.id;
      const cita = (paciente: string, inicio: string, estado: string) =>
        client.query(
          `INSERT INTO public.appointments
             (clinic_id, branch_id, patient_id, professional_id, starts_at, ends_at, status, created_by)
           VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '30 minutes',
                   $6::public.appointment_status, $7)`,
          [clinicId, branchId, paciente, profId, inicio, estado, usuarios.owner],
        );
      await cita(id("Con visitas"), "2025-01-10T10:00:00Z", "finalizada");
      await cita(id("Con visitas"), "2026-03-10T10:00:00Z", "finalizada");
      await cita(id("Con visitas"), "2099-01-01T10:00:00Z", "confirmada");
      await cita(id("De baja"), "2026-03-10T10:00:00Z", "finalizada");
      await cita(id("Sin opt-in"), "2026-03-10T10:00:00Z", "finalizada");
      await cita(id("Sin finalizadas"), "2099-01-01T10:00:00Z", "cancelada");

      const visitas = await filas<{ patient_id: string; last_visit_at: Date; has_future: boolean }>(
        `SELECT * FROM public.outreach_patient_visits($1)`,
        [clinicId],
      );
      expect(visitas).toHaveLength(1);
      expect(visitas[0].patient_id).toBe(id("Con visitas"));
      expect(new Date(visitas[0].last_visit_at).toISOString()).toBe("2026-03-10T10:30:00.000Z");
      expect(visitas[0].has_future).toBe(true);
    });
  });
});
