import type { QuoteStatus } from "@/lib/finance/finance";
import { normalizarTexto } from "@/lib/search";

/**
 * Lista de presupuestos de toda la clínica (`/presupuestos`, UX-13 de la Ola
 * 0). Lógica pura: el estado que se ve, los filtros y la búsqueda.
 */
export type PresupuestoDeClinica = {
  id: string;
  number: string;
  status: QuoteStatus;
  currency: string;
  totalCents: number;
  createdAt: string;
  sentAt: string | null;
  validUntil: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  patientId: string;
  /** null = la ficha no es visible (o ya no existe). */
  patientName: string | null;
};

/** Estado que ve el usuario. "Vencido" se calcula: un presupuesto en
 * borrador o enviado cuya validez ya pasó, aunque la base diga "sent". */
export type EstadoVisible =
  "borrador" | "enviado" | "aceptado" | "convertido" | "rechazado" | "vencido";

export const ETIQUETA_ESTADO: Record<EstadoVisible, string> = {
  borrador: "Borrador",
  enviado: "Enviado",
  aceptado: "Aceptado",
  convertido: "En tratamiento",
  rechazado: "Rechazado",
  vencido: "Vencido",
};

export function estadoVisible(
  p: Pick<PresupuestoDeClinica, "status" | "validUntil">,
  hoy: string,
): EstadoVisible {
  switch (p.status) {
    case "accepted":
      return "aceptado";
    case "converted":
      return "convertido";
    case "rejected":
      return "rechazado";
    case "expired":
      return "vencido";
    case "draft":
    case "sent":
      if (p.validUntil && p.validUntil < hoy) return "vencido";
      return p.status === "draft" ? "borrador" : "enviado";
  }
}

/** Filtros de la lista. "pendientes" = lo que todavía puede aceptarse. */
export const FILTROS_ESTADO = [
  "todos",
  "pendientes",
  "aceptados",
  "rechazados",
  "vencidos",
] as const;
export type FiltroEstado = (typeof FILTROS_ESTADO)[number];

export const ETIQUETA_FILTRO: Record<FiltroEstado, string> = {
  todos: "Todos",
  pendientes: "Pendientes",
  aceptados: "Aceptados",
  rechazados: "Rechazados",
  vencidos: "Vencidos",
};

const ESTADOS_DEL_FILTRO: Record<Exclude<FiltroEstado, "todos">, readonly EstadoVisible[]> = {
  pendientes: ["borrador", "enviado"],
  aceptados: ["aceptado", "convertido"],
  rechazados: ["rechazado"],
  vencidos: ["vencido"],
};

export function leerFiltroEstado(valor: unknown): FiltroEstado {
  return typeof valor === "string" && (FILTROS_ESTADO as readonly string[]).includes(valor)
    ? (valor as FiltroEstado)
    : "todos";
}

export function filtrarPresupuestos(
  lista: readonly PresupuestoDeClinica[],
  { estado, termino, hoy }: { estado: FiltroEstado; termino: string; hoy: string },
): PresupuestoDeClinica[] {
  const t = normalizarTexto(termino);
  return lista.filter((p) => {
    if (estado !== "todos" && !ESTADOS_DEL_FILTRO[estado].includes(estadoVisible(p, hoy)))
      return false;
    if (!t) return true;
    return (
      normalizarTexto(p.patientName ?? "").includes(t) || normalizarTexto(p.number).includes(t)
    );
  });
}

/** Cuántos hay en cada filtro (para los chips). */
export function contarPorFiltro(
  lista: readonly PresupuestoDeClinica[],
  hoy: string,
): Record<FiltroEstado, number> {
  const cuenta: Record<FiltroEstado, number> = {
    todos: lista.length,
    pendientes: 0,
    aceptados: 0,
    rechazados: 0,
    vencidos: 0,
  };
  for (const p of lista) {
    const e = estadoVisible(p, hoy);
    for (const f of ["pendientes", "aceptados", "rechazados", "vencidos"] as const) {
      if (ESTADOS_DEL_FILTRO[f].includes(e)) cuenta[f] += 1;
    }
  }
  return cuenta;
}
