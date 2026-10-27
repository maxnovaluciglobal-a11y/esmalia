/**
 * Correos automáticos al paciente (Ola 7 · frente B): reglas puras.
 *
 * REC-02 recordatorio N horas antes · REC-03 confirmación al agendar ·
 * REC-07 configuración por clínica · MKT-07 formulario antes de la cita ·
 * MKT-08 encuesta NPS después de la cita.
 *
 * Sin base ni red: qué correo le corresponde a qué cita en este momento, la
 * configuración y su validación, y el resumen NPS. El envío y sus frenos
 * (sandbox, baja, tutor, idempotencia) viven en `cron.server.ts`.
 *
 * WhatsApp NUNCA sale desde acá: el cron solo manda correos.
 */
import { z } from "zod";

// ─── Configuración ────────────────────────────────────────────────────────

export const MODOS_FORMULARIO = ["off", "confirmation", "reminder"] as const;
export type ModoFormulario = (typeof MODOS_FORMULARIO)[number];

/** Horas que ofrece la pantalla (la base acepta de 1 a 72, hasta dos). */
export const HORAS_RECORDATORIO_SUGERIDAS = [2, 4, 24, 48] as const;
export const MAX_FRANJAS_RECORDATORIO = 2;
export const HORAS_ENCUESTA_SUGERIDAS = [2, 3, 6, 24] as const;

export interface ConfigNotificaciones {
  confirmacion: boolean;
  /** Desde cuándo está encendida (lo fija la base): no se confirman citas anteriores. */
  confirmacionDesde: string | null;
  recordatorio: boolean;
  /** Horas antes de la cita, ordenadas de mayor a menor, sin repetir. */
  horasRecordatorio: number[];
  formulario: ModoFormulario;
  encuesta: boolean;
  encuestaDesde: string | null;
  horasEncuesta: number;
  resenaGoogleUrl: string | null;
}

/** Sin fila en la base: todo apagado. La clínica lo enciende en la pantalla. */
export const CONFIG_APAGADA: ConfigNotificaciones = {
  confirmacion: false,
  confirmacionDesde: null,
  recordatorio: false,
  horasRecordatorio: [24],
  formulario: "off",
  encuesta: false,
  encuestaDesde: null,
  horasEncuesta: 3,
  resenaGoogleUrl: null,
};

export function normalizarHoras(horas: readonly number[]): number[] {
  return [...new Set(horas.filter((h) => Number.isInteger(h) && h >= 1 && h <= 72))]
    .sort((a, b) => b - a)
    .slice(0, MAX_FRANJAS_RECORDATORIO);
}

export interface FilaConfig {
  confirmation_enabled: boolean;
  confirmation_enabled_at: string | null;
  reminder_enabled: boolean;
  reminder_hours: number[] | null;
  intake_form_mode: string;
  nps_enabled: boolean;
  nps_enabled_at: string | null;
  nps_hours_after: number;
  google_review_url: string | null;
}

export function leerConfig(fila: FilaConfig | null | undefined): ConfigNotificaciones {
  if (!fila) return CONFIG_APAGADA;
  const horas = normalizarHoras(fila.reminder_hours ?? []);
  return {
    confirmacion: fila.confirmation_enabled,
    confirmacionDesde: fila.confirmation_enabled_at,
    recordatorio: fila.reminder_enabled,
    horasRecordatorio: horas.length > 0 ? horas : [24],
    formulario: (MODOS_FORMULARIO as readonly string[]).includes(fila.intake_form_mode)
      ? (fila.intake_form_mode as ModoFormulario)
      : "off",
    encuesta: fila.nps_enabled,
    encuestaDesde: fila.nps_enabled_at,
    horasEncuesta: fila.nps_hours_after,
    resenaGoogleUrl: fila.google_review_url?.trim() || null,
  };
}

export function algoEncendido(c: ConfigNotificaciones): boolean {
  return c.confirmacion || c.recordatorio || c.encuesta;
}

const URL_RESENA = /^https:\/\/\S+$/;

