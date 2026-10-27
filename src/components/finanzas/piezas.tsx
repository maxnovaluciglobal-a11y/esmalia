/**
 * Piezas compartidas de las pantallas de finanzas de la Ola 10 (gastos fijos,
 * empresas con convenio y membresías): campo de formulario, selector de mes y
 * el aviso de "sin permiso para esta acción" con su motivo visible.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";

import { sumarMeses } from "@/lib/finance/gastos-fijos";
import { mesAnio } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

export const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-base outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:text-sm";

const BOTON_MES =
  "grid size-[30px] place-items-center rounded-full border border-control text-foreground/80 outline-none hover:border-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:size-11";

/** "‹ octubre 2026 ›": cambia de mes de a uno. */
export function SelectorMes({
  mes,
  onCambiar,
  className,
}: {
  mes: string;
  onCambiar: (mes: string) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Mes" className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        className={BOTON_MES}
        onClick={() => onCambiar(sumarMeses(mes, -1))}
        aria-label="Mes anterior"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <span className="min-w-[9.5rem] text-center text-sm font-semibold capitalize" aria-live="polite">
        {mesAnio(mes)}
      </span>
      <button
        type="button"
        className={BOTON_MES}
        onClick={() => onCambiar(sumarMeses(mes, 1))}
        aria-label="Mes siguiente"
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );
}
