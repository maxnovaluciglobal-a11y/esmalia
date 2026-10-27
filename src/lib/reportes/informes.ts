/**
 * Informes "por pregunta" (Ola 11 · frente A, INF-02 a INF-12): todo lo puro.
 *
 * Las sumas las hace Postgres (`informe_metrica`, `informe_ocupacion`,
 * `informe_uso_box`, `informe_embudo`, migración 20261107100000); acá vive
 * el catálogo de métricas y cortes (espejo de la lista cerrada del SQL), las
 * etiquetas, el orden, la comparación entre períodos y los cálculos de
 * presentación (porcentajes, mapa de calor, embudo). Probado en
 * `tests/informes-logica.test.ts`.
 *
 * Reglas que se cuidan acá:
 * - Regla 11: un porcentaje sin denominador es `null` ("Sin datos"), nunca 0.
 * - Regla 15: cada métrica declara su permiso; las de dinero exigen
 *   `finance:view` (el servidor y la base lo repiten).
 * - Regla 7: los rangos son días civiles de la clínica (YYYY-MM-DD); la
 *   aritmética va en UTC para que un cambio de horario no corra un día.
 */
import { z } from "zod";

import type { Permission } from "@/lib/access/access";
import { etiquetaEstado } from "@/lib/clinic-operations/clinic-data";
import { formatMoney, QUOTE_STATUS_LABELS, type QuoteStatus } from "@/lib/finance/finance";
import {
  rangoDePeriodo,
  sumarDias,
  type PeriodoId,
  type Rango,
} from "@/lib/finance/periodos-reporte";
import { fechaCorta, mesAnio, numero } from "@/lib/formato-fecha";
import { ETIQUETA_PREVISION, esPrevision } from "@/lib/patients/datos-ficha";

// ─── Catálogo de métricas ────────────────────────────────────────────────

export const METRICAS = [
  "citas",
  "atenciones",
  "ausencias",
  "cancelaciones",
  "horas_agendadas",
  "pacientes_nuevos",
  "presupuestos",
  "presupuestos_aceptados",
  "produccion",
  "cobrado",
  "presupuestado",
] as const;
export type Metrica = (typeof METRICAS)[number];

export type Unidad = "conteo" | "minutos" | "dinero";

export interface DefMetrica {
  label: string;
  /** Frase corta: qué cuenta exactamente. */
  descripcion: string;
  unidad: Unidad;
  permiso: Permission;
  agenda: boolean;
}

export const DEF_METRICAS: Record<Metrica, DefMetrica> = {
  citas: {
    label: "Citas",
    descripcion: "Citas del período que no se cancelaron, por la hora de inicio.",
    unidad: "conteo",
    permiso: "agenda:view",
    agenda: true,
  },
  atenciones: {
    label: "Atenciones",
    descripcion: "Citas finalizadas: el paciente vino y se atendió.",
    unidad: "conteo",
    permiso: "agenda:view",
    agenda: true,
  },
  ausencias: {
    label: "Ausencias",
    descripcion: "Citas marcadas como ausente: el paciente no vino.",
    unidad: "conteo",
    permiso: "agenda:view",
    agenda: true,
  },
  cancelaciones: {
    label: "Cancelaciones",
    descripcion: "Citas canceladas que estaban agendadas en el período.",
    unidad: "conteo",
    permiso: "agenda:view",
    agenda: true,
  },
  horas_agendadas: {
    label: "Horas agendadas",
    descripcion: "Tiempo reservado en la agenda (citas no canceladas).",
    unidad: "minutos",
    permiso: "agenda:view",
    agenda: true,
  },
  pacientes_nuevos: {
    label: "Pacientes nuevos",
    descripcion: "Fichas creadas en el período (incluye las de la reserva en línea).",
    unidad: "conteo",
    permiso: "patients:view",
    agenda: false,
  },
  presupuestos: {
    label: "Presupuestos creados",
    descripcion: "Presupuestos creados en el período, en cualquier estado.",
    unidad: "conteo",
    permiso: "treatments:view",
    agenda: false,
  },
  presupuestos_aceptados: {
    label: "Presupuestos aceptados",
    descripcion: "Presupuestos aceptados (total o parcialmente) en el período.",
    unidad: "conteo",
    permiso: "treatments:view",
    agenda: false,
  },
  produccion: {
    label: "Producción",
    descripcion: "Valor de lista de las prestaciones realizadas en el período.",
    unidad: "dinero",
    permiso: "finance:view",
    agenda: false,
  },
  cobrado: {
    label: "Cobrado",
    descripcion: "Pagos recibidos en el período, sin los reversados.",
    unidad: "dinero",
    permiso: "finance:view",
    agenda: false,
  },
  presupuestado: {
    label: "Presupuestado",
    descripcion: "Monto aceptado de los presupuestos aceptados en el período.",
    unidad: "dinero",
    permiso: "finance:view",
    agenda: false,
  },
};