/** Lo que guarda la pantalla. Lo valida el servidor (y la base de nuevo). */
export const GuardarConfigSchema = z
  .object({
    clinicId: z.string().uuid(),
    confirmacion: z.boolean(),
    recordatorio: z.boolean(),
    horasRecordatorio: z
      .array(z.number().int().min(1).max(72))
      .min(1, "Elige al menos una hora para el recordatorio.")
      .max(MAX_FRANJAS_RECORDATORIO, "Puedes elegir hasta dos recordatorios."),
    formulario: z.enum(MODOS_FORMULARIO),
    encuesta: z.boolean(),
    horasEncuesta: z.number().int().min(1).max(72),
    resenaGoogleUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || URL_RESENA.test(v), {
        message: "El link de reseña tiene que empezar con https://",
      })
      .transform((v) => (v === "" ? null : v)),
  })
  .refine((c) => c.formulario !== "confirmation" || c.confirmacion, {
    message: "Para mandar el formulario en la confirmación, enciende la confirmación.",
    path: ["formulario"],
  })
  .refine((c) => c.formulario !== "reminder" || c.recordatorio, {
    message: "Para mandar el formulario en el recordatorio, enciende el recordatorio.",
    path: ["formulario"],
  });

export type GuardarConfigInput = z.input<typeof GuardarConfigSchema>;

// ─── Qué correo corresponde ───────────────────────────────────────────────

export const TIPOS_DE_CORREO = ["confirmation", "reminder", "nps"] as const;
export type TipoDeCorreo = (typeof TIPOS_DE_CORREO)[number];

const HORA_MS = 3_600_000;

/** Estados de una cita que todavía va a ocurrir. */
const ESTADOS_FUTUROS = new Set(["tentativa", "confirmada"]);

export interface CitaParaCorreo {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
  /** REC-06: cita importada sin la casilla de recordatorios. */
  reminders_muted: boolean;
}

/** La confirmación se manda hasta 72 h después de creada la cita. */
export const CONFIRMACION_VENTANA_MS = 72 * HORA_MS;
/** No se confirma una cita que empieza en menos de una hora. */
export const CONFIRMACION_MARGEN_MS = HORA_MS;

/**
 * REC-03: ¿le corresponde la confirmación? Cita futura, creada después de
 * encender la confirmación y hace menos de 72 h (si el cron no corrió un
 * rato, se recupera; una cita vieja no recibe una "confirmación" tardía), y
 * no importada en silencio (Ola 6, `reminders_muted`).
 */
export function correspondeConfirmacion(
  cita: CitaParaCorreo,
  config: ConfigNotificaciones,
  ahora: Date,
): boolean {
  if (!config.confirmacion || !config.confirmacionDesde) return false;
  if (cita.reminders_muted || !ESTADOS_FUTUROS.has(cita.status)) return false;
  const creada = Date.parse(cita.created_at);
  const empieza = Date.parse(cita.starts_at);
  const t = ahora.getTime();
  if (Number.isNaN(creada) || Number.isNaN(empieza)) return false;
  if (creada < Date.parse(config.confirmacionDesde)) return false;
  if (t - creada > CONFIRMACION_VENTANA_MS) return false;
  return empieza - t > CONFIRMACION_MARGEN_MS;
}

/** Clave de la franja del recordatorio ("24h"): va en la clave única del envío. */
export function claveFranja(horas: number): string {
  return `${horas}h`;
}

/**
 * REC-02: ¿qué recordatorio le toca ahora? Devuelve las horas de la franja
 * (24, 2…) o null.
 *
 * Cada franja tiene su ventana y no se pisan: con [24, 2], el de 24 h sale
 * cuando faltan entre 2 y 24 h, y el de 2 h cuando faltan entre 30 min y 2 h
 * (la cuarta parte de la franja más chica: más tarde ya no sirve). Una cita
 * creada adentro de la ventana de una franja no recibe ese recordatorio: la
 * confirmación ya le dijo cuándo es.
 */
export function franjaDeRecordatorio(
  cita: CitaParaCorreo,
  config: ConfigNotificaciones,
  ahora: Date,
): number | null {
  if (!config.recordatorio) return null;
  if (cita.reminders_muted || !ESTADOS_FUTUROS.has(cita.status)) return null;
  const empieza = Date.parse(cita.starts_at);
  const creada = Date.parse(cita.created_at);
  if (Number.isNaN(empieza)) return null;
  const faltaH = (empieza - ahora.getTime()) / HORA_MS;
  const horas = normalizarHoras(config.horasRecordatorio); // de mayor a menor
  for (let i = 0; i < horas.length; i++) {
    const h = horas[i];
    const piso = i + 1 < horas.length ? horas[i + 1] : h / 4;
    if (faltaH > piso && faltaH <= h) {
      if (!Number.isNaN(creada) && creada > empieza - h * HORA_MS) return null;
      return h;
    }
  }
  return null;
}

