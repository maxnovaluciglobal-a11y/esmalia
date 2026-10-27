import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { requireFinanceViewRole } from "@/lib/finance/finance-reports.functions";
import {
  presupuestoAbierto,
  presupuestoDesdePlan,
  type ItemPlanFicha,
  type ItemPresupuestoFicha,
  type PresupuestoFicha,
} from "@/lib/finance/presupuesto-ficha";

/**
 * Tarjeta "Presupuesto por fases" de la ficha (A+). Lleva montos, así que el
 * servidor exige `finance:view` (regla 15: el gate de la UI tiene su par acá).
 * Solo el rol, sin el bloqueo de informes por suscripción: es operación del
 * mostrador, no un reporte (mismo criterio que `getAppointmentPatientBalances`).
 *
 * Elige el plan de tratamiento vigente más reciente (activo o en pausa; si no
 * hay, el último finalizado) y, si el paciente no tiene plan, el último
 * presupuesto abierto (borrador o emitido). `null` = nada que mostrar.
 */
export const getPresupuestoDeLaFicha = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PresupuestoFicha | null> => {
    const { supabase, userId } = context;
    await requireFinanceViewRole(supabase, data.clinicId, userId);

    const { data: planes, error: planesError } = await supabase
      .from("treatment_plans")
      .select("id, quote_id, name, status, currency, started_at, created_at")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(20);
    if (planesError) throw new Error(mensajeDb(planesError, "No pudimos cargar el plan."));

    const plan =
      (planes ?? []).find((p) => p.status === "active" || p.status === "on_hold") ??
      (planes ?? [])[0] ??
      null;

    if (plan) {
      const [itemsRes, pagosRes, quoteRes] = await Promise.all([
        supabase
          .from("treatment_items")
          .select(
            "id, tooth_number, name_snapshot, status, price_cents, patient_cents, phase_label, phase_position, position",
          )
          .eq("plan_id", plan.id)
          .order("phase_position", { ascending: true })
          .order("position", { ascending: true }),
        supabase
          .from("payments")
          .select("amount_cents, treatment_item_id, treatment_plan_id, reversed_at")
          .eq("clinic_id", data.clinicId)
          .eq("patient_id", data.patientId)
          // La cuota de una membresía no es un abono a cuenta del plan.
          .is("membership_charge_id", null),
        plan.quote_id
          ? supabase
              .from("quotes")
              .select("number")
              .eq("clinic_id", data.clinicId)
              .eq("id", plan.quote_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (itemsRes.error)
        throw new Error(mensajeDb(itemsRes.error, "No pudimos cargar los ítems del plan."));
      if (pagosRes.error)
        throw new Error(mensajeDb(pagosRes.error, "No pudimos cargar los pagos del paciente."));

      const items: ItemPlanFicha[] = (itemsRes.data ?? []).map((i) => ({
        id: i.id,
        toothNumber: i.tooth_number,
        nameSnapshot: i.name_snapshot,
        status: i.status as ItemPlanFicha["status"],
        priceCents: Number(i.price_cents),
        patientCents: i.patient_cents == null ? null : Number(i.patient_cents),
        phaseLabel: i.phase_label,
        phasePosition: i.phase_position,
        position: i.position,
      }));
      return presupuestoDesdePlan({
        plan: {
          id: plan.id,
          name: plan.name,
          currency: plan.currency,
          startedAt: plan.started_at ?? plan.created_at,
        },
        numero: (quoteRes.data as { number: string } | null)?.number ?? null,
        items,
        pagosACuentaDelPlan: (planes ?? []).length === 1,
        pagos: (pagosRes.data ?? []).map((p) => ({
          amountCents: Number(p.amount_cents),
          treatmentItemId: p.treatment_item_id,
          treatmentPlanId: p.treatment_plan_id,
          reversed: p.reversed_at != null,
        })),
      });
    }

    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("id, number, status, currency, created_at")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .in("status", ["draft", "sent"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (quoteError) throw new Error(mensajeDb(quoteError, "No pudimos cargar el presupuesto."));
    if (!quote) return null;

    const { data: filas, error: filasError } = await supabase
      .from("quote_items")
      .select(
        "id, tooth_number, name_snapshot, total_cents, patient_cents, phase_label, phase_position, position",
      )
      .eq("quote_id", quote.id)
      .order("phase_position", { ascending: true })
      .order("position", { ascending: true });
    if (filasError)
      throw new Error(mensajeDb(filasError, "No pudimos cargar las líneas del presupuesto."));

    const items: ItemPresupuestoFicha[] = (filas ?? []).map((i) => ({
      id: i.id,
      toothNumber: i.tooth_number,
      nameSnapshot: i.name_snapshot,
      totalCents: Number(i.total_cents),
      patientCents: i.patient_cents == null ? null : Number(i.patient_cents),
      phaseLabel: i.phase_label,
      phasePosition: i.phase_position,
      position: i.position,
      accepted: null,
    }));
    return presupuestoAbierto({
      quote: {
        number: quote.number,
        status: quote.status,
        currency: quote.currency,
        createdAt: quote.created_at,
      },
      items,
    });
  });
