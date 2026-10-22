import type { QuoteStatus, TreatmentPlanStatus } from "@/lib/finance/finance";
import { estaPorVencer, estadoDelPlan, type EstadoPlan } from "@/lib/finance/estados-presupuesto";
import { normalizarTexto } from "@/lib/search";

/**
 * Vista global de presupuestos (`/presupuestos`: UX-13 de la Ola 0, extendida
 * en UX-16 de la Ola 3 con embudo, pestañas, montos, seguimiento y filtro por
 * profesional). Lógica pura: estado, pestañas, embudo y búsqueda.
 */
export type PresupuestoDeClinica = {
  id: string;
  number: string;
  status: QuoteStatus;
  currency: string;
  totalCents: number;
  /** Lo que se aceptó (total o parcial). `null` = no aceptado o base sin el dato. */
  acceptedTotalCents: number | null;
  createdAt: string;
  sentAt: string | null;
  validUntil: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  patientId: string;
  /** null = la ficha no es visible (o ya no existe). */
  patientName: string | null;
  /** `null` = sin asignar. */
  professionalId: string | null;
  professionalName: string | null;
  /** Estado del plan que creó la aceptación. `null` = sin plan. */
  planStatus: TreatmentPlanStatus | null;
  /** Último contacto: el registrado a mano o el último mensaje del presupuesto. */
  ultimoContactoAt: string | null;
  proximaAccion: string | null;
  /** `YYYY-MM-DD` */
  proximaAccionOn: string | null;
};

export function estadoDe(p: PresupuestoDeClinica, hoy: string): EstadoPlan {
  return estadoDelPlan(p, hoy);
}

/** Pestañas de la vista. "Pendientes" = lo que todavía puede aceptarse. */
export const FILTROS_ESTADO = [
  "pendientes",
  "por_vencer",
  "aceptados",
  "rechazados",
  "vencidos",
  "todos",
] as const;
export type FiltroEstado = (typeof FILTROS_ESTADO)[number];

export const ETIQUETA_FILTRO: Record<FiltroEstado, string> = {
  pendientes: "Pendientes",
  por_vencer: "Por vencer",
  aceptados: "Aceptados",
  rechazados: "Rechazados",
  vencidos: "Vencidos",
  todos: "Todos",
};

/** Pestaña que se abre sin nada en la URL: la lista de trabajo. */
export const FILTRO_POR_DEFECTO: FiltroEstado = "pendientes";

export function leerFiltroEstado(valor: unknown): FiltroEstado {
  return typeof valor === "string" && (FILTROS_ESTADO as readonly string[]).includes(valor)
    ? (valor as FiltroEstado)
    : FILTRO_POR_DEFECTO;
}

export function enFiltro(p: PresupuestoDeClinica, filtro: FiltroEstado, hoy: string): boolean {
  const e = estadoDe(p, hoy);
  switch (filtro) {
    case "todos":
      return true;
    case "pendientes":
      return e === "borrador" || e === "emitido";
    case "por_vencer":
      return (e === "borrador" || e === "emitido") && estaPorVencer(p, hoy);
    case "aceptados":
      return e === "aceptado" || e === "aceptado_parcial" || e === "finalizado";
    case "rechazados":
      return e === "rechazado";
    case "vencidos":
      return e === "vencido";
  }
}

/** Filtro por profesional: todos, sin asignar o uno en particular. */
export type FiltroProfesional = "todos" | "sin_asignar" | (string & {});

export function deProfesional(p: PresupuestoDeClinica, filtro: FiltroProfesional): boolean {
  if (filtro === "todos") return true;
  if (filtro === "sin_asignar") return p.professionalId === null;
  return p.professionalId === filtro;
}

/** Monto que cuenta para cada presupuesto: lo aceptado si se aceptó, si no el total. */
export function montoDe(p: PresupuestoDeClinica): number {
  const aceptado =
    p.status === "accepted" || p.status === "converted" || p.status === "partially_accepted";
  return aceptado ? (p.acceptedTotalCents ?? p.totalCents) : p.totalCents;
}

