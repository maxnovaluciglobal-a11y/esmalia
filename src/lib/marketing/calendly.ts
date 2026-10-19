// src/lib/marketing/calendly.ts
//
// Única fuente del enlace para agendar la llamada de puesta en marcha. Antes
// estaba repetido en `llamada-desbloqueo.tsx` y en la bienvenida, y apuntaba al
// evento de DypOS (auditoría 360, CS-01): la primera clínica que lo abría veía
// otra marca justo al decidir.
//
// ⚠️ Antes de desplegar: el evento "Puesta en marcha Esmalia (20 min)" tiene que
// existir en Calendly con este slug. Si se crea con otro nombre, se cambia
// solo acá.
export const CALENDLY_PUESTA_EN_MARCHA =
  "https://calendly.com/maxnovaluciglobal/esmalia-puesta-en-marcha";

/** Duración de la puesta en marcha, en minutos. Un solo número para el botón,
 *  la bienvenida y la oferta de clínicas fundadoras. */
export const MINUTOS_PUESTA_EN_MARCHA = 20;

/** Enlace con el nombre y el correo de la clínica ya cargados, si los hay. */
export function urlPuestaEnMarcha(datos?: {
  clinicName?: string | null;
  clinicEmail?: string | null;
}): string {
  const params = new URLSearchParams();
  if (datos?.clinicName) params.set("name", datos.clinicName);
  if (datos?.clinicEmail) params.set("email", datos.clinicEmail);
  const qs = params.toString();
  return qs ? `${CALENDLY_PUESTA_EN_MARCHA}?${qs}` : CALENDLY_PUESTA_EN_MARCHA;
}
