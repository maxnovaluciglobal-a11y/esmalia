/**
 * PDF de un documento emitido (DOC-01), en el navegador con jsPDF.
 *
 * Por qué así y no en el servidor: jsPDF ya es dependencia (notas, recetas,
 * ficha completa), corre en el navegador sin binarios (nada de Chromium ni
 * wkhtmltopdf en Vercel) y se carga recién al hacer clic, así que no suma
 * peso a la ficha. Para "Imprimir" o "Guardar como PDF" con el diálogo del
 * navegador está la página del documento, con CSS de impresión (el mismo
 * criterio que /recorrido y los resultados del piloto).
 *
 * Recorre los mismos bloques que pinta la pantalla: lo que se ve es lo que
 * se descarga.
 */
import type { jsPDF } from "jspdf";

import { ALTO, ANCHO, MARGEN, UTIL, crearLienzo } from "@/lib/clinical/pdf-lienzo";
import { folioDocumento } from "@/lib/documentos/motor";
import { huellaCorta } from "@/lib/documentos/huella";
import type { Bloque, Tramo } from "@/lib/documentos/tipos";
import { fechaDocumento, fechaHora } from "@/lib/formato-fecha";

export interface DocumentoParaPdf {
  title: string;
  year: number;
  number: number;
  issuedAt: string;
  timezone: string;
  clinicName: string;
  clinicLegalName: string | null;
  clinicTaxId: string | null;
  clinicAddress: string | null;
  clinicPhone: string | null;
  bloques: Bloque[];
  contentSha256: string;
  voidedAt: string | null;
  voidReason: string | null;
  signatureUrl: string | null;
}

async function imagenComoDataUrl(
  url: string,
): Promise<{ dataUrl: string; formato: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const formato =
      blob.type === "image/jpeg" ? "JPEG" : blob.type === "image/webp" ? "WEBP" : "PNG";
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    return dataUrl ? { dataUrl, formato } : null;
  } catch {
    return null;
  }
}

type Palabra = { texto: string; negrita: boolean } | { salto: true };

function palabrasDe(tramos: readonly Tramo[]): Palabra[] {
  const out: Palabra[] = [];
  for (const t of tramos) {
    if (t.tipo === "salto") {
      out.push({ salto: true });
      continue;
    }
    // Conserva los espacios pegados a cada palabra para medir bien.
    for (const pedazo of t.texto.split(/(?<=\s)/)) {
      if (pedazo) out.push({ texto: pedazo, negrita: Boolean(t.negrita) });
    }
  }
  return out;
}

/** Texto con negritas mezcladas y salto de línea automático. */
function escribirTramos(
  doc: jsPDF,
  lienzo: ReturnType<typeof crearLienzo>,
  tramos: readonly Tramo[],
  opciones: { size: number; x?: number; ancho?: number; negritaTodo?: boolean },
) {
  const x0 = opciones.x ?? MARGEN;
  const ancho = opciones.ancho ?? UTIL - (x0 - MARGEN);
  const alto = opciones.size * 1.4;
  doc.setFontSize(opciones.size);
  doc.setTextColor(25);

  let linea: { texto: string; negrita: boolean; ancho: number }[] = [];
  let usado = 0;
  const volcar = () => {
    lienzo.saltoSiHaceFalta(alto);
    let x = x0;
    for (const p of linea) {
      doc.setFont("helvetica", p.negrita ? "bold" : "normal");
      doc.text(p.texto, x, lienzo.y);
      x += p.ancho;
    }
    lienzo.y += alto;
    linea = [];
    usado = 0;
  };

  for (const p of palabrasDe(tramos)) {
    if ("salto" in p) {
      volcar();
      continue;
    }
    const negrita = opciones.negritaTodo || p.negrita;
    doc.setFont("helvetica", negrita ? "bold" : "normal");
    const w = doc.getTextWidth(p.texto);
    if (usado + w > ancho && linea.length) {
      // El espacio final de la línea anterior no ocupa lugar al principio de la nueva.
      volcar();
      if (!p.texto.trim()) continue;
    }
    // Una palabra más larga que la línea: se corta con splitTextToSize.
    if (w > ancho) {
      for (const trozo of doc.splitTextToSize(p.texto, ancho) as string[]) {
        linea.push({ texto: trozo, negrita, ancho: doc.getTextWidth(trozo) });
        volcar();
      }
      continue;
    }
    linea.push({ texto: p.texto, negrita, ancho: w });
    usado += w;
  }
  if (linea.length) volcar();
}