export function filtrarPresupuestos(
  lista: readonly PresupuestoDeClinica[],
  {
    estado,
    termino,
    hoy,
    profesional = "todos",
  }: { estado: FiltroEstado; termino: string; hoy: string; profesional?: FiltroProfesional },
): PresupuestoDeClinica[] {
  const t = normalizarTexto(termino);
  return lista.filter((p) => {
    if (!deProfesional(p, profesional)) return false;
    if (!enFiltro(p, estado, hoy)) return false;
    if (!t) return true;
    return (
      normalizarTexto(p.patientName ?? "").includes(t) || normalizarTexto(p.number).includes(t)
    );
  });
}

/** Cuántos hay y cuánto suman en cada pestaña (para los chips). */
export function resumenPorFiltro(
  lista: readonly PresupuestoDeClinica[],
  hoy: string,
): Record<FiltroEstado, { cantidad: number; montoCents: number }> {
  const out = Object.fromEntries(
    FILTROS_ESTADO.map((f) => [f, { cantidad: 0, montoCents: 0 }]),
  ) as Record<FiltroEstado, { cantidad: number; montoCents: number }>;
  for (const p of lista) {
    for (const f of FILTROS_ESTADO) {
      if (enFiltro(p, f, hoy)) {
        out[f].cantidad += 1;
        out[f].montoCents += montoDe(p);
      }
    }
  }
  return out;
}

/** Cuántos hay en cada pestaña. */
export function contarPorFiltro(
  lista: readonly PresupuestoDeClinica[],
  hoy: string,
): Record<FiltroEstado, number> {
  const r = resumenPorFiltro(lista, hoy);
  return Object.fromEntries(FILTROS_ESTADO.map((f) => [f, r[f].cantidad])) as Record<
    FiltroEstado,
    number
  >;
}

export interface Embudo {
  creados: { cantidad: number; montoCents: number };
  /** Llegaron al paciente: se emitieron, o se resolvieron (aceptados o rechazados). */
  emitidos: { cantidad: number; montoCents: number };
  aceptados: { cantidad: number; montoCents: number };
  /** aceptados / emitidos, 0-100 entero. `null` = nada emitido todavía (regla 11). */
  tasaAceptacion: number | null;
}

function fueEmitido(p: PresupuestoDeClinica): boolean {
  return (
    p.sentAt !== null ||
    ["accepted", "converted", "partially_accepted", "rejected"].includes(p.status)
  );
}

function fueAceptado(p: PresupuestoDeClinica): boolean {
  return ["accepted", "converted", "partially_accepted"].includes(p.status);
}

/**
 * Embudo creados → emitidos → aceptados, con montos. El monto de aceptados es
 * lo que efectivamente se aceptó (en una parcial, solo las líneas aceptadas).
 */
export function embudo(lista: readonly PresupuestoDeClinica[]): Embudo {
  const sumar = (
    xs: readonly PresupuestoDeClinica[],
    monto: (p: PresupuestoDeClinica) => number,
  ) => ({
    cantidad: xs.length,
    montoCents: xs.reduce((s, p) => s + monto(p), 0),
  });
  const emitidos = lista.filter(fueEmitido);
  const aceptados = lista.filter(fueAceptado);
  return {
    creados: sumar(lista, (p) => p.totalCents),
    emitidos: sumar(emitidos, (p) => p.totalCents),
    aceptados: sumar(aceptados, montoDe),
    tasaAceptacion: emitidos.length ? Math.round((aceptados.length * 100) / emitidos.length) : null,
  };
}

/** La próxima acción ya tendría que haberse hecho. */
export function seguimientoAtrasado(p: PresupuestoDeClinica, hoy: string): boolean {
  return p.proximaAccionOn !== null && p.proximaAccionOn < hoy;
}

/** El último contacto de dos fuentes (a mano y mensajes), o `null`. */
export function ultimoContacto(...fechas: (string | null | undefined)[]): string | null {
  const validas = fechas.filter((f): f is string => Boolean(f));
  if (!validas.length) return null;
  return validas.reduce((max, f) => (f > max ? f : max));
}
