// Vista general de finanzas, venta real, folios y planilla para el contador
// (Ola 10 · frente A: FIN-01, FIN-13, FIN-15, FIN-18).
//
// Las sumas las hace Postgres (`finanzas_por_sucursal`, `finanzas_venta_real`,
// `finanzas_por_cobrar`): acá solo se juntan las pocas filas que devuelven
// (una por sucursal o por profesional), se calculan los totales y las tasas y
// se arma el texto. Lógica pura: sin red ni base.

export interface FilaSucursal {
  branchId: string | null;
  branchName: string;
  cobradoCents: number;
  pagos: number;
  cuotasCobradasCents: number;
  cuotasCobradas: number;
  gastosCents: number;
  gastos: number;
  realizadoCents: number;
}

export interface TotalesSucursales {
  /** Pagos de tratamientos + cuotas de membresía cobradas. */
  ingresosCents: number;
  cobradoCents: number;
  pagos: number;
  cuotasCobradasCents: number;
  cuotasCobradas: number;
  gastosCents: number;
  gastos: number;
  realizadoCents: number;
  /** Ingresos menos gastos (bruto: la retención de los medios va aparte). */
  resultadoCents: number;
}

export function totalizarSucursales(filas: readonly FilaSucursal[]): TotalesSucursales {
  const t = {
    cobradoCents: 0,
    pagos: 0,
    cuotasCobradasCents: 0,
    cuotasCobradas: 0,
    gastosCents: 0,
    gastos: 0,
    realizadoCents: 0,
  };
  for (const f of filas) {
    t.cobradoCents += f.cobradoCents;
    t.pagos += f.pagos;
    t.cuotasCobradasCents += f.cuotasCobradasCents;
    t.cuotasCobradas += f.cuotasCobradas;
    t.gastosCents += f.gastosCents;
    t.gastos += f.gastos;
    t.realizadoCents += f.realizadoCents;
  }
  const ingresosCents = t.cobradoCents + t.cuotasCobradasCents;
  return { ...t, ingresosCents, resultadoCents: ingresosCents - t.gastosCents };
}

/** Resultado de una sucursal: lo que entró (pagos y cuotas) menos sus gastos. */
export function resultadoDeSucursal(f: FilaSucursal): number {
  return f.cobradoCents + f.cuotasCobradasCents - f.gastosCents;
}

/**
 * Sucursales ordenadas para mostrar: primero las con nombre, de mayor a menor
 * ingreso; "Sin sucursal" (gastos de la clínica entera, pacientes sin sede)
 * siempre al final.
 */
export function ordenarSucursales(filas: readonly FilaSucursal[]): FilaSucursal[] {
  return [...filas].sort((a, b) => {
    if ((a.branchId === null) !== (b.branchId === null)) return a.branchId === null ? 1 : -1;
    const ia = a.cobradoCents + a.cuotasCobradasCents;
    const ib = b.cobradoCents + b.cuotasCobradasCents;
    return ib - ia || a.branchName.localeCompare(b.branchName);
  });
}

// ─── Venta real (FIN-18) ────────────────────────────────────────────────────

export interface FilaVentaReal {
  professionalId: string | null;
  professionalName: string;
  color: string | null;
  presupuestadoCents: number;
  presupuestos: number;
  realizadoCents: number;
  realizadoPacienteCents: number;
  realizadoItems: number;
  cobradoCents: number;
}

export interface TotalesVentaReal {
  presupuestadoCents: number;
  presupuestos: number;
  realizadoCents: number;
  realizadoPacienteCents: number;
  realizadoItems: number;
  cobradoCents: number;
  /** Realizado / presupuestado en %; null sin presupuestos (regla 11). */
  realizadoSobrePresupuestado: number | null;
  /** Cobrado / parte del paciente de lo realizado, en %; null sin realizado. */
  cobradoSobreRealizado: number | null;
}

function porcentaje(parte: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((parte / total) * 100);
}

export function totalizarVentaReal(filas: readonly FilaVentaReal[]): TotalesVentaReal {
  let presupuestadoCents = 0;
  let presupuestos = 0;
  let realizadoCents = 0;
  let realizadoPacienteCents = 0;
  let realizadoItems = 0;
  let cobradoCents = 0;
  for (const f of filas) {
    presupuestadoCents += f.presupuestadoCents;
    presupuestos += f.presupuestos;
    realizadoCents += f.realizadoCents;
    realizadoPacienteCents += f.realizadoPacienteCents;
    realizadoItems += f.realizadoItems;
    cobradoCents += f.cobradoCents;
  }
  return {
    presupuestadoCents,
    presupuestos,
    realizadoCents,
    realizadoPacienteCents,
    realizadoItems,
    cobradoCents,
    realizadoSobrePresupuestado: porcentaje(realizadoCents, presupuestadoCents),
    cobradoSobreRealizado: porcentaje(cobradoCents, realizadoPacienteCents),
  };
}

