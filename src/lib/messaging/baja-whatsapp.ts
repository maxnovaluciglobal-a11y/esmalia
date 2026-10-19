// src/lib/messaging/baja-whatsapp.ts
//
// Lógica pura: la baja de WhatsApp de un paciente (`patients.wa_opt_out_at`,
// la marca el webhook cuando escribe BAJA/STOP) tiene que sacarlo de la cola
// de recordatorios de WhatsApp (auditoría 360, CON-09). Antes
// `listPendingReminders` lo seguía ofreciendo y el webhook le decía al
// equipo que "deja de recibir recordatorios automáticos".
//
// La baja es de WhatsApp, no de todo: si a la cita le falta el recordatorio
// por email y el paciente tiene email, la fila se queda solo con ese canal.
// Si no le queda ningún canal, la fila sale de la cola.

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