export function esMetricaDeDinero(m: Metrica): boolean {
  return DEF_METRICAS[m].unidad === "dinero";
}

/** Métricas que puede pedir alguien con estos permisos efectivos. */
export function metricasVisibles(permisos: readonly Permission[]): Metrica[] {
  return METRICAS.filter((m) => permisos.includes(DEF_METRICAS[m].permiso));
}

// ─── Catálogo de cortes ──────────────────────────────────────────────────

export const CORTES = [
  "total",
  "dia",
  "semana",
  "mes",
  "dia_semana",
  "hora",
  "profesional",
  "box",
  "sucursal",
  "estado",
  "canal",
  "edad",
  "comuna",
  "prevision",
  "origen",
] as const;
export type Corte = (typeof CORTES)[number];

const CORTES_SOLO_AGENDA: readonly Corte[] = ["hora", "box", "estado", "canal"];

export const ETIQUETA_CORTE: Record<Corte, string> = {
  total: "Sin corte",
  dia: "Día",
  semana: "Semana",
  mes: "Mes",
  dia_semana: "Día de la semana",
  hora: "Hora",
  profesional: "Profesional",
  box: "Box",
  sucursal: "Sucursal",
  estado: "Estado",
  canal: "Canal",
  edad: "Edad",
  comuna: "Comuna",
  prevision: "Previsión",
  origen: "Origen",
};

/** Espejo de `informe_corte_admitido` (SQL). */
export function corteAdmitido(metrica: Metrica, corte: Corte): boolean {
  return !CORTES_SOLO_AGENDA.includes(corte) || DEF_METRICAS[metrica].agenda;
}

export function cortesDe(metrica: Metrica): Corte[] {
  return CORTES.filter((c) => corteAdmitido(metrica, c));
}

export const CORTES_DEMOGRAFICOS = ["edad", "comuna", "prevision", "origen"] as const;
export type CorteDemografico = (typeof CORTES_DEMOGRAFICOS)[number];

// ─── Comparación entre períodos (INF-02) ─────────────────────────────────

export type ModoComparacion = "anterior" | "anio";

export const ETIQUETA_COMPARACION: Record<ModoComparacion, string> = {
  anterior: "Período anterior",
  anio: "Mismo período del año pasado",
};

function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10));
  const b = Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** "2024-02-29" − 1 año → "2023-02-28" (el día que existe). */
