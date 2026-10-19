// src/lib/marketing/contacto.ts
//
// Contacto comercial del sitio público. El número de WhatsApp de ventas es
// público (no es un secreto) y se carga como `VITE_SALES_WHATSAPP` en Vercel;
// mientras no exista, los CTA de WhatsApp caen al email de contacto en vez de
// fingir un chat que no abre.
import { buildWaMeUrl } from "@/lib/messaging/messaging";

export const EMAIL_CONTACTO = "hola@esmalia.com";
export const EMAIL_SOPORTE = "soporte@esmalia.com";

const MENSAJE_INICIAL = "Hola, quiero conocer Esmalia para mi clínica.";

export function enlaceWhatsAppVentas(): { href: string; esWhatsApp: boolean } {
  const numero = import.meta.env.VITE_SALES_WHATSAPP as string | undefined;
  // El número de ventas se carga en formato internacional ("+56…"): no
  // depende del país de nadie, por eso va sin país.
  const url = numero ? buildWaMeUrl(numero, MENSAJE_INICIAL, null) : null;
  return url
    ? { href: url, esWhatsApp: true }
    : { href: `mailto:${EMAIL_CONTACTO}`, esWhatsApp: false };
}

/** Mensaje prellenado para pedir ayuda desde la app: lleva el nombre de la
 *  clínica para que quien atiende sepa de quién es sin preguntar. */
export function mensajeSoporte(clinicName?: string | null): string {
  const nombre = clinicName?.trim();
  return nombre
    ? `Hola, necesito ayuda con Esmalia. Mi clínica es ${nombre}.`
    : "Hola, necesito ayuda con Esmalia.";
}

/**
 * WhatsApp de soporte para quien ya usa Esmalia. Hoy es el mismo número que
 * el de ventas (`VITE_SALES_WHATSAPP`): en el piloto atiende una sola persona.
 * `null` si el número no está cargado: el menú de ayuda ofrece solo el centro
 * de ayuda y el correo, sin fingir un chat que no abre.
 */
export function enlaceWhatsAppSoporte(clinicName?: string | null): string | null {
  const numero = import.meta.env.VITE_SALES_WHATSAPP as string | undefined;
  return numero ? buildWaMeUrl(numero, mensajeSoporte(clinicName), null) : null;
}