/** Profesionales con algo en el período, de mayor a menor realizado; "Sin profesional" al final. */
export function ordenarVentaReal(filas: readonly FilaVentaReal[]): FilaVentaReal[] {
  return [...filas].sort((a, b) => {
    if ((a.professionalId === null) !== (b.professionalId === null))
      return a.professionalId === null ? 1 : -1;
    return (
      b.realizadoCents - a.realizadoCents ||
      b.presupuestadoCents - a.presupuestadoCents ||
      a.professionalName.localeCompare(b.professionalName)
    );
  });
}

export type LecturaVentaReal =
  | "sin_datos"
  | "se_hizo_mas_de_lo_presupuestado"
  | "se_hizo_lo_presupuestado"
  | "falta_por_hacer"
  | "falta_por_cobrar"
  | "al_dia";

/**
 * Qué conviene mirar primero. Se cuenta "falta por cobrar" cuando lo cobrado
 * no llega al 80 % de lo que le toca pagar al paciente por lo realizado.
 */
export function leerVentaReal(t: TotalesVentaReal): LecturaVentaReal {
  if (t.presupuestadoCents === 0 && t.realizadoCents === 0 && t.cobradoCents === 0)
    return "sin_datos";
  if (t.cobradoSobreRealizado !== null && t.cobradoSobreRealizado < 80) return "falta_por_cobrar";
  if (t.realizadoSobrePresupuestado === null) return "al_dia";
  if (t.realizadoSobrePresupuestado > 105) return "se_hizo_mas_de_lo_presupuestado";
  if (t.realizadoSobrePresupuestado >= 90) return "se_hizo_lo_presupuestado";
  return "falta_por_hacer";
}

// ─── Folio de boleta emitida afuera (FIN-15) ────────────────────────────────

export const TIPOS_DOCUMENTO = [
  "boleta",
  "boleta_exenta",
  "factura",
  "factura_exenta",
  "boleta_honorarios",
  "otro",
] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const ETIQUETA_DOCUMENTO: Record<TipoDocumento, string> = {
  boleta: "Boleta",
  boleta_exenta: "Boleta exenta",
  factura: "Factura",
  factura_exenta: "Factura exenta",
  boleta_honorarios: "Boleta de honorarios",
  otro: "Otro documento",
};

export function esTipoDocumento(v: string): v is TipoDocumento {
  return (TIPOS_DOCUMENTO as readonly string[]).includes(v);
}

/** Folio limpio: sin espacios a los lados ni ceros a la izquierda en folios numéricos. */
export function normalizarFolio(folio: string): string {
  const limpio = folio.trim().replace(/\s+/g, " ");
  return /^\d+$/.test(limpio) ? limpio.replace(/^0+(?=\d)/, "") : limpio;
}

export function validarFolio(e: { docType: string; folio: string; issuedOn: string }): string[] {
  const errores: string[] = [];
  if (!esTipoDocumento(e.docType)) errores.push("Elige el tipo de documento.");
  const folio = normalizarFolio(e.folio);
  if (!folio) errores.push("Indica el número de folio.");
  else if (folio.length > 40) errores.push("El folio admite hasta 40 caracteres.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.issuedOn)) errores.push("Indica la fecha de emisión.");
  return errores;
}

// ─── Planilla para el contador (FIN-13) ─────────────────────────────────────

export type TipoMovimiento = "ingreso" | "cuota" | "gasto";

export const ETIQUETA_MOVIMIENTO: Record<TipoMovimiento, string> = {
  ingreso: "Pago de paciente",
  cuota: "Cuota de membresía",
  gasto: "Gasto",
};

/** Una fila de la planilla del período: pagos, cuotas cobradas y gastos juntos. */
export interface Movimiento {
  id: string;
  tipo: TipoMovimiento;
  /** Día contable `YYYY-MM-DD` en la zona de la clínica. */
  fecha: string;
  detalle: string;
  paciente: string | null;
  medio: string | null;
  sucursal: string | null;
  /** Positivo para ingresos y cuotas; los gastos van positivos en su columna. */
  montoCents: number;
  currency: string;
  documento: string | null;
  folio: string | null;
}

/** Ordena por fecha y tipo (ingresos, cuotas, gastos) para que la planilla se lea como un libro. */
export function ordenarMovimientos(movs: readonly Movimiento[]): Movimiento[] {
  const orden: Record<TipoMovimiento, number> = { ingreso: 0, cuota: 1, gasto: 2 };
  return [...movs].sort(
    (a, b) =>
      a.fecha.localeCompare(b.fecha) || orden[a.tipo] - orden[b.tipo] || a.id.localeCompare(b.id),
  );
}

/** Monto con signo para el saldo del libro: los gastos restan. */
export function montoConSigno(m: Movimiento): number {
  return m.tipo === "gasto" ? -m.montoCents : m.montoCents;
}
