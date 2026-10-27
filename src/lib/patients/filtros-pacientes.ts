/**
 * Filtros de la lista de pacientes (PAC-04, PAC-05, PAC-06 y PAC-07), sin
 * Supabase: los usan la pantalla /pacientes (sobre las fichas ya cargadas,
 * así funciona sin conexión), los segmentos guardados y el servidor cuando
 * resuelve un segmento para una campaña (`segmentos.server.ts`). Es la única
 * definición de "qué paciente entra": la lista y la campaña no pueden
 * contar distinto.
 *
 * `FiltrosDePacientes` es lo que viaja por la URL y lo que se guarda en
 * `patient_segments.filters` (jsonb). Al leerlo de cualquiera de los dos se
 * pasa por `normalizarFiltros`: una clave desconocida o un valor raro se
 * descarta en vez de romper la pantalla.
 */
import { coincide } from "@/lib/search";
import { coincideNombre } from "@/lib/patients/busqueda-tolerante";
import { esNuevaDelMes } from "@/lib/patients/cartera";
import { ETIQUETA_PREVISION, esPrevision, type Prevision } from "@/lib/patients/datos-ficha";

export const ESTADOS_DE_FILTRO = ["activo", "nuevo", "inactivo"] as const;
export type EstadoDeFiltro = (typeof ESTADOS_DE_FILTRO)[number];

/** Meses sin visita que ofrece el filtro (recall). */
export const MESES_SIN_VISITA = [6, 12, 24] as const;
export type MesesSinVisita = (typeof MESES_SIN_VISITA)[number];
/** Los que muestra el indicador de la franja. */
export const MESES_SIN_VISITA_INDICADOR: MesesSinVisita = 6;

/** "Sin previsión cargada" como opción del filtro (la ficha sin dato). */
export const PREVISION_PENDIENTE = "pendiente";
export type FiltroPrevision = Prevision | typeof PREVISION_PENDIENTE;

export interface FiltrosDePacientes {
  /** Texto libre: nombre (tolerante), documento, correo, teléfono. */
  q?: string;
  sucursal?: string;
  profesional?: string;
  estado?: EstadoDeFiltro;
  /** Última visita desde / hasta (YYYY-MM-DD). */
  desde?: string;
  hasta?: string;
  /** Debe algo (saldo > 0). Necesita `finance:view`. */
  conSaldo?: boolean;
  /** Sin próxima cita agendada. */
  sinCita?: boolean;
  /** A la ficha le falta un dato obligatorio (SEG-08). */
  incompletas?: boolean;
  /** Fichas activas (no inactivas ni archivadas). */
  activos?: boolean;
  /** Fichas creadas este mes (huso de la clínica). */
  nuevos?: boolean;
  /** Cumple años este mes. */
  cumpleMes?: boolean;
  /** Menor de 18 años hoy. */
  menores?: boolean;
  /** Previsión (o "pendiente" = sin cargar). */
  prevision?: FiltroPrevision;
  /** Tuvo visitas, pero la última fue hace más de N meses. */
  sinVisitaMeses?: MesesSinVisita;
  /** Id de una etiqueta del catálogo. */
  etiqueta?: string;
}

/** Claves en el orden en que se muestran y se serializan. */
export const CLAVES_DE_FILTRO = [
  "q",
  "sucursal",
  "profesional",
  "estado",
  "desde",
  "hasta",
  "conSaldo",
  "sinCita",
  "incompletas",
  "activos",
  "nuevos",
  "cumpleMes",
  "menores",
  "prevision",
  "sinVisitaMeses",
  "etiqueta",
] as const satisfies readonly (keyof FiltrosDePacientes)[];

/** Filtros que miran dinero: solo para quien tiene `finance:view` (regla 15). */
export const FILTROS_DE_FINANZAS = [
  "conSaldo",
] as const satisfies readonly (keyof FiltrosDePacientes)[];

const BOOLEANOS = [
  "conSaldo",
  "sinCita",
  "incompletas",
  "activos",
  "nuevos",
  "cumpleMes",
  "menores",
] as const;

const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function verdadero(v: unknown): boolean {
  return v === true || v === "1" || v === 1 || v === "true";
}

function texto(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
}

/**
 * Lo que llega de la URL o de un segmento guardado, limpio: solo claves
 * conocidas con valores válidos; lo demás se descarta. Sin claves vacías
 * (un segmento sin filtros es `{}`).
 */
