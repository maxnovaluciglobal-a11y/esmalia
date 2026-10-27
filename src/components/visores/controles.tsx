// Piezas comunes de los visores (IMG-03 / IMG-04) en lenguaje A+:
// controles como chips, panel de datos en tinta y estados de carga y error.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";

import { megas, type Cargador } from "@/lib/visores/descarga";
import { ErrorDeVisor } from "@/lib/visores/malla";
import { cn } from "@/lib/utils";

export const FOCO =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Disposición de los dos visores: en teléfono, el escenario arriba (56 % del
 * alto) y los controles debajo con scroll; desde 1024 px, controles a la
 * derecha en una columna fija.
 */
export const DISPOSICION =
  "flex h-full min-h-0 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden";
export const ESCENARIO = "relative h-[56dvh] shrink-0 bg-muted/40 lg:h-auto lg:min-h-0";
export const LATERAL =
  "space-y-4 border-t border-hairline p-4 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0";

/** Chip de alternancia (aria-pressed) o de acción. */
export function Chip({
  activo,
  onClick,
  children,
  titulo,
  disabled,
  className,
}: {
  activo?: boolean;
  onClick: () => void;
  children: ReactNode;
  titulo?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      title={titulo}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border px-[11px] text-[12.5px] font-semibold pointer-coarse:h-11 pointer-coarse:px-3.5",
        "disabled:cursor-not-allowed disabled:opacity-50",
        FOCO,
        activo
          ? "border-foreground bg-foreground text-background"
          : "border-control text-foreground/80 hover:border-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GrupoChips({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-muted-foreground">{etiqueta}</p>
      <div role="group" aria-label={etiqueta} className="flex flex-wrap gap-1">
        {children}
      </div>
    </div>
  );
}

/** Deslizador con etiqueta visible y valor en cifra. */
export function Deslizador({
  etiqueta,
  valor,
  min,
  max,
  paso = 1,
  onCambiar,
  textoValor,
}: {
  etiqueta: string;
  valor: number;
  min: number;
  max: number;
  paso?: number;
  onCambiar: (v: number) => void;
  textoValor: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-baseline justify-between gap-2 text-[12px] font-medium text-muted-foreground">
        {etiqueta}
        <span className="cifra text-foreground/85">{textoValor}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={paso}
        value={valor}
        aria-valuetext={textoValor}
        onChange={(e) => onCambiar(Number(e.target.value))}
        className={cn("h-6 w-full cursor-pointer accent-foreground pointer-coarse:h-9", FOCO)}
      />
    </label>
  );
}

/** Tarjeta en tinta con los datos del examen: también es la alternativa textual. */
export function PanelDatos({
  titulo,
  filas,
  children,
  id,
}: {
  titulo: string;
  filas: { termino: string; valor: ReactNode }[];
  children?: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={titulo}
      className="rounded-[14px] border border-night-line bg-night p-5 text-on-night"
    >
      <h3 className="font-display text-[22px] font-medium leading-tight">{titulo}</h3>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13.5px]">
        {filas.map((f) => (
          <div key={f.termino} className="contents">
            <dt className="text-on-night-2">{f.termino}</dt>
            <dd className="min-w-0 break-words text-right">{f.valor}</dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  );
}

type Estado<T> =
  | { fase: "cargando"; cargados: number; total: number | null; preparando: boolean }
  | { fase: "error"; mensaje: string }
  | { fase: "listo"; datos: T };

/**
 * Descarga con el cargador y transforma los bytes con `preparar`.
 * `preparar` puede ser pesado: se le cede un cuadro al navegador antes,
 * para que el aviso "Preparando…" alcance a pintarse.
 */
export function useCargaDeExamen<T>(
  cargar: Cargador,
  preparar: (archivos: Uint8Array[]) => T,
  intento: number,
): Estado<T> {
  const [estado, setEstado] = useState<Estado<T>>({
    fase: "cargando",
    cargados: 0,
    total: null,
    preparando: false,
  });
  const prepararRef = useRef(preparar);
  prepararRef.current = preparar;

  useEffect(() => {
    const control = new AbortController();
    let ultimo = 0;
    setEstado({ fase: "cargando", cargados: 0, total: null, preparando: false });
    cargar((cargados, total) => {
      const ahora = performance.now();
      if (ahora - ultimo < 100) return;
      ultimo = ahora;
      setEstado({ fase: "cargando", cargados, total, preparando: false });
    }, control.signal)
      .then(async (archivos) => {
        if (control.signal.aborted) return;
        setEstado((e) =>
          e.fase === "cargando"
            ? { ...e, preparando: true }
            : { fase: "cargando", cargados: 0, total: null, preparando: true },
        );
        await new Promise((r) => setTimeout(r, 30));
        if (control.signal.aborted) return;
        const datos = prepararRef.current(archivos);
        if (!control.signal.aborted) setEstado({ fase: "listo", datos });
      })
      .catch((e: unknown) => {
        if (control.signal.aborted) return;
        const mensaje =
          e instanceof ErrorDeVisor
            ? e.message
            : e instanceof RangeError
              ? "El archivo es demasiado grande para la memoria de este equipo. Ábrelo en un computador o en el software del equipo."
              : "No se pudo abrir el archivo: está dañado o no es del tipo indicado.";
        if (!(e instanceof ErrorDeVisor)) console.error(e);
        setEstado({ fase: "error", mensaje });
      });
    return () => control.abort();
  }, [cargar, intento]);

  return estado;
}

export function EstadoCargando({
  cargados,
  total,
  preparando,
  que,
}: {
  cargados: number;
  total: number | null;
  preparando: boolean;
  que: string;
}) {
  const pct = total ? Math.min(100, Math.round((cargados / total) * 100)) : null;
  return (
    <div role="status" className="grid h-full place-items-center p-6">
      <div className="w-full max-w-xs space-y-3 text-center">
        <LoaderCircle
          aria-hidden
          className="mx-auto size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
        <p className="text-[15px] font-medium">
          {preparando ? `Preparando ${que}…` : `Descargando ${que}…`}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full bg-foreground transition-[width] duration-150"
            style={{ width: preparando ? "100%" : pct !== null ? `${pct}%` : "35%" }}
          />
        </div>
        <p className="cifra text-[12.5px] text-muted-foreground">
          {preparando
            ? "Esto puede tardar unos segundos"
            : total
              ? `${megas(cargados)} de ${megas(total)}`
              : megas(cargados)}
        </p>
      </div>
    </div>
  );
}

export function EstadoError({
  mensaje,
  onReintentar,
}: {
  mensaje: string;
  onReintentar: () => void;
}) {
  return (
    <div role="alert" className="grid h-full place-items-center p-6">
      <div className="max-w-md space-y-3 text-center">
        <AlertTriangle aria-hidden className="mx-auto size-6 text-destructive" />
        <p className="font-display text-[22px] font-medium leading-tight">
          No se pudo abrir el examen
        </p>
        <p className="text-[15px] leading-relaxed text-foreground/80">{mensaje}</p>
        <div className="flex justify-center">
          <Chip onClick={onReintentar}>Reintentar</Chip>
        </div>
      </div>
    </div>
  );
}
