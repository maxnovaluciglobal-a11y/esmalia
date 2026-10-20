import { useMovimiento } from "@/hooks/use-movimiento";
import { cn } from "@/lib/utils";

/**
 * "Pausar movimiento" (WCAG 2.2.2): detiene todo lo que se mueve solo en la
 * landing (marquees, flujo, checklist) y el efecto de scroll. Se recuerda en
 * este navegador (`use-movimiento.ts`). Si el sistema ya pide movimiento
 * reducido, el botón queda informativo: no hay nada que pausar.
 */
export function PausarMovimiento({ className }: { className?: string }) {
  const { pausado, reducido, alternarPausa } = useMovimiento();
  const etiqueta = pausado ? "Reanudar movimiento" : "Pausar movimiento";

  return (
    <button
      type="button"
      className={cn("lv-chip", className)}
      aria-label={etiqueta}
      onClick={alternarPausa}
      title={reducido ? "Tu sistema ya pide movimiento reducido" : undefined}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        {pausado ? <path d="M8 5l11 7-11 7z" /> : <path d="M9 6v12M15 6v12" />}
      </svg>
      <span className="lv-chip-l">{etiqueta}</span>
    </button>
  );
}
