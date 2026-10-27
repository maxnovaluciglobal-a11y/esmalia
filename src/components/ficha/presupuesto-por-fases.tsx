import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, CircleDashed, Clock, FileText } from "lucide-react";

import { useZonaClinica } from "@/hooks/use-zona-clinica";
import { formatMoney, QUOTE_STATUS_LABELS, type QuoteStatus } from "@/lib/finance/finance";
import { getPresupuestoDeLaFicha } from "@/lib/finance/presupuesto-ficha.functions";
import { porcentajePagado, type EstadoFase } from "@/lib/finance/presupuesto-ficha";
import { fechaCorta } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

/** Estado de la fase: forma + ícono + texto, nunca solo color. */
const ESTADO_FASE: Record<EstadoFase, { texto: string; clase: string; icono: typeof Check }> = {
  completada: {
    texto: "Realizada",
    clase: "border-success-border bg-success-soft text-success",
    icono: Check,
  },
  en_curso: {
    texto: "En curso",
    clase: "border-brand-600 bg-brand-soft text-brand-700",
    icono: Clock,
  },
  pendiente: {
    texto: "Pendiente",
    clase: "border-transparent bg-neutral-soft text-neutral",
    icono: CircleDashed,
  },
  por_aceptar: {
    texto: "Por aceptar",
    clase: "border-dashed border-warning-border bg-warning-soft text-warning",
    icono: CircleDashed,
  },
};

/**
 * Presupuesto por fases junto a la nota SOAP (A+): fases con sus líneas
 * (pieza, prestación y monto en Geist Mono), lo pagado de la fase con una
 * barra ocre, y abajo el total del plan, lo pagado y el saldo en Cormorant.
 * Solo se monta con `finance:view`; el servidor exige lo mismo.
 */
export function PresupuestoPorFases({
  clinicId,
  patientId,
  onVerFinanzas,
}: {
  clinicId: string;
  patientId: string;
  onVerFinanzas: () => void;
}) {
  const zona = useZonaClinica();
  const fetchPresupuesto = useServerFn(getPresupuestoDeLaFicha);
  const { data, isLoading, isError } = useQuery({
    // Bajo "quotes": aceptar, editar o cobrar invalida esa raíz y la tarjeta se refresca.
    queryKey: ["quotes", clinicId, patientId, "por-fases"],
    queryFn: () => fetchPresupuesto({ data: { clinicId, patientId } }),
  });

  const titulo = data
    ? data.origen === "plan"
      ? data.numero
        ? `Presupuesto ${data.numero}`
        : data.nombre
      : `Presupuesto ${data.numero ?? ""}`.trim()
    : "Presupuesto";

  return (
    <section
      aria-labelledby="presupuesto-fases-titulo"
      className="rounded-panel border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h3
          id="presupuesto-fases-titulo"
          className="font-display text-[30px] leading-none font-medium tracking-[-0.01em]"
        >
          {titulo}
        </h3>
        {data && (
          <span
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold",
              data.origen === "plan"
                ? "border-success-border bg-success-soft text-success"
                : "border-dashed border-warning-border bg-warning-soft text-warning",
            )}
          >
            {data.origen === "plan" ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <FileText className="size-3.5" aria-hidden />
            )}
            {data.origen === "plan"
              ? `Aceptado${data.fecha ? ` el ${fechaCorta(data.fecha, zona)}` : ""} · ya es plan`
              : (QUOTE_STATUS_LABELS[data.estadoPresupuesto as QuoteStatus] ?? "Abierto")}
          </span>
        )}
      </div>

      <div className="px-5 pt-3 pb-5">
        {isLoading ? (
          <div className="space-y-2" aria-hidden>
            <span className="block h-4 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <span className="block h-4 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <span className="block h-4 w-4/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">No pudimos cargar el presupuesto.</p>
        ) : !data ? (
          <p className="text-base text-muted-foreground">
            Sin plan ni presupuesto abierto. Los rechazados y los anteriores están en «Presupuesto y
            pagos».
          </p>
        ) : (
          <>
            {data.fases.map((f) => {
              const estado = ESTADO_FASE[f.estado];
              const Icono = estado.icono;
              const pct = porcentajePagado(f.pagadoCents, f.subtotalCents);
              return (
                <div key={f.label ?? "sin-fase"} className="border-t border-border py-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="font-sans text-[15px] font-semibold tracking-normal">
                      {f.label ?? "Sin fase"}
                    </h4>
                    <span
                      className={cn(
                        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold",
                        estado.clase,
                      )}
                    >
                      <Icono className="size-3" aria-hidden />
                      {estado.texto}
                    </span>
                  </div>
                  <ul className="mt-2 grid gap-1.5">
                    {f.lineas.map((l) => (
                      <li
                        key={l.id}
                        className="grid grid-cols-[28px_1fr_auto] items-baseline gap-2.5 text-sm text-muted-foreground"
                      >
                        <span className="cifra text-xs text-brand-700">{l.pieza ?? "–"}</span>
                        <span className="min-w-0">{l.nombre}</span>
                        <span className="cifra text-sm text-foreground">
                          {formatMoney(l.montoCents, data.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {data.origen === "plan" && f.pagadoCents > 0 && (
                    <>
                      <div
                        className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-border"
                        role="img"
                        aria-label={`Pagado ${pct} % de la fase`}
                      >
                        <span
                          className="block h-full rounded-full bg-brand"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
                        <span>
                          Pagado {formatMoney(f.pagadoCents, data.currency)} de{" "}
                          {formatMoney(f.subtotalCents, data.currency)}
                        </span>
                        <span className="cifra text-foreground">
                          Saldo {formatMoney(f.subtotalCents - f.pagadoCents, data.currency)}
                        </span>
                      </p>
                    </>
                  )}
                </div>
              );
            })}

            <dl className="mt-1 grid grid-cols-3 gap-2.5 border-t border-foreground pt-3.5">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">
                  {data.origen === "plan" ? "Total del plan" : "Total"}
                </dt>
                <dd className="truncate font-display text-[26px] leading-tight font-medium sm:text-[30px]">
                  {formatMoney(data.totalCents, data.currency)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Pagado</dt>
                <dd className="truncate font-display text-[26px] leading-tight font-medium sm:text-[30px]">
                  {formatMoney(data.pagadoCents, data.currency)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Saldo</dt>
                <dd className="truncate font-display text-[26px] leading-tight font-medium text-brand-700 sm:text-[30px]">
                  {formatMoney(data.saldoCents, data.currency)}
                </dd>
              </div>
            </dl>
          </>
        )}
        <button
          type="button"
          onClick={onVerFinanzas}
          className="mt-4 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
        >
          Presupuestos, pagos y cobros <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
