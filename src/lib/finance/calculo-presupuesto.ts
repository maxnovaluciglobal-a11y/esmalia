import { repartirCobertura } from "@/lib/finance/finance";

/**
 * Cálculo del presupuesto (PLA-04 secciones, PLA-05 descuentos, PLA-12
 * paquetes). Lógica pura: la usan el servidor (`createQuote`, `updateQuote`,
 * la sugerencia del odontograma) y la vista previa de los diálogos, así que lo
 * que ve el usuario antes de guardar es exactamente lo que se guarda.
 *
 * Antes vivía dentro de `finance.functions.ts`, que arrastra el middleware de
 * Supabase al importarlo, y los tests reimplementaban el prorrateo "con la
 * misma regla" (si cambiaba allá, el test dejaba de proteger).
 *
 * Regla 6: todo en enteros (cents). Los porcentajes se pasan a centésimas de
 * punto (un 12,5 % es 1250) y las divisiones con resto se hacen en BigInt con
 * redondeo half-up, para que ni un float ni un producto grande corran un peso.
 */

/** Lo mínimo que el cálculo necesita de una línea. El resto viaja intacto. */
export interface LineaBase {
  procedureId?: string | null;
  quantity: number;
  unitPriceCents: number;
  /** Descuento en cents. Se ignora si viene `discountPct`. */
  discountCents: number;
  /** Descuento negociado en %, 0-100 con hasta dos decimales. Manda sobre los cents. */
  discountPct?: number | null;
  phaseLabel?: string | null;
  phasePosition?: number;
}

export type CoberturaPorProcedimiento = Map<
  string,
  { coveragePct: number | null; coverageFixedCents: number | null }
>;

/**
 * Porcentaje → centésimas de punto, entero (12,5 → 1250), con el mismo
 * redondeo que `numeric(5,2)` de la base. `1.005 * 100` en float da
 * 100,4999…: se corta a 4 decimales antes de redondear para que 1,005 %
 * sea 101 (lo que guarda la base, 1,01 %) y no 100.
 */
export function pctACentesimas(pct: number): number {
  return Math.round(Number((pct * 100).toFixed(4)));
}

/** round(a × b / c) half-up, exacto para enteros no negativos (c > 0). */
export function multiplicarYDividir(a: number, b: number, c: number): number {
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  return Number((num * 2n + den) / (2n * den));
}

/** Cuánto es `pct` % de `cents`, en cents enteros y nunca más que `cents`. */
export function porcentajeDe(cents: number, pct: number): number {
  if (cents <= 0 || pct <= 0) return 0;
  return Math.min(multiplicarYDividir(cents, pctACentesimas(pct), 10_000), cents);
}

/**
 * Resuelve el descuento de una línea a cents, que es la única verdad contable
 * (regla 6). Si se negoció en porcentaje, el porcentaje manda y los cents se
 * derivan; si se cargó en dinero, el porcentaje queda `null`. Nunca supera la
 * línea: un 100 % la deja en cero, no en negativo.
 */
export function resolverDescuentoDeLinea(linea: LineaBase): {
  discountCents: number;
  discountPct: number | null;
} {
  const bruto = linea.quantity * linea.unitPriceCents;
  if (linea.discountPct === null || linea.discountPct === undefined) {
    return { discountCents: Math.min(Math.max(0, linea.discountCents), bruto), discountPct: null };
  }
  return { discountCents: porcentajeDe(bruto, linea.discountPct), discountPct: linea.discountPct };
}

/** Total de una línea ya descontada (antes del descuento comercial). */
export function totalDeLinea(linea: LineaBase): number {
  return Math.max(
    0,
    linea.quantity * linea.unitPriceCents - resolverDescuentoDeLinea(linea).discountCents,
  );
}

/**
 * Reparte `monto` entre `pesos` proporcional a cada peso, por resto mayor
 * (Hamilton): la suma da EXACTAMENTE `monto` y ninguna parte supera su peso
 * cuando `monto <= suma(pesos)`. Con el método anterior (redondear cada parte
 * y cargarle la diferencia a la última línea) la última podía llevarse más de
 * lo que valía y quedar recortada en cero, y entonces la suma ya no cerraba.
 */
export function repartirProporcional(monto: number, pesos: readonly number[]): number[] {
  const total = pesos.reduce((s, p) => s + Math.max(0, p), 0);
  if (monto <= 0 || total <= 0) return pesos.map(() => 0);
  const totalB = BigInt(total);
  const montoB = BigInt(monto);
  const partes = pesos.map((p) => {
    const exacto = montoB * BigInt(Math.max(0, p));
    return { piso: exacto / totalB, resto: exacto % totalB };
  });
  let faltan = Number(montoB - partes.reduce((s, x) => s + x.piso, 0n));
  const orden = partes
    .map((x, i) => ({ i, resto: x.resto }))
    .sort((a, b) => (a.resto === b.resto ? a.i - b.i : a.resto > b.resto ? -1 : 1));
  const resultado = partes.map((x) => Number(x.piso));
  for (const { i } of orden) {
    if (faltan <= 0) break;
    resultado[i] += 1;
    faltan -= 1;
  }
  return resultado;
}