export function normalizarFiltros(entrada: unknown): FiltrosDePacientes {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return {};
  const e = entrada as Record<string, unknown>;
  const f: FiltrosDePacientes = {};
  const q = texto(e.q, 120);
  if (q) f.q = q;
  const sucursal = texto(e.sucursal, 64);
  if (sucursal && UUID.test(sucursal)) f.sucursal = sucursal;
  const profesional = texto(e.profesional, 64);
  if (profesional && UUID.test(profesional)) f.profesional = profesional;
  if (typeof e.estado === "string" && (ESTADOS_DE_FILTRO as readonly string[]).includes(e.estado))
    f.estado = e.estado as EstadoDeFiltro;
  if (typeof e.desde === "string" && ISO_DIA.test(e.desde)) f.desde = e.desde;
  if (typeof e.hasta === "string" && ISO_DIA.test(e.hasta)) f.hasta = e.hasta;
  for (const clave of BOOLEANOS) if (verdadero(e[clave])) f[clave] = true;
  if (e.prevision === PREVISION_PENDIENTE || esPrevision(e.prevision))
    f.prevision = e.prevision as FiltroPrevision;
  const meses = Number(e.sinVisitaMeses);
  if ((MESES_SIN_VISITA as readonly number[]).includes(meses))
    f.sinVisitaMeses = meses as MesesSinVisita;
  const etiqueta = texto(e.etiqueta, 64);
  if (etiqueta && UUID.test(etiqueta)) f.etiqueta = etiqueta;
  return f;
}

/** ¿Hay algún filtro puesto? */
export function hayFiltros(f: FiltrosDePacientes): boolean {
  return CLAVES_DE_FILTRO.some((c) => f[c] !== undefined);
}

/** ¿El segmento o la URL usa un filtro de dinero? */
export function usaFinanzas(f: FiltrosDePacientes): boolean {
  return FILTROS_DE_FINANZAS.some((c) => f[c] !== undefined);
}

/** Saca los filtros de dinero (para quien no tiene `finance:view`). */
export function sinFiltrosDeFinanzas(f: FiltrosDePacientes): FiltrosDePacientes {
  const copia = { ...f };
  for (const c of FILTROS_DE_FINANZAS) delete copia[c];
  return copia;
}

/** Lo mínimo de una ficha que miran los filtros. */
export interface FilaFiltrable {
  nombre: string;
  documento?: string | null;
  email?: string | null;
  telefono?: string | null;
  sucursalId?: string | null;
  profesionalId?: string | null;
  estado: EstadoDeFiltro;
  /** YYYY-MM-DD o "" sin visitas. */
  ultimaVisitaISO: string;
  proximoControl: string | null;
  /** `null` = sin movimientos o sin permiso de finanzas (regla 11). */
  saldo: number | null;
  faltantes?: readonly string[];
  archivadaEl?: string | null;
  creadaEl?: string | null;
  /** YYYY-MM-DD o null. */
  fechaNacimiento?: string | null;
  prevision?: Prevision | null;
  etiquetaIds?: readonly string[];
  /** Nombres de etiquetas (las del catálogo y las libres antiguas): entran en la búsqueda. */
  etiquetas?: readonly string[];
}

export interface ContextoDeFiltro {
  /** Hoy de la clínica (YYYY-MM-DD, `hoyISO(timezone)`). */
  hoy: string;
  /** Huso de la clínica. */
  zona: string;
}

/** Edad cumplida al día `hoy` (YYYY-MM-DD); null sin fecha válida. */
export function edadEn(fechaNacimiento: string | null | undefined, hoy: string): number | null {
  if (!fechaNacimiento || !ISO_DIA.test(fechaNacimiento.slice(0, 10))) return null;
  const [y, m, d] = fechaNacimiento.slice(0, 10).split("-").map(Number);
  const [hy, hm, hd] = hoy.split("-").map(Number);
  let edad = hy - y;
  if (hm < m || (hm === m && hd < d)) edad--;
  return edad;
}

/** Cumple años en el mes de `hoy`. */
export function cumpleEsteMes(fechaNacimiento: string | null | undefined, hoy: string): boolean {
  if (!fechaNacimiento || !ISO_DIA.test(fechaNacimiento.slice(0, 10))) return false;
  return fechaNacimiento.slice(5, 7) === hoy.slice(5, 7);
}

