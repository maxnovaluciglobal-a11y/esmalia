import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { MENSAJE_SOLO_LECTURA } from "@/lib/solo-lectura";
import {
  clinicaDeLaFila,
  exigirEscritura,
  exigirEscrituraDeNotaClinica,
} from "@/lib/solo-lectura.server";

/**
 * Modo solo lectura contra la base efímera de tests (scripts/test-db), con
 * un usuario real logueado (anon key + RLS), el mismo camino que usa la app.
 * Comprueba lo que el test puro no puede: que un miembro lee su fila de
 * `subscriptions` y las citas con esas columnas, y que la excepción de
 * urgencia encuentra una cita real.
 *
 * Las server functions no se pueden invocar fuera de un request de TanStack
 * Start (ver finance-reports-permission.test.ts), así que se prueban los
 * helpers que llaman sus middlewares, con el mismo cliente y la misma clínica.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name} en el entorno. Este test corre contra la base local de ` +
        `scripts/test-db/start.sh (ver docs/TESTS.md).`,
    );
  }
  return value;
}

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const ANON_KEY = requiredEnv("SUPABASE_PUBLISHABLE_KEY");
const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const H = 60 * 60 * 1000;

describe("modo solo lectura contra la base (BIL-01)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let ownerUserId: string;
  let clinicId: string;
  let pacienteConCita: string;
  let pacienteSinCita: string;
  let citaId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const email = `solo-lectura-${randomUUID()}@esmalia-test.invalid`;
    const password = `Sl0-${randomUUID()}`;
    const { data: u, error: uErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (uErr || !u.user) throw new Error(`No se pudo crear el usuario: ${uErr?.message}`);
    ownerUserId = u.user.id;

    const { data: clinic, error: cErr } = await admin
      .from("clinics")
      .insert({ name: "Clínica solo lectura", created_by: ownerUserId })
      .select("id")
      .single();
    if (cErr || !clinic) throw new Error(`No se pudo crear la clínica: ${cErr?.message}`);
    clinicId = clinic.id as string;
    await admin
      .from("clinic_members")
      .upsert(
        { clinic_id: clinicId, user_id: ownerUserId, role: "owner" },
        { onConflict: "clinic_id,user_id" },
      );

    const { data: branch, error: bErr } = await admin
      .from("branches")
      .insert({ clinic_id: clinicId, name: "Sucursal prueba" })
      .select("id")
      .single();
    if (bErr || !branch) throw new Error(`No se pudo crear la sucursal: ${bErr?.message}`);
    const { data: pro, error: pErr } = await admin
      .from("professionals")
      .insert({ clinic_id: clinicId, full_name: "Dra. Prueba" })
      .select("id")
      .single();
    if (pErr || !pro) throw new Error(`No se pudo crear el profesional: ${pErr?.message}`);
    const { data: pacientes, error: paErr } = await admin
      .from("patients")
      .insert([
        { clinic_id: clinicId, full_name: "Paciente con cita", created_by: ownerUserId },
        { clinic_id: clinicId, full_name: "Paciente sin cita", created_by: ownerUserId },
      ])
      .select("id, full_name");
    if (paErr || !pacientes) throw new Error(`No se pudieron crear pacientes: ${paErr?.message}`);
    pacienteConCita = pacientes.find((p) => p.full_name === "Paciente con cita")!.id as string;
    pacienteSinCita = pacientes.find((p) => p.full_name === "Paciente sin cita")!.id as string;

    const ahora = Date.now();
    const { data: cita, error: aErr } = await admin
      .from("appointments")
      .insert({
        clinic_id: clinicId,
        branch_id: branch.id,
        professional_id: pro.id,
        patient_id: pacienteConCita,
        starts_at: new Date(ahora - 0.5 * H).toISOString(),
        ends_at: new Date(ahora + 0.5 * H).toISOString(),
        treatment_label: "Urgencia",
        created_by: ownerUserId,
      })
      .select("id")
      .single();
    if (aErr || !cita) throw new Error(`No se pudo crear la cita: ${aErr?.message}`);
    citaId = cita.id as string;

    owner = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: loginErr } = await owner.auth.signInWithPassword({ email, password });
    if (loginErr) throw new Error(`Login falló: ${loginErr.message}`);
  }, 60_000);

  afterAll(async () => {
    if (clinicId) await admin.from("clinics").delete().eq("id", clinicId);
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId);
  }, 60_000);

  it("con la prueba gratis vigente (clínica recién creada) se escribe", async () => {
    await expect(exigirEscritura(owner as never, clinicId)).resolves.toBeUndefined();
  });

  it("lee la clínica de una fila por id con la RLS del usuario", async () => {
    await expect(clinicaDeLaFila(owner as never, "appointments", citaId)).resolves.toBe(clinicId);
  });

  it("con la prueba vencida sin pago: solo lectura, salvo la nota de una cita en curso", async () => {
    const { data: fila, error } = await admin
      .from("subscriptions")
      .update({ trial_end: new Date(Date.now() - 24 * H).toISOString() })
      .eq("clinic_id", clinicId)
      .select("clinic_id")
      .maybeSingle();
    if (error) throw new Error(`No se pudo vencer la prueba: ${error.message}`);
    if (!fila) throw new Error("La clínica de prueba no tiene fila en subscriptions.");

    await expect(exigirEscritura(owner as never, clinicId)).rejects.toThrow(MENSAJE_SOLO_LECTURA);

    await expect(
      exigirEscrituraDeNotaClinica(owner as never, { clinicId, patientRef: pacienteConCita }),
    ).resolves.toBeUndefined();

    await expect(
      exigirEscrituraDeNotaClinica(owner as never, { clinicId, patientRef: pacienteSinCita }),
    ).rejects.toThrow(MENSAJE_SOLO_LECTURA);
  });
});