/** La encuesta se manda hasta 72 h después de su hora; más tarde ya no. */
export const ENCUESTA_TOLERANCIA_MS = 72 * HORA_MS;

/**
 * MKT-08: ¿le corresponde la encuesta? Cita finalizada, que terminó después
 * de encender la encuesta, y pasaron las horas configuradas (sin pasarse de
 * 72 h más).
 */
export function correspondeEncuesta(
  cita: CitaParaCorreo,
  config: ConfigNotificaciones,
  ahora: Date,
): boolean {
  if (!config.encuesta || !config.encuestaDesde) return false;
  if (cita.status !== "finalizada") return false;
  const termina = Date.parse(cita.ends_at);
  if (Number.isNaN(termina)) return false;
  if (termina < Date.parse(config.encuestaDesde)) return false;
  const desde = termina + config.horasEncuesta * HORA_MS;
  const t = ahora.getTime();
  return t >= desde && t - desde <= ENCUESTA_TOLERANCIA_MS;
}

/** Un paciente no recibe más de una encuesta cada 30 días. */
export const ENCUESTA_ENFRIAMIENTO_MS = 30 * 24 * HORA_MS;

/** El formulario va en este correo? */
export function llevaFormulario(tipo: TipoDeCorreo, config: ConfigNotificaciones): boolean {
  return (
    (tipo === "confirmation" && config.formulario === "confirmation") ||
    (tipo === "reminder" && config.formulario === "reminder")
  );
}

/** El link del formulario vale hasta la hora de la cita (al menos 2 h). */
export function vencimientoFormulario(startsAt: string, ahora: Date): Date {
  return new Date(Math.max(Date.parse(startsAt), ahora.getTime() + 2 * HORA_MS));
}

/** La encuesta se puede responder durante 14 días. */
export function vencimientoEncuesta(ahora: Date): Date {
  return new Date(ahora.getTime() + 14 * 24 * HORA_MS);
}

// ─── NPS ──────────────────────────────────────────────────────────────────

export type CategoriaNps = "promotor" | "pasivo" | "detractor";

export function categoriaNps(nota: number): CategoriaNps {
  if (nota >= 9) return "promotor";
  if (nota >= 7) return "pasivo";
  return "detractor";
}

export interface ResumenNps {
  enviadas: number;
  respuestas: number;
  promotores: number;
  pasivos: number;
  detractores: number;
  /** -100 a 100, redondeado. null sin respuestas: nunca un cero inventado. */
  nps: number | null;
  /** Porcentaje de respuesta (0-100) o null si no se mandó ninguna. */
  tasaRespuesta: number | null;
}

export function resumenNps(filas: readonly { score: number | null }[]): ResumenNps {
  let promotores = 0;
  let pasivos = 0;
  let detractores = 0;
  for (const f of filas) {
    if (f.score === null || f.score === undefined) continue;
    const c = categoriaNps(f.score);
    if (c === "promotor") promotores++;
    else if (c === "pasivo") pasivos++;
    else detractores++;
  }
  const respuestas = promotores + pasivos + detractores;
  return {
    enviadas: filas.length,
    respuestas,
    promotores,
    pasivos,
    detractores,
    nps: respuestas === 0 ? null : Math.round(((promotores - detractores) / respuestas) * 100),
    tasaRespuesta: filas.length === 0 ? null : Math.round((respuestas / filas.length) * 100),
  };
}

// ─── Textos de la pantalla ────────────────────────────────────────────────

export const MOTIVO_WHATSAPP_AUTOMATICO =
  "Depende de la verificación de Meta; hoy los mensajes de WhatsApp se envían a mano desde Recordatorios.";

export function etiquetaHoras(h: number): string {
  if (h % 24 === 0) {
    const d = h / 24;
    return d === 1 ? "1 día" : `${d} días`;
  }
  return h === 1 ? "1 hora" : `${h} horas`;
}
