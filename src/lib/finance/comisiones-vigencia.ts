/**
 * Comisiones con "rige desde" (Ola 10 · COM-02 a COM-05). Lógica pura, sin
 * base de datos: la usan `getCommissionReport`, el cierre del período y Mi
 * desempeño, y se prueba entera en `tests/comisiones-vigencia.test.ts`.
 *
 * Reglas del cálculo (documentadas también en el PR):
 * - Cada profesional tiene versiones de su regla general (`scope = general`),
 *   cada una con su fecha `effectiveFrom`. Para un hecho de la fecha D vale la
 *   última versión con `effectiveFrom <= D`. Cambiar la regla agrega una
 *   versión: lo anterior a su fecha se sigue calculando con la de antes.
 * - Una versión por prestación (`scope = prestacion`) reemplaza a la general
 *   para esa prestación, desde su fecha. La base (realizado o cobrado) la fija
 *   siempre la general.
 * - Porcentaje sobre lo realizado: suma el precio de las prestaciones
 *   completadas en el período. Porcentaje sobre lo cobrado: suma los pagos
 *   atribuidos al profesional (ver `atribuirCobros`).
 * - Monto fijo: un monto por prestación realizada, sea cual sea la base.
 * - "Sin comisión" (`none`): esa versión no paga nada desde su fecha.
 * - Redondeo: el porcentaje se redondea una vez por regla aplicada (no línea
 *   por línea, para no perder centavos), y ese total se reparte en las líneas
 *   para mostrarlas sin que la suma cambie.
 *
 * Fechas: siempre la fecha civil de la clínica (regla 7), YYYY-MM-DD.
 * Dinero: cents enteros (regla 6).
 */
import { formatMoney } from "@/lib/finance/finance";

export type BaseComision = "realizado" | "cobrado";
export type TipoReglaComision = "percent" | "fixed" | "none";

export const BASE_COMISION_LABELS: Record<BaseComision, string> = {
  realizado: "lo realizado",
  cobrado: "lo cobrado",
};

/** Fecha que usa una regla sin vigencia explícita (la de `commission_rules`). */
export const DESDE_SIEMPRE = "2000-01-01";

export interface VersionRegla {
  id: string;
  professionalId: string;
  scope: "general" | "prestacion";
  procedureId: string | null;
  procedureName: string | null;
  kind: TipoReglaComision;
  percentBps: number;
  fixedCents: number;
  base: BaseComision;
  effectiveFrom: string;
}

/** Prestación completada (producción). */
export interface HechoRealizado {
  id: string;
  professionalId: string;
  procedureId: string | null;
  fecha: string;
  cents: number;
  concepto: string;
}

/** Pago (o parte de un pago) atribuido a un profesional. */
export interface HechoCobrado {
  id: string;
  professionalId: string;
  procedureId: string | null;
  fecha: string;
  cents: number;
  concepto: string;
}

export interface LineaLiquidacion {
  origen: "realizado" | "cobrado";
  id: string;
  fecha: string;
  concepto: string;
  cents: number;
  /** Versión que se aplicó. null = no había regla ese día. */
  versionId: string | null;
  regla: string;
  comisionCents: number;
}

export interface TramoLiquidacion {
  versionId: string;
  desde: string;
  hasta: string;
  regla: string;
  base: BaseComision;
  kind: TipoReglaComision;
  baseCents: number;
  comisionCents: number;
}

export interface Liquidacion {
  professionalId: string;
  desde: string;
  hasta: string;
  productionCents: number;
  procedureCount: number;
  cobradoCents: number;
  /** Lo que efectivamente entra al cálculo (realizado o cobrado según cada tramo). */
  baseCents: number;
  /** null = el profesional no tiene ninguna regla vigente en el período. */
  commissionCents: number | null;
  /** Regla vigente al cierre del período (la última que aplica). */
  vigente: VersionRegla | null;
  tramos: TramoLiquidacion[];
  /** Solo las líneas que entran al cálculo, ordenadas por fecha. */
  lineas: LineaLiquidacion[];
}

