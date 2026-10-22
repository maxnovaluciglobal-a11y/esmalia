import {
  ETIQUETA_ESTADO_CUENTA,
  ETIQUETA_ESTADO_CUOTA,
  type EstadoCuenta,
  type EstadoCuota,
} from "@/lib/finance/cuentas-por-cobrar";
import { cn } from "@/lib/utils";

const TONO_CUENTA: Record<EstadoCuenta, string> = {
  pendiente: "border-info-border bg-info-soft text-info",
  parcial: "border-warning-border bg-warning-soft text-warning",
  vencida: "border-destructive-border bg-destructive-soft text-destructive",
  pagada: "border-success-border bg-success-soft text-success",
  anulada: "border-border bg-muted text-muted-foreground",
};

const CHIP = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";

/** Estado de una cuenta por cobrar (FIN-02), con el mismo tono en la ficha y en la lista. */
export function ChipEstadoCuenta({ estado }: { estado: EstadoCuenta }) {
  return <span className={cn(CHIP, TONO_CUENTA[estado])}>{ETIQUETA_ESTADO_CUENTA[estado]}</span>;
}

/** Estado de una cuota; una cuota vencida e impaga se marca como vencida. */
export function ChipEstadoCuota({ estado, vencida }: { estado: EstadoCuota; vencida: boolean }) {
  if (vencida) return <span className={cn(CHIP, TONO_CUENTA.vencida)}>Vencida</span>;
  const tono =
    estado === "pagada"
      ? TONO_CUENTA.pagada
      : estado === "parcial"
        ? TONO_CUENTA.parcial
        : TONO_CUENTA.pendiente;
  return <span className={cn(CHIP, tono)}>{ETIQUETA_ESTADO_CUOTA[estado]}</span>;
}
