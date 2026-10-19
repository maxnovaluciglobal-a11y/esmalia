import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { permissionsForRole, type ClinicRole } from "@/lib/access/access";
import { mensajeDb } from "@/lib/db-errors";
import { calcularComision, type CommissionKind } from "@/lib/finance/commissions";
import { formatMoney } from "@/lib/finance/finance";
import { renderTemplate, renderTemplateHtml } from "@/lib/messaging/messaging";
import { loadEmailSandboxConfig } from "@/lib/messaging/messaging.functions";
import { sendEmail } from "@/lib/messaging/email.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

export type { CommissionKind };

export type CommissionRule = {
  professionalId: string;
  kind: CommissionKind;
  /** Basis points (1% = 100). Solo relevante si kind='percent'. */
  percentBps: number;
  /** Cents por procedimiento completado. Solo relevante si kind='fixed'. */
  fixedCents: number;
};

/** Reglas de comisión de todos los profesionales de la clínica. Sin fila para
 * un profesional = sin comisión configurada (no aparece o comisión 0). */
export const listCommissionRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CommissionRule[]> => {
    const { data: rows, error } = await context.supabase
      .from("commission_rules")
      .select("professional_id, kind, percent_bps, fixed_cents")
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las reglas de comisión."));
    return (rows ?? []).map((r) => ({
      professionalId: r.professional_id,
      kind: r.kind as CommissionKind,
      percentBps: r.percent_bps,
      fixedCents: r.fixed_cents,
    }));
  });

export const setCommissionRule = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        professionalId: z.string().uuid(),
        kind: z.enum(["percent", "fixed"]),
        percentBps: z.number().int().min(0).max(10000),
        fixedCents: z.number().int().min(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("commission_rules").upsert(
      {
        clinic_id: data.clinicId,
        professional_id: data.professionalId,
        kind: data.kind,
        percent_bps: data.percentBps,
        fixed_cents: data.fixedCents,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clinic_id,professional_id" },
    );
    if (error) throw new Error("No tienes permisos para editar las comisiones.");
    return { ok: true };
  });

export const removeCommissionRule = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), professionalId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("commission_rules")
      .delete()
      .eq("clinic_id", data.clinicId)
      .eq("professional_id", data.professionalId);
    if (error) throw new Error("No tienes permisos para editar las comisiones.");
    return { ok: true };
  });

export type CommissionLine = {
  professionalId: string;
  professionalName: string;
  kind: CommissionKind | null;
  /** Producción del período (suma de price_cents de items completados). */
  productionCents: number;
  procedureCount: number;
  /** Comisión calculada con la regla vigente. null = sin regla configurada. */
  commissionCents: number | null;
  ruleLabel: string;
  /** true = este período ya fue cerrado, el monto es un snapshot congelado
   * (no se recalcula aunque cambie commission_rules después). */
  closed: boolean;
  /** Solo tiene sentido si closed=true. */
  paidAt: string | null;
  /** id de `commission_settlements`. Solo tiene sentido si closed=true —
   * lo necesita `markCommissionSettlementPaid`. */
  settlementId: string | null;
};

/** 42P01 = undefined_table (Postgres). La migración de commission_settlements
 * (auditoría 360 v2, 26-ago) puede no estar aplicada todavía — degradar a
 * "sin períodos cerrados" en vez de romper el reporte completo. */
function isUndefinedTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/**
 * Liquidación de comisiones por profesional en un rango [from, to] (fechas
 * civiles YYYY-MM-DD, inclusive). Si el período [from,to] para un profesional
 * ya fue cerrado (`commission_settlements`), devuelve el snapshot congelado
 * en vez de recalcular — así una regla editada después de cerrar no altera
 * lo ya liquidado/comunicado (auditoría 360 v2, arq-1/arq-8/ops-9). Para
 * cualquier rango sin cierre, sigue calculando en vivo con la regla vigente.
 * `professionalId` opcional filtra a un solo profesional — ux-3: el propio
 * profesional solo debe ver su línea, nunca la de sus colegas.
 */
