/**
 * Dibuja en PDF la ficha armada por `ficha-paciente.ts`, con la misma
 * diagramación que la nota clínica y la receta (`pdf-lienzo.ts`).
 *
 * jsPDF se carga recién acá y una sola vez por exportación, aunque se
 * generen miles de fichas (mismo criterio que note-pdf.ts: no sumar ~600 KB
 * a pantallas que no exportan).
 */
import { ALTO, ANCHO, MARGEN, crearLienzo } from "@/lib/clinical/pdf-lienzo";
import type { ContenidoFicha, LineaFicha } from "@/lib/exportacion/ficha-paciente";

let jspdf: Promise<typeof import("jspdf")> | null = null;

const SANGRIA = 14;

function opcionesDeLinea(l: LineaFicha) {
  return {
    size: l.estilo === "gris" ? 9 : 10,
    bold: l.estilo === "negrita" || l.estilo === "alerta",
    gris: l.estilo === "gris",
    rojo: l.estilo === "alerta",
    espacio: 2,
    x: l.sangria ? MARGEN + SANGRIA : MARGEN,
  };
}

export async function generarPdfFicha(contenido: ContenidoFicha): Promise<Uint8Array> {
  jspdf ??= import("jspdf");
  const { jsPDF } = await jspdf;
  // Comprimido: con miles de fichas en un ZIP, el tamaño importa.
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const lienzo = crearLienzo(doc);
  const { texto, titulo } = lienzo;

  lienzo.franjaSuperior();
  texto(contenido.clinicaNombre, { size: 16, bold: true, espacio: 2 });
  texto(contenido.subtitulo ?? "Ficha clínica del paciente", { size: 9, gris: true, espacio: 10 });
  texto(contenido.pacienteNombre, { size: 13, bold: true, espacio: 2 });
  for (const linea of contenido.encabezado) texto(linea, { size: 9, gris: true, espacio: 1 });

  for (const seccion of contenido.secciones) {
    titulo(seccion.titulo);
    for (const linea of seccion.lineas) {
      if (!linea.texto) continue;
      // Un título en negrita no queda solo al pie de la hoja.
      if (linea.estilo === "negrita") lienzo.saltoSiHaceFalta(40);
      texto(linea.texto, opcionesDeLinea(linea));
    }
  }

  lienzo.enCadaPagina((i, total) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(contenido.pie, MARGEN, ALTO - 26);
    doc.text(`Página ${i} de ${total}`, ANCHO - MARGEN, ALTO - 26, { align: "right" });
  });

  return new Uint8Array(doc.output("arraybuffer"));
}
