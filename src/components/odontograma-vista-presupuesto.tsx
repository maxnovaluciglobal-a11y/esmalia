import { Fragment, useMemo, useState } from "react";
import { Check, CircleDashed, PencilLine, Send } from "lucide-react";

import { ChipFiltro } from "@/components/a-plus/lista";
import { SURFACE_LABELS, toothCommonName } from "@/lib/clinical/odontogram";
import {
  ESTADOS_PRESUPUESTARIOS,
  ETIQUETA_ESTADO_PRESUPUESTARIO,
  LETRA_ESTADO_PRESUPUESTARIO,
  estadoDominante,
  resumenPorEstado,
  type EstadoPresupuestario,
  type LineaEnPieza,
  type PresupuestoPorPieza,
} from "@/lib/clinical/odontograma-presupuesto";
import { formatMoney } from "@/lib/finance/finance";
import { cn } from "@/lib/utils";

const ICONO: Record<EstadoPresupuestario, typeof Check> = {
  aceptado: Check,
  por_aceptar: Send,
  borrador: PencilLine,
};

/** Forma + ícono + letra por estado, con tokens (regla 17): nunca solo color. */
const TONO: Record<EstadoPresupuestario, string> = {
  aceptado: "border-success-border bg-success-soft text-success",
  por_aceptar: "border-info-border bg-info-soft text-info",
  borrador: "border-dashed border-control bg-muted text-muted-foreground",
};

/**
 * Vista "Presupuesto" del odontograma (Ola 9, ODO-06): sobre cada pieza, lo
 * presupuestado según el estado del presupuesto (aceptado, por aceptar,
 * borrador). Las piezas con algo por realizar que todavía no está en ningún
 * presupuesto llevan un borde punteado: es el puente con la sugerencia
 * odontograma → presupuesto (se suman desde "Hallazgos por tratar").
 */
