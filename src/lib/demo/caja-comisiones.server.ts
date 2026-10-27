import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { DEMO_CLINIC_ID } from "@/lib/demo/ola9.server";
import {
  detalleParaGuardar,
  diaAnterior,
  fechaEnZona,
  liquidar,
  type VersionRegla,
} from "@/lib/finance/comisiones-vigencia";

/**
 * Paso de `/api/demo-reset` con los datos de ejemplo de la Ola 10 · frente B:
 *
 * - Caja por operador (CAJ-02 a CAJ-05): la caja abierta de la semilla pasa
 *   a ser la de la cuenta demo; se abre una segunda caja de recepción con
 *   dos cobros en efectivo, y se registran un traspaso entre las dos y un
 *   depósito al banco. Así /cajas muestra "Mi caja", los movimientos y la
 *   vista del día por caja.
 * - Comisiones (COM-02 a COM-05): la Dra. Herrera cambia de 40 % sobre lo
 *   realizado a 45 % sobre lo cobrado desde el primer día del mes (rige
 *   desde), el Dr. Reyes tiene una regla por prestación para la instalación
 *   de brackets, y el mes pasado queda liquidado (foto congelada) para los
 *   dos con regla de porcentaje.
 *
 * Corre con el rol de servicio (pasa `block_demo_writes` y las guardas de
 * las tablas). Idempotente y nunca lanza: un error se registra y el reset
 * sigue.
 */

type Admin = SupabaseClient<Database>;

/** Usuario dueño de la clínica demo (`reset_demo_clinic`). */
const DEMO_USER_ID = "139dd209-8495-415c-b6cd-6bbc63367bad";
/** Operadora de recepción de ejemplo (no es una cuenta: solo identifica su caja). */
const RECEPCION_DEMO_ID = "7a1c5e90-3b2d-4f6a-8e41-0c9d2b7f5a10";
const RECEPCION_DEMO_NOMBRE = "Javiera Morales (recepción)";

export async function sembrarCajaYComisionesDeLaDemo(admin: Admin): Promise<void> {
  try {
    const { data: clinica } = await admin
      .from("clinics")
      .select("id, timezone, currency")
      .eq("id", DEMO_CLINIC_ID)
      .eq("is_demo", true)
      .maybeSingle();
    if (!clinica) return;
    const zona = clinica.timezone || "America/Santiago";
    await sembrarCajas(admin, clinica.id, zona);
    await sembrarComisiones(admin, clinica.id, zona, clinica.currency ?? "CLP");
  } catch (e) {
    console.error("[demo-reset] no se pudo sembrar caja por operador y comisiones", e);
  }
}

