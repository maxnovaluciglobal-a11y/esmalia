import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { fetchPatientBalances } from "@/lib/patients/patients.functions";

/**
 * La implementación anterior a la RPC `patient_balances` (20-oct-2026),
 * copiada tal cual: filas crudas sumadas en JS. Sirve de referencia para
 * probar que la RPC calcula exactamente lo mismo sobre los mismos datos (con
 * menos de 1000 filas, que es donde la versión vieja no se cortaba).
 */
async function saldosComoAntes(
  supabase: SupabaseClient,
  clinicId: string,
  patientId?: string,
): Promise<Map<string, { billedCents: number; paidCents: number }>> {
  let billedQuery = supabase
    .from("treatment_items")
    .select("price_cents, patient_cents, treatment_plans!inner(patient_id, clinic_id, status)")
    .eq("clinic_id", clinicId)
    .neq("treatment_plans.status", "cancelled");
  let paidQuery = supabase
    .from("payments")
    .select("patient_id, amount_cents")
    .eq("clinic_id", clinicId)
    .is("reversed_at", null);
  if (patientId) {
    billedQuery = billedQuery.eq("treatment_plans.patient_id", patientId);
    paidQuery = paidQuery.eq("patient_id", patientId);
  }
  const [{ data: billedRows, error: billedErr }, { data: paidRows, error: paidErr }] =
    await Promise.all([billedQuery, paidQuery]);
  if (billedErr) throw billedErr;
  if (paidErr) throw paidErr;
  const byPatient = new Map<string, { billedCents: number; paidCents: number }>();
  for (const r of billedRows ?? []) {
    const pid = (r as unknown as { treatment_plans: { patient_id: string } }).treatment_plans
      .patient_id;
    const cur = byPatient.get(pid) ?? { billedCents: 0, paidCents: 0 };
    const fila = r as { price_cents: number; patient_cents: number | null };
    cur.billedCents += fila.patient_cents ?? fila.price_cents ?? 0;
    byPatient.set(pid, cur);
  }
  for (const r of (paidRows ?? []) as Array<{ patient_id: string; amount_cents: number }>) {
    const cur = byPatient.get(r.patient_id) ?? { billedCents: 0, paidCents: 0 };
    cur.paidCents += r.amount_cents ?? 0;
    byPatient.set(r.patient_id, cur);
  }
  return byPatient;
}

/** Map → objeto ordenado, para comparar sin depender del orden de inserción. */
function comoObjeto(m: Map<string, { billedCents: number; paidCents: number }>) {
  return Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Regresión de la unificación 01-sep-2026: `getPatient`
 * (patients.functions.ts) y `listPendingOutreach` (messaging.functions.ts)
 * reimplementaban por separado "total facturado en treatment_items (excluye
 * planes cancelled) menos total pagado en payments". `fetchPatientBalances`
 * es ahora la única fuente — si este test se pone rojo, las dos pantallas
 * (ficha del paciente y el aviso de payment_due) se desincronizan otra vez.
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name} en el entorno. Este test necesita SUPABASE_URL y ` +
        `SUPABASE_SERVICE_ROLE_KEY (mismos nombres que .env) exportados en el ` +
        `shell antes de correr \`npm run test\` — no se leen automáticamente desde .env.`,
    );
  }
  return value;
}

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = requiredEnv("SUPABASE_PUBLISHABLE_KEY");

