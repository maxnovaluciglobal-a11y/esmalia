// src/lib/messaging/baja-whatsapp.ts
//
// Lógica pura: la baja de WhatsApp de un paciente (`patients.wa_opt_out_at`,
// la marca el webhook cuando escribe BAJA, STOP o NO MÁS) tiene que sacarlo de la cola
// de recordatorios de WhatsApp (auditoría 360, CON-09). Antes
// `listPendingReminders` lo seguía ofreciendo y el webhook le decía al
// equipo que "deja de recibir recordatorios automáticos".
//
// La baja es de WhatsApp, no de todo: si a la cita le falta el recordatorio
// por email y el paciente tiene email, la fila se queda solo con ese canal.
// Si no le queda ningún canal, la fila sale de la cola.
//
// Desde la segunda parte de CON-09 también vive acá:
// - Qué mensaje entrante es una baja (`esPalabraDeBaja`). "CANCELAR" salió
//   de la lista: quien escribe "cancelar" casi siempre quiere anular su
//   cita, no dejar de recibir mensajes. Pelado cae al aviso genérico y con
//   contexto ("quiero cancelar mi hora") se lee como cancelación de cita.
// - El bloqueo EN SERVIDOR (`motivoParaNoEnviarWhatsApp`). Antes la baja se
//   respetaba en el outreach y en un cartel de la bandeja, pero el botón de
//   WhatsApp de la ficha y el link del portal seguían armando el envío (API
//   o wa.me). Responderle a algo que el paciente mismo escribió sí se puede
//   mientras la ventana de 24 h de Meta esté abierta: la abrió él.

export interface FilaRecordatorio {
  patientId: string;
  patientPhone: string | null;
  patientEmail: string | null;
  emailSent: boolean;
}

export function quitarBajasDeWhatsApp<T extends FilaRecordatorio>(
  filas: readonly T[],
  pacientesDeBaja: ReadonlySet<string>,
): T[] {
  return filas.flatMap((fila) => {
    if (!pacientesDeBaja.has(fila.patientId)) return [fila];
    const emailPendiente = !fila.emailSent && Boolean(fila.patientEmail);
    return emailPendiente ? [{ ...fila, patientPhone: null }] : [];
  });
}

// ─── Palabras de baja ────────────────────────────────────────────────────

/** Ya normalizadas (mayúsculas, sin tildes ni signos). */
export const PALABRAS_DE_BAJA: ReadonlySet<string> = new Set([
  "BAJA",
  "DAR DE BAJA",
  "DARME DE BAJA",
  "STOP",
  "NO MAS",
  "UNSUBSCRIBE",
]);

/** "¡No más!" → "NO MAS". Sin tildes, sin signos, espacios simples. */
export function normalizarMensajeDeBaja(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿El mensaje entrante completo es un pedido de baja? */
export function esPalabraDeBaja(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return PALABRAS_DE_BAJA.has(normalizarMensajeDeBaja(texto));
}

// ─── Bloqueo de envíos ───────────────────────────────────────────────────

export const MENSAJE_PACIENTE_DADO_DE_BAJA =
  "Este paciente pidió la baja de WhatsApp y no se le pueden enviar mensajes por ese canal. Si quiere volver a recibirlos, tiene que pedirlo él.";

export const MENSAJE_BAJA_VENTANA_CERRADA =
  "Este paciente pidió la baja de WhatsApp. Solo puedes responderle dentro de las 24 horas siguientes a un mensaje suyo.";

/**
 * ¿Se le puede escribir por WhatsApp? `null` = sí; si no, el motivo para
 * mostrarle al equipo de la clínica.
 *
 * - `proactivo`: plantillas, recordatorios, link del portal (lo inicia la clínica).
 * - `respuesta`: contestar desde la bandeja a algo que escribió el paciente.
 */
export function motivoParaNoEnviarWhatsApp(args: {
  waOptOutAt: string | null | undefined;
  tipo: "proactivo" | "respuesta";
  /** Ventana de servicio de 24 h abierta por un mensaje del paciente. */
  ventanaAbierta?: boolean;
}): string | null {
  if (!args.waOptOutAt) return null;
  if (args.tipo === "respuesta" && args.ventanaAbierta) return null;
  return args.tipo === "respuesta" ? MENSAJE_BAJA_VENTANA_CERRADA : MENSAJE_PACIENTE_DADO_DE_BAJA;
}
