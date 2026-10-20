/**
 * Reglas puras de los correos de ciclo de vida (sin DB, sin red).
 *
 * ⚠️ Estos correos van SOLO a la clínica (dueños y administradores). Ningún
 * proceso automático de Esmalia le escribe a un paciente: el outreach a
 * pacientes lo despacha una persona desde /recordatorios.
 *
 * Lo testea `tests/correos-ciclo-de-vida.test.ts` sin levantar Postgres.
 */

import { horasConLlamadaPendiente } from "@/lib/admin/salud-clinica";
import { horaLocal } from "@/lib/messaging/digest-diario";

export const LIFECYCLE_KINDS = [
  "welcome",
  "trial_t3",
  "trial_t0",
  "subscription_active",
  "payment_failed",
  "weekly_report",
  "onboarding_call_pending",
] as const;
export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

/**
 * Transaccional = parte del servicio contratado (no se puede dar de baja, no
 * lleva `List-Unsubscribe`). El reporte semanal es el único opcional.
 */
export const ES_TRANSACCIONAL: Record<LifecycleKind, boolean> = {
  welcome: true,
  trial_t3: true,
  trial_t0: true,
  subscription_active: true,
  payment_failed: true,
  weekly_report: false,
  // Un solo aviso por destinatario, sobre algo del servicio que contrató
  // (qué falta para activar tres funciones): sin baja, como la bienvenida.
  onboarding_call_pending: true,
};

/** Reintentos máximos de un envío que falló (columna `attempts`). */
export const MAX_INTENTOS = 3;

export const TIMEZONE_POR_DEFECTO = "America/Santiago";

// ─── Destinatarios ───────────────────────────────────────────────────────

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Dominios reservados por RFC 2606/6761 o de prueba. DypOS recibió un 422
 * diario de Resend por mandarle a `example.com`: acá ni se intenta.
 */
export function esDestinatarioReservado(email: string): boolean {
  const dominio = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!dominio) return true;
  if (["example.com", "example.org", "example.net", "localhost"].includes(dominio)) return true;
  if (/\.(example\.(com|org|net))$/.test(dominio)) return true;
  return /\.(test|invalid|localhost|example)$/.test(dominio);
}

/** Normaliza y valida. `null` = no se le puede escribir. */
export function normalizarDestinatario(email: string | null | undefined): string | null {
  const limpio = (email ?? "").trim().toLowerCase();
  if (!EMAIL_VALIDO.test(limpio)) return null;
  if (esDestinatarioReservado(limpio)) return null;
  return limpio;
}

/** Asunto en modo de prueba: deja a la vista a quién iba de verdad. */
export function asuntoDePrueba(asunto: string, destinatarioOriginal: string): string {
  return `[PRUEBA → ${destinatarioOriginal}] ${asunto}`;
}

// ─── Calendario en el huso de la clínica ─────────────────────────────────

/** Fecha local (YYYY-MM-DD) de un instante en ese huso. Huso inválido → el por defecto. */
export function fechaLocal(momento: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || TIMEZONE_POR_DEFECTO,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(momento);
  } catch {
    return fechaLocal(momento, TIMEZONE_POR_DEFECTO);
  }
}

const MS_DIA = 86_400_000;

/** Suma días a una fecha YYYY-MM-DD sin pasar por husos (aritmética en UTC). */
export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + dias * MS_DIA).toISOString().slice(0, 10);
}

