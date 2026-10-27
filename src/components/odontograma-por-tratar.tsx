import { Clock, Receipt, TriangleAlert, Wrench } from "lucide-react";

import { Muestra } from "@/components/odontograma-muestra";
import { describirMarca } from "@/lib/clinical/odontograma-texto";
import { SURFACE_LABELS, toothCommonName, type OdontogramMark } from "@/lib/clinical/odontogram";
import {
  ETIQUETA_MOTIVO,
  type HallazgoPorTratar,
  type MotivoPorTratar,
} from "@/lib/clinical/odontograma-presupuesto";
import { cn } from "@/lib/utils";

const ICONO_MOTIVO: Record<MotivoPorTratar, typeof Clock> = {
  patologia: TriangleAlert,
  mal_estado: Wrench,
  por_realizar: Clock,
};

/**
 * Hallazgos por tratar (Ola 9, ODO-07): lo que el odontograma dice que hay que
 * tratar y no está en ningún presupuesto vigente ni se hizo. Cada fila lleva
 * su acción para llevarla al presupuesto:
 * - un tratamiento "por realizar" abre la sugerencia en línea (prestación del
 *   arancel y fase, con deshacer), la misma del PR 11;
 * - una patología o un tratamiento en mal estado abre el presupuesto con la
 *   pieza y la superficie ya cargadas (botón "Presupuestar" de G-1), porque
 *   el tratamiento todavía no está decidido.
 */
export function HallazgosPorTratar({
  hallazgos,
  puedePresupuestar,
  onSugerir,
  onPresupuestar,
}: {
  hallazgos: HallazgoPorTratar<OdontogramMark>[];
  puedePresupuestar: boolean;
  onSugerir: (marca: OdontogramMark) => void;
  onPresupuestar: (marca: OdontogramMark) => void;
}) {
  return (
    <section
      aria-labelledby="odontograma-por-tratar-titulo"
      className="mt-5 border-t border-border pt-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4
          id="odontograma-por-tratar-titulo"
          className="font-display text-[22px] leading-none font-medium tracking-[-0.01em]"
        >
          Hallazgos <em className="text-brand-600">por tratar</em>
          <span className="cifra ml-2 align-middle text-[12.5px] font-normal tracking-normal text-foreground">
            {hallazgos.length}
          </span>
        </h4>
        <p className="text-xs text-muted-foreground">Sin tratamiento presupuestado ni realizado.</p>
      </div>
      {hallazgos.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Todo lo que el odontograma marca para tratar ya está en un presupuesto o se hizo.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {hallazgos.map(({ marca, motivo }) => {
            const Icono = ICONO_MOTIVO[motivo];
            const sugerencia = motivo === "por_realizar";
            return (
              <li
                key={marca.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="cifra w-7 shrink-0 text-[15px] font-semibold text-brand-700">
                    {marca.toothNumber}
                  </span>
                  <Muestra marca={marca} />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium">{describirMarca(marca)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {SURFACE_LABELS[marca.surface]}
                      {toothCommonName(marca.toothNumber)
                        ? ` · ${toothCommonName(marca.toothNumber)}`
                        : ""}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold",
                      motivo === "por_realizar"
                        ? "border-dashed border-destructive-border text-destructive"
                        : "border-destructive-border bg-destructive-soft text-destructive",
                    )}
                  >
                    <Icono aria-hidden className="size-3" />
                    {ETIQUETA_MOTIVO[motivo]}
                  </span>
                  {puedePresupuestar && (
                    <button
                      type="button"
                      onClick={() => (sugerencia ? onSugerir(marca) : onPresupuestar(marca))}
                      aria-label={`Llevar al presupuesto: pieza ${marca.toothNumber}, ${describirMarca(marca)}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-brand px-3 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
                    >
                      <Receipt aria-hidden className="size-3.5" />
                      {sugerencia ? "Sumar al presupuesto" : "Presupuestar"}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
