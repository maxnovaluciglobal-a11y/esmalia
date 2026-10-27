// src/lib/migracion/leer-archivo.ts
//
// Lee el archivo de la migración en el navegador: CSV (papaparse, como los
// importadores de siempre) o Excel .xlsx. Para Excel no se suma una
// dependencia: un .xlsx es un zip de XML, y `fflate` ya está en el proyecto
// (lo usa la exportación). Se lee solo la primera hoja, con la primera fila
// como encabezados. Las fechas de Excel llegan como número de serie; las
// entiende `leerFecha` / `leerHora`.

import type { CsvParsed } from "@/lib/csv/column-mapping";

export const EXTENSIONES_ACEPTADAS = ".csv,.txt,.xlsx";

/** Columna "AB" → índice 27 (base 0). */
export function indiceDeColumna(ref: string): number {
  const letras = /^[A-Z]+/.exec(ref.toUpperCase())?.[0] ?? "A";
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function textoDe(nodo: Element | null): string {
  if (!nodo) return "";
  // <si><t>…</t></si> o <si><r><t>…</t></r><r><t>…</t></r></si>
  return Array.from(nodo.getElementsByTagName("t"))
    .map((t) => t.textContent ?? "")
    .join("");
}

/** Convierte las filas de una hoja (matriz de celdas) en encabezados + filas. */
export function filasDeMatriz(matriz: string[][]): CsvParsed {
  const [primera = [], ...resto] = matriz;
  const headers: string[] = [];
  const usados = new Map<string, number>();
  primera.forEach((h, i) => {
    let nombre = (h ?? "").trim() || `Columna ${i + 1}`;
    const n = usados.get(nombre) ?? 0;
    usados.set(nombre, n + 1);
    if (n > 0) nombre = `${nombre} (${n + 1})`;
    headers[i] = nombre;
  });
  const rows = resto
    .filter((fila) => fila.some((v) => (v ?? "").trim() !== ""))
    .map((fila) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = (fila[i] ?? "").trim();
      });
      return obj;
    });
  return { headers, rows };
}

async function leerXlsx(archivo: File): Promise<CsvParsed> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const zip = unzipSync(new Uint8Array(await archivo.arrayBuffer()));
  const parser = new DOMParser();
  const xml = (ruta: string) => {
    const bytes = zip[ruta];
    return bytes ? parser.parseFromString(strFromU8(bytes), "application/xml") : null;
  };

  const compartidas = xml("xl/sharedStrings.xml");
  const textos = compartidas
    ? Array.from(compartidas.getElementsByTagName("si")).map((si) => textoDe(si))
    : [];

  const hojas = Object.keys(zip)
    .filter((r) => /^xl\/worksheets\/sheet\d+\.xml$/.test(r))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
  const hoja = hojas[0] ? xml(hojas[0]) : null;
  if (!hoja) throw new Error("El Excel no tiene hojas que podamos leer.");

  const matriz: string[][] = [];
  for (const fila of Array.from(hoja.getElementsByTagName("row"))) {
    const valores: string[] = [];
    for (const c of Array.from(fila.getElementsByTagName("c"))) {
      const ref = c.getAttribute("r") ?? "";
      const tipo = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let valor: string;
      if (tipo === "s") valor = textos[Number(v)] ?? "";
      else if (tipo === "inlineStr") valor = textoDe(c.getElementsByTagName("is")[0] ?? null);
      else if (tipo === "b") valor = v === "1" ? "Sí" : "No";
      else valor = v;
      valores[ref ? indiceDeColumna(ref) : valores.length] = valor;
    }
    matriz.push(Array.from(valores, (v) => v ?? ""));
  }
  return filasDeMatriz(matriz);
}

async function leerCsv(archivo: File): Promise<CsvParsed> {
  const { default: Papa } = await import("papaparse");
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(archivo, {
      header: false,
      skipEmptyLines: true,
      complete: (res) => resolve(filasDeMatriz(res.data)),
      error: (err) => reject(err),
    });
  });
}

/** CSV o Excel → encabezados + filas. Lanza con un mensaje para la persona. */
export async function leerArchivoDeMigracion(archivo: File): Promise<CsvParsed> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith(".xls")) {
    throw new Error(
      "Ese es el formato antiguo de Excel (.xls). Ábrelo y guárdalo como .xlsx o .csv.",
    );
  }
  const datos = nombre.endsWith(".xlsx") ? await leerXlsx(archivo) : await leerCsv(archivo);
  if (datos.headers.length === 0 || datos.rows.length === 0) {
    throw new Error(
      "El archivo no tiene filas para importar (la primera fila son los encabezados).",
    );
  }
  return datos;
}
