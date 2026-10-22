import type { ToothSurface } from "@/lib/clinical/odontogram";
import type { TipoMedio } from "@/lib/finance/medios-de-pago";

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "partially_accepted",
  "rejected",
  "expired",
  "converted",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/**
 * Etiqueta de cada valor del enum de la base. Los estados que ve el usuario
 * (siete, con "finalizado" derivado del plan) están en
 * `estados-presupuesto.ts`; esto queda para exportaciones y textos sueltos.
 */
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Borrador",
  sent: "Emitido",
  accepted: "Aceptado",
  partially_accepted: "Aceptado parcial",
  rejected: "Rechazado",
  expired: "Vencido",
  converted: "Aceptado",
};

export const TREATMENT_PLAN_STATUSES = ["active", "on_hold", "completed", "cancelled"] as const;
export type TreatmentPlanStatus = (typeof TREATMENT_PLAN_STATUSES)[number];

export const TREATMENT_PLAN_STATUS_LABELS: Record<TreatmentPlanStatus, string> = {
  active: "Activo",
  on_hold: "En pausa",
  completed: "Finalizado",
  cancelled: "Cancelado",
};

export const TREATMENT_ITEM_STATUSES = ["pending", "in_progress", "completed", "skipped"] as const;
export type TreatmentItemStatus = (typeof TREATMENT_ITEM_STATUSES)[number];

export const TREATMENT_ITEM_STATUS_LABELS: Record<TreatmentItemStatus, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  completed: "Realizado",
  skipped: "Omitido",
};

export interface Procedure {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  defaultPriceCents: number;
  currency: string;
  durationMin: number | null;
  isActive: boolean;
  /** Si es false, la UI no deja descontar esta prestación en el presupuesto. */
  allowsDiscount: boolean;
  /** Valor referencial declarado ante convenios. `null` = sin dato, no cero. */
  referencePriceCents: number | null;
  /** Costo de laboratorio. `null` = sin dato, no cero. */
  labCostCents: number | null;
  position: number;
  /** Especialidad del arancel (ADM-02). `null` = sin especialidad. Opcional:
   * ausente si la base todavía no tiene la migración 20261024100000. */
  specialtyId?: string | null;
  /** Código Fonasa (MLE) de la prestación, si la clínica lo usa (ADM-03). */
  fonasaCode?: string | null;
  /** Tiene equivalente en la Modalidad de Atención Institucional (ADM-03). */
  isMai?: boolean;
  /** Rango de referencia que ve la clínica; nunca se impone. `null` = sin dato. */
  suggestedMinCents?: number | null;
  suggestedMaxCents?: number | null;
  /** Ítem del catálogo semilla del que se copió. No es FK (regla 10). */
  catalogKey?: string | null;
}

/**
 * Medio de pago configurable por clínica (G-6). Reemplaza al enum fijo para
 * lo nuevo, sin borrarlo: `Payment.method` sigue existiendo para el histórico.
 */
export interface PaymentMethodConfig {
  id: string;
  name: string;
  /** Comisión que retiene el operador, 0-100. El paciente paga el total igual. */
  retentionPct: number;
  allowsRefund: boolean;
  isActive: boolean;
  position: number;
  /** Valor del enum viejo al que equivale, si equivale a alguno. */
  legacyKey: PaymentMethod | null;
  /**
   * Tipo de medio (FIN-07): efectivo, débito, Redcompra, cheque, bono…
   * `null` = medio propio sin tipo, cuenta como "otro". Ver `medios-de-pago.ts`.
   */
  kind: TipoMedio | null;
}

/** Neto que le queda a la clínica tras la retención del medio de pago. */
export function netAfterRetention(amountCents: number, retentionPct: number): number {
  if (retentionPct <= 0) return amountCents;
  return Math.max(0, amountCents - Math.round((amountCents * retentionPct) / 100));
}

export interface Expense {
  id: string;
  branchId: string | null;
  category: string;
  description: string;
  supplier: string | null;
  amountCents: number;
  currency: string;
  paymentMethodId: string | null;
  methodNameSnapshot: string | null;
  /** Día contable del gasto (YYYY-MM-DD), no un instante. */
  incurredOn: string;
  notes: string | null;
  createdAt: string;
}

