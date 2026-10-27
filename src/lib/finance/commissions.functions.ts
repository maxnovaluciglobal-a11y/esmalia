import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type ClinicRole } from "@/lib/access/access";
import { permisosEfectivosEnClinica } from "@/lib/access/permisos-en-clinica";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import { mensajeDb } from "@/lib/db-errors";
import { type CommissionKind } from "@/lib/finance/commissions";
import {
  atribuirCobros,
  detalleParaGuardar,
  diaSiguiente,
  etiquetaRegla,
  fechaEnZona,
  leerDetalleLiquidacion,
  liquidar,
  validarVigencia,
  versionDesdeReglaActual,
  versionGeneralVigente,
  type BaseComision,
  type DetalleLiquidacion,
  type HechoCobrado,
  type HechoRealizado,
  type ItemParaAtribuir,
  type Liquidacion,
  type TipoReglaComision,
  type TramoLiquidacion,
  type VersionRegla,
} from "@/lib/finance/comisiones-vigencia";
import { formatMoney } from "@/lib/finance/finance";
import { renderTemplate, renderTemplateHtml } from "@/lib/messaging/messaging";
import { loadEmailSandboxConfig } from "@/lib/messaging/messaging.functions";
import { sendEmail } from "@/lib/messaging/email.server";
import { enBloques, leerTodasLasPaginas } from "@/lib/paginacion";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

export type { CommissionKind };

const SIN_PERMISOS_REGLA = "No tienes permisos para editar las comisiones.";

export type CommissionRule = {
  professionalId: string;
  kind: CommissionKind;
  /** Basis points (1% = 100). Solo relevante si kind='percent'. */
  percentBps: number;
  /** Cents por procedimiento completado. Solo relevante si kind='fixed'. */
  fixedCents: number;
  /** Sobre qué se calcula el porcentaje (Ola 10). */
  base: BaseComision;
};

async function rolEnLaClinica(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
): Promise<ClinicRole | null> {
  const { data } = await supabase
    .from("clinic_members")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as ClinicRole | undefined) ?? null;
}

async function exigirGestor(supabase: SupabaseClient<Database>, clinicId: string, userId: string) {
  const rol = await rolEnLaClinica(supabase, clinicId, userId);
  if (rol !== "owner" && rol !== "admin") throw new Error(SIN_PERMISOS_REGLA);
}

/** 42P01 = undefined_table (Postgres). Una migración puede no estar aplicada
 * todavía en un entorno: degradar en vez de romper el reporte completo. */
function isUndefinedTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

type FilaVersion = {
  id: string;
  professional_id: string;
  scope: string;
  procedure_id: string | null;
  procedure_name_snapshot: string | null;
  kind: string;
  percent_bps: number;
  fixed_cents: number;
  base: string;
  effective_from: string;
};

function mapVersion(v: FilaVersion): VersionRegla {
  return {
    id: v.id,
    professionalId: v.professional_id,
    scope: v.scope === "prestacion" ? "prestacion" : "general",
    procedureId: v.procedure_id,
    procedureName: v.procedure_name_snapshot,
    kind: v.kind as TipoReglaComision,
    percentBps: v.percent_bps,
    fixedCents: v.fixed_cents,
    base: v.base === "cobrado" ? "cobrado" : "realizado",
    effectiveFrom: v.effective_from,
  };
}

const COLUMNAS_VERSION =
  "id, professional_id, scope, procedure_id, procedure_name_snapshot, kind, percent_bps, fixed_cents, base, effective_from";

/**
 * Versiones de la regla de los profesionales pedidos. Un profesional sin
 * ninguna versión general se calcula con su fila de `commission_rules` como
 * si rigiera desde siempre (lo que siembra la demo, o lo que edite el código
 * anterior a la Ola 10).
 */
async function cargarVersiones(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  professionalId?: string,
): Promise<VersionRegla[]> {
  let qVersiones = supabase
    .from("commission_rule_versions")
    .select(COLUMNAS_VERSION)
    .eq("clinic_id", clinicId);
  let qReglas = supabase
    .from("commission_rules")
    .select("professional_id, kind, percent_bps, fixed_cents, base")
    .eq("clinic_id", clinicId);
  if (professionalId) {
    qVersiones = qVersiones.eq("professional_id", professionalId);
    qReglas = qReglas.eq("professional_id", professionalId);
  }
  const [versionesRes, reglasRes] = await Promise.all([qVersiones, qReglas]);
  if (versionesRes.error && !isUndefinedTableError(versionesRes.error)) {
    throw new Error(mensajeDb(versionesRes.error, "No pudimos cargar las reglas de comisión."));
  }
  if (reglasRes.error)
    throw new Error(mensajeDb(reglasRes.error, "No pudimos cargar las reglas de comisión."));
  const versiones = (versionesRes.data ?? []).map((v) => mapVersion(v as FilaVersion));
  const conGeneral = new Set(
    versiones.filter((v) => v.scope === "general").map((v) => v.professionalId),
  );
  for (const r of reglasRes.data ?? []) {
    if (conGeneral.has(r.professional_id)) continue;
    versiones.push(
      versionDesdeReglaActual({
        professionalId: r.professional_id,
        kind: r.kind as "percent" | "fixed",
        percentBps: r.percent_bps,
        fixedCents: r.fixed_cents,
        base: (r.base as BaseComision | null) ?? "realizado",
      }),
    );
  }
  return versiones;
}

