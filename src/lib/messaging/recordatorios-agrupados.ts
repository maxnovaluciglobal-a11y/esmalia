/**
 * Agrupación de /recordatorios (UX-11), lógica pura sin Supabase.
 *
 * Antes cada cita, cada visita y cada presupuesto era una fila con su propio
 * botón: 60 envíos uno por uno, y "Pedido de reseña" con 39 filas donde el
 * mismo paciente aparecía varias veces. Ahora:
 *
 *  - **Una fila por paciente** en cada sección, con sus citas, visitas o
 *    presupuestos agrupados, y **un solo mensaje** que los nombra a todos.
 *  - **Un recordatorio de cita por paciente y por día de cita**: dos citas el
 *    mismo día van en un mensaje, y el servidor da por avisadas las demás de
 *    ese día cuando ya salió uno (`cubrirPorPacienteYDia`).
 *
 * Nada de esto envía: arma las filas para que el staff despache a mano
 * (invariante: nada sale solo desde un cron). La baja de WhatsApp la sigue
 * cortando el servidor al enviar.
 */

export type TipoRecordatorioDeCita = "appointment_reminder" | "appointment_checkin";
export type Canal = "whatsapp" | "email";

/** Lo mínimo de un recordatorio de cita pendiente (`PendingReminder`). */
export interface RecordatorioDeCita {
  appointmentId: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  patientEmail: string | null;
  treatmentLabel: string;
  professionalName: string;
  startsAt: string;
  fechaLarga: string;
  hora: string;
  /** `YYYY-MM-DD` de la cita en el huso de su sucursal. */
  diaLocal: string;
  reminderKind: TipoRecordatorioDeCita;
  whatsappSent: boolean;
  emailSent: boolean;
}

/** "a" · "a y b" · "a, b y c". */
export function unirConY(partes: readonly string[]): string {
  const unicas = [...new Set(partes.map((p) => p.trim()).filter(Boolean))];
  if (unicas.length <= 1) return unicas[0] ?? "";
  return `${unicas.slice(0, -1).join(", ")} y ${unicas.at(-1)}`;
}

// ─── Servidor: un recordatorio por paciente y día ─────────────────────────

/** Un recordatorio ya despachado (`messages` sent/queued), ubicado en el día de su cita. */
export interface RecordatorioEnviado {
  patientId: string;
  diaLocal: string;
  kind: TipoRecordatorioDeCita;
  channel: Canal;
}

/**
 * Marca como enviado, por canal, lo que ya quedó cubierto por otro mensaje al
 * mismo paciente para el mismo día de cita:
 *  - un recordatorio de 48h cubre los otros de 48h de ese día;
 *  - un aviso de 3h cubre los avisos y los recordatorios de ese día (el
 *    paciente ya está viniendo).
 * Devuelve solo las filas que siguen teniendo algún canal pendiente.
 */
export function cubrirPorPacienteYDia<T extends RecordatorioDeCita>(
  filas: readonly T[],
  enviados: readonly RecordatorioEnviado[],
): T[] {
  const cubre = new Set<string>();
  for (const e of enviados) {
    cubre.add(`${e.patientId}|${e.diaLocal}|${e.kind}|${e.channel}`);
    if (e.kind === "appointment_checkin") {
      cubre.add(`${e.patientId}|${e.diaLocal}|appointment_reminder|${e.channel}`);
    }
  }
  return filas
    .map((f) => {
      const base = `${f.patientId}|${f.diaLocal}|${f.reminderKind}`;
      return {
        ...f,
        whatsappSent: f.whatsappSent || cubre.has(`${base}|whatsapp`),
        emailSent: f.emailSent || cubre.has(`${base}|email`),
      };
    })
    .filter((f) => !f.whatsappSent || !f.emailSent);
}

// ─── Cliente: filas por paciente ──────────────────────────────────────────

/** Un mensaje a mandar: todas las citas de un paciente en un día, de un tipo. */
export interface EnvioDeRecordatorio<T extends RecordatorioDeCita = RecordatorioDeCita> {
  clave: string;
  kind: TipoRecordatorioDeCita;
  diaLocal: string;
  /** La primera cita del día: a ella queda asociado el mensaje. */
  principal: T;
  citas: T[];
  whatsappPendiente: boolean;
  emailPendiente: boolean;
}

export interface FilaDePaciente<T extends RecordatorioDeCita = RecordatorioDeCita> {
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  patientEmail: string | null;
  /** Normalmente uno; dos si el paciente tiene citas en dos días distintos. */
  envios: EnvioDeRecordatorio<T>[];
}

export interface RecordatoriosAgrupados<T extends RecordatorioDeCita = RecordatorioDeCita> {
  aviso3h: FilaDePaciente<T>[];
  recordatorio48h: FilaDePaciente<T>[];
}

/**
 * Una fila por paciente, en la sección más urgente donde aparezca (3h antes
 * que 48h). Dentro de la fila, un envío por día de cita: las citas del mismo
 * día salen en un solo mensaje.
 */
