import { Ban, CalendarPlus } from "lucide-react";

import { PIXELES_POR_MINUTO } from "@/lib/clinic-operations/clinic-data";
import { hhmmDeMinutos, type FranjaDisponibilidad } from "@/lib/clinic-operations/disponibilidad";
import { cn } from "@/lib/utils";

/**
 * Capa de disponibilidad de una columna de la grilla de día (Ola 2):
 *
 * - bloqueo (AGE-07): franja rayada con el motivo, no agendable;
 * - apertura excepcional (AGE-08): franja con borde de marca, disponible;
 * - sucursal cerrada (AGE-10): fondo apagado, como el "fuera de horario".
 *
 * No captura el puntero: las citas que hubiera debajo (agendadas antes del
 * bloqueo) se siguen pudiendo abrir y mover. Los huecos clicables que caen
 * en un bloqueo o con la sucursal cerrada ya no se dibujan (los filtra la
 * grilla con `filtrarHuecosAgendables`).
 *
 * El texto de cada franja va además en un `sr-only`, así quien usa lector de
 * pantalla se entera de por qué esa parte de la columna no ofrece agendar.
 */
export function CapaDisponibilidad({
  franjas,
  desde,
  hasta,
  pxPorMinuto = PIXELES_POR_MINUTO,
}: {
  franjas: readonly FranjaDisponibilidad[];
  desde: number;
  hasta: number;
  pxPorMinuto?: number;
}) {
  if (franjas.length === 0) return null;
  return (
    <>
      {franjas.map((f) => {
        const ini = Math.max(f.inicio, desde);
        const fin = Math.min(f.fin, hasta);
        const alto = (fin - ini) * pxPorMinuto;
        if (alto <= 0) return null;
        const rango = `${hhmmDeMinutos(f.inicio)}–${hhmmDeMinutos(f.fin)}`;
        const conTexto = alto >= 18;
        return (
          <div
            key={f.clave}
            data-franja={f.tipo}
            className={cn(
              "pointer-events-none absolute inset-x-0 flex items-start gap-1 overflow-hidden px-1.5 pt-0.5 text-[11px] leading-tight",
              f.tipo === "bloqueo" &&
                "border-y border-hairline bg-[repeating-linear-gradient(135deg,var(--color-hairline)_0_2px,var(--color-secondary)_2px_8px)] text-foreground/80",
              f.tipo === "apertura" && "border-l-2 border-brand bg-brand-soft/40 text-brand-700",
              f.tipo === "cerrado" && "bg-secondary/60 text-muted-foreground",
            )}
            style={{ top: (ini - desde) * pxPorMinuto, height: alto }}
          >
            {f.tipo !== "cerrado" && conTexto && (
              <span
                aria-hidden="true"
                className="inline-flex items-center gap-1 rounded bg-card/85 px-1 font-medium"
              >
                {f.tipo === "bloqueo" ? (
                  <Ban className="size-3 shrink-0" />
                ) : (
                  <CalendarPlus className="size-3 shrink-0" />
                )}
                <span className="truncate">{f.etiqueta}</span>
              </span>
            )}
            <span className="sr-only">
              {f.tipo === "bloqueo"
                ? `Bloqueado de ${rango}: ${f.etiqueta}.`
                : f.tipo === "apertura"
                  ? `Horario excepcional disponible de ${rango}.`
                  : `${f.etiqueta} de ${rango}.`}
            </span>
          </div>
        );
      })}
    </>
  );
}