/** "2026-10-15" → "2026-10-14". */
export function diaAnterior(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** "2026-10-15" → "2026-10-16". */
export function diaSiguiente(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Fecha civil (YYYY-MM-DD) de un instante en el huso de la clínica. */
export function fechaEnZona(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function porFecha(a: VersionRegla, b: VersionRegla) {
  return a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0;
}

/** Versiones generales de un profesional, de la más vieja a la más nueva. */
export function versionesGenerales(
  versiones: readonly VersionRegla[],
  professionalId: string,
): VersionRegla[] {
  return versiones
    .filter((v) => v.professionalId === professionalId && v.scope === "general")
    .sort(porFecha);
}

/** Regla general que rige el día `fecha`, o null si todavía no había ninguna. */
export function versionGeneralVigente(
  versiones: readonly VersionRegla[],
  professionalId: string,
  fecha: string,
): VersionRegla | null {
  let vigente: VersionRegla | null = null;
  for (const v of versionesGenerales(versiones, professionalId)) {
    if (v.effectiveFrom <= fecha) vigente = v;
  }
  return vigente;
}

/** Regla de una prestación que rige el día `fecha`, o null. */
export function versionDePrestacionVigente(
  versiones: readonly VersionRegla[],
  professionalId: string,
  procedureId: string | null,
  fecha: string,
): VersionRegla | null {
  if (!procedureId) return null;
  let vigente: VersionRegla | null = null;
  const propias = versiones
    .filter(
      (v) =>
        v.professionalId === professionalId &&
        v.scope === "prestacion" &&
        v.procedureId === procedureId,
    )
    .sort(porFecha);
  for (const v of propias) {
    if (v.effectiveFrom <= fecha) vigente = v;
  }
  return vigente;
}

/** "40 % sobre lo cobrado", "$25.000 por prestación", "Sin comisión". */
export function etiquetaRegla(
  v: Pick<VersionRegla, "kind" | "percentBps" | "fixedCents" | "base">,
  currency: string,
): string {
  if (v.kind === "none") return "Sin comisión";
  if (v.kind === "fixed") return `${formatMoney(v.fixedCents, currency)} por prestación realizada`;
  const pct = (v.percentBps / 100).toLocaleString("es-CL", { maximumFractionDigits: 2 });
  return `${pct} % sobre ${BASE_COMISION_LABELS[v.base]}`;
}

/**
 * Reparte `total` entre `pesos` (enteros ≥ 0) por resto mayor: la suma de
 * las partes es exactamente `total`. Sin pesos (todos en cero) va todo a la
 * primera parte.
 */
export function repartir(total: number, pesos: readonly number[]): number[] {
  if (pesos.length === 0) return [];
  const suma = pesos.reduce((a, b) => a + b, 0);
  if (suma <= 0) return pesos.map((_, i) => (i === 0 ? total : 0));
  const exactas = pesos.map((p) => (total * p) / suma);
  const partes = exactas.map((x) => Math.floor(x));
  let resto = total - partes.reduce((a, b) => a + b, 0);
  const orden = exactas
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; resto > 0 && k < orden.length; k++, resto--) partes[orden[k].i] += 1;
  return partes;
}

/** Convierte la regla de `commission_rules` (sin vigencia) en una versión. */
export function versionDesdeReglaActual(regla: {
  professionalId: string;
  kind: "percent" | "fixed";
  percentBps: number;
  fixedCents: number;
  base?: BaseComision | null;
}): VersionRegla {
  return {
    id: `regla-actual:${regla.professionalId}`,
    professionalId: regla.professionalId,
    scope: "general",
    procedureId: null,
    procedureName: null,
    kind: regla.kind,
    percentBps: regla.percentBps,
    fixedCents: regla.fixedCents,
    base: regla.base ?? "realizado",
    effectiveFrom: DESDE_SIEMPRE,
  };
}

interface Aplicacion {
  linea: LineaLiquidacion;
  version: VersionRegla;
}

/**
 * Liquidación de un profesional en [desde, hasta] (fechas civiles,
 * inclusive) con las versiones de su regla.
 */
export function liquidar(params: {
  professionalId: string;
  desde: string;
  hasta: string;
  versiones: readonly VersionRegla[];
  realizados: readonly HechoRealizado[];
  cobrados: readonly HechoCobrado[];
  currency: string;
}): Liquidacion {
  const { professionalId, desde, hasta, versiones, currency } = params;
  const enRango = <T extends { professionalId: string; fecha: string }>(xs: readonly T[]) =>
    xs.filter((x) => x.professionalId === professionalId && x.fecha >= desde && x.fecha <= hasta);
  const realizados = enRango(params.realizados);
  const cobrados = enRango(params.cobrados);

  const productionCents = realizados.reduce((s, r) => s + r.cents, 0);
  const cobradoCents = cobrados.reduce((s, c) => s + c.cents, 0);

  const aplicadas: Aplicacion[] = [];
  const reglaPara = (fecha: string, procedureId: string | null) => {
    const general = versionGeneralVigente(versiones, professionalId, fecha);
    if (!general) return null;
    const prestacion = versionDePrestacionVigente(versiones, professionalId, procedureId, fecha);
    return { general, regla: prestacion ?? general };
  };

  for (const r of realizados) {
    const v = reglaPara(r.fecha, r.procedureId);
    if (!v) continue;
    const cuenta =
      v.regla.kind === "fixed" || (v.regla.kind === "percent" && v.general.base === "realizado");
    if (!cuenta) continue;
    aplicadas.push({
      version: v.regla,
      linea: {
        origen: "realizado",
        id: r.id,
        fecha: r.fecha,
        concepto: r.concepto,
        cents: r.cents,
        versionId: v.regla.id,
        regla: etiquetaRegla({ ...v.regla, base: v.general.base }, currency),
        comisionCents: 0,
      },
    });
  }
  for (const c of cobrados) {
    const v = reglaPara(c.fecha, c.procedureId);
    if (!v) continue;
    if (!(v.regla.kind === "percent" && v.general.base === "cobrado")) continue;
    aplicadas.push({
      version: v.regla,
      linea: {
        origen: "cobrado",
        id: c.id,
        fecha: c.fecha,
        concepto: c.concepto,
        cents: c.cents,
        versionId: v.regla.id,
        regla: etiquetaRegla({ ...v.regla, base: v.general.base }, currency),
        comisionCents: 0,
      },
    });
  }

  // Un redondeo por regla aplicada; el total se reparte en sus líneas.
  const porVersion = new Map<string, Aplicacion[]>();
  for (const a of aplicadas) {
    const lista = porVersion.get(a.version.id) ?? [];
    lista.push(a);
    porVersion.set(a.version.id, lista);
  }
  for (const grupo of porVersion.values()) {
    const v = grupo[0].version;
    if (v.kind === "fixed") {
      for (const a of grupo) a.linea.comisionCents = v.fixedCents;
      continue;
    }
    const base = grupo.reduce((s, a) => s + a.linea.cents, 0);
    const total = Math.round((base * v.percentBps) / 10000);
    const partes = repartir(
      total,
      grupo.map((a) => a.linea.cents),
    );
    grupo.forEach((a, i) => (a.linea.comisionCents = partes[i]));
  }

  const lineas = aplicadas
    .map((a) => a.linea)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id < b.id ? -1 : 1));

  // Tramos: cada versión general que rige algún día del período.
  const generales = versionesGenerales(versiones, professionalId);
  const tramos: TramoLiquidacion[] = [];
  generales.forEach((v, i) => {
    const siguiente = generales[i + 1];
    const finVersion = siguiente ? diaAnterior(siguiente.effectiveFrom) : hasta;
    const tDesde = v.effectiveFrom > desde ? v.effectiveFrom : desde;
    const tHasta = finVersion < hasta ? finVersion : hasta;
    if (tDesde > tHasta) return;
    const dentro = lineas.filter((l) => l.fecha >= tDesde && l.fecha <= tHasta);
    tramos.push({
      versionId: v.id,
      desde: tDesde,
      hasta: tHasta,
      regla: etiquetaRegla(v, currency),
      base: v.base,
      kind: v.kind,
      baseCents: dentro.reduce((s, l) => s + l.cents, 0),
      comisionCents: dentro.reduce((s, l) => s + l.comisionCents, 0),
    });
  });

  const vigente = versionGeneralVigente(versiones, professionalId, hasta);
  const hayRegla = tramos.length > 0;
  return {
    professionalId,
    desde,
    hasta,
    productionCents,
    procedureCount: realizados.length,
    cobradoCents,
    baseCents: lineas.reduce((s, l) => s + l.cents, 0),
    commissionCents: hayRegla ? lineas.reduce((s, l) => s + l.comisionCents, 0) : null,
    vigente,
    tramos,
    lineas,
  };
}

