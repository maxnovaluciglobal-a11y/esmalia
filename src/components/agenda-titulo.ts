import { rangoDeVista } from "@/lib/clinic-operations/agenda-fechas";

/**
 * Título editorial de la agenda A+ (prototipo del 19-oct): una parte en
 * redonda y el período en itálica ocre. "Semana del *19 al 25 de octubre*",
 * "Lunes *26 de octubre*", "Octubre *2026*".
 *
 * Fechas civiles ISO (yyyy-mm-dd): se formatean en UTC para que el huso del
 * navegador no corra el día.
 */
export interface TituloAgenda {
  antes: string;
  enfasis: string;
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function partes(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
  return { anio: y, mes: (m || 1) - 1, dia: d || 1, dow };
}

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function tituloDeAgenda(
  vista: "dia" | "semana" | "mes" | "lista",
  fecha: string,
): TituloAgenda {
  const f = partes(fecha);
  if (vista === "mes") return { antes: mayuscula(MESES[f.mes]), enfasis: String(f.anio) };
  if (vista === "dia" || vista === "lista") {
    return { antes: mayuscula(DIAS[f.dow]), enfasis: `${f.dia} de ${MESES[f.mes]}` };
  }
  const [desde, hasta] = rangoDeVista("semana", fecha);
  const a = partes(desde);
  const b = partes(hasta);
  let enfasis: string;
  if (a.anio !== b.anio) {
    enfasis = `${a.dia} de ${MESES[a.mes]} de ${a.anio} al ${b.dia} de ${MESES[b.mes]} de ${b.anio}`;
  } else if (a.mes !== b.mes) {
    enfasis = `${a.dia} de ${MESES[a.mes]} al ${b.dia} de ${MESES[b.mes]}`;
  } else {
    enfasis = `${a.dia} al ${b.dia} de ${MESES[b.mes]}`;
  }
  return { antes: "Semana del", enfasis };
}

/** "+56 9 8765 1746" → "+56 9 •••• 1746". Sin teléfono: null. */
export function telefonoEnmascarado(telefono: string | null | undefined): string | null {
  const limpio = (telefono ?? "").trim();
  const digitos = limpio.replace(/\D/g, "");
  if (digitos.length < 6) return null;
  const ultimos = digitos.slice(-4);
  const prefijo = limpio.startsWith("+") ? limpio.match(/^\+\d{1,3}(?:\s?9(?=\s|\d))?/)?.[0] : "";
  return `${prefijo ? `${prefijo.replace(/\s+/g, " ").trim()} ` : ""}•••• ${ultimos}`;
}
