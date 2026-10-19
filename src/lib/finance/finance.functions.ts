import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { mensajeDb } from "@/lib/db-errors";
import { permissionsForRole, type ClinicRole } from "@/lib/access/access";
import { TOOTH_SURFACES } from "@/lib/clinical/odontogram";
import { filaYaCreada } from "@/lib/idempotency";
import {
  applyTreatmentItemSupplyConsumption,
  reverseTreatmentItemSupplyConsumption,
} from "@/lib/clinic-operations/procedure-supplies.functions";
import {
  shouldConsumeSupplies,
  shouldReverseSupplies,
} from "@/lib/clinic-operations/procedure-supply-consumption";
import {
  PAYMENT_METHODS,
  QUOTE_STATUSES,
  TREATMENT_ITEM_STATUSES,
  TREATMENT_PLAN_STATUSES,
  type Payment,
  type Procedure,
  type Quote,
  type QuoteItem,
  type TreatmentItem,
  type TreatmentPlan,
  netAfterRetention,
  repartirCobertura,
} from "@/lib/finance/finance";
import { requireEscritura, requireEscrituraPorFila } from "@/lib/solo-lectura.middleware";

const SURFACE_ENUM = z.enum(TOOTH_SURFACES);
const TOOTH_NUMBER_OPT = z
  .number()
  .int()
  .refine(
    (n) =>
      (n >= 11 && n <= 18) ||
      (n >= 21 && n <= 28) ||
      (n >= 31 && n <= 38) ||
      (n >= 41 && n <= 48) ||
      (n >= 51 && n <= 55) ||
      (n >= 61 && n <= 65) ||
      (n >= 71 && n <= 75) ||
      (n >= 81 && n <= 85),
  )
  .optional();

// ─── PROCEDURES ──────────────────────────────────────────────────────────

const PROCEDURE_COLUMNS =
  "id, code, name, category, default_price_cents, currency, duration_min, is_active, allows_discount, reference_price_cents, lab_cost_cents, position";

type ProcedureRow = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  default_price_cents: number;
  currency: string;
  duration_min: number | null;
  is_active: boolean;
  allows_discount: boolean;
  reference_price_cents: number | null;
  lab_cost_cents: number | null;
  position: number;
};

function mapProcedure(row: ProcedureRow): Procedure {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    defaultPriceCents: row.default_price_cents,
    currency: row.currency,
    durationMin: row.duration_min,
    isActive: row.is_active,
    allowsDiscount: row.allows_discount,
    referencePriceCents: row.reference_price_cents,
    labCostCents: row.lab_cost_cents,
    position: row.position,
  };
}

export const listProcedures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        /**
         * El presupuesto solo ofrece prestaciones vigentes; el arancel
         * (/aranceles) necesita ver también las dadas de baja para poder
         * reactivarlas. Default false = comportamiento de siempre.
         */
        incluirInactivas: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<Procedure[]> => {
    let query = context.supabase
      .from("procedures")
      .select(PROCEDURE_COLUMNS)
      .eq("clinic_id", data.clinicId);
    if (!data.incluirInactivas) query = query.eq("is_active", true);
    const { data: rows, error } = await query
      .order("category", { ascending: true, nullsFirst: true })
      .order("position", { ascending: true })
      .order("name", { ascending: true });

    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar el catálogo de procedimientos."));
    return (rows ?? []).map((r) => mapProcedure(r as ProcedureRow));
  });

/** Campos editables de una prestación del arancel. Compartido por create y update. */
const ProcedureFields = {
  // Sin `currency`: la fija el trigger `moneda_desde_la_clinica` desde
  // `clinics.currency`. En qué moneda está una fila no lo decide el cliente.
  name: z.string().trim().min(1, "Nombre obligatorio."),
  code: z.string().trim().max(40).nullish(),
  category: z.string().trim().max(80).nullish(),
  defaultPriceCents: z.number().int().min(0).default(0),
  durationMin: z.number().int().min(0).max(600).nullish(),
  allowsDiscount: z.boolean().default(true),
  referencePriceCents: z.number().int().min(0).nullish(),
  labCostCents: z.number().int().min(0).nullish(),
  position: z.number().int().min(0).max(9999).default(0),
};

/** DTO → fila de `procedures`. `?? null` y no `|| null`: un 0 es un valor. */
function procedureRow(d: {
  name: string;
  code?: string | null;
  category?: string | null;
  defaultPriceCents: number;
  durationMin?: number | null;
  allowsDiscount: boolean;
  referencePriceCents?: number | null;
  labCostCents?: number | null;
  position: number;
}) {
  return {
    name: d.name,
    code: d.code?.trim() || null,
    category: d.category?.trim() || null,
    default_price_cents: d.defaultPriceCents,
    duration_min: d.durationMin ?? null,
    allows_discount: d.allowsDiscount,
    reference_price_cents: d.referencePriceCents ?? null,
    lab_cost_cents: d.labCostCents ?? null,
    position: d.position,
  };
}

export const createProcedure = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), ...ProcedureFields }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: inserted, error } = await context.supabase
      .from("procedures")
      .insert({ clinic_id: data.clinicId, ...procedureRow(data) })
      .select("id")
      .single();

    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda editar el catálogo.",
        ),
      );
    return { id: inserted.id };
  });

export const updateProcedure = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        procedureId: z.string().uuid(),
        ...ProcedureFields,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("procedures")
      .update(procedureRow(data))
      .eq("id", data.procedureId)
      .eq("clinic_id", data.clinicId);
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda editar el catálogo.",
        ),
      );
    return { ok: true };
  });

/**
 * Da de baja o reactiva una prestación. Nunca se borra: `quote_items` y
 * `treatment_items` la referencian con ON DELETE SET NULL, y aunque el
 * `name_snapshot` protege el histórico (regla 10), perder el vínculo impide
 * saber qué prestación del arancel generó una línea vieja.
 */
export const setProcedureActive = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        procedureId: z.string().uuid(),
        isActive: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("procedures")
      .update({ is_active: data.isActive })
      .eq("id", data.procedureId)
      .eq("clinic_id", data.clinicId);
    if (error)
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda editar el catálogo.",
        ),
      );
    return { ok: true };
  });

