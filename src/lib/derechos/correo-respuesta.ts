/**
 * Correo con la respuesta de la clínica a una solicitud del titular
 * (SEG-09). Puro: arma el correo con el diseño compartido de
 * `src/lib/email/layout.ts`. El envío y sus frenos (modo de prueba de la
 * clínica, registro en `messages`) viven en `solicitudes.functions.ts`.
 *
 * No lleva enlace de baja: no es publicidad sino la respuesta a un pedido
 * del propio paciente, y por eso se envía aunque se haya dado de baja de
 * los correos de la clínica.
 */
import { renderCorreo, type Bloque, type CorreoRenderizado } from "@/lib/email/layout";
import { parrafosDelMensaje } from "@/lib/documentos/correo";

export function correoRespuestaTitular(e: {
  appUrl: string;
  asunto: string;
  mensaje: string;
  clinica: string;
}): CorreoRenderizado {
  // Cada línea es un párrafo: el layout escapa el texto, así que no se
  // interpreta nada como HTML.
  const bloques: Bloque[] = parrafosDelMensaje(e.mensaje).flatMap((lineas) =>
    lineas.map((linea) => ({ tipo: "parrafo" as const, partes: [linea] })),
  );
  return renderCorreo({
    appUrl: e.appUrl,
    asunto: e.asunto,
    preencabezado: `${e.clinica} respondió tu solicitud sobre tus datos personales.`,
    titulo: e.clinica,
    bloques,
    pie: {
      motivo: `Recibes este correo porque hiciste una solicitud sobre tus datos personales a ${e.clinica}, que usa Esmalia para su gestión. El contenido es responsabilidad de la clínica.`,
    },
  });
}