export interface DatosDelPeriodo {
  timeZone: string;
  currency: string;
  hoy: string;
  versiones: VersionRegla[];
  realizados: HechoRealizado[];
  cobrados: HechoCobrado[];
  sinAtribuirCents: number;
  truncado: boolean;
}

/**
 * Producción y cobros del período [from, to] (fechas civiles de la clínica,
 * regla 7) listos para `liquidar`. Lee de a páginas: PostgREST corta en 1000.
 */
export async function cargarPeriodo(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  from: string,
  to: string,
  professionalId?: string,
): Promise<DatosDelPeriodo> {
  const { data: clinic, error: clinicError } = await supabase
    .from("clinics")
    .select("timezone, currency")
    .eq("id", clinicId)
    .maybeSingle();
  if (clinicError) throw new Error(mensajeDb(clinicError, "No pudimos leer la clínica."));
  const timeZone = clinic?.timezone || "America/Santiago";
  const currency = clinic?.currency ?? "CLP";
  const desdeIso = wallTimeInTzToUtc(`${from}T00:00:00`, timeZone).toISOString();
  const hastaIso = wallTimeInTzToUtc(`${diaSiguiente(to)}T00:00:00`, timeZone).toISOString();

  const [versiones, itemsRes, pagosRes] = await Promise.all([
    cargarVersiones(supabase, clinicId, professionalId),
    leerTodasLasPaginas((a, b) => {
      let q = supabase
        .from("treatment_items")
        .select("id, professional_id, procedure_id, price_cents, completed_at, name_snapshot")
        .eq("clinic_id", clinicId)
        .eq("status", "completed")
        .gte("completed_at", desdeIso)
        .lt("completed_at", hastaIso)
        .order("id", { ascending: true });
      if (professionalId) q = q.eq("professional_id", professionalId);
      return q.range(a, b);
    }),
    leerTodasLasPaginas((a, b) =>
      supabase
        .from("payments")
        .select("id, amount_cents, paid_at, treatment_item_id, treatment_plan_id, notes")
        .eq("clinic_id", clinicId)
        .is("reversed_at", null)
        .gte("paid_at", desdeIso)
        .lt("paid_at", hastaIso)
        .order("id", { ascending: true })
        .range(a, b),
    ),
  ]);
  if (itemsRes.error)
    throw new Error(mensajeDb(itemsRes.error, "No pudimos cargar la producción del período."));
  if (pagosRes.error)
    throw new Error(mensajeDb(pagosRes.error, "No pudimos cargar los cobros del período."));

  const realizados: HechoRealizado[] = itemsRes.filas
    .filter((it) => it.professional_id && it.completed_at)
    .map((it) => ({
      id: it.id,
      professionalId: it.professional_id!,
      procedureId: it.procedure_id,
      fecha: fechaEnZona(it.completed_at!, timeZone),
      cents: it.price_cents ?? 0,
      concepto: it.name_snapshot,
    }));

  // Prestaciones de los cobros: las imputadas directo y las de los planes
  // (para repartir un abono al plan entre sus profesionales).
  const idsItems = [
    ...new Set(pagosRes.filas.map((p) => p.treatment_item_id).filter((x): x is string => !!x)),
  ];
  const idsPlanes = [
    ...new Set(pagosRes.filas.map((p) => p.treatment_plan_id).filter((x): x is string => !!x)),
  ];
  const bloques = await Promise.all([
    ...enBloques(idsItems).map((ids) =>
      supabase
        .from("treatment_items")
        .select("id, plan_id, professional_id, procedure_id, price_cents, status, name_snapshot")
        .eq("clinic_id", clinicId)
        .in("id", ids),
    ),
    ...enBloques(idsPlanes).map((ids) =>
      supabase
        .from("treatment_items")
        .select("id, plan_id, professional_id, procedure_id, price_cents, status, name_snapshot")
        .eq("clinic_id", clinicId)
        .in("plan_id", ids),
    ),
  ]);
  const items = new Map<string, ItemParaAtribuir>();
  for (const r of bloques) {
    if (r.error) throw new Error(mensajeDb(r.error, "No pudimos leer las prestaciones cobradas."));
    for (const it of r.data ?? []) {
      items.set(it.id, {
        id: it.id,
        planId: it.plan_id,
        professionalId: it.professional_id,
        procedureId: it.procedure_id,
        priceCents: it.price_cents ?? 0,
        status: it.status,
        nombre: it.name_snapshot,
      });
    }
  }
  const { cobrados, sinAtribuirCents } = atribuirCobros(
    pagosRes.filas.map((p) => ({
      id: p.id,
      amountCents: p.amount_cents,
      fecha: fechaEnZona(p.paid_at, timeZone),
      treatmentItemId: p.treatment_item_id,
      treatmentPlanId: p.treatment_plan_id,
      concepto: p.notes?.trim() || "Cobro",
    })),
    [...items.values()],
  );

  return {
    timeZone,
    currency,
    hoy: hoyISO(timeZone),
    versiones,
    realizados,
    cobrados: professionalId
      ? cobrados.filter((c) => c.professionalId === professionalId)
      : cobrados,
    sinAtribuirCents,
    truncado: itemsRes.truncado || pagosRes.truncado,
  };
}

