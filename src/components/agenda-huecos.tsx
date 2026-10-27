import type { MouseEvent } from "react";

import { horaDeMinutos } from "@/components/agenda-hueco";
import { cn } from "@/lib/utils";

/** Rayado ocre del prototipo A+ para los huecos libres. */
const RAYADO_HUECO =
  "bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--color-brand)_22%,transparent)_0_2px,transparent_2px_7px)]";

/** Rayado neutro de la colación. */
export const RAYADO_COLACION =
  "bg-[repeating-linear-gradient(135deg,var(--color-border)_0_1px,transparent_1px_8px)]";

/**
 * Huecos significativos de un carril (`huecosSignificativos`), rayados en
 * ocre con "Hueco · N min". Con `onAgendar` cada hueco es un botón que abre
 * "Nueva cita" en esa hora; sin permiso de agenda es solo una marca.
 */
export function HuecosDelCarril({
  huecos,
  desde,
  pxPorMinuto,
  nombreProfesional,
  onAgendar,
}: {
  huecos: readonly { inicio: number; fin: number }[];
  desde: number;
  pxPorMinuto: number;
  nombreProfesional: string;
  onAgendar?: (inicio: number, origen: HTMLElement) => void;
}) {
  return (
    <>
      {huecos.map((h) => {
        const minutos = h.fin - h.inicio;
        const clase = cn(
          "@container absolute inset-x-[3px] flex flex-col justify-center overflow-hidden rounded-lg border border-dashed border-brand-600 px-1.5 text-left leading-tight text-brand-700",
          RAYADO_HUECO,
        );
        const estilo = {
          top: (h.inicio - desde) * pxPorMinuto + 1,
          height: minutos * pxPorMinuto - 3,
        };
        // Carril angosto (semana con varios profesionales): solo "45′".
        const contenido =
          minutos * pxPorMinuto < 26 ? null : (
            <>
              <span className="hidden text-[11px] font-semibold @[5.5rem]:block">Hueco</span>
              <span className="cifra whitespace-nowrap text-[11px]">
                {minutos}
                <span className="@[5.5rem]:hidden">′</span>
                <span className="hidden @[5.5rem]:inline"> min</span>
              </span>
            </>
          );
        const etiqueta = `Hueco de ${minutos} minutos con ${nombreProfesional} desde las ${horaDeMinutos(h.inicio)}`;
        if (!onAgendar) {
          return (
            <div
              key={h.inicio}
              role="img"
              aria-label={etiqueta}
              className={cn(clase, "pointer-events-none")}
              style={estilo}
            >
              {contenido}
            </div>
          );
        }
        return (
          <button
            key={h.inicio}
            type="button"
            aria-label={`${etiqueta}. Agendar aquí`}
            title="Agendar aquí"
            onClick={(e: MouseEvent<HTMLButtonElement>) => onAgendar(h.inicio, e.currentTarget)}
            className={cn(
              clase,
              "cursor-pointer transition-colors hover:bg-brand-soft focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            )}
            style={estilo}
          >
            {contenido}
          </button>
        );
      })}
    </>
  );
}
