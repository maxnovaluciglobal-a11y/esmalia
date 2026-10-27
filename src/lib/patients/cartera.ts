/**
 * Indicadores de la cartera para la franja protagonista de /pacientes (A+):
 * activos, nuevos del mes, con saldo (y cuánto), sin cita futura y fichas
 * incompletas. Lógica pura, sin Supabase. Se calcula sobre todas las fichas
 * cargadas (no sobre la página ni sobre los filtros): es la foto de la
 * cartera, y cada indicador, al tocarlo, filtra la lista.
 */

export interface FilaDeCartera {
  estado: "activo" | "nuevo" | "inactivo";
  /** ISO de alta de la ficha; null/undefined = sin dato. */
  creadaEl?: string | null;
  /** `null` = sin movimientos o sin permiso de finanzas (regla 11). */
  saldo: number | null;
  proximoControl: string | null;
  faltantes?: readonly string[];
  archivadaEl?: string | null;
}

export interface ResumenCartera {
  total: number;
  activos: number;
  nuevosDelMes: number;
  /** `null` cuando nadie trae saldo (sin `finance:view`): no se fabrica cero. */
  conSaldo: { cantidad: number; montoCents: number } | null;
  sinCitaFutura: number;
  incompletas: number;
}

/** "2026-10" del instante dado, en el huso de la clínica. */
export function mesEnZona(iso: string | Date, zona: string): string {
  const fecha = typeof iso === "string" ? new Date(iso) : iso;
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(fecha);
  const y = partes.find((p) => p.type === "year")?.value ?? "";
  const m = partes.find((p) => p.type === "month")?.value ?? "";
  return `${y}-${m}`;
}

/** La ficha se creó en el mes de `hoy` (YYYY-MM-DD de la clínica). */
export function esNuevaDelMes(fila: Pick<FilaDeCartera, "creadaEl">, hoy: string, zona: string) {
  if (!fila.creadaEl) return false;
  const t = Date.parse(fila.creadaEl);
  if (Number.isNaN(t)) return false;
  return mesEnZona(new Date(t), zona) === hoy.slice(0, 7);
}

export function resumenCartera(
  filas: readonly FilaDeCartera[],
  hoy: string,
  zona: string,
): ResumenCartera {
  let activos = 0;
  let nuevosDelMes = 0;
  let sinCitaFutura = 0;
  let incompletas = 0;
  let conSaldoCant = 0;
  let conSaldoMonto = 0;
  let algunSaldo = false;
  for (const f of filas) {
    if (!f.archivadaEl && f.estado !== "inactivo") activos++;
    if (esNuevaDelMes(f, hoy, zona)) nuevosDelMes++;
    if (f.proximoControl == null) sinCitaFutura++;
    if (f.faltantes && f.faltantes.length > 0) incompletas++;
    if (f.saldo != null) {
      algunSaldo = true;
      if (f.saldo > 0) {
        conSaldoCant++;
        conSaldoMonto += f.saldo;
      }
    }
  }
  return {
    total: filas.length,
    activos,
    nuevosDelMes,
    conSaldo: algunSaldo ? { cantidad: conSaldoCant, montoCents: conSaldoMonto } : null,
    sinCitaFutura,
    incompletas,
  };
}
