/**
 * Firma a distancia (Ola 5 · DOC-05): piezas de servidor compartidas por las
 * server functions del staff y de la página pública.
 */
import { getRequest } from "@tanstack/react-start/server";

import type { Database } from "@/integrations/supabase/types";
import {
  hojaDeCopiaFirmada,
  nombreDeCopiaFirmada,
  type Constancia,
} from "@/lib/firma-distancia/evidencia";
import type { CanalDelLink, Firmante } from "@/lib/firma-distancia/estado";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit.server";

export const BUCKET_DOCUMENTOS = "clinical-documents";
export const BUCKET_FIRMAS_PROFESIONALES = "professional-signatures";

type Solicitud = Database["public"]["Tables"]["patient_signature_requests"]["Row"];

/** IP y navegador de quien llama (la evidencia de la firma). */
export function ipYNavegador(): { ip: string | null; ua: string | null } {
  const req = getRequest();
  if (!req) return { ip: null, ua: null };
  const ip = clientIpFromRequest(req);
  return {
    ip: ip === "unknown" ? null : ip.slice(0, 64),
    ua: req.headers.get("user-agent")?.slice(0, 400) ?? null,
  };
}

/**
 * Límite por IP en memoria para la página pública (además del de la base).
 * 30 llamadas por minuto alcanzan de sobra para una persona firmando.
 */
export function exigirLimiteDeFirma(ip: string | null): void {
  const r = checkRateLimit(ip ?? "unknown", {
    scope: "firma-distancia",
    windowMs: 60_000,
    max: 30,
  });
  if (r.limited) {
    throw new Error(
      `Demasiados intentos seguidos. Espera ${r.retryAfterSeconds} segundos y vuelve a intentarlo.`,
    );
  }
}

/** Constancia de una solicitud firmada (la fila completa, leída con el rol de servicio o la RLS). */
export function constanciaDeSolicitud(
  s: Pick<
    Solicitud,
    | "id"
    | "document_sha256"
    | "signer_role"
    | "signer_name"
    | "signer_rut_sha256"
    | "signer_rut_masked"
    | "code_channel"
    | "code_recipient_masked"
    | "signed_at"
    | "signed_ip"
    | "signed_user_agent"
    | "accepted_text"
    | "signature_sha256"
    | "link_channel"
    | "signed_at_local"
    | "evidence_sha256"
    | "clinic_timezone"
  >,
  patientName: string | null,
): Constancia {
  if (!s.signed_at || !s.signer_name || !s.accepted_text || !s.evidence_sha256) {
    throw new Error("La solicitud no está firmada.");
  }
  return {
    id: s.id,
    documentSha256: s.document_sha256,
    signerRole: s.signer_role as Firmante,
    signerName: s.signer_name,
    signerRutSha256: s.signer_rut_sha256,
    signerRutMasked: s.signer_rut_masked,
    codeChannel: s.code_channel,
    codeRecipientMasked: s.code_recipient_masked,
    signedAt: s.signed_at,
    signedIp: s.signed_ip,
    signedUserAgent: s.signed_user_agent,
    acceptedText: s.accepted_text,
    signatureSha256: s.signature_sha256,
    linkChannel: s.link_channel as CanalDelLink,
    signedAtLocal: s.signed_at_local,
    evidenceSha256: s.evidence_sha256,
    patientName,
    timezone: s.clinic_timezone ?? "America/Santiago",
  };
}

/** PDF de la copia firmada (bytes, sha256 y nombre de archivo). */
export async function pdfDeCopiaFirmada(
  s: Pick<Solicitud, "sheet" | "content_blocks" | "title">,
  c: Constancia,
  imagenes: { firmaProfesionalUrl: string | null; firmaPacienteUrl: string | null },
): Promise<{ bytes: Uint8Array; sha256: string; nombre: string }> {
  const { construirHojaPdf } = await import("@/lib/documentos/pdf");
  const doc = await construirHojaPdf(
    hojaDeCopiaFirmada({ sheet: s.sheet, bloques: s.content_blocks }, c, imagenes),
  );
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return { bytes, sha256, nombre: nombreDeCopiaFirmada(s.title, c.signedAt, c.timezone) };
}

/** Bytes → base64 (para devolver el PDF al navegador en la misma respuesta). */
export function base64DeBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
