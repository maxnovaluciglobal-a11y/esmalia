/**
 * Diagramación compartida de los PDF clínicos (nota, receta y ficha completa
 * del paciente): A4, márgenes, texto con salto de página, títulos de sección
 * y pie numerado. Recibe el documento ya creado, así que no carga jsPDF: cada
 * quien lo importa recién cuando hace falta (ver note-pdf.ts).
 */
import type { jsPDF } from "jspdf";

export const MARGEN = 48;
export const ANCHO = 595.28; // A4 pt
export const ALTO = 841.89;
export const UTIL = ANCHO - MARGEN * 2;

export interface OpcionesTexto {
  size?: number;
  bold?: boolean;
  gris?: boolean;
  rojo?: boolean;
  espacio?: number;
  /** Margen izquierdo (para sangrías o la columna de la firma). */
  x?: number;
}

export function crearLienzo(doc: jsPDF) {
  let y = MARGEN;

  const saltoSiHaceFalta = (alto: number) => {
    if (y + alto <= ALTO - MARGEN) return;
    doc.addPage();
    y = MARGEN;
  };

  const texto = (contenido: string, opts: OpcionesTexto = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 10);
    if (opts.rojo) doc.setTextColor(170, 30, 30);
    else doc.setTextColor(opts.gris ? 110 : 25);
    const x = opts.x ?? MARGEN;
    const lineas = doc.splitTextToSize(contenido, UTIL - (x - MARGEN)) as string[];
    const altoLinea = (opts.size ?? 10) * 1.35;
    for (const linea of lineas) {
      saltoSiHaceFalta(altoLinea);
      doc.text(linea, x, y);
      y += altoLinea;
    }
    y += opts.espacio ?? 4;
  };

  /** Título de sección: línea fina y rótulo en mayúsculas. */
  const titulo = (t: string) => {
    saltoSiHaceFalta(34);
    y += 8;
    doc.setDrawColor(215);
    doc.line(MARGEN, y - 6, ANCHO - MARGEN, y - 6);
    texto(t.toUpperCase(), { size: 9, bold: true, gris: true, espacio: 6 });
  };

  const separador = () => {
    y += 4;
    doc.setDrawColor(215);
    doc.line(MARGEN, y, ANCHO - MARGEN, y);
    y += 14;
  };

  /** Franja de color arriba de la primera hoja; deja el cursor debajo. */
  const franjaSuperior = () => {
    doc.setFillColor(160, 111, 36); // ocre de la marca (--brand-600)
    doc.rect(0, 0, ANCHO, 6, "F");
    y = MARGEN + 6;
  };

  /** Recorre todas las hojas al final (pie, numeración). */
  const enCadaPagina = (dibujar: (pagina: number, total: number) => void) => {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i += 1) {
      doc.setPage(i);
      dibujar(i, total);
    }
  };

  return {
    doc,
    get y() {
      return y;
    },
    set y(valor: number) {
      y = valor;
    },
    saltoSiHaceFalta,
    texto,
    titulo,
    separador,
    franjaSuperior,
    enCadaPagina,
  };
}

export type LienzoPdf = ReturnType<typeof crearLienzo>;
