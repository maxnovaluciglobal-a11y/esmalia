/**
 * INF-02 · Comparación entre períodos: las cifras clave del período contra
 * el período anterior (o el mismo del año pasado), con la diferencia en
 * cifra y en %. Sin datos en el período de comparación → "Sin datos para
 * comparar", nunca un +100% inventado.
 */
import { useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  Chips,
  CifraEnTinta,
  DatosEnTinta,
  EtiquetaTinta,
  MontoEnTinta,
  PANEL,
  TINTA,
  TintaCargando,
} from "@/components/reportes/aplus";
import { ErrorDeCarga } from "@/components/estado-error";
import {
  BotonesExportar,
  CifraClicable,
  VariacionTexto,
  valorTexto,
  type ContextoInforme,
} from "@/components/reportes/informes/comunes";
import { fechaCorta } from "@/lib/formato-fecha";
import { montoPlanilla, type ColumnaLista } from "@/lib/exportacion/listas-csv";
import { getInformeMetrica } from "@/lib/reportes/informes.functions";
import {
  DEF_METRICAS,
  ETIQUETA_COMPARACION,
  formatearValor,
  rangoDeComparacion,
  textoVariacion,
  totalDe,
  variacion,
  type Metrica,
  type ModoComparacion,
} from "@/lib/reportes/informes";
import { cn } from "@/lib/utils";

const CLAVE: readonly Metrica[] = [
  "atenciones",
  "citas",
  "ausencias",
  "cancelaciones",
  "horas_agendadas",
  "pacientes_nuevos",
  "presupuestos",
  "presupuestos_aceptados",
  "produccion",
  "cobrado",
];

interface FilaResumen {
  metrica: Metrica;
  actual: number | null;
  anterior: number | null;
}

