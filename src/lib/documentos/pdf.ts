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
 *
 * `construirHojaPdf` es la diagramación común (encabezado de la clínica,
 * bloques, firma y pie). La usan el documento emitido (`construirDocumentoPdf`)
 * y el presupuesto (PLA-08), que no tiene folio ni huella porque no es un
 * documento emitido. También corre en el servidor: el correo al paciente
 * (PLA-09, DOC-07) adjunta este mismo PDF.
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

/** Bytes → base64, sin FileReader (corre igual en el navegador y en Node). */
function base64DeBytes(bytes: Uint8Array): string {
  let binario = "";
  const trozo = 0x8000;
  for (let i = 0; i < bytes.length; i += trozo) {
    binario += String.fromCharCode(...bytes.subarray(i, i + trozo));
  }
  return btoa(binario);
}

async function imagenComoDataUrl(
  url: string,
): Promise<{ dataUrl: string; formato: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const tipo = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const formato = tipo === "image/jpeg" ? "JPEG" : tipo === "image/webp" ? "WEBP" : "PNG";
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return null;
    const mime =
      formato === "JPEG" ? "image/jpeg" : formato === "WEBP" ? "image/webp" : "image/png";
    return { dataUrl: `data:${mime};base64,${base64DeBytes(bytes)}`, formato };
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
  // La columna más ancha se lleva el resto (la de la prestación), salvo que
  // la tabla traiga sus propios pesos (la receta).
  const pesos = b.columnas.map(
    (c, i) => c.peso ?? (i === 1 && n > 2 ? 3 : c.alineacion === "derecha" ? 1.3 : 1),
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
  const destacadas = new Set(b.destacadas ?? []);
  b.filas.forEach((f, i) => fila(f, destacadas.has(i) ? { negrita: true, fondo: true } : {}));
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

/**
 * Lo que necesita la diagramación común: el encabezado de la clínica, los
 * bloques y el pie. Serializable (viaja del servidor al navegador).
 */
export interface HojaParaPdf {
  clinicName: string;
  /** Líneas grises bajo el nombre: datos tributarios, dirección, contacto. */
  lineasEncabezado: string[];
  /** Línea de referencia: "N.º 2026-0007 · Emitido el …" o "Presupuesto P-12 · …". */
  referencia: string;
  /** Aviso en rojo bajo el encabezado (documento anulado). */
  aviso: { titulo: string; detalle: string | null } | null;
  bloques: Bloque[];
  /** URL (firmada) o data URL de la imagen de la firma. */
  signatureUrl: string | null;
  /** Texto del pie de cada página (se le suma "Página i de n"). */
  pie: string;
}

/** Encabezado, aviso y pie de un documento emitido. */
export function hojaDeDocumento(d: DocumentoParaPdf): HojaParaPdf {
  const folio = folioDocumento(d.year, d.number);
  const fiscal = [d.clinicLegalName, d.clinicTaxId ? `RUT ${d.clinicTaxId}` : null]
    .filter(Boolean)
    .join(" · ");
  const contacto = [d.clinicAddress, d.clinicPhone].filter(Boolean).join(" · ");
  return {
    clinicName: d.clinicName,
    lineasEncabezado: [fiscal, contacto].filter(Boolean),
    referencia: `${folio} · Emitido el ${fechaDocumento(d.issuedAt, d.timezone)}`,
    aviso: d.voidedAt
      ? {
          titulo: `DOCUMENTO ANULADO el ${fechaHora(d.voidedAt, d.timezone)}`,
          detalle: d.voidReason ? `Motivo: ${d.voidReason}` : null,
        }
      : null,
    bloques: d.bloques,
    signatureUrl: d.signatureUrl,
    pie: `${folio} · Huella SHA-256 ${huellaCorta(d.contentSha256, 24)} · Firma simple (Ley 19.799)`,
  };
}

/** Arma el PDF (sin descargarlo): lo usan la descarga y los tests. */
export async function construirDocumentoPdf(d: DocumentoParaPdf): Promise<jsPDF> {
  return construirHojaPdf(hojaDeDocumento(d));
}

/** Diagramación común: encabezado de la clínica, bloques, firma y pie numerado. */
export async function construirHojaPdf(h: HojaParaPdf): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const lienzo = crearLienzo(doc);
  const { texto, separador } = lienzo;

  // Encabezado: la clínica tal como quedó al emitir.
  lienzo.franjaSuperior();
  texto(h.clinicName, { size: 14, bold: true, espacio: 2 });
  for (const linea of h.lineasEncabezado) texto(linea, { size: 9, gris: true, espacio: 1 });
  texto(h.referencia, { size: 9, gris: true, espacio: 2 });

  if (h.aviso) {
    lienzo.y += 4;
    texto(h.aviso.titulo, { size: 12, bold: true, rojo: true, espacio: 1 });
    if (h.aviso.detalle) texto(h.aviso.detalle, { size: 9, rojo: true, espacio: 2 });
  }
  separador();

  const firma = h.signatureUrl ? await imagenComoDataUrl(h.signatureUrl) : null;
  for (const b of h.bloques) {
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

  lienzo.enCadaPagina((i, paginas) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(140);
    doc.text(`${h.pie} · Página ${i} de ${paginas}`, MARGEN, ALTO - 24);
  });

  return doc;
}