// ─── Atribución de cobros ────────────────────────────────────────────────

export interface PagoParaAtribuir {
  id: string;
  amountCents: number;
  fecha: string;
  treatmentItemId: string | null;
  treatmentPlanId: string | null;
  concepto: string;
}

export interface ItemParaAtribuir {
  id: string;
  planId: string;
  professionalId: string | null;
  procedureId: string | null;
  priceCents: number;
  status: string;
  nombre: string;
}

/**
 * A qué profesional va cada cobro (base "cobrado"):
 * - Pago imputado a una prestación: al profesional de esa prestación.
 * - Pago imputado solo al plan: se reparte entre los profesionales del plan
 *   en proporción al precio de sus prestaciones (sin las omitidas).
 * - Pago sin plan ni prestación: no se atribuye a nadie (suma en `sinAtribuirCents`).
 */
export function atribuirCobros(
  pagos: readonly PagoParaAtribuir[],
  items: readonly ItemParaAtribuir[],
): { cobrados: HechoCobrado[]; sinAtribuirCents: number } {
  const porId = new Map(items.map((it) => [it.id, it]));
  const porPlan = new Map<string, ItemParaAtribuir[]>();
  for (const it of items) {
    if (it.status === "skipped" || !it.professionalId) continue;
    const lista = porPlan.get(it.planId) ?? [];
    lista.push(it);
    porPlan.set(it.planId, lista);
  }
  const cobrados: HechoCobrado[] = [];
  let sinAtribuirCents = 0;
  for (const p of pagos) {
    const item = p.treatmentItemId ? porId.get(p.treatmentItemId) : undefined;
    if (item) {
      if (item.professionalId) {
        cobrados.push({
          id: p.id,
          professionalId: item.professionalId,
          procedureId: item.procedureId,
          fecha: p.fecha,
          cents: p.amountCents,
          concepto: `${p.concepto} · ${item.nombre}`,
        });
      } else {
        sinAtribuirCents += p.amountCents;
      }
      continue;
    }
    const delPlan = p.treatmentPlanId ? (porPlan.get(p.treatmentPlanId) ?? []) : [];
    if (delPlan.length === 0) {
      sinAtribuirCents += p.amountCents;
      continue;
    }
    const partes = repartir(
      p.amountCents,
      delPlan.map((it) => Math.max(0, it.priceCents)),
    );
    delPlan.forEach((it, i) => {
      if (partes[i] === 0) return;
      cobrados.push({
        id: `${p.id}:${it.id}`,
        professionalId: it.professionalId!,
        procedureId: it.procedureId,
        fecha: p.fecha,
        cents: partes[i],
        concepto: `${p.concepto} · ${it.nombre} (parte del abono al plan)`,
      });
    });
  }
  return { cobrados, sinAtribuirCents };
}