export function ResumenComparado({
  ctx,
  modo,
  onModo,
}: {
  ctx: ContextoInforme;
  modo: ModoComparacion;
  onModo: (m: ModoComparacion) => void;
}) {
  const metricas = CLAVE.filter((m) => ctx.opciones.metricas.includes(m));
  const fetchMetrica = useServerFn(getInformeMetrica);
  const consultas = useQueries({
    queries: metricas.map((metrica) => ({
      queryKey: [
        "informe-resumen",
        ctx.clinicId,
        metrica,
        ctx.desde,
        ctx.hasta,
        ctx.sucursal,
        ctx.profesional,
        modo,
      ],
      queryFn: () =>
        fetchMetrica({
          data: {
            clinicId: ctx.clinicId,
            desde: ctx.desde,
            hasta: ctx.hasta,
            sucursal: ctx.sucursal,
            profesional: ctx.profesional,
            metrica,
            corte: "total" as const,
            corte2: "total" as const,
            comparar: modo,
          },
        }),
    })),
  });
  const previo = rangoDeComparacion({ desde: ctx.desde, hasta: ctx.hasta }, modo);
  const conError = consultas.find((c) => c.error);
  const cargando = consultas.some((c) => c.isPending);

  // Sin filas en un período = sin datos (regla 11), salvo en conteos de
  // agenda/pacientes donde "no hubo ninguna" sí es 0: igual se muestra
  // "Sin datos" para no presentar una ausencia de registros como un logro.
  const filas: FilaResumen[] = metricas.map((metrica, i) => {
    const r = consultas[i]?.data;
    return {
      metrica,
      actual: r ? totalDe(r.filas) : null,
      anterior: r?.anterior ? totalDe(r.anterior.filas) : null,
    };
  });

  const protagonista =
    filas.find((f) => f.metrica === "produccion" && f.actual !== null) ??
    filas.find((f) => f.metrica === "atenciones") ??
    filas[0];

  const columnas: ColumnaLista<FilaResumen>[] = [
    { header: "Métrica", value: (f) => DEF_METRICAS[f.metrica].label },
    {
      header: "Período",
      value: (f) =>
        DEF_METRICAS[f.metrica].unidad === "dinero"
          ? montoPlanilla(f.actual, ctx.currency)
          : f.actual,
    },
    {
      header: ETIQUETA_COMPARACION[modo],
      value: (f) =>
        DEF_METRICAS[f.metrica].unidad === "dinero"
          ? montoPlanilla(f.anterior, ctx.currency)
          : f.anterior,
    },
    {
      header: "Variación %",
      value: (f) => variacion(f.actual, f.anterior)?.pct ?? null,
    },
  ];

  if (metricas.length === 0) {
    return (
      <section className={cn(PANEL, "p-5 text-sm text-muted-foreground")}>
        Tu rol no tiene cifras para comparar.
      </section>
    );
  }

  return (
    <div className="space-y-[18px]">
      <div className="no-imprimir flex flex-wrap items-center justify-between gap-3">
        <Chips<ModoComparacion>
          etiqueta="Comparar con"
          opciones={[
            { valor: "anterior", label: ETIQUETA_COMPARACION.anterior },
            { valor: "anio", label: ETIQUETA_COMPARACION.anio },
          ]}
          valor={modo}
          onCambiar={onModo}
        />
        <BotonesExportar
          ctx={ctx}
          filas={filas}
          columnas={columnas}
          archivo="Informe comparado"
          filtros={{ comparar: modo }}
        />
      </div>

      {conError ? (
        <ErrorDeCarga
          mensaje="No pudimos comparar los períodos."
          onReintentar={() => consultas.forEach((c) => void c.refetch())}
        />
      ) : cargando || !protagonista ? (
        <TintaCargando texto="Comparando los períodos…" />
      ) : (
        <>
          <section aria-label="Cifra principal" className={TINTA}>
            <EtiquetaTinta>
              {DEF_METRICAS[protagonista.metrica].label} · {fechaCorta(ctx.desde)} —{" "}
              {fechaCorta(ctx.hasta)}
            </EtiquetaTinta>
            {protagonista.actual === null ? (
              <CifraEnTinta valor="Sin datos" />
            ) : DEF_METRICAS[protagonista.metrica].unidad === "dinero" ? (
              <MontoEnTinta cents={protagonista.actual} currency={ctx.currency} />
            ) : (
              <CifraEnTinta
                valor={formatearValor(
                  DEF_METRICAS[protagonista.metrica].unidad,
                  protagonista.actual,
                  ctx.currency,
                )}
              />
            )}
            <p className="mt-3.5 text-sm font-medium text-on-night-2">
              {textoVariacion(
                variacion(protagonista.actual, protagonista.anterior),
                DEF_METRICAS[protagonista.metrica].unidad,
                ctx.currency,
              )}{" "}
              frente a {fechaCorta(previo.desde)} — {fechaCorta(previo.hasta)}
            </p>
            <div className="mt-6">
              <DatosEnTinta
                columnas={3}
                datos={filas
                  .filter((f) => f.metrica !== protagonista.metrica)
                  .slice(0, 3)
                  .map((f) => ({
                    label: DEF_METRICAS[f.metrica].label,
                    valor: valorTexto(DEF_METRICAS[f.metrica].unidad, f.actual, ctx.currency),
                    nota: textoVariacion(
                      variacion(f.actual, f.anterior),
                      DEF_METRICAS[f.metrica].unidad,
                      ctx.currency,
                    ),
                  }))}
              />
            </div>
          </section>

          <ul className="grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
            {filas.map((f) => {
              const def = DEF_METRICAS[f.metrica];
              return (
                <li key={f.metrica} className={cn(PANEL, "p-5")}>
                  <p className="text-sm font-semibold text-foreground/85">{def.label}</p>
                  <p className="mt-2 font-display text-[34px] font-medium leading-none [font-variant-numeric:lining-nums]">
                    {f.actual === null ? (
                      <span className="text-base font-normal text-muted-foreground">Sin datos</span>
                    ) : (
                      <CifraClicable
                        etiqueta={`Ver el detalle de ${def.label.toLowerCase()}`}
                        onClick={() =>
                          ctx.onDetalle({
                            titulo: def.label,
                            metrica: f.metrica,
                            corte: "total",
                            clave: "total",
                          })
                        }
                        className="font-display"
                      >
                        {formatearValor(def.unidad, f.actual, ctx.currency)}
                      </CifraClicable>
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-hairline pt-2.5 text-xs text-muted-foreground">
                    <span>
                      Antes:{" "}
                      {f.anterior === null ? (
                        "Sin datos"
                      ) : (
                        <CifraClicable
                          etiqueta={`Ver el detalle de ${def.label.toLowerCase()} del período de comparación`}
                          onClick={() =>
                            ctx.onDetalle({
                              titulo: `${def.label} (comparación)`,
                              metrica: f.metrica,
                              corte: "total",
                              clave: "total",
                              desde: previo.desde,
                              hasta: previo.hasta,
                            })
                          }
                        >
                          {formatearValor(def.unidad, f.anterior, ctx.currency)}
                        </CifraClicable>
                      )}
                    </span>
                    <VariacionTexto
                      v={variacion(f.actual, f.anterior)}
                      unidad={def.unidad}
                      currency={ctx.currency}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