async function sembrarCajas(admin: Admin, clinicId: string, zona: string) {
  const { data: abiertas } = await admin
    .from("cash_registers")
    .select("id, operator_id, opened_at")
    .eq("clinic_id", clinicId)
    .eq("status", "open");
  const general = (abiertas ?? []).find((c) => c.operator_id === null);
  let mia = (abiertas ?? []).find((c) => c.operator_id === DEMO_USER_ID);
  if (!mia && general) {
    const { data: perfil } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", DEMO_USER_ID)
      .maybeSingle();
    await admin
      .from("cash_registers")
      .update({
        operator_id: DEMO_USER_ID,
        operator_name_snapshot: perfil?.full_name?.trim() || "Cuenta demo",
      })
      .eq("id", general.id);
    mia = { ...general, operator_id: DEMO_USER_ID };
  }
  if (!mia) return;

  let recepcion = (abiertas ?? []).find((c) => c.operator_id === RECEPCION_DEMO_ID);
  if (!recepcion) {
    const hoy = hoyISO(zona);
    const apertura = new Date(
      Math.min(wallTimeInTzToUtc(`${hoy}T09:00:00`, zona).getTime(), Date.now() - 60_000),
    ).toISOString();
    const { data: nueva, error } = await admin
      .from("cash_registers")
      .insert({
        clinic_id: clinicId,
        opening_amount_cents: 30000,
        opened_by: RECEPCION_DEMO_ID,
        opened_at: apertura,
        operator_id: RECEPCION_DEMO_ID,
        operator_name_snapshot: RECEPCION_DEMO_NOMBRE,
        opening_notes: "Sencillo para vuelto",
      })
      .select("id, operator_id, opened_at")
      .single();
    if (error) throw new Error(error.message);
    recepcion = nueva;

    // Dos cobros en efectivo de hoy pasan a la caja de recepción.
    const { data: cobros } = await admin
      .from("payments")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("method", "cash")
      .eq("cash_register_id", mia.id)
      .like("notes", "Demo · %")
      .order("paid_at", { ascending: false })
      .limit(2);
    const ids = (cobros ?? []).map((c) => c.id);
    if (ids.length) {
      await admin.from("payments").update({ cash_register_id: recepcion.id }).in("id", ids);
    }
  }

  const { count } = await admin
    .from("cash_movements")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId);
  if ((count ?? 0) > 0) return;
  const { error } = await admin.from("cash_movements").insert([
    {
      clinic_id: clinicId,
      kind: "traspaso",
      from_register_id: recepcion.id,
      to_register_id: mia.id,
      amount_cents: 10000,
      reason: "Sencillo para vuelto",
      created_by: RECEPCION_DEMO_ID,
    },
    {
      clinic_id: clinicId,
      kind: "deposito",
      from_register_id: mia.id,
      amount_cents: 40000,
      reason: "Depósito del efectivo de la mañana",
      reference: "DEP-000123",
      created_by: DEMO_USER_ID,
    },
  ]);
  if (error) throw new Error(error.message);
}