describe("fetchPatientBalances — saldo unificado", () => {
  let admin: SupabaseClient;
  let clinicId: string;
  let ownerUserId: string;
  let patientAId: string;
  let patientBId: string;
  let patientCId: string;
  let patientDId: string;
  let patientEId: string;
  let otherClinicId: string;
  let otherOwnerId: string;
  let ownerPassword: string;
  let ownerEmail: string;
  let otherOwnerEmail: string;
  let otherOwnerPassword: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    ownerEmail = `balances-owner-${randomUUID()}@esmalia-test.invalid`;
    ownerPassword = `Bal-${randomUUID()}`;
    const { data: ownerRes, error: ownerErr } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    });
    if (ownerErr || !ownerRes.user) {
      throw new Error(`No se pudo crear usuario de prueba: ${ownerErr?.message}`);
    }
    ownerUserId = ownerRes.user.id;

    const { data: clinic, error: clinicErr } = await admin
      .from("clinics")
      .insert({ name: "Clínica balances smoke", created_by: ownerUserId })
      .select("id")
      .single();
    if (clinicErr || !clinic) throw new Error(`No se pudo crear clínica: ${clinicErr?.message}`);
    clinicId = clinic.id;

    const { data: patients, error: patErr } = await admin
      .from("patients")
      .insert([
        { clinic_id: clinicId, full_name: "Paciente A", created_by: ownerUserId },
        { clinic_id: clinicId, full_name: "Paciente B", created_by: ownerUserId },
      ])
      .select("id");
    if (patErr || !patients) throw new Error(`No se pudieron crear pacientes: ${patErr?.message}`);
    patientAId = patients[0].id;
    patientBId = patients[1].id;

    // Paciente A: plan activo de $10.000 + pago de $4.000 → debe $6.000.
    const { data: planA, error: planAErr } = await admin
      .from("treatment_plans")
      .insert({
        clinic_id: clinicId,
        patient_id: patientAId,
        name: "Plan A",
        created_by: ownerUserId,
      })
      .select("id")
      .single();
    if (planAErr || !planA) throw new Error(`No se pudo crear plan A: ${planAErr?.message}`);
    await admin.from("treatment_items").insert({
      clinic_id: clinicId,
      plan_id: planA.id,
      name_snapshot: "Item A",
      price_cents: 10_000,
    });
    await admin.from("payments").insert({
      clinic_id: clinicId,
      patient_id: patientAId,
      amount_cents: 4_000,
      created_by: ownerUserId,
    });

    // Mismo paciente A: plan CANCELLED de $50.000 — no debe contar en el saldo.
    const { data: planCancelled, error: planCancelledErr } = await admin
      .from("treatment_plans")
      .insert({
        clinic_id: clinicId,
        patient_id: patientAId,
        name: "Plan cancelado",
        created_by: ownerUserId,
        status: "cancelled",
      })
      .select("id")
      .single();
    if (planCancelledErr || !planCancelled) {
      throw new Error(`No se pudo crear plan cancelado: ${planCancelledErr?.message}`);
    }
    await admin.from("treatment_items").insert({
      clinic_id: clinicId,
      plan_id: planCancelled.id,
      name_snapshot: "Item cancelado",
      price_cents: 50_000,
    });

    // Paciente B queda sin ninguna facturación ni pago a propósito.

    // Paciente C: plan con convenio. La prestación vale $100.000 pero el
    // convenio cubre $60.000, así que el paciente solo debe $40.000. Es el
    // caso que introdujo la Tanda B y el que más fácil se rompe: si el saldo
    // sumara `price_cents`, le cobraríamos $100.000 a alguien que debe menos
    // de la mitad.
    const { data: pacienteC } = await admin
      .from("patients")
      .insert({
        clinic_id: clinicId,
        full_name: "Paciente C con convenio",
        created_by: ownerUserId,
      })
      .select("id")
      .single();
    patientCId = pacienteC!.id;

    const { data: planConvenio } = await admin
      .from("treatment_plans")
      .insert({
        clinic_id: clinicId,
        patient_id: patientCId,
        name: "Plan con convenio",
        created_by: ownerUserId,
      })
      .select("id")
      .single();

    await admin.from("treatment_items").insert([
      {
        clinic_id: clinicId,
        plan_id: planConvenio!.id,
        name_snapshot: "Cubierta al 60%",
        price_cents: 100_000,
        coverage_cents: 60_000,
        patient_cents: 40_000,
      },
      {
        // Cobertura total: `patient_cents` en 0 es un valor real, no un
        // "sin dato". Si el código cayera a `price_cents` acá, este paciente
        // debería $25.000 que el convenio ya pagó.
        clinic_id: clinicId,
        plan_id: planConvenio!.id,
        name_snapshot: "Cubierta al 100%",
        price_cents: 25_000,
        coverage_cents: 25_000,
        patient_cents: 0,
      },
      {
        // Sin convenio en la misma línea: cae a price_cents como siempre.
        clinic_id: clinicId,
        plan_id: planConvenio!.id,
        name_snapshot: "Sin cobertura",
        price_cents: 15_000,
      },
    ]);

    // Paciente D: sin plan, un pago vigente y uno REVERSADO (no cuenta).
    // Paciente E: un plan en borrador con una línea de $0 (aparece con saldo
    // cero: tiene algo facturado, aunque sea nada) y un pago a favor.
    const { data: masPacientes } = await admin
      .from("patients")
      .insert([
        { clinic_id: clinicId, full_name: "Paciente D", created_by: ownerUserId },
        { clinic_id: clinicId, full_name: "Paciente E", created_by: ownerUserId },
      ])
      .select("id");
    patientDId = masPacientes![0].id;
    patientEId = masPacientes![1].id;
    const { error: pagosErr } = await admin.from("payments").insert([
      { clinic_id: clinicId, patient_id: patientDId, amount_cents: 7_000, created_by: ownerUserId },
      {
        clinic_id: clinicId,
        patient_id: patientDId,
        amount_cents: 3_000,
        created_by: ownerUserId,
        reversed_at: new Date().toISOString(),
        reversed_by: ownerUserId,
        reversal_reason: "Cobro duplicado",
      },
      { clinic_id: clinicId, patient_id: patientEId, amount_cents: 1_500, created_by: ownerUserId },
    ]);
    if (pagosErr) throw new Error(`No se pudieron crear pagos: ${pagosErr.message}`);
    const { data: planE } = await admin
      .from("treatment_plans")
      .insert({
        clinic_id: clinicId,
        patient_id: patientEId,
        name: "Plan E",
        created_by: ownerUserId,
      })
      .select("id")
      .single();
    await admin.from("treatment_items").insert({
      clinic_id: clinicId,
      plan_id: planE!.id,
      name_snapshot: "Control sin costo",
      price_cents: 0,
    });

    // Otra clínica con su propio paciente y deuda: no puede filtrarse.
    otherOwnerEmail = `balances-otro-${randomUUID()}@esmalia-test.invalid`;
    otherOwnerPassword = `Bal-${randomUUID()}`;
    const { data: otroRes } = await admin.auth.admin.createUser({
      email: otherOwnerEmail,
      password: otherOwnerPassword,
      email_confirm: true,
    });
    otherOwnerId = otroRes!.user!.id;
    const { data: otraClinica } = await admin
      .from("clinics")
      .insert({ name: "Clínica balances ajena", created_by: otherOwnerId })
      .select("id")
      .single();
    otherClinicId = otraClinica!.id;
    const { data: ajeno } = await admin
      .from("patients")
      .insert({ clinic_id: otherClinicId, full_name: "Paciente ajeno", created_by: otherOwnerId })
      .select("id")
      .single();
    const { data: planAjeno } = await admin
      .from("treatment_plans")
      .insert({
        clinic_id: otherClinicId,
        patient_id: ajeno!.id,
        name: "Plan ajeno",
        created_by: otherOwnerId,
      })
      .select("id")
      .single();
    await admin.from("treatment_items").insert({
      clinic_id: otherClinicId,
      plan_id: planAjeno!.id,
      name_snapshot: "Item ajeno",
      price_cents: 99_000,
    });
  }, 60_000);

  afterAll(async () => {
    if (clinicId) await admin.from("clinics").delete().eq("id", clinicId);
    if (otherClinicId) await admin.from("clinics").delete().eq("id", otherClinicId);
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId);
    if (otherOwnerId) await admin.auth.admin.deleteUser(otherOwnerId);
  }, 60_000);

  it("calcula el saldo de un solo paciente, ignorando el plan cancelled", async () => {
    const balances = await fetchPatientBalances(admin, clinicId, patientAId);
    expect(balances.get(patientAId)).toEqual({ billedCents: 10_000, paidCents: 4_000 });
  });

  it("en modo clínica entera agrupa por paciente y omite a quien no tiene actividad", async () => {
    const balances = await fetchPatientBalances(admin, clinicId);
    expect(balances.get(patientAId)).toEqual({ billedCents: 10_000, paidCents: 4_000 });
    expect(balances.has(patientBId)).toBe(false);
  });

  it("con convenio, el saldo es lo que debe el PACIENTE y no el precio de lista", async () => {
    // 40.000 (cubierta al 60%) + 0 (cubierta al 100%) + 15.000 (sin convenio)
    // = 55.000. El precio de lista de esas tres líneas suma 140.000.
    const balances = await fetchPatientBalances(admin, clinicId, patientCId);
    expect(balances.get(patientCId)).toEqual({ billedCents: 55_000, paidCents: 0 });
  });

  it("una línea cubierta al 100% aporta cero, no su precio de lista", async () => {
    // Regresión del bug más fácil de cometer acá: usar `||` en vez de `??`
    // hace que un `patient_cents` de 0 caiga al precio y el paciente termine
    // debiendo algo que el convenio ya pagó.
    const balances = await fetchPatientBalances(admin, clinicId, patientCId);
    expect(balances.get(patientCId)!.billedCents).toBeLessThan(140_000);
  });

  it("la RPC calcula exactamente lo mismo que la suma en JS de antes (clínica entera)", async () => {
    const nuevo = await fetchPatientBalances(admin, clinicId);
    const viejo = await saldosComoAntes(admin, clinicId);
    expect(comoObjeto(nuevo)).toEqual(comoObjeto(viejo));
    // Y los casos borde quedan como se espera, no solo "iguales".
    expect(nuevo.get(patientDId)).toEqual({ billedCents: 0, paidCents: 7_000 });
    expect(nuevo.get(patientEId)).toEqual({ billedCents: 0, paidCents: 1_500 });
    expect(nuevo.size).toBe(4); // A, C, D, E — B no tiene movimiento
  });

  it("la RPC calcula lo mismo que antes paciente por paciente", async () => {
    for (const id of [patientAId, patientBId, patientCId, patientDId, patientEId]) {
      const nuevo = await fetchPatientBalances(admin, clinicId, id);
      const viejo = await saldosComoAntes(admin, clinicId, id);
      expect(comoObjeto(nuevo)).toEqual(comoObjeto(viejo));
    }
  });

  it("con una lista de pacientes devuelve solo esos", async () => {
    const balances = await fetchPatientBalances(admin, clinicId, [
      patientAId,
      patientDId,
      patientBId,
    ]);
    expect([...balances.keys()].sort()).toEqual([patientAId, patientDId].sort());
    expect(await fetchPatientBalances(admin, clinicId, [])).toEqual(new Map());
  });

  it("respeta la RLS: el dueño ve su clínica, otro usuario no ve nada", async () => {
    const comoDuenio = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: e1 } = await comoDuenio.auth.signInWithPassword({
      email: ownerEmail,
      password: ownerPassword,
    });
    expect(e1).toBeNull();
    expect(comoObjeto(await fetchPatientBalances(comoDuenio, clinicId))).toEqual(
      comoObjeto(await fetchPatientBalances(admin, clinicId)),
    );

    const comoAjeno = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: e2 } = await comoAjeno.auth.signInWithPassword({
      email: otherOwnerEmail,
      password: otherOwnerPassword,
    });
    expect(e2).toBeNull();
    expect((await fetchPatientBalances(comoAjeno, clinicId)).size).toBe(0);
  });
});

