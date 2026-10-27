/**
 * Uso del almacenamiento de la clínica (Ola 13): barra en Ajustes y aviso en
 * la ficha desde el 80 %. El bloqueo al 100 % lo hace la base al reservar la
 * subida; esto solo lo anticipa.
 */
import { AlertTriangle, HardDrive } from "lucide-react";

import { ETIQUETA_PLAN, avisoDelCupo, estadoDelCupo, type EstadoCupo } from "@/lib/examenes/cupo";
import { formatearBytes } from "@/lib/examenes/tipos";
import { cn } from "@/lib/utils";

import { useUsoDeAlmacenamiento } from "./use-examenes";

/** Aviso al 80 % y al 100 %. No muestra nada por debajo. */
export function AvisoDeCupo({
  estado,
  className,
}: {
  estado: EstadoCupo | null;
  className?: string;
}) {
  const texto = estado ? avisoDelCupo(estado) : null;
  if (!estado || !texto) return null;
  const lleno = estado.nivel === "lleno";
  return (
    <p
      role={lleno ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-[14px] border px-3.5 py-2.5 text-sm",
        lleno
          ? "border-destructive-border bg-destructive-soft text-destructive"
          : "border-warning-border bg-warning-soft text-warning",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{texto}</span>
    </p>
  );
}

export function UsoDeAlmacenamientoCard({ clinicId }: { clinicId: string }) {
  const { data, isLoading } = useUsoDeAlmacenamiento(clinicId);
  const estado = data ? estadoDelCupo(data.usadoBytes, data.cupoBytes) : null;

  return (
    <div className="rounded-panel border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-[26px] leading-none font-medium">
            <HardDrive className="size-5 text-muted-foreground" aria-hidden />
            Almacenamiento
            {estado && (
              <em className="text-brand-600">
                · <span className="cifra not-italic">{estado.porcentaje} %</span>
              </em>
            )}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Exámenes, radiografías, escaneos y fotos de todos los pacientes.
          </p>
        </div>
        {data && (
          <span className="inline-flex h-[26px] items-center rounded-full border border-control px-2.5 text-[12.5px] font-semibold whitespace-nowrap">
            Plan {ETIQUETA_PLAN[data.plan]}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Cargando…</p>
      ) : !data || !estado ? (
        <p className="mt-4 text-sm text-muted-foreground">Sin datos de almacenamiento todavía.</p>
      ) : (
        <>
          <div
            className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-label="Almacenamiento usado"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={estado.porcentaje}
            aria-valuetext={`${formatearBytes(estado.usado)} de ${formatearBytes(estado.cupo)}`}
          >
            <div
              className={cn(
                "h-full rounded-full",
                estado.nivel === "lleno"
                  ? "bg-destructive"
                  : estado.nivel === "aviso"
                    ? "bg-warning"
                    : "bg-cobalt",
              )}
              style={{ width: `${Math.max(estado.porcentaje, estado.usado > 0 ? 1 : 0)}%` }}
            />
          </div>
          <p className="mt-2 text-sm">
            <span className="cifra font-semibold">{formatearBytes(estado.usado)}</span>{" "}
            <span className="text-muted-foreground">
              de <span className="cifra">{formatearBytes(estado.cupo)}</span> · quedan{" "}
              <span className="cifra">{formatearBytes(estado.restante)}</span>
            </span>
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:max-w-sm">
            <dt className="text-muted-foreground">Exámenes ({data.examenes})</dt>
            <dd className="cifra text-right">{formatearBytes(data.examenesBytes)}</dd>
            <dt className="text-muted-foreground">Documentos anteriores</dt>
            <dd className="cifra text-right">{formatearBytes(data.documentosBytes)}</dd>
          </dl>
          <AvisoDeCupo estado={estado} className="mt-4" />
          <p className="mt-3 text-xs text-muted-foreground">
            Archivar un examen no libera espacio: la ficha clínica se conserva completa.
          </p>
        </>
      )}
    </div>
  );
}