async function sembrarComisiones(admin: Admin, clinicId: string, zona: string, currency: string) {
  const { count } = await admin
    .from("commission_rule_versions")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId);
  if ((count ?? 0) > 0) return;

  const [{ data: pros }, { data: reglas }, { data: brackets }] = await Promise.all([
    admin.from("professionals").select("id, full_name").eq("clinic_id", clinicId),
    admin
      .from("commission_rules")
      .select("professional_id, kind, percent_bps, fixed_cents")
      .eq("clinic_id", clinicId),
    admin
      .from("procedures")
      .select("id, name")
      .eq("clinic_id", clinicId)
      .eq("name", "Instalación de brackets")
      .maybeSingle(),
  ]);
  const herrera = (pros ?? []).find((p) => p.full_name.includes("Herrera"));
  const reyes = (pros ?? []).find((p) => p.full_name.includes("Reyes"));
  if (!herrera) return;

  const hoy = hoyISO(zona);
  const inicioMes = `${hoy.slice(0, 7)}-01`;
  const finMesPasado = diaAnterior(inicioMes);
  const inicioMesPasado = `${finMesPasado.slice(0, 7)}-01`;

  // La regla de cada profesional pasa a ser su primera versión (como la migración).
  const filas: Database["public"]["Tables"]["commission_rule_versions"]["Insert"][] = (
    reglas ?? []
  ).map((r) => ({
    clinic_id: clinicId,
    professional_id: r.professional_id,
    scope: "general",
    kind: r.kind,
    percent_bps: r.percent_bps,
    fixed_cents: r.fixed_cents,
    base: "realizado",
    effective_from: "2000-01-01",
    note: "Regla inicial",
    created_by: DEMO_USER_ID,
  }));
  filas.push({
    clinic_id: clinicId,
    professional_id: herrera.id,
    scope: "general",
    kind: "percent",
    percent_bps: 4500,
    fixed_cents: 0,
    base: "cobrado",
    effective_from: inicioMes,
    note: "Acuerdo nuevo: porcentaje sobre lo cobrado",
    created_by: DEMO_USER_ID,
  });
  if (reyes && brackets) {
    filas.push({
      clinic_id: clinicId,
      professional_id: reyes.id,
      scope: "prestacion",
      procedure_id: brackets.id,
      procedure_name_snapshot: brackets.name,
      kind: "percent",
      percent_bps: 2000,
      fixed_cents: 0,
      base: "realizado",
      effective_from: "2000-01-01",
      note: "La instalación lleva materiales caros",
      created_by: DEMO_USER_ID,
    });
  }
  const { data: insertadas, error } = await admin
    .from("commission_rule_versions")
    .insert(filas)
    .select(
      "id, professional_id, scope, procedure_id, procedure_name_snapshot, kind, percent_bps, fixed_cents, base, effective_from",
    );
  if (error) throw new Error(error.message);
  await admin
    .from("commission_rules")
    .update({ percent_bps: 4500, kind: "percent", base: "cobrado" })
    .eq("clinic_id", clinicId)
    .eq("professional_id", herrera.id);

  const versiones: VersionRegla[] = (insertadas ?? []).map((v) => ({
    id: v.id,
    professionalId: v.professional_id,
    scope: v.scope === "prestacion" ? "prestacion" : "general",
    procedureId: v.procedure_id,
    procedureName: v.procedure_name_snapshot,
    kind: v.kind as VersionRegla["kind"],
    percentBps: v.percent_bps,
    fixedCents: v.fixed_cents,
    base: v.base === "cobrado" ? "cobrado" : "realizado",
    effectiveFrom: v.effective_from,
  }));

  // Liquidación congelada del mes pasado (solo producción: las dos reglas de
  // porcentaje regían sobre lo realizado ese mes).
  const desdeIso = wallTimeInTzToUtc(`${inicioMesPasado}T00:00:00`, zona).toISOString();
  const hastaIso = wallTimeInTzToUtc(`${inicioMes}T00:00:00`, zona).toISOString();
  const { data: items } = await admin
    .from("treatment_items")
    .select("id, professional_id, procedure_id, price_cents, completed_at, name_snapshot")
    .eq("clinic_id", clinicId)
    .eq("status", "completed")
    .gte("completed_at", desdeIso)
    .lt("completed_at", hastaIso);
  const realizados = (items ?? [])
    .filter((it) => it.professional_id && it.completed_at)
    .map((it) => ({
      id: it.id,
      professionalId: it.professional_id!,
      procedureId: it.procedure_id,
      fecha: fechaEnZona(it.completed_at!, zona),
      cents: it.price_cents ?? 0,
      concepto: it.name_snapshot,
    }));
  const liquidaciones = [herrera, reyes]
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p, i) => {
      const liq = liquidar({
        professionalId: p.id,
        desde: inicioMesPasado,
        hasta: finMesPasado,
        versiones,
        realizados,
        cobrados: [],
        currency,
      });
      const v = liq.vigente;
      return {
        clinic_id: clinicId,
        professional_id: p.id,
        period_from: inicioMesPasado,
        period_to: finMesPasado,
        rule_kind: v?.kind === "fixed" ? "fixed" : "percent",
        rule_percent_bps: v?.kind === "percent" ? v.percentBps : 0,
        rule_fixed_cents: v?.kind === "fixed" ? v.fixedCents : 0,
        rule_effective_from: v?.effectiveFrom ?? null,
        base: v?.base ?? "realizado",
        production_cents: liq.productionCents,
        procedure_count: liq.procedureCount,
        cobrado_cents: 0,
        commission_cents: liq.commissionCents ?? 0,
        detail: detalleParaGuardar(liq, currency) as unknown as Json,
        closed_by: DEMO_USER_ID,
        closed_at: new Date(
          Math.min(wallTimeInTzToUtc(`${inicioMes}T18:00:00`, zona).getTime(), Date.now()),
        ).toISOString(),
        // La de la Dra. Herrera ya se pagó; la del Dr. Reyes está por pagar.
        paid_at: i === 0 ? new Date().toISOString() : null,
        paid_by: i === 0 ? DEMO_USER_ID : null,
      };
    });
  if (liquidaciones.length) {
    const { error: e } = await admin.from("commission_settlements").insert(liquidaciones);
    if (e) throw new Error(e.message);
  }
}
