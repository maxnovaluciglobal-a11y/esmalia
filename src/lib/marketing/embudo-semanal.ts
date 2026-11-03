// src/lib/marketing/embudo-semanal.ts
//
// Reporte semanal interno del embudo de Esmalia: los mismos seis números que el
// de MOY IQ (visitas, altas, activas, pruebas, pagos y bajas) con la variación
// contra la semana anterior, más los leads por origen. Va solo a la cuenta de
// empresa y nunca lleva datos de una clínica ni de un paciente: solo conteos.
//
// Puro: sin DB, sin red, sin `process.env`. Las lecturas y el envío están en
// `embudo-semanal.server.ts`. Definiciones: `docs/MEDICION.md`.
import { pTenue, renderCorreo, type CorreoRenderizado } from "@/lib/email/layout";
import { fechaCorta } from "@/lib/formato-fecha";

export const REPORTE_PARA = "maxnovaluciglobal@gmail.com";
export const ZONA_DEL_REPORTE = "America/Santiago";

/**
 * Ventana de envío de los lunes, hora de Chile. Se reporta desde las 12:00 y
 * las horas siguientes son reintentos: Resend deduplica por semana.
 */
const HORA_DE_ENVIO = 12;
const ULTIMA_HORA_DE_REINTENTO = 16;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Estados de cita que cuentan como gestionada (North Star, `docs/MEDICION.md`). */
export const ESTADOS_DE_CITA_GESTIONADA = [
  "confirmada",
  "en-sala",
  "finalizada",
  "ausente",
] as const;

export type ClaveMetrica = "visitas" | "altas" | "activas" | "pruebas" | "pagos" | "bajas";
export type Metricas = Record<ClaveMetrica, number>;

/** Metas aprobadas por Walter el 02-nov-2026 (propuesta GOB-05 de la auditoría 360). */
export const FECHA_DE_LAS_METAS = "31-dic-2026";

export const FILAS_DEL_REPORTE: {
  clave: ClaveMetrica;
  titulo: string;
  ayuda: string;
  meta?: string;
}[] = [
  { clave: "visitas", titulo: "Visitas al sitio", ayuda: "sesiones en páginas públicas" },
  { clave: "altas", titulo: "Altas", ayuda: "cuentas nuevas registradas" },
  {
    clave: "activas",
    titulo: "Clínicas activas",
    ayuda: "con al menos una cita gestionada",
    meta: "3 clínicas piloto activas",
  },
  { clave: "pruebas", titulo: "Pruebas iniciadas", ayuda: "suscripciones en prueba" },
  {
    clave: "pagos",
    titulo: "Pagos",
    ayuda: "clínicas que pasaron a pago",
    meta: "1 clínica pagando",
  },
  { clave: "bajas", titulo: "Bajas", ayuda: "cancelaciones pedidas o aplicadas" },
];

export interface EventoDeMedicion {
  name: string;
  session_hash: string | null;
  props: unknown;
  created_at: string;
}

export interface EventoDeStripe {
  type: string;
  clinic_id: string | null;
  raw: unknown;
  received_at: string;
}

export interface FilaDeLead {
  origen: string;
  emails: number;
  conConsentimiento: number;
}

export interface DatosDelReporte {
  semana: string;
  actual: Metricas;
  anterior: Metricas;
  leads: FilaDeLead[];
  leadsAnterior: FilaDeLead[];
}

export interface RangoSemanal {
  desde: string;
  hasta: string;
}

function fechaEnZona(ahora: Date, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

function restarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) - dias * DIA_MS).toISOString().slice(0, 10);
}

