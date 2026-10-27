/**
 * Textos de las vistas de ortodoncia (ORT-06): lista y ficha. Puros, para
 * que los componentes solo exporten componentes y se puedan probar sin DOM.
 */
import {
  ORTHO_CASE_KIND_LABELS,
  ORTHO_SYSTEM_LABELS,
  diasParaCambio,
  proximoCambioAlineador,
  type OrthoCaseConSeguimiento,
} from "@/lib/clinical/ortho";
import { formatoFecha } from "@/lib/clinic-operations/clinic-data";

/** Nombre del sistema (ORT-02), o el tipo general si todavía no se cargó. */
export function nombreDelSistema(c: Pick<OrthoCaseConSeguimiento, "system" | "kind">): string {
  return c.system ? ORTHO_SYSTEM_LABELS[c.system] : ORTHO_CASE_KIND_LABELS[c.kind];
}

/** Próximo cambio de alineador (ORT-03) en palabras; `vencido` incluye "hoy". */
export function textoCambioAlineador(
  c: Pick<
    OrthoCaseConSeguimiento,
    "alignerChangedOn" | "alignerChangeDays" | "alignerCurrent" | "alignerTotal"
  >,
  hoy: string,
): { texto: string; vencido: boolean } | null {
  const proximo = proximoCambioAlineador(c);
  const dias = diasParaCambio(proximo, hoy);
  if (dias === null || !proximo) return null;
  if (dias < 0)
    return {
      texto: `Cambio de alineador vencido hace ${-dias} ${dias === -1 ? "día" : "días"}`,
      vencido: true,
    };
  if (dias === 0) return { texto: "Cambia de alineador hoy", vencido: true };
  return {
    texto: `Próximo cambio ${formatoFecha(proximo)} (en ${dias} ${dias === 1 ? "día" : "días"})`,
    vencido: false,
  };
}
