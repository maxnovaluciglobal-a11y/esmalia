/**
 * Reserva en línea: textos que salen hacia el paciente. Lógica pura.
 *
 * El correo del código no lleva datos clínicos (ni el motivo ni el
 * profesional): solo la clínica, el código y cuánto dura.
 */
import { primerNombre } from "@/lib/documentos/correo";
import { renderCorreo, type CorreoRenderizado } from "@/lib/email/layout";

export const CODIGO_RESERVA_MINUTOS = 10;

/** "123456" → "123 456". */
export function codigoLegible(codigo: string): string {
  return `${codigo.slice(0, 3)} ${codigo.slice(3)}`;
}

export function correoCodigoDeReserva(d: {
  appUrl: string;
  clinica: string;
  nombre: string | null;
  codigo: string;
}): CorreoRenderizado {
  const saludo = primerNombre(d.nombre);
  return renderCorreo({
    appUrl: d.appUrl,
    asunto: `Tu código para reservar: ${codigoLegible(d.codigo)}`,
    preencabezado: `Vence en ${CODIGO_RESERVA_MINUTOS} minutos.`,
    titulo: d.clinica,
    bloques: [
      { tipo: "parrafo", partes: [saludo ? `Hola, ${saludo}:` : "Hola:"] },
      {
        tipo: "parrafo",
        partes: [`Este es tu código para terminar tu reserva en ${d.clinica}:`],
      },
      {
        tipo: "cifra",
        etiqueta: "Código",
        valor: codigoLegible(d.codigo),
        detalle: `Vence en ${CODIGO_RESERVA_MINUTOS} minutos`,
      },
      {
        tipo: "parrafo",
        tenue: true,
        partes: [
          "Escríbelo en la página donde estás reservando. Nadie de la clínica te lo va a pedir: no lo compartas. Si no estás reservando una hora, ignora este correo.",
        ],
      },
    ],
    pie: {
      motivo: `Recibes este correo porque pediste un código para reservar una hora en ${d.clinica}.`,
    },
  });
}

/**
 * MKT-06: el recall con la reserva en un clic. Se agrega al final del
 * mensaje de control periódico (lo manda la persona de la clínica por wa.me,
 * nada sale solo).
 */
export function lineaDeReserva(url: string): string {
  return `Si prefieres, elige tu hora aquí: ${url}`;
}
