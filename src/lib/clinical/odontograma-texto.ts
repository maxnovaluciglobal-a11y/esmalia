/**
 * Textos y clases compartidas por las piezas del odontograma (ficha, editor
 * de varias piezas, hallazgos por tratar). Fuera de los componentes para que
 * el refresco en caliente de Vite siga funcionando.
 */
import {
  CONDITION_LABELS,
  MARK_CONSERVATION_LABELS,
  MARK_STATUS_LABELS,
  type OdontogramMark,
} from "@/lib/clinical/odontogram";
import { cn } from "@/lib/utils";

export type MarcaVisible = Pick<OdontogramMark, "condition" | "status" | "conservation">;

/** Una marca en texto: "Obturación · por realizar", "Corona · mal estado". */
export function describirMarca(m: MarcaVisible): string {
  const partes = [CONDITION_LABELS[m.condition]];
  if (m.status === "planificado") partes.push(MARK_STATUS_LABELS.planificado.toLowerCase());
  else if (m.conservation) partes.push(MARK_CONSERVATION_LABELS[m.conservation].toLowerCase());
  return partes.join(" · ");
}

/** Clases de un control segmentado chico (estado, superficie…) del odontograma. */
export const SEGMENTO = "flex rounded-lg border border-hairline p-0.5 text-xs";

export function claseOpcion(activa: boolean): string {
  return cn(
    "rounded-md px-2.5 py-1 font-medium outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring pointer-coarse:min-h-11",
    activa ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
  );
}
