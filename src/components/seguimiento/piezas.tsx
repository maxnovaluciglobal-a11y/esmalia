import { useId, type ReactNode } from "react";

import { PANEL_LISTA } from "@/components/a-plus/lista";
import { cn } from "@/lib/utils";

/**
 * Piezas chicas de Seguimiento y Campañas (Ola 8), sobre el lenguaje A+ de
 * `a-plus/lista.tsx`: chip de tono, panel de lista con título Cormorant y
 * cuenta, y la tarjeta en tinta con "lo que requiere acción".
 */

export type Tono = "neutro" | "alerta" | "aviso" | "bien" | "tinta" | "tenue";

const TONO: Record<Tono, string> = {
  neutro: "border-control text-foreground/80",
  alerta: "border-destructive-border bg-destructive-soft text-destructive",
  aviso: "border-warning-border bg-warning-soft text-warning",
  bien: "border-success-border bg-success-soft text-success",
  tinta: "border-foreground bg-foreground text-background",
  tenue: "border-hairline text-muted-foreground",
};

export function Chip({
  tono = "neutro",
  children,
  className,
}: {
  tono?: Tono;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[24px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-semibold",
        TONO[tono],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Panel A+ con título en Cormorant, cuenta y acciones a la derecha. */
export function PanelLista({
  titulo,
  conteo,
  acciones,
  descripcion,
  children,
}: {
  titulo: ReactNode;
  conteo?: number;
  acciones?: ReactNode;
  descripcion?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-t`} className={cn(PANEL_LISTA, "overflow-hidden")}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <h3
            id={`${id}-t`}
            className="flex items-center gap-2 font-display text-[22px] font-medium leading-tight"
          >
            {titulo}
            {conteo !== undefined && (
              <span className="cifra rounded-full border border-hairline px-2 py-px font-sans text-xs font-medium text-muted-foreground">
                {conteo}
              </span>
            )}
          </h3>
          {descripcion && <p className="mt-0.5 text-sm text-muted-foreground">{descripcion}</p>}
        </div>
        {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </div>
      {children}
    </section>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground">{children}</p>;
}

export interface CifraEnTinta {
  id: string;
  etiqueta: string;
  valor: number | null;
  /** Lo que hay que mirar primero se marca en ocre. */
  urgente?: boolean;
  onClick?: () => void;
  activo?: boolean;
}

/**
 * Tarjeta en tinta (como la de Hoy): lo que requiere acción, arriba de todo.
 * Cada cifra lleva a su lista. `null` se muestra como "—" (sin datos).
 */
export function ResumenEnTinta({
  titulo,
  enfasis,
  bajada,
  cifras,
}: {
  titulo: string;
  enfasis: string;
  bajada?: ReactNode;
  cifras: readonly CifraEnTinta[];
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-t`}
      className="dark tinta-de-pagina overflow-hidden rounded-[14px] border border-night-line bg-night p-[clamp(18px,2.4vw,30px)] text-on-night"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2
          id={`${id}-t`}
          className="font-display text-[clamp(1.6rem,3vw,2.1rem)] font-medium leading-none"
        >
          {titulo} <em className="text-brand-on-night">{enfasis}</em>
        </h2>
        {bajada && <p className="text-[13.5px] font-medium text-on-night-2">{bajada}</p>}
      </div>
      <ul className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-night-line pt-5 sm:grid-cols-3 lg:grid-cols-5">
        {cifras.map((c) => {
          const contenido = (
            <>
              <span className="block truncate text-[12.5px] font-semibold text-on-night-2">
                {c.etiqueta}
              </span>
              <span
                className={cn(
                  "mt-1 block whitespace-nowrap font-display text-[clamp(1.9rem,6vw,2.4rem)] font-medium leading-none [font-variant-numeric:lining-nums]",
                  c.urgente && (c.valor ?? 0) > 0 && "text-brand-on-night",
                )}
              >
                {c.valor === null ? "—" : c.valor}
              </span>
            </>
          );
          return (
            <li key={c.id} className="min-w-0">
              {c.onClick ? (
                <button
                  type="button"
                  onClick={c.onClick}
                  aria-pressed={c.activo}
                  className={cn(
                    "block w-full min-w-0 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-on-night/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-on-night",
                    c.activo && "bg-on-night/10",
                  )}
                >
                  {contenido}
                </button>
              ) : (
                <div className="px-2 py-1.5">{contenido}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Botón chico en pastilla para acciones de fila. */
export const BOTON_FILA =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-control bg-card px-3 text-[13px] font-semibold outline-none transition-colors hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:h-11";
