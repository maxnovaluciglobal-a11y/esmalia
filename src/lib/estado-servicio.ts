import type {
  ComponenteServicio,
  FaseIncidente,
  ImpactoIncidente,
  Incidente,
} from "@/content/incidentes";

/**
 * Lógica pura de la página pública /estado. La página consulta /api/health
 * desde el navegador y combina la respuesta con los incidentes cargados a
 * mano en src/content/incidentes.ts.
 */

/** Lo que dice /api/health, traducido. */
export type SaludMedida = "ok" | "base-caida" | "sin-respuesta";

/** Lo que muestra la página arriba de todo. */
export type EstadoGeneral = "operativo" | "con-incidentes" | "interrumpido" | "desconocido";

export const VENTANA_HISTORIAL_DIAS = 90;

/**
 * `status` null = el fetch no llegó (sin red, timeout o servidor caído: desde
 * el navegador no se distinguen). /api/health responde 503 cuando el proceso
 * vive pero la base no contesta.
 */
export function interpretarSalud(status: number | null, cuerpo: unknown): SaludMedida {
  if (status === null) return "sin-respuesta";
  const ok =
    typeof cuerpo === "object" &&
    cuerpo !== null &&
    (cuerpo as { status?: unknown }).status === "ok";
  if (status === 200 && ok) return "ok";
  if (status === 503) return "base-caida";
  return "sin-respuesta";
}

export function incidentesEnCurso(lista: readonly Incidente[]): Incidente[] {
  return ordenarPorInicio(lista.filter((i) => i.fin === null));
}

/** Resueltos que empezaron dentro de la ventana, del más reciente al más viejo. */
export function incidentesRecientes(
  lista: readonly Incidente[],
  ahora: Date,
  dias = VENTANA_HISTORIAL_DIAS,
): Incidente[] {
  const desde = ahora.getTime() - dias * 24 * 60 * 60 * 1000;
  return ordenarPorInicio(lista.filter((i) => i.fin !== null && Date.parse(i.inicio) >= desde));
}

/**
 * `salud` null = todavía no se midió (primer render). Un incidente abierto
 * manda aunque el health dé 200: hay fallas funcionales que el health no ve
 * (docs/SLO.md, "Lo que este SLI no ve").
 */
export function estadoGeneral(
  salud: SaludMedida | null,
  lista: readonly Incidente[],
): EstadoGeneral {
  if (salud === "base-caida") return "interrumpido";
  const abiertos = incidentesEnCurso(lista);
  if (abiertos.some((i) => i.impacto === "total")) return "interrumpido";
  if (abiertos.length > 0) return "con-incidentes";
  if (salud === "ok") return "operativo";
  return "desconocido";
}

export const NOMBRE_COMPONENTE: Record<ComponenteServicio, string> = {
  aplicacion: "Aplicación",
  "base-de-datos": "Base de datos",
  "portal-pacientes": "Portal de pacientes",
  whatsapp: "WhatsApp",
  correos: "Correos",
  pagos: "Pagos y suscripciones",
};

export const NOMBRE_FASE: Record<FaseIncidente, string> = {
  investigando: "Investigando",
  identificado: "Causa identificada",
  monitoreando: "Monitoreando",
  resuelto: "Resuelto",
};

export const NOMBRE_IMPACTO: Record<ImpactoIncidente, string> = {
  menor: "Impacto menor",
  parcial: "Interrupción parcial",
  total: "Interrupción total",
};

/** Errores de forma de la lista; vacío = válida. Lo usa el test en CI. */
export function problemasDeIncidentes(lista: readonly Incidente[]): string[] {
  const problemas: string[] = [];
  const ids = new Set<string>();
  const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/;

  for (const i of lista) {
    const p = (msg: string) => problemas.push(`${i.id || "(sin id)"}: ${msg}`);
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(i.id)) p("el id debe ser AAAA-MM-DD-tema");
    if (ids.has(i.id)) p("id repetido");
    ids.add(i.id);
    if (!i.titulo.trim()) p("falta el título");
    if (i.componentes.length === 0) p("falta al menos un componente");
    if (!ISO_UTC.test(i.inicio)) p("inicio debe ser ISO en UTC (…Z)");
    if (i.fin !== null && !ISO_UTC.test(i.fin)) p("fin debe ser ISO en UTC (…Z) o null");
    if (i.fin !== null && Date.parse(i.fin) < Date.parse(i.inicio)) p("fin es anterior a inicio");
    if (i.actualizaciones.length === 0) p("falta al menos una actualización");
    for (const a of i.actualizaciones) {
      if (!ISO_UTC.test(a.fecha)) p(`actualización con fecha inválida: ${a.fecha}`);
      if (!a.mensaje.trim()) p("actualización sin mensaje");
    }
    const ultima = [...i.actualizaciones].sort((a, b) => a.fecha.localeCompare(b.fecha)).at(-1);
    if (i.fin !== null && ultima?.fase !== "resuelto")
      p("cerrado sin una actualización 'resuelto'");
    if (i.fin === null && ultima?.fase === "resuelto") p("tiene 'resuelto' pero fin es null");
  }
  return problemas;
}

function ordenarPorInicio(lista: Incidente[]): Incidente[] {
  return [...lista].sort((a, b) => b.inicio.localeCompare(a.inicio));
}
