// src/lib/marketing/aviso-alta.ts
//
// Aviso interno cuando una clínica termina su alta (auditoría 360, CS-10).
// Antes, el único aviso era el lead de `/demo`: una clínica que se registraba
// sola no le llegaba a nadie, y el benchmark de onboarding dice que el
// contacto humano de la primera semana es lo que más mueve la activación.
//
// Puro (sin red ni base) para poder testearlo; el envío está en
// `notify-alta.server.ts`. Los datos de la clínica son texto libre que
// escribió el usuario: se escapan antes de ir al HTML.
import { escapeHtml } from "@/lib/email/layout";

export type DatosAvisoAlta = {
  clinicName: string;
  countryCode: string;
  /** Correo con el que se registró quien creó la clínica. */
  userEmail: string | null;
  profesionales: number;
  /** Alta hecha por el equipo o la cuenta demo: se marca en el asunto. */
  interno: boolean;
};

export function armarAvisoAlta(
  d: DatosAvisoAlta,
  appUrl: string,
): { asunto: string; html: string; texto: string } {
  const prefijo = d.interno ? "[interno] " : "";
  const asunto = `${prefijo}Nueva clínica en Esmalia: ${d.clinicName} (${d.countryCode})`;
  const enlace = `${appUrl.replace(/\/$/, "")}/admin/clinicas`;
  const accion =
    "Escríbele hoy para ofrecerle la puesta en marcha (20 min) y la migración de su planilla. Cuando la hagas, márcala como hecha en /admin/clinicas: eso desbloquea WhatsApp, portal y efectividad.";

  const html = `
    <p><strong>Clínica:</strong> ${escapeHtml(d.clinicName)}</p>
    <p><strong>País:</strong> ${escapeHtml(d.countryCode)} · <strong>Profesionales cargados:</strong> ${d.profesionales}</p>
    <p><strong>Correo de quien la creó:</strong> ${d.userEmail ? escapeHtml(d.userEmail) : "—"}</p>
    <p>${escapeHtml(accion)}</p>
    <p><a href="${escapeHtml(enlace)}">Ver en /admin/clinicas</a></p>
  `.trim();

  const texto = [
    `Clínica: ${d.clinicName}`,
    `País: ${d.countryCode} · Profesionales cargados: ${d.profesionales}`,
    `Correo de quien la creó: ${d.userEmail ?? "—"}`,
    "",
    accion,
    enlace,
  ].join("\n");

  return { asunto, html, texto };
}