// ─── Reglas ──────────────────────────────────────────────────────────────

/** Regla vigente hoy de cada profesional (espejo `commission_rules`). Sin
 * fila para un profesional = sin comisión configurada. */
export const listCommissionRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CommissionRule[]> => {
    const { data: rows, error } = await context.supabase
      .from("commission_rules")
      .select("professional_id, kind, percent_bps, fixed_cents, base")
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las reglas de comisión."));
    return (rows ?? []).map((r) => ({
      professionalId: r.professional_id,
      kind: r.kind as CommissionKind,
      percentBps: r.percent_bps,
      fixedCents: r.fixed_cents,
      base: (r.base as BaseComision | null) ?? "realizado",
    }));
  });

export interface VersionReglaVista extends VersionRegla {
  regla: string;
  /** Ya se usó en un período liquidado: no se puede cambiar ni borrar. */
  bloqueada: boolean;
}

export interface ReglasDeComision {
  currency: string;
  hoy: string;
  versiones: VersionReglaVista[];
  /** Último día liquidado de cada profesional (null = nunca). */
  ultimoLiquidado: Record<string, string | null>;
}

/** Historial de reglas con "rige desde" (owner/admin/contabilidad; el
 * profesional solo ve las suyas, lo filtra la RLS). */
export const listCommissionRuleVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), professionalId: z.string().uuid().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ReglasDeComision> => {
    const { supabase } = context;
    const [{ data: clinic }, versiones, settlementsRes] = await Promise.all([
      supabase.from("clinics").select("timezone, currency").eq("id", data.clinicId).maybeSingle(),
      cargarVersiones(supabase, data.clinicId, data.professionalId),
      supabase
        .from("commission_settlements")
        .select("professional_id, period_to")
        .eq("clinic_id", data.clinicId),
    ]);
    const currency = clinic?.currency ?? "CLP";
    const ultimoLiquidado: Record<string, string | null> = {};
    for (const s of settlementsRes.data ?? []) {
      const actual = ultimoLiquidado[s.professional_id];
      if (!actual || s.period_to > actual) ultimoLiquidado[s.professional_id] = s.period_to;
    }
    return {
      currency,
      hoy: hoyISO(clinic?.timezone || "America/Santiago"),
      ultimoLiquidado,
      versiones: versiones
        .sort((a, b) =>
          a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0,
        )
        .map((v) => {
          const general = versionGeneralVigente(versiones, v.professionalId, v.effectiveFrom);
          const ultimo = ultimoLiquidado[v.professionalId] ?? null;
          return {
            ...v,
            regla: etiquetaRegla(
              { ...v, base: v.scope === "general" ? v.base : (general?.base ?? v.base) },
              currency,
            ),
            bloqueada: Boolean(ultimo && v.effectiveFrom <= ultimo) || v.id.startsWith("regla-"),
          };
        }),
    };
  });

/**
 * Deja `commission_rules` (espejo) igual a la regla general que rige hoy.
 * Lo leen la pantalla de Profesionales y la caja del día.
 */
