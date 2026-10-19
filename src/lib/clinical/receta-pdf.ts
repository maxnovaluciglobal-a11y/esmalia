import { contenidoReceta, folioReceta, type RecetaEmitida } from "@/lib/clinical/recetas";

const MARGEN = 48;
const ANCHO = 595.28; // A4 pt
const ALTO = 841.89;
const UTIL = ANCHO - MARGEN * 2;

async function imagenComoDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Genera y descarga el PDF imprimible de una receta. jsPDF se carga recién
 * acá (mismo criterio que note-pdf.ts: no sumar ~600KB a la ficha).
 */
export async function descargarRecetaPdf(args: {
  receta: RecetaEmitida;
  fecha: string;
  edad: number | null;
  documentoPaciente?: string | null;
  firmaUrl?: string | null;
}): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const c = contenidoReceta(args.receta, {
    fecha: args.fecha,
    edad: args.edad,
    documentoPaciente: args.documentoPaciente,
  });
  let y = MARGEN;

  const saltoSiHaceFalta = (alto: number) => {
    if (y + alto <= ALTO - MARGEN) return;
    doc.addPage();
    y = MARGEN;
  };

  const texto = (
    contenido: string,
    opts: {
      size?: number;
      bold?: boolean;
      gris?: boolean;
      rojo?: boolean;
      espacio?: number;
      x?: number;
    } = {},
  ) => {
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

  const separador = () => {
    y += 4;
    doc.setDrawColor(215);
    doc.line(MARGEN, y, ANCHO - MARGEN, y);
    y += 14;
  };

  // Encabezado: clínica
  doc.setFillColor(13, 148, 136);
  doc.rect(0, 0, ANCHO, 6, "F");
  y = MARGEN + 6;
  const [nombreClinica, ...restoClinica] = c.encabezado;
  texto(nombreClinica ?? "", { size: 15, bold: true, espacio: 2 });
  for (const linea of restoClinica) texto(linea, { size: 9, gris: true, espacio: 1 });
  y += 6;
  texto(c.titulo.toUpperCase(), { size: 11, bold: true, espacio: 6 });

  if (c.anulada) {
    texto(c.anulada, { size: 12, bold: true, rojo: true, espacio: 6 });
  }

  separador();
  for (const linea of c.paciente) texto(linea, { size: 10, bold: linea === c.paciente[0] });
  separador();

  texto("Rp.", { size: 12, bold: true, espacio: 6 });
  for (const m of c.medicamentos) {
    saltoSiHaceFalta(48);
    texto(m.titulo, { size: 11, bold: true, espacio: 1 });
    texto(m.posologia, { size: 10, espacio: 1, x: MARGEN + 14 });
    if (m.indicaciones) texto(m.indicaciones, { size: 9, gris: true, espacio: 1, x: MARGEN + 14 });
    y += 8;
  }

  if (c.indicacionesGenerales) {
    separador();
    texto("Indicaciones", { size: 10, bold: true, espacio: 2 });
    texto(c.indicacionesGenerales, { size: 10, espacio: 6 });
  }

  // Firma del profesional, abajo a la derecha.
  saltoSiHaceFalta(150);
  y = Math.max(y + 24, ALTO - MARGEN - 150);
  const xFirma = ANCHO - MARGEN - 220;
  if (args.firmaUrl) {
    const dataUrl = await imagenComoDataUrl(args.firmaUrl);
    if (dataUrl) {
      try {
        doc.addImage(dataUrl, "PNG", xFirma + 30, y, 160, 56);
      } catch {
        // Firma ilegible: queda la línea para firmar a mano.
      }
    }
  }
  y += 62;
  doc.setDrawColor(120);
  doc.line(xFirma, y, xFirma + 220, y);
  y += 14;
  for (const linea of c.profesional) texto(linea, { size: 9, x: xFirma, espacio: 0 });
  if (!args.firmaUrl) texto("Firma y timbre", { size: 8, gris: true, x: xFirma, espacio: 0 });

  // Pie con código de verificación en cada página.
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(140);
    doc.text(`${c.pie} · Página ${i} de ${paginas}`, MARGEN, ALTO - 24);
  }

  const folio = folioReceta(args.receta.year, args.receta.number).replace(/[^0-9-]/g, "");
  doc.save(`receta-${folio}.pdf`);
}