export const getCommissionReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        professionalId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CommissionLine[]> => {
    const { supabase, userId } = context;

    // El permiso `commission:view-own` (auditoría de seguridad, 30-ago) es
    // insuficiente si solo se aplica en la UI: `treatment_items_select_members`
    // deja leer producción/conteo de CUALQUIER profesional a cualquier miembro
    // de la clínica. Reforzamos acá: sin `finance:view`, el rango se acota por
    // la fuerza al propio `professional_id` sin importar qué pidió el cliente.
    const { data: membership } = await supabase
      .from("clinic_members")
      .select("role")
      .eq("clinic_id", data.clinicId)
      .eq("user_id", userId)
      .maybeSingle();
    const canViewAll = membership?.role
      ? permissionsForRole(membership.role as ClinicRole).includes("finance:view")
      : false;

    let professionalId = data.professionalId;
    if (!canViewAll) {
      const { data: own } = await supabase
        .from("professionals")
        .select("id")
        .eq("clinic_id", data.clinicId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!own) return [];
      professionalId = own.id;
    }

    // completed_at es timestamptz; el rango civil [from 00:00, to 24:00).
    const fromIso = `${data.from}T00:00:00Z`;
    const toIso = `${data.to}T23:59:59.999Z`;

    let itemsQuery = context.supabase
      .from("treatment_items")
      .select("professional_id, price_cents, completed_at, status")
      .eq("clinic_id", data.clinicId)
      .eq("status", "completed")
      .gte("completed_at", fromIso)
      .lte("completed_at", toIso);
    let prosQuery = context.supabase
      .from("professionals")
      .select("id, full_name")
      .eq("clinic_id", data.clinicId);
    if (professionalId) {
      itemsQuery = itemsQuery.eq("professional_id", professionalId);
      prosQuery = prosQuery.eq("id", professionalId);
    }

    const [
      { data: items, error: itemsErr },
      { data: pros, error: prosErr },
      { data: rules, error: rulesErr },
      settlementsRes,
    ] = await Promise.all([
      itemsQuery,
      prosQuery,
      context.supabase
        .from("commission_rules")
        .select("professional_id, kind, percent_bps, fixed_cents")
        .eq("clinic_id", data.clinicId),
      context.supabase
        .from("commission_settlements")
        .select(
          "id, professional_id, rule_kind, rule_percent_bps, rule_fixed_cents, production_cents, procedure_count, commission_cents, paid_at",
        )
        .eq("clinic_id", data.clinicId)
        .eq("period_from", data.from)
        .eq("period_to", data.to),
    ]);
    if (itemsErr)
      throw new Error(mensajeDb(itemsErr, "No pudimos cargar la producción del período."));
    if (prosErr)
      throw new Error(mensajeDb(prosErr, "No pudimos cargar los profesionales de la clínica."));
    if (rulesErr) throw new Error(mensajeDb(rulesErr, "No pudimos cargar las reglas de comisión."));
    if (settlementsRes.error && !isUndefinedTableError(settlementsRes.error)) {
      throw new Error(
        mensajeDb(settlementsRes.error, "No pudimos cargar los períodos de comisión ya cerrados."),
      );
    }
    const settlementByPro = new Map((settlementsRes.data ?? []).map((s) => [s.professional_id, s]));

    const ruleByPro = new Map(
      (rules ?? []).map((r) => [
        r.professional_id,
        { kind: r.kind as CommissionKind, percentBps: r.percent_bps, fixedCents: r.fixed_cents },
      ]),
    );

    type Acc = { production: number; count: number };
    const accByPro = new Map<string, Acc>();
    for (const it of items ?? []) {
      if (!it.professional_id) continue;
      const acc = accByPro.get(it.professional_id) ?? { production: 0, count: 0 };
      acc.production += it.price_cents ?? 0;
      acc.count += 1;
      accByPro.set(it.professional_id, acc);
    }

    const lines: CommissionLine[] = (pros ?? []).map((pro) => {
      const settlement = settlementByPro.get(pro.id);
      if (settlement) {
        // Período cerrado: el monto es el snapshot congelado, no se recalcula.
        const ruleLabel =
          settlement.rule_kind === "percent"
            ? `${(settlement.rule_percent_bps / 100).toFixed(2)}% sobre producción (cerrado)`
            : "Fijo por procedimiento (cerrado)";
        return {
          professionalId: pro.id,
          professionalName: pro.full_name,
          kind: settlement.rule_kind as CommissionKind,
          productionCents: settlement.production_cents,
          procedureCount: settlement.procedure_count,
          commissionCents: settlement.commission_cents,
          ruleLabel,
          closed: true,
          paidAt: settlement.paid_at,
          settlementId: settlement.id,
        };
      }

      const acc = accByPro.get(pro.id) ?? { production: 0, count: 0 };
      const rule = ruleByPro.get(pro.id) ?? null;
      const { commissionCents: commission, ruleLabel } = calcularComision(
        rule,
        acc.production,
        acc.count,
      );
      return {
        professionalId: pro.id,
        professionalName: pro.full_name,
        kind: rule?.kind ?? null,
        productionCents: acc.production,
        procedureCount: acc.count,
        commissionCents: commission,
        ruleLabel,
        closed: false,
        paidAt: null,
        settlementId: null,
      };
    });

    // Ordena por comisión desc (los que más generan arriba); sin regla al final.
    return lines.sort(
      (a, b) =>
        (b.commissionCents ?? -1) - (a.commissionCents ?? -1) ||
        b.productionCents - a.productionCents,
    );
  });