/** Días entre dos fechas YYYY-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / MS_DIA);
}

/** 0 = lunes … 6 = domingo, para una fecha YYYY-MM-DD. */
export function diaDeSemana(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
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
const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** "23 de octubre" a partir de YYYY-MM-DD (sin año: el contexto lo da). */
export function fechaLarga(fecha: string): string {
  const [, m, d] = fecha.split("-").map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

/** "lunes 29 de septiembre" */
export function fechaConDia(fecha: string): string {
  return `${DIAS[diaDeSemana(fecha)]} ${fechaLarga(fecha)}`;
}

// ─── Fin del trial ───────────────────────────────────────────────────────

export interface TrialMedible {
  status: string;
  trialEnd: string | null;
  stripeSubscriptionId: string | null;
}

/**
 * ¿Toca el aviso de fin de prueba hoy, en la fecha local de la clínica?
 *
 * Solo trials sin suscripción de Stripe: si la clínica ya pasó por el
 * checkout, Stripe lleva su propio calendario y no hay nada que pedirle.
 * Se compara por FECHA local (no por horas): "termina en 3 días" tiene que
 * ser cierto mirando el calendario de la clínica, no el reloj del servidor.
 */
export function avisoDeTrialQueCorresponde(
  sub: TrialMedible,
  ahora: Date,
  timezone: string,
): { kind: "trial_t3" | "trial_t0"; fechaFin: string } | null {
  if (sub.status !== "trialing" || sub.stripeSubscriptionId || !sub.trialEnd) return null;
  const fin = new Date(sub.trialEnd);
  if (Number.isNaN(fin.getTime())) return null;
  const fechaFin = fechaLocal(fin, timezone);
  const faltan = diasEntre(fechaLocal(ahora, timezone), fechaFin);
  if (faltan === 3) return { kind: "trial_t3", fechaFin };
  if (faltan === 0) return { kind: "trial_t0", fechaFin };
  return null;
}

/**
 * Clave de idempotencia del aviso `trial_will_end` de Stripe. Lleva la fecha
 * de fin: si la prueba se extiende, el aviso nuevo sale; si Stripe repite el
 * evento (o llega por dos caminos), no.
 */
export function claveFinDePruebaStripe(subscriptionId: string, trialEndIso: string): string {
  return `stripe:${subscriptionId}:${trialEndIso.slice(0, 10)}`;
}

// ─── Llamada de puesta en marcha pendiente ───────────────────────────────

/**
 * Edad máxima de la clínica (en días desde el alta) para recibir el aviso de
 * llamada pendiente. Al desplegar, las clínicas creadas hace más de una
 * semana no reciben un correo que llega tarde: el aviso es para quien recién
 * empieza.
 */
export const DIAS_MAX_AVISO_LLAMADA = 7;

export interface InsumosAvisoLlamada {
  createdAt: string;
  onboardingCallAt: string | null;
  /** `subscriptions.status`; `null` si la clínica no tiene fila. */
  subscriptionStatus: string | null;
  isDemo: boolean;
}

/**
 * ¿Le toca a la clínica el aviso "tu llamada de puesta en marcha sigue
 * pendiente"? Reusa la regla de `/admin/clinicas` (`horasConLlamadaPendiente`:
 * 24 h desde el alta, sin llamada, sin suscripción) y además exige:
 *  - estar en prueba (`trialing`): solo ahí la llamada destraba algo
 *    (`requiereLlamadaOSuscripcion` en billing.ts), y el correo dice eso;
 *    sin fila de suscripción es una piloto anterior al trigger y no se toca;
 *  - no ser la demo;
 *  - tener menos de `DIAS_MAX_AVISO_LLAMADA` días de alta.
 * La ventana horaria y el interruptor los aplica el cron, como al resto.
 */
export function correspondeAvisoLlamada(d: InsumosAvisoLlamada, ahora: Date): boolean {
  if (d.isDemo) return false;
  if (d.subscriptionStatus !== "trialing") return false;
  const horas = horasConLlamadaPendiente(
    { createdAt: d.createdAt, onboardingCallAt: d.onboardingCallAt, suscrita: false },
    ahora,
  );
  return horas !== null && horas < DIAS_MAX_AVISO_LLAMADA * 24;
}

// ─── Reporte semanal ─────────────────────────────────────────────────────

export interface Semana {
  /** Lunes (YYYY-MM-DD). También es la clave de idempotencia. */
  desde: string;
  /** Domingo (YYYY-MM-DD). */
  hasta: string;
}

/** La semana lunes-domingo anterior a la fecha local de `ahora`. */
export function semanaAnterior(ahora: Date, timezone: string): Semana {
  const hoy = fechaLocal(ahora, timezone);
  const lunesActual = sumarDias(hoy, -diaDeSemana(hoy));
  const desde = sumarDias(lunesActual, -7);
  return { desde, hasta: sumarDias(desde, 6) };
}

/** La semana anterior a otra. */
export function semanaPrevia(s: Semana): Semana {
  return { desde: sumarDias(s.desde, -7), hasta: sumarDias(s.hasta, -7) };
}

/**
 * Ventana local en la que los correos de ciclo de vida pueden salir: desde las
 * 8:00 hasta las 20:59.
 *
 * El resumen diario usa 8:00-11:59 (`esHoraDelResumen`), pero el disparo de
 * GitHub Actions es poco fiable: entre el 11 y el 18-oct corrió 3 a 7 veces por
 * día y el lunes 12 ninguna cayó dentro de la ventana de ningún país, así que
 * el reporte semanal y los avisos de fin de prueba no salieron (CS-03). Estos
 * correos son idempotentes (`lifecycle_emails`, por destinatario y período),
 * así que abrir la ventana no puede duplicarlos: solo evita perderlos. El
 * límite de las 20:59 es para no escribirle a una clínica de noche.
 */
export const HORA_INICIO_CORREOS = 8;
export const HORA_FIN_CORREOS = 20;

export function esVentanaDeCorreos(ahora: Date, timezone: string): boolean {
  const hora = horaLocal(ahora, timezone);
  return hora >= HORA_INICIO_CORREOS && hora <= HORA_FIN_CORREOS;
}

/** ¿Es lunes en la clínica? (La hora la filtra `esVentanaDeCorreos`.) */
export function esLunesLocal(ahora: Date, timezone: string): boolean {
  return diaDeSemana(fechaLocal(ahora, timezone)) === 0;
}

export interface Variacion {
  /** "sube" | "baja" | "igual" | "sin_base" (la semana previa fue cero). */
  sentido: "sube" | "baja" | "igual" | "sin_base";
  /** Porcentaje entero, sin signo. `null` cuando no hay base para calcularlo. */
  porcentaje: number | null;
}

export function variacion(actual: number, previo: number): Variacion {
  if (actual === previo) return { sentido: "igual", porcentaje: 0 };
  if (previo === 0) return { sentido: "sin_base", porcentaje: null };
  const pct = Math.round((Math.abs(actual - previo) / previo) * 100);
  return { sentido: actual > previo ? "sube" : "baja", porcentaje: pct };
}

/**
 * Lo que necesita el reporte. Los `null` son "no hay dato", nunca cero
 * (regla 11): un cero inventado se lee como un resultado malo.
 */
export interface DatosSemana {
  clinicName: string;
  currency: string;
  semana: Semana;
  /** `null` si la clínica nunca registró un pago en Esmalia. */
  cobradoCents: number | null;
  cobradoPrevioCents: number | null;
  citasAgendadas: number;
  citasAtendidas: number;
  /** Atendidas / agendadas, 0-100. `null` sin citas. */
  tasaAsistencia: number | null;
  ausencias: number;
  ausenciasPrevias: number;
  pacientesNuevos: number;
  presupuestosCreados: number;
  presupuestosAceptados: number;
  /** Aceptados / resueltos. `null` si no hubo resueltos. */
  conversion: number | null;
  /** Deuda con más de 90 días. */
  morosidad90Cents: number;
  morosidad90Pacientes: number;
  /** Presupuestos enviados hace +7 días, sin seguimiento en los últimos 14. */
  presupuestosSinSeguimiento: number;
}

/** Sin actividad no hay correo: uno que llega vacío deja de leerse. */
export function semanaTuvoActividad(d: DatosSemana): boolean {
  return (
    d.citasAgendadas > 0 ||
    (d.cobradoCents ?? 0) > 0 ||
    d.pacientesNuevos > 0 ||
    d.presupuestosCreados > 0
  );
}

export interface AccionSugerida {
  regla: "presupuestos_sin_seguimiento" | "ausencias_en_alza" | "morosidad_90";
  titulo: string;
  detalle: string;
  ruta: string;
  enlace: string;
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/**
 * UNA sola acción, elegida por reglas fijas y en este orden. La primera que
 * aplica gana; si ninguna aplica, no hay recuadro (mejor nada que relleno).
 *  1. Presupuestos enviados hace más de 7 días sin seguimiento: es plata que
 *     se decide esta semana o se pierde.
 *  2. Ausencias en alza (al menos 2 y más que la semana anterior).
 *  3. Deudas de más de 90 días.
 */
export function elegirAccionSugerida(d: DatosSemana): AccionSugerida | null {
  if (d.presupuestosSinSeguimiento > 0) {
    const n = d.presupuestosSinSeguimiento;
    return {
      regla: "presupuestos_sin_seguimiento",
      titulo: `${n} ${plural(n, "presupuesto espera", "presupuestos esperan")} seguimiento`,
      detalle: `${plural(n, "Se envió", "Se enviaron")} hace más de 7 días y ${plural(n, "sigue", "siguen")} sin respuesta. Un mensaje a tiempo suele decidir si el tratamiento se hace; ${plural(n, "está listo", "están listos")} para enviar en Recordatorios.`,
      ruta: "/recordatorios",
      enlace: "Ir a Recordatorios",
    };
  }
  if (d.ausencias >= 2 && d.ausencias > d.ausenciasPrevias) {
    return {
      regla: "ausencias_en_alza",
      titulo: `Las ausencias subieron de ${d.ausenciasPrevias} a ${d.ausencias}`,
      detalle:
        "Revisa que las citas de esta semana tengan su recordatorio enviado: se despachan desde Recordatorios.",
      ruta: "/recordatorios",
      enlace: "Ir a Recordatorios",
    };
  }
  if (d.morosidad90Pacientes > 0) {
    const n = d.morosidad90Pacientes;
    return {
      regla: "morosidad_90",
      titulo: `${n} ${plural(n, "paciente tiene", "pacientes tienen")} deudas de más de 90 días`,
      detalle: "La lista, ordenada por antigüedad y con el saldo de cada uno, está en Morosidad.",
      ruta: "/morosidad",
      enlace: "Ver Morosidad",
    };
  }
  return null;
}

// ─── Seguimiento de presupuestos (mismo criterio que /recordatorios) ─────

/** Igual que `QUOTE_FOLLOW_UP_AFTER_MS` y `_COOLDOWN_MS` de messaging.functions.ts. */
export const SEGUIMIENTO_DESPUES_MS = 7 * MS_DIA;
export const SEGUIMIENTO_ENFRIAMIENTO_MS = 14 * MS_DIA;

/**
 * Presupuestos en estado `sent` hace más de 7 días cuyo último seguimiento
 * (si hubo) tiene más de 14. Es el mismo criterio con el que la cola de
 * /recordatorios los propone, para que el correo y la pantalla coincidan.
 */
export function contarPresupuestosSinSeguimiento(
  presupuestos: { id: string; sentAt: string | null }[],
  ultimosSeguimientos: Map<string, string>,
  ahora: Date,
): number {
  const t = ahora.getTime();
  return presupuestos.filter((q) => {
    if (!q.sentAt) return false;
    if (t - new Date(q.sentAt).getTime() < SEGUIMIENTO_DESPUES_MS) return false;
    const ultimo = ultimosSeguimientos.get(q.id);
    return !(ultimo && t - new Date(ultimo).getTime() < SEGUIMIENTO_ENFRIAMIENTO_MS);
  }).length;
}
