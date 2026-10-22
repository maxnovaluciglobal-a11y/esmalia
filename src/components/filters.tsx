import { Children, useId, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

import { cn } from "@/lib/utils";
import { paginasVisibles, type Pagina } from "@/lib/search";

/**
 * Barra de filtros. El primer filtro (casi siempre la búsqueda) queda a la
 * vista y el resto se pliega detrás de "Filtros": antes el panel completo
 * ocupaba la primera pantalla del celular y la agenda quedaba abajo del
 * pliegue (revisión visual del 07-oct-2026). Arranca abierto si ya hay
 * filtros activos, para que no queden escondidos.
 */
export function FilterBar({
  children,
  onReset,
  activos,
}: {
  children: React.ReactNode;
  onReset: () => void;
  activos: number;
}) {
  const [primero, ...resto] = Children.toArray(children);
  const plegable = resto.length >= 2;
  const [abierto, setAbierto] = useState(activos > 0);
  const panelId = useId();
  const mostrarResto = !plegable || abierto;

  return (
    <div className="card-clinical p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-56">{primero}</div>
        {!plegable &&
          resto.map((r, i) => (
            <div key={i} className="min-w-0 flex-1 basis-40">
              {r}
            </div>
          ))}
        {plegable && (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            aria-controls={panelId}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-[38px] shrink-0",
              activos > 0 && "border-brand text-brand-700",
            )}
          >
            <SlidersHorizontal aria-hidden />
            Filtros
            {activos > 0 && <span className="tabular-nums">({activos})</span>}
          </button>
        )}
        {activos > 0 && (
          <button
            type="button"
            onClick={onReset}
            className={cn(buttonVariants({ variant: "ghost" }), "h-[38px] shrink-0")}
          >
            <X aria-hidden /> Limpiar
          </button>
        )}
      </div>
      {plegable && mostrarResto && (
        <div id={panelId} className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {resto}
        </div>
      )}
    </div>
  );
}

const fieldClass =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm pointer-coarse:text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder: string;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          className={cn(fieldClass, "pl-9")}
        />
      </span>
    </label>
  );
}

export function SelectField({
  value,
  onChange,
  label,
  options,
  allLabel = "Todos",
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(fieldClass, "appearance-none bg-[length:0] pr-8")}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DateField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={fieldClass}
      />
    </label>
  );
}

export function Paginacion<T>({
  pagina,
  onPage,
  etiqueta,
  porPagina,
}: {
  pagina: Pagina<T>;
  onPage: (p: number) => void;
  etiqueta: string;
  /** Selector de tamaño de página (opcional). */
  porPagina?: { valor: number; opciones: readonly number[]; onChange: (n: number) => void };
}) {
  const { page, totalPages, total, desde, hasta } = pagina;
  const paginas = paginasVisibles(page, totalPages);

  return (
    <nav
      aria-label={`Paginación de ${etiqueta}`}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-xs text-muted-foreground">
          {total === 0 ? `Sin ${etiqueta}` : `Mostrando ${desde}–${hasta} de ${total} ${etiqueta}`}
        </p>
        {porPagina && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Por página
            <select
              value={porPagina.valor}
              onChange={(e) => porPagina.onChange(Number(e.target.value))}
              className="rounded-md border border-border bg-transparent px-1.5 py-1 text-xs text-foreground"
            >
              {porPagina.opciones.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
        >
          Anterior
        </button>
        {paginas.map((p, i) =>
          p === "…" ? (
            <span key={`salto-${i}`} aria-hidden className="px-1 text-xs text-muted-foreground">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
              className={cn(
                "min-w-8 rounded-md px-2 py-1 text-xs transition-colors",
                p === page
                  ? "bg-brand font-medium text-brand-foreground"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-40"
        >
          Siguiente
        </button>
      </div>
    </nav>
  );
}
