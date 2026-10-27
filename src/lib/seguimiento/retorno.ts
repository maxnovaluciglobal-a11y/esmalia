/**
 * CRM-05 · Medir quién volvió (Ola 8). Lógica pura: de un grupo de pacientes
 * contactados (una campaña o el recall), cuántos agendaron y cuántos vinieron
 * dentro de una ventana de días desde el contacto.
 *
 * Reglas:
 *  - Un paciente cuenta una vez, desde su primer contacto.
 *  - "Agendó": tiene una cita CREADA entre el contacto y el fin de la ventana
 *    (una cita que ya existía antes del contacto no es mérito del mensaje).
 *  - "Vino": una de esas citas quedó atendida (finalizada) y su hora cae
 *    dentro de la ventana.
 *  - Sin contactados, las tasas son `null` (regla 11), nunca 0 %.
 */
import { DIA_MS } from "@/lib/seguimiento/riesgo";

export interface ContactoParaRetorno {
  patientId: string;
  /** Cuándo se le escribió (ISO). */
  contactadoEl: string;
}

export interface CitaParaRetorno {
  patientId: string;
  /** Cuándo se creó la cita (ISO). */
  creadaEl: string;
  /** Hora de la cita (ISO). */
  inicio: string;
  estado: string;
}

export interface ResultadoRetorno {
  contactados: number;
  agendaron: number;
  vinieron: number;
  /** Contactados cuya ventana todavía no termina (la cifra puede crecer). */
  conVentanaAbierta: number;
  tasaAgendaron: number | null;
  tasaVinieron: number | null;
  /** Pacientes que agendaron, para listarlos. */
  pacientesQueAgendaron: string[];
}

export const VENTANAS_DE_RETORNO = [30, 60, 90] as const;
export const VENTANA_DE_RETORNO_POR_DEFECTO = 60;

export function medirRetorno(args: {
  contactos: readonly ContactoParaRetorno[];
  citas: readonly CitaParaRetorno[];
  ventanaDias: number;
  ahora: number;
}): ResultadoRetorno {
  const ventanaMs = Math.max(1, Math.floor(args.ventanaDias)) * DIA_MS;

  const primerContacto = new Map<string, number>();
  for (const c of args.contactos) {
    const t = new Date(c.contactadoEl).getTime();
    if (!Number.isFinite(t)) continue;
    const previo = primerContacto.get(c.patientId);
    if (previo === undefined || t < previo) primerContacto.set(c.patientId, t);
  }

  const citasPorPaciente = new Map<string, CitaParaRetorno[]>();
  for (const cita of args.citas) {
    if (!primerContacto.has(cita.patientId)) continue;
    const lista = citasPorPaciente.get(cita.patientId) ?? [];
    lista.push(cita);
    citasPorPaciente.set(cita.patientId, lista);
  }

  let agendaron = 0;
  let vinieron = 0;
  let conVentanaAbierta = 0;
  const pacientesQueAgendaron: string[] = [];

  for (const [patientId, contacto] of primerContacto) {
    const fin = contacto + ventanaMs;
    if (fin > args.ahora) conVentanaAbierta += 1;
    const limiteCreacion = Math.min(fin, args.ahora);
    const nuevas = (citasPorPaciente.get(patientId) ?? []).filter((c) => {
      const creada = new Date(c.creadaEl).getTime();
      return creada >= contacto && creada <= limiteCreacion;
    });
    if (nuevas.length === 0) continue;
    agendaron += 1;
    pacientesQueAgendaron.push(patientId);
    const vino = nuevas.some((c) => {
      const inicio = new Date(c.inicio).getTime();
      return c.estado === "finalizada" && inicio >= contacto && inicio <= fin;
    });
    if (vino) vinieron += 1;
  }

  const contactados = primerContacto.size;
  return {
    contactados,
    agendaron,
    vinieron,
    conVentanaAbierta,
    tasaAgendaron: contactados > 0 ? agendaron / contactados : null,
    tasaVinieron: contactados > 0 ? vinieron / contactados : null,
    pacientesQueAgendaron,
  };
}

/** "42 %" o "Sin datos". */
export function formatoTasa(tasa: number | null): string {
  if (tasa === null) return "Sin datos";
  return `${Math.round(tasa * 100)} %`;
}
