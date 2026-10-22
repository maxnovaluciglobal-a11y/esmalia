/**
 * Firma a distancia (Ola 5 · DOC-05): la evidencia de la firma y la copia
 * firmada. Lógica pura.
 *
 * Huella de la evidencia: la calcula la BASE al firmar
 * (`firma_remota_huella_evidencia`, migración 20261026100100) sobre lo que
 * quedó guardado:
 *
 *   sha256( id ␟ huella del documento ␟ rol ␟ nombre ␟ huella del RUT ␟
 *           RUT enmascarado ␟ canal del código ␟ correo enmascarado ␟
 *           fecha UTC (ISO con milisegundos) ␟ IP ␟ user-agent ␟
 *           declaración aceptada ␟ huella de la imagen de la firma )
 *
 * (␟ = U+001F; un dato ausente cuenta como texto vacío). `huellaDeEvidencia`
 * es el par exacto: la ficha la recalcula para mostrar "Evidencia íntegra" y
 * `tests/firma-distancia-db.test.ts` compara las dos.
 */
import { z } from "zod";

import { leerBloques } from "@/lib/documentos/esquemas";
import { huellaCorta } from "@/lib/documentos/huella";
import type { HojaParaPdf } from "@/lib/documentos/pdf";
import type { Bloque } from "@/lib/documentos/tipos";
import { diaISO, fechaHora } from "@/lib/formato-fecha";
import { sha256Hex } from "@/lib/firma-distancia/token";
import { ETIQUETA_CANAL, type CanalDelLink, type Firmante } from "@/lib/firma-distancia/estado";

const SEPARADOR = "\u001f";

export interface DatosDeEvidencia {
  id: string;
  documentSha256: string;
  signerRole: Firmante;
  signerName: string;
  signerRutSha256: string | null;
  signerRutMasked: string | null;
  codeChannel: string;
  codeRecipientMasked: string | null;
  /** Fecha de la firma tal como la devuelve la base (cualquier ISO). */
  signedAt: string;
  signedIp: string | null;
  signedUserAgent: string | null;
  acceptedText: string;
  signatureSha256: string | null;
}

/** "2026-10-22T18:04:05.123+00:00" → "2026-10-22T18:04:05.123Z" (la base firma con milisegundos). */
export function fechaUtcDeEvidencia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("Fecha de la firma inválida.");
  return d.toISOString();
}

export function entradaDeEvidencia(e: DatosDeEvidencia): string {
  return [
    e.id,
    e.documentSha256,
    e.signerRole,
    e.signerName,
    e.signerRutSha256 ?? "",
    e.signerRutMasked ?? "",
    e.codeChannel,
    e.codeRecipientMasked ?? "",
    fechaUtcDeEvidencia(e.signedAt),
    e.signedIp ?? "",
    e.signedUserAgent ?? "",
    e.acceptedText,
    e.signatureSha256 ?? "",
  ].join(SEPARADOR);
}

export function huellaDeEvidencia(e: DatosDeEvidencia): Promise<string> {
  return sha256Hex(entradaDeEvidencia(e));
}

// ─── Hoja guardada en la solicitud ───────────────────────────────────────────

/** Encabezado y pie de la hoja (sin imágenes): lo que se guarda en `sheet`. */
export const HojaGuardadaSchema = z.object({
  clinicName: z.string().max(200),
  lineasEncabezado: z.array(z.string().max(300)).max(6),
  referencia: z.string().max(300),
  pie: z.string().max(300),
});
export type HojaGuardada = z.infer<typeof HojaGuardadaSchema>;

export function leerHojaGuardada(valor: unknown): HojaGuardada | null {
  const r = HojaGuardadaSchema.safeParse(valor);
  return r.success ? r.data : null;
}

// ─── Constancia de firma (va en la copia firmada y en la ficha) ──────────────

export interface Constancia extends DatosDeEvidencia {
  linkChannel: CanalDelLink;
  signedAtLocal: string | null;
  evidenceSha256: string;
  /** Para el tutor: el nombre del paciente por quien firma. */
  patientName: string | null;
  timezone: string;
}

export function etiquetaFirmante(c: Pick<Constancia, "signerRole" | "patientName">): string {
  return c.signerRole === "tutor"
    ? `Tutor o representante legal${c.patientName ? ` de ${c.patientName}` : ""}`
    : "Paciente";
}

