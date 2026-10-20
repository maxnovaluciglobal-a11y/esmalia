import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { calcularOutreachPendiente } from "@/lib/messaging/messaging.functions";

/**
 * Cola de outreach con las lecturas nuevas (auditoría de rendimiento,
 * 20-oct-2026): saldo por RPC, visitas por RPC y el resto acotado por fecha y
 * paginado. Verifica de punta a punta, contra la base local, las reglas que
 * más daño hacen si se rompen: no pedirle saldo a quien ya pagó, respetar el
 * cooldown, y sugerir el recall a quien hace más de 6 meses que no viene.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en el entorno (ver docs/TESTS.md).`);
  return value;
}

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const DIA = 24 * 60 * 60 * 1000;

describe("calcularOutreachPendiente", () => {
  let admin: SupabaseClient;
  let clinicId: string;
  let ownerUserId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: ownerRes } = await admin.auth.admin.createUser({
      email: `outreach-${randomUUID()}@esmalia-test.invalid`,
      password: `Out-${randomUUID()}`,
      email_confirm: true,
    });
    ownerUserId = ownerRes!.user!.id;
    const { data: clinic } = await admin
      .from("clinics")
      .insert({ name: "Clínica outreach", created_by: ownerUserId })
      .select("id")
      .single();
    clinicId = clinic!.id;

    const { data: pacientes, error } = await admin
      .from("patients")
      .insert(
        ["debe", "pago", "avisado", "recall", "sinOptIn"].map((clave) => ({
          clinic_id: clinicId,
          full_name: `Paciente ${clave}`,
          created_by: ownerUserId,
          wa_opt_in: clave !== "sinOptIn",
        })),
      )
      .select("id, full_name");
    if (error || !pacientes) throw new Error(`No se pudieron crear pacientes: ${error?.message}`);
    for (const p of pacientes) ids[p.full_name.replace("Paciente ", "")] = p.id;

    // Saldo: "debe" y "avisado" deben $10.000, "pago" pagó todo, "sinOptIn" debe pero no aceptó.
    for (const clave of ["debe", "pago", "avisado", "sinOptIn"]) {
      const { data: plan } = await admin
        .from("treatment_plans")
        .insert({
          clinic_id: clinicId,
          patient_id: ids[clave],
          name: `Plan ${clave}`,
          created_by: ownerUserId,
        })
        .select("id")
        .single();
      await admin.from("treatment_items").insert({
        clinic_id: clinicId,
        plan_id: plan!.id,
        name_snapshot: "Tratamiento",
        price_cents: 10_000,
      });
    }
    await admin.from("payments").insert({
      clinic_id: clinicId,
      patient_id: ids.pago,
      amount_cents: 10_000,
      created_by: ownerUserId,
    });
    // "avisado" ya recibió el aviso de saldo hace 3 días (cooldown de 14).
    const { error: msgErr } = await admin.from("messages").insert({
      clinic_id: clinicId,
      patient_id: ids.avisado,
      template_kind: "payment_due",
      channel: "whatsapp",
      direction: "outbound",
      body: "Hola",
      recipient: "+56900000000",
      created_at: new Date(Date.now() - 3 * DIA).toISOString(),
    });
    if (msgErr) throw new Error(`No se pudo crear el mensaje: ${msgErr.message}`);

    // "recall": última visita finalizada hace ~8 meses, sin cita futura.
    const { data: branch } = await admin
      .from("branches")
      .insert({ clinic_id: clinicId, name: "Centro" })
      .select("id")
      .single();
    const { data: prof } = await admin
      .from("professionals")
      .insert({ clinic_id: clinicId, full_name: "Dra. Outreach" })
      .select("id")
      .single();
    const inicio = new Date(Date.now() - 240 * DIA);
    const { error: apptErr } = await admin.from("appointments").insert({
      clinic_id: clinicId,
      branch_id: branch!.id,
      professional_id: prof!.id,
      patient_id: ids.recall,
      starts_at: inicio.toISOString(),
      ends_at: new Date(inicio.getTime() + 30 * 60_000).toISOString(),
      status: "finalizada",
      created_by: ownerUserId,
    });
    if (apptErr) throw new Error(`No se pudo crear la cita: ${apptErr.message}`);
  }, 60_000);

  afterAll(async () => {
    if (clinicId) {
      await admin.from("messages").delete().eq("clinic_id", clinicId);
      await admin.from("payments").delete().eq("clinic_id", clinicId);
      await admin.from("clinics").delete().eq("id", clinicId);
    }
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId);
  }, 60_000);

  it("pide saldo solo a quien debe, aceptó WhatsApp y no fue avisado hace poco", async () => {
    const items = await calcularOutreachPendiente(admin, clinicId, Date.now());
    const saldo = items.filter((i) => i.kind === "payment_due");
    expect(saldo.map((i) => i.patientId)).toEqual([ids.debe]);
    expect(saldo[0].balanceCents).toBe(10_000);
  });

  it("sugiere el recall de higiene a quien no viene hace más de 6 meses", async () => {
    const items = await calcularOutreachPendiente(admin, clinicId, Date.now());
    const recall = items.filter((i) => i.kind === "hygiene_recall");
    expect(recall.map((i) => i.patientId)).toEqual([ids.recall]);
    expect(recall[0].monthsSinceLastVisit).toBeGreaterThanOrEqual(7);
  });
});
