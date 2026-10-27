import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { DEMO_CLINIC_ID } from "@/lib/demo/ola9.server";
import { mesDe, sumarMeses } from "@/lib/finance/gastos-fijos";

/**
 * Paso de `/api/demo-reset` con los datos de ejemplo de finanzas (Ola 10 ·
 * frente A): tres gastos fijos (el arriendo ya confirmado este mes, luz y
 * software por confirmar), una empresa con convenio y descuento por planilla
 * con dos afiliados, un plan de membresía con dos inscritos y sus cuotas del
 * mes (una cobrada y otra por cobrar) y el folio de la boleta de los dos
 * últimos pagos.
 *
 * Idempotente: si la demo ya tiene planes de membresía, no siembra nada.
 * Nunca lanza: un error se registra y el reset sigue. Corre con el rol de
 * servicio, que pasa `block_demo_writes`.
 */

type Admin = SupabaseClient<Database>;

/** Usuario dueño de la clínica demo (`reset_demo_clinic`). */
const DEMO_USER_ID = "139dd209-8495-415c-b6cd-6bbc63367bad";

function hoyEn(zona: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function sembrarFinanzasDeLaDemo(admin: Admin): Promise<void> {
  try {
    const { data: clinica } = await admin
      .from("clinics")
      .select("id, timezone")
      .eq("id", DEMO_CLINIC_ID)
      .eq("is_demo", true)
      .maybeSingle();
    if (!clinica) return;
    const clinicId = clinica.id;
    const hoy = hoyEn(clinica.timezone || "America/Santiago");
    const mes = mesDe(hoy);

    const { count } = await admin
      .from("membership_plans")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId);
    if ((count ?? 0) > 0) return;

    const { data: pacientes } = await admin
      .from("patients")
      .select("id")
      .eq("clinic_id", clinicId)
      .is("archived_at", null)
      .is("merged_into", null)
      .order("full_name")
      .limit(6);
    const lista = pacientes ?? [];
    if (lista.length < 4) return;

    // Gastos fijos: el arriendo ya se confirmó este mes.
    const { data: fijos, error: errFijos } = await admin
      .from("recurring_expenses")
      .insert([
        {
          clinic_id: clinicId,
          category: "Arriendo",
          description: "Arriendo de la consulta",
          supplier: "Inmobiliaria Los Leones",
          amount_cents: 850_000,
          day_of_month: 5,
          starts_on: sumarMeses(mes, -6),
          created_by: DEMO_USER_ID,
        },
        {
          clinic_id: clinicId,
          category: "Luz",
          description: "Cuenta de la luz",
          supplier: "Enel",
          amount_cents: 68_000,
          day_of_month: 20,
          starts_on: sumarMeses(mes, -6),
          created_by: DEMO_USER_ID,
        },
        {
          clinic_id: clinicId,
          category: "Software",
          description: "Esmalia, plan Clínica",
          amount_cents: 65_000,
          day_of_month: 1,
          starts_on: sumarMeses(mes, -2),
          created_by: DEMO_USER_ID,
        },
      ])
      .select("id, category, description, supplier, amount_cents, day_of_month");
    if (errFijos) throw errFijos;
    const arriendo = (fijos ?? []).find((f) => f.category === "Arriendo");
    if (arriendo) {
      await admin.from("expenses").insert({
        clinic_id: clinicId,
        category: arriendo.category,
        description: arriendo.description,
        supplier: arriendo.supplier,
        amount_cents: arriendo.amount_cents,
        incurred_on: `${mes.slice(0, 8)}05`,
        recurring_expense_id: arriendo.id,
        recurring_period: mes,
        created_by: DEMO_USER_ID,
      });
    }

    // Empresa con convenio y dos afiliados.
    const { data: empresa, error: errEmp } = await admin
      .from("partner_companies")
      .insert({
        clinic_id: clinicId,
        name: "Constructora Andes",
        tax_id: "76.123.456-7",
        contact_name: "Paula Rivas (RR. HH.)",
        contact_email: "rrhh@constructora-andes.example",
        discount_kind: "percent",
        discount_percent: 15,
        payroll_deduction: true,
        notes: "Planilla con corte el día 25.",
        created_by: DEMO_USER_ID,
      })
      .select("id")
      .single();
    if (errEmp) throw errEmp;
    await admin.from("partner_company_patients").insert([
      {
        clinic_id: clinicId,
        company_id: empresa.id,
        patient_id: lista[0].id,
        employee_code: "CA-1042",
        since: sumarMeses(mes, -3),
        created_by: DEMO_USER_ID,
      },
      {
        clinic_id: clinicId,
        company_id: empresa.id,
        patient_id: lista[1].id,
        employee_code: "CA-1187",
        since: sumarMeses(mes, -1),
        created_by: DEMO_USER_ID,
      },
    ]);

    // Plan de membresía con dos inscritos y las cuotas del mes.
    const { data: plan, error: errPlan } = await admin
      .from("membership_plans")
      .insert({
        clinic_id: clinicId,
        name: "Plan Sonrisa",
        description: "Prevención todo el año con cuota fija.",
        benefits: ["2 limpiezas al año", "Urgencias sin costo de consulta", "10 % en tratamientos"],
        fee_cents: 15_000,
        billing_period: "monthly",
        treatment_discount_percent: 10,
        created_by: DEMO_USER_ID,
      })
      .select("id")
      .single();
    if (errPlan) throw errPlan;
    for (const p of [lista[2], lista[3]]) {
      await admin.from("patient_memberships").insert({
        clinic_id: clinicId,
        patient_id: p.id,
        plan_id: plan.id,
        starts_on: sumarMeses(mes, -2),
        created_by: DEMO_USER_ID,
      });
    }
    await admin.rpc("generar_cuotas_de_membresia", {
      p_clinic_id: clinicId,
      p_periodo: mes,
      p_confirmar: true,
    });
    // La cuota cobrada pasa por `payments` y por la caja (cierre, ítem 1): en
    // efectivo, así se ve en el arqueo de la caja abierta de la demo.
    const { data: cuotas } = await admin
      .from("membership_charges")
      .select("id, patient_id, amount_cents")
      .eq("clinic_id", clinicId)
      .eq("period_start", mes)
      .order("id")
      .limit(1);
    const cuota = cuotas?.[0];
    if (cuota) {
      const [{ data: efectivo }, { data: caja }] = await Promise.all([
        admin
          .from("payment_methods")
          .select("id, name")
          .eq("clinic_id", clinicId)
          .eq("legacy_key", "cash")
          .limit(1)
          .maybeSingle(),
        admin
          .from("cash_registers")
          .select("id")
          .eq("clinic_id", clinicId)
          .eq("status", "open")
          .order("opened_at")
          .limit(1)
          .maybeSingle(),
      ]);
      const { data: pago } = await admin
        .from("payments")
        .insert({
          clinic_id: clinicId,
          patient_id: cuota.patient_id,
          amount_cents: cuota.amount_cents,
          method: "cash",
          payment_method_id: efectivo?.id ?? null,
          method_name_snapshot: efectivo?.name ?? "Efectivo",
          membership_charge_id: cuota.id,
          cash_register_id: caja?.id ?? null,
          notes: "Cuota de membresía · Plan Sonrisa",
          created_by: DEMO_USER_ID,
        })
        .select("id")
        .single();
      if (pago) {
        await admin
          .from("membership_charges")
          .update({
            status: "paid",
            paid_at: new Date().toISOString(),
            payment_method_id: efectivo?.id ?? null,
            method_name_snapshot: efectivo?.name ?? "Efectivo",
          })
          .eq("id", cuota.id);
      }
    }

    // Folio de la boleta de los dos últimos pagos (emitida en el SII).
    const { data: pagos } = await admin
      .from("payments")
      .select("id, paid_at")
      .eq("clinic_id", clinicId)
      .is("reversed_at", null)
      .is("membership_charge_id", null)
      .order("paid_at", { ascending: false })
      .limit(2);
    let folio = 4120;
    for (const p of pagos ?? []) {
      await admin.from("payment_receipts").insert({
        clinic_id: clinicId,
        payment_id: p.id,
        doc_type: "boleta",
        folio: String(folio++),
        issued_on: p.paid_at.slice(0, 10),
        issuer: "SII",
        created_by: DEMO_USER_ID,
      });
    }
  } catch (e) {
    console.error("[demo-reset] no se pudieron sembrar las finanzas de la Ola 10", e);
  }
}