/** Filas de la constancia (etiqueta, valor), en el orden en que se muestran. */
export function filasDeConstancia(c: Constancia): [string, string][] {
  return [
    ["Firmó", c.signerName],
    ["En calidad de", etiquetaFirmante(c)],
    ["RUT verificado", c.signerRutMasked ?? "Sin dato"],
    ["Fecha y hora (clínica)", c.signedAtLocal ?? fechaHora(c.signedAt, c.timezone)],
    ["Fecha y hora (UTC)", fechaUtcDeEvidencia(c.signedAt)],
    ["Código de un solo uso enviado a", c.codeRecipientMasked ?? "Sin dato"],
    ["Link enviado por", ETIQUETA_CANAL[c.linkChannel] ?? c.linkChannel],
    ["Dirección IP", c.signedIp ?? "Sin dato"],
    ["Dispositivo", (c.signedUserAgent ?? "Sin dato").slice(0, 300)],
    ["Declaración aceptada", c.acceptedText],
    ["Huella SHA-256 del documento", c.documentSha256],
    ["Huella SHA-256 de la firma manuscrita", c.signatureSha256 ?? "Sin firma manuscrita"],
    ["Huella SHA-256 de la evidencia", c.evidenceSha256],
    ["Solicitud", c.id],
  ];
}

/** Bloques de la constancia que se agregan al final de la copia firmada. */
export function bloquesDeConstancia(c: Constancia): Bloque[] {
  return [
    {
      tipo: "titulo",
      nivel: 2,
      tramos: [{ tipo: "texto", texto: "Constancia de firma electrónica simple" }],
    },
    {
      tipo: "parrafo",
      tramos: [
        {
          tipo: "texto",
          texto:
            `Firmado a distancia por ${c.signerName} (${etiquetaFirmante(c).toLowerCase()}) con firma electrónica simple (Ley 19.799). ` +
            "Su identidad se confirmó con su RUT, comparado con la ficha de la clínica, y con un código de un solo uso enviado a su correo. " +
            "Las huellas SHA-256 permiten comprobar que ni el documento ni esta constancia cambiaron después de la firma.",
        },
      ],
    },
    {
      tipo: "tabla",
      columnas: [
        { titulo: "Dato", alineacion: "izquierda", peso: 1.2 },
        { titulo: "Valor", alineacion: "izquierda", peso: 3 },
      ],
      filas: filasDeConstancia(c).map(([k, v]) => [k, v]),
    },
  ];
}

/** Pie de cada página de la copia firmada. */
export function pieDeCopiaFirmada(referencia: string, evidenceSha256: string): string {
  return `${referencia} · Firmado por el paciente · Evidencia SHA-256 ${huellaCorta(evidenceSha256, 24)} · Firma simple (Ley 19.799)`;
}

/** "copia-firmada-consentimiento-2026-10-22.pdf" */
export function nombreDeCopiaFirmada(titulo: string, signedAt: string, zona: string): string {
  const dia = diaISO(signedAt, zona) ?? "sin-fecha";
  const base = `copia-firmada-${titulo}-${dia}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
  return `${base}.pdf`;
}

/**
 * Hoja de la copia firmada: el documento tal como lo vio el paciente, más
 * la constancia de firma y la firma manuscrita (si hay). La arma el servidor
 * al firmar (y la guarda) y, si esa copia faltara, el navegador de la clínica.
 */
export function hojaDeCopiaFirmada(
  s: { sheet: unknown; bloques: unknown },
  c: Constancia,
  imagenes: { firmaProfesionalUrl: string | null; firmaPacienteUrl: string | null },
): HojaParaPdf {
  const hoja = leerHojaGuardada(s.sheet);
  const bloques = leerBloques(s.bloques);
  if (!hoja || !bloques) throw new Error("El documento guardado no tiene la forma esperada.");
  return {
    clinicName: hoja.clinicName,
    lineasEncabezado: hoja.lineasEncabezado,
    referencia: hoja.referencia,
    aviso: null,
    bloques,
    bloquesFinales: bloquesDeConstancia(c),
    signatureUrl: imagenes.firmaProfesionalUrl,
    pie: pieDeCopiaFirmada(hoja.referencia, c.evidenceSha256),
    firmaPaciente: {
      url: imagenes.firmaPacienteUrl,
      nombre: c.signerName,
      detalle:
        c.signerRole === "tutor"
          ? `Tutor o representante legal · RUT ${c.signerRutMasked ?? "sin dato"}`
          : `Paciente · RUT ${c.signerRutMasked ?? "sin dato"}`,
    },
  };
}