async function sincronizarReglaActual(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  professionalId: string,
  userId: string,
  hoy: string,
) {
  const { data: filas, error } = await supabase
    .from("commission_rule_versions")
    .select(COLUMNAS_VERSION)
    .eq("clinic_id", clinicId)
    .eq("professional_id", professionalId)
    .eq("scope", "general");
  if (error) throw new Error(mensajeDb(error, "No pudimos leer las reglas de comisión."));
  const vigente = versionGeneralVigente(
    (filas ?? []).map((f) => mapVersion(f as FilaVersion)),
    professionalId,
    hoy,
  );
  if (!vigente) return;
  if (vigente.kind === "none") {
    const { error: e } = await supabase
      .from("commission_rules")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("professional_id", professionalId);
    if (e) throw new Error(SIN_PERMISOS_REGLA);
    return;
  }
  const { error: e } = await supabase.from("commission_rules").upsert(
    {
      clinic_id: clinicId,
      professional_id: professionalId,
      kind: vigente.kind,
      percent_bps: vigente.percentBps,
      fixed_cents: vigente.fixedCents,
      base: vigente.base,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clinic_id,professional_id" },
  );
  if (e) throw new Error(SIN_PERMISOS_REGLA);
}

const EsquemaVersion = z
  .object({
    clinicId: z.string().uuid(),
    professionalId: z.string().uuid(),
    scope: z.enum(["general", "prestacion"]).default("general"),
    procedureId: z.string().uuid().nullish(),
    kind: z.enum(["percent", "fixed", "none"]),
    percentBps: z.number().int().min(0).max(10000).default(0),
    fixedCents: z.number().int().min(0).default(0),
    base: z.enum(["realizado", "cobrado"]).default("realizado"),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de vigencia no es válida."),
    note: z.string().trim().max(300).optional(),
  })
  .refine((d) => d.scope === "general" || Boolean(d.procedureId), {
    message: "Elige la prestación de la regla.",
  });

/**
 * Agrega una regla con "rige desde" (COM-03). Si ya hay una del mismo
 * alcance en esa fecha y no está liquidada, la reemplaza. Nunca toca fechas
 * de un período liquidado (lo valida acá y lo vuelve a exigir la base).
 */
async function guardarVersion(
  supabase: SupabaseClient<Database>,
  userId: string,
  data: z.infer<typeof EsquemaVersion>,
): Promise<{ id: string }> {
  await exigirGestor(supabase, data.clinicId, userId);

  const [{ data: clinic }, { data: pro }, settlementsRes] = await Promise.all([
    supabase.from("clinics").select("timezone").eq("id", data.clinicId).maybeSingle(),
    supabase
      .from("professionals")
      .select("id")
      .eq("clinic_id", data.clinicId)
      .eq("id", data.professionalId)
      .maybeSingle(),
    supabase
      .from("commission_settlements")
      .select("period_to")
      .eq("clinic_id", data.clinicId)
      .eq("professional_id", data.professionalId)
      .order("period_to", { ascending: false })
      .limit(1),
  ]);
  if (!pro) throw new Error("Ese profesional no existe en esta clínica.");
  const hoy = hoyISO(clinic?.timezone || "America/Santiago");
  const vigencia = validarVigencia(data.effectiveFrom, settlementsRes.data?.[0]?.period_to ?? null);
  if (!vigencia.ok) throw new Error(vigencia.error);

  let procedureName: string | null = null;
  if (data.scope === "prestacion") {
    const { data: proc } = await supabase
      .from("procedures")
      .select("name")
      .eq("clinic_id", data.clinicId)
      .eq("id", data.procedureId!)
      .maybeSingle();
    if (!proc) throw new Error("Esa prestación no existe en el arancel.");
    procedureName = proc.name;
  }

  const fila = {
    clinic_id: data.clinicId,
    professional_id: data.professionalId,
    scope: data.scope,
    procedure_id: data.scope === "prestacion" ? data.procedureId! : null,
    procedure_name_snapshot: procedureName,
    kind: data.kind,
    percent_bps: data.kind === "percent" ? data.percentBps : 0,
    fixed_cents: data.kind === "fixed" ? data.fixedCents : 0,
    base: data.base,
    effective_from: data.effectiveFrom,
    note: data.note || null,
  };

  let existente = supabase
    .from("commission_rule_versions")
    .select("id")
    .eq("clinic_id", data.clinicId)
    .eq("professional_id", data.professionalId)
    .eq("scope", data.scope)
    .eq("effective_from", data.effectiveFrom);
  existente =
    data.scope === "prestacion"
      ? existente.eq("procedure_id", data.procedureId!)
      : existente.is("procedure_id", null);
  const { data: previa } = await existente.maybeSingle();

  const res = previa
    ? await supabase
        .from("commission_rule_versions")
        .update(fila)
        .eq("id", previa.id)
        .eq("clinic_id", data.clinicId)
        .select("id")
        .single()
    : await supabase.from("commission_rule_versions").insert(fila).select("id").single();
  if (res.error) throw new Error(mensajeDb(res.error, SIN_PERMISOS_REGLA));

  if (data.scope === "general") {
    await sincronizarReglaActual(supabase, data.clinicId, data.professionalId, userId, hoy);
  }
  return { id: res.data.id };
}

export const createCommissionRuleVersion = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => EsquemaVersion.parse(input))
  .handler(async ({ data, context }) => guardarVersion(context.supabase, context.userId, data));

