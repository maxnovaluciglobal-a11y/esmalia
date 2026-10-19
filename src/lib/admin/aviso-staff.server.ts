// src/lib/admin/aviso-staff.server.ts
//
// Aviso por correo al equipo de Esmalia (`ESMALIA_STAFF_EMAILS`) desde el
// webhook de Stripe: disputas y suscripciones duplicadas (auditoría 360 del
// 18-oct-2026, BIL-01/02/03). Es para Walter, no para una clínica: no pasa por
// `lifecycle_emails` (que es por clínica y destinatario) ni por el gate de
// sandbox de pacientes.
//
// Idempotencia: Resend deduplica por `idempotencyKey` durante 24 h. El
// webhook ya deduplica por `event.id`; esto cubre el reintento de un mismo
// evento después de un 500 y el mismo hecho visto por dos eventos (por
// ejemplo, `checkout.session.completed` y `customer.subscription.created`).
//
// Nunca lanza.
import { Resend } from "resend";

import { listaDeStaff } from "@/lib/auth/mfa";
import { escapeHtml } from "@/lib/email/layout";

export interface CorreoStaff {
  asunto: string;
  lineas: string[];
  clave: string;
  /** Nombre de la clínica, si se conoce, para el asunto. */
  clinica?: string | null;
  /** Link a la ficha de la clínica en /admin. */
  enlaceAdmin?: string | null;
}

/** Arma el correo. Puro, para testearlo sin Resend. */
export function armarCorreoStaff(c: CorreoStaff): { subject: string; html: string; text: string } {
  const subject = c.clinica ? `[Esmalia] ${c.asunto}: ${c.clinica}` : `[Esmalia] ${c.asunto}`;
  const lineas = c.enlaceAdmin ? [...c.lineas, `Clínica en /admin: ${c.enlaceAdmin}`] : c.lineas;
  const html = lineas.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n");
  return { subject, html, text: lineas.join("\n") };
}

export async function enviarAvisoStaff(
  c: CorreoStaff,
  env: NodeJS.ProcessEnv = process.env,
): Promise<"sent" | "skipped" | "error"> {
  try {
    const staff = listaDeStaff(env.ESMALIA_STAFF_EMAILS);
    const apiKey = env.RESEND_API_KEY;
    const from = env.EMAIL_FROM;
    if (!apiKey || !from || staff.length === 0) {
      console.warn(
        "[aviso-staff] sin enviar: falta RESEND_API_KEY, EMAIL_FROM o ESMALIA_STAFF_EMAILS",
      );
      return "skipped";
    }
    const { subject, html, text } = armarCorreoStaff(c);
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send(
      { from, to: staff, subject, html, text },
      { idempotencyKey: c.clave.slice(0, 256) },
    );
    if (error) {
      console.error("[aviso-staff] Resend rechazó el aviso:", error.message);
      return "error";
    }
    return "sent";
  } catch (err) {
    console.error("[aviso-staff] falló:", err instanceof Error ? err.message : err);
    return "error";
  }
}
