// Cuentas por cobrar, cuotas y cobro con varios medios (Ola 3 · Frente Cobros:
// FIN-02, FIN-03, FIN-04).
//
// La base guarda la cuenta, sus cuotas y los pagos; todo lo demás se calcula
// acá: el estado (pendiente, parcial, pagada, vencida; "anulada" sí se
// guarda), la imputación de lo pagado a cada cuota y la antigüedad de la
// deuda. Calcular en vez de guardar evita reescribir filas con cada pago,
// reversa o cambio de día, y un pago reversado libera su cuota solo.
//
// Fechas: días contables `YYYY-MM-DD` de la clínica. "Hoy" siempre llega como
// argumento (`hoyISO(timezone)` en la UI, `hoyISO(clinics.timezone)` en el
// servidor): nada acá mira el reloj (regla 7).
//
// Lógica pura: sin red ni base.

import { coincideTermino } from "@/lib/search";

// ─── Estados ────────────────────────────────────────────────────────────────

export const ESTADOS_CUENTA = ["pendiente", "parcial", "vencida", "pagada", "anulada"] as const;
export type EstadoCuenta = (typeof ESTADOS_CUENTA)[number];

export const ETIQUETA_ESTADO_CUENTA: Record<EstadoCuenta, string> = {
  pendiente: "Pendiente",
  parcial: "Pago parcial",
  vencida: "Vencida",
  pagada: "Pagada",
  anulada: "Anulada",
};

/** Una cuenta que todavía se puede cobrar. */
export function estaPorCobrar(estado: EstadoCuenta): boolean {
  return estado === "pendiente" || estado === "parcial" || estado === "vencida";
}

// ─── Antigüedad ─────────────────────────────────────────────────────────────

export const TRAMOS_ATRASO = ["al_dia", "1-30", "31-60", "61-90", "90+"] as const;
export type TramoAtraso = (typeof TRAMOS_ATRASO)[number];

export const ETIQUETA_TRAMO: Record<TramoAtraso, string> = {
  al_dia: "Sin atraso",
  "1-30": "1 a 30 días",
  "31-60": "31 a 60 días",
  "61-90": "61 a 90 días",
  "90+": "Más de 90 días",
};

/** Tramo según los días de atraso. `null` = no hay nada vencido. */
export function tramoDeAtraso(dias: number | null): TramoAtraso {
  if (dias === null || dias <= 0) return "al_dia";
  if (dias <= 30) return "1-30";
  if (dias <= 60) return "31-60";
  if (dias <= 90) return "61-90";
  return "90+";
}

// ─── Fechas de calendario ───────────────────────────────────────────────────

const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function esDiaIso(valor: string): boolean {
  const m = DIA_ISO.exec(valor);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1;
}