/** Borra una regla que todavía no se usó en un período liquidado. */
export const deleteCommissionRuleVersion = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await exigirGestor(supabase, data.clinicId, userId);
    const { data: fila } = await supabase
      .from("commission_rule_versions")
      .select("professional_id, scope")
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (!fila) throw new Error("Esa regla no existe.");
    const { error } = await supabase
      .from("commission_rule_versions")
      .delete()
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, SIN_PERMISOS_REGLA));
    if (fila.scope === "general") {
      const { data: clinic } = await supabase
        .from("clinics")
        .select("timezone")
        .eq("id", data.clinicId)
        .maybeSingle();
      await sincronizarReglaActual(
        supabase,
        data.clinicId,
        fila.professional_id,
        userId,
        hoyISO(clinic?.timezone || "America/Santiago"),
      );
    }
    return { ok: true };
  });

/** Base de la regla general vigente hoy (para no cambiarla sin querer). */
async function baseVigente(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  professionalId: string,
  hoy: string,
): Promise<BaseComision> {
  const versiones = await cargarVersiones(supabase, clinicId, professionalId);
  return versionGeneralVigente(versiones, professionalId, hoy)?.base ?? "realizado";
}

/**
 * Editor de la regla en Profesionales (anterior a la Ola 10): la regla nueva
 * rige desde hoy y conserva la base vigente. Lo anterior a hoy se sigue
 * calculando con la regla de antes.
 */
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
    const { data: clinic } = await context.supabase
      .from("clinics")
      .select("timezone")
      .eq("id", data.clinicId)
      .maybeSingle();
    const hoy = hoyISO(clinic?.timezone || "America/Santiago");
    await guardarVersion(context.supabase, context.userId, {
      clinicId: data.clinicId,
      professionalId: data.professionalId,
      scope: "general",
      kind: data.kind,
      percentBps: data.percentBps,
      fixedCents: data.fixedCents,
      base: await baseVigente(context.supabase, data.clinicId, data.professionalId, hoy),
      effectiveFrom: hoy,
    });
    return { ok: true };
  });

/** "Quitar comisión" en Profesionales: desde hoy el profesional no comisiona. */
export const removeCommissionRule = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), professionalId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: clinic } = await context.supabase
      .from("clinics")
      .select("timezone")
      .eq("id", data.clinicId)
      .maybeSingle();
    await guardarVersion(context.supabase, context.userId, {
      clinicId: data.clinicId,
      professionalId: data.professionalId,
      scope: "general",
      kind: "none",
      percentBps: 0,
      fixedCents: 0,
      base: "realizado",
      effectiveFrom: hoyISO(clinic?.timezone || "America/Santiago"),
    });
    return { ok: true };
  });

// ─── Reporte y cierre ────────────────────────────────────────────────────

export type CommissionLine = {
  professionalId: string;
  professionalName: string;
  /** Color del profesional en la agenda (AGE-06), para su barra. */
  color: string | null;
  kind: CommissionKind | null;
  /** Base de la regla vigente al final del período (o la congelada). */
  base: BaseComision | null;
  /** Producción del período (suma de price_cents de items completados). */
  productionCents: number;
  procedureCount: number;
  /** Cobrado atribuido al profesional en el período. null en cierres anteriores a la Ola 10. */
  cobradoCents: number | null;
  /** Comisión calculada con la regla de cada fecha. null = sin regla configurada. */
  commissionCents: number | null;
  ruleLabel: string;
  /** Tramos de regla del período (más de uno = la regla cambió a mitad). */
  tramos: TramoLiquidacion[];
  /** true = este período ya fue cerrado, el monto es un snapshot congelado
   * (no se recalcula aunque cambie la regla después). */
  closed: boolean;
  /** Solo tiene sentido si closed=true. */
  paidAt: string | null;
  /** id de `commission_settlements`. Solo tiene sentido si closed=true —
   * lo necesita `markCommissionSettlementPaid`. */
  settlementId: string | null;
};

type FilaLiquidacion = {
  id: string;
  professional_id: string;
  period_from: string;
  period_to: string;
  rule_kind: string;
  rule_percent_bps: number;
  rule_fixed_cents: number;
  production_cents: number;
  procedure_count: number;
  commission_cents: number;
  paid_at: string | null;
  closed_at: string;
  base: string | null;
  cobrado_cents: number | null;
  rule_effective_from: string | null;
  detail: unknown;
};

const COLUMNAS_LIQUIDACION =
  "id, professional_id, period_from, period_to, rule_kind, rule_percent_bps, rule_fixed_cents, production_cents, procedure_count, commission_cents, paid_at, closed_at, base, cobrado_cents, rule_effective_from, detail";

function etiquetaCongelada(s: FilaLiquidacion, currency: string): string {
  const detalle = leerDetalleLiquidacion(s.detail);
  if (detalle && detalle.tramos.length > 1) return `${detalle.tramos.length} reglas en el período`;
  if (detalle && detalle.tramos.length === 1) return detalle.tramos[0].regla;
  return etiquetaRegla(
    {
      kind: s.rule_kind as TipoReglaComision,
      percentBps: s.rule_percent_bps,
      fixedCents: s.rule_fixed_cents,
      base: (s.base as BaseComision | null) ?? "realizado",
    },
    currency,
  );
}