/**
 * Alta masiva del arancel desde CSV. Es la puerta de entrada de toda
 * migración: sin esto, un cliente que llega con 300 prestaciones en una
 * planilla tiene que cargarlas a mano y el onboarding se muere ahí.
 *
 * Actualiza por `code` cuando la clínica lo usa (es su identificador real en
 * la planilla de origen) y por `name` cuando no hay código. El parseo del CSV
 * vive en el cliente: acá llegan filas ya validadas, y esta función solo
 * decide alta contra actualización.
 */
export const importProcedures = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        filas: z.array(z.object(ProcedureFields)).min(1).max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ creadas: number; actualizadas: number }> => {
    const { supabase } = context;

    const { data: existentes, error: readErr } = await supabase
      .from("procedures")
      .select("id, code, name")
      .eq("clinic_id", data.clinicId);
    if (readErr)
      throw new Error(mensajeDb(readErr, "No pudimos leer el arancel actual de la clínica."));

    // Un mismo nombre puede repetirse entre categorías; el código, si existe,
    // manda. Se normaliza a minúsculas para que "Consulta" y "consulta" de la
    // planilla no creen dos filas.
    const porCodigo = new Map<string, string>();
    const porNombre = new Map<string, string>();
    for (const p of existentes ?? []) {
      if (p.code) porCodigo.set(p.code.trim().toLowerCase(), p.id);
      porNombre.set(p.name.trim().toLowerCase(), p.id);
    }

    const nuevas: (ReturnType<typeof procedureRow> & { clinic_id: string })[] = [];
    const cambios: { id: string; row: ReturnType<typeof procedureRow> }[] = [];

    for (const fila of data.filas) {
      const row = procedureRow(fila);
      const id =
        (row.code && porCodigo.get(row.code.toLowerCase())) ??
        porNombre.get(row.name.trim().toLowerCase());
      if (id) cambios.push({ id, row });
      else nuevas.push({ clinic_id: data.clinicId, ...row });
    }

    if (nuevas.length) {
      const { error } = await supabase.from("procedures").insert(nuevas);
      if (error)
        throw new Error(
          mensajeDb(
            error,
            "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda importar al catálogo.",
          ),
        );
    }
    for (const { id, row } of cambios) {
      const { error } = await supabase
        .from("procedures")
        .update(row)
        .eq("id", id)
        .eq("clinic_id", data.clinicId);
      if (error) throw new Error("No pudimos actualizar una prestación. " + error.message);
    }

    return { creadas: nuevas.length, actualizadas: cambios.length };
  });

// ─── QUOTES ──────────────────────────────────────────────────────────────

const QUOTE_COLUMNS =
  "id, number, status, currency, subtotal_cents, discount_cents, commercial_discount_pct, total_cents, agreement_id, agreement_name_snapshot, coverage_total_cents, notes, valid_until, sent_at, accepted_at, rejected_at, accepted_by_name, created_at";
const QUOTE_ITEM_COLUMNS =
  "id, quote_id, procedure_id, name_snapshot, tooth_number, surface, quantity, unit_price_cents, discount_cents, discount_pct, total_cents, coverage_cents, patient_cents, phase_label, phase_position, position, notes";

type QuoteRow = {
  id: string;
  number: string;
  status: string;
  currency: string;
  subtotal_cents: number;
  discount_cents: number;
  commercial_discount_pct: number | null;
  total_cents: number;
  agreement_id: string | null;
  agreement_name_snapshot: string | null;
  coverage_total_cents: number | null;
  notes: string | null;
  valid_until: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  accepted_by_name: string | null;
  created_at: string;
};
type QuoteItemRow = {
  id: string;
  quote_id: string;
  procedure_id: string | null;
  name_snapshot: string;
  tooth_number: number | null;
  surface: string | null;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  discount_pct: number | null;
  total_cents: number;
  coverage_cents: number | null;
  patient_cents: number | null;
  phase_label: string | null;
  phase_position: number;
  position: number;
  notes: string | null;
};

function mapQuoteItem(row: QuoteItemRow): QuoteItem {
  return {
    id: row.id,
    procedureId: row.procedure_id,
    nameSnapshot: row.name_snapshot,
    toothNumber: row.tooth_number,
    surface: row.surface as QuoteItem["surface"],
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    discountCents: row.discount_cents,
    discountPct: row.discount_pct,
    totalCents: row.total_cents,
    coverageCents: row.coverage_cents,
    patientCents: row.patient_cents,
    phaseLabel: row.phase_label,
    phasePosition: row.phase_position,
    position: row.position,
    notes: row.notes,
  };
}

function mapQuote(row: QuoteRow, items: QuoteItem[]): Quote {
  return {
    id: row.id,
    number: row.number,
    status: row.status as Quote["status"],
    currency: row.currency,
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    commercialDiscountPct: row.commercial_discount_pct,
    totalCents: row.total_cents,
    agreementId: row.agreement_id,
    agreementNameSnapshot: row.agreement_name_snapshot,
    coverageTotalCents: row.coverage_total_cents,
    notes: row.notes,
    validUntil: row.valid_until,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at,
    rejectedAt: row.rejected_at,
    acceptedByName: row.accepted_by_name,
    createdAt: row.created_at,
    items,
  };
}

/** Presupuestos del paciente, con sus ítems anidados. */
export const listQuotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<Quote[]> => {
    const { supabase } = context;

    const { data: quoteRows, error } = await supabase
      .from("quotes")
      .select(QUOTE_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .order("created_at", { ascending: false });

    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar los presupuestos del paciente."));
    const quotes = (quoteRows ?? []) as QuoteRow[];
    if (!quotes.length) return [];

    const { data: itemRows, error: itemsError } = await supabase
      .from("quote_items")
      .select(QUOTE_ITEM_COLUMNS)
      .in(
        "quote_id",
        quotes.map((q) => q.id),
      )
      .order("phase_position", { ascending: true })
      .order("position", { ascending: true });

    if (itemsError)
      throw new Error(mensajeDb(itemsError, "No pudimos cargar los ítems de los presupuestos."));

    const itemsByQuote = new Map<string, QuoteItem[]>();
    for (const it of (itemRows ?? []) as QuoteItemRow[]) {
      const arr = itemsByQuote.get(it.quote_id) ?? [];
      arr.push(mapQuoteItem(it));
      itemsByQuote.set(it.quote_id, arr);
    }
    return quotes.map((q) => mapQuote(q, itemsByQuote.get(q.id) ?? []));
  });