function aUtc(dia: string): number {
  const m = DIA_ISO.exec(dia);
  if (!m) throw new Error(`Fecha inválida: ${dia}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Días de calendario de `desde` a `hasta` (positivo si `hasta` es posterior). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta) - aUtc(desde)) / 86_400_000);
}

/**
 * Suma meses a un día. Si el día no existe en el mes de destino (31 de enero
 * + 1 mes), cae en el último día de ese mes: la cuota "del 31" vence el 28 o
 * 29 de febrero, no el 3 de marzo.
 */
export function sumarMeses(dia: string, meses: number): string {
  const m = DIA_ISO.exec(dia);
  if (!m) throw new Error(`Fecha inválida: ${dia}`);
  const anio = Number(m[1]);
  const mes = Number(m[2]) - 1 + meses;
  const diaDelMes = Number(m[3]);
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(anio, mes, Math.min(diaDelMes, ultimo)));
  return d.toISOString().slice(0, 10);
}

// ─── Cuotas (FIN-03) ────────────────────────────────────────────────────────

export interface Cuota {
  id: string;
  number: number;
  /** Día de vencimiento (YYYY-MM-DD). */
  dueOn: string;
  amountCents: number;
}

export type EstadoCuota = "pagada" | "parcial" | "pendiente";

export const ETIQUETA_ESTADO_CUOTA: Record<EstadoCuota, string> = {
  pagada: "Pagada",
  parcial: "Pago parcial",
  pendiente: "Pendiente",
};

export interface CuotaImputada extends Cuota {
  pagadoCents: number;
  pendienteCents: number;
  estado: EstadoCuota;
  /** Venció (antes de hoy) y le falta plata. */
  vencida: boolean;
}

/** Orden de imputación: vencimiento más antiguo primero; empate por número. */
function ordenDeImputacion<T extends { dueOn: string; number: number }>(cuotas: readonly T[]): T[] {
  return [...cuotas].sort((a, b) =>
    a.dueOn === b.dueOn ? a.number - b.number : a.dueOn < b.dueOn ? -1 : 1,
  );
}

/**
 * Reparte lo pagado de la cuenta entre sus cuotas: cada peso cubre primero la
 * cuota más antigua (FIN-03). Lo pagado de más (a favor) no se arrastra a
 * ninguna cuota inexistente; lo informa `resumirCuenta`.
 */
export function imputarACuotas(
  cuotas: readonly Cuota[],
  pagadoCents: number,
  hoy: string,
): CuotaImputada[] {
  let resto = Math.max(0, pagadoCents);
  return ordenDeImputacion(cuotas).map((c) => {
    const pagado = Math.min(resto, c.amountCents);
    resto -= pagado;
    const pendiente = c.amountCents - pagado;
    const estado: EstadoCuota = pendiente === 0 ? "pagada" : pagado > 0 ? "parcial" : "pendiente";
    return {
      ...c,
      pagadoCents: pagado,
      pendienteCents: pendiente,
      estado,
      vencida: pendiente > 0 && c.dueOn < hoy,
    };
  });
}

/**
 * Divide un monto en `n` cuotas mensuales iguales a partir de
 * `primerVencimiento`. La suma es exacta en cents: el resto de la división se
 * reparte de a una unidad en las primeras cuotas (nunca se pierde ni se
 * inventa un peso).
 */
export function cuotasIguales(
  totalCents: number,
  n: number,
  primerVencimiento: string,
  cadaMeses = 1,
): { dueOn: string; amountCents: number }[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) return [];
  if (!Number.isInteger(n) || n < 1) return [];
  const cantidad = Math.min(n, totalCents);
  const base = Math.floor(totalCents / cantidad);
  const resto = totalCents - base * cantidad;
  return Array.from({ length: cantidad }, (_, i) => ({
    dueOn: sumarMeses(primerVencimiento, i * cadaMeses),
    amountCents: base + (i < resto ? 1 : 0),
  }));
}

export const MAX_CUOTAS = 120;

/**
 * Valida un plan de cuotas antes de mandarlo. Devuelve el motivo en palabras
 * del usuario, o `null` si está bien. Una lista vacía es válida: quita las
 * cuotas y la cuenta se cobra entera.
 */
export function validarCuotas(
  cuotas: readonly { dueOn: string; amountCents: number }[],
  totalCents: number,
): string | null {
  if (cuotas.length === 0) return null;
  if (cuotas.length > MAX_CUOTAS) return `Una cuenta admite hasta ${MAX_CUOTAS} cuotas.`;
  for (const [i, c] of cuotas.entries()) {
    if (!esDiaIso(c.dueOn)) return `La cuota ${i + 1} no tiene una fecha válida.`;
    if (!Number.isInteger(c.amountCents) || c.amountCents <= 0)
      return `La cuota ${i + 1} tiene que ser mayor que cero.`;
  }
  const suma = cuotas.reduce((s, c) => s + c.amountCents, 0);
  if (suma !== totalCents) {
    return suma > totalCents
      ? "Las cuotas suman más que la cuenta."
      : "Las cuotas suman menos que la cuenta.";
  }
  return null;
}

// ─── Estado de la cuenta (FIN-02) ───────────────────────────────────────────

export interface CuentaParaResumir {
  amountCents: number;
  issuedOn: string;
  /** Vencimiento de la cuenta sin cuotas. `null` = sin vencimiento. */
  dueOn: string | null;
  voidedAt: string | null;
  cuotas: readonly Cuota[];
}

export interface ResumenCuenta {
  estado: EstadoCuenta;
  pagadoCents: number;
  /** Lo que falta cobrar (nunca negativo). */
  saldoCents: number;
  /** Lo pagado por encima del monto: queda a favor del paciente. */
  aFavorCents: number;
  /** Lo que ya venció y no se pagó. */
  vencidoCents: number;
  cuotas: CuotaImputada[];
  /** Próximo vencimiento con plata pendiente (vencido o no). `null` = ninguno. */
  proximoVencimiento: string | null;
  /** Días desde el vencimiento impago más antiguo. `null` = nada vencido. */
  diasDeAtraso: number | null;
  tramo: TramoAtraso;
  /** Días desde la emisión. */
  antiguedadDias: number;
}

/**
 * Estado de una cuenta con lo pagado hasta hoy.
 *
 * - anulada: se guardó así (no cuenta como deuda, aunque tenga pagos).
 * - pagada: lo pagado cubre el monto.
 * - vencida: hay una cuota (o el vencimiento de la cuenta) anterior a hoy con
 *   plata pendiente. Gana sobre parcial y pendiente: es lo que hay que cobrar
 *   primero.
 * - parcial: tiene algún pago y le falta.
 * - pendiente: sin pagos.
 *
 * Una cuenta sin cuotas ni vencimiento nunca vence: no se inventa un plazo
 * que nadie fijó (regla 11).
 */
export function resumirCuenta(
  cuenta: CuentaParaResumir,
  pagadoCents: number,
  hoy: string,
): ResumenCuenta {
  const pagado = Math.max(0, pagadoCents);
  const saldo = Math.max(0, cuenta.amountCents - pagado);
  const aFavor = Math.max(0, pagado - cuenta.amountCents);
  const cuotas = imputarACuotas(cuenta.cuotas, pagado, hoy);
  const antiguedadDias = Math.max(0, diasEntre(cuenta.issuedOn, hoy));

  let vencido = 0;
  let primeraImpaga: string | null = null;
  let primeraVencida: string | null = null;
  if (cuotas.length > 0) {
    for (const c of cuotas) {
      if (c.pendienteCents === 0) continue;
      primeraImpaga ??= c.dueOn;
      if (c.vencida) {
        vencido += c.pendienteCents;
        primeraVencida ??= c.dueOn;
      }
    }
  } else if (saldo > 0 && cuenta.dueOn) {
    primeraImpaga = cuenta.dueOn;
    if (cuenta.dueOn < hoy) {
      vencido = saldo;
      primeraVencida = cuenta.dueOn;
    }
  }

  const anulada = cuenta.voidedAt !== null;
  const diasDeAtraso =
    !anulada && primeraVencida !== null ? Math.max(1, diasEntre(primeraVencida, hoy)) : null;

  const estado: EstadoCuenta = anulada
    ? "anulada"
    : saldo === 0
      ? "pagada"
      : vencido > 0
        ? "vencida"
        : pagado > 0
          ? "parcial"
          : "pendiente";

  return {
    estado,
    pagadoCents: pagado,
    saldoCents: anulada ? 0 : saldo,
    aFavorCents: aFavor,
    vencidoCents: anulada ? 0 : vencido,
    cuotas,
    proximoVencimiento: anulada || saldo === 0 ? null : primeraImpaga,
    diasDeAtraso,
    tramo: tramoDeAtraso(diasDeAtraso),
    antiguedadDias,
  };
}

// ─── La cuenta como la ve la app ────────────────────────────────────────────

export interface CuentaPorCobrar {
  id: string;
  patientId: string;
  /** `null` = la ficha no se pudo leer (RLS o archivada sin acceso). */
  patientName: string | null;
  quoteId: string | null;
  treatmentPlanId: string | null;
  description: string;
  amountCents: number;
  currency: string;
  issuedOn: string;
  dueOn: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  /** Último pago que le cuenta. `null` = ninguno. */
  ultimoPagoAt: string | null;
  resumen: ResumenCuenta;
}

/** Fila de `receivables` tal como la lee el servidor. */
export interface FilaCuenta {
  id: string;
  patient_id: string;
  quote_id: string | null;
  treatment_plan_id: string | null;
  description: string;
  amount_cents: number;
  currency: string;
  issued_on: string;
  due_on: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface FilaCuota {
  id: string;
  receivable_id: string;
  number: number;
  due_on: string;
  amount_cents: number;
}

export interface FilaPagado {
  receivable_id: string;
  paid_cents: number | null;
  last_paid_at: string | null;
}

/**
 * Une cuentas, cuotas y lo pagado. Una cuenta sin fila de pagado no tiene
 * pagos (0 es real acá: la función SQL solo omite las cuentas sin pagos).
 */
export function armarCuentas(
  filas: readonly FilaCuenta[],
  cuotas: readonly FilaCuota[],
  pagados: readonly FilaPagado[],
  nombres: ReadonlyMap<string, string>,
  hoy: string,
): CuentaPorCobrar[] {
  const cuotasPorCuenta = new Map<string, Cuota[]>();
  for (const c of cuotas) {
    const lista = cuotasPorCuenta.get(c.receivable_id) ?? [];
    lista.push({ id: c.id, number: c.number, dueOn: c.due_on, amountCents: c.amount_cents });
    cuotasPorCuenta.set(c.receivable_id, lista);
  }
  const pagadoPorCuenta = new Map(pagados.map((p) => [p.receivable_id, p]));

  return filas.map((f) => {
    const pagado = pagadoPorCuenta.get(f.id);
    return {
      id: f.id,
      patientId: f.patient_id,
      patientName: nombres.get(f.patient_id) ?? null,
      quoteId: f.quote_id,
      treatmentPlanId: f.treatment_plan_id,
      description: f.description,
      amountCents: f.amount_cents,
      currency: f.currency,
      issuedOn: f.issued_on,
      dueOn: f.due_on,
      voidedAt: f.voided_at,
      voidReason: f.void_reason,
      createdAt: f.created_at,
      ultimoPagoAt: pagado?.last_paid_at ?? null,
      resumen: resumirCuenta(
        {
          amountCents: f.amount_cents,
          issuedOn: f.issued_on,
          dueOn: f.due_on,
          voidedAt: f.voided_at,
          cuotas: cuotasPorCuenta.get(f.id) ?? [],
        },
        Number(pagado?.paid_cents ?? 0),
        hoy,
      ),
    };
  });
}

// ─── Lista de cuentas: filtros y totales ────────────────────────────────────

export const FILTROS_CUENTA = [
  "por_cobrar",
  "vencida",
  "parcial",
  "pendiente",
  "pagada",
  "anulada",
  "todas",
] as const;
export type FiltroCuenta = (typeof FILTROS_CUENTA)[number];

export const ETIQUETA_FILTRO_CUENTA: Record<FiltroCuenta, string> = {
  por_cobrar: "Por cobrar",
  vencida: "Vencidas",
  parcial: "Pago parcial",
  pendiente: "Pendientes",
  pagada: "Pagadas",
  anulada: "Anuladas",
  todas: "Todas",
};

export function leerFiltroCuenta(valor: unknown): FiltroCuenta {
  return (FILTROS_CUENTA as readonly unknown[]).includes(valor)
    ? (valor as FiltroCuenta)
    : "por_cobrar";
}

export function leerTramo(valor: unknown): TramoAtraso | "todos" {
  return (TRAMOS_ATRASO as readonly unknown[]).includes(valor) ? (valor as TramoAtraso) : "todos";
}

function pasaFiltro(estado: EstadoCuenta, filtro: FiltroCuenta): boolean {
  if (filtro === "todas") return true;
  if (filtro === "por_cobrar") return estaPorCobrar(estado);
  return estado === filtro;
}

export function filtrarCuentas(
  cuentas: readonly CuentaPorCobrar[],
  opciones: { estado: FiltroCuenta; tramo: TramoAtraso | "todos"; termino: string },
): CuentaPorCobrar[] {
  const termino = opciones.termino.trim();
  return cuentas
    .filter((c) => pasaFiltro(c.resumen.estado, opciones.estado))
    .filter((c) => opciones.tramo === "todos" || c.resumen.tramo === opciones.tramo)
    .filter((c) => !termino || coincideTermino(termino, c.patientName ?? "", c.description))
    .sort(ordenDeCobro);
}

/**
 * Lo que conviene cobrar primero: más días de atraso, después el próximo
 * vencimiento más cercano, después la más vieja.
 */
export function ordenDeCobro(a: CuentaPorCobrar, b: CuentaPorCobrar): number {
  const atrasoA = a.resumen.diasDeAtraso ?? -1;
  const atrasoB = b.resumen.diasDeAtraso ?? -1;
  if (atrasoA !== atrasoB) return atrasoB - atrasoA;
  const proxA = a.resumen.proximoVencimiento ?? "9999-12-31";
  const proxB = b.resumen.proximoVencimiento ?? "9999-12-31";
  if (proxA !== proxB) return proxA < proxB ? -1 : 1;
  if (a.issuedOn !== b.issuedOn) return a.issuedOn < b.issuedOn ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

export function contarPorFiltro(cuentas: readonly CuentaPorCobrar[]): Record<FiltroCuenta, number> {
  const cuentasPorFiltro = Object.fromEntries(FILTROS_CUENTA.map((f) => [f, 0])) as Record<
    FiltroCuenta,
    number
  >;
  for (const c of cuentas) {
    for (const f of FILTROS_CUENTA) if (pasaFiltro(c.resumen.estado, f)) cuentasPorFiltro[f] += 1;
  }
  return cuentasPorFiltro;
}

export interface TotalesCartera {
  porCobrarCents: number;
  vencidoCents: number;
  cuentasPorCobrar: number;
  cuentasVencidas: number;
  /** Saldo por tramo de atraso (solo lo vencido entra en los tramos con días). */
  porTramo: Record<TramoAtraso, number>;
}

export function totalesCartera(cuentas: readonly CuentaPorCobrar[]): TotalesCartera {
  const porTramo = Object.fromEntries(TRAMOS_ATRASO.map((t) => [t, 0])) as Record<
    TramoAtraso,
    number
  >;
  const t: TotalesCartera = {
    porCobrarCents: 0,
    vencidoCents: 0,
    cuentasPorCobrar: 0,
    cuentasVencidas: 0,
    porTramo,
  };
  for (const c of cuentas) {
    if (!estaPorCobrar(c.resumen.estado)) continue;
    t.porCobrarCents += c.resumen.saldoCents;
    t.vencidoCents += c.resumen.vencidoCents;
    t.cuentasPorCobrar += 1;
    if (c.resumen.estado === "vencida") t.cuentasVencidas += 1;
    porTramo[c.resumen.tramo] += c.resumen.saldoCents;
  }
  return t;
}

// ─── Cobro con varios medios (FIN-04) ───────────────────────────────────────

export interface ParteDeCobro {
  /** Medio configurado de la clínica. `null` solo en la cola sin medios. */
  paymentMethodId?: string | null;
  amountCents: number;
}

export const MAX_PARTES_COBRO = 6;

/** Lo que falta asignar a algún medio (negativo = se asignó de más). */
export function restantePorAsignar(totalCents: number, partes: readonly ParteDeCobro[]): number {
  return totalCents - partes.reduce((s, p) => s + p.amountCents, 0);
}

/**
 * Valida el reparto de un cobro entre medios: al menos dos, cada parte mayor
 * que cero, sin repetir medio y con la suma EXACTA del total en cents.
 */
export function validarReparto(totalCents: number, partes: readonly ParteDeCobro[]): string | null {
  if (!Number.isInteger(totalCents) || totalCents <= 0) return "Ingresa un monto mayor que cero.";
  if (partes.length < 2) return "Para repartir el cobro elige al menos dos medios.";
  if (partes.length > MAX_PARTES_COBRO)
    return `Un cobro admite hasta ${MAX_PARTES_COBRO} medios de pago.`;
  const medios = new Set<string>();
  for (const p of partes) {
    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0)
      return "Cada medio tiene que llevar un monto mayor que cero.";
    const clave = p.paymentMethodId ?? "";
    if (medios.has(clave)) return "Cada medio de pago va una sola vez.";
    medios.add(clave);
  }
  const resto = restantePorAsignar(totalCents, partes);
  if (resto > 0) return "Falta asignar parte del monto a un medio de pago.";
  if (resto < 0) return "Los medios suman más que el monto del cobro.";
  return null;
}

// ─── Pagos agrupados por cobro ──────────────────────────────────────────────

/**
 * Agrupa las filas de pago de un mismo cobro para mostrarlas juntas: las de
 * un cobro repartido en varios medios (mismo `paymentGroupId`, FIN-04) y las
 * de un bono con su copago (mismo `coverageGroupId`, MKT-03). El orden de
 * entrada se respeta (la ficha los lista del más reciente al más viejo); un
 * cobro de un solo medio es un grupo de uno.
 */
export function agruparPorCobro<
  T extends { id: string; paymentGroupId: string | null; coverageGroupId?: string | null },
>(pagos: readonly T[]): T[][] {
  const grupos: T[][] = [];
  const indice = new Map<string, number>();
  for (const p of pagos) {
    const clave = p.paymentGroupId ?? p.coverageGroupId ?? null;
    if (!clave) {
      grupos.push([p]);
      continue;
    }
    const i = indice.get(clave);
    if (i === undefined) {
      indice.set(clave, grupos.length);
      grupos.push([p]);
    } else {
      grupos[i].push(p);
    }
  }
  return grupos;
}