/** Lo que pide la pantalla: o todo el equipo (`commission:view-all`) o solo el propio. */
async function profesionalAlcanzable(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
  pedido: string | undefined,
): Promise<{ veTodo: boolean; professionalId: string | undefined; sinVinculo: boolean }> {
  // Rol + ajustes por persona (EQU-01): ver todo el equipo y ver lo propio se
  // pueden dar o quitar por separado. La base repite el límite (políticas
  // restrictivas `ajuste_quita_*` sobre las tablas de comisiones).
  const permisos = await permisosEfectivosEnClinica(supabase, clinicId, userId);
  const veTodo = permisos.includes("commission:view-all");
  if (veTodo) return { veTodo, professionalId: pedido, sinVinculo: false };
  if (!permisos.includes("commission:view-own")) {
    throw new Error("No tienes permisos para ver las comisiones.");
  }
  // Sin `commission:view-all`, el alcance se acota por la fuerza al profesional
  // vinculado a la cuenta, pida lo que pida el cliente (regla 15):
  // `treatment_items` y `payments` dejan leer filas de otros profesionales.
  const { data: own } = await supabase
    .from("professionals")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  return { veTodo, professionalId: own?.id, sinVinculo: !own };
}

/**
 * Liquidación de comisiones por profesional en un rango [from, to] (fechas
 * civiles de la clínica, inclusive). Si el período exacto ya fue cerrado
 * para un profesional, devuelve la foto congelada; si no, calcula en vivo
 * con la regla que regía en cada fecha (COM-03).
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
    const alcance = await profesionalAlcanzable(
      supabase,
      data.clinicId,
      userId,
      data.professionalId,
    );
    if (alcance.sinVinculo) return [];
    const professionalId = alcance.professionalId;

    let prosQuery = supabase
      .from("professionals")
      .select("id, full_name, color")
      .eq("clinic_id", data.clinicId);
    let settlementsQuery = supabase
      .from("commission_settlements")
      .select(COLUMNAS_LIQUIDACION)
      .eq("clinic_id", data.clinicId)
      .eq("period_from", data.from)
      .eq("period_to", data.to);
    if (professionalId) {
      prosQuery = prosQuery.eq("id", professionalId);
      settlementsQuery = settlementsQuery.eq("professional_id", professionalId);
    }
    const [periodo, { data: pros, error: prosErr }, settlementsRes] = await Promise.all([
      cargarPeriodo(supabase, data.clinicId, data.from, data.to, professionalId),
      prosQuery,
      settlementsQuery,
    ]);
    if (prosErr)
      throw new Error(mensajeDb(prosErr, "No pudimos cargar los profesionales de la clínica."));
    if (settlementsRes.error && !isUndefinedTableError(settlementsRes.error)) {
      throw new Error(
        mensajeDb(settlementsRes.error, "No pudimos cargar los períodos de comisión ya cerrados."),
      );
    }
    const settlementByPro = new Map(
      ((settlementsRes.data ?? []) as FilaLiquidacion[]).map((s) => [s.professional_id, s]),
    );

    const lines: CommissionLine[] = (pros ?? []).map((pro) => {
      const settlement = settlementByPro.get(pro.id);
      if (settlement) {
        const detalle = leerDetalleLiquidacion(settlement.detail);
        return {
          professionalId: pro.id,
          professionalName: pro.full_name,
          color: pro.color ?? null,
          kind: settlement.rule_kind as CommissionKind,
          base: (settlement.base as BaseComision | null) ?? "realizado",
          productionCents: settlement.production_cents,
          procedureCount: settlement.procedure_count,
          cobradoCents: settlement.cobrado_cents,
          commissionCents: settlement.commission_cents,
          ruleLabel: `${etiquetaCongelada(settlement, periodo.currency)} (cerrado)`,
          tramos: detalle?.tramos ?? [],
          closed: true,
          paidAt: settlement.paid_at,
          settlementId: settlement.id,
        };
      }
      const liq = liquidar({
        professionalId: pro.id,
        desde: data.from,
        hasta: data.to,
        versiones: periodo.versiones,
        realizados: periodo.realizados,
        cobrados: periodo.cobrados,
        currency: periodo.currency,
      });
      const vigente = liq.vigente;
      return {
        professionalId: pro.id,
        professionalName: pro.full_name,
        color: pro.color ?? null,
        kind: vigente && vigente.kind !== "none" ? vigente.kind : null,
        base: vigente?.base ?? null,
        productionCents: liq.productionCents,
        procedureCount: liq.procedureCount,
        cobradoCents: liq.cobradoCents,
        commissionCents: liq.commissionCents,
        ruleLabel:
          liq.tramos.length > 1
            ? `${liq.tramos.length} reglas en el período`
            : vigente
              ? etiquetaRegla(vigente, periodo.currency)
              : "Sin regla configurada",
        tramos: liq.tramos,
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
 * Cierra el período [from,to] (COM-04): por cada profesional con regla en el
 * período guarda una foto inmutable con la regla, los montos y el detalle
 * línea por línea. Solo owner/admin (RLS ya lo exige). Si un profesional ya
 * tiene un cierre que se cruza con esas fechas, la base lo rechaza.
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
    const { supabase, userId } = context;
    await exigirGestor(supabase, data.clinicId, userId);
    if (data.to < data.from) throw new Error("El período termina antes de empezar.");

    const [periodo, { data: pros }, { data: yaCerrados }] = await Promise.all([
      cargarPeriodo(supabase, data.clinicId, data.from, data.to),
      supabase.from("professionals").select("id").eq("clinic_id", data.clinicId),
      supabase
        .from("commission_settlements")
        .select("professional_id")
        .eq("clinic_id", data.clinicId)
        .eq("period_from", data.from)
        .eq("period_to", data.to),
    ]);
    if (periodo.truncado) {
      throw new Error(
        "El período tiene demasiados movimientos para cerrarlo de una vez. Ciérralo en tramos más cortos.",
      );
    }
    const cerrados = new Set((yaCerrados ?? []).map((s) => s.professional_id));

    const liquidaciones: Liquidacion[] = (pros ?? [])
      .filter((p) => !cerrados.has(p.id))
      .map((p) =>
        liquidar({
          professionalId: p.id,
          desde: data.from,
          hasta: data.to,
          versiones: periodo.versiones,
          realizados: periodo.realizados,
          cobrados: periodo.cobrados,
          currency: periodo.currency,
        }),
      )
      .filter((l) => l.commissionCents !== null);
    if (liquidaciones.length === 0) return { closed: 0 };

    const rows = liquidaciones.map((l) => {
      const v = l.vigente;
      const detalle: DetalleLiquidacion = detalleParaGuardar(l, periodo.currency);
      return {
        clinic_id: data.clinicId,
        professional_id: l.professionalId,
        period_from: data.from,
        period_to: data.to,
        rule_kind: v?.kind === "fixed" ? "fixed" : "percent",
        rule_percent_bps: v?.kind === "percent" ? v.percentBps : 0,
        rule_fixed_cents: v?.kind === "fixed" ? v.fixedCents : 0,
        rule_effective_from:
          v && !v.id.startsWith("regla-") ? v.effectiveFrom : (l.tramos.at(-1)?.desde ?? null),
        base: v?.base ?? "realizado",
        production_cents: l.productionCents,
        procedure_count: l.procedureCount,
        cobrado_cents: l.cobradoCents,
        commission_cents: l.commissionCents ?? 0,
        detail: detalle as unknown as Json,
        closed_by: userId,
      };
    });

    const { error } = await supabase.from("commission_settlements").insert(rows);
    if (error) {
      if (error.code === "23505") {
        throw new Error("Este período ya fue cerrado para uno o más profesionales.");
      }
      throw new Error(mensajeDb(error, "No pudimos cerrar el período de comisiones."));
    }

    // Aviso al profesional (auditoría 360 v2, F2 comunicaciones) — best
    // effort: el cierre ya está guardado, un email que falla no debe hacer
    // fallar la respuesta.
    await notifyCommissionSettled({
      supabase,
      clinicId: data.clinicId,
      from: data.from,
      to: data.to,
      professionalIds: liquidaciones.map((l) => l.professionalId),
      commissionCentsByProfessional: new Map(
        liquidaciones.map((l) => [l.professionalId, l.commissionCents ?? 0]),
      ),
    });

    return { closed: rows.length };
  });

/** Detalle congelado de una liquidación cerrada (COM-04). */
export const getCommissionSettlement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), settlementId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<LiquidacionCerrada | null> => {
    const { supabase, userId } = context;
    const alcance = await profesionalAlcanzable(supabase, data.clinicId, userId, undefined);
    let q = supabase
      .from("commission_settlements")
      .select(COLUMNAS_LIQUIDACION)
      .eq("clinic_id", data.clinicId)
      .eq("id", data.settlementId);
    if (!alcance.veTodo) {
      if (!alcance.professionalId) return null;
      q = q.eq("professional_id", alcance.professionalId);
    }
    const [{ data: fila, error }, { data: clinic }] = await Promise.all([
      q.maybeSingle(),
      supabase.from("clinics").select("currency").eq("id", data.clinicId).maybeSingle(),
    ]);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la liquidación."));
    if (!fila) return null;
    return mapLiquidacionCerrada(fila as FilaLiquidacion, clinic?.currency ?? "CLP");
  });

