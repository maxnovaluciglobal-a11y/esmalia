/**
 * Lógica pura del listado de pacientes (/pacientes), sin Supabase: tamaño de
 * página, filtros rápidos y qué columnas vale la pena mostrar (UX-15).
 */

export const OPCIONES_POR_PAGINA = [25, 50, 100] as const;
export const POR_PAGINA_POR_DEFECTO = 25;

/** Lo que llega por la URL: solo 25, 50 o 100; cualquier otra cosa, 25. */
export function normalizarPorPagina(valor: unknown): number {
  const n = Number(valor);
  return (OPCIONES_POR_PAGINA as readonly number[]).includes(n) ? n : POR_PAGINA_POR_DEFECTO;
}

/** Lo mínimo de una fila del listado que miran los filtros y las columnas. */
export interface FilaDeListado {
  sucursalId: string | null;
  ultimaVisitaISO: string;
  /** `null` = sin movimientos (regla 11), no "$0". */
  saldo: number | null;
  /** `null` = sin calcular. */
  riesgoAusencia: number | null;
  /** `null` = sin cita futura agendada. */
  proximoControl: string | null;
}

export interface FiltrosRapidos {
  conSaldo?: boolean;
  sinCitaFutura?: boolean;
}

/** "Con saldo": debe algo (saldo > 0). "Sin cita futura": no tiene próxima cita. */
export function pasaFiltrosRapidos(fila: FilaDeListado, filtros: FiltrosRapidos): boolean {
  if (filtros.conSaldo && !(fila.saldo != null && fila.saldo > 0)) return false;
  if (filtros.sinCitaFutura && fila.proximoControl != null) return false;
  return true;
}

export interface ColumnasVisibles {
  sucursal: boolean;
  ultimaVisita: boolean;
  saldo: boolean;
  riesgo: boolean;
}

/**
 * Una columna se muestra si al menos una fila de la página tiene un dato real.
 * Antes una página entera decía "Sin calcular" y "Sin movimientos" en cada
 * fila: ruido que empujaba lo útil fuera de la pantalla. La sucursal tampoco
 * aporta si la clínica tiene una sola.
 */
export function columnasConDatos(
  filas: readonly FilaDeListado[],
  cantidadDeSucursales: number,
): ColumnasVisibles {
  return {
    sucursal: cantidadDeSucursales > 1 && filas.some((f) => Boolean(f.sucursalId)),
    ultimaVisita: filas.some((f) => Boolean(f.ultimaVisitaISO)),
    saldo: filas.some((f) => f.saldo != null),
    riesgo: filas.some((f) => f.riesgoAusencia != null),
  };
}
