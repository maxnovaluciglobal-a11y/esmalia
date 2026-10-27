/**
 * Piezas A+ de Reportes y Operación (segundo pase, 27-oct-2026): el mismo
 * lenguaje que la caja del día (`components/finance/caja-del-dia.tsx`)
 * llevado a Finanzas, Morosidad, Comisiones, Efectividad, Resultados del
 * piloto, Inventario y Laboratorios.
 *
 * - Encabezado editorial: contexto en sans, título Cormorant con la parte
 *   que cambia en itálica ocre y, debajo, la conclusión en una frase.
 * - Tarjeta en tinta con la cifra protagonista (símbolo en ocre).
 * - Cobalto solo para datos (barras y mezclas), como pide el LEEME del
 *   prototipo; la lista blanca vive en tests/sistema-color.
 * - Estados con forma + ícono + texto, nunca solo color.
 */
import { useId, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { clasePastilla, type TonoEstado } from "@/lib/clinic-operations/estado-cita-tono";
import { formatMoney } from "@/lib/finance/finance";
import {
  PERIODOS,
  periodoActivo,
  rangoDePeriodo,
  type PeriodoId,
  type Rango,
} from "@/lib/finance/periodos-reporte";
import { cn } from "@/lib/utils";

export { PANEL } from "@/components/finance/caja-del-dia";

/** Título de panel en papel: Cormorant 30 px, igual que la caja. */
export const TITULO_PANEL = "font-display text-[28px] font-medium leading-none sm:text-[30px]";

const FOCO =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

// ─── Encabezado ──────────────────────────────────────────────────────────

/** La parte del título que cambia: itálica ocre. */
export function Destacado({ children }: { children: ReactNode }) {
  return <em className="text-brand-600">{children}</em>;
}

export function EncabezadoEditorial({
  seccion,
  pagina,
  detalle,
  titulo,
  conclusion,
  acciones,
}: {
  /** "Reportes" / "Operación". */
  seccion: string;
  pagina: string;
  /** Texto extra del contexto ("1 oct — 27 oct", "últimos 90 días"). */
  detalle?: ReactNode;
  titulo: ReactNode;
  /** La conclusión en lenguaje simple. */
  conclusion?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-7 gap-y-4">
      <div className="min-w-0 max-w-3xl">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-muted-foreground">
          <b className="font-semibold text-foreground/85">{seccion}</b>
          <span aria-hidden>·</span>
          <span>{pagina}</span>
          {detalle && (
            <>
              <span aria-hidden>·</span>
              <span>{detalle}</span>
            </>
          )}
        </p>
        <h2 className="mt-2 font-display text-[clamp(2.25rem,3.6vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.02em] text-balance [font-variant-numeric:lining-nums]">
          {titulo}
        </h2>
        {conclusion && (
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-foreground/80">
            {conclusion}
          </p>
        )}
      </div>
      {acciones && <div className="no-imprimir flex flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}

// ─── Chips ───────────────────────────────────────────────────────────────

export type OpcionChip<T extends string> = { valor: T; label: string; cuenta?: number };

export function Chips<T extends string>({
  etiqueta,
  opciones,
  valor,
  onCambiar,
  className,
}: {
  etiqueta: string;
  opciones: readonly OpcionChip<T>[];
  valor: T;
  onCambiar: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} className={cn("flex flex-wrap gap-1", className)}>
      {opciones.map((op) => {
        const activo = op.valor === valor;
        return (
          <button
            key={op.valor}
            type="button"
            aria-pressed={activo}
            onClick={() => onCambiar(op.valor)}
            className={cn(
              "inline-flex h-[30px] items-center gap-1.5 rounded-full border px-[11px] text-[12.5px] font-semibold pointer-coarse:h-11",
              FOCO,
              activo
                ? "border-foreground bg-foreground text-background"
                : "border-control text-foreground/80 hover:border-foreground",
            )}
          >
            {op.label}
            {op.cuenta !== undefined && (
              <span
                className={cn("cifra text-[11px]", activo ? "opacity-80" : "text-muted-foreground")}
              >
                {op.cuenta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Selector de período ─────────────────────────────────────────────────

const CAMPO_FECHA = cn(
  "h-[30px] rounded-full border border-control bg-card px-3 text-[12.5px] font-medium tabular-nums pointer-coarse:h-11 pointer-coarse:text-base",
  FOCO,
);

/**
 * Chips de período + las dos fechas. Un chip fija el rango; tocar una fecha
 * lo vuelve "Personalizado". "Personalizado" lleva el foco a "Desde".
 */
export function SelectorPeriodo({
  desde,
  hasta,
  hoy,
  onCambiar,
}: {
  desde: string;
  hasta: string;
  hoy: string;
  onCambiar: (r: Partial<Rango>) => void;
}) {
  const uid = useId();
  const desdeRef = useRef<HTMLInputElement>(null);
  const activo = periodoActivo(desde, hasta, hoy);
  return (
    <div className="no-imprimir flex flex-wrap items-center gap-x-3 gap-y-2">
      <Chips<PeriodoId>
        etiqueta="Período"
        opciones={PERIODOS.map((p) => ({ valor: p.id, label: p.label }))}
        valor={activo}
        onCambiar={(id) => {
          const r = rangoDePeriodo(id, hoy);
          if (r) onCambiar(r);
          else desdeRef.current?.focus();
        }}
      />
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
        <label htmlFor={`${uid}-desde`} className="sr-only">
          Desde
        </label>
        <input
          ref={desdeRef}
          id={`${uid}-desde`}
          type="date"
          value={desde}
          max={hasta || undefined}
          onChange={(e) => e.target.value && onCambiar({ desde: e.target.value })}
          className={CAMPO_FECHA}
        />
        <span aria-hidden>—</span>
        <label htmlFor={`${uid}-hasta`} className="sr-only">
          Hasta
        </label>
        <input
          id={`${uid}-hasta`}
          type="date"
          value={hasta}
          min={desde || undefined}
          onChange={(e) => e.target.value && onCambiar({ hasta: e.target.value })}
          className={CAMPO_FECHA}
        />
      </div>
    </div>
  );
}

// ─── Tarjeta en tinta ────────────────────────────────────────────────────

export const TINTA =
  "tarjeta-tinta overflow-hidden rounded-[14px] border border-night-line bg-night p-[clamp(22px,2.6vw,36px)] text-on-night";

export function EtiquetaTinta({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-semibold tracking-[0.01em] text-on-night-2">{children}</p>;
}

const CIFRA_GRANDE =
  "mt-2.5 whitespace-nowrap font-display text-[clamp(2.75rem,12vw,4.25rem)] font-medium leading-[0.9] tracking-[-0.035em] [font-variant-numeric:lining-nums] md:text-[clamp(3.25rem,5vw,5.25rem)]";

/** "$1.284.000" → ["$", "1.284.000"]; "-$5.000" → ["-$", "5.000"]. */
export function partirMonto(texto: string): [string, string] {
  const m = /^(-?[^\d-]*)(.*)$/.exec(texto);
  return m && m[1] ? [m[1], m[2]] : ["", texto];
}

/** Monto protagonista sobre tinta: el símbolo va en ocre. */
export function MontoEnTinta({ cents, currency }: { cents: number; currency: string }) {
  const [simbolo, cifra] = partirMonto(formatMoney(cents, currency));
  return (
    <p className={CIFRA_GRANDE}>
      <span className="text-brand-on-night">{simbolo}</span>
      {cifra}
    </p>
  );
}

/** Cifra protagonista que no es dinero ("67", "%"): el sufijo va en ocre. */
export function CifraEnTinta({ valor, sufijo }: { valor: string; sufijo?: string }) {
  return (
    <p className={CIFRA_GRANDE}>
      {valor}
      {sufijo && <span className="text-brand-on-night">{sufijo}</span>}
    </p>
  );
}

/** Pares dato/valor al pie de la tarjeta en tinta. */
export function DatosEnTinta({
  datos,
  columnas = 2,
}: {
  datos: { label: string; valor: ReactNode; nota?: ReactNode }[];
  columnas?: 2 | 3 | 4;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-4 gap-y-3 border-t border-night-line pt-4 text-xs text-on-night-2",
        columnas === 2 && "grid-cols-2",
        columnas === 3 && "grid-cols-2 sm:grid-cols-3",
        columnas === 4 && "grid-cols-2 sm:grid-cols-4",
      )}
    >
      {datos.map((d) => (
        <div key={d.label} className="min-w-0">
          <dt>{d.label}</dt>
          <dd className="cifra mt-0.5 text-[15px] text-on-night">{d.valor}</dd>
          {d.nota && <dd className="mt-0.5 text-[11.5px] text-on-night-2">{d.nota}</dd>}
        </div>
      ))}
    </dl>
  );
}

// ─── Datos: barras ───────────────────────────────────────────────────────

/** Mezclas sobre tinta: del cobalto claro al casi papel (como la caja). */
const COLOR_TINTA = [
  "var(--color-cobalt-on-night)",
  "color-mix(in srgb, var(--color-cobalt-on-night) 62%, var(--color-on-night))",
  "color-mix(in srgb, var(--color-cobalt-on-night) 34%, var(--color-on-night))",
  "var(--color-on-night)",
  "var(--color-on-night-2)",
];
/** Sobre papel: del cobalto lleno al suave. */
const COLOR_PAPEL = [
  "var(--color-cobalt)",
  "color-mix(in srgb, var(--color-cobalt) 68%, var(--color-card))",
  "color-mix(in srgb, var(--color-cobalt) 44%, var(--color-card))",
  "color-mix(in srgb, var(--color-cobalt) 24%, var(--color-card))",
  "var(--color-muted-foreground)",
];

export function colorDeSerie(indice: number, sobre: "tinta" | "papel"): string {
  const paleta = sobre === "tinta" ? COLOR_TINTA : COLOR_PAPEL;
  return paleta[Math.min(indice, paleta.length - 1)];
}

export type ParteApilada = {
  clave: string;
  etiqueta: string;
  valor: number;
  /** Lo que se lee al lado ("$412.000", "3 órdenes"). */
  texto: string;
  /** Color propio (p. ej. un tono de estado); si falta, la escala cobalto. */
  color?: string;
};

/**
 * Barra apilada + leyenda con valor y %, como "Por medio de pago" de la caja.
 * El color nunca informa solo: cada parte lleva su nombre y su cifra.
 */
export function BarraApilada({
  partes,
  sobre,
  vacio = "Sin datos.",
  sinPorcentaje = false,
}: {
  partes: ParteApilada[];
  sobre: "tinta" | "papel";
  vacio?: string;
  sinPorcentaje?: boolean;
}) {
  const total = partes.reduce((s, p) => s + p.valor, 0);
  const visibles = partes.filter((p) => p.valor > 0);
  if (total <= 0 || visibles.length === 0) {
    return (
      <p
        className={cn(
          "mt-3 text-sm",
          sobre === "tinta" ? "text-on-night-2" : "text-muted-foreground",
        )}
      >
        {vacio}
      </p>
    );
  }
  // Porcentajes enteros que suman 100 (mayor resto).
  const crudos = visibles.map((p) => (p.valor / total) * 100);
  const pcts = crudos.map(Math.floor);
  let falta = 100 - pcts.reduce((s, n) => s + n, 0);
  crudos
    .map((c, i) => ({ i, resto: c - Math.floor(c) }))
    .sort((a, b) => b.resto - a.resto)
    .forEach(({ i }) => {
      if (falta > 0) {
        pcts[i] += 1;
        falta -= 1;
      }
    });
  const color = (p: ParteApilada, i: number) => p.color ?? colorDeSerie(i, sobre);
  const linea = sobre === "tinta" ? "border-night-line" : "border-hairline";
  const secundario = sobre === "tinta" ? "text-on-night-2" : "text-muted-foreground";

  return (
    <>
      <div aria-hidden className="mt-3 flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]">
        {visibles.map((p, i) => (
          <span
            key={p.clave}
            className="h-full"
            style={{ width: `${Math.max(pcts[i], 1)}%`, background: color(p, i) }}
          />
        ))}
      </div>
      <ul className="mt-4 grid gap-2.5">
        {visibles.map((p, i) => (
          <li
            key={p.clave}
            className={cn(
              "grid grid-cols-[12px_minmax(0,1fr)_auto_auto] items-baseline gap-2.5 border-b pb-2.5 text-sm",
              linea,
            )}
          >
            <span
              aria-hidden
              className="size-2.5 rounded-[2px]"
              style={{ background: color(p, i) }}
            />
            <span className="min-w-0 truncate">{p.etiqueta}</span>
            <span className="cifra text-sm">{p.texto}</span>
            <span className={cn("cifra min-w-9 text-right text-xs", secundario)}>
              {sinPorcentaje ? "" : `${pcts[i]}%`}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export type PuntoSerie = { clave: string; etiqueta: string; valor: number; descripcion: string };

/**
 * Barras verticales en cobalto sobre tinta (caja por día o por semana).
 * Con muchas barras se rotula una de cada N para que las etiquetas no se
 * pisen; cada barra conserva su descripción para lectores de pantalla.
 */
export function BarrasEnTinta({ puntos, titulo }: { puntos: PuntoSerie[]; titulo: string }) {
  const max = Math.max(0, ...puntos.map((p) => p.valor));
  const cada = puntos.length > 16 ? Math.ceil(puntos.length / 8) : puntos.length > 10 ? 2 : 1;
  return (
    <figure className="mt-6">
      <figcaption className="sr-only">{titulo}</figcaption>
      <ol
        className="grid h-[132px] items-end gap-[3px] sm:gap-[5px]"
        style={{ gridTemplateColumns: `repeat(${puntos.length}, minmax(0, 1fr))` }}
      >
        {puntos.map((p, i) => {
          const alto = max > 0 ? Math.max(2, Math.round((p.valor / max) * 100)) : 0;
          return (
            <li
              key={p.clave}
              title={p.descripcion}
              className="flex h-full min-w-0 flex-col items-center justify-end gap-1.5"
            >
              <span
                aria-hidden
                className={cn(
                  "block w-full rounded-t-[3px]",
                  p.valor > 0 ? "bg-cobalt-on-night" : "bg-night-3",
                )}
                style={{ height: p.valor > 0 ? `${alto}%` : "2px" }}
              />
              <span
                aria-hidden
                className={cn(
                  "cifra h-3 text-[10.5px] leading-3 whitespace-nowrap text-on-night-2",
                  i % cada !== 0 && "invisible",
                )}
              >
                {p.etiqueta}
              </span>
              <span className="sr-only">{p.descripcion}</span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

/** Fila con barra horizontal sobre tinta (una proporción, en cobalto). */
export function BarraEnTinta({
  etiqueta,
  texto,
  pct,
  nota,
}: {
  etiqueta: string;
  texto: string;
  pct: number;
  nota?: string;
}) {
  return (
    <li className="border-b border-night-line pb-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0">{etiqueta}</span>
        <span className="cifra shrink-0">{texto}</span>
      </div>
      <div aria-hidden className="mt-2 h-2 overflow-hidden rounded-[4px] bg-night-3">
        <span
          className="block h-full bg-cobalt-on-night"
          style={{ width: `${pct > 0 ? Math.max(2, Math.min(100, pct)) : 0}%` }}
        />
      </div>
      {nota && <p className="mt-1 text-xs text-on-night-2">{nota}</p>}
    </li>
  );
}

/** Barra horizontal fina (producción por profesional, gastos). */
export function BarraFina({
  pct,
  color,
  className,
}: {
  pct: number;
  color: string;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("h-2 overflow-hidden rounded-[4px] bg-muted", className)}>
      <span
        className="block h-full"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  );
}

// ─── Estados y tablas ────────────────────────────────────────────────────

/** Pastilla de estado: forma (borde/relleno del tono) + ícono + texto. */
export function Pastilla({
  tono,
  icono: Icono,
  children,
  className,
}: {
  tono: TonoEstado;
  icono: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap",
        clasePastilla[tono],
        className,
      )}
    >
      <Icono className="size-3.5" aria-hidden />
      {children}
    </span>
  );
}

export type ColumnaTabla = {
  label: string;
  /** Números y montos a la derecha. */
  derecha?: boolean;
  className?: string;
};

/** Cabecera de tabla A+: sans 12 px, filete inferior, filas altas. */
export function TablaAPlus({
  columnas,
  children,
  pie,
  minAncho,
}: {
  columnas: ColumnaTabla[];
  children: ReactNode;
  pie?: ReactNode;
  /** Ancho mínimo para que la tabla haga scroll propio y no la página. */
  minAncho?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-sm sm:text-[15px]"
        style={{ minWidth: minAncho }}
      >
        <thead>
          <tr className="border-b border-control/50 text-left text-xs font-semibold text-muted-foreground">
            {columnas.map((c, i) => (
              <th
                key={c.label || i}
                scope="col"
                className={cn(
                  "px-2 py-2 font-semibold sm:px-3",
                  i === 0 && "pl-3.5 sm:pl-5",
                  i === columnas.length - 1 && "pr-3.5 sm:pr-5",
                  c.derecha && "text-right",
                  c.className,
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
        {pie && <tfoot>{pie}</tfoot>}
      </table>
    </div>
  );
}

/** Clases de celda alineadas con la cabecera de `TablaAPlus`. */
export function celda(i: number, total: number, extra?: string) {
  return cn(
    "px-2 py-[13px] align-top sm:px-3",
    i === 0 && "pl-3.5 sm:pl-5",
    i === total - 1 && "pr-3.5 sm:pr-5",
    extra,
  );
}

export const FILA = "border-b border-hairline last:border-0 hover:bg-muted/40";

/** "Sin datos" honesto dentro de un panel. */
export function SinDatos({
  titulo,
  detalle,
  accion,
  className,
}: {
  titulo: string;
  detalle?: string;
  accion?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-4 px-5 py-6", className)}>
      <div className="max-w-prose space-y-1">
        <p className="text-sm font-medium">{titulo}</p>
        {detalle && <p className="text-sm text-muted-foreground">{detalle}</p>}
      </div>
      {accion}
    </div>
  );
}

/** Esqueleto de la tarjeta en tinta mientras carga. */
export function TintaCargando({ texto }: { texto: string }) {
  return (
    <div
      aria-busy
      className="grid h-[20rem] place-items-center rounded-[14px] bg-night text-sm text-on-night-2"
    >
      {texto}
    </div>
  );
}