/**
 * Cierra el período [from,to] para todos los profesionales con producción o
 * regla configurada: congela un snapshot en `commission_settlements` con la
 * regla y los montos vigentes AHORA. Solo owner/admin (RLS ya lo exige).
 * Si ya existe un cierre para ese rango+profesional, no lo duplica (UNIQUE
 * constraint) — devuelve error claro en vez del error crudo de Postgres.
 */
export const closeCommissionPeriod = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ closed: number }> => {
    const lines = await getCommissionReport({
      data: { clinicId: data.clinicId, from: data.from, to: data.to },
    });
    const toClose = lines.filter((l) => !l.closed && l.kind !== null);
    if (toClose.length === 0) return { closed: 0 };

    const rows = toClose.map((l) => ({
      clinic_id: data.clinicId,
      professional_id: l.professionalId,
      period_from: data.from,
      period_to: data.to,
      rule_kind: l.kind!,
      rule_percent_bps:
        l.kind === "percent"
          ? Math.round(((l.commissionCents ?? 0) * 10000) / (l.productionCents || 1))
          : 0,
      rule_fixed_cents:
        l.kind === "fixed" && l.procedureCount > 0
          ? Math.round((l.commissionCents ?? 0) / l.procedureCount)
          : 0,
      production_cents: l.productionCents,
      procedure_count: l.procedureCount,
      commission_cents: l.commissionCents ?? 0,
      closed_by: context.userId,
    }));

    const { error } = await context.supabase.from("commission_settlements").insert(rows);
    if (error) {
      if (error.code === "23505") {
        throw new Error("Este período ya fue cerrado para uno o más profesionales.");
      }
      throw new Error(mensajeDb(error, "No pudimos cerrar el período de comisiones."));
    }

    // Aviso al profesional (auditoría 360 v2, F2 comunicaciones) — best
    // effort: el cierre ya está guardado, un email que falla no debe hacer
    // fallar la respuesta. Se manda directo con sendEmail (no
    // sendEmailFromTemplate: esa función exige patientId y el destinatario
    // acá es un profesional, no un paciente — messages.patient_id es NOT
    // NULL, así que este aviso no queda registrado en `messages`).
    await notifyCommissionSettled({
      supabase: context.supabase,
      clinicId: data.clinicId,
      from: data.from,
      to: data.to,
      professionalIds: toClose.map((l) => l.professionalId),
      commissionCentsByProfessional: new Map(
        toClose.map((l) => [l.professionalId, l.commissionCents ?? 0]),
      ),
    });

    return { closed: rows.length };
  });

/** Deja rastro en la propia fila de commission_settlements de si el aviso se
 * mandó o no (progresivo #4, plan Carlos 05-sep-2026) — antes este envío era
 * el único de toda la app sin ningún registro de éxito/fallo. Nunca lanza:
 * un fallo acá no debe tapar el resultado real del envío que ya se logueó.
 * postgrest-js nunca rechaza la promesa (devuelve `{ error }` incluso ante
 * fallas de red) — el try/catch de acá es solo para lo verdaderamente
 * inesperado; el chequeo real de éxito/fallo es el `if (error)` de abajo,
 * sin el cual esta función nunca podría reportar que algo salió mal
 * (revisión de código, 05-sep-2026). */
