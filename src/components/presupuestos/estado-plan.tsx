import {
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Hourglass,
  Send,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import {
  ETIQUETA_ESTADO_PLAN,
  TONO_ESTADO_PLAN,
  diasParaVencer,
  textoDeValidez,
  DIAS_AVISO_POR_VENCER,
  type EstadoPlan,
} from "@/lib/finance/estados-presupuesto";
import { cn } from "@/lib/utils";

/** Ícono por estado: con el texto y el color, el estado se lee por tres canales (A+). */
const ICONO_ESTADO_PLAN: Record<EstadoPlan, LucideIcon> = {
  borrador: CircleDashed,
  emitido: Send,
  aceptado: CheckCircle2,
  aceptado_parcial: CircleDot,
  rechazado: XCircle,
  vencido: Hourglass,
  finalizado: CheckCheck,
};

/** Pastilla del estado del plan (PLA-02), con los siete estados visibles. */
export function ChipEstadoPlan({ estado, className }: { estado: EstadoPlan; className?: string }) {
  const Icono = ICONO_ESTADO_PLAN[estado];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        estado === "borrador" && "border-dashed",
        TONO_ESTADO_PLAN[estado],
        className,
      )}
    >
      <Icono className="size-3.5 shrink-0" aria-hidden />
      {ETIQUETA_ESTADO_PLAN[estado]}
    </span>
  );
}

/**
 * Aviso de validez (PLA-06): "Vence en 3 días" en ocre cuando entra en el
 * aviso, "Venció hace 2 días" en rojo. Solo tiene sentido para lo que todavía
 * puede aceptarse; el padre decide cuándo mostrarlo.
 */
export function AvisoValidez({
  validUntil,
  hoy,
  className,
}: {
  validUntil: string | null;
  hoy: string;
  className?: string;
}) {
  const texto = textoDeValidez(validUntil, hoy);
  const dias = diasParaVencer(validUntil, hoy);
  if (!texto || dias === null) return null;
  const tono =
    dias < 0
      ? "text-destructive"
      : dias <= DIAS_AVISO_POR_VENCER
        ? "text-warning"
        : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", tono, className)}>
      <CalendarClock className="size-3.5" aria-hidden />
      {texto}
    </span>
  );
}
