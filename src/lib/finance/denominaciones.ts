/**
 * Billetes y monedas por moneda, para el arqueo de caja por denominación
 * (PR 12 del rediseño A+, flag `caja-arqueo-v2`).
 *
 * Pura y sin red: la usan el componente de arqueo (para sumar mientras se
 * cuenta) y el servidor (para volver a sumar y no confiar en el total que
 * manda el cliente). Lo que se guarda en `cash_registers.closing_denominations`
 * sale de `detalleDeConteo`.
 *
 * Los valores se escriben en la unidad que ve la persona (20.000 pesos, 0,50
 * soles) y se pasan a cents con `toCents`, que conoce las monedas sin
 * decimales (regla 6: nunca dividir ni multiplicar por 100 asumiendo).
 *
 * Solo entra lo que circula en la caja de una clínica: una moneda que nadie
 * recibe de vuelto (el centavo de peso mexicano, el peso argentino) sobra en
 * la lista y alarga el conteo. Si falta algo, "Ingresar total" sigue ahí.
 */
import { toCents } from "@/lib/finance/finance";

export type TipoDenominacion = "billete" | "moneda";

export interface Denominacion {
  /** Valor en cents (unidad mínima de la moneda, como el resto de la base). */
  valorCents: number;
  tipo: TipoDenominacion;
}

type Fila = readonly [valor: number, tipo: TipoDenominacion];

// De mayor a menor: así se cuenta un cajón (primero los billetes grandes).
const TABLA: Record<string, readonly Fila[]> = {
  CLP: [
    [20000, "billete"],
    [10000, "billete"],
    [5000, "billete"],
    [2000, "billete"],
    [1000, "billete"],
    [500, "moneda"],
    [100, "moneda"],
    [50, "moneda"],
    [10, "moneda"],
  ],
  MXN: [
    [1000, "billete"],
    [500, "billete"],
    [200, "billete"],
    [100, "billete"],
    [50, "billete"],
    [20, "billete"],
    [20, "moneda"],
    [10, "moneda"],
    [5, "moneda"],
    [2, "moneda"],
    [1, "moneda"],
    [0.5, "moneda"],
  ],
  COP: [
    [100000, "billete"],
    [50000, "billete"],
    [20000, "billete"],
    [10000, "billete"],
    [5000, "billete"],
    [2000, "billete"],
    [1000, "moneda"],
    [500, "moneda"],
    [200, "moneda"],
    [100, "moneda"],
    [50, "moneda"],
  ],
  PEN: [
    [200, "billete"],
    [100, "billete"],
    [50, "billete"],
    [20, "billete"],
    [10, "billete"],
    [5, "moneda"],
    [2, "moneda"],
    [1, "moneda"],
    [0.5, "moneda"],
    [0.2, "moneda"],
    [0.1, "moneda"],
  ],
  ARS: [
    [20000, "billete"],
    [10000, "billete"],
    [2000, "billete"],
    [1000, "billete"],
    [500, "billete"],
    [200, "billete"],
    [100, "billete"],
  ],
  USD: [
    [100, "billete"],
    [50, "billete"],
    [20, "billete"],
    [10, "billete"],
    [5, "billete"],
    [2, "billete"],
    [1, "billete"],
    [0.25, "moneda"],
    [0.1, "moneda"],
    [0.05, "moneda"],
    [0.01, "moneda"],
  ],
};

export const MONEDAS_CON_DENOMINACIONES = Object.keys(TABLA);

/**
 * Billetes y monedas de una moneda, de mayor a menor. `null` si la moneda no
 * tiene tabla: la UI ofrece solo "Ingresar total" y el servidor rechaza un
 * detalle por denominación para esa moneda.
 */
export function denominacionesDe(currency: string): Denominacion[] | null {
  const filas = TABLA[currency.toUpperCase()];
  if (!filas) return null;
  return filas.map(([valor, tipo]) => ({ valorCents: toCents(valor, currency), tipo }));
}

/** Clave estable de una denominación: un 20 en billete y un 20 en moneda son dos filas. */
export function claveDenominacion(d: Pick<Denominacion, "valorCents" | "tipo">): string {
  return `${d.tipo}:${d.valorCents}`;
}

/** Tope por fila: un cajón con más de 10.000 piezas de algo es un error de tipeo. */
export const MAX_PIEZAS_POR_DENOMINACION = 10_000;

/** Cuántas piezas hay de cada denominación, por `claveDenominacion`. */
export type Conteo = Record<string, number>;

export interface FilaDeConteo extends Denominacion {
  cantidad: number;
}

