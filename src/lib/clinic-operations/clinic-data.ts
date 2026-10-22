import { fecha, fechaLarga } from "@/lib/formato-fecha";

export type EstadoCita = "confirmada" | "en-sala" | "ausente" | "finalizada" | "tentativa";
export type EstadoPaciente = "activo" | "nuevo" | "inactivo";

export interface Sucursal {
  id: string;
  nombre: string;
  ciudad: string;
}

export interface Cita {
  id: string;
  pacienteId: string;
  paciente: string;
  tratamiento: string;
  profesionalId: string;
  sucursalId: string;
  /** ISO yyyy-mm-dd */
  fecha: string;
  /** minutos desde las 08:00 */
  inicio: number;
  duracion: number;
  estado: EstadoCita;
  prioridad?: boolean;
  /**
   * El PACIENTE avisó que viene. Eje distinto de `estado: "confirmada"`, que
   * es el visto bueno del PROFESIONAL. Los dos pueden estar en cualquier
   * combinación: una cita puede estar aceptada por el dentista y sin
   * respuesta del paciente, o al revés.
   */
  pacienteConfirmo?: boolean;
  /**
   * Box elegido para la cita (`operatory_id`, AGE-04). Ausente o null = la
   * cita no tiene box propio y, para los choques y la vista por box, vale el
   * box por defecto de su profesional.
   */
  boxId?: string | null;
  /** Nombre del box al agendarse (snapshot, regla 10). */
  box?: string | null;
}

export interface Profesional {
  id: string;
  nombre: string;
  box: string;
  /** Box por defecto (`default_operatory_id`): precarga el box de la cita. */
  boxId?: string | null;
  especialidad: string;
  sucursalId: string;
  /** Hex guardado por el profesional en /profesionales — identifica sus citas en la agenda. */
  color: string;
  /** Atiende pacientes (AGE-17): solo estos aparecen en el selector de la
   *  cita. Ausente = sí (datos de una versión anterior o sin conexión). Ver
   *  `atiendePacientes` en cita-formulario.ts. */
  atiende?: boolean;
}

export interface EventoClinico {
  /** YYYY-MM-DD (lo que ve Patty). */
  fecha: string;
  /** Instante completo (timestamptz), para mostrarlo en el huso de la clínica. */
  instante?: string;
  titulo: string;
  detalle?: string;
  tipo: "consulta" | "imagen" | "presupuesto" | "control";
  actual?: boolean;
}

export interface Paciente {
  id: string;
  nombre: string;
  documento: string;
  edad: number;
  /** YYYY-MM-DD, o null si no se cargó. `edad` es 0 en ese caso: para saber si es menor, usar esta. */
  fechaNacimiento?: string | null;
  telefono: string;
  /** true/false si Numverify confirmó (o no) la forma del número; null/undefined = nunca se validó (datos de demo no lo traen). */
  telefonoValido?: boolean | null;
  email: string;
  sucursalId: string;
  profesionalId: string;
  estado: EstadoPaciente;
  ultimaVisita: string;
  /** ISO yyyy-mm-dd de la última visita, para filtros por rango */
  ultimaVisitaISO: string;
  proximoControl: string | null;
  /** null = sin facturación registrada todavía (módulo de finanzas, fase 3) */
  saldo: number | null;
  /** null = aún no calculado (IA de predicción de ausencias, fase 4) */
  riesgoAusencia: number | null;
  etiquetas: string[];
  /** Convenio o seguro del paciente. `null` = particular, el caso más común. */
  convenioId?: string | null;
  convenioNombre?: string | null;
  /** Nº de afiliado o credencial en ese convenio. */
  convenioAfiliado?: string | null;
  foto?: string;
  resumenIA: string;
  timeline: EventoClinico[];
  /** Consentimiento para outreach proactivo por WhatsApp (recall/reseña/saldo) — no gatea los recordatorios de cita. */
  waOptIn: boolean;
  /** Código de referido (6 caracteres, único por clínica) — generado por trigger al crear el paciente. */
  referralCode: string | null;
  /** Fecha en que se archivó la ficha (LEG-08). null/undefined = activa. Archivar reemplaza a borrar. */
  archivadaEl?: string | null;
  // ── Ola 1 · Frente Pacientes (todos null en las fichas anteriores) ──
  /** FIC-01: rut | pasaporte | dni | otro. */
  documentoTipo?: "rut" | "pasaporte" | "dni" | "otro" | null;
  /** FIC-02: previsión; null = "Pendiente". */
  prevision?: "fonasa" | "isapre" | "particular" | "ffaa" | "extranjero" | "sin_prevision" | null;
  previsionTramo?: "A" | "B" | "C" | "D" | null;
  previsionInstitucion?: string | null;
  /** FIC-03: contacto de emergencia (null si no se cargó). */
  contactoEmergencia?: { nombre: string; relacion: string; telefono: string } | null;
  /** FIC-04: origen del paciente (texto de la lista de la clínica) y detalle. */
  origen?: string | null;
  origenDetalle?: string | null;
  direccion?: string | null;
  comuna?: string | null;
  /** SEG-08: lo que le falta a la ficha (solo en el listado, si se pidió). */
  faltantes?: ("prevision" | "documento" | "fechaNacimiento" | "direccion" | "anamnesis")[];
}

export const HORA_INICIO = 8;
/** Jornada base de la grilla (08:00 a 20:00). Si una cita termina más tarde,
 * la grilla se alarga hasta cubrirla (`horasDeGrilla` en agenda-hueco.ts). */
export const HORAS_VISIBLES = 12;
export const PIXELES_POR_MINUTO = 1.35;

export const etiquetaEstado: Record<EstadoCita, string> = {
  confirmada: "Confirmada",
  "en-sala": "En sala",
  ausente: "Ausente",
  finalizada: "Finalizada",
  tentativa: "Por confirmar",
};

export const etiquetaEstadoPaciente: Record<EstadoPaciente, string> = {
  activo: "Activo",
  nuevo: "Nuevo",
  inactivo: "Inactivo",
};

/** Fecha real de hoy (YYYY-MM-DD) en la zona horaria por defecto de la clínica. */
export function hoyISO(timeZone = "America/Santiago"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * La fecha que muestra la agenda: la explícita de la URL, o el hoy de la clínica.
 *
 * El default NO puede vivir en `validateSearch`, que es donde estaba: esa
 * función no tiene acceso al contexto de la ruta, así que caía al huso por
 * defecto (Chile). Para una clínica en México eso significa que entre las
 * 21:00 y medianoche —cuando en Santiago ya es el día siguiente— la agenda
 * abría en MAÑANA. El huso de la clínica sólo se conoce dentro del
 * componente, así que el default se resuelve ahí.
 */
export function fechaDeAgenda(fechaEnUrl: string, timeZone?: string): string {
  return fechaEnUrl || hoyISO(timeZone);
}

/** Guard común: acepta null/undefined/"" y strings mal formados sin explotar. */
export function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y!, (m ?? 1) - 1, d!);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Inversa de parseIsoDate: Date (hora local) → "YYYY-MM-DD". */
export function fechaAISO(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** "21 oct 2026" de una fecha civil "YYYY-MM-DD" (UX-09: delega en `formato-fecha`). */
export function formatoFecha(iso: string | null | undefined) {
  if (!parseIsoDate(iso)) return "—";
  return fecha(iso!.slice(0, 10));
}

/** "miércoles 21 de octubre" de una fecha civil "YYYY-MM-DD". */
export function formatoFechaLarga(iso: string | null | undefined) {
  if (!parseIsoDate(iso)) return "—";
  return fechaLarga(iso!.slice(0, 10));
}
