/**
 * INF-08 · Cortes demográficos: quiénes son tus pacientes (o quiénes se
 * atendieron, o dónde está la producción) por edad, comuna, previsión y
 * origen. Lo que la ficha no tiene sale como "Sin dato", no se reparte.
 */
import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Info } from "lucide-react";

import { ErrorDeCarga } from "@/components/estado-error";
import { BarraFina, Chips, PANEL, colorDeSerie } from "@/components/reportes/aplus";
import {
  BotonesExportar,
  CabeceraPanel,
  CifraClicable,
  type ContextoInforme,
} from "@/components/reportes/informes/comunes";
import { montoPlanilla, type ColumnaLista } from "@/lib/exportacion/listas-csv";
import {
  CORTES_DEMOGRAFICOS,
  DEF_METRICAS,
  ETIQUETA_CORTE,
  formatearValor,
  ordenarPorCorte,
  porcentaje,
  totalesPorClave,
  type CorteDemografico,
  type Metrica,
} from "@/lib/reportes/informes";
import { getInformeMetrica, type FilaConEtiqueta } from "@/lib/reportes/informes.functions";
import { cn } from "@/lib/utils";

const OPCIONES: readonly Metrica[] = ["pacientes_nuevos", "atenciones", "produccion"];
const MAX_FILAS = 8;

export function VistaPacientes({ ctx }: { ctx: ContextoInforme }) {
  const disponibles = OPCIONES.filter((m) => ctx.opciones.metricas.includes(m));
  const [metrica, setMetrica] = useState<Metrica>(disponibles[0] ?? "pacientes_nuevos");
  const fetchMetrica = useServerFn(getInformeMetrica);
  const consultas = useQueries({
    queries: CORTES_DEMOGRAFICOS.map((corte) => ({
      queryKey: [
        "informe-demografia",
        ctx.clinicId,
        metrica,
        corte,
        ctx.desde,
        ctx.hasta,
        ctx.sucursal,
        ctx.profesional,
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
            corte,
            corte2: "total" as const,
          },
        }),
    })),
  });
  const def = DEF_METRICAS[metrica];

  if (disponibles.length === 0) {
    return (
      <section className={cn(PANEL, "p-5 text-sm text-muted-foreground")}>
        Tu rol no tiene acceso a datos de pacientes.
      </section>
    );
  }

  return (
    <div className="space-y-[18px]">
      <div className="no-imprimir">
        <Chips<Metrica>
          etiqueta="Qué contar"
          valor={metrica}
          onCambiar={setMetrica}
          opciones={disponibles.map((m) => ({ valor: m, label: DEF_METRICAS[m].label }))}
        />
        <p className="mt-2 text-xs text-muted-foreground">{def.descripcion}</p>
      </div>
      <div className="grid items-start gap-[18px] lg:grid-cols-2">
        {CORTES_DEMOGRAFICOS.map((corte, i) => (
          <PanelCorte
            key={corte}
            ctx={ctx}
            metrica={metrica}
            corte={corte}
            filas={consultas[i]?.data?.filas}
            currency={consultas[i]?.data?.currency ?? ctx.currency}
            error={Boolean(consultas[i]?.error)}
            onReintentar={() => void consultas[i]?.refetch()}
          />
        ))}
      </div>
      <p className="flex gap-2 rounded-[10px] bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 flex-none" aria-hidden />
        La edad se calcula a la fecha de cada registro. El corte por sexo queda para cuando la ficha
        registre ese dato: hoy no se pide al crear un paciente.
      </p>
    </div>
  );
}

function PanelCorte({
  ctx,
  metrica,
  corte,
  filas,
  currency,
  error,
  onReintentar,
}: {
  ctx: ContextoInforme;
  metrica: Metrica;
  corte: CorteDemografico;
  filas: FilaConEtiqueta[] | undefined;
  currency: string;
  error: boolean;
  onReintentar: () => void;
}) {
  const def = DEF_METRICAS[metrica];
  const etiquetas = new Map((filas ?? []).map((f) => [f.clave, f.etiqueta]));
  const ordenadas = ordenarPorCorte(corte, totalesPorClave(filas ?? []));
  const total = ordenadas.reduce((s, f) => s + f.valor, 0);
  const visibles = corte === "comuna" ? ordenadas.slice(0, MAX_FILAS) : ordenadas;
  const resto = ordenadas.slice(visibles.length).reduce((s, f) => s + f.valor, 0);
  const sinDato = ordenadas.find((f) => f.clave === null)?.valor ?? 0;
  const dinero = def.unidad === "dinero";
  type Fila = (typeof ordenadas)[number];
  const columnas: ColumnaLista<Fila>[] = [
    { header: ETIQUETA_CORTE[corte], value: (f) => etiquetas.get(f.clave) ?? "" },
    {
      header: def.label,
      value: (f) => (dinero ? montoPlanilla(f.valor, currency) : f.valor),
      dinero,
    },
    { header: "% del total", value: (f) => porcentaje(f.valor, total) },
  ];

  return (
    <section className={cn(PANEL, "p-5")}>
      <CabeceraPanel
        titulo={`Por ${ETIQUETA_CORTE[corte].toLowerCase()}`}
        detalle={
          sinDato > 0 && total > 0
            ? `${porcentaje(sinDato, total)}% sin este dato en la ficha.`
            : undefined
        }
        acciones={
          <BotonesExportar
            ctx={ctx}
            filas={ordenadas}
            columnas={columnas}
            archivo={`${def.label} por ${ETIQUETA_CORTE[corte].toLowerCase()}`}
          />
        }
      />
      {error ? (
        <div className="mt-3">
          <ErrorDeCarga mensaje="No pudimos calcular este corte." onReintentar={onReintentar} />
        </div>
      ) : !filas ? (
        <p className="mt-3 text-sm text-muted-foreground" aria-busy>
          Calculando…
        </p>
      ) : ordenadas.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Sin datos en este período.</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {visibles.map((f) => {
            const etiqueta = etiquetas.get(f.clave) ?? "";
            const pct = porcentaje(f.valor, total);
            return (
              <li key={f.clave ?? "sin"} className="border-b border-hairline pb-2.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span
                    className={cn("min-w-0 truncate", f.clave === null && "text-muted-foreground")}
                  >
                    {etiqueta}
                  </span>
                  <span className="shrink-0">
                    <CifraClicable
                      etiqueta={`Ver el detalle: ${etiqueta}`}
                      onClick={() =>
                        ctx.onDetalle({
                          titulo: `${def.label} · ${etiqueta}`,
                          metrica,
                          corte,
                          clave: f.clave,
                        })
                      }
                    >
                      {formatearValor(def.unidad, f.valor, currency)}
                    </CifraClicable>
                    <span className="cifra ml-2 text-xs text-muted-foreground">{pct ?? 0}%</span>
                  </span>
                </div>
                <BarraFina
                  pct={pct ?? 0}
                  color={colorDeSerie(f.clave === null ? 4 : 0, "papel")}
                  className="mt-1.5"
                />
              </li>
            );
          })}
          {resto > 0 && (
            <li className="text-sm text-muted-foreground">
              Otras comunas:{" "}
              <span className="cifra">{formatearValor(def.unidad, resto, currency)}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
