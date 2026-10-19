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
    for (const kind of ENTITY_KIND_ORDER) {
      const items = args.entidades.filter((e) => e.kind === kind);
      if (!items.length) continue;
      texto(ENTITY_KIND_LABELS[kind] ?? kind, { size: 10, bold: true, espacio: 2 });
      for (const e of items) {
        const detalles = [
          e.tooth ? `pieza ${e.tooth}` : null,
          e.code ? `código ${e.code}` : null,
          e.dosage ?? null,
          e.severity ?? null,
          e.status ?? null,
          e.confirmed ? "validado" : null,
        ]
          .filter(Boolean)
          .join(" · ");
        texto(`• ${e.term}${detalles ? ` (${detalles})` : ""}`, { size: 9, espacio: 1 });
      }
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