const QuoteItemInput = z.object({
  procedureId: z.string().uuid().optional(),
  nameSnapshot: z.string().trim().min(1, "Nombre del ítem obligatorio."),
  toothNumber: TOOTH_NUMBER_OPT,
  surface: SURFACE_ENUM.optional(),
  quantity: z.number().int().min(1).max(20).default(1),
  unitPriceCents: z.number().int().min(0),
  discountCents: z.number().int().min(0).default(0),
  /** Si viene, manda sobre `discountCents`: el server deriva los cents. */
  discountPct: z.number().min(0).max(100).nullish(),
  phaseLabel: z.string().trim().max(60).nullish(),
  phasePosition: z.number().int().min(0).max(999).default(0),
  notes: z.string().trim().max(300).optional(),
});

type QuoteItemDraft = z.infer<typeof QuoteItemInput>;

/**
 * Resuelve el descuento de un ítem a cents, que es la única verdad contable
 * (regla 6). Cuando el usuario negoció en porcentaje, el porcentaje manda y
 * los cents se derivan; cuando cargó pesos, el porcentaje queda `null`.
 *
 * El descuento nunca puede superar la línea: un 100% deja el ítem en cero, no
 * en negativo, y el CHECK de la tabla exige `discount_cents >= 0`.
 */
function resolveItemDiscount(item: QuoteItemDraft): {
  discountCents: number;
  discountPct: number | null;
} {
  const lineCents = item.quantity * item.unitPriceCents;
  if (item.discountPct === null || item.discountPct === undefined) {
    return { discountCents: Math.min(item.discountCents, lineCents), discountPct: null };
  }
  return {
    discountCents: Math.min(Math.round((lineCents * item.discountPct) / 100), lineCents),
    discountPct: item.discountPct,
  };
}

/**
 * Totales del presupuesto a partir de sus ítems. Extraído porque `createQuote`
 * y `updateQuote` lo calculaban duplicado y ahora además tienen que resolver
 * el porcentaje por línea y el descuento comercial global.
 *
 * `position` se reasigna por índice dentro de cada fase, no sobre la lista
 * entera: así dos ítems de fases distintas pueden ambos ser el primero de su
 * bloque y el orden se lee correcto al agrupar.
 */
function computeQuoteTotals(
  items: QuoteItemDraft[],
  globalDiscountCents: number,
  commercialDiscountPct: number | null | undefined,
  /**
   * Cobertura del convenio del paciente, por `procedure_id`. Vacío o ausente =
   * presupuesto particular, y todas las líneas quedan con `coverageCents` y
   * `patientCents` en NULL (regla 11: sin convenio no es cobertura cero).
   */
  coberturaPorProcedimiento?: Map<
    string,
    { coveragePct: number | null; coverageFixedCents: number | null }
  >,
) {
  const positionByPhase = new Map<string, number>();

  const resolved = items.map((item) => {
    const { discountCents, discountPct } = resolveItemDiscount(item);
    const phaseLabel = item.phaseLabel?.trim() || null;
    const phaseKey = phaseLabel ?? "";
    const position = positionByPhase.get(phaseKey) ?? 0;
    positionByPhase.set(phaseKey, position + 1);

    const total = Math.max(0, item.quantity * item.unitPriceCents - discountCents);
    // Un ítem escrito a mano (sin `procedureId`) no puede tener cobertura: el
    // convenio cubre prestaciones de su arancel, no texto libre.
    const cobertura = item.procedureId
      ? coberturaPorProcedimiento?.get(item.procedureId)
      : undefined;
    const { coverageCents, patientCents } = repartirCobertura(total, cobertura, item.quantity);

    return {
      ...item,
      phaseLabel,
      phasePosition: phaseLabel ? item.phasePosition : 0,
      discountCents,
      discountPct,
      position,
      total,
      coverageCents,
      patientCents,
    };
  });

  const subtotal = resolved.reduce((sum, item) => sum + item.total, 0);
  const discount =
    commercialDiscountPct === null || commercialDiscountPct === undefined
      ? Math.min(globalDiscountCents, subtotal)
      : Math.min(Math.round((subtotal * commercialDiscountPct) / 100), subtotal);

  // ── El descuento comercial BAJA a las líneas ────────────────────────────
  // Auditoría 04-sep: restarlo solo al total del presupuesto lo hacía
  // desaparecer al aceptar. El trigger de conversión copia `total_cents` de
  // cada línea a `treatment_items.price_cents`, y de ahí sale el saldo del
  // paciente — así que un 20 % de descuento se veía en el presupuesto y el
  // paciente igual terminaba debiendo el 100 %.
  //
  // Se prorratea proporcional al peso de cada línea. El resto de la división
  // se le carga a la última línea con monto, para que la suma de las líneas
  // dé EXACTAMENTE el total del presupuesto y no un peso de diferencia por
  // redondeo.
  if (discount > 0 && subtotal > 0) {
    let repartido = 0;
    const conMonto = resolved.filter((i) => i.total > 0);
    conMonto.forEach((item, idx) => {
      const parte =
        idx === conMonto.length - 1
          ? discount - repartido
          : Math.round((item.total * discount) / subtotal);
      repartido += parte;
      item.total = Math.max(0, item.total - parte);
      // El reparto convenio/paciente se recalcula sobre la línea ya
      // descontada: si no, el convenio cubriría un porcentaje de un precio
      // que nadie va a pagar.
      if (item.coverageCents !== null) {
        const cobertura = item.procedureId
          ? coberturaPorProcedimiento?.get(item.procedureId)
          : undefined;
        const nuevo = repartirCobertura(item.total, cobertura, item.quantity);
        item.coverageCents = nuevo.coverageCents;
        item.patientCents = nuevo.patientCents;
      }
    });
  }

  // Total del convenio: null cuando ninguna línea tuvo cobertura, para que el
  // presupuesto no muestre "cubre $0" en un caso particular.
  const conCobertura = resolved.filter((i) => i.coverageCents !== null);
  const coverageTotalCents = conCobertura.length
    ? conCobertura.reduce((sum, i) => sum + (i.coverageCents ?? 0), 0)
    : null;

  return {
    items: resolved,
    subtotal,
    discountCents: discount,
    commercialDiscountPct: commercialDiscountPct ?? null,
    coverageTotalCents,
    // Suma de las líneas ya descontadas: por construcción es idéntico a
    // `subtotal - discount`, pero se calcula desde las líneas para que si
    // alguna vez divergen, gane lo que el paciente realmente va a ver.
    total: resolved.reduce((sum, item) => sum + item.total, 0),
  };
}

