/**
 * Firma a distancia (Ola 5 · DOC-05): textos que salen hacia el paciente.
 * Lógica pura.
 *
 * Regla: ni el correo, ni el WhatsApp, ni la URL llevan datos clínicos. No
 * dicen qué documento es ni de qué tratamiento: solo que la clínica pide una
 * firma, el link y cuándo vence. El documento se ve recién en la página,
 * después de confirmar el RUT.
 */
import { renderCorreo, type CorreoRenderizado } from "@/lib/email/layout";
import { primerNombre } from "@/lib/documentos/correo";
import { VIGENCIA_HORAS, CODIGO_VIGENCIA_MINUTOS } from "@/lib/firma-distancia/estado";

/** Mensaje de WhatsApp (wa.me asistido: lo manda la persona de la clínica). */
export function textoWhatsAppDeFirma(d: {
  nombre: string | null;
  clinica: string;
  url: string;
  horas?: number;
}): string {
  const saludo = primerNombre(d.nombre);
  const horas = d.horas ?? VIGENCIA_HORAS;
  return [
    saludo ? `Hola, ${saludo}.` : "Hola.",
    `${d.clinica} te pide firmar un documento desde tu celular. Ábrelo aquí: ${d.url}`,
    `Te vamos a pedir tu RUT y un código que te llega por correo. El link es personal y vence en ${horas} horas.`,
  ].join("\n\n");
}

/** Correo con el link (canal "correo"). Lleva baja: es un envío de la clínica. */
export function correoLinkDeFirma(d: {
  appUrl: string;
  clinica: string;
  nombre: string | null;
  url: string;
  bajaUrl: string | null;
  horas?: number;
}): CorreoRenderizado {
  const saludo = primerNombre(d.nombre);
  const horas = d.horas ?? VIGENCIA_HORAS;
  return renderCorreo({
    appUrl: d.appUrl,
    asunto: `${d.clinica} te pide una firma`,
    preencabezado: `Firma desde tu celular. El link vence en ${horas} horas.`,
    titulo: d.clinica,
    bloques: [
      { tipo: "parrafo", partes: [saludo ? `Hola, ${saludo}:` : "Hola:"] },
      {
        tipo: "parrafo",
        partes: [
          `${d.clinica} te pide firmar un documento. Puedes leerlo y firmarlo desde tu celular, sin crear una cuenta.`,
        ],
      },
      { tipo: "boton", texto: "Revisar y firmar", href: d.url },
      {
        tipo: "parrafo",
        tenue: true,
        partes: [
          `Para confirmar que eres tú te pediremos tu RUT y un código que te llega a este correo. El link es personal: no lo reenvíes. Vence en ${horas} horas.`,
        ],
      },
    ],
    pie: {
      motivo: `Recibes este correo porque eres paciente de ${d.clinica}, que usa Esmalia para su gestión. El contenido es responsabilidad de la clínica.`,
      ...(d.bajaUrl
        ? { bajaUrl: d.bajaUrl, bajaTexto: `No quiero recibir más correos de ${d.clinica}` }
        : {}),
    },
  });
}

/** "123456" → "123 456" (más fácil de leer y de copiar). */
export function codigoLegible(codigo: string): string {
  return codigo.length === 6 ? `${codigo.slice(0, 3)} ${codigo.slice(3)}` : codigo;
}

/**
 * Correo con el código. Transaccional: lo pide el propio paciente en ese
 * momento, así que no lleva enlace de baja (ver docs/FIRMA_A_DISTANCIA.md).
 */
export function correoCodigoDeFirma(d: {
  appUrl: string;
  clinica: string;
  nombre: string | null;
  codigo: string;
  minutos?: number;
}): CorreoRenderizado {
  const saludo = primerNombre(d.nombre);
  const minutos = d.minutos ?? CODIGO_VIGENCIA_MINUTOS;
  return renderCorreo({
    appUrl: d.appUrl,
    asunto: `Tu código para firmar: ${codigoLegible(d.codigo)}`,
    preencabezado: `Vence en ${minutos} minutos.`,
    titulo: d.clinica,
    bloques: [
      { tipo: "parrafo", partes: [saludo ? `Hola, ${saludo}:` : "Hola:"] },
      {
        tipo: "parrafo",
        partes: [`Este es tu código para firmar el documento que te envió ${d.clinica}:`],
      },
      {
        tipo: "cifra",
        etiqueta: "Código",
        valor: codigoLegible(d.codigo),
        detalle: `Vence en ${minutos} minutos`,
      },
      {
        tipo: "parrafo",
        tenue: true,
        partes: [
          "Escríbelo en la página donde estás firmando. Nadie de la clínica te lo va a pedir: no lo compartas. Si no estás firmando nada, ignora este correo.",
        ],
      },
    ],
    pie: {
      motivo: `Recibes este correo porque pediste un código para firmar un documento de ${d.clinica}.`,
    },
  });
}