/**
 * Categorías sugeridas para el primer gasto de una clínica. NO es un catálogo
 * cerrado: `expenses.category` es texto libre y la UI ofrece además las que la
 * clínica ya viene usando.
 */
export const CATEGORIAS_GASTO_SUGERIDAS = [
  "Arriendo",
  "Sueldos",
  "Insumos clínicos",
  "Laboratorio",
  "Servicios básicos",
  "Marketing",
  "Equipamiento",
  "Mantención",
  "Impuestos",
  "Otros",
] as const;

/**
 * Convenio o seguro del paciente (Fonasa, Isapre, obra social, EPS…). El
 * `kind` es texto libre porque el vocabulario cambia por país.
 */
export interface Agreement {
  id: string;
  name: string;
  kind: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  notes: string | null;
  isActive: boolean;
}

/**
 * Cuánto cubre un convenio de una prestación. Exactamente una de las dos
 * formas: porcentaje de la línea, o monto fijo por unidad (el "bono" de valor
 * cerrado). La base lo garantiza con un CHECK.
 */
export interface AgreementCoverage {
  id: string;
  agreementId: string;
  procedureId: string;
  coveragePct: number | null;
  coverageFixedCents: number | null;
}

/**
 * Reparte una línea entre convenio y paciente.
 *
 * La cobertura se calcula sobre el total de la línea ya descontado, no sobre
 * el precio de lista: si la clínica bonificó un 20 %, el convenio cubre su
 * porcentaje de lo que efectivamente se cobra, no de un precio que nadie va a
 * pagar. Una clínica que necesite la otra semántica usa monto fijo.
 *
 * `null` de cobertura significa "sin convenio" y devuelve `null` en ambos
 * lados: el resto del sistema cae entonces a `total_cents`, que es el
 * comportamiento de siempre (regla 11 — sin dato no es cero).
 */
export function repartirCobertura(
  lineTotalCents: number,
  coverage: { coveragePct: number | null; coverageFixedCents: number | null } | null | undefined,
  quantity = 1,
): { coverageCents: number | null; patientCents: number | null } {
  if (!coverage) return { coverageCents: null, patientCents: null };

  const bruto =
    coverage.coverageFixedCents !== null
      ? // Monto fijo POR UNIDAD: dos piezas con el mismo bono cubren el doble.
        coverage.coverageFixedCents * quantity
      : Math.round((lineTotalCents * (coverage.coveragePct ?? 0)) / 100);

  // El convenio nunca puede cubrir más que la línea: un bono de $50.000 sobre
  // una prestación de $30.000 cubre $30.000, no deja al paciente a favor.
  const coverageCents = Math.min(Math.max(0, bruto), lineTotalCents);
  return { coverageCents, patientCents: lineTotalCents - coverageCents };
}

export interface QuoteItem {
  id: string;
  procedureId: string | null;
  nameSnapshot: string;
  toothNumber: number | null;
  surface: ToothSurface | null;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  /**
   * Descuento negociado en % del que se derivó `discountCents`. `null` cuando
   * el descuento se cargó directamente en pesos — no es un 0, es "no aplica"
   * (regla 11). La verdad contable siempre es `discountCents`.
   */
  discountPct: number | null;
  totalCents: number;
  /** Lo que pone el convenio en esta línea. `null` = sin convenio, no cero. */
  coverageCents: number | null;
  /** Lo que paga el paciente. `null` = sin convenio; el saldo usa `totalCents`. */
  patientCents: number | null;
  /** Bloque que agrupa el ítem ("Fase 1", "Rehabilitación"). `null` = sin fase. */
  phaseLabel: string | null;
  phasePosition: number;
  position: number;
  notes: string | null;
  /**
   * Marca del odontograma que originó la línea (PR 11b). `null` = cargada a
   * mano. Sirve para no volver a sugerir una marca ya presupuestada.
   */
  odontogramMarkId: string | null;
  /**
   * Aceptación parcial: `false` = el paciente no aceptó esta línea. `null` =
   * sin decisión (en una aceptación total entran todas).
   */
  accepted: boolean | null;
  /** Paquete del que salió la línea (PLA-12). `null` = línea suelta. */
  packageId: string | null;
  packageNameSnapshot: string | null;
}