// ─── Foto de la liquidación (detail jsonb) ───────────────────────────────

/** Forma del `detail` que se congela en `commission_settlements` al cerrar. */
export interface DetalleLiquidacion {
  version: 1;
  currency: string;
  tramos: TramoLiquidacion[];
  lineas: LineaLiquidacion[];
}

/** Máximo de líneas guardadas en la foto (el total y los tramos siempre van completos). */
export const MAX_LINEAS_DETALLE = 2000;

export function detalleParaGuardar(liq: Liquidacion, currency: string): DetalleLiquidacion {
  return {
    version: 1,
    currency,
    tramos: liq.tramos,
    lineas: liq.lineas.slice(0, MAX_LINEAS_DETALLE),
  };
}

/** Lee el `detail` guardado; null si no existe o no tiene la forma esperada. */
export function leerDetalleLiquidacion(valor: unknown): DetalleLiquidacion | null {
  if (!valor || typeof valor !== "object") return null;
  const v = valor as Partial<DetalleLiquidacion>;
  if (v.version !== 1 || !Array.isArray(v.tramos) || !Array.isArray(v.lineas)) return null;
  return v as DetalleLiquidacion;
}

/**
 * Valida una regla nueva antes de guardarla: la fecha no puede caer en un
 * período ya liquidado del profesional (la base lo vuelve a exigir).
 */
export function validarVigencia(
  effectiveFrom: string,
  ultimoLiquidado: string | null,
): { ok: true } | { ok: false; error: string; minimo: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return { ok: false, error: "La fecha de vigencia no es válida.", minimo: DESDE_SIEMPRE };
  }
  if (ultimoLiquidado && effectiveFrom <= ultimoLiquidado) {
    const minimo = diaSiguiente(ultimoLiquidado);
    return {
      ok: false,
      error: `Ese período ya está liquidado. La regla nueva tiene que regir desde el ${minimo.split("-").reverse().join("-")} o después.`,
      minimo,
    };
  }
  return { ok: true };
}
