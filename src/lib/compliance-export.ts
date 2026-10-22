import {
  AUDIT_LABELS,
  REVIEW_ACTION_LABELS,
  formatoFechaHora,
} from "@/lib/clinical/clinical-notes";
import type { ComplianceEvent } from "@/lib/compliance.functions";

export interface ExportContexto {
  clinicaNombre: string;
  desde: string;
  hasta: string;
  /** Filtro de origen aplicado. */
  origen: "all" | "audit" | "review";
  pacienteRef?: string;
}

export const ORIGEN_LABELS: Record<ExportContexto["origen"], string> = {
  all: "Auditoría y revisión",
  audit: "Solo auditoría",
  review: "Solo revisión",
};

/** Etiqueta legible de la acción según el origen del evento. */
export function etiquetaAccion(evento: ComplianceEvent): string {
  if (evento.source === "review") {
    return (
      REVIEW_ACTION_LABELS[evento.action as keyof typeof REVIEW_ACTION_LABELS] ?? evento.action
    );
  }
  return AUDIT_LABELS[evento.action] ?? evento.action;
}

function nombreArchivo(ctx: ExportContexto, ext: string) {
  const slug = ctx.clinicaNombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();
  return `compliance-${slug}-${ctx.desde}-${ctx.hasta}.${ext}`;
}

function campo(valor: string | number | null): string {
  const s = valor === null || valor === undefined ? "" : String(valor);
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

/** Descarga el historial filtrado como CSV (UTF-8 con BOM para Excel). */
export function exportarComplianceCsv(eventos: ComplianceEvent[], ctx: ExportContexto) {
  const encabezado = [
    "fecha_hora",
    "origen",
    "paciente",
    "paciente_ref",
    "nota",
    "version",
    "accion",
    "detalle",
    "responsable",
    "revisor",
  ];
  const filas = eventos.map((e) =>
    [
      campo(formatoFechaHora(e.createdAt)),
      campo(e.source === "review" ? "Revisión" : "Auditoría"),
      campo(e.patientName),
      campo(e.patientRef),
      campo(e.noteTitle),
      campo(e.noteVersion),
      campo(etiquetaAccion(e)),
      campo(e.detail),
      campo(e.actorName),
      campo(e.reviewerName),
    ].join(","),
  );
  const csv = `\uFEFF${[encabezado.join(","), ...filas].join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo(ctx, "csv");
  a.click();
  URL.revokeObjectURL(url);
}

const MARGEN = 40;
const ANCHO = 841.89; // A4 apaisado
const ALTO = 595.28;

/**
 * Descarga el historial filtrado como PDF apaisado con tabla de eventos.
 * jsPDF se carga recién acá — mismo criterio que exportarNotaPdf en
 * note-pdf.ts (auditoría de deuda técnica, 30-ago).
 */
export async function exportarCompliancePdf(
  eventos: ComplianceEvent[],
  ctx: ExportContexto,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const cols = [
    { titulo: "Fecha", ancho: 108 },
    { titulo: "Origen", ancho: 60 },
    { titulo: "Paciente", ancho: 78 },
    { titulo: "Nota", ancho: 130 },
    { titulo: "Acción", ancho: 130 },
    { titulo: "Detalle", ancho: 180 },
    { titulo: "Responsable", ancho: 76 },
    { titulo: "Revisor", ancho: 0 },
  ];
  const util = ANCHO - MARGEN * 2;
  cols[cols.length - 1].ancho = util - cols.reduce((s, c) => s + c.ancho, 0);

  let y = MARGEN;

  const encabezadoTabla = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(110);
    let x = MARGEN;
    for (const c of cols) {
      doc.text(c.titulo.toUpperCase(), x, y);
      x += c.ancho;
    }
    y += 6;
    doc.setDrawColor(215);
    doc.line(MARGEN, y, ANCHO - MARGEN, y);
    y += 12;
  };

  // Portada / encabezado
  doc.setFillColor(13, 148, 136);
  doc.rect(0, 0, ANCHO, 6, "F");
  y = MARGEN + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(25);
  doc.text(ctx.clinicaNombre, MARGEN, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`Historial de auditoría y revisión clínica · ${ORIGEN_LABELS[ctx.origen]}`, MARGEN, y);
  y += 13;
  doc.text(
    `Rango: ${ctx.desde} a ${ctx.hasta}${ctx.pacienteRef ? ` · Paciente: ${ctx.pacienteRef}` : ""} · ${
      eventos.length
    } eventos · Exportado: ${formatoFechaHora(new Date().toISOString())}`,
    MARGEN,
    y,
  );
  y += 22;
  encabezadoTabla();

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  for (const e of eventos) {
    const valores = [
      formatoFechaHora(e.createdAt),
      e.source === "review" ? "Revisión" : "Auditoría",
      e.patientName ?? e.patientRef,
      `${e.noteTitle ?? "—"}${e.noteVersion ? ` (v${e.noteVersion})` : ""}`,
      etiquetaAccion(e),
      e.detail ?? "—",
      e.actorName ?? "—",
      e.reviewerName ?? "—",
    ];
    const lineas = valores.map((v, i) => doc.splitTextToSize(v, cols[i].ancho - 8) as string[]);
    const alto = Math.max(...lineas.map((l) => l.length)) * 10 + 6;

    if (y + alto > ALTO - MARGEN) {
      doc.addPage();
      y = MARGEN;
      encabezadoTabla();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
    }

    let x = MARGEN;
    doc.setTextColor(25);
    lineas.forEach((l, i) => {
      doc.text(l, x, y);
      x += cols[i].ancho;
    });
    y += alto;
    doc.setDrawColor(235);
    doc.line(MARGEN, y - 5, ANCHO - MARGEN, y - 5);
  }

  if (!eventos.length) {
    doc.setTextColor(110);
    doc.text("Sin eventos en el rango seleccionado.", MARGEN, y);
  }

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`${ctx.clinicaNombre} · documento confidencial de auditoría`, MARGEN, ALTO - 22);
    doc.text(`Página ${i} de ${total}`, ANCHO - MARGEN, ALTO - 22, { align: "right" });
  }

  doc.save(nombreArchivo(ctx, "pdf"));
}
