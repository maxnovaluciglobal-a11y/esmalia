// Gastos fijos recurrentes (Ola 10 · frente A: FIN-09).
//
// La base guarda la plantilla (`recurring_expenses`) y, en `expenses`, el gasto
// de cada mes confirmado con su mes (`recurring_period`). Acá se decide, para un
// mes, qué gasto fijo corresponde, cuáles ya se confirmaron y cuáles faltan.
// La creación misma la hace la base (`confirmar_gastos_fijos`), con la misma
// regla de "corresponde" que `correspondeAlMes`.
//
// Meses como `YYYY-MM-01`. Lógica pura: sin red ni base, sin reloj (el mes de
// hoy llega como argumento, con la zona de la clínica: regla 7).

export interface GastoFijo {
  id: string;
  category: string;
  description: string;
  supplier: string | null;
  amountCents: number;
  currency: string;
  paymentMethodId: string | null;
  branchId: string | null;
  dayOfMonth: number;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  notes: string | null;
}

/** Gasto del mes ya confirmado a partir de una plantilla. */
export interface GastoConfirmado {
  id: string;
  recurringExpenseId: string;
  amountCents: number;
  incurredOn: string;
}

export type EstadoGastoDelMes = "pendiente" | "confirmado";

export interface GastoFijoDelMes {
  gasto: GastoFijo;
  /** Día contable en que vence ese mes (el día pedido, o el último del mes). */
  fecha: string;
  estado: EstadoGastoDelMes;
  /** Monto con que se confirmó; null si sigue pendiente (regla 11). */
  montoConfirmadoCents: number | null;
  gastoId: string | null;
}

const MES_ISO = /^(\d{4})-(\d{2})-\d{2}$/;

/** Primer día del mes de una fecha `YYYY-MM-DD`. */
export function mesDe(dia: string): string {
  const m = MES_ISO.exec(dia);
  if (!m) throw new Error(`Fecha inválida: ${dia}`);
  return `${m[1]}-${m[2]}-01`;
}

function partes(mes: string): [number, number] {
  const m = MES_ISO.exec(mes);
  if (!m) throw new Error(`Mes inválido: ${mes}`);
  return [Number(m[1]), Number(m[2])];
}

/** Suma `n` meses (negativo para restar) a un mes `YYYY-MM-01`. */
export function sumarMeses(mes: string, n: number): string {
  const [anio, m] = partes(mes);
  const total = anio * 12 + (m - 1) + n;
  const a = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${String(a).padStart(4, "0")}-${String(mm).padStart(2, "0")}-01`;
}

/** Último día del mes (28 a 31). */
export function diasDelMes(mes: string): number {
  const [anio, m] = partes(mes);
  return new Date(Date.UTC(anio, m, 0)).getUTCDate();
}

/** El gasto fijo corre ese mes: activo y el mes dentro de su rango. */
export function correspondeAlMes(gasto: GastoFijo, mes: string): boolean {
  const inicio = mesDe(mes);
  if (!gasto.active) return false;
  if (mesDe(gasto.startsOn) > inicio) return false;
  if (gasto.endsOn !== null && mesDe(gasto.endsOn) < inicio) return false;
  return true;
}

/** Fecha en que vence ese mes: el día pedido, sin pasarse del último día. */
export function fechaDelGasto(gasto: GastoFijo, mes: string): string {
  const inicio = mesDe(mes);
  const dia = Math.min(Math.max(1, gasto.dayOfMonth), diasDelMes(inicio));
  return `${inicio.slice(0, 8)}${String(dia).padStart(2, "0")}`;
}

/**
 * Los gastos fijos del mes, en orden de vencimiento: los que corresponden y
 * los ya confirmados (aunque la plantilla se haya desactivado después: el
 * gasto existe y cuenta).
 */
export function gastosFijosDelMes(
  gastos: readonly GastoFijo[],
  confirmados: readonly GastoConfirmado[],
  mes: string,
): GastoFijoDelMes[] {
  const porPlantilla = new Map(confirmados.map((c) => [c.recurringExpenseId, c]));
  const salida: GastoFijoDelMes[] = [];
  for (const gasto of gastos) {
    const confirmado = porPlantilla.get(gasto.id);
    if (!confirmado && !correspondeAlMes(gasto, mes)) continue;
    salida.push({
      gasto,
      fecha: confirmado?.incurredOn ?? fechaDelGasto(gasto, mes),
      estado: confirmado ? "confirmado" : "pendiente",
      montoConfirmadoCents: confirmado?.amountCents ?? null,
      gastoId: confirmado?.id ?? null,
    });
  }
  return salida.sort(
    (a, b) =>
      a.fecha.localeCompare(b.fecha) || a.gasto.description.localeCompare(b.gasto.description),
  );
}

export interface ResumenGastosFijos {
  pendientes: number;
  pendientesCents: number;
  confirmados: number;
  confirmadosCents: number;
  /** Lo que suman los gastos fijos del mes (confirmados con su monto real). */
  totalCents: number;
}

export function resumenGastosFijos(lista: readonly GastoFijoDelMes[]): ResumenGastosFijos {
  let pendientes = 0;
  let pendientesCents = 0;
  let confirmados = 0;
  let confirmadosCents = 0;
  for (const g of lista) {
    if (g.estado === "pendiente") {
      pendientes += 1;
      pendientesCents += g.gasto.amountCents;
    } else {
      confirmados += 1;
      confirmadosCents += g.montoConfirmadoCents ?? 0;
    }
  }
  return {
    pendientes,
    pendientesCents,
    confirmados,
    confirmadosCents,
    totalCents: pendientesCents + confirmadosCents,
  };
}

/** Lo que cuesta al mes el conjunto de gastos fijos activos (monto de referencia). */
export function costoMensualDeReferencia(gastos: readonly GastoFijo[], mes: string): number {
  return gastos.filter((g) => correspondeAlMes(g, mes)).reduce((s, g) => s + g.amountCents, 0);
}

export interface EntradaGastoFijo {
  category: string;
  description: string;
  amountCents: number;
  dayOfMonth: number;
  startsOn: string;
  endsOn: string | null;
}

/** Errores de validación en palabras de la clínica; lista vacía = válido. */
export function validarGastoFijo(e: EntradaGastoFijo): string[] {
  const errores: string[] = [];
  if (!e.category.trim()) errores.push("Indica la categoría (por ejemplo, Arriendo).");
  if (!e.description.trim()) errores.push("Indica qué se paga.");
  if (!Number.isInteger(e.amountCents) || e.amountCents <= 0)
    errores.push("El monto tiene que ser mayor que cero.");
  if (!Number.isInteger(e.dayOfMonth) || e.dayOfMonth < 1 || e.dayOfMonth > 28)
    errores.push("El día del mes va del 1 al 28, para que exista en todos los meses.");
  if (!MES_ISO.test(e.startsOn)) errores.push("Indica desde qué mes corre.");
  if (e.endsOn !== null && MES_ISO.test(e.startsOn) && mesDe(e.endsOn) < mesDe(e.startsOn))
    errores.push("El último mes no puede ser anterior al primero.");
  return errores;
}

/** Categorías sugeridas para el primer gasto fijo (texto libre igual que en Gastos). */
export const CATEGORIAS_GASTO_FIJO = [
  "Arriendo",
  "Sueldos",
  "Honorarios",
  "Luz",
  "Agua",
  "Internet y teléfono",
  "Software",
  "Contabilidad",
  "Seguros",
  "Gastos comunes",
] as const;