/** `hoy` menos `meses` meses (YYYY-MM-DD); el día se ajusta al fin de mes. */
export function restarMeses(hoy: string, meses: number): string {
  const [y, m, d] = hoy.split("-").map(Number);
  const total = y * 12 + (m - 1) - meses;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

/**
 * Tuvo visitas y la última fue hace más de `meses` meses. Quien nunca vino
 * no cuenta: no es alguien que "dejó de venir" (para eso está "Sin cita
 * futura").
 */
export function sinVisitaHace(ultimaVisitaISO: string, meses: number, hoy: string): boolean {
  if (!ultimaVisitaISO) return false;
  return ultimaVisitaISO < restarMeses(hoy, meses);
}

/** ¿La ficha pasa todos los filtros? */
export function pasaFiltros(
  fila: FilaFiltrable,
  f: FiltrosDePacientes,
  ctx: ContextoDeFiltro,
): boolean {
  // PAC-02: el nombre tolera tildes y errores de tipeo; documento, correo,
  // teléfono y etiquetas, por subcadena (el RUT con o sin puntos y guion).
  if (
    f.q &&
    !coincideNombre(f.q, fila.nombre) &&
    !coincide(f.q, fila.documento, fila.email, fila.telefono, ...(fila.etiquetas ?? []))
  )
    return false;
  if (f.sucursal && fila.sucursalId !== f.sucursal) return false;
  if (f.profesional && fila.profesionalId !== f.profesional) return false;
  if (f.estado && fila.estado !== f.estado) return false;
  if (f.desde && (!fila.ultimaVisitaISO || fila.ultimaVisitaISO < f.desde)) return false;
  if (f.hasta && (!fila.ultimaVisitaISO || fila.ultimaVisitaISO > f.hasta)) return false;
  if (f.conSaldo && !(fila.saldo != null && fila.saldo > 0)) return false;
  if (f.sinCita && fila.proximoControl != null) return false;
  if (f.incompletas && !(fila.faltantes && fila.faltantes.length > 0)) return false;
  if (f.activos && (fila.archivadaEl || fila.estado === "inactivo")) return false;
  if (f.nuevos && !esNuevaDelMes(fila, ctx.hoy, ctx.zona)) return false;
  if (f.cumpleMes && !cumpleEsteMes(fila.fechaNacimiento, ctx.hoy)) return false;
  if (f.menores) {
    const edad = edadEn(fila.fechaNacimiento, ctx.hoy);
    if (edad == null || edad >= 18) return false;
  }
  if (f.prevision) {
    if (
      f.prevision === PREVISION_PENDIENTE ? fila.prevision != null : fila.prevision !== f.prevision
    )
      return false;
  }
  if (f.sinVisitaMeses && !sinVisitaHace(fila.ultimaVisitaISO, f.sinVisitaMeses, ctx.hoy))
    return false;
  if (f.etiqueta && !(fila.etiquetaIds ?? []).includes(f.etiqueta)) return false;
  return true;
}

/** Cuántas fichas pasan los filtros. */
export function contarQuienesPasan(
  filas: readonly FilaFiltrable[],
  f: FiltrosDePacientes,
  ctx: ContextoDeFiltro,
): number {
  let n = 0;
  for (const fila of filas) if (pasaFiltros(fila, f, ctx)) n++;
  return n;
}

export const ETIQUETA_FILTRO_PREVISION: Record<FiltroPrevision, string> = {
  ...ETIQUETA_PREVISION,
  [PREVISION_PENDIENTE]: "Previsión pendiente",
};

/**
 * Los filtros en palabras ("Con saldo · Menores de edad · Fonasa"), para
 * mostrar qué es un segmento. `nombres` resuelve los ids (etiqueta,
 * profesional, sucursal); un id que ya no existe se muestra como "(borrada)".
 */
export function describirFiltros(
  f: FiltrosDePacientes,
  nombres: {
    etiqueta?: (id: string) => string | undefined;
    profesional?: (id: string) => string | undefined;
    sucursal?: (id: string) => string | undefined;
  } = {},
): string[] {
  const partes: string[] = [];
  if (f.q) partes.push(`“${f.q}”`);
  if (f.sucursal) partes.push(`Sucursal ${nombres.sucursal?.(f.sucursal) ?? "(borrada)"}`);
  if (f.profesional) partes.push(nombres.profesional?.(f.profesional) ?? "Profesional (borrado)");
  if (f.estado)
    partes.push(
      { activo: "Estado activo", nuevo: "Estado nuevo", inactivo: "Inactivos" }[f.estado],
    );
  if (f.desde || f.hasta) partes.push(`Última visita ${f.desde ?? "…"} → ${f.hasta ?? "…"}`);
  if (f.activos) partes.push("Activos");
  if (f.nuevos) partes.push("Nuevos del mes");
  if (f.conSaldo) partes.push("Con saldo");
  if (f.sinCita) partes.push("Sin próxima cita");
  if (f.incompletas) partes.push("Fichas incompletas");
  if (f.cumpleMes) partes.push("Cumpleaños del mes");
  if (f.menores) partes.push("Menores de edad");
  if (f.prevision) partes.push(ETIQUETA_FILTRO_PREVISION[f.prevision]);
  if (f.sinVisitaMeses) partes.push(`Sin visita hace ${f.sinVisitaMeses} meses`);
  if (f.etiqueta) partes.push(`Etiqueta ${nombres.etiqueta?.(f.etiqueta) ?? "(borrada)"}`);
  return partes;
}