async function logSettlementEmail(
  supabase: SupabaseClient<Database>,
  key: { clinicId: string; professionalId: string; from: string; to: string },
  outcome: { sentAt: string | null; error: string | null },
): Promise<void> {
  try {
    const { error } = await supabase
      .from("commission_settlements")
      .update({ email_notified_at: outcome.sentAt, email_error: outcome.error })
      .eq("clinic_id", key.clinicId)
      .eq("professional_id", key.professionalId)
      .eq("period_from", key.from)
      .eq("period_to", key.to);
    if (error) {
      console.error(
        "[commissions] no se pudo registrar el estado del aviso de comisión",
        error.message,
      );
    }
  } catch (err) {
    console.error("[commissions] no se pudo registrar el estado del aviso de comisión", err);
  }
}

/** Manda el aviso de comisión liquidada a cada profesional cerrado que tenga
 * email cargado. Nunca lanza — un fallo de envío se loguea y se sigue. */
async function notifyCommissionSettled(params: {
  supabase: SupabaseClient<Database>;
  clinicId: string;
  from: string;
  to: string;
  professionalIds: string[];
  commissionCentsByProfessional: Map<string, number>;
}): Promise<void> {
  const { supabase, clinicId, from, to, professionalIds, commissionCentsByProfessional } = params;
  const marcar = (
    professionalId: string,
    outcome: { sentAt: string | null; error: string | null },
  ) => logSettlementEmail(supabase, { clinicId, professionalId, from, to }, outcome);
  try {
    const [
      { data: pros, error: prosErr },
      { data: clinic, error: clinicErr },
      { data: template, error: templateErr },
    ] = await Promise.all([
      supabase
        .from("professionals")
        .select("id, full_name, email")
        .eq("clinic_id", clinicId)
        .in("id", professionalIds),
      supabase.from("clinics").select("name, currency").eq("id", clinicId).maybeSingle(),
      supabase
        .from("message_templates")
        .select("subject, body")
        .eq("clinic_id", clinicId)
        .eq("channel", "email")
        .eq("kind", "commission_settled")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
    ]);
    if (prosErr || clinicErr || templateErr) {
      const motivo = "No se pudo preparar el aviso (error consultando datos de la clínica).";
      console.error(
        "[commissions] no se pudo preparar el aviso de comisión liquidada",
        prosErr ?? clinicErr ?? templateErr,
      );
      await Promise.all(professionalIds.map((id) => marcar(id, { sentAt: null, error: motivo })));
      return;
    }
    if (!template) {
      const motivo = "Falta el template 'commission_settled' (email) de la clínica.";
      console.error(
        "[commissions] falta template 'commission_settled' (email) para la clínica",
        clinicId,
      );
      await Promise.all(professionalIds.map((id) => marcar(id, { sentAt: null, error: motivo })));
      return;
    }

    const periodo = `${from} a ${to}`;
    const currency = clinic?.currency ?? "CLP";
    const sandboxConfig = await loadEmailSandboxConfig(supabase, clinicId);

    for (const pro of pros ?? []) {
      const recipient = (pro.email ?? "").trim();
      if (!recipient) {
        await marcar(pro.id, { sentAt: null, error: "El profesional no tiene email cargado." });
        continue;
      }
      const commissionCents = commissionCentsByProfessional.get(pro.id) ?? 0;
      const vars = {
        profesional: pro.full_name,
        periodo,
        monto: formatMoney(commissionCents, currency),
        clinica: clinic?.name ?? "",
      };
      const subject = renderTemplate(template.subject ?? "", vars);
      // renderTemplateHtml: profesional/clinica vienen de nombres editables,
      // este HTML se manda tal cual a Resend (security-review 01-sep).
      const html = renderTemplateHtml(template.body, vars);
      const result = await sendEmail({ to: recipient, subject, html }, sandboxConfig);
      if (!result.ok) {
        console.error(
          `[commissions] aviso de comisión liquidada no enviado a profesional ${pro.id}:`,
          result.reason,
        );
      }
      await marcar(pro.id, {
        sentAt: result.ok ? new Date().toISOString() : null,
        error: result.ok ? null : result.reason,
      });
    }
  } catch (err) {
    // Best-effort: el cierre del período ya está guardado, esto nunca debe
    // tumbar la respuesta de closeCommissionPeriod.
    console.error("[commissions] error inesperado avisando comisión liquidada", err);
  }
}

/** Marca un cierre existente como pagado. Solo owner/admin (RLS). */
export const markCommissionSettlementPaid = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), settlementId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("commission_settlements")
      .update({ paid_at: new Date().toISOString(), paid_by: context.userId })
      .eq("id", data.settlementId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error("No tienes permisos para marcar esta liquidación como pagada.");
    return { ok: true };
  });