export interface LiquidacionCerrada {
  id: string;
  professionalId: string;
  desde: string;
  hasta: string;
  regla: string;
  base: BaseComision;
  productionCents: number;
  procedureCount: number;
  cobradoCents: number | null;
  commissionCents: number;
  closedAt: string;
  paidAt: string | null;
  detalle: DetalleLiquidacion | null;
}

function mapLiquidacionCerrada(s: FilaLiquidacion, currency: string): LiquidacionCerrada {
  return {
    id: s.id,
    professionalId: s.professional_id,
    desde: s.period_from,
    hasta: s.period_to,
    regla: etiquetaCongelada(s, currency),
    base: (s.base as BaseComision | null) ?? "realizado",
    productionCents: s.production_cents,
    procedureCount: s.procedure_count,
    cobradoCents: s.cobrado_cents,
    commissionCents: s.commission_cents,
    closedAt: s.closed_at,
    paidAt: s.paid_at,
    detalle: leerDetalleLiquidacion(s.detail),
  };
}

// ─── Mi desempeño (COM-05) ───────────────────────────────────────────────

export interface MiDesempeno {
  /** false = la cuenta no tiene una ficha de profesional vinculada. */
  vinculado: boolean;
  /** true = quien mira ve finanzas y puede elegir a otro profesional. */
  veTodo: boolean;
  profesionales: { id: string; nombre: string }[];
  profesional: { id: string; nombre: string } | null;
  currency: string;
  hoy: string;
  liquidacion: Liquidacion | null;
  /** Pagos del período que no se pudieron atribuir a ningún profesional (solo con finance:view). */
  sinAtribuirCents: number | null;
  liquidaciones: LiquidacionCerrada[];
  reglas: VersionReglaVista[];
}

