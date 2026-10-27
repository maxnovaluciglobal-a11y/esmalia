/**
 * Exportación a CSV de los listados de la app (Tanda C).
 *
 * Dentalink dedica una entrada de menú entera a "Reportes Excel". No es
 * sofisticado y es lo primero que pide una contadora: un CSV bien formado por
 * cada listado cubre casi todo el pedido sin construir un generador de
 * reportes.
 *
 * Sin librería a propósito. Lo único que hay que hacer bien es el escapado, y
 * eso son diez líneas; una dependencia acá sería más código de mantenimiento
 * que el propio módulo.
 */

export interface ColumnaCsv<T> {
  /** Encabezado tal cual aparece en la planilla. */
  header: string;
  /**
   * Valor de la celda. Devolver `null`/`undefined` produce una celda vacía, que
   * en una planilla es lo correcto para "sin dato" — un "0" o un "—" ahí
   * rompería cualquier suma o filtro que haga quien recibe el archivo.
   */
  value: (fila: T) => string | number | null | undefined;
}

/**
 * Escapa una celda según RFC 4180: envuelve en comillas si hay separador,
 * comilla o salto de línea, y duplica las comillas internas.
 *
 * El caso peligroso es el otro: una celda que empieza con `=`, `+`, `-` o `@`
 * la interpreta Excel como fórmula al abrir el archivo. Un paciente llamado
 * "=cmd|..." es un vector de inyección real (CSV injection), así que esas se
 * prefijan con un apóstrofo, que Excel muestra pero no ejecuta.
 */
const NUMERO = /^-?\d+(?:[.,]\d+)?$/;

function escaparCelda(valor: string | number | null | undefined, separador: string): string {
  if (valor === null || valor === undefined) return "";
  let texto = String(valor);

  // Un número negativo ("-1500", "-12,50") no es una fórmula: sin esta
  // excepción el apóstrofo lo volvería texto y la columna no sumaría.
  if (/^[=+\-@\t\r]/.test(texto) && !NUMERO.test(texto)) texto = `'${texto}`;

  if (texto.includes(separador) || texto.includes('"') || /[\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/**
 * Arma el CSV completo.
 *
 * El separador por defecto es `;` y no `,`: Excel en español lo espera, y un
 * archivo con comas se abre con todas las columnas apiladas en la primera
 * celda. Quien necesite comas (Google Sheets, un import a otro sistema) puede
 * pedirlas explícitamente.
 */
export function construirCsv<T>(filas: T[], columnas: ColumnaCsv<T>[], separador = ";"): string {
  const cabecera = columnas.map((c) => escaparCelda(c.header, separador)).join(separador);
  const cuerpo = filas.map((fila) =>
    columnas.map((c) => escaparCelda(c.value(fila), separador)).join(separador),
  );
  return [cabecera, ...cuerpo].join("\r\n");
}

/** Nombre de archivo con la fecha, para que dos exports no se pisen. */
export function nombreArchivoCsv(base: string, hoy: string): string {
  const limpio = base
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${limpio}-${hoy}.csv`;
}

/**
 * Dispara la descarga en el navegador.
 *
 * El BOM UTF-8 al principio no es decorativo: sin él, Excel en Windows abre el
 * archivo en la codificación del sistema y cualquier tilde o ñ aparece rota.
 * Es el motivo número uno por el que un export "no funciona" para el cliente.
 */
export function descargarCsv(contenido: string, nombreArchivo: string): void {
  const blob = new Blob([`\ufeff${contenido}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Liberar en el siguiente tick: revocar de inmediato cancela la descarga en
  // algunos navegadores antes de que el click se procese.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Atajo: arma el CSV y lo descarga. */
export function exportarCsv<T>(
  filas: T[],
  columnas: ColumnaCsv<T>[],
  base: string,
  hoy: string,
): void {
  descargarCsv(construirCsv(filas, columnas), nombreArchivoCsv(base, hoy));
}
