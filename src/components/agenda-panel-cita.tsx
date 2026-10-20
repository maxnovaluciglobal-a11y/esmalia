import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { DetalleCita } from "@/components/agenda-grid";
import { Button } from "@/components/ui/button";
import { useMovimiento } from "@/hooks/use-movimiento";
import {
  formatoFechaLarga,
  type Cita,
  type Profesional,
} from "@/lib/clinic-operations/clinic-data";
import { cn } from "@/lib/utils";

/**
 * Panel lateral de la cita elegida en la semana (PR 10b del plan A+).
 *
 * Es un cajón que se superpone y no achica la semana, sin capa que bloquee:
 * se puede seguir eligiendo otra cita con el panel abierto. En el celular
 * sube desde abajo. Al abrir o cambiar de cita el foco va al título; Escape
 * o la X lo cierran y el foco vuelve a la cita.
 *
 * El revelado (`clip-path`) solo corre si se puede animar: respeta
 * `prefers-reduced-motion` y "Pausar movimiento" (`useMovimiento`). Sin
 * animación, el contenido aparece entero de una vez.
 */
export function PanelCita({
  cita,
  profesional,
  allergies,
  renderAcciones,
  onCerrar,
}: {
  cita: Cita;
  profesional: Profesional;
  allergies: string[] | undefined;
  renderAcciones?: (cita: Cita, profesional: Profesional) => ReactNode;
  onCerrar: () => void;
}) {
  const { animar } = useMovimiento();
  const refTitulo = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    refTitulo.current?.focus();
  }, [cita.id]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Un popover o un diálogo abierto encima se cierra primero.
      if (
        document.querySelector(
          "[role='dialog'][data-state='open'], [data-radix-popper-content-wrapper]",
        )
      )
        return;
      onCerrar();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  return (
    <aside
      id="agenda-panel-cita"
      aria-labelledby="agenda-panel-titulo"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 max-h-[86vh] overflow-y-auto rounded-t-2xl border-t border-hairline bg-card shadow-2xl",
        "md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[400px] md:rounded-none md:border-l md:border-t-0",
      )}
    >
      <div key={cita.id} className={cn("space-y-4 p-5 md:p-6", animar && "animate-agenda-revelar")}>
        <div className="flex items-start justify-between gap-3">
          <h2
            id="agenda-panel-titulo"
            ref={refTitulo}
            tabIndex={-1}
            className="min-w-0 rounded-sm text-xs cifra capitalize text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="sr-only">Cita de {cita.paciente}, </span>
            {formatoFechaLarga(cita.fecha) || cita.fecha}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-2 -mt-2 shrink-0"
            onClick={onCerrar}
            aria-label="Cerrar el panel de la cita"
          >
            <X aria-hidden />
          </Button>
        </div>
        <DetalleCita
          cita={cita}
          profesional={profesional}
          allergies={allergies}
          renderAcciones={renderAcciones}
        />
      </div>
    </aside>
  );
}
