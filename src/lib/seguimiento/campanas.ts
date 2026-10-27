/**
 * CRM-04 · Campañas (Ola 8). Lógica pura del grupo de pacientes y de quién
 * puede recibir la campaña por cada canal.
 *
 * El grupo se describe con `SegmentoCampana`. Mientras los segmentos guardados
 * del frente A (Ola 8, PAC-06) no estén en main, la campaña usa un filtro
 * propio y simple (`FiltroCampana`); el servidor los resuelve detrás de una
 * sola puerta, `resolverDestinatarios` (campanas.server.ts), así que cambiar
 * de uno a otro no toca la pantalla ni el envío.
 *
 * Quién recibe (lo decide `elegibilidad`, igual en la vista previa y al
 * confirmar):
 *  - Correo: correo del paciente, o del tutor si es menor con tutor vigente;
 *    sin baja de correos (`email_opt_out_at`). El modo de prueba lo aplica el
 *    envío (`sendEmail`).
 *  - WhatsApp: es un mensaje proactivo de marketing, así que exige el
 *    consentimiento (`wa_opt_in`), sin baja (`wa_opt_out_at`) y un teléfono
 *    que se pueda leer con el país de la clínica.
 */
import { z } from "zod";

import { diasEntre } from "@/lib/seguimiento/controles";

export const CANALES_DE_CAMPANA = ["correo", "whatsapp"] as const;
export type CanalDeCampana = (typeof CANALES_DE_CAMPANA)[number];

export const OPCIONES_SIN_VISITA = [0, 3, 6, 12, 24] as const;

export const FiltroCampanaSchema = z.object({
  /** Meses sin visita atendida (0 = da igual). */
  sinVisitaDesdeMeses: z.number().int().min(0).max(120).default(0),
  /** Solo pacientes sin cita futura. */
  sinCitaFutura: z.boolean().default(false),
  edadMinima: z.number().int().min(0).max(120).nullable().default(null),
  edadMaxima: z.number().int().min(0).max(120).nullable().default(null),
  /** Solo con un presupuesto enviado o en borrador sin aceptar. */
  conPresupuestoPendiente: z.boolean().default(false),
});
export type FiltroCampana = z.infer<typeof FiltroCampanaSchema>;

export const SegmentoCampanaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("filtro"), filtro: FiltroCampanaSchema }),
  // Segmento guardado del frente A (PAC-06). Se resuelve con su función de
  // servidor cuando esté en main; mientras tanto el servidor lo rechaza con
  // un mensaje claro.
  z.object({
    tipo: z.literal("segmento"),
    segmentoId: z.string().uuid(),
    nombre: z.string().max(120),
  }),
]);
export type SegmentoCampana = z.infer<typeof SegmentoCampanaSchema>;

export const FILTRO_VACIO: FiltroCampana = {
  sinVisitaDesdeMeses: 0,
  sinCitaFutura: false,
  edadMinima: null,
  edadMaxima: null,
  conPresupuestoPendiente: false,
};

/** "Sin visita hace 6 meses o más · sin cita agendada · 18 a 65 años". */
export function describirSegmento(s: SegmentoCampana): string {
  if (s.tipo === "segmento") return `Segmento «${s.nombre}»`;
  const f = s.filtro;
  const partes: string[] = [];
  if (f.sinVisitaDesdeMeses > 0)
    partes.push(`sin visita hace ${f.sinVisitaDesdeMeses} meses o más`);
  if (f.sinCitaFutura) partes.push("sin cita agendada");
  if (f.edadMinima !== null && f.edadMaxima !== null) {
    partes.push(`de ${f.edadMinima} a ${f.edadMaxima} años`);
  } else if (f.edadMinima !== null) {
    partes.push(`desde ${f.edadMinima} años`);
  } else if (f.edadMaxima !== null) {
    partes.push(`hasta ${f.edadMaxima} años`);
  }
  if (f.conPresupuestoPendiente) partes.push("con presupuesto sin aceptar");
  if (partes.length === 0) return "Todos los pacientes activos";
  const texto = partes.join(" · ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export interface PacienteParaCampana {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  fechaNacimiento: string | null;
  waOptIn: boolean;
  waOptOutAt: string | null;
  emailOptOutAt: string | null;
  ultimaVisita: string | null;
  tieneCitaFutura: boolean;
  tienePresupuestoPendiente: boolean;
}

/** Edad cumplida a `hoy` (YYYY-MM-DD), o null sin fecha de nacimiento. */
export function edadEn(fechaNacimiento: string | null, hoy: string): number | null {
  if (!fechaNacimiento) return null;
  const n = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaNacimiento);
  const h = /^(\d{4})-(\d{2})-(\d{2})/.exec(hoy);
  if (!n || !h) return null;
  let edad = Number(h[1]) - Number(n[1]);
  if (Number(h[2]) < Number(n[2]) || (h[2] === n[2] && Number(h[3]) < Number(n[3]))) edad -= 1;
  return edad >= 0 ? edad : null;
}

