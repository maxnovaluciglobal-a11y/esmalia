import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { formatMoney } from "@/lib/finance/finance";
import { getPanelDesempeno, type PanelMes } from "@/lib/finance/finance-reports.functions";
import { lecturaCobradoVsProducido, recortarSerieMensual } from "@/lib/finance/reportes-lectura";
import { cn } from "@/lib/utils";
import { mesAnio } from "@/lib/formato-fecha";

/**
 * Panel de desempeño de la clínica (G-7 del análisis competitivo).
 *
 * Lo que un dueño abre a la mañana. La regla que gobierna todo el componente:
 * **un indicador que no se puede calcular muestra "Sin datos", nunca un cero**.
 * Un panel vacío se ve mal; uno que dice 0 % de ocupación cuando en realidad
 * nadie cargó los horarios se ve como una catástrofe que no ocurrió.
 */

function Indicador({
  label,
  valor,
  nota,
  destacado,
}: {
  label: string;
  valor: string;
  nota?: string;
  destacado?: boolean;
}) {
  return (
    <div className="card-clinical p-4">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "font-display font-semibold tabular-nums",
          destacado ? "text-2xl" : "text-xl",
        )}
      >
        {valor}
      </p>
      {nota && <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p>}
    </div>
  );
}

/**
 * Ventas contra recaudación, doce meses. Barras en SVG y no una librería de
 * charts: son dos series de doce valores y traer Recharts para esto agregaría
 * ~90 KB al bundle — y ya hubo un incidente con `Object.freeze` y Recharts en
 * este repo (ver la auditoría de agosto).
 */