export function VistaPresupuesto({
  filas,
  presupuesto,
  porPresupuestar,
  currency,
  onVerPresupuesto,
}: {
  filas: { teeth: readonly number[]; inferior: boolean }[];
  presupuesto: PresupuestoPorPieza;
  /** Piezas con hallazgos por tratar sin presupuestar (ODO-07). */
  porPresupuestar: ReadonlySet<number>;
  currency: string;
  onVerPresupuesto?: () => void;
}) {
  const [filtro, setFiltro] = useState<EstadoPresupuestario | null>(null);
  const [pieza, setPieza] = useState<number | null>(null);
  const resumen = useMemo(() => resumenPorEstado(presupuesto), [presupuesto]);
  const lineasDePieza = pieza !== null ? (presupuesto.porPieza.get(pieza) ?? []) : [];
  const sinNada = resumen.every((r) => r.lineas === 0);

  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Filtrar por estado"
      >
        <ChipFiltro activo={filtro === null} onClick={() => setFiltro(null)}>
          Todo
        </ChipFiltro>
        {resumen.map((r) => {
          const Icono = ICONO[r.estado];
          return (
            <ChipFiltro
              key={r.estado}
              activo={filtro === r.estado}
              onClick={() => setFiltro(filtro === r.estado ? null : r.estado)}
            >
              <Icono aria-hidden className="size-3.5" />
              {ETIQUETA_ESTADO_PRESUPUESTARIO[r.estado]}
              <span className="cifra font-normal opacity-80">
                {r.piezas} {r.piezas === 1 ? "pieza" : "piezas"} ·{" "}
                {formatMoney(r.totalCents, currency)}
              </span>
            </ChipFiltro>
          );
        })}
      </div>

      {sinNada && (
        <p className="mt-3 text-sm text-muted-foreground">
          Este paciente no tiene presupuestos vigentes. Las piezas con borde punteado tienen algo
          por tratar que todavía no se presupuestó.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <div className="mx-auto flex w-max flex-col items-center gap-3">
          {filas.map((fila) => (
            <div key={fila.teeth[0]} className="flex items-stretch gap-1">
              {fila.teeth.map((t, i) => {
                const lineas = presupuesto.porPieza.get(t) ?? [];
                const visibles = filtro ? lineas.filter((l) => l.estado === filtro) : lineas;
                const estado = estadoDominante(visibles);
                const pendiente = porPresupuestar.has(t);
                const atenuada = filtro !== null && visibles.length === 0;
                return (
                  <Fragment key={t}>
                    <Tecla
                      tooth={t}
                      estado={estado}
                      lineas={visibles.length}
                      pendiente={pendiente}
                      atenuada={atenuada}
                      inferior={fila.inferior}
                      seleccionada={pieza === t}
                      onClick={() => setPieza(pieza === t ? null : t)}
                    />
                    {i === fila.teeth.length / 2 - 1 && (
                      <div aria-hidden className="mx-1 w-px self-stretch bg-border" />
                    )}
                  </Fragment>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <ul
        className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        aria-label="Leyenda"
      >
        {ESTADOS_PRESUPUESTARIOS.map((e) => {
          const Icono = ICONO[e];
          return (
            <li key={e} className="inline-flex items-center gap-1.5">
              <span className={cn("grid size-4 place-items-center rounded border", TONO[e])}>
                <Icono aria-hidden className="size-2.5" />
              </span>
              {LETRA_ESTADO_PRESUPUESTARIO[e]} · {ETIQUETA_ESTADO_PRESUPUESTARIO[e]}
            </li>
          );
        })}
        <li className="inline-flex items-center gap-1.5">
          <span className="grid size-4 place-items-center rounded border border-dashed border-destructive-border">
            <CircleDashed aria-hidden className="size-2.5 text-destructive" />
          </span>
          Por tratar, sin presupuestar
        </li>
      </ul>

      <div className="mt-4 rounded-xl border border-border bg-background p-4" aria-live="polite">
        {pieza === null ? (
          <p className="text-sm text-muted-foreground">
            Toca una pieza para ver qué tiene presupuestado y en qué presupuesto.
          </p>
        ) : (
          <>
            <p className="font-display text-[26px] leading-none font-medium">
              Pieza <span className="cifra text-brand-600">{pieza}</span>
              {toothCommonName(pieza) && (
                <span className="ml-2 align-middle font-sans text-sm font-normal text-muted-foreground">
                  {toothCommonName(pieza)}
                </span>
              )}
            </p>
            {lineasDePieza.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {porPresupuestar.has(pieza)
                  ? "Tiene hallazgos por tratar y nada presupuestado. Súmalos desde «Hallazgos por tratar»."
                  : "Nada presupuestado en esta pieza."}
              </p>
            ) : (
              <ListaLineas lineas={lineasDePieza} currency={currency} />
            )}
          </>
        )}
        {presupuesto.sinPieza.length > 0 && (
          <details className="mt-3 border-t border-border pt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {presupuesto.sinPieza.length}{" "}
              {presupuesto.sinPieza.length === 1 ? "línea sin pieza" : "líneas sin pieza"}{" "}
              (limpieza, radiografías…)
            </summary>
            <ListaLineas lineas={presupuesto.sinPieza} currency={currency} />
          </details>
        )}
        {onVerPresupuesto && (
          <button
            type="button"
            onClick={onVerPresupuesto}
            className="mt-3 rounded-md px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand/12 pointer-coarse:min-h-11"
          >
            Abrir Presupuesto y pagos
          </button>
        )}
      </div>
    </div>
  );
}

function Tecla({
  tooth,
  estado,
  lineas,
  pendiente,
  atenuada,
  inferior,
  seleccionada,
  onClick,
}: {
  tooth: number;
  estado: EstadoPresupuestario | null;
  lineas: number;
  pendiente: boolean;
  atenuada: boolean;
  inferior: boolean;
  seleccionada: boolean;
  onClick: () => void;
}) {
  const Icono = estado ? ICONO[estado] : pendiente ? CircleDashed : null;
  const etiqueta = [
    `Pieza ${tooth}`,
    estado
      ? `${lineas} ${lineas === 1 ? "línea" : "líneas"}, ${ETIQUETA_ESTADO_PRESUPUESTARIO[estado].toLowerCase()}`
      : "sin presupuesto",
    pendiente ? "con hallazgos por tratar sin presupuestar" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={seleccionada}
      aria-label={etiqueta}
      className={cn(
        "flex w-10 items-center gap-1 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        inferior ? "flex-col-reverse" : "flex-col",
        atenuada && "opacity-35",
      )}
    >
      <span
        className={cn(
          "cifra text-[11px] text-muted-foreground",
          seleccionada && "font-semibold text-brand-700",
        )}
      >
        {tooth}
      </span>
      <span
        className={cn(
          "relative grid size-10 place-items-center rounded-md border text-[10px] font-bold",
          estado ? TONO[estado] : "border-hairline",
          !estado && pendiente && "border-dashed border-destructive-border text-destructive",
          pendiente && estado && "ring-1 ring-destructive-border ring-offset-1 ring-offset-card",
          seleccionada && "outline-2 outline-offset-2 outline-foreground",
        )}
      >
        {Icono && <Icono aria-hidden className="size-3.5" />}
        {estado && (
          <span aria-hidden className="cifra leading-none">
            {LETRA_ESTADO_PRESUPUESTARIO[estado]}
            {lineas > 1 ? lineas : ""}
          </span>
        )}
      </span>
    </button>
  );
}

function ListaLineas({ lineas, currency }: { lineas: LineaEnPieza[]; currency: string }) {
  return (
    <ul className="mt-2 divide-y divide-border">
      {lineas.map((l) => {
        const Icono = ICONO[l.estado];
        return (
          <li
            key={l.itemId}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
          >
            <span className="min-w-0">
              <span className="block text-[15px] font-medium">{l.nombre}</span>
              <span className="block text-xs text-muted-foreground">
                Presupuesto <span className="cifra">{l.quoteNumber}</span>
                {l.surface ? ` · ${SURFACE_LABELS[l.surface]}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold",
                  TONO[l.estado],
                )}
              >
                <Icono aria-hidden className="size-3" />
                {ETIQUETA_ESTADO_PRESUPUESTARIO[l.estado]}
              </span>
              <span className="cifra text-sm text-foreground">
                {formatMoney(l.totalCents, currency)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
