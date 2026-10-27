import { cn } from "@/lib/utils";
import {
  GUIA_COLOR_LABELS,
  MARGEN_LABELS,
  MATERIAL_LABELS,
  type DetalleTecnico,
} from "@/lib/clinic-operations/lab-orden-detalle";

/**
 * Ola 9 · LAB-03/04/05: color, material y margen de una orden como chips
 * chicos (los mismos en Laboratorios y en el portal del laboratorio). El
 * color va en cifra (dato), el resto en texto. Sin datos no dibuja nada.
 */
export function ChipsDetalleOrden({
  detalle,
  catalogName,
  className,
}: {
  detalle: DetalleTecnico;
  catalogName?: string | null;
  className?: string;
}) {
  const { shadeGuide, shade, material, marginType } = detalle;
  if (!shade && !material && !marginType && !catalogName) return null;
  const chip =
    "inline-flex h-6 max-w-full items-center gap-1 truncate rounded-full border border-hairline bg-secondary/60 px-2 text-xs font-medium text-foreground/80";
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Detalle técnico">
      {catalogName && (
        <li className={chip} title="Trabajo del catálogo del laboratorio">
          {catalogName}
        </li>
      )}
      {shade && shadeGuide && (
        <li className={chip} title={`Color ${GUIA_COLOR_LABELS[shadeGuide]}`}>
          <span className="cifra font-semibold text-foreground">{shade}</span>
          <span className="text-muted-foreground">
            {shadeGuide === "vita_3d_master" ? "3D-Master" : "VITA"}
          </span>
        </li>
      )}
      {material && <li className={chip}>{MATERIAL_LABELS[material]}</li>}
      {marginType && (
        <li className={chip}>
          <span className="text-muted-foreground">Margen</span> {MARGEN_LABELS[marginType]}
        </li>
      )}
    </ul>
  );
}