/**
 * Mi desempeño (COM-05): producción, cobrado, comisión estimada y
 * liquidaciones del profesional vinculado a la cuenta. Regla 15: sin
 * `finance:view` el servidor ignora el `professionalId` del cliente y usa
 * siempre el propio; un profesional nunca recibe filas de otro.
 */
export const getMiDesempeno = createServerFn({ method: "GET" })
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
  .handler(async ({ data, context }): Promise<MiDesempeno> => {
    const { supabase, userId } = context;
    const alcance = await profesionalAlcanzable(
      supabase,
      data.clinicId,
      userId,
      data.professionalId,
    );

    const [{ data: clinic }, { data: pros }, { data: propio }] = await Promise.all([
      supabase.from("clinics").select("timezone, currency").eq("id", data.clinicId).maybeSingle(),
      alcance.veTodo
        ? supabase
            .from("professionals")
            .select("id, full_name")
            .eq("clinic_id", data.clinicId)
            .order("full_name")
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      supabase
        .from("professionals")
        .select("id, full_name")
        .eq("clinic_id", data.clinicId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    const currency = clinic?.currency ?? "CLP";
    const hoy = hoyISO(clinic?.timezone || "America/Santiago");
    const profesionales = (pros ?? []).map((p) => ({ id: p.id, nombre: p.full_name }));

    // finance:view sin elegir: el propio si existe, si no el primero.
    const elegido =
      alcance.professionalId ?? (alcance.veTodo ? (propio?.id ?? profesionales[0]?.id) : undefined);
    const vacio: MiDesempeno = {
      vinculado: Boolean(propio),
      veTodo: alcance.veTodo,
      profesionales,
      profesional: null,
      currency,
      hoy,
      liquidacion: null,
      sinAtribuirCents: null,
      liquidaciones: [],
      reglas: [],
    };
    if (!elegido) return vacio;

    const nombre =
      profesionales.find((p) => p.id === elegido)?.nombre ??
      (propio?.id === elegido ? propio.full_name : null);
    if (!nombre) return vacio;

    const [periodo, liquidacionesRes, reglas] = await Promise.all([
      cargarPeriodo(supabase, data.clinicId, data.from, data.to, elegido),
      supabase
        .from("commission_settlements")
        .select(COLUMNAS_LIQUIDACION)
        .eq("clinic_id", data.clinicId)
        .eq("professional_id", elegido)
        .order("period_to", { ascending: false })
        .limit(24),
      listCommissionRuleVersions({ data: { clinicId: data.clinicId, professionalId: elegido } }),
    ]);
    if (liquidacionesRes.error && !isUndefinedTableError(liquidacionesRes.error)) {
      throw new Error(mensajeDb(liquidacionesRes.error, "No pudimos cargar tus liquidaciones."));
    }

    return {
      ...vacio,
      profesional: { id: elegido, nombre },
      liquidacion: liquidar({
        professionalId: elegido,
        desde: data.from,
        hasta: data.to,
        versiones: periodo.versiones,
        realizados: periodo.realizados,
        cobrados: periodo.cobrados,
        currency,
      }),
      sinAtribuirCents: alcance.veTodo ? periodo.sinAtribuirCents : null,
      liquidaciones: ((liquidacionesRes.data ?? []) as FilaLiquidacion[]).map((s) =>
        mapLiquidacionCerrada(s, currency),
      ),
      reglas: reglas.versiones.filter((v) => v.professionalId === elegido),
    };
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
