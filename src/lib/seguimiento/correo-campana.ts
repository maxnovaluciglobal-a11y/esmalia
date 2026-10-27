/**
 * Correo de una campaña (CRM-04), con el diseño compartido de los correos de
 * la clínica (`src/lib/email/layout.ts`). Lógica pura. El mensaje es texto
 * plano: se escapa entero y los saltos de línea se respetan. Lleva siempre el
 * enlace de baja cuando el servidor puede firmarlo.
 */
import { parrafosDelMensaje } from "@/lib/documentos/correo";
import { escapeHtml, renderCorreo, type Bloque, type CorreoRenderizado } from "@/lib/email/layout";

export function correoDeCampana(e: {
  appUrl: string;
  asunto: string;
  mensaje: string;
  clinica: string;
  bajaUrl: string | null;
}): CorreoRenderizado {
  const parrafos = parrafosDelMensaje(e.mensaje);
  const bloques: Bloque[] = parrafos.map((lineas) => ({
    tipo: "parrafo",
    partes: [lineas.join("\n")],
  }));
  const correo = renderCorreo({
    appUrl: e.appUrl,
    asunto: e.asunto,
    preencabezado: e.asunto,
    titulo: e.clinica,
    bloques,
    pie: {
      motivo: `Recibes este correo porque eres paciente de ${e.clinica}, que usa Esmalia para su gestión. El contenido es responsabilidad de la clínica.`,
      ...(e.bajaUrl
        ? { bajaUrl: e.bajaUrl, bajaTexto: `No quiero recibir más correos de ${e.clinica}` }
        : {}),
    },
  });
  // El layout escapa el texto: el salto de línea queda literal y se cambia por <br>.
  const html = parrafos.reduce((acc, lineas) => {
    const escapado = escapeHtml(lineas.join("\n"));
    return acc.replace(escapado, () => escapado.replace(/\n/g, "<br>"));
  }, correo.html);
  return { ...correo, html };
}
