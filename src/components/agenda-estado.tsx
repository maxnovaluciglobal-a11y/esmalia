import { Check, Circle, Clock, Minus, X, type LucideIcon } from "lucide-react";

import { etiquetaEstado, type EstadoCita } from "@/lib/clinic-operations/clinic-data";
import { cn } from "@/lib/utils";

/**
 * Aspecto de cada estado de cita en la agenda A+ (prototipo del 19-oct):
 * forma + ícono + texto, nunca solo color.
 *
 * - Confirmada: tarjeta lisa, hora con check en salvia.
 * - Por confirmar: borde punteado sobre siena suave, hora con reloj.
 * - En sala: ocre relleno (lo que está pasando ahora salta a la vista).
 * - Finalizada: neutro apagado, sin borde.
 * - Ausente: ladrillo suave con borde y el nombre tachado.
 *
 * Es el lenguaje de la agenda; la pastilla del resto de la app
 * (`estado-cita-pastilla.tsx`) sigue con su mapa.
 */
export interface AspectoEstado {
  Icono: LucideIcon;
  /** Bloque de la grilla (fondo, borde, texto). */
  bloque: string;
  /** Color de la línea de la hora y del ícono dentro del bloque. */
  acento: string;
  /** Chip de la leyenda y del cajón. */
  chip: string;
  /** El nombre va tachado (ausente). */
  tachado?: boolean;
}

export const ASPECTO_ESTADO: Record<EstadoCita, AspectoEstado> = {
  confirmada: {
    Icono: Check,
    bloque: "border-border bg-card text-foreground",
    acento: "text-success",
    chip: "border-success bg-success-soft text-success",
  },
  tentativa: {
    Icono: Clock,
    bloque: "border-dashed border-warning bg-warning-soft text-foreground",
    acento: "text-warning",
    chip: "border-dashed border-warning bg-warning-soft text-warning",
  },
  "en-sala": {
    Icono: Circle,
    bloque: "border-transparent bg-brand text-brand-foreground",
    acento: "text-brand-foreground",
    chip: "border-brand-700 bg-brand-soft text-brand-700",
  },
  finalizada: {
    Icono: Minus,
    bloque: "border-transparent bg-neutral-soft text-muted-foreground",
    acento: "text-muted-foreground",
    chip: "border-transparent bg-neutral-soft text-muted-foreground",
  },
  ausente: {
    Icono: X,
    bloque: "border-destructive bg-destructive-soft text-destructive",
    acento: "text-destructive",
    chip: "border-destructive bg-destructive-soft text-destructive",
    tachado: true,
  },
};

/** Orden de la leyenda: como se recorre un día. */
export const ORDEN_LEYENDA: EstadoCita[] = [
  "confirmada",
  "tentativa",
  "en-sala",
  "finalizada",
  "ausente",
];

/** Chip de estado (leyenda y cajón de la cita). */
export function ChipEstado({ estado, className }: { estado: EstadoCita; className?: string }) {
  const a = ASPECTO_ESTADO[estado];
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-xs font-semibold leading-none",
        a.chip,
        className,
      )}
    >
      <a.Icono
        aria-hidden
        strokeWidth={2.4}
        className={cn("size-3 shrink-0", estado === "en-sala" && "size-2.5 fill-current")}
      />
      {etiquetaEstado[estado]}
    </span>
  );
}

/** Leyenda de estados como chips (forma + ícono + texto). */
export function LeyendaEstados({ className }: { className?: string }) {
  return (
    <ul aria-label="Estados de cita" className={cn("flex flex-wrap items-center gap-2", className)}>
      {ORDEN_LEYENDA.map((e) => (
        <li key={e}>
          <ChipEstado estado={e} className="h-5" />
        </li>
      ))}
    </ul>
  );
}