export function agruparRecordatorios<T extends RecordatorioDeCita>(
  filas: readonly T[],
): RecordatoriosAgrupados<T> {
  const ordenadas = [...filas].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const porPaciente = new Map<string, FilaDePaciente<T>>();
  for (const r of ordenadas) {
    let fila = porPaciente.get(r.patientId);
    if (!fila) {
      fila = {
        patientId: r.patientId,
        patientName: r.patientName,
        patientPhone: r.patientPhone,
        patientEmail: r.patientEmail,
        envios: [],
      };
      porPaciente.set(r.patientId, fila);
    }
    // Un teléfono o email que falte en una fila (baja de WhatsApp) manda.
    if (!r.patientPhone) fila.patientPhone = null;
    if (!r.patientEmail) fila.patientEmail = null;
    const clave = `${r.patientId}|${r.diaLocal}|${r.reminderKind}`;
    let envio = fila.envios.find((e) => e.clave === clave);
    if (!envio) {
      envio = {
        clave,
        kind: r.reminderKind,
        diaLocal: r.diaLocal,
        principal: r,
        citas: [],
        whatsappPendiente: false,
        emailPendiente: false,
      };
      fila.envios.push(envio);
    }
    envio.citas.push(r);
    envio.whatsappPendiente ||= !r.whatsappSent;
    envio.emailPendiente ||= !r.emailSent;
  }

  const aviso3h: FilaDePaciente<T>[] = [];
  const recordatorio48h: FilaDePaciente<T>[] = [];
  for (const fila of porPaciente.values()) {
    for (const envio of fila.envios) {
      envio.whatsappPendiente &&= Boolean(fila.patientPhone);
      envio.emailPendiente &&= Boolean(fila.patientEmail);
    }
    // El aviso de 3h va primero dentro de la fila.
    fila.envios.sort((a, b) =>
      a.kind === b.kind
        ? a.principal.startsAt.localeCompare(b.principal.startsAt)
        : a.kind === "appointment_checkin"
          ? -1
          : 1,
    );
    if (fila.envios.some((e) => e.kind === "appointment_checkin")) aviso3h.push(fila);
    else recordatorio48h.push(fila);
  }
  return { aviso3h, recordatorio48h };
}

/** Variables de la plantilla para un envío: las citas del día en un solo mensaje. */
export function variablesDeRecordatorio(
  envio: EnvioDeRecordatorio,
  clinica: string,
): Record<string, string> {
  return {
    tratamiento: unirConY(envio.citas.map((c) => c.treatmentLabel)),
    fecha_larga: envio.principal.fechaLarga,
    hora: unirConY(envio.citas.map((c) => c.hora)),
    profesional: unirConY(envio.citas.map((c) => c.professionalName)),
    clinica,
  };
}

// ─── Outreach y presupuestos: una fila por paciente ───────────────────────

export interface GrupoPorPaciente<T> {
  patientId: string;
  /** El primero que llegó (la lista ya viene en el orden que importa). */
  principal: T;
  items: T[];
}

/** Agrupa por paciente respetando el orden de llegada. */
export function agruparPorPaciente<T extends { patientId: string }>(
  items: readonly T[],
): GrupoPorPaciente<T>[] {
  const grupos = new Map<string, GrupoPorPaciente<T>>();
  for (const item of items) {
    const grupo = grupos.get(item.patientId);
    if (grupo) grupo.items.push(item);
    else grupos.set(item.patientId, { patientId: item.patientId, principal: item, items: [item] });
  }
  return [...grupos.values()];
}

/**
 * Pedido de reseña: ¿esta visita todavía puede pedirla? No si al paciente ya
 * se le pidió una reseña después de que terminó (un pedido por paciente cubre
 * sus visitas anteriores: antes cada visita de la ventana pedía la suya).
 */
export function visitaPendienteDeResena(
  visitaTerminoEn: string,
  ultimoPedidoAlPaciente: string | undefined,
): boolean {
  if (!ultimoPedidoAlPaciente) return true;
  return new Date(ultimoPedidoAlPaciente).getTime() < new Date(visitaTerminoEn).getTime();
}

// ─── Envío en tanda ───────────────────────────────────────────────────────

/** Pausa entre emails de una tanda: Resend admite pocas solicitudes por segundo. */
export const PAUSA_ENTRE_EMAILS_MS = 600;

/**
 * Despacha una lista de a uno, con pausa entre cada envío, y sigue aunque uno
 * falle (el motivo queda en el resultado). `cancelado()` corta antes del
 * siguiente. Lo usa la tanda de emails; WhatsApp por wa.me no puede ir en
 * tanda (cada mensaje lo manda una persona) y va por la cola guiada.
 */
export async function despacharEnSerie<T, R>(
  items: readonly T[],
  enviar: (item: T) => Promise<R>,
  opciones: {
    pausaMs?: number;
    esperar?: (ms: number) => Promise<void>;
    cancelado?: () => boolean;
    alAvanzar?: (
      hechos: number,
      item: T,
      resultado: { ok: true; valor: R } | { ok: false; error: string },
    ) => void;
  } = {},
): Promise<{ enviados: number; fallidos: { item: T; error: string }[]; cancelado: boolean }> {
  const pausa = opciones.pausaMs ?? PAUSA_ENTRE_EMAILS_MS;
  const esperar = opciones.esperar ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const fallidos: { item: T; error: string }[] = [];
  let enviados = 0;
  for (const [i, item] of items.entries()) {
    if (opciones.cancelado?.()) return { enviados, fallidos, cancelado: true };
    if (i > 0 && pausa > 0) await esperar(pausa);
    try {
      const valor = await enviar(item);
      enviados += 1;
      opciones.alAvanzar?.(i + 1, item, { ok: true, valor });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      fallidos.push({ item, error });
      opciones.alAvanzar?.(i + 1, item, { ok: false, error });
    }
  }
  return { enviados, fallidos, cancelado: false };
}