/** Fila lista para insertar en `quote_items`, compartida por create y update. */
function quoteItemRow(
  item: ReturnType<typeof computeQuoteTotals>["items"][number],
  clinicId: string,
  quoteId: string,
) {
  return {
    clinic_id: clinicId,
    quote_id: quoteId,
    procedure_id: item.procedureId ?? null,
    name_snapshot: item.nameSnapshot,
    tooth_number: item.toothNumber ?? null,
    surface: item.surface ?? null,
    quantity: item.quantity,
    unit_price_cents: item.unitPriceCents,
    discount_cents: item.discountCents,
    discount_pct: item.discountPct,
    total_cents: item.total,
    coverage_cents: item.coverageCents,
    patient_cents: item.patientCents,
    phase_label: item.phaseLabel,
    phase_position: item.phasePosition,
    position: item.position,
    notes: item.notes || null,
  };
}

/**
 * Crea un presupuesto con sus ítems. Genera un número correlativo por clínica
 * si no se especifica uno. Cada ítem calcula su total como
 * qty*unit - discount, y el subtotal/total del quote se derivan.
 */
/**
 * Convenio del paciente y su tabla de cobertura, para repartir el presupuesto.
 *
 * Se resuelve en el servidor y no se acepta desde el cliente a propósito: el
 * convenio decide cuánto termina debiendo el paciente, así que dejar que el
 * navegador lo mande sería dejar que el navegador decida un saldo.
 */
async function cargarCoberturaDelPaciente(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  patientId: string,
): Promise<{
  agreementId: string | null;
  agreementName: string | null;
  cobertura: Map<string, { coveragePct: number | null; coverageFixedCents: number | null }>;
}> {
  const vacio = { agreementId: null, agreementName: null, cobertura: new Map() };

  const { data: paciente } = await supabase
    .from("patients")
    .select("agreement_id")
    .eq("id", patientId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (!paciente?.agreement_id) return vacio;

  const [{ data: convenio }, { data: filas }] = await Promise.all([
    supabase
      .from("agreements")
      .select("name, is_active")
      .eq("id", paciente.agreement_id)
      .maybeSingle(),
    supabase
      .from("agreement_coverage")
      .select("procedure_id, coverage_pct, coverage_fixed_cents")
      .eq("clinic_id", clinicId)
      .eq("agreement_id", paciente.agreement_id),
  ]);

  // Un convenio dado de baja no reparte nada nuevo: los presupuestos viejos
  // conservan su snapshot, pero uno nuevo se cobra como particular.
  if (!convenio?.is_active) return vacio;

  const cobertura = new Map<
    string,
    { coveragePct: number | null; coverageFixedCents: number | null }
  >();
  for (const f of filas ?? []) {
    cobertura.set(f.procedure_id, {
      coveragePct: f.coverage_pct === null ? null : Number(f.coverage_pct),
      coverageFixedCents: f.coverage_fixed_cents,
    });
  }
  return { agreementId: paciente.agreement_id, agreementName: convenio.name, cobertura };
}

export const createQuote = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        // Sin `currency`: la fija el trigger `moneda_desde_la_clinica` desde
        // `clinics.currency`. La moneda no la decide el cliente.
        notes: z.string().trim().max(1000).optional(),
        validUntil: z.string().optional(),
        globalDiscountCents: z.number().int().min(0).default(0),
        commercialDiscountPct: z.number().min(0).max(100).nullish(),
        items: z.array(QuoteItemInput).min(1, "Agrega al menos un ítem."),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string; number: string }> => {
    const { supabase } = context;

    // Correlativo atómico via RPC SECURITY DEFINER. Reset por año en tz de
    // la clínica (evita que un quote creado a las 22:00 del 31-dic en Chile
    // lleve el año siguiente porque el server está en UTC).
    const { data: clinic } = await supabase
      .from("clinics")
      .select("timezone")
      .eq("id", data.clinicId)
      .maybeSingle();
    const tz = clinic?.timezone || "America/Santiago";
    const year = Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(new Date()),
    );

    const { data: nextValue, error: rpcErr } = await supabase.rpc("next_clinic_counter", {
      p_clinic_id: data.clinicId,
      p_kind: "quote",
      p_year: year,
    });
    if (rpcErr) throw new Error("No pudimos generar el número de presupuesto. " + rpcErr.message);
    const nextNumber = `P-${year}-${String(nextValue as number).padStart(4, "0")}`;

    const convenio = await cargarCoberturaDelPaciente(supabase, data.clinicId, data.patientId);
    const totals = computeQuoteTotals(
      data.items,
      data.globalDiscountCents,
      data.commercialDiscountPct,
      convenio.cobertura,
    );

    const { data: quoteRow, error: qErr } = await supabase
      .from("quotes")
      .insert({
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        number: nextNumber,
        agreement_id: convenio.agreementId,
        agreement_name_snapshot: convenio.agreementName,
        coverage_total_cents: totals.coverageTotalCents,
        notes: data.notes || null,
        valid_until: data.validUntil || null,
        subtotal_cents: totals.subtotal,
        discount_cents: totals.discountCents,
        commercial_discount_pct: totals.commercialDiscountPct,
        total_cents: totals.total,
      })
      .select("id, number")
      .single();

    if (qErr) throw new Error("No pudimos crear el presupuesto. " + qErr.message);

    const { error: iErr } = await supabase
      .from("quote_items")
      .insert(totals.items.map((it) => quoteItemRow(it, data.clinicId, quoteRow.id)));

    if (iErr) {
      // Best-effort rollback manual (no hay transacciones cross-request en la
      // API PostgREST). Borrar el quote arrastra sus items por FK CASCADE si
      // los llegó a insertar.
      await supabase.from("quotes").delete().eq("id", quoteRow.id);
      throw new Error("No pudimos guardar los ítems del presupuesto. " + iErr.message);
    }

    return { id: quoteRow.id, number: quoteRow.number };
  });

