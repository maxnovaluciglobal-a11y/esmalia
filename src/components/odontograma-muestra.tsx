import type { MarcaVisible } from "@/lib/clinical/odontograma-texto";
import { OPACIDAD_PLANIFICADO, hexDeMarca } from "@/lib/clinical/odontograma-reglas";
import { cn } from "@/lib/utils";

/** Muestra de color de una marca (cuadradito de la leyenda, la tabla y la historia). */
export function Muestra({ marca, className }: { marca: MarcaVisible; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-3 shrink-0 rounded-sm border border-hairline", className)}
      style={{
        backgroundColor: hexDeMarca(marca),
        opacity: marca.status === "planificado" ? OPACIDAD_PLANIFICADO : 1,
      }}
    />
  );
}
