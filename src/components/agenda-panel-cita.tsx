import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { DetalleCita } from "@/components/agenda-grid";
import { CajonCita, useContextoCajonCita } from "@/components/agenda-cajon-cita";
import { useMovimiento } from "@/hooks/use-movimiento";
import type { Conflicto } from "@/components/agenda-conflictos";
import {
  formatoFechaLarga,
  type Cita,
  type Profesional,
} from "@/lib/clinic-operations/clinic-data";
import { cn } from "@/lib/utils";

/**
 * Cajón lateral de la cita elegida (día, semana y box; PR 10b del plan A+ y
 * pase de fidelidad del 26-oct).
 *
 * Se superpone a la derecha y no achica la semana, sin capa que bloquee: se
 * puede seguir eligiendo otra cita con el cajón abierto. En el celular sube
 * desde abajo como hoja, con un velo que la cierra al tocar afuera. Al abrir
 * o cambiar de cita el foco va al título; Escape o la X lo cierran y el foco
 * vuelve a la cita.
 *
 * Con el contexto de la agenda (`ProveedorCajonCita`) muestra el cajón
 * completo (`CajonCita`); sin él, el resumen de siempre (`DetalleCita`).
 *
 * El revelado (`clip-path`) solo corre si se puede animar: respeta
 * `prefers-reduced-motion` y "Pausar movimiento" (`useMovimiento`). Es
 * movimiento como respuesta a un clic, nunca de fondo.
 */
export function PanelCita({
  cita,
  profesional,
  allergies,
  renderAcciones,
  conflictos,
  nombreProfesional,
  onCerrar,
}: {
  cita: Cita;
  profesional: Profesional;
  allergies: string[] | undefined;
  renderAcciones?: (cita: Cita, profesional: Profesional) => ReactNode;
  conflictos?: Conflicto[];
  nombreProfesional?: (id: string) => string;
  onCerrar: () => void;
}) {
  const { animar } = useMovimiento();
  const refTitulo = useRef<HTMLHeadingElement>(null);
  const ctx = useContextoCajonCita();

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
    <>
      <div
        aria-hidden="true"
        onClick={onCerrar}
        className="fixed inset-0 z-40 bg-foreground/30 md:hidden"
      />
      <aside
        id="agenda-panel-cita"
        aria-labelledby="agenda-panel-titulo"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 max-h-[86dvh] overflow-y-auto overscroll-contain rounded-t-[18px] border-t border-border bg-card pb-[env(safe-area-inset-bottom)] text-base shadow-2xl",
          "md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[400px] md:rounded-none md:border-l md:border-t-0",
        )}
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-10 rounded-full bg-border md:hidden"
        />
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar el panel de la cita"
          className="sticky top-3 z-10 float-right mr-3 mt-3 grid size-[42px] place-items-center rounded-full border border-border bg-card text-foreground transition-colors hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X aria-hidden className="size-[17px]" strokeWidth={1.8} />
        </button>
        <div
          key={cita.id}
          className={cn(
            "px-[26px] pb-[30px] pt-6 md:pt-[52px]",
            animar && "animate-agenda-revelar",
          )}
        >
          {ctx ? (
            <CajonCita
              ctx={ctx}
              cita={cita}
              profesional={profesional}
              allergies={allergies}
              conflictos={conflictos}
              nombreProfesional={nombreProfesional}
              renderAcciones={renderAcciones}
              refTitulo={refTitulo}
            />
          ) : (
            <div className="space-y-4">
              <h2
                id="agenda-panel-titulo"
                ref={refTitulo}
                tabIndex={-1}
                className="min-w-0 rounded-sm text-xs cifra capitalize text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="sr-only">Cita de {cita.paciente}, </span>
                {formatoFechaLarga(cita.fecha) || cita.fecha}
              </h2>
              <DetalleCita
                cita={cita}
                profesional={profesional}
                allergies={allergies}
                renderAcciones={renderAcciones}
                conflictos={conflictos}
                nombreProfesional={nombreProfesional}
              />
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