function restarUnAnio(iso: string): string {
  const y = +iso.slice(0, 4) - 1;
  const m = +iso.slice(5, 7);
  const d = +iso.slice(8, 10);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

/**
 * El rango contra el que se compara:
 * - "anterior": misma cantidad de días, justo antes (un mes calendario
 *   completo se compara con el mes calendario anterior completo).
 * - "anio": las mismas fechas un año antes.
 */
export function rangoDeComparacion(r: Rango, modo: ModoComparacion): Rango {
  if (modo === "anio") return { desde: restarUnAnio(r.desde), hasta: restarUnAnio(r.hasta) };
  const esMesCompleto =
    r.desde.endsWith("-01") &&
    r.desde.slice(0, 7) === r.hasta.slice(0, 7) &&
    sumarDias(r.hasta, 1).endsWith("-01");
  if (esMesCompleto) {
    const hasta = sumarDias(r.desde, -1);
    return { desde: `${hasta.slice(0, 7)}-01`, hasta };
  }
  const largo = diasEntre(r.desde, r.hasta);
  const hasta = sumarDias(r.desde, -1);
  return { desde: sumarDias(hasta, -largo), hasta };
}

export interface Variacion {
  diferencia: number;
  /** % entero con signo; null si el anterior es 0 o no hay dato. */
  pct: number | null;
  sentido: "sube" | "baja" | "igual";
}

/** Variación entre dos cifras. Sin dato en alguna de las dos → null. */
export function variacion(actual: number | null, anterior: number | null): Variacion | null {
  if (actual === null || anterior === null) return null;
  const diferencia = actual - anterior;
  return {
    diferencia,
    pct: anterior === 0 ? null : Math.round((diferencia / anterior) * 100),
    sentido: diferencia > 0 ? "sube" : diferencia < 0 ? "baja" : "igual",
  };
}

// ─── Filas, etiquetas y orden ────────────────────────────────────────────

export interface FilaMetrica {
  clave: string | null;
  clave2: string | null;
  valor: number;
  n: number;
  pacientes: number;
}

export interface Nombres {
  profesionales: Record<string, string>;
  boxes: Record<string, string>;
  sucursales: Record<string, string>;
}

export const NOMBRES_VACIOS: Nombres = { profesionales: {}, boxes: {}, sucursales: {} };

export const SIN_DATO = "Sin dato";

/** Lunes primero, como la agenda. 0 = domingo (igual que Postgres y JS). */
export const DIAS_SEMANA_ORDEN = [1, 2, 3, 4, 5, 6, 0] as const;
export const NOMBRE_DIA: Record<number, string> = {
  0: "Domingo",
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
};
export const NOMBRE_DIA_CORTO: Record<number, string> = {
  0: "Dom",
  1: "Lun",
  2: "Mar",
  3: "Mié",
  4: "Jue",
  5: "Vie",
  6: "Sáb",
};

export const TRAMOS_EDAD = ["0-11", "12-17", "18-29", "30-44", "45-59", "60+"] as const;
const ETIQUETA_TRAMO: Record<string, string> = {
  "0-11": "0 a 11 años",
  "12-17": "12 a 17 años",
  "18-29": "18 a 29 años",
  "30-44": "30 a 44 años",
  "45-59": "45 a 59 años",
  "60+": "60 años o más",
};

export const ETIQUETA_CANAL: Record<string, string> = {
  reserva_en_linea: "Reserva en línea",
  otros: "Otros canales",
};

function etiquetaEstadoDe(clave: string): string {
  if (clave === "cancelada") return "Cancelada";
  if (clave in etiquetaEstado) return etiquetaEstado[clave as keyof typeof etiquetaEstado];
  if (clave in QUOTE_STATUS_LABELS) return QUOTE_STATUS_LABELS[clave as QuoteStatus];
  return clave;
}

/** Cómo se lee una clave de un corte. `null` = "Sin dato". */
export function etiquetaClave(corte: Corte, clave: string | null, nombres: Nombres): string {
  if (clave === null) {
    if (corte === "box") return "Sin box asignado";
    if (corte === "profesional") return "Sin profesional";
    if (corte === "sucursal") return "Sin sucursal";
    return SIN_DATO;
  }
  switch (corte) {
    case "total":
      return "Total";
    case "dia":
      return fechaCorta(clave);
    case "semana":
      return `Semana del ${fechaCorta(clave)}`;
    case "mes":
      return mesAnio(`${clave}-01`);
    case "dia_semana":
      return NOMBRE_DIA[Number(clave)] ?? clave;
    case "hora":
      return `${clave}:00`;
    case "profesional":
      return nombres.profesionales[clave] ?? "Profesional";
    case "box":
      return nombres.boxes[clave] ?? "Box";
    case "sucursal":
      return nombres.sucursales[clave] ?? "Sucursal";
    case "estado":
      return etiquetaEstadoDe(clave);
    case "canal":
      return ETIQUETA_CANAL[clave] ?? clave;
    case "edad":
      return ETIQUETA_TRAMO[clave] ?? clave;
    case "prevision":
      return esPrevision(clave) ? ETIQUETA_PREVISION[clave] : clave;
    case "comuna":
    case "origen":
      return clave;
  }
}

const CORTES_DE_TIEMPO: readonly Corte[] = ["dia", "semana", "mes", "hora"];

/**
 * Orden de lectura: el tiempo en orden cronológico, el día de la semana de
 * lunes a domingo, la edad por tramo; el resto de mayor a menor. "Sin dato"
 * siempre al final.
 */
export function ordenarPorCorte<T extends { clave: string | null; valor: number }>(
  corte: Corte,
  filas: readonly T[],
): T[] {
  const rango = (clave: string | null): number => {
    if (clave === null) return Number.POSITIVE_INFINITY;
    if (corte === "dia_semana") return DIAS_SEMANA_ORDEN.indexOf(Number(clave) as 0);
    if (corte === "edad") return (TRAMOS_EDAD as readonly string[]).indexOf(clave);
    return 0;
  };
  return [...filas].sort((a, b) => {
    if ((a.clave === null) !== (b.clave === null)) return a.clave === null ? 1 : -1;
    if (CORTES_DE_TIEMPO.includes(corte)) return (a.clave ?? "").localeCompare(b.clave ?? "");
    if (corte === "dia_semana" || corte === "edad") return rango(a.clave) - rango(b.clave);
    return b.valor - a.valor || (a.clave ?? "").localeCompare(b.clave ?? "");
  });
}

/** Junta las filas de un corte (suma valor, n y pacientes de clave2). */
export function totalesPorClave(filas: readonly FilaMetrica[]): FilaMetrica[] {
  const mapa = new Map<string | null, FilaMetrica>();
  for (const f of filas) {
    const prev = mapa.get(f.clave);
    if (prev) {
      prev.valor += f.valor;
      prev.n += f.n;
      prev.pacientes += f.pacientes;
    } else {
      mapa.set(f.clave, { ...f, clave2: "total" });
    }
  }
  return [...mapa.values()];
}

/** Suma de todas las filas, o null si no hay ninguna (no hay dato, no cero). */
export function totalDe(filas: readonly FilaMetrica[]): number | null {
  if (filas.length === 0) return null;
  return filas.reduce((s, f) => s + f.valor, 0);
}

/**
 * Une el período y el de comparación por clave (los días no coinciden entre
 * períodos: en cortes de tiempo se compara posición contra posición).
 */
export function unirComparacion(
  corte: Corte,
  actual: readonly FilaMetrica[],
  anterior: readonly FilaMetrica[],
): { clave: string | null; valor: number | null; anterior: number | null }[] {
  const a = ordenarPorCorte(corte, totalesPorClave(actual));
  const b = ordenarPorCorte(corte, totalesPorClave(anterior));
  if (CORTES_DE_TIEMPO.includes(corte) && corte !== "hora") {
    const largo = Math.max(a.length, b.length);
    return Array.from({ length: largo }, (_, i) => ({
      clave: a[i]?.clave ?? null,
      valor: a[i]?.valor ?? null,
      anterior: b[i]?.valor ?? null,
    })).filter((f) => f.valor !== null);
  }
  // Un período sin ningún registro no es "0 en cada fila": es sin datos.
  const previo = new Map(b.map((f) => [f.clave, f.valor]));
  const claves = new Set<string | null>([...a.map((f) => f.clave), ...previo.keys()]);
  const ordenadas = ordenarPorCorte(
    corte,
    [...claves].map((clave) => ({
      clave,
      valor: a.find((f) => f.clave === clave)?.valor ?? 0,
      anterior: previo.get(clave) ?? 0,
    })),
  );
  return ordenadas.map((f) => ({
    clave: f.clave,
    valor: a.length ? f.valor : null,
    anterior: b.length ? f.anterior : null,
  }));
}

// ─── Formato de valores ──────────────────────────────────────────────────

/** "12 h 30 min", "45 min", "3 h". */
export function formatearMinutos(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${numero(h)} h` : `${numero(h)} h ${m} min`;
}

export function formatearValor(unidad: Unidad, valor: number, currency: string): string {
  if (unidad === "dinero") return formatMoney(valor, currency);
  if (unidad === "minutos") return formatearMinutos(valor);
  return numero(valor);
}

export function textoVariacion(v: Variacion | null, unidad: Unidad, currency: string): string {
  if (!v) return "Sin datos para comparar";
  if (v.sentido === "igual") return "Igual que antes";
  const signo = v.diferencia > 0 ? "+" : "−";
  const abs = formatearValor(unidad, Math.abs(v.diferencia), currency);
  return v.pct === null ? `${signo}${abs}` : `${signo}${abs} (${signo}${Math.abs(v.pct)}%)`;
}

/** % entero o null sin denominador (regla 11). */
export function porcentaje(parte: number, total: number | null | undefined): number | null {
  if (!total || total <= 0) return null;
  return Math.round((parte / total) * 100);
}

// ─── Mapa de calor (INF-05) ──────────────────────────────────────────────

export interface FilaOcupacion {
  diaSemana: number;
  hora: number;
  citas: number;
  minutosOcupados: number;
  minutosDisponibles: number;
  dias: number;
}

export interface CeldaCalor {
  diaSemana: number;
  hora: number;
  citas: number;
  minutosOcupados: number;
  minutosDisponibles: number;
  /** null = no hay horario declarado para esa franja. */
  pct: number | null;
  /** 0 (vacío) a 4 (lleno o sobre el horario). */
  nivel: 0 | 1 | 2 | 3 | 4;
  /** Lo que se lee y lo que oye un lector de pantalla. */
  texto: string;
}

export interface MapaDeCalor {
  horas: number[];
  filas: { diaSemana: number; celdas: CeldaCalor[] }[];
  /** Hay horario declarado: el mapa mide ocupación y no solo citas. */
  conHorario: boolean;
  ocupacionTotal: number | null;
  franjaMasLlena: CeldaCalor | null;
  franjaMasLibre: CeldaCalor | null;
}

export function nivelDeOcupacion(pct: number | null, citas: number): CeldaCalor["nivel"] {
  if (pct === null) return citas > 0 ? 1 : 0;
  if (pct <= 0) return 0;
  if (pct < 35) return 1;
  if (pct < 65) return 2;
  if (pct < 90) return 3;
  return 4;
}

export function armarMapaDeCalor(filas: readonly FilaOcupacion[]): MapaDeCalor {
  const conHorario = filas.some((f) => f.minutosDisponibles > 0);
  const activas = filas.filter((f) => f.minutosOcupados > 0 || f.minutosDisponibles > 0);
  const horasUsadas = activas.map((f) => f.hora);
  const desde = horasUsadas.length ? Math.min(...horasUsadas) : 8;
  const hasta = horasUsadas.length ? Math.max(...horasUsadas) : 19;
  const horas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
  const porClave = new Map(filas.map((f) => [`${f.diaSemana}-${f.hora}`, f]));
  const todas: CeldaCalor[] = [];
  const dias = DIAS_SEMANA_ORDEN.filter((d) => activas.some((f) => f.diaSemana === d));
  const salida = dias.map((diaSemana) => ({
    diaSemana,
    celdas: horas.map((hora) => {
      const f = porClave.get(`${diaSemana}-${hora}`);
      const citas = f?.citas ?? 0;
      const ocupados = f?.minutosOcupados ?? 0;
      const disponibles = f?.minutosDisponibles ?? 0;
      const pct = disponibles > 0 ? Math.round((ocupados / disponibles) * 100) : null;
      const etiqueta = `${NOMBRE_DIA[diaSemana]} ${String(hora).padStart(2, "0")}:00`;
      const texto =
        pct !== null
          ? `${etiqueta}: ${pct}% ocupado, ${formatearMinutos(ocupados)} de ${formatearMinutos(disponibles)}`
          : ocupados > 0
            ? `${etiqueta}: ${formatearMinutos(ocupados)} agendados, sin horario declarado`
            : `${etiqueta}: sin horario ni citas`;
      const celda: CeldaCalor = {
        diaSemana,
        hora,
        citas,
        minutosOcupados: ocupados,
        minutosDisponibles: disponibles,
        pct,
        nivel: nivelDeOcupacion(pct, citas),
        texto,
      };
      todas.push(celda);
      return celda;
    }),
  }));
  const conPct = todas.filter((c) => c.pct !== null);
  const ocupados = conPct.reduce((s, c) => s + c.minutosOcupados, 0);
  const disponibles = conPct.reduce((s, c) => s + c.minutosDisponibles, 0);
  const masLlena = conPct.length
    ? conPct.reduce((m, c) => ((c.pct ?? 0) > (m.pct ?? 0) ? c : m))
    : null;
  const masLibre = conPct.length
    ? conPct.reduce((m, c) => ((c.pct ?? 0) < (m.pct ?? 0) ? c : m))
    : null;
  return {
    horas,
    filas: salida,
    conHorario,
    ocupacionTotal: porcentaje(ocupados, disponibles),
    franjaMasLlena: masLlena,
    franjaMasLibre: masLibre,
  };
}

// ─── Embudo (INF-07) ─────────────────────────────────────────────────────

export interface FilaEmbudo {
  canal: string;
  contactos: number;
  conCita: number;
  atendidos: number;
  conPresupuesto: number;
  aceptados: number;
  /** null = sin permiso de finanzas (no un cero). */
  pagados: number | null;
}

export const PASOS_EMBUDO = [
  { clave: "contactos", label: "Contacto", detalle: "Fichas nuevas" },
  { clave: "conCita", label: "Cita", detalle: "Con al menos una cita" },
  { clave: "atendidos", label: "Atención", detalle: "Vinieron a una cita" },
  { clave: "conPresupuesto", label: "Presupuesto", detalle: "Recibieron un presupuesto" },
  { clave: "aceptados", label: "Aceptado", detalle: "Aceptaron un presupuesto" },
  { clave: "pagados", label: "Pagado", detalle: "Hicieron al menos un pago" },
] as const;

export type ClavePaso = (typeof PASOS_EMBUDO)[number]["clave"];

export interface PasoEmbudo {
  clave: ClavePaso;
  label: string;
  detalle: string;
  valor: number | null;
  /** % sobre los contactos. */
  pctDelTotal: number | null;
  /** % sobre el paso anterior (dónde se cae la gente). */
  pctDelAnterior: number | null;
}

export function sumarEmbudo(filas: readonly FilaEmbudo[], canal?: string): FilaEmbudo {
  const elegidas = canal ? filas.filter((f) => f.canal === canal) : filas;
  const sinFinanzas = elegidas.some((f) => f.pagados === null);
  return {
    canal: canal ?? "todos",
    contactos: elegidas.reduce((s, f) => s + f.contactos, 0),
    conCita: elegidas.reduce((s, f) => s + f.conCita, 0),
    atendidos: elegidas.reduce((s, f) => s + f.atendidos, 0),
    conPresupuesto: elegidas.reduce((s, f) => s + f.conPresupuesto, 0),
    aceptados: elegidas.reduce((s, f) => s + f.aceptados, 0),
    pagados: sinFinanzas ? null : elegidas.reduce((s, f) => s + (f.pagados ?? 0), 0),
  };
}

export function pasosDelEmbudo(f: FilaEmbudo): PasoEmbudo[] {
  let anterior: number | null = null;
  return PASOS_EMBUDO.map((p) => {
    const valor = f[p.clave];
    const paso: PasoEmbudo = {
      clave: p.clave,
      label: p.label,
      detalle: p.detalle,
      valor,
      pctDelTotal: valor === null ? null : porcentaje(valor, f.contactos),
      pctDelAnterior: valor === null || anterior === null ? null : porcentaje(valor, anterior),
    };
    if (valor !== null) anterior = valor;
    return paso;
  });
}

/** El paso donde más se cae la gente (menor % sobre el anterior). */
export function mayorCaida(pasos: readonly PasoEmbudo[]): PasoEmbudo | null {
  const conCaida = pasos.filter((p) => p.pctDelAnterior !== null);
  if (!conCaida.length) return null;
  return conCaida.reduce((m, p) => ((p.pctDelAnterior ?? 100) < (m.pctDelAnterior ?? 100) ? p : m));
}

// ─── Equipo (INF-09), boxes (INF-06) y red (INF-10) ──────────────────────

export interface FilaEquipo {
  professionalId: string | null;
  nombre: string;
  citas: number;
  atenciones: number;
  ausencias: number;
  cancelaciones: number;
  minutos: number;
  pacientesAtendidos: number;
  /** null sin permiso de finanzas. */
  produccionCents: number | null;
}

/** Ausentismo = ausencias / (atenciones + ausencias). null sin citas cerradas. */
export function ausentismo(f: { atenciones: number; ausencias: number }): number | null {
  return porcentaje(f.ausencias, f.atenciones + f.ausencias);
}

/** Ocupación de un box: minutos usados / minutos que la sucursal abrió. */
export function ocupacionBox(
  minutosOcupados: number,
  minutosAbiertos: number | null,
): number | null {
  return porcentaje(minutosOcupados, minutosAbiertos);
}

// ─── Informes guardados (INF-04) ─────────────────────────────────────────

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ConfigInforme = z
  .object({
    metrica: z.enum(METRICAS),
    corte: z.enum(CORTES),
    corte2: z.enum(CORTES).default("total"),
    periodo: z.enum(["mes", "mes-anterior", "90-dias", "personalizado"]),
    desde: DIA.optional(),
    hasta: DIA.optional(),
    sucursal: z.string().uuid().nullable().optional(),
    profesional: z.string().uuid().nullable().optional(),
    comparar: z.enum(["anterior", "anio"]).nullable().optional(),
  })
  .refine((c) => corteAdmitido(c.metrica, c.corte) && corteAdmitido(c.metrica, c.corte2), {
    message: "Ese corte no aplica a esta métrica.",
  })
  .refine((c) => c.periodo !== "personalizado" || (c.desde && c.hasta && c.desde <= c.hasta), {
    message: "Elige las dos fechas del período.",
  });
export type ConfigInforme = z.infer<typeof ConfigInforme>;

/**
 * El rango de un informe guardado, relativo a hoy: "Este mes" guardado en
 * octubre se abre en noviembre como noviembre.
 */
export function rangoDeConfig(c: ConfigInforme, hoy: string): Rango {
  const r = rangoDePeriodo(c.periodo as PeriodoId, hoy);
  if (r) return r;
  return { desde: c.desde ?? hoy, hasta: c.hasta ?? hoy };
}

/** Nombre sugerido al guardar: "Atenciones por profesional". */
export function nombreSugerido(c: Pick<ConfigInforme, "metrica" | "corte" | "corte2">): string {
  const base = DEF_METRICAS[c.metrica].label;
  if (c.corte === "total") return base;
  const uno = `${base} por ${ETIQUETA_CORTE[c.corte].toLowerCase()}`;
  return c.corte2 === "total" ? uno : `${uno} y ${ETIQUETA_CORTE[c.corte2].toLowerCase()}`;
}
