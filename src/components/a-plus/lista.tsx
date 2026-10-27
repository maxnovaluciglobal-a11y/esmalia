import type { ReactNode } from "react";
import { CalendarDays, ChevronDown, Search, X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { cn } from "@/lib/utils";

/**
 * Piezas del lenguaje A+ para las pantallas de lista (Pacientes,
 * Presupuestos, Tratamientos, Ortodoncia, Fichas duplicadas): encabezado
 * editorial, buscador compacto, filtros en pastilla y chips. Repiten lo que
 * ya hacen la agenda y la caja (prototipo del 19-oct) para que todas las
 * listas se lean igual. Sin animaciones: calma de recepción.
 */

/** Contexto chico arriba ("Clínica · 248 activos") y título en Cormorant con la itálica en ocre. */
export function EncabezadoEditorial({
  contexto,
  titulo,
  enfasis,
  acciones,
  children,
}: {
  contexto: ReactNode[];
  titulo: ReactNode;
  /** Parte del título en itálica ocre (lo relevante). */
  enfasis?: ReactNode;
  acciones?: ReactNode;
  children?: ReactNode;
}) {
  const items = contexto.filter((c) => c !== null && c !== undefined && c !== false && c !== "");
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-7 gap-y-4 pt-1">
      <div className="min-w-0">
        {items.length > 0 && (
          <p className="mb-2 flex flex-wrap items-center gap-x-2 text-sm font-medium text-muted-foreground">
            {items.map((c, i) => (
              <span key={i} className={cn(i === 0 && "font-semibold text-foreground/80")}>
                {i > 0 && (
                  <span aria-hidden className="mr-2">
                    ·
                  </span>
                )}
                {c}
              </span>
            ))}
          </p>
        )}
        <h2 className="font-display text-[clamp(2.25rem,3.6vw,3.5rem)] font-medium leading-none tracking-[-0.02em] text-balance [font-variant-numeric:lining-nums]">
          {titulo}
          {enfasis && (
            <>
              {" "}
              <em className="text-brand-600">{enfasis}</em>
            </>
          )}
        </h2>
        {children}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}

/** Clases de un botón en pastilla del encabezado (Exportar, Importar…). */
export const BOTON_PASTILLA =
  "inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-[14.5px] font-semibold transition-colors hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11";

/** Buscador compacto como el de la agenda. */
export function BuscadorCompacto({
  valor,
  onChange,
  etiqueta,
  placeholder,
  className,
}: {
  valor: string;
  onChange: (v: string) => void;
  etiqueta: string;
  placeholder: string;
  className?: string;
}) {
  return (
    <label className={cn("relative block w-full sm:w-64", className)}>
      <span className="sr-only">{etiqueta}</span>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-full border border-control bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11 pointer-coarse:text-base"
      />
    </label>
  );
}

/** Select compacto en pastilla (sucursal, profesional, estado…). */
export function FiltroCompacto({
  etiqueta,
  valor,
  onChange,
  todas,
  opciones,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  todas: string;
  opciones: { value: string; label: string }[];
}) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{etiqueta}</span>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-9 max-w-[14rem] appearance-none truncate rounded-full border border-control bg-card pl-3.5 pr-8 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11 pointer-coarse:text-base",
          valor && "border-brand-700 text-brand-700",
        )}
      >
        <option value="">{todas}</option>
        {opciones.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </label>
  );
}

/** Chip de filtro A+ (como los de la caja): relleno en tinta cuando está activo. */
export function ChipFiltro({
  activo,
  onClick,
  children,
  className,
}: {
  activo: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn(
        "inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border px-[11px] text-[12.5px] font-semibold outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11",
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

/** "Limpiar" de los filtros. */
export function LimpiarFiltros({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
    >
      <X aria-hidden className="size-3.5" /> Limpiar
    </button>
  );
}

/** Iniciales en círculo: "Martina Soto Pérez" → "MS". */
export function AvatarIniciales({
  nombre,
  color,
  className,
}: {
  nombre: string;
  /** Color del profesional (hex guardado); sin él, papel. */
  color?: string;
  className?: string;
}) {
  const partes = nombre.split(/\s+/).filter((w) => w && !/^(dr|dra|od|lic)\.?$/i.test(w));
  const ini = (partes[0]?.[0] ?? "") + (partes.length > 1 ? (partes[1]?.[0] ?? "") : "");
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold uppercase",
        color ? "text-background" : "border border-hairline bg-secondary text-foreground/75",
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    >
      {ini || "·"}
    </span>
  );
}

/** Panel A+ (tarjeta de 14 px con filete). */
export const PANEL_LISTA = "rounded-[14px] border border-hairline bg-card";

/** Rango de fechas en una pastilla con popover (antes, dos campos sueltos). */
export function FiltroRangoFechas({
  etiqueta,
  desde,
  hasta,
  onChange,
}: {
  etiqueta: string;
  desde: string;
  hasta: string;
  onChange: (rango: { desde: string; hasta: string }) => void;
}) {
  const activo = Boolean(desde || hasta);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border border-control bg-card px-3.5 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11",
            activo && "border-brand-700 text-brand-700",
          )}
        >
          <CalendarDays className="size-3.5" aria-hidden />
          {activo ? (
            <span className="cifra text-[13px]">
              {desde || "…"} → {hasta || "…"}
            </span>
          ) : (
            etiqueta
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <p className="text-sm font-medium">{etiqueta}</p>
        <label className="block space-y-1 text-xs text-muted-foreground">
          Desde
          <input
            type="date"
            value={desde}
            onChange={(e) => onChange({ desde: e.target.value, hasta })}
            className="block h-10 w-full rounded-lg border border-control bg-card px-3 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </label>
        <label className="block space-y-1 text-xs text-muted-foreground">
          Hasta
          <input
            type="date"
            value={hasta}
            onChange={(e) => onChange({ desde, hasta: e.target.value })}
            className="block h-10 w-full rounded-lg border border-control bg-card px-3 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </label>
        {activo && (
          <button
            type="button"
            onClick={() => onChange({ desde: "", hasta: "" })}
            className="text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
          >
            Quitar el rango
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