/**
 * Corrige un presupuesto ya enviado sin pasar por rechazar+recrear (antes la
 * única forma de arreglar un ítem mal cargado era esa, perdiendo el número
 * correlativo y el historial — auditoría UX, 30-ago). Solo permitido en
 * 'draft'/'sent': una vez 'accepted' el trigger de base ya generó un plan de
 * tratamiento a partir de estos ítems, y 'rejected'/'expired'/'converted' son
 * estados terminales — corregirlos ahí sería reescribir un hecho ya cerrado.
 * Reemplaza los ítems (borrar + reinsertar, mismo patrón simple que
 * createQuote) y recalcula subtotal/total; conserva el número correlativo.
 */
export const updateQuote = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        quoteId: z.string().uuid(),
        clinicId: z.string().uuid(),
        notes: z.string().trim().max(1000).optional(),
        validUntil: z.string().optional(),
        globalDiscountCents: z.number().int().min(0).default(0),
        commercialDiscountPct: z.number().min(0).max(100).nullish(),
        items: z.array(QuoteItemInput).min(1, "Agrega al menos un ítem."),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase } = context;

    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .select("status, patient_id")
      .eq("id", data.quoteId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (qErr) throw new Error(mensajeDb(qErr, "No pudimos verificar el estado del presupuesto."));
    if (!quote) throw new Error("No encontramos ese presupuesto.");
    if (quote.status !== "draft" && quote.status !== "sent") {
      throw new Error(
        "Solo puedes corregir un presupuesto en borrador o enviado — este ya fue aceptado, rechazado o venció.",
      );
    }

    // Se recarga la cobertura en cada edición: si al paciente le cambiaron el
    // convenio desde que se emitió, corregir el presupuesto tiene que reflejarlo.
    const convenio = await cargarCoberturaDelPaciente(supabase, data.clinicId, quote.patient_id);
    const totals = computeQuoteTotals(
      data.items,
      data.globalDiscountCents,
      data.commercialDiscountPct,
      convenio.cobertura,
    );

    const { error: delErr } = await supabase
      .from("quote_items")
      .delete()
      .eq("quote_id", data.quoteId);
    if (delErr)
      throw new Error("No pudimos actualizar los ítems del presupuesto. " + delErr.message);

    const { error: insErr } = await supabase
      .from("quote_items")
      .insert(totals.items.map((it) => quoteItemRow(it, data.clinicId, data.quoteId)));
    if (insErr) throw new Error("No pudimos guardar los ítems del presupuesto. " + insErr.message);

    const { error: updErr } = await supabase
      .from("quotes")
      .update({
        notes: data.notes || null,
        valid_until: data.validUntil || null,
        subtotal_cents: totals.subtotal,
        discount_cents: totals.discountCents,
        commercial_discount_pct: totals.commercialDiscountPct,
        total_cents: totals.total,
        agreement_id: convenio.agreementId,
        agreement_name_snapshot: convenio.agreementName,
        coverage_total_cents: totals.coverageTotalCents,
      })
      .eq("id", data.quoteId)
      .eq("clinic_id", data.clinicId);
    if (updErr) throw new Error("No pudimos guardar el presupuesto. " + updErr.message);

    return { ok: true };
  });

/**
 * Cambia el estado de un presupuesto. Cuando se marca como 'accepted', el
 * trigger de base convierte el quote en un plan de tratamiento con sus ítems.
 */