export type LineaCalculada<T extends LineaBase> = T & {
  phaseLabel: string | null;
  phasePosition: number;
  discountCents: number;
  discountPct: number | null;
  /** Posición dentro de su sección (0, 1, 2…). */
  position: number;
  /** Total de la línea con el descuento propio y su parte del comercial. */
  total: number;
  coverageCents: number | null;
  patientCents: number | null;
};

export interface TotalesDePresupuesto<T extends LineaBase> {
  items: LineaCalculada<T>[];
  /** Suma de las líneas con su descuento propio, antes del comercial. */
  subtotal: number;
  /** Descuento comercial global en cents. */
  discountCents: number;
  commercialDiscountPct: number | null;
  /** Total del convenio. `null` = ninguna línea tuvo cobertura (regla 11). */
  coverageTotalCents: number | null;
  /** Suma de las líneas ya descontadas: lo que el paciente ve. */
  total: number;
}

/**
 * Totales del presupuesto a partir de sus líneas.
 *
 * - Descuento por línea en dinero o en % (PLA-05).
 * - Descuento comercial global en dinero o en % que BAJA a las líneas,
 *   prorrateado por peso: el trigger de conversión copia el total de cada
 *   línea al plan, y si el descuento quedara solo en el total del
 *   presupuesto, el paciente terminaría debiendo el 100 % (auditoría 04-sep).
 * - El reparto convenio/paciente se calcula sobre la línea ya descontada.
 * - `position` se numera dentro de cada sección; `phasePosition` se respeta
 *   (la fija `posicionesDeSecciones` en el cliente).
 */
export function calcularTotalesDePresupuesto<T extends LineaBase>(
  lineas: readonly T[],
  descuentoGlobalCents: number,
  descuentoComercialPct: number | null | undefined,
  cobertura?: CoberturaPorProcedimiento,
): TotalesDePresupuesto<T> {
  const posicionPorSeccion = new Map<string, number>();

  const items: LineaCalculada<T>[] = lineas.map((linea) => {
    const { discountCents, discountPct } = resolverDescuentoDeLinea(linea);
    const phaseLabel = linea.phaseLabel?.trim() || null;
    const clave = phaseLabel ?? "";
    const position = posicionPorSeccion.get(clave) ?? 0;
    posicionPorSeccion.set(clave, position + 1);
    const total = Math.max(0, linea.quantity * linea.unitPriceCents - discountCents);
    return {
      ...linea,
      phaseLabel,
      phasePosition: phaseLabel ? (linea.phasePosition ?? 0) : 0,
      discountCents,
      discountPct,
      position,
      total,
      coverageCents: null,
      patientCents: null,
    };
  });

  const subtotal = items.reduce((s, it) => s + it.total, 0);
  const descuento =
    descuentoComercialPct === null || descuentoComercialPct === undefined
      ? Math.min(Math.max(0, descuentoGlobalCents), subtotal)
      : porcentajeDe(subtotal, descuentoComercialPct);

  if (descuento > 0) {
    const partes = repartirProporcional(
      descuento,
      items.map((it) => it.total),
    );
    items.forEach((it, i) => {
      it.total -= partes[i];
    });
  }

  // Un ítem sin `procedureId` no tiene cobertura: el convenio cubre
  // prestaciones de su arancel, no texto libre.
  for (const it of items) {
    const c = it.procedureId ? cobertura?.get(it.procedureId) : undefined;
    const r = repartirCobertura(it.total, c, it.quantity);
    it.coverageCents = r.coverageCents;
    it.patientCents = r.patientCents;
  }

  const conCobertura = items.filter((it) => it.coverageCents !== null);
  return {
    items,
    subtotal,
    discountCents: descuento,
    commercialDiscountPct: descuentoComercialPct ?? null,
    coverageTotalCents: conCobertura.length
      ? conCobertura.reduce((s, it) => s + (it.coverageCents ?? 0), 0)
      : null,
    total: items.reduce((s, it) => s + it.total, 0),
  };
}

// ─── Secciones (PLA-04) ─────────────────────────────────────────────────────

/**
 * Orden de las secciones por primera aparición en la lista de líneas. El
 * editor no guarda un orden aparte: el orden ES el de la lista, y mover una
 * sección mueve su bloque de líneas.
 */
export function ordenDeSecciones(lineas: readonly { phaseLabel?: string | null }[]): string[] {
  const vistas: string[] = [];
  for (const l of lineas) {
    const label = l.phaseLabel?.trim();
    if (label && !vistas.includes(label)) vistas.push(label);
  }
  return vistas;
}

/**
 * `phasePosition` de cada línea según el orden de sus secciones (1, 2, 3…;
 * sin sección = 0). Antes el cliente nunca lo mandaba: todas las fases
 * quedaban en 0 y se ordenaban alfabéticamente, así que "Urgencia" caía
 * después de "Rehabilitación".
 */