export interface Quote {
  id: string;
  number: string;
  status: QuoteStatus;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  /** Descuento comercial global en %. `null` = se cargó en pesos o no hay. */
  commercialDiscountPct: number | null;
  totalCents: number;
  /** Convenio aplicado. `null` = paciente particular. */
  agreementId: string | null;
  agreementNameSnapshot: string | null;
  /** Total que pone el convenio. `null` = sin convenio. */
  coverageTotalCents: number | null;
  notes: string | null;
  validUntil: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  acceptedByName: string | null;
  /** Profesional a cargo. `null` = sin asignar. */
  professionalId: string | null;
  /** Lo que se aceptó (total o parcial). `null` = no aceptado. */
  acceptedTotalCents: number | null;
  rejectionReason: string | null;
  createdAt: string;
  items: QuoteItem[];
}

export interface TreatmentItem {
  id: string;
  procedureId: string | null;
  quoteItemId: string | null;
  nameSnapshot: string;
  toothNumber: number | null;
  surface: ToothSurface | null;
  status: TreatmentItemStatus;
  priceCents: number;
  /** Lo que pone el convenio. `null` = sin convenio, no cero. */
  coverageCents: number | null;
  /** Lo que debe el paciente por esta línea. Es lo que suma el saldo. */
  patientCents: number | null;
  /** Heredado del `quote_item` al aceptar el presupuesto. `null` = sin fase. */
  phaseLabel: string | null;
  phasePosition: number;
  position: number;
  professionalId: string | null;
  scheduledAppointmentId: string | null;
  completedAt: string | null;
  notes: string | null;
}

export interface TreatmentPlan {
  id: string;
  quoteId: string | null;
  name: string;
  status: TreatmentPlanStatus;
  totalCents: number;
  currency: string;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  items: TreatmentItem[];
}

export const PAYMENT_METHODS = ["cash", "debit_card", "credit_card", "transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  debit_card: "Tarjeta débito",
  credit_card: "Tarjeta crédito",
  transfer: "Transferencia",
  other: "Otro",
};

export const AGING_BUCKETS = ["0-30", "31-60", "61-90", "90+", "sin_fecha"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  "0-30": "0-30 días",
  "31-60": "31-60 días",
  "61-90": "61-90 días",
  "90+": "Más de 90 días",
  sin_fecha: "Sin fecha de referencia",
};

/**
 * Un paciente con saldo pendiente, para el reporte de morosidad. La
 * "antigüedad" se cuenta desde el último pago vigente (no reversado); si el
 * paciente nunca pagó nada, desde que se creó su plan de tratamiento activo
 * más viejo. `referenceDate: null` = ninguna de las dos existe (caso raro:
 * deuda sin plan ni pago, ej. producto de un ajuste manual) — bucket
 * `sin_fecha`, no se inventa un día cero (regla 11).
 */
export interface AccountsReceivableAgingRow {
  patientId: string;
  patientName: string;
  balanceCents: number;
  currency: string;
  referenceDate: string | null;
  daysOverdue: number | null;
  bucket: AgingBucket;
}

