/**
 * Segundo paso por correo (SEG-01): piezas de servidor. Server-only (usa
 * RESEND_API_KEY y el rol de servicio).
 *
 * El código va SIEMPRE al correo de la cuenta y por Resend directo, sin el
 * modo de prueba de la clínica (`email_sandbox_config`) ni
 * `LIFECYCLE_EMAIL_REDIRECT_TO`: esos redirigen correos a otra dirección, y
 * un código de acceso redirigido se lo entrega a otra persona. Es un correo
 * de autenticación, como los que manda Supabase (confirmar cuenta,
 * recuperar contraseña), que tampoco pasan por esa configuración.
 *
 * Nunca se loguea el código.
 */
import { getRequest } from "@tanstack/react-start/server";
import { Resend } from "resend";

import { correoCodigoMfa } from "@/lib/auth/mfa-correo";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit.server";

type ClienteAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

export function envioDeCorreoConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** IP y navegador de quien llama (bitácora). */
export function ipYNavegadorMfa(): { ip: string; ua: string } {
  const req = getRequest();
  if (!req) return { ip: "", ua: "" };
  const ip = clientIpFromRequest(req);
  return {
    ip: ip === "unknown" ? "" : ip.slice(0, 64),
    ua: req.headers.get("user-agent")?.slice(0, 400) ?? "",
  };
}

/** Límite por IP en memoria, además de los de la base (por usuario). */
export function exigirLimiteMfaCorreo(ip: string, accion: "enviar" | "verificar"): void {
  const r = checkRateLimit(ip || "unknown", {
    scope: `mfa-correo-${accion}`,
    windowMs: 60_000,
    max: accion === "enviar" ? 6 : 20,
  });
  if (r.limited) {
    throw new Error(
      `Demasiados intentos seguidos. Espera ${r.retryAfterSeconds} segundos y vuelve a intentarlo.`,
    );
  }
}

export async function enviarCorreoConCodigo(d: {
  to: string;
  codigo: string;
  proposito: "login" | "activar";
  appUrl: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { ok: false, reason: "envío no configurado" };
  const correo = correoCodigoMfa({ appUrl: d.appUrl, codigo: d.codigo, proposito: d.proposito });
  try {
    const { error } = await new Resend(apiKey).emails.send({
      from,
      to: d.to,
      subject: correo.subject,
      html: correo.html,
      text: correo.text,
    });
    return error ? { ok: false, reason: error.message.slice(0, 300) } : { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 300) : "error" };
  }
}

/** Evento de la bitácora que no escribe ninguna función de la base. */
export async function registrarEventoMfaCorreo(
  admin: ClienteAdmin,
  e: {
    userId: string;
    sessionId: string | null;
    event: "envio_fallido" | "correo_desactivado" | "metodo_preferido" | "totp_autorizado";
    detail?: string | null;
    ip: string;
    ua: string;
  },
): Promise<void> {
  const { error } = await admin.from("mfa_email_events").insert({
    user_id: e.userId,
    session_id: e.sessionId,
    event: e.event,
    detail: e.detail ?? null,
    ip: e.ip || null,
    user_agent: e.ua || null,
  });
  if (error) console.error("[mfa-correo] no se pudo registrar el evento:", e.event, error.message);
}