/**
 * Lo que se guarda en `cash_registers.closing_denominations`. Lleva la moneda
 * y la versión para que una auditoría lo lea sin depender de esta tabla (si
 * mañana sale un billete nuevo, el cierre viejo sigue entendiéndose).
 */
export interface DetalleDenominaciones {
  version: 1;
  currency: string;
  totalCents: number;
  filas: FilaDeConteo[];
}

function cantidadValida(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_PIEZAS_POR_DENOMINACION;
}

/** Suma lo contado. Ignora claves que no son de la moneda y cantidades inválidas. */
export function totalDeConteo(conteo: Conteo, currency: string): number {
  const tabla = denominacionesDe(currency) ?? [];
  return tabla.reduce((suma, d) => {
    const n = conteo[claveDenominacion(d)] ?? 0;
    return cantidadValida(n) ? suma + d.valorCents * n : suma;
  }, 0);
}

/** Subtotal de una fila (valor × cantidad). */
export function subtotal(d: Denominacion, cantidad: number): number {
  return d.valorCents * cantidad;
}

/** Suma o resta piezas sin bajar de cero ni pasar el tope. */
export function ajustarCantidad(actual: number, delta: number): number {
  const siguiente = (Number.isInteger(actual) ? actual : 0) + delta;
  return Math.min(MAX_PIEZAS_POR_DENOMINACION, Math.max(0, siguiente));
}

/**
 * Arma el detalle que se guarda, en el orden de la tabla y con todas las
 * filas (también las que quedaron en cero: "conté y no había" es un dato).
 */
export function detalleDeConteo(conteo: Conteo, currency: string): DetalleDenominaciones | null {
  const tabla = denominacionesDe(currency);
  if (!tabla) return null;
  const filas = tabla.map((d) => {
    const n = conteo[claveDenominacion(d)] ?? 0;
    return { ...d, cantidad: cantidadValida(n) ? n : 0 };
  });
  return {
    version: 1,
    currency: currency.toUpperCase(),
    totalCents: filas.reduce((s, f) => s + f.valorCents * f.cantidad, 0),
    filas,
  };
}

export type ResultadoValidacion =
  { ok: true; detalle: DetalleDenominaciones } | { ok: false; error: string };

/**
 * Validación del servidor: el cliente manda el conteo, el servidor rehace el
 * detalle con SU tabla (no la del cliente) y el total que manda queda
 * descartado. Rechaza denominaciones que no existen en la moneda de la caja.
 */
export function validarConteo(
  conteo: { valorCents: number; tipo: TipoDenominacion; cantidad: number }[],
  currency: string,
): ResultadoValidacion {
  const tabla = denominacionesDe(currency);
  if (!tabla) {
    return { ok: false, error: "Esta moneda no tiene conteo por billete. Ingresa el total." };
  }
  const validas = new Set(tabla.map(claveDenominacion));
  const porClave: Conteo = {};
  for (const fila of conteo) {
    const clave = claveDenominacion(fila);
    if (!validas.has(clave)) {
      return {
        ok: false,
        error: "Hay un billete o moneda que no corresponde a la moneda de la caja.",
      };
    }
    if (!cantidadValida(fila.cantidad)) {
      return { ok: false, error: "Revisa las cantidades: tienen que ser enteras y no negativas." };
    }
    if (clave in porClave) {
      return { ok: false, error: "Una denominación vino repetida en el conteo." };
    }
    porClave[clave] = fila.cantidad;
  }
  const detalle = detalleDeConteo(porClave, currency);
  return detalle ? { ok: true, detalle } : { ok: false, error: "No pudimos leer el conteo." };
}

/**
 * Lee lo guardado en `closing_denominations` (jsonb). Devuelve `null` si no
 * hay detalle o si no tiene la forma esperada: la UI muestra "Sin detalle"
 * en vez de inventar filas (regla 11).
 */
export function leerDetalle(valor: unknown): DetalleDenominaciones | null {
  if (!valor || typeof valor !== "object") return null;
  const v = valor as Partial<DetalleDenominaciones>;
  if (v.version !== 1 || typeof v.currency !== "string" || !Array.isArray(v.filas)) return null;
  if (typeof v.totalCents !== "number") return null;
  const filas: FilaDeConteo[] = [];
  for (const f of v.filas as unknown[]) {
    if (!f || typeof f !== "object") return null;
    const fila = f as Partial<FilaDeConteo>;
    if (
      typeof fila.valorCents !== "number" ||
      (fila.tipo !== "billete" && fila.tipo !== "moneda") ||
      !cantidadValida(fila.cantidad)
    ) {
      return null;
    }
    filas.push({ valorCents: fila.valorCents, tipo: fila.tipo, cantidad: fila.cantidad });
  }
  return { version: 1, currency: v.currency, totalCents: v.totalCents, filas };
}