export function agingBucketFor(days: number | null): AgingBucket {
  if (days === null) return "sin_fecha";
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export interface Payment {
  id: string;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  paidAt: string;
  notes: string | null;
  treatmentPlanId: string | null;
  treatmentItemId: string | null;
  createdById: string;
  /** `null` = pago vigente. Reversado = excluido de saldos/caja/reportes. */
  reversedAt: string | null;
  reversedById: string | null;
  reversalReason: string | null;
  /** Nombre del medio configurado al cobrar (snapshot). `null` = pago anterior a G-6. */
  methodNameSnapshot: string | null;
  /** Cuenta por cobrar a la que se imputó. `null` = a cuenta o solo al plan. */
  receivableId: string | null;
  /** Cobro repartido en varios medios: las filas del mismo cobro comparten id. */
  paymentGroupId: string | null;
  /** Bono + copago (MKT-03): las dos filas del mismo cobro comparten id. */
  coverageGroupId: string | null;
  /** Qué parte es la fila en un cobro con bono. `null` = pago sin bono. */
  coverageRole: "bono" | "copago" | null;
  /** Número del bono (solo en la fila del bono). */
  voucherNumber: string | null;
}

export const LAB_ORDER_STATUSES = [
  "enviado",
  "en_proceso",
  "recibido",
  "reprocesar",
  "cancelado",
] as const;
export type LabOrderStatus = (typeof LAB_ORDER_STATUSES)[number];

export const LAB_ORDER_STATUS_LABELS: Record<LabOrderStatus, string> = {
  enviado: "Enviado",
  en_proceso: "En proceso",
  recibido: "Recibido",
  reprocesar: "Reprocesar",
  cancelado: "Cancelado",
};

export interface Lab {
  id: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface LabOrder {
  id: string;
  labId: string | null;
  labNameSnapshot: string | null;
  patientId: string;
  patientName: string;
  treatmentItemId: string | null;
  professionalId: string | null;
  description: string;
  toothNumbers: number[] | null;
  status: LabOrderStatus;
  /** Días de calendario del taller (YYYY-MM-DD), no instantes. */
  sentOn: string;
  dueOn: string | null;
  receivedOn: string | null;
  costCents: number | null;
  currency: string;
  notes: string | null;
}

/**
 * Una orden está atrasada si prometieron una fecha, ya pasó, y todavía no
 * llegó. Sin `dueOn` no hay atraso posible: no se inventa un plazo que el
 * laboratorio nunca dio.
 */
export function ordenAtrasada(orden: LabOrder, hoyIso: string): boolean {
  if (!orden.dueOn) return false;
  if (orden.status === "recibido" || orden.status === "cancelado") return false;
  return orden.dueOn < hoyIso;
}

export interface Warehouse {
  id: string;
  name: string;
  branchId: string | null;
  isActive: boolean;
  position: number;
}

/** Nivel del semáforo de stock. */
export type NivelStock = "critico" | "bajo" | "ok" | "sin-alerta";

/**
 * Semáforo de tres niveles sobre el stock de seguridad, como el de Dentalink.
 *
 * `minStock` null significa que la clínica no configuró alerta para ese ítem —
 * no que el mínimo sea cero. Sin ese dato no hay semáforo posible y se
 * devuelve "sin-alerta" en vez de pintar todo en rojo.
 *
 * El umbral de "bajo" es 1,5× el mínimo: el punto no es avisar cuando ya no
 * queda, sino cuando queda poco y todavía hay tiempo de reponer.
 */
export function nivelStock(actual: number, minStock: number | null): NivelStock {
  if (minStock === null) return "sin-alerta";
  if (actual <= minStock) return "critico";
  if (actual <= minStock * 1.5) return "bajo";
  return "ok";
}

/**
 * Precio promedio ponderado desde el historial de entradas.
 *
 * Se calcula y no se guarda: guardarlo obliga a recalcularlo en cada
 * movimiento y a mantener dos verdades que se desincronizan. Las entradas sin
 * costo cargado se ignoran — promediarlas como cero hundiría el promedio y
 * haría creer que el insumo sale más barato de lo que sale.
 *
 * Devuelve `null` cuando ninguna entrada tiene costo: sin dato no es cero.
 */
export function precioPromedioPonderado(
  entradas: { quantity: number; unitCostCents: number | null }[],
): number | null {
  const conCosto = entradas.filter((e) => e.unitCostCents !== null && e.quantity > 0);
  if (!conCosto.length) return null;
  const unidades = conCosto.reduce((s, e) => s + e.quantity, 0);
  if (unidades <= 0) return null;
  const total = conCosto.reduce((s, e) => s + e.quantity * (e.unitCostCents ?? 0), 0);
  return Math.round(total / unidades);
}

/** Etiqueta del bloque implícito que junta los ítems sin fase asignada. */
export const SIN_FASE_LABEL = "Sin fase";

export interface PhaseGroup<T> {
  /** `null` para el bloque implícito de ítems sin fase. */
  label: string | null;
  phasePosition: number;
  items: T[];
  subtotalCents: number;
}

/**
 * Agrupa ítems de presupuesto o de plan en bloques por `phaseLabel`, para
 * renderizar el subtotal por fase que espera un dentista (G-2).
 *
 * Agrupa por `phaseLabel` y no por `phasePosition` a propósito: la etiqueta es
 * lo que el usuario escribió y lo que ve, y dos ítems con el mismo nombre de
 * fase tienen que caer juntos aunque sus `phase_position` se hayan desfasado
 * por una edición. La posición solo ordena los bloques entre sí.
 *
 * Los ítems sin fase salen siempre primero — es el equivalente de la "Sección
 * sin nombre" de Dentalink, donde vive lo que se cargó antes de que existieran
 * las fases y lo que no pertenece a ninguna etapa.
 */
export function groupByPhase<
  T extends { phaseLabel: string | null; phasePosition: number; position: number },
>(items: T[], amount: (item: T) => number): PhaseGroup<T>[] {
  // Clave `string | null`: un Map de JS acepta null como clave, así que el
  // bloque sin fase no necesita un centinela de texto que podría colisionar
  // con una fase que la clínica llame igual.
  const groups = new Map<string | null, PhaseGroup<T>>();

  for (const item of items) {
    const key = item.phaseLabel;
    let group = groups.get(key);
    if (!group) {
      group = {
        label: item.phaseLabel,
        // Los sin-fase se fuerzan al principio; el resto respeta lo guardado.
        phasePosition: item.phaseLabel === null ? -1 : item.phasePosition,
        items: [],
        subtotalCents: 0,
      };
      groups.set(key, group);
    }
    group.items.push(item);
    group.subtotalCents += amount(item);
  }

  const ordered = [...groups.values()].sort(
    (a, b) => a.phasePosition - b.phasePosition || (a.label ?? "").localeCompare(b.label ?? ""),
  );
  for (const group of ordered) group.items.sort((a, b) => a.position - b.position);
  return ordered;
}

/** Estado de cobro de un ítem del plan, para el semáforo por línea (G-5). */
export type ItemPaymentState = "unpaid" | "partial" | "paid";

export const ITEM_PAYMENT_LABELS: Record<ItemPaymentState, string> = {
  unpaid: "Sin pagos imputados",
  partial: "Pago parcial",
  paid: "Pagado",
};

/**
 * Cuánto se pagó de cada ítem del plan, mirando `payments.treatment_item_id`.
 * Devuelve cents por id de ítem; un ítem ausente del mapa no tiene pagos.
 *
 * Solo cuenta los pagos imputados a un ítem concreto: un pago suelto contra el
 * plan entero no se prorratea entre las líneas, porque repartirlo inventaría
 * una imputación que nadie hizo y el semáforo mentiría. Un plan cobrado
 * globalmente muestra todas sus líneas en "Sin pagos imputados", que es la
 * verdad — el saldo real del paciente sigue estando en el encabezado de la
 * ficha, calculado server-side sobre el total.
 */
export function paidCentsByItem(payments: Payment[]): Map<string, number> {
  const paidByItem = new Map<string, number>();
  for (const payment of payments) {
    if (!payment.treatmentItemId) continue;
    paidByItem.set(
      payment.treatmentItemId,
      (paidByItem.get(payment.treatmentItemId) ?? 0) + payment.amountCents,
    );
  }
  return paidByItem;
}

/** Resuelve el semáforo de un ítem contra lo que se le imputó. */
export function itemPaymentState(paidCents: number, priceCents: number): ItemPaymentState {
  if (paidCents <= 0) return "unpaid";
  return paidCents >= priceCents ? "paid" : "partial";
}

/**
 * Saldo del paciente calculado en runtime desde treatment_items vs payments.
 * `totalBilledCents` = suma de precios de todos los ítems (pending o no).
 * `totalPaidCents` = suma de todos los pagos del paciente.
 * `balanceCents` = billed − paid. Positivo = paciente debe. Negativo = crédito.
 */
export interface PatientBalance {
  totalBilledCents: number;
  totalPaidCents: number;
  balanceCents: number;
  currency: string;
}

/**
 * Monedas ISO 4217 sin subunidades (o con subunidad no cotidiana). Para
 * estas guardamos "cents" = unidad entera. Para el resto, cents = 1/100
 * de la unidad. Fuente: la tabla de currency exponent de ISO. Los que
 * importan para LatAm y adyacentes son CLP, PYG, COP, VND, JPY, KRW.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "CLP",
  "PYG",
  "COP",
  "VND",
  "JPY",
  "KRW",
  "CLF",
  "BIF",
  "DJF",
  "GNF",
  "ISK",
  "KMF",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

function centsFactor(currency: string) {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
}

/**
 * Locale de formato por moneda. `Intl` necesita un locale para decidir el
 * separador de miles y el de decimales, y hasta ahora estaba fijo en "es-CL":
 * una clínica mexicana veía "100,50" donde espera "100.50".
 *
 * La moneda no determina el locale en el caso general —el dólar se usa en
 * medio mundo— pero para el mercado de Esmalia la aproximación es correcta, y
 * es estrictamente mejor que asumir Chile siempre.
 */
const LOCALE_POR_MONEDA: Record<string, string> = {
  ARS: "es-AR",
  BOB: "es-BO",
  BRL: "pt-BR",
  CLP: "es-CL",
  COP: "es-CO",
  CRC: "es-CR",
  DOP: "es-DO",
  EUR: "es-ES",
  GTQ: "es-GT",
  MXN: "es-MX",
  PEN: "es-PE",
  PYG: "es-PY",
  USD: "en-US",
  UYU: "es-UY",
};

/**
 * Formato de moneda.
 *
 * `currency` es obligatorio a propósito. Con un default de "CLP" cualquier
 * llamada distraída formateaba plata ajena como pesos chilenos sin que nada
 * fallara; volviéndolo obligatorio, el compilador enumera los sitios que no
 * tienen la moneda a mano en vez de dejarlos pasar en silencio.
 */
export function formatMoney(cents: number, currency: string): string {
  const iso = currency.toUpperCase();
  const isZeroDec = ZERO_DECIMAL_CURRENCIES.has(iso);
  const texto = new Intl.NumberFormat(LOCALE_POR_MONEDA[iso] ?? "es-CL", {
    style: "currency",
    currency,
    maximumFractionDigits: isZeroDec ? 0 : 2,
  }).format(Math.abs(cents) / centsFactor(currency));
  // CLDR de es-CL pone el signo después del símbolo ("$-2.391.000"), que en
  // un resultado negativo se lee como error de tipeo: el signo va adelante.
  return cents < 0 ? `-${texto}` : texto;
}

/**
 * Unidad que ve el usuario → entero que guarda la base.
 *
 * En CLP el factor es 1 y la conversión no hace nada, que es justo por lo que
 * media app guardaba el número tipeado directo como "cents" y nadie lo notó.
 * En MXN el mismo descuido es un error de 100×.
 */
export function toCents(pesos: number, currency: string): number {
  return Math.round(pesos * centsFactor(currency));
}

/**
 * Paso de un `<input type="number">` de dinero: 1 donde no hay decimales,
 * 0.01 donde sí. Sin esto el navegador valida contra el paso implícito de 1
 * y rechaza "45.50" en una clínica en MXN antes de que el código tenga
 * oportunidad de convertirlo.
 */
export function pasoDeMoneda(currency: string): number {
  return centsFactor(currency) === 1 ? 1 : 0.01;
}

/** Entero guardado → unidad que ve el usuario. Inversa de `toCents`. */
export function fromCents(cents: number, currency: string): number {
  return cents / centsFactor(currency);
}