export function posicionesDeSecciones<T extends { phaseLabel?: string | null }>(
  lineas: readonly T[],
): (T & { phasePosition: number })[] {
  const orden = ordenDeSecciones(lineas);
  return lineas.map((l) => {
    const label = l.phaseLabel?.trim();
    return { ...l, phasePosition: label ? orden.indexOf(label) + 1 : 0 };
  });
}

/**
 * Mueve una sección entera (todas sus líneas) un lugar arriba o abajo,
 * dejando juntas las líneas de cada sección. Las líneas sin sección van
 * siempre primero, como en la vista agrupada.
 */
export function moverSeccion<T extends { phaseLabel?: string | null }>(
  lineas: readonly T[],
  seccion: string,
  direccion: -1 | 1,
): T[] {
  const orden = ordenDeSecciones(lineas);
  const i = orden.indexOf(seccion);
  const j = i + direccion;
  if (i < 0 || j < 0 || j >= orden.length) return [...lineas];
  [orden[i], orden[j]] = [orden[j], orden[i]];
  const sinSeccion = lineas.filter((l) => !l.phaseLabel?.trim());
  return [...sinSeccion, ...orden.flatMap((s) => lineas.filter((l) => l.phaseLabel?.trim() === s))];
}

export interface ResumenDeSeccion {
  label: string | null;
  lineas: number;
  subtotalCents: number;
}

/** Subtotal por sección en el orden del editor (sin sección primero). */
export function resumenDeSecciones<T extends LineaBase>(lineas: readonly T[]): ResumenDeSeccion[] {
  const sinSeccion = lineas.filter((l) => !l.phaseLabel?.trim());
  const resumen: ResumenDeSeccion[] = [];
  if (sinSeccion.length) {
    resumen.push({
      label: null,
      lineas: sinSeccion.length,
      subtotalCents: sinSeccion.reduce((s, l) => s + totalDeLinea(l), 0),
    });
  }
  for (const s of ordenDeSecciones(lineas)) {
    const de = lineas.filter((l) => l.phaseLabel?.trim() === s);
    resumen.push({
      label: s,
      lineas: de.length,
      subtotalCents: de.reduce((acc, l) => acc + totalDeLinea(l), 0),
    });
  }
  return resumen;
}

// ─── Paquetes (PLA-12) ──────────────────────────────────────────────────────

export interface LineaDePaquete {
  procedureId: string | null;
  nameSnapshot: string;
  quantity: number;
}

export interface PaqueteParaSumar {
  id: string;
  name: string;
  priceCents: number;
  items: readonly LineaDePaquete[];
}

export interface LineaSumadaDePaquete {
  procedureId: string | null;
  nameSnapshot: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  packageId: string;
  packageNameSnapshot: string;
}

/**
 * Líneas que se suman al presupuesto al elegir un paquete, con un snapshot de
 * nombre y precio. La suma de sus totales es EXACTAMENTE el precio del
 * paquete.
 *
 * El precio del paquete se reparte entre las líneas proporcional a su precio
 * de lista actual (arancel × cantidad), por resto mayor. Cada línea queda
 * entonces:
 *   - si su parte es menor o igual que su lista (el caso normal: el paquete
 *     es un combo con rebaja): precio unitario del arancel y la diferencia
 *     como descuento en dinero, así el presupuesto muestra cuánto se ahorra;
 *   - si es mayor (el arancel bajó después de armar el paquete): precio
 *     unitario redondeado hacia arriba y un descuento de menos de una unidad
 *     por cantidad para cerrar exacto.
 * Sin precios de lista (todo en cero o prestaciones borradas) reparte por
 * cantidad.
 */
export function lineasDePaquete(
  paquete: PaqueteParaSumar,
  precioDeLista: (procedureId: string | null) => number,
): LineaSumadaDePaquete[] {
  const listas = paquete.items.map(
    (it) => Math.max(0, precioDeLista(it.procedureId)) * it.quantity,
  );
  const sumaListas = listas.reduce((s, x) => s + x, 0);
  const pesos = sumaListas > 0 ? listas : paquete.items.map((it) => it.quantity);
  const objetivos = repartirProporcional(paquete.priceCents, pesos);

  return paquete.items.map((it, i) => {
    const lista = listas[i];
    const objetivo = objetivos[i];
    let unitPriceCents: number;
    let discountCents: number;
    if (lista > 0 && objetivo <= lista) {
      unitPriceCents = lista / it.quantity;
      discountCents = lista - objetivo;
    } else {
      unitPriceCents = Math.ceil(objetivo / it.quantity);
      discountCents = unitPriceCents * it.quantity - objetivo;
    }
    return {
      procedureId: it.procedureId,
      nameSnapshot: it.nameSnapshot,
      quantity: it.quantity,
      unitPriceCents,
      discountCents,
      packageId: paquete.id,
      packageNameSnapshot: paquete.name,
    };
  });
}

/** Precio de lista del paquete hoy (suma del arancel), para mostrar el ahorro. */
export function precioDeListaDelPaquete(
  items: readonly LineaDePaquete[],
  precioDeLista: (procedureId: string | null) => number,
): number {
  return items.reduce((s, it) => s + Math.max(0, precioDeLista(it.procedureId)) * it.quantity, 0);
}
