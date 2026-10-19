// src/lib/marketing/puesta-en-marcha.ts
//
// Única fuente del enlace para agendar la llamada de puesta en marcha. Antes
// estaba repetido en `llamada-desbloqueo.tsx` y en la bienvenida y apuntaba al
// evento de DypOS (auditoría 360, CS-01): la primera clínica que lo abría veía
// otra marca justo al decidir.
//
// Canal, en este orden:
//   1. Calendly de Esmalia, si `VITE_CALENDLY_PUESTA_EN_MARCHA` está cargada
//      (cargarla en Vercel activa Calendly sin tocar código).
//   2. WhatsApp de ventas (`VITE_SALES_WHATSAPP`) con el mensaje prellenado:
//      hoy es lo que funciona sin configurar nada y coincide con la oferta
//      ("hablas directo conmigo").
//   3. Correo a `hola@esmalia.com`, para que el botón nunca quede muerto.
// Nunca se publica un enlace a un evento que no existe: un 404 justo en el
// paso que desbloquea WhatsApp, portal y efectividad es peor que no tener botón.
import { EMAIL_CONTACTO } from "@/lib/marketing/contacto";
import { buildWaMeUrl } from "@/lib/messaging/telefonos";

/** Duración de la puesta en marcha, en minutos. Un solo número para el botón,
 *  la bienvenida y la oferta de clínicas fundadoras. */
export const MINUTOS_PUESTA_EN_MARCHA = 20;

export type CanalPuestaEnMarcha = "calendly" | "whatsapp" | "correo";

type Datos = { clinicName?: string | null; clinicEmail?: string | null };
type Config = { calendly?: string | null; whatsapp?: string | null };

function configDelEntorno(): Config {
  return {
    calendly: import.meta.env.VITE_CALENDLY_PUESTA_EN_MARCHA as string | undefined,
    whatsapp: import.meta.env.VITE_SALES_WHATSAPP as string | undefined,
  };
}

/** Solo se acepta un enlace https de Calendly: una variable mal pegada no
 *  puede mandar a la clínica a otro sitio. */
export function calendlyValido(url: string | null | undefined): string | null {
  const limpio = url?.trim();
  if (!limpio) return null;
  try {
    const u = new URL(limpio);
    return u.protocol === "https:" && u.hostname === "calendly.com" && u.pathname.length > 1
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

export function mensajePuestaEnMarcha(clinicName?: string | null): string {
  const nombre = clinicName?.trim();
  return nombre
    ? `Hola, quiero agendar la puesta en marcha de Esmalia para mi clínica ${nombre}.`
    : "Hola, quiero agendar la puesta en marcha de Esmalia para mi clínica.";
}

/** Enlace para agendar la llamada, con el nombre y el correo cargados si los hay. */
export function enlacePuestaEnMarcha(
  datos: Datos = {},
  config: Config = configDelEntorno(),
): { href: string; canal: CanalPuestaEnMarcha } {
  const calendly = calendlyValido(config.calendly);
  if (calendly) {
    const u = new URL(calendly);
    if (datos.clinicName) u.searchParams.set("name", datos.clinicName);
    if (datos.clinicEmail) u.searchParams.set("email", datos.clinicEmail);
    return { href: u.toString(), canal: "calendly" };
  }

  const wa = config.whatsapp
    ? buildWaMeUrl(config.whatsapp, mensajePuestaEnMarcha(datos.clinicName), null)
    : null;
  if (wa) return { href: wa, canal: "whatsapp" };

  const asunto = encodeURIComponent("Quiero agendar mi puesta en marcha de Esmalia");
  const cuerpo = encodeURIComponent(mensajePuestaEnMarcha(datos.clinicName));
  return { href: `mailto:${EMAIL_CONTACTO}?subject=${asunto}&body=${cuerpo}`, canal: "correo" };
}