export const setQuoteStatus = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("quotes", "quoteId")])
  .validator((input: unknown) =>
    z
      .object({
        quoteId: z.string().uuid(),
        status: z.enum(QUOTE_STATUSES),
        acceptedByName: z.string().trim().max(120).optional(),
        // Firma manuscrita (PNG data URL) al aceptar. Opcional: aceptar sin
        // firma sigue siendo válido (queda la evidencia de IP + nombre).
        signatureDataUrl: z.string().max(2_000_000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    // Evidencia técnica del consentimiento (útil ante disputa de cobro):
    // IP + user-agent del request real en el momento del "accepted", además
    // del nombre que tipeó el staff. `getRequest()` expone la Request HTTP
    // real dentro del handler de un createServerFn (mismo patrón que
    // `logPortalAccess` en portal.functions.ts).
    let acceptedIp: string | null = null;
    let acceptedUserAgent: string | null = null;
    if (data.status === "accepted") {
      const req = getRequest();
      acceptedIp = req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      acceptedUserAgent = req?.headers.get("user-agent") ?? null;
    }

    // Firma manuscrita al aceptar: se sube al bucket privado clinical-documents
    // bajo {clinic_id}/{patient_id}/quote-signatures/. Path en accepted_signature_path.
    //
    // Si la subida falla, el presupuesto igual se marca "accepted" (aceptar
    // sigue siendo válido sin firma — queda IP + nombre como evidencia), pero
    // NO podemos dejar que falle en silencio: `signatureUploadFailed` distingue
    // "el paciente no firmó" de "el paciente firmó y no pudimos guardarlo", y
    // el cliente lo usa para mostrar un error visible en vez de un success mudo.
    let signaturePath: string | null = null;
    let signatureUploadFailed = false;
    if (data.status === "accepted" && data.signatureDataUrl) {
      const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(data.signatureDataUrl);
      if (match) {
        const { data: quote } = await context.supabase
          .from("quotes")
          .select("clinic_id, patient_id")
          .eq("id", data.quoteId)
          .maybeSingle();
        if (quote) {
          const bytes = Uint8Array.from(Buffer.from(match[2], "base64"));
          const path = `${quote.clinic_id}/${quote.patient_id}/quote-signatures/${crypto.randomUUID()}.png`;
          const { error: upErr } = await context.supabase.storage
            .from("clinical-documents")
            .upload(path, bytes, { contentType: match[1], upsert: false });
          if (upErr) {
            signatureUploadFailed = true;
            console.error("[setQuoteStatus] Falló la subida de la firma a Storage", {
              quoteId: data.quoteId,
              message: upErr.message,
            });
          } else {
            signaturePath = path;
          }
        } else {
          signatureUploadFailed = true;
          console.error("[setQuoteStatus] No se encontró el presupuesto al subir la firma", {
            quoteId: data.quoteId,
          });
        }
      } else {
        signatureUploadFailed = true;
        console.error("[setQuoteStatus] Data URL de la firma con formato inesperado", {
          quoteId: data.quoteId,
        });
      }
    }

    const patch = {
      status: data.status,
      ...(data.status === "sent" && { sent_at: now }),
      ...(data.status === "accepted" && { accepted_at: now }),
      ...(data.status === "accepted" &&
        data.acceptedByName && { accepted_by_name: data.acceptedByName }),
      ...(data.status === "accepted" && { accepted_ip: acceptedIp }),
      ...(data.status === "accepted" && { accepted_user_agent: acceptedUserAgent }),
      ...(signaturePath && { accepted_signature_path: signaturePath }),
      ...(data.status === "rejected" && { rejected_at: now }),
    };

    const { error } = await context.supabase.from("quotes").update(patch).eq("id", data.quoteId);
    if (error) throw new Error("No tienes permisos para cambiar este presupuesto.");
    return { ok: true, signatureUploadFailed };
  });

// ─── TREATMENT PLANS ─────────────────────────────────────────────────────

const PLAN_COLUMNS =
  "id, quote_id, name, status, total_cents, currency, started_at, completed_at, notes, created_at";
const ITEM_COLUMNS =
  "id, procedure_id, quote_item_id, name_snapshot, tooth_number, surface, status, price_cents, coverage_cents, patient_cents, phase_label, phase_position, position, professional_id, scheduled_appointment_id, completed_at, notes";

type PlanRow = {
  id: string;
  quote_id: string | null;
  name: string;
  status: string;
  total_cents: number;
  currency: string;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
};
type PlanItemRow = {
  id: string;
  procedure_id: string | null;
  quote_item_id: string | null;
  name_snapshot: string;
  tooth_number: number | null;
  surface: string | null;
  status: string;
  price_cents: number;
  coverage_cents: number | null;
  patient_cents: number | null;
  phase_label: string | null;
  phase_position: number;
  position: number;
  professional_id: string | null;
  scheduled_appointment_id: string | null;
  completed_at: string | null;
  notes: string | null;
};

function mapPlanItem(row: PlanItemRow): TreatmentItem {
  return {
    id: row.id,
    procedureId: row.procedure_id,
    quoteItemId: row.quote_item_id,
    nameSnapshot: row.name_snapshot,
    toothNumber: row.tooth_number,
    surface: row.surface as TreatmentItem["surface"],
    status: row.status as TreatmentItem["status"],
    priceCents: row.price_cents,
    coverageCents: row.coverage_cents,
    patientCents: row.patient_cents,
    phaseLabel: row.phase_label,
    phasePosition: row.phase_position,
    position: row.position,
    professionalId: row.professional_id,
    scheduledAppointmentId: row.scheduled_appointment_id,
    completedAt: row.completed_at,
    notes: row.notes,
  };
}

function mapPlan(row: PlanRow, items: TreatmentItem[]): TreatmentPlan {
  return {
    id: row.id,
    quoteId: row.quote_id,
    name: row.name,
    status: row.status as TreatmentPlan["status"],
    totalCents: row.total_cents,
    currency: row.currency,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    notes: row.notes,
    createdAt: row.created_at,
    items,
  };
}

/** Planes de tratamiento del paciente con sus ítems. */
export const listTreatmentPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<TreatmentPlan[]> => {
    const { supabase } = context;

    const { data: planRows, error } = await supabase
      .from("treatment_plans")
      .select(PLAN_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .order("created_at", { ascending: false });

    if (error)
      throw new Error(
        mensajeDb(error, "No pudimos cargar los planes de tratamiento del paciente."),
      );
    const plans = (planRows ?? []) as PlanRow[];
    if (!plans.length) return [];

    const { data: itemRows, error: itemsError } = await supabase
      .from("treatment_items")
      .select("plan_id, " + ITEM_COLUMNS)
      .in(
        "plan_id",
        plans.map((p) => p.id),
      )
      .order("phase_position", { ascending: true })
      .order("position", { ascending: true });

    if (itemsError)
      throw new Error(
        mensajeDb(itemsError, "No pudimos cargar los ítems de los planes de tratamiento."),
      );

    const itemsByPlan = new Map<string, TreatmentItem[]>();
    for (const it of (itemRows ?? []) as unknown as (PlanItemRow & { plan_id: string })[]) {
      const arr = itemsByPlan.get(it.plan_id) ?? [];
      arr.push(mapPlanItem(it));
      itemsByPlan.set(it.plan_id, arr);
    }
    return plans.map((p) => mapPlan(p, itemsByPlan.get(p.id) ?? []));
  });

/** Listado a nivel clínica para la vista /tratamientos. No trae los items
 * enteros — solo el conteo + completados para computar avance. Esto lo hace
 * viable con volumen alto (evita traer miles de items para pintar barras de
 * progreso). Si necesitas el detalle de un plan, el usuario abre la ficha
 * del paciente y ahí sí se hidrata con listTreatmentPlans(patientId).
 *
 * treatment_plans no tiene professional_id ni branch_id en el schema —
 * la asignación es a nivel item — así que la vista solo filtra por
 * estado, fecha y búsqueda de texto en nombre del plan o del paciente.
 */
export const listClinicTreatmentPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      Array<{
        id: string;
        name: string;
        patientId: string;
        patientName: string;
        patientDocument: string | null;
        status: TreatmentPlan["status"];
        currency: string;
        createdAt: string;
        startedAt: string | null;
        totalCents: number;
        itemsCount: number;
        itemsCompleted: number;
      }>
    > => {
      const { supabase } = context;

      const { data: planRows, error } = await supabase
        .from("treatment_plans")
        .select("id, name, patient_id, status, total_cents, currency, started_at, created_at")
        .eq("clinic_id", data.clinicId)
        .order("created_at", { ascending: false })
        .limit(500);

      if (error)
        throw new Error(
          mensajeDb(error, "No pudimos cargar los planes de tratamiento de la clínica."),
        );
      const plans = planRows ?? [];
      if (!plans.length) return [];

      const patientIds = [...new Set(plans.map((p) => p.patient_id))];
      const planIds = plans.map((p) => p.id);

      const [{ data: patients, error: pErr }, { data: items, error: iErr }] = await Promise.all([
        supabase
          .from("patients")
          .select("id, full_name, document_id")
          .eq("clinic_id", data.clinicId)
          .in("id", patientIds),
        supabase
          .from("treatment_items")
          .select("plan_id, status")
          .eq("clinic_id", data.clinicId)
          .in("plan_id", planIds),
      ]);
      if (pErr) throw new Error(mensajeDb(pErr, "No pudimos cargar los datos de los pacientes."));
      if (iErr)
        throw new Error(
          mensajeDb(iErr, "No pudimos cargar el avance de los planes de tratamiento."),
        );

      const patientById = new Map((patients ?? []).map((p) => [p.id, p]));

      const countsByPlan = new Map<string, { total: number; completed: number }>();
      for (const it of items ?? []) {
        const c = countsByPlan.get(it.plan_id) ?? { total: 0, completed: 0 };
        c.total += 1;
        if (it.status === "completed") c.completed += 1;
        countsByPlan.set(it.plan_id, c);
      }

      return plans.map((p) => {
        const patient = patientById.get(p.patient_id);
        const counts = countsByPlan.get(p.id) ?? { total: 0, completed: 0 };
        return {
          id: p.id,
          name: p.name,
          patientId: p.patient_id,
          patientName: patient?.full_name ?? "Paciente",
          patientDocument: patient?.document_id ?? null,
          status: p.status as TreatmentPlan["status"],
          currency: p.currency,
          createdAt: p.created_at,
          startedAt: p.started_at,
          totalCents: p.total_cents,
          itemsCount: counts.total,
          itemsCompleted: counts.completed,
        };
      });
    },
  );

export const setTreatmentItemStatus = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("treatment_items", "itemId")])
  .validator((input: unknown) =>
    z
      .object({
        itemId: z.string().uuid(),
        status: z.enum(TREATMENT_ITEM_STATUSES),
        // Tanda 2: cantidad final por insumo `variable`, confirmada por el
        // dentista en el diálogo de ajuste. Sin esto, cada insumo se
        // descuenta con la receta estándar ajustada por rendimiento.
        supplyOverrides: z.record(z.string().uuid(), z.number().positive()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Necesitamos el status ANTERIOR para saber si esta es una transición
    // real hacia/desde "completed" — Tanda 1, receta de insumos: sin esto
    // no hay forma de distinguir "recién se completó" (hay que consumir) de
    // "ya estaba completo" (no volver a descontar).
    const { data: current, error: currentError } = await context.supabase
      .from("treatment_items")
      .select("clinic_id, status, procedure_id")
      .eq("id", data.itemId)
      .single();
    if (currentError) throw new Error("No pudimos actualizar el ítem.");

    const isCompleted = data.status === "completed";
    // Al completar registramos quién y cuándo. Al des-completar limpiamos
    // ambos campos para no dejar auditoría inconsistente.
    const patch = isCompleted
      ? { status: data.status, completed_at: new Date().toISOString(), completed_by: userId }
      : { status: data.status, completed_at: null, completed_by: null };
    const { error } = await context.supabase
      .from("treatment_items")
      .update(patch)
      .eq("id", data.itemId);
    if (error) throw new Error("No pudimos actualizar el ítem.");

    let skippedSupplyCount = 0;
    if (shouldConsumeSupplies(current.status, data.status)) {
      const result = await applyTreatmentItemSupplyConsumption(context.supabase, {
        clinicId: current.clinic_id,
        treatmentItemId: data.itemId,
        procedureId: current.procedure_id,
        overrides: data.supplyOverrides,
      });
      skippedSupplyCount = result.skippedCount;
    } else if (shouldReverseSupplies(current.status, data.status)) {
      await reverseTreatmentItemSupplyConsumption(context.supabase, {
        clinicId: current.clinic_id,
        treatmentItemId: data.itemId,
      });
    }

    return { ok: true, skippedSupplyCount };
  });

export const setTreatmentPlanStatus = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("treatment_plans", "planId")])
  .validator((input: unknown) =>
    z.object({ planId: z.string().uuid(), status: z.enum(TREATMENT_PLAN_STATUSES) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch = {
      status: data.status,
      ...(data.status === "completed" && { completed_at: new Date().toISOString() }),
    };
    const { error } = await context.supabase
      .from("treatment_plans")
      .update(patch)
      .eq("id", data.planId);
    if (error) throw new Error("No pudimos actualizar el plan.");
    return { ok: true };
  });

// ─── PAYMENTS ────────────────────────────────────────────────────────────

const PAYMENT_COLUMNS =
  "id, amount_cents, currency, method, reference, paid_at, notes, treatment_plan_id, treatment_item_id, created_by, reversed_at, reversed_by, reversal_reason";

type PaymentRow = {
  id: string;
  amount_cents: number;
  currency: string;
  method: string;
  reference: string | null;
  paid_at: string;
  notes: string | null;
  treatment_plan_id: string | null;
  treatment_item_id: string | null;
  created_by: string;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
};

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    amountCents: row.amount_cents,
    currency: row.currency,
    method: row.method as Payment["method"],
    reference: row.reference,
    paidAt: row.paid_at,
    notes: row.notes,
    treatmentPlanId: row.treatment_plan_id,
    treatmentItemId: row.treatment_item_id,
    createdById: row.created_by,
    reversedAt: row.reversed_at,
    reversedById: row.reversed_by,
    reversalReason: row.reversal_reason,
  };
}

