import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { bloqueDeFirma, renderPlantilla } from "@/lib/documentos/motor";
import {
  construirDocumentoPdf,
  nombreDeArchivoPdf,
  type DocumentoParaPdf,
} from "@/lib/documentos/pdf";
import { contextoDeEjemplo } from "@/lib/documentos/variables";

/**
 * PDF de los documentos (DOC-01): se arma con jsPDF (también corre en Node,
 * sin navegador), recorriendo los mismos bloques que la pantalla. Este test
 * arma el PDF de tres plantillas base (certificado, informe y el formulario
 * de reembolso con su tabla) y uno anulado. Con `DOCUMENTOS_PDF_DIR` deja los
 * archivos en esa carpeta para revisarlos a ojo.
 */

const SQL = readFileSync(
  new URL(
    "../supabase/migrations/20261025100100_plantillas_de_documentos_base.sql",
    import.meta.url,
  ),
  "utf8",
);

function cuerpo(seedKey: string): string {
  const re = new RegExp(`'${seedKey}',[\\s\\S]*?\\$t\\$([\\s\\S]*?)\\$t\\$`);
  const m = re.exec(SQL);
  if (!m) throw new Error(`No está la plantilla ${seedKey}`);
  return m[1];
}

function documento(seedKey: string, extra: Partial<DocumentoParaPdf> = {}): DocumentoParaPdf {
  const r = renderPlantilla(cuerpo(seedKey), contextoDeEjemplo(), {
    firma: bloqueDeFirma({
      nombre: "Dra. Carolina Rodríguez",
      registroSis: "123456",
      especialidad: "Endodoncia",
    }),
  });
  return {
    title: seedKey,
    year: 2026,
    number: 7,
    issuedAt: "2026-10-22T15:00:00Z",
    timezone: "America/Santiago",
    clinicName: "Clínica Dental Sonrisa",
    clinicLegalName: "Sonrisa Dental SpA",
    clinicTaxId: "76.123.456-0",
    clinicAddress: "Av. Providencia 1234, Santiago",
    clinicPhone: "+56 2 2345 6789",
    bloques: r.bloques,
    contentSha256: "a".repeat(64),
    voidedAt: null,
    voidReason: null,
    signatureUrl: null,
    ...extra,
  };
}

async function generar(nombre: string, d: DocumentoParaPdf) {
  const pdf = await construirDocumentoPdf(d);
  const bytes = pdf.output("arraybuffer");
  const dir = process.env.DOCUMENTOS_PDF_DIR;
  if (dir) writeFileSync(path.join(dir, `${nombre}.pdf`), Buffer.from(bytes));
  return { pdf, texto: pdf.output() };
}

describe("PDF de documentos", () => {
  it.each(["certificado-atencion", "informe", "reembolso-seguro"])(
    "%s: arma un PDF A4 con folio, firma y huella en el pie",
    async (seedKey) => {
      const { pdf, texto } = await generar(seedKey, documento(seedKey));
      expect(texto.startsWith("%PDF-")).toBe(true);
      expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(1);
      // jsPDF codifica los caracteres no ASCII: se buscan trozos ASCII.
      expect(texto).toContain("2026-0007");
      expect(texto).toContain("Registro Superintendencia de Salud");
      expect(texto).toContain("Firma simple \\(Ley 19.799\\)");
    },
  );

  it("el formulario de reembolso imprime la tabla con sus totales", async () => {
    const { texto } = await generar("reembolso-tabla", documento("reembolso-seguro"));
    expect(texto).toContain("Fonasa");
    expect(texto).toContain("2701004");
    expect(texto).toContain("Monto pagado");
    expect(texto).toContain("Total pagado");
  });

  it("un documento anulado lo dice arriba, con el motivo", async () => {
    const { texto } = await generar(
      "anulado",
      documento("reposo", { voidedAt: "2026-10-22T18:00:00Z", voidReason: "Fecha equivocada" }),
    );
    expect(texto).toContain("DOCUMENTO ANULADO");
    expect(texto).toContain("Motivo: Fecha equivocada");
  });

  it("nombre de archivo sin tildes ni espacios", () => {
    expect(nombreDeArchivoPdf({ title: "Certificado de atención", year: 2026, number: 7 })).toBe(
      "certificado-de-atencion-2026-0007.pdf",
    );
  });
});
