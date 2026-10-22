/**
 * Envío real de email — la pieza que faltaba en la infraestructura ya
 * construida (dns-email.ts autentica el dominio, email-sandbox.ts decide el
 * destinatario). Server-only: usa RESEND_API_KEY, nunca debe importarse desde
 * código de cliente.
 *
 * Gate de sandbox UNIFICADO (2026-08-26): la decisión de destinatario ahora
 * pasa siempre por `resolveEmailRecipient` (email-sandbox.ts), con la config
 * leída de la tabla `email_sandbox_config` por el caller y pasada acá. Antes
 * había dos gates desconectados — la config de `/sandbox-email` en localStorage
 * (nunca llegaba al server) y `process.env.EMAIL_SANDBOX` (ignoraba esa
 * config). Ahora la DB es la única fuente de verdad, compartida por ambos.
 */
import { Resend } from "resend";

import {
  DEFAULT_EMAIL_SANDBOX,
  resolveEmailRecipient,
  type EmailSandboxConfig,
} from "@/lib/messaging/email-sandbox";

export type SendEmailResult =
  | { ok: true; externalId: string | null; recipient: string; redirected: boolean }
  | { ok: false; reason: string };

/**
 * Envía un email respetando la config de sandbox de la clínica. Si el gate
 * resuelve `block`, no llama a Resend. Si resuelve `redirect`, manda a la
 * dirección de pruebas con el asunto prefijado. Solo `send` en modo producción
 * (o allowlist) llega al destinatario real. `sandboxConfig` viene de la DB
 * (getEmailSandboxConfig); si no se pasa, se asume el default seguro (sandbox).
 */
export async function sendEmail(
  params: {
    to: string;
    subject: string;
    html: string;
    /** Texto plano alternativo (opcional). */
    text?: string;
    /** Adjuntos: el PDF del presupuesto o de un documento (Ola 4). */
    attachments?: { filename: string; content: Uint8Array }[];
    /** Responder a (el correo de la clínica, si lo tiene). */
    replyTo?: string;
  },
  sandboxConfig: EmailSandboxConfig = DEFAULT_EMAIL_SANDBOX,
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return {
      ok: false,
      reason:
        "Envío de email no configurado todavía (falta RESEND_API_KEY o EMAIL_FROM en el servidor).",
    };
  }

  const decision = resolveEmailRecipient(params.to, sandboxConfig);
  if (decision.action === "block") {
    return { ok: false, reason: decision.reason };
  }

  const recipient = decision.recipient;
  const subject = `${decision.subjectPrefix}${params.subject}`;
  const redirected = decision.action === "redirect";

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: recipient,
    subject,
    html: params.html,
    ...(params.text ? { text: params.text } : {}),
    ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    ...(params.attachments?.length
      ? {
          attachments: params.attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.content),
          })),
        }
      : {}),
  });

  if (error) {
    return { ok: false, reason: error.message };
  }

  return { ok: true, externalId: data?.id ?? null, recipient, redirected };
}