/** Pagos del paciente ordenados del más reciente al más viejo. */
export const listPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<Payment[]> => {
    const { data: rows, error } = await context.supabase
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .order("paid_at", { ascending: false });

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los pagos del paciente."));
    return (rows ?? []).map((r) => mapPayment(r as PaymentRow));
  });

export const registerPayment = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        // Igual que en `createAppointment`: lo genera el equipo al capturar
        // sin conexión, para que reintentar la cola no cobre dos veces.
        id: z.string().uuid().optional(),
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        amountCents: z.number().int().positive("El monto debe ser mayor a cero."),
        // Sin `currency`: la fija el trigger `moneda_desde_la_clinica` desde
        // `clinics.currency`. La moneda no la decide el cliente.
        method: z.enum(PAYMENT_METHODS).default("cash"),
        /**
         * Medio de pago configurado de la clínica (G-6). Opcional: la cola
         * offline y cualquier caller viejo siguen mandando solo `method`, y
         * en ese caso el pago se guarda sin retención, igual que antes.
         */
        paymentMethodId: z.string().uuid().nullish(),
        reference: z.string().trim().max(120).optional(),
        paidAt: z
          .string()
          .optional()
          .refine((s) => !s || !Number.isNaN(new Date(s).getTime()), "Fecha de pago inválida.")
          .refine(
            (s) => !s || new Date(s) <= new Date(),
            "No se puede registrar un pago con fecha futura.",
          ),
        notes: z.string().trim().max(500).optional(),
        treatmentPlanId: z.string().uuid().optional(),
        /**
         * Imputar el cobro a una línea concreta del plan. Sin esto, el
         * semáforo de pago por línea (G-5) nunca podía salir de "sin pagos":
         * `paidCentsByItem` lee esta columna y nadie la escribía (auditoría
         * 04-sep). Sigue siendo opcional — un cobro global al plan es
         * perfectamente válido y deja las líneas sin imputación.
         */
        treatmentItemId: z.string().uuid().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    // Congela nombre y neto del medio de pago al cobrar (regla 10). No se
    // recalcula después: la retención del operador cambia con el tiempo y el
    // recibo tiene que seguir diciendo lo que efectivamente entró ese día.
    let methodName: string | null = null;
    let netCents: number | null = null;
    if (data.paymentMethodId) {
      const { data: medio } = await context.supabase
        .from("payment_methods")
        .select("name, retention_pct")
        .eq("id", data.paymentMethodId)
        .eq("clinic_id", data.clinicId)
        .maybeSingle();
      if (medio) {
        methodName = medio.name;
        netCents = netAfterRetention(data.amountCents, Number(medio.retention_pct) || 0);
      }
    }

    // Vínculo opcional a la caja del turno (módulo Cajas). Solo cubre el caso
    // de una sola caja abierta sin sucursal — una clínica con varias
    // sucursales y varias cajas abiertas a la vez queda sin auto-vincular acá
    // (placeholder nullable, regla 11: no adivinar a cuál corresponde).
    const { data: cajaAbierta } = await context.supabase
      .from("cash_registers")
      .select("id")
      .eq("clinic_id", data.clinicId)
      .eq("status", "open")
      .is("branch_id", null)
      .maybeSingle();

    const { data: inserted, error } = await context.supabase
      .from("payments")
      .insert({
        cash_register_id: cajaAbierta?.id ?? null,
        ...(data.id ? { id: data.id } : {}),
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        amount_cents: data.amountCents,
        method: data.method,
        payment_method_id: data.paymentMethodId ?? null,
        method_name_snapshot: methodName,
        net_cents: netCents,
        reference: data.reference || null,
        // ⚠️ Este `new Date()` es la hora del SERVIDOR al procesar. Un cobro
        // capturado sin conexión a las 10:00 que sincroniza a las 15:00
        // quedaría con la hora equivocada y rompería el cierre de caja del
        // día. Por eso la cola offline SIEMPRE manda `paidAt` sellado en la
        // captura; este default es solo para el camino online.
        paid_at: data.paidAt ?? new Date().toISOString(),
        notes: data.notes || null,
        treatment_plan_id: data.treatmentPlanId ?? null,
        treatment_item_id: data.treatmentItemId ?? null,
      })
      .select("id")
      .single();

    if (error) {
      const yaEstaba = await filaYaCreada(
        context.supabase,
        "payments",
        data.id,
        data.clinicId,
        error,
      );
      if (yaEstaba) return { id: yaEstaba };
      throw new Error(
        mensajeDb(
          error,
          "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda registrar pagos.",
        ),
      );
    }
    return { id: inserted.id };
  });