/** Lunes de la semana que terminó antes de `ahora`, en hora de Chile. */
export function semanaReportada(ahora: Date = new Date()): string {
  const hoy = fechaEnZona(ahora, ZONA_DEL_REPORTE);
  const diaDeLaSemana = (new Date(`${hoy}T00:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
  return restarDias(hoy, diaDeLaSemana + 7);
}

export function semanaAnterior(semana: string): string {
  return restarDias(semana, 7);
}

/** Instante UTC de las 00:00 de `fecha` en hora de Chile. */
function medianocheEnChile(fecha: string): Date {
  const utc = new Date(`${fecha}T00:00:00Z`);
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_DEL_REPORTE,
    hourCycle: "h23",
    hour: "numeric",
    day: "numeric",
  }).formatToParts(utc);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  // A las 00:00 UTC en Chile siempre es la noche del día anterior.
  const horasDeAtraso = valor("day") === utc.getUTCDate() ? 0 : 24 - valor("hour");
  return new Date(utc.getTime() + horasDeAtraso * 60 * 60 * 1000);
}

/** Rango [desde, hasta) de la semana, de lunes a domingo en hora de Chile. */
export function rangoDeLaSemana(semana: string): RangoSemanal {
  return {
    desde: medianocheEnChile(semana).toISOString(),
    hasta: medianocheEnChile(restarDias(semana, -7)).toISOString(),
  };
}

export function tocaEnviar(ahora: Date = new Date()): boolean {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_DEL_REPORTE,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(ahora);
  const dia = partes.find((p) => p.type === "weekday")?.value;
  const hora = Number(partes.find((p) => p.type === "hour")?.value);
  return dia === "Mon" && hora >= HORA_DE_ENVIO && hora <= ULTIMA_HORA_DE_REINTENTO;
}

export function etiquetaDeSemana(semana: string): string {
  const fin = restarDias(semana, -6);
  return `${fechaCorta(semana)} al ${fechaCorta(fin)} de ${fin.slice(0, 4)}`;
}

/** "+3 (+50 %)", "−2 (−40 %)" o "sin cambio". */
export function variacion(actual: number, anterior: number): string {
  const diferencia = actual - anterior;
  if (diferencia === 0) return "sin cambio";
  const signo = diferencia > 0 ? "+" : "−";
  const porcentaje =
    anterior > 0 ? ` (${signo}${Math.round((Math.abs(diferencia) / anterior) * 100)} %)` : "";
  return `${signo}${Math.abs(diferencia)}${porcentaje}`;
}

function propsDe(valor: unknown): Record<string, unknown> {
  return typeof valor === "object" && valor !== null ? (valor as Record<string, unknown>) : {};
}

function dentroDe(instante: string, rango: RangoSemanal): boolean {
  const t = Date.parse(instante);
  return t >= Date.parse(rango.desde) && t < Date.parse(rango.hasta);
}

/** `true` si el evento de Stripe, en modo real, es una clínica que pasó a pago. */
function esPasoAPago(evento: EventoDeStripe): boolean {
  const raw = propsDe(evento.raw);
  if (raw.livemode !== true) return false;
  const data = propsDe(raw.data);
  const suscripcion = propsDe(data.object);
  if (suscripcion.status !== "active") return false;
  if (evento.type === "customer.subscription.created") return true;
  const cambios = propsDe(data.previous_attributes);
  return evento.type === "customer.subscription.updated" && cambios.status === "trialing";
}

/** `true` si el evento de Stripe, en modo real, es un pedido de baja o una baja. */
function esBaja(evento: EventoDeStripe): boolean {
  const raw = propsDe(evento.raw);
  if (raw.livemode !== true) return false;
  if (evento.type === "customer.subscription.deleted") return true;
  if (evento.type !== "customer.subscription.updated") return false;
  const data = propsDe(raw.data);
  return (
    propsDe(data.object).cancel_at_period_end === true &&
    propsDe(data.previous_attributes).cancel_at_period_end === false
  );
}

export interface EntradaDeMetricas {
  eventos: EventoDeMedicion[];
  stripe: EventoDeStripe[];
  /** Clínicas reales con al menos una cita gestionada en esta semana. */
  clinicasActivas: number;
  /** Clínicas demo o de cuentas internas: sus eventos de Stripe no cuentan. */
  clinicasInternas: ReadonlySet<string>;
}

export function calcularMetricas(entrada: EntradaDeMetricas, rango: RangoSemanal): Metricas {
  const sesiones = new Set<string>();
  let altas = 0;
  let pruebas = 0;
  for (const evento of entrada.eventos) {
    if (!dentroDe(evento.created_at, rango)) continue;
    const props = propsDe(evento.props);
    if (props.interno === true) continue;
    if (evento.name === "page_view" && evento.session_hash) sesiones.add(evento.session_hash);
    if (evento.name === "registro_completado") altas += 1;
    if (evento.name === "suscripcion_activada" && props.estado === "trialing") pruebas += 1;
  }

  const pagos = new Set<string>();
  const bajas = new Set<string>();
  for (const evento of entrada.stripe) {
    if (!evento.clinic_id || entrada.clinicasInternas.has(evento.clinic_id)) continue;
    if (!dentroDe(evento.received_at, rango)) continue;
    if (esPasoAPago(evento)) pagos.add(evento.clinic_id);
    if (esBaja(evento)) bajas.add(evento.clinic_id);
  }

  return {
    visitas: sesiones.size,
    altas,
    activas: entrada.clinicasActivas,
    pruebas,
    pagos: pagos.size,
    bajas: bajas.size,
  };
}

export interface LeadDelReporte {
  source: string | null;
  email: string | null;
  consent_at: string | null;
  created_at: string;
}

/** Contactos únicos por origen, sin los correos internos. */
export function leadsPorOrigen(
  leads: LeadDelReporte[],
  rango: RangoSemanal,
  esInterno: (email: string) => boolean,
): FilaDeLead[] {
  const porOrigen = new Map<string, { emails: Set<string>; conConsentimiento: Set<string> }>();
  for (const lead of leads) {
    if (!lead.email || !dentroDe(lead.created_at, rango) || esInterno(lead.email)) continue;
    const email = lead.email.trim().toLowerCase();
    const origen = lead.source ?? "sin origen";
    const fila = porOrigen.get(origen) ?? {
      emails: new Set<string>(),
      conConsentimiento: new Set<string>(),
    };
    fila.emails.add(email);
    if (lead.consent_at) fila.conConsentimiento.add(email);
    porOrigen.set(origen, fila);
  }
  return [...porOrigen.entries()]
    .map(([origen, fila]) => ({
      origen,
      emails: fila.emails.size,
      conConsentimiento: fila.conConsentimiento.size,
    }))
    .sort((a, b) => a.origen.localeCompare(b.origen));
}

function tonoDeVariacion(
  clave: ClaveMetrica,
  actual: number,
  anterior: number,
): "sube" | "baja" | "neutro" {
  if (actual === anterior) return "neutro";
  const subio = actual > anterior;
  return (clave === "bajas" ? !subio : subio) ? "sube" : "baja";
}

export function armarReporte(
  datos: DatosDelReporte,
  opciones: { appUrl: string; vistaPrevia?: boolean },
): CorreoRenderizado {
  const etiqueta = etiquetaDeSemana(datos.semana);
  const { actual, anterior } = datos;
  const leadsPrevios = new Map(datos.leadsAnterior.map((f) => [f.origen, f.emails]));
  return renderCorreo({
    appUrl: opciones.appUrl,
    asunto: `${opciones.vistaPrevia ? "[Vista previa] " : ""}Esmalia · embudo semanal · ${etiqueta}`,
    preencabezado: `Visitas ${actual.visitas} · Altas ${actual.altas} · Pruebas ${actual.pruebas} · Pagos ${actual.pagos}`,
    titulo: `Embudo del ${etiqueta}`,
    bajada: "Reporte semanal",
    bloques: [
      pTenue(
        "Semana de lunes a domingo (hora de Chile), sin cuentas internas, demo ni de prueba. La variación compara con la semana anterior.",
      ),
      {
        tipo: "cuadro",
        encabezados: ["Número", "Semana", "Anterior", "Variación"],
        filas: FILAS_DEL_REPORTE.map(({ clave, titulo, ayuda, meta }) => ({
          titulo,
          nota: ayuda,
          ...(meta ? { meta: `Meta al ${FECHA_DE_LAS_METAS}: ${meta}` } : {}),
          celdas: [String(actual[clave]), String(anterior[clave])],
          cierre: variacion(actual[clave], anterior[clave]),
          tono: tonoDeVariacion(clave, actual[clave], anterior[clave]),
        })),
      },
      { tipo: "subtitulo", texto: "Leads por origen" },
      datos.leads.length > 0
        ? {
            tipo: "cuadro",
            encabezados: ["Origen", "Emails", "Con consentimiento", "Variación"],
            filas: datos.leads.map((f) => ({
              titulo: f.origen,
              celdas: [String(f.emails), String(f.conConsentimiento)],
              cierre: variacion(f.emails, leadsPrevios.get(f.origen) ?? 0),
            })),
          }
        : pTenue("Sin leads nuevos esta semana."),
      pTenue(
        "Clínicas activas usa la definición de la North Star: suscripción en prueba o activa y al menos una cita gestionada en la semana. Pagos y bajas salen de eventos reales de Stripe, sin modo de prueba.",
      ),
    ],
    pie: {
      motivo: `Reporte interno de Esmalia, solo para ${REPORTE_PARA}. Se envía los lunes a las 12 (hora de Chile).`,
    },
  });
}
