/**
 * Correo al paciente con un PDF adjunto (Ola 4 · PLA-09 presupuesto, DOC-07
 * copia de un documento emitido). Lógica pura: el texto por defecto que ve
 * quien envía (editable) y el armado del correo con el diseño compartido de
 * `src/lib/email/layout.ts`. El envío y sus frenos viven en
 * `correo.server.ts`.
 *
 * Lo que el correo NUNCA lleva en el cuerpo: datos clínicos. El contenido va
 * solo en el PDF adjunto; el cuerpo dice qué es y de qué clínica.
 */
import { escapeHtml, renderCorreo, type Bloque, type CorreoRenderizado } from "@/lib/email/layout";

export const LARGO_MAXIMO_ASUNTO = 150;
export const LARGO_MAXIMO_MENSAJE = 4000;

/** Primer nombre para el saludo ("Ana Pérez Soto" → "Ana"). */
export function primerNombre(nombreCompleto: string | null | undefined): string | null {
  const primero = (nombreCompleto ?? "").trim().split(/\s+/)[0];
  return primero ? primero : null;
}

export interface TextoDeCorreo {
  asunto: string;
  mensaje: string;
}

/** Texto por defecto del correo del presupuesto (lo edita quien envía). */
export function textoCorreoPresupuesto(d: {
  paciente: string | null;
  clinica: string;
  numero: string;
  /** Para un menor con tutor: el saludo va al tutor. */
  destinatario?: string | null;
}): TextoDeCorreo {
  const saludo = primerNombre(d.destinatario ?? d.paciente);
  const para = d.destinatario && d.paciente ? ` de ${d.paciente}` : "";
  return {
    asunto: `Presupuesto ${d.numero} de ${d.clinica}`,
    mensaje: [
      saludo ? `Hola, ${saludo}:` : "Hola:",
      `Te enviamos el presupuesto ${d.numero}${para}. Va adjunto en PDF, con el detalle de las prestaciones, los valores y las condiciones.`,
      "Si tienes dudas o quieres aceptarlo, responde a la clínica por el canal de siempre o coméntalo en tu próxima visita.",
      `Saludos,\n${d.clinica}`,
    ].join("\n\n"),
  };
}

/** Texto por defecto del correo con la copia de un documento emitido. */
export function textoCorreoDocumento(d: {
  paciente: string | null;
  clinica: string;
  titulo: string;
  folio: string;
  destinatario?: string | null;
}): TextoDeCorreo {
  const saludo = primerNombre(d.destinatario ?? d.paciente);
  const para = d.destinatario && d.paciente ? ` de ${d.paciente}` : "";
  return {
    asunto: `${d.titulo} · ${d.clinica}`,
    mensaje: [
      saludo ? `Hola, ${saludo}:` : "Hola:",
      `Te enviamos una copia del documento "${d.titulo}" (${d.folio})${para}. Va adjunto en PDF.`,
      "Guárdalo: es la copia que te corresponde. Si necesitas otra, pídesela a la clínica.",
      `Saludos,\n${d.clinica}`,
    ].join("\n\n"),
  };
}

/** Párrafos del mensaje escrito por quien envía: una línea en blanco separa párrafos. */
export function parrafosDelMensaje(mensaje: string): string[][] {
  return mensaje
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) =>
      p
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    )
    .filter((lineas) => lineas.length > 0);
}

/**
 * Arma el correo. El mensaje es texto plano: se escapa entero (nunca se
 * interpreta como HTML) y los saltos de línea se respetan.
 */
export function correoAlPaciente(e: {
  appUrl: string;
  asunto: string;
  mensaje: string;
  clinica: string;
  /** Nombre del archivo adjunto, para decirlo en el cuerpo. */
  adjunto: string;
  /** Enlace de baja del paciente (si el servidor puede firmarlo). */
  bajaUrl: string | null;
}): CorreoRenderizado {
  const parrafos = parrafosDelMensaje(e.mensaje);
  const bloques: Bloque[] = parrafos.map((lineas) => ({
    tipo: "parrafo",
    // `layout` escapa cada parte; el salto de línea se arma abajo en el HTML.
    partes: [lineas.join("\n")],
  }));
  bloques.push({
    tipo: "recuadro",
    titulo: "Adjunto",
    partes: [`${e.adjunto} (PDF)`],
  });
  const correo = renderCorreo({
    appUrl: e.appUrl,
    asunto: e.asunto,
    preencabezado: `${e.clinica} te envió un documento en PDF.`,
    titulo: e.clinica,
    bloques,
    pie: {
      motivo: `Recibes este correo porque eres paciente de ${e.clinica}, que usa Esmalia para su gestión. El contenido es responsabilidad de la clínica.`,
      ...(e.bajaUrl
        ? { bajaUrl: e.bajaUrl, bajaTexto: `No quiero recibir más correos de ${e.clinica}` }
        : {}),
    },
  });
  // Saltos de línea dentro de un párrafo: el layout escapa el texto, así que
  // el "\n" queda literal en el HTML; se cambia por <br> después de escapar.
  const html = parrafos.reduce((acc, lineas) => {
    const escapado = escapeHtml(lineas.join("\n"));
    // Función de reemplazo: un "$" del mensaje no se interpreta como patrón.
    return acc.replace(escapado, () => escapado.replace(/\n/g, "<br>"));
  }, correo.html);
  return { ...correo, html };
}