describe("fetchPatientBalances — más de 1000 pacientes con movimiento", () => {
  let admin: SupabaseClient;
  let clinicId: string;
  let ownerUserId: string;
  const PACIENTES = 1_105;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: ownerRes } = await admin.auth.admin.createUser({
      email: `balances-mil-${randomUUID()}@esmalia-test.invalid`,
      password: `Bal-${randomUUID()}`,
      email_confirm: true,
    });
    ownerUserId = ownerRes!.user!.id;
    const { data: clinic } = await admin
      .from("clinics")
      .insert({ name: "Clínica balances volumen", created_by: ownerUserId })
      .select("id")
      .single();
    clinicId = clinic!.id;
    const { data: pacientes, error } = await admin
      .from("patients")
      .insert(
        Array.from({ length: PACIENTES }, (_, i) => ({
          clinic_id: clinicId,
          full_name: `Paciente volumen ${i}`,
          created_by: ownerUserId,
        })),
      )
      .select("id");
    if (error || !pacientes) throw new Error(`No se pudieron crear pacientes: ${error?.message}`);
    const { error: payErr } = await admin.from("payments").insert(
      pacientes.map((p) => ({
        clinic_id: clinicId,
        patient_id: p.id,
        amount_cents: 1_000,
        created_by: ownerUserId,
      })),
    );
    if (payErr) throw new Error(`No se pudieron crear pagos: ${payErr.message}`);
  }, 120_000);

  afterAll(async () => {
    if (clinicId) {
      await admin.from("payments").delete().eq("clinic_id", clinicId);
      await admin.from("clinics").delete().eq("id", clinicId);
    }
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId);
  }, 120_000);

  it("no se corta en las 1000 filas de PostgREST (la versión vieja sí)", async () => {
    const balances = await fetchPatientBalances(admin, clinicId);
    expect(balances.size).toBe(PACIENTES);
    // La suma en JS de antes perdía pacientes en silencio: es el bug.
    const viejo = await saldosComoAntes(admin, clinicId);
    expect(viejo.size).toBeLessThan(PACIENTES);
  });
});
