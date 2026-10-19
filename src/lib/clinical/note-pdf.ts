import {
  AUDIT_LABELS,
  ENTITY_KIND_LABELS,
  ENTITY_KIND_ORDER,
  formatoFechaHora,
  type ClinicalNote,
  type ClinicalNoteAuditEntry,
  type ClinicalNoteEntity,
  type ClinicalNoteVersion,
} from "@/lib/clinical/clinical-notes";

interface ExportArgs {
  clinicaNombre: string;
  pacienteNombre: string;
  pacienteDocumento: string;
  nota: ClinicalNote;
  versiones: ClinicalNoteVersion[];
  auditoria: ClinicalNoteAuditEntry[];
  entidades: ClinicalNoteEntity[];
}

/** Rótulo de una entidad que extrajo la IA y nadie validó (auditoría 360, IA-04). */
export const ROTULO_IA_SIN_VALIDAR = "Sugerido por IA, sin validar";

export function esSugerenciaIaSinValidar(e: Pick<ClinicalNoteEntity, "aiGenerated" | "confirmed">) {
  return e.aiGenerated && !e.confirmed;
}

/** Línea del PDF para una entidad: término + detalles + estado de validación. */
export function lineaEntidadPdf(e: ClinicalNoteEntity): string {
  const detalles = [
    e.tooth ? `pieza ${e.tooth}` : null,
    e.code ? `código ${e.code}` : null,
    e.dosage ?? null,
    e.severity ?? null,
    e.status ?? null,
    e.confirmed ? "validado" : esSugerenciaIaSinValidar(e) ? ROTULO_IA_SIN_VALIDAR : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `• ${e.term}${detalles ? ` (${detalles})` : ""}`;
}

const MARGEN = 48;
const ANCHO = 595.28; // A4 pt
const ALTO = 841.89;
const UTIL = ANCHO - MARGEN * 2;

/**
 * Genera y descarga un PDF con la nota, sus versiones y la auditoría.
 * jsPDF (+ html2canvas/canvg, que trae adentro) se carga recién acá —
 * antes era un import estático que sumaba ~600KB al chunk de la ficha del
 * paciente en TODA visita, aunque nadie exportara nunca un PDF (auditoría
 * de deuda técnica, 30-ago).
 */
export async function exportarNotaPdf(args: ExportArgs): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = MARGEN;

  const saltoSiHaceFalta = (alto: number) => {
    if (y + alto <= ALTO - MARGEN) return;
    doc.addPage();
    y = MARGEN;
  };

  const texto = (
    contenido: string,
    opts: { size?: number; bold?: boolean; gris?: boolean; espacio?: number } = {},
  ) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(opts.gris ? 110 : 25);
    const lineas = doc.splitTextToSize(contenido, UTIL) as string[];
    const altoLinea = (opts.size ?? 10) * 1.35;
    for (const linea of lineas) {
      saltoSiHaceFalta(altoLinea);
      doc.text(linea, MARGEN, y);
      y += altoLinea;
    }
    y += opts.espacio ?? 4;
  };

  const titulo = (t: string) => {
    saltoSiHaceFalta(34);
    y += 8;
    doc.setDrawColor(215);
    doc.line(MARGEN, y - 6, ANCHO - MARGEN, y - 6);
    texto(t.toUpperCase(), { size: 9, bold: true, gris: true, espacio: 6 });
  };

  // Encabezado
  doc.setFillColor(13, 148, 136);
  doc.rect(0, 0, ANCHO, 6, "F");
  y = MARGEN + 6;
  texto(args.clinicaNombre, { size: 16, bold: true, espacio: 2 });
  texto("Nota clínica · documento oficial con trazabilidad", { size: 9, gris: true, espacio: 10 });

  texto(`Paciente: ${args.pacienteNombre}`, { size: 11, bold: true, espacio: 1 });
  texto(`Documento: ${args.pacienteDocumento}`, { size: 9, gris: true, espacio: 1 });
  texto(
    `Nota: ${args.nota.title} · v${args.nota.version} · ${
      args.nota.status === "signed" ? "Firmada" : "Borrador"
    }`,
    { size: 9, gris: true, espacio: 1 },
  );
  texto(
    `Creada: ${formatoFechaHora(args.nota.createdAt)} · Última actualización: ${formatoFechaHora(
      args.nota.updatedAt,
    )}`,
    { size: 9, gris: true, espacio: 1 },
  );
  texto(`Exportada: ${formatoFechaHora(new Date().toISOString())}`, { size: 9, gris: true });

  // Contenido
  titulo("Contenido de la nota");
  texto(args.nota.content || "Sin contenido registrado.", { size: 10, espacio: 6 });

  if (args.nota.summary) {
    titulo("Resumen");
    texto(args.nota.summary, { size: 10, espacio: 6 });
  }

  // Campos estructurados
  if (args.entidades.length) {
    titulo("Historia clínica estructurada");
    if (args.entidades.some(esSugerenciaIaSinValidar)) {
      texto(
        `Los campos marcados "${ROTULO_IA_SIN_VALIDAR}" los propuso Patty (IA) y el profesional todavía no los confirmó: no son dato clínico registrado.`,
        { size: 8, gris: true, espacio: 4 },
      );
    }
    for (const kind of ENTITY_KIND_ORDER) {
      const items = args.entidades.filter((e) => e.kind === kind);
      if (!items.length) continue;
      texto(ENTITY_KIND_LABELS[kind] ?? kind, { size: 10, bold: true, espacio: 2 });
      for (const e of items) texto(lineaEntidadPdf(e), { size: 9, espacio: 1 });
      y += 4;
    }
  }

  // Versiones
  titulo("Historial de versiones");
  if (!args.versiones.length) {
    texto("Sin versiones registradas.", { size: 9, gris: true });
  } else {
    for (const v of args.versiones) {
      texto(
        `v${v.version} · ${formatoFechaHora(v.createdAt)} · ${v.authorName ?? "Usuario"}${
          v.aiAssisted ? ` · asistido por IA${v.aiAction ? ` (${v.aiAction})` : ""}` : ""
        }`,
        { size: 9, bold: true, espacio: 1 },
      );
      texto(v.title, { size: 9, gris: true, espacio: 6 });
    }
  }

  // Auditoría
  titulo("Registro de auditoría");
  if (!args.auditoria.length) {
    texto("Sin eventos registrados.", { size: 9, gris: true });
  } else {
    for (const a of args.auditoria) {
      texto(
        `${formatoFechaHora(a.createdAt)} · ${AUDIT_LABELS[a.action] ?? a.action} · ${
          a.actorName ?? "Usuario"
        }${a.detail ? ` · ${a.detail}` : ""}`,
        { size: 9, espacio: 1 },
      );
    }
  }

  // Pie de página en todas las hojas
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(
      `${args.clinicaNombre} · ${args.pacienteNombre} · documento confidencial`,
      MARGEN,
      ALTO - 26,
    );
    doc.text(`Página ${i} de ${total}`, ANCHO - MARGEN, ALTO - 26, { align: "right" });
  }

  const slug = args.pacienteNombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();
  doc.save(`nota-clinica-${slug}-v${args.nota.version}.pdf`);
}
