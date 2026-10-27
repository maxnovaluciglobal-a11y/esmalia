/**
 * "Exportar CSV" desde cada lista principal (EXP-04, Ola 6).
 *
 * Un solo camino para todas las listas: cada pantalla declara sus columnas
 * (`ColumnaLista`) y el botón `ExportarCsvLista` arma el archivo con lo que
 * la lista muestra filtrado. Acá vive todo lo puro, probado en
 * `tests/listas-csv.test.ts`:
 *
 * - Formato pensado para Excel en español (es-CL): UTF-8 con BOM, separador
 *   `;`, fechas `21-10-2026` en la hora de la clínica y montos como número
 *   (`15000` en CLP, `1234,50` en USD) con la moneda en su propia columna.
 * - Permisos: cada lista exige el mismo permiso que su pantalla, y las
 *   columnas de dinero (`dinero: true`) solo salen para quien ve finanzas.
 *   El servidor repite las dos verificaciones al registrar la exportación
 *   (`listas-csv.functions.ts`), y cada exportación queda anotada en
 *   `clinic_data_exports` con formato `lista_csv`.
 */
import { hasPermission, type Permission, type SujetoDePermisos } from "@/lib/access/access";
import { construirCsv, nombreArchivoCsv, type ColumnaCsv } from "@/lib/csv-export";
import { fromCents } from "@/lib/finance/finance";
import { fechaHoraPlanilla, fechaPlanilla } from "@/lib/formato-fecha";

export const LISTAS_CSV = {
  pacientes: { titulo: "Pacientes", permiso: "patients:view" },
  citas: { titulo: "Citas", permiso: "agenda:view" },
  presupuestos: { titulo: "Presupuestos", permiso: "finance:view" },
  cuentas_por_cobrar: { titulo: "Cuentas por cobrar", permiso: "finance:view" },
  morosidad: { titulo: "Morosidad", permiso: "finance:view" },
  caja: { titulo: "Turnos de caja", permiso: "cash:manage" },
  recordatorios: { titulo: "Recordatorios", permiso: "agenda:manage" },
  inventario: { titulo: "Inventario", permiso: "inventory:view" },
  tratamientos: { titulo: "Tratamientos", permiso: "treatments:view" },
  gastos: { titulo: "Gastos", permiso: "finance:view" },
  laboratorio: { titulo: "Órdenes de laboratorio", permiso: "treatments:view" },
  arancel: { titulo: "Arancel", permiso: "settings:manage" },
  implantes: { titulo: "Implantes por lote", permiso: "clinical:view" },
  // Ola 10 · frente A (FIN-13): planilla del período y listas de finanzas.
  finanzas: { titulo: "Finanzas del período", permiso: "finance:view" },
  gastos_fijos: { titulo: "Gastos fijos", permiso: "finance:view" },
  empresas_convenio: { titulo: "Empresas con convenio", permiso: "finance:view" },
  membresias: { titulo: "Cuotas de membresía", permiso: "cash:manage" },
  // Ola 11 · frente A (INF-11): tablas y detalle de los informes. Los montos
  // salen solo con finanzas, como en el resto (columnas `dinero: true`).
  informes: { titulo: "Informe", permiso: "dashboard:view" },
  // Ola 14 · frente B (MKT-10): registro de ciclos y rastreo para la autorización sanitaria.
  esterilizacion: { titulo: "Ciclos de esterilización", permiso: "inventory:view" },
  esterilizacion_rastreo: { titulo: "Rastreo de esterilización", permiso: "inventory:view" },
} as const satisfies Record<string, { titulo: string; permiso: Permission }>;

export type ListaCsv = keyof typeof LISTAS_CSV;
export const CLAVES_LISTAS_CSV = Object.keys(LISTAS_CSV) as [ListaCsv, ...ListaCsv[]];

/**
 * Permiso que habilita las columnas de dinero. En caja es `cash:manage`
 * porque la pantalla ya muestra los montos a quien cobra (recepción); en el
 * resto, `finance:view`.
 */
export function permisoDinero(lista: ListaCsv): Permission {
  return lista === "caja" || lista === "membresias" ? "cash:manage" : "finance:view";
}

export function puedeExportarLista(rol: SujetoDePermisos, lista: ListaCsv): boolean {
  return hasPermission(rol, LISTAS_CSV[lista].permiso);
}

export function puedeVerDineroEnLista(
  rol: SujetoDePermisos,
  lista: ListaCsv,
): boolean {
  return hasPermission(rol, permisoDinero(lista));
}

export interface ColumnaLista<T> extends ColumnaCsv<T> {
  /** Monto o dato financiero: solo sale para quien ve finanzas. */
  dinero?: boolean;
}

/** Columnas que le corresponden al rol (sin las de dinero si no ve finanzas). */
export function columnasParaRol<T>(
  columnas: readonly ColumnaLista<T>[],
  rol: SujetoDePermisos,
  lista: ListaCsv,
): ColumnaLista<T>[] {
  const conDinero = puedeVerDineroEnLista(rol, lista);
  return columnas.filter((c) => conDinero || !c.dinero);
}

/** Texto del CSV, sin BOM (lo agrega `descargarCsv`). */
export function csvDeLista<T>(filas: readonly T[], columnas: readonly ColumnaLista<T>[]): string {
  return construirCsv([...filas], [...columnas]);
}

export function nombreArchivoLista(lista: ListaCsv, hoy: string): string {
  return nombreArchivoCsv(LISTAS_CSV[lista].titulo, hoy);
}

// ── Celdas legibles ────────────────────────────────────────────────────────

/**
 * Monto como número para Excel en español: sin separador de miles (Excel lo
 * leería como texto) y con coma decimal solo en monedas con decimales.
 * CLP 15000 → "15000"; USD 123450 cents → "1234,50". Null → celda vacía.
 */
export function montoPlanilla(
  cents: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (cents === null || cents === undefined || !currency) return null;
  const unidades = fromCents(cents, currency);
  if (Number.isInteger(unidades) && fromCents(1, currency) === 1) return String(unidades);
  return unidades.toFixed(2).replace(".", ",");
}

/** Sí / No (vacío si no hay dato). */
export function siNoPlanilla(valor: boolean | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  return valor ? "Sí" : "No";
}

export { fechaHoraPlanilla, fechaPlanilla };
