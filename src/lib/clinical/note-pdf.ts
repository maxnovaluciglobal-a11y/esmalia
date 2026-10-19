import {
  AUDIT_LABELS,
  ENTITY_KIND_LABELS,
  ENTITY_KIND_ORDER,
  formatoFechaHora,
  lineaDeFirma,
  type ClinicalNote,
  type ClinicalNoteAuditEntry,
  type ClinicalNoteEntity,
  type ClinicalNoteVersion,
} from "@/lib/clinical/clinical-notes";
import { ALTO, ANCHO, MARGEN, crearLienzo } from "@/lib/clinical/pdf-lienzo";

interface ExportArgs {
  clinicaNombre: string;
  pacienteNombre: string;
  pacienteDocumento: string;
  nota: ClinicalNote;
  versiones: ClinicalNoteVersion[];
  auditoria: ClinicalNoteAuditEntry[];
  entidades: ClinicalNoteEntity[];
  /** CLI-07: adendas de esta nota (se imprimen después del contenido). */
  adendas?: ClinicalNote[];
  /** CLI-07: si la nota exportada es una adenda, la nota que corrige. */
  notaOriginal?: ClinicalNote | null;
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
  const lienzo = crearLienzo(doc);
  const { texto, titulo } = lienzo;

  // Encabezado
  lienzo.franjaSuperior();
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
  if (args.notaOriginal) {
    texto(`Adenda a la nota «${args.notaOriginal.title}»`, { size: 9, gris: true, espacio: 1 });
  }
  texto(`Exportada: ${formatoFechaHora(new Date().toISOString())}`, { size: 9, gris: true });

  // Contenido
  titulo("Contenido de la nota");
  texto(args.nota.content || "Sin contenido registrado.", { size: 10, espacio: 6 });

  // Firma (CLI-08): nombre completo, registro profesional y fecha, tal como
  // quedaron al firmar.
  const firma = lineaDeFirma(args.nota);
  titulo("Firma");
  texto(firma ?? "Borrador sin firmar.", { size: 10, espacio: 6 });

  // Adendas (CLI-07): la nota firmada no cambia; las correcciones van acá.
  if (args.adendas?.length) {
    titulo("Adendas");
    for (const a of args.adendas) {
      texto(`${a.title} · creada ${formatoFechaHora(a.createdAt)}`, {
        size: 10,
        bold: true,
        espacio: 1,
      });
      texto(a.content || "Sin contenido registrado.", { size: 10, espacio: 1 });
      texto(lineaDeFirma(a) ?? "Adenda en borrador, sin firmar.", {
        size: 9,
        gris: true,
        espacio: 6,
      });
    }
  }

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
      lienzo.y += 4;
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
  lienzo.enCadaPagina((i, total) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(
      `${args.clinicaNombre} · ${args.pacienteNombre} · documento confidencial`,
      MARGEN,
      ALTO - 26,
    );
    doc.text(`Página ${i} de ${total}`, ANCHO - MARGEN, ALTO - 26, { align: "right" });
  });

  const slug = args.pacienteNombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();
  doc.save(`nota-clinica-${slug}-v${args.nota.version}.pdf`);
}