export function cumpleFiltro(p: PacienteParaCampana, f: FiltroCampana, hoy: string): boolean {
  if (f.sinVisitaDesdeMeses > 0) {
    // Sin ninguna visita atendida también cuenta como "sin visita".
    if (p.ultimaVisita) {
      const dias = diasEntre(p.ultimaVisita.slice(0, 10), hoy);
      if (dias < f.sinVisitaDesdeMeses * 30) return false;
    }
  }
  if (f.sinCitaFutura && p.tieneCitaFutura) return false;
  if (f.edadMinima !== null || f.edadMaxima !== null) {
    const edad = edadEn(p.fechaNacimiento, hoy);
    if (edad === null) return false;
    if (f.edadMinima !== null && edad < f.edadMinima) return false;
    if (f.edadMaxima !== null && edad > f.edadMaxima) return false;
  }
  if (f.conPresupuestoPendiente && !p.tienePresupuestoPendiente) return false;
  return true;
}

export type MotivoDeOmision =
  "baja_correo" | "sin_correo" | "baja_whatsapp" | "sin_consentimiento_whatsapp" | "sin_telefono";

export const ETIQUETA_OMISION: Record<MotivoDeOmision, string> = {
  baja_correo: "Se dio de baja de los correos",
  sin_correo: "Sin correo (ni del tutor)",
  baja_whatsapp: "Se dio de baja de WhatsApp",
  sin_consentimiento_whatsapp: "No aceptó mensajes de WhatsApp de la clínica",
  sin_telefono: "Sin teléfono válido",
};

export type Elegibilidad =
  | { ok: true; destino: string; para: "paciente" | "tutor" }
  | { ok: false; motivo: MotivoDeOmision };

/**
 * `contacto` es lo que ya resolvió el tutor (CLI-11): el correo o teléfono al
 * que de verdad se le escribe. `telefonoValido` lo dice el servidor con el
 * país de la clínica (`normalizeToWaMe`).
 */
export function elegibilidad(args: {
  paciente: Pick<PacienteParaCampana, "waOptIn" | "waOptOutAt" | "emailOptOutAt">;
  canal: CanalDeCampana;
  contacto: { email: string | null; telefono: string | null; para: "paciente" | "tutor" };
  telefonoValido: (telefono: string) => boolean;
}): Elegibilidad {
  const { paciente, canal, contacto } = args;
  if (canal === "correo") {
    if (paciente.emailOptOutAt) return { ok: false, motivo: "baja_correo" };
    const email = contacto.email?.trim() ?? "";
    if (!email || !email.includes("@")) return { ok: false, motivo: "sin_correo" };
    return { ok: true, destino: email, para: contacto.para };
  }
  if (paciente.waOptOutAt) return { ok: false, motivo: "baja_whatsapp" };
  if (!paciente.waOptIn) return { ok: false, motivo: "sin_consentimiento_whatsapp" };
  const telefono = contacto.telefono?.trim() ?? "";
  if (!telefono || !args.telefonoValido(telefono)) return { ok: false, motivo: "sin_telefono" };
  return { ok: true, destino: telefono, para: contacto.para };
}

export interface ResumenDestinatarios {
  enGrupo: number;
  elegibles: number;
  omitidos: Partial<Record<MotivoDeOmision, number>>;
}

export function resumirElegibilidad(
  evaluados: readonly { elegibilidad: Elegibilidad }[],
): ResumenDestinatarios {
  const omitidos: Partial<Record<MotivoDeOmision, number>> = {};
  let elegibles = 0;
  for (const e of evaluados) {
    if (e.elegibilidad.ok) elegibles += 1;
    else omitidos[e.elegibilidad.motivo] = (omitidos[e.elegibilidad.motivo] ?? 0) + 1;
  }
  return { enGrupo: evaluados.length, elegibles, omitidos };
}

export type EstadoDeCampana = "borrador" | "confirmada" | "terminada" | "cancelada";

export const ETIQUETA_ESTADO_CAMPANA: Record<EstadoDeCampana, string> = {
  borrador: "Borrador",
  confirmada: "En curso",
  terminada: "Terminada",
  cancelada: "Cancelada",
};

export type EstadoDeDestinatario =
  "pendiente" | "enviando" | "enviado" | "fallido" | "omitido" | "abierto";

export const ETIQUETA_ESTADO_DESTINATARIO: Record<EstadoDeDestinatario, string> = {
  pendiente: "Pendiente",
  enviando: "Enviando",
  enviado: "Enviado",
  fallido: "No salió",
  omitido: "Omitido",
  abierto: "Abierto en WhatsApp",
};

/** Un destinatario al que la campaña ya le escribió (cuenta para medir el retorno). */
export function fueContactado(estado: EstadoDeDestinatario): boolean {
  return estado === "enviado" || estado === "abierto";
}

/** Tope de destinatarios por campaña (una campaña más grande se parte en dos). */
export const MAXIMO_DESTINATARIOS = 2000;
/** Destinatarios por tanda de envío por correo. */
export const TANDA_DE_CORREO = 25;