/**
 * Reversa un pago mal cargado. No lo borra ni edita su monto/método — los
 * deja intactos para la historia y agrega `reversed_at/by/reason`. Todo
 * cálculo de saldo, caja o reportes que agregue pagos tiene que excluir los
 * reversados (`reversed_at IS NULL`); ver `fetchPatientBalances`,
 * `getFinanceSummary` y `closeCashRegister`.
 */
export const reversePayment = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        clinicId: z.string().uuid(),
        reason: z.string().trim().min(3, "Cuenta por qué se reversa este pago.").max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<void> => {
    const { data: membership } = await context.supabase
      .from("clinic_members")
      .select("role")
      .eq("clinic_id", data.clinicId)
      .eq("user_id", context.userId)
      .maybeSingle();
    const puedeReversar = membership?.role
      ? permissionsForRole(membership.role as ClinicRole).includes("payments:reverse")
      : false;
    if (!puedeReversar) throw new Error("No tienes permisos para reversar pagos.");

    const { data: existing, error: fetchError } = await context.supabase
      .from("payments")
      .select("id, reversed_at")
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (fetchError) throw new Error(mensajeDb(fetchError, "No pudimos leer el pago."));
    if (!existing) throw new Error("Ese pago no existe.");
    if (existing.reversed_at) throw new Error("Ese pago ya está reversado.");

    const { error } = await context.supabase
      .from("payments")
      .update({
        reversed_at: new Date().toISOString(),
        reversed_by: context.userId,
        reversal_reason: data.reason,
      })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos reversar el pago."));
  });

// getPatientBalance eliminado: era dead code. El cálculo del saldo del
// paciente vive en dos lugares —server-side en `getPatient` (para el header
// de la ficha) y client-side en FinanceSection (sobre listPayments +
// listTreatmentPlans). Ambos aplican la misma regla: excluir planes
// cancelados. Si en el futuro necesitamos exponer el balance como endpoint
// separado (portal del paciente, dashboard financiero), reintroducir aquí.