function SerieMensual({ serie: serieCompleta, currency }: { serie: PanelMes[]; currency: string }) {
  // Sin los meses vacíos de antes de que la clínica empezara a trabajar.
  const serie = useMemo(() => recortarSerieMensual(serieCompleta), [serieCompleta]);
  // En pantallas angostas el gráfico de muchos meses se desplaza: arranca
  // mostrando el final (el mes en curso), no enero.
  const desplazable = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = desplazable.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [serie.length]);
  const max = Math.max(1, ...serie.flatMap((m) => [m.ventasCents, m.recaudacionCents]));
  const alto = 120;
  const anchoBarra = 100 / (serie.length * 2 + serie.length);

  const mesCorto = (mes: string) => {
    const [, m] = mes.split("-");
    return ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][
      Number(m) - 1
    ];
  };

  const mesLargo = (mes: string) => {
    const [anio, m] = mes.split("-").map(Number);
    return mesAnio(`${anio}-${String(m).padStart(2, "0")}-15`).split(" ")[0];
  };
  const periodo =
    serie.length === serieCompleta.length
      ? `${serie.length} meses`
      : `desde ${mesLargo(serie[0]?.mes ?? "")}`;

  const totalVentas = serie.reduce((s, m) => s + m.ventasCents, 0);
  const totalRecaudacion = serie.reduce((s, m) => s + m.recaudacionCents, 0);

  return (
    <div className="card-clinical p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Ventas y recaudación · {periodo}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-brand" aria-hidden />
            Producción {formatMoney(totalVentas, currency)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-success" aria-hidden />
            Cobrado {formatMoney(totalRecaudacion, currency)}
          </span>
        </div>
      </div>

      {totalVentas === 0 && totalRecaudacion === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Todavía no hay producción ni cobros en los últimos {serieCompleta.length} meses.
        </p>
      ) : (
        <div
          ref={desplazable}
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Producción y cobros por mes (desplazable)"
        >
          {/* min-w en el wrapper, no en el svg: el svg y la fila de meses
           * tienen que compartir el mismo ancho para que el scroll horizontal
           * no los desalinee. Con pocos meses no hace falta: entra en un
           * teléfono sin cortar el mes en curso. */}
          <div style={{ minWidth: serie.length > 6 ? `${serie.length * 2.75}rem` : undefined }}>
            <svg
              viewBox={`0 0 100 ${alto}`}
              className="h-32 w-full"
              role="img"
              aria-label={`Producción y cobros, ${periodo}. Producción total ${formatMoney(totalVentas, currency)}, cobrado ${formatMoney(totalRecaudacion, currency)}.`}
              preserveAspectRatio="none"
            >
              {serie.map((m, i) => {
                const x = i * (anchoBarra * 3);
                const hv = (m.ventasCents / max) * alto;
                const hr = (m.recaudacionCents / max) * alto;
                return (
                  <g key={m.mes}>
                    <title>
                      {`${m.mes}: producción ${formatMoney(m.ventasCents, currency)}, cobrado ${formatMoney(m.recaudacionCents, currency)}`}
                    </title>
                    <rect
                      x={x}
                      y={alto - hv}
                      width={anchoBarra}
                      height={hv}
                      className="fill-brand"
                      rx={0.4}
                    />
                    <rect
                      x={x + anchoBarra + 0.4}
                      y={alto - hr}
                      width={anchoBarra}
                      height={hr}
                      className="fill-success"
                      rx={0.4}
                    />
                  </g>
                );
              })}
            </svg>
            {/* Los meses van en HTML, no en el <text> del SVG de arriba:
             * `preserveAspectRatio="none"` estira el svg sin mantener la
             * proporción para que las barras siempre llenen el ancho
             * disponible, y ese mismo estiramiento no-uniforme deforma el
             * texto (letras aplastadas/superpuestas) porque el tamaño de
             * fuente se define en unidades del viewBox, no en píxeles. Texto
             * HTML normal, posicionado con el mismo % que ya usa el svg
             * (viewBox de 100 de ancho = cada unidad es 1% del contenedor). */}
            <div className="relative mt-1 h-4">
              {serie.map((m, i) => {
                const x = i * (anchoBarra * 3);
                const centro = x + anchoBarra;
                return (
                  <span
                    key={m.mes}
                    className="absolute -translate-x-1/2 text-[11px] text-muted-foreground"
                    style={{ left: `${centro}%` }}
                  >
                    {mesCorto(m.mes)}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PanelDesempeno({
  clinicId,
  desde,
  hasta,
}: {
  clinicId: string;
  desde: string;
  hasta: string;
}) {
  const fetchPanel = useServerFn(getPanelDesempeno);
  const { data, isLoading, error } = useQuery({
    queryKey: ["panel-desempeno", clinicId, desde, hasta],
    queryFn: () => fetchPanel({ data: { clinicId, desde, hasta } }),
  });

  const indicadores = useMemo(() => {
    if (!data) return [];
    return [
      {
        label: "Pacientes nuevos",
        valor: String(data.pacientesNuevos),
        nota: "Primera cita en el período",
      },
      {
        label: "Citas anuladas",
        valor: String(data.citasAnuladas),
        nota: `de ${data.citasAgendadas + data.citasAnuladas} agendadas`,
      },
      {
        label: "Atendidos vs. agendados",
        valor: data.tasaAsistencia === null ? "Sin datos" : `${data.tasaAsistencia}%`,
        nota:
          data.tasaAsistencia === null
            ? "No hubo citas en el período"
            : `${data.citasAtendidas} de ${data.citasAgendadas}`,
      },
      {
        label: "Ocupación",
        valor: data.ocupacionPct === null ? "Sin datos" : `${data.ocupacionPct}%`,
        nota:
          data.ocupacionPct === null
            ? "Carga horarios de los profesionales"
            : "Horas agendadas sobre disponibles",
      },
      {
        label: "Presupuestos emitidos",
        valor: String(data.presupuestosEmitidos),
      },
      {
        label: "Espera promedio",
        valor: data.esperaPromedioMin === null ? "Sin datos" : `${data.esperaPromedioMin} min`,
        nota:
          data.esperaPromedioMin === null
            ? "Nadie registró llegada e inicio"
            : `Sobre ${data.esperaMuestras} ${data.esperaMuestras === 1 ? "atención" : "atenciones"}`,
      },
    ];
  }, [data]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando panel…</p>;
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        No pudimos cargar el panel de desempeño. Recarga la página; si sigue igual, avisa al equipo.
      </p>
    );
  }

  if (!data) return null;

  const cobradoVsProducido = lecturaCobradoVsProducido(
    data.ventasCents,
    data.recaudacionCents,
    data.currency,
  );

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Indicador
          label="Producción del período"
          valor={formatMoney(data.ventasCents, data.currency)}
          nota="Tratamientos completados"
          destacado
        />
        <Indicador
          label="Cobrado en el período"
          valor={formatMoney(data.recaudacionCents, data.currency)}
          nota="Pagos recibidos"
          destacado
        />
        <Indicador
          label={cobradoVsProducido.etiqueta}
          valor={cobradoVsProducido.valor}
          nota={cobradoVsProducido.nota}
          destacado
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {indicadores.map((i) => (
          <Indicador key={i.label} {...i} />
        ))}
      </section>

      <SerieMensual serie={data.serie} currency={data.currency} />
    </div>
  );
}
