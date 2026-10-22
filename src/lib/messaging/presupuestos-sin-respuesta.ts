/**
 * Presupuestos sin respuesta: los que se entregaron (enviados o en borrador)
 * y llevan N días sin aceptarse. Se arman acá y el staff los despacha a mano
 * en /recordatorios, igual que el recall, la reseña y el saldo: **nada sale
 * solo desde un cron**.
 *
 * Lógica pura (sin Supabase) para poder probarla sin base. La lectura vive
 * en `listPresupuestosSinRespuesta` (messaging.functions.ts).
 *
 * ── Por qué los borradores cuentan ────────────────────────────────────────
 * Muchas clínicas imprimen el presupuesto o lo muestran en el sillón y nunca
 * lo marcan como "enviado" en el sistema. Si solo miráramos `sent`, esos
 * presupuestos —los más comunes— no tendrían seguimiento nunca. La fila dice
 * que es un borrador para que el staff confirme que el paciente lo recibió.
 */

import { motivoParaNoEnviarWhatsApp } from "@/lib/messaging/baja-whatsapp";

const DIA_MS = 24 * 60 * 60 * 1000;

/** Días sin respuesta antes de sugerir el seguimiento, si la pantalla no pide otro valor. */
export const DIAS_SIN_RESPUESTA_POR_DEFECTO = 7;
/** Valores que ofrece el selector de /recordatorios. */
export const OPCIONES_DE_DIAS_SIN_RESPUESTA = [3, 7, 14, 30] as const;
/** Tope que acepta el servidor: más atrás, el presupuesto ya no describe nada vigente. */
export const DIAS_SIN_RESPUESTA_MAXIMO = 90;
/** No repetir el seguimiento del mismo presupuesto antes de esto. */
export const COOLDOWN_SEGUIMIENTO_MS = 14 * DIA_MS;

export type EstadoPresupuestoAbierto = "draft" | "sent";

export interface PresupuestoAbierto {
  id: string;
  patientId: string;
  number: string;
  status: EstadoPresupuestoAbierto;
  totalCents: number;
  currency: string;
  sentAt: string | null;
  createdAt: string;
  /** `YYYY-MM-DD`, o null si no tiene vencimiento. */
  validUntil: string | null;
  acceptedAt: string | null;
}

export interface PacienteContactable {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  waOptIn: boolean;
  waOptOutAt: string | null;
}

export interface PresupuestoSinRespuesta {
  quoteId: string;
  quoteNumber: string;
  quoteTotalCents: number;
  currency: string;
  estado: EstadoPresupuestoAbierto;
  /** Desde cuándo corre la espera: `sent_at`, o `created_at` en un borrador. */
  desde: string;
  diasSinRespuesta: number;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  patientEmail: string | null;
  puedeWhatsApp: boolean;
  /** Por qué no se ofrece WhatsApp (sin teléfono, sin consentimiento o baja). */
  motivoSinWhatsApp: string | null;
  puedeEmail: boolean;
}

export const MOTIVO_SIN_TELEFONO = "Sin teléfono cargado.";
export const MOTIVO_SIN_CONSENTIMIENTO =
  "Sin consentimiento de WhatsApp: el seguimiento de un presupuesto es un mensaje proactivo.";

/** Normaliza lo que llega del cliente: entero entre 1 y el máximo. */
export function normalizarDiasSinRespuesta(dias: number | null | undefined): number {
  if (dias == null || !Number.isFinite(dias)) return DIAS_SIN_RESPUESTA_POR_DEFECTO;
  return Math.min(DIAS_SIN_RESPUESTA_MAXIMO, Math.max(1, Math.trunc(dias)));
}

/**
 * ¿Por qué no se le puede escribir por WhatsApp? `null` = se puede.
 *
 * La baja (`wa_opt_out_at`) manda sobre todo y también la corta el servidor
 * al enviar (`sendWhatsAppFromTemplate`); acá se usa para no ofrecer el botón.
 */
export function motivoSinWhatsApp(paciente: PacienteContactable): string | null {
  const baja = motivoParaNoEnviarWhatsApp({ waOptOutAt: paciente.waOptOutAt, tipo: "proactivo" });
  if (baja) return baja;
  if (!paciente.phone?.trim()) return MOTIVO_SIN_TELEFONO;
  if (!paciente.waOptIn) return MOTIVO_SIN_CONSENTIMIENTO;
  return null;
}

export function calcularPresupuestosSinRespuesta(args: {
  presupuestos: PresupuestoAbierto[];
  pacientes: PacienteContactable[];
  /** Último `quote_follow_up` por presupuesto (cualquier canal), ISO. */
  ultimoSeguimientoPorPresupuesto: Map<string, string>;
  /**
   * Último `quote_follow_up` por paciente (UX-11). /recordatorios agrupa los
   * presupuestos de un paciente en un solo mensaje que los nombra a todos:
   * mientras corre el cooldown de ese mensaje, ninguno de sus presupuestos
   * vuelve a ofrecerse.
   */
  ultimoSeguimientoPorPaciente?: Map<string, string>;
  ahora: number;
  /** `YYYY-MM-DD` de hoy en el huso de la clínica, para comparar con `valid_until`. */
  hoy: string;
  dias: number;
}): PresupuestoSinRespuesta[] {
  const dias = normalizarDiasSinRespuesta(args.dias);
  const pacientePorId = new Map(args.pacientes.map((p) => [p.id, p]));
  const filas: PresupuestoSinRespuesta[] = [];

  for (const q of args.presupuestos) {
    if (q.status !== "sent" && q.status !== "draft") continue;
    if (q.acceptedAt) continue;
    // Un presupuesto en cero no tiene nada que retomar.
    if (!(q.totalCents > 0)) continue;
    // Vencido: ofrecerle al paciente un precio que ya no rige es peor que no escribirle.
    if (q.validUntil && q.validUntil < args.hoy) continue;

    const paciente = pacientePorId.get(q.patientId);
    if (!paciente) continue; // archivado o de otra clínica

    const desde = q.sentAt ?? q.createdAt;
    const esperaMs = args.ahora - new Date(desde).getTime();
    if (!(esperaMs >= dias * DIA_MS)) continue;

    const ultimo = args.ultimoSeguimientoPorPresupuesto.get(q.id);
    if (ultimo && args.ahora - new Date(ultimo).getTime() < COOLDOWN_SEGUIMIENTO_MS) continue;
    const ultimoAlPaciente = args.ultimoSeguimientoPorPaciente?.get(q.patientId);
    if (
      ultimoAlPaciente &&
      args.ahora - new Date(ultimoAlPaciente).getTime() < COOLDOWN_SEGUIMIENTO_MS
    ) {
      continue;
    }

    const motivo = motivoSinWhatsApp(paciente);
    filas.push({
      quoteId: q.id,
      quoteNumber: q.number,
      quoteTotalCents: q.totalCents,
      currency: q.currency,
      estado: q.status,
      desde,
      diasSinRespuesta: Math.floor(esperaMs / DIA_MS),
      patientId: paciente.id,
      patientName: paciente.fullName,
      patientPhone: paciente.phone,
      patientEmail: paciente.email,
      puedeWhatsApp: motivo === null,
      motivoSinWhatsApp: motivo,
      puedeEmail: Boolean(paciente.email?.trim()),
    });
  }

  // Los que más esperan, primero.
  return filas.sort((a, b) => b.diasSinRespuesta - a.diasSinRespuesta);
}