function dibujarTabla(
  doc: jsPDF,
  lienzo: ReturnType<typeof crearLienzo>,
  b: Extract<Bloque, { tipo: "tabla" }>,
) {
  const size = 8.5;
  const alto = size * 1.35;
  const pad = 4;
  const n = b.columnas.length;
  // La columna más ancha se lleva el resto (la de la prestación).
  const pesos = b.columnas.map((c, i) =>
    i === 1 && n > 2 ? 3 : c.alineacion === "derecha" ? 1.3 : 1,
  );
  const total = pesos.reduce((a, x) => a + x, 0);
  const anchos = pesos.map((p) => (UTIL * p) / total);

  const fila = (celdas: string[], opciones: { negrita?: boolean; fondo?: boolean }) => {
    doc.setFont("helvetica", opciones.negrita ? "bold" : "normal");
    doc.setFontSize(size);
    const lineas = celdas.map((c, i) => doc.splitTextToSize(c, anchos[i] - pad * 2) as string[]);
    const altoFila = Math.max(1, ...lineas.map((l) => l.length)) * alto + pad;
    lienzo.saltoSiHaceFalta(altoFila);
    const yTop = lienzo.y - size;
    if (opciones.fondo) {
      doc.setFillColor(242, 239, 233);
      doc.rect(MARGEN, yTop - 2, UTIL, altoFila, "F");
    }
    let x = MARGEN;
    lineas.forEach((ls, i) => {
      const derecha = b.columnas[i]?.alineacion === "derecha";
      ls.forEach((l, j) => {
        const y = lienzo.y + j * alto;
        doc.setTextColor(25);
        if (derecha) doc.text(l, x + anchos[i] - pad, y, { align: "right" });
        else doc.text(l, x + pad, y);
      });
      x += anchos[i];
    });
    lienzo.y += altoFila;
    doc.setDrawColor(220);
    doc.line(MARGEN, lienzo.y - size - 1, ANCHO - MARGEN, lienzo.y - size - 1);
  };

  lienzo.y += 4;
  fila(
    b.columnas.map((c) => c.titulo),
    { negrita: true, fondo: true },
  );
  if (b.filas.length === 0) {
    fila([b.vacia ?? "Sin datos.", ...Array(Math.max(0, n - 1)).fill("")], {});
  }
  for (const f of b.filas) fila(f, {});
  if (b.pie) fila(b.pie, { negrita: true });
  lienzo.y += 6;
}

/** Nombre del archivo: "certificado-de-reposo-2026-0001.pdf". */
export function nombreDeArchivoPdf(d: Pick<DocumentoParaPdf, "title" | "year" | "number">): string {
  const base = `${d.title}-${d.year}-${String(d.number).padStart(4, "0")}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .toLowerCase();
  return `${base}.pdf`;
}

/** Genera y descarga el PDF de un documento emitido. */
export async function descargarDocumentoPdf(d: DocumentoParaPdf): Promise<void> {
  const doc = await construirDocumentoPdf(d);
  doc.save(nombreDeArchivoPdf(d));
}

/** Arma el PDF (sin descargarlo): lo usan la descarga y los tests. */
export async function construirDocumentoPdf(d: DocumentoParaPdf): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const lienzo = crearLienzo(doc);
  const { texto, separador } = lienzo;
  const folio = folioDocumento(d.year, d.number);

  // Encabezado: la clínica tal como quedó al emitir.
  lienzo.franjaSuperior();
  texto(d.clinicName, { size: 14, bold: true, espacio: 2 });
  const fiscal = [d.clinicLegalName, d.clinicTaxId ? `RUT ${d.clinicTaxId}` : null]
    .filter(Boolean)
    .join(" · ");
  if (fiscal) texto(fiscal, { size: 9, gris: true, espacio: 1 });
  const contacto = [d.clinicAddress, d.clinicPhone].filter(Boolean).join(" · ");
  if (contacto) texto(contacto, { size: 9, gris: true, espacio: 1 });
  texto(`${folio} · Emitido el ${fechaDocumento(d.issuedAt, d.timezone)}`, {
    size: 9,
    gris: true,
    espacio: 2,
  });

  if (d.voidedAt) {
    lienzo.y += 4;
    texto(`DOCUMENTO ANULADO el ${fechaHora(d.voidedAt, d.timezone)}`, {
      size: 12,
      bold: true,
      rojo: true,
      espacio: 1,
    });
    if (d.voidReason) texto(`Motivo: ${d.voidReason}`, { size: 9, rojo: true, espacio: 2 });
  }
  separador();

  const firma = d.signatureUrl ? await imagenComoDataUrl(d.signatureUrl) : null;

  for (const b of d.bloques) {
    switch (b.tipo) {
      case "titulo":
        lienzo.y += b.nivel === 1 ? 4 : 6;
        escribirTramos(doc, lienzo, b.tramos, { size: b.nivel === 1 ? 15 : 11, negritaTodo: true });
        lienzo.y += b.nivel === 1 ? 6 : 2;
        break;
      case "parrafo":
        escribirTramos(doc, lienzo, b.tramos, { size: 10.5 });
        lienzo.y += 6;
        break;
      case "lista":
        for (const item of b.items) {
          lienzo.saltoSiHaceFalta(16);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10.5);
          doc.text("•", MARGEN + 4, lienzo.y);
          escribirTramos(doc, lienzo, item, { size: 10.5, x: MARGEN + 16 });
        }
        lienzo.y += 6;
        break;
      case "tabla":
        dibujarTabla(doc, lienzo, b);
        break;
      case "firma": {
        // Abajo a la derecha, con la imagen de la firma sobre la línea.
        lienzo.saltoSiHaceFalta(130);
        lienzo.y += 28;
        const xFirma = ANCHO - MARGEN - 220;
        if (firma) {
          try {
            doc.addImage(firma.dataUrl, firma.formato, xFirma + 30, lienzo.y, 160, 56);
          } catch {
            // Imagen ilegible: queda la línea para firmar a mano.
          }
        }
        lienzo.y += 62;
        doc.setDrawColor(120);
        doc.line(xFirma, lienzo.y, xFirma + 220, lienzo.y);
        lienzo.y += 14;
        for (const linea of [b.nombre, b.especialidad, b.registro]) {
          if (linea) texto(linea, { size: 9, x: xFirma, espacio: 0, bold: linea === b.nombre });
        }
        if (!firma) texto("Firma y timbre", { size: 8, gris: true, x: xFirma, espacio: 0 });
        break;
      }
    }
  }

  const pie = `${folio} · Huella SHA-256 ${huellaCorta(d.contentSha256, 24)} · Firma simple (Ley 19.799)`;
  lienzo.enCadaPagina((i, paginas) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(140);
    doc.text(`${pie} · Página ${i} de ${paginas}`, MARGEN, ALTO - 24);
  });

  return doc;
}
