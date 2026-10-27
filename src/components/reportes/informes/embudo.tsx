/**
 * INF-07 · Embudo: de las fichas nuevas del período, cuántas llegaron a
 * cita, atención, presupuesto, aceptado y pagado; separado por canal (la
 * reserva en línea contra el resto). "Pagado" solo con permiso de finanzas.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock } from "lucide-react";

import { ErrorDeCarga } from "@/components/estado-error";
import {
  BarraEnTinta,
  Chips,
  CifraEnTinta,
  EtiquetaTinta,
  PANEL,
  TINTA,
  TintaCargando,
} from "@/components/reportes/aplus";
import {
  BotonesExportar,
  CabeceraPanel,
  CifraClicable,
  type ContextoInforme,
} from "@/components/reportes/informes/comunes";
import type { ColumnaLista } from "@/lib/exportacion/listas-csv";
import { numero } from "@/lib/formato-fecha";
import {
  ETIQUETA_CANAL,
  mayorCaida,
  pasosDelEmbudo,
  sumarEmbudo,
  type PasoEmbudo,
} from "@/lib/reportes/informes";
import { getEmbudo } from "@/lib/reportes/informes.functions";
import { cn } from "@/lib/utils";

type Canal = "todos" | "reserva_en_linea" | "otros";

export function VistaEmbudo({ ctx }: { ctx: ContextoInforme }) {
  const [canal, setCanal] = useState<Canal>("todos");
  const fetchEmbudo = useServerFn(getEmbudo);
  const filtros = {
    clinicId: ctx.clinicId,
    desde: ctx.desde,
    hasta: ctx.hasta,
    sucursal: ctx.sucursal,
  };
  const { data, error, refetch } = useQuery({
    queryKey: ["informe-embudo", filtros],
    queryFn: () => fetchEmbudo({ data: filtros }),
  });

  if (error)
    return (
      <ErrorDeCarga mensaje="No pudimos calcular el embudo." onReintentar={() => void refetch()} />
    );
  if (!data) return <TintaCargando texto="Siguiendo a los pacientes nuevos…" />;

  const total = sumarEmbudo(data, canal === "todos" ? undefined : canal);
  const pasos = pasosDelEmbudo(total);
  const caida = mayorCaida(pasos);
  const enLinea = sumarEmbudo(data, "reserva_en_linea");
  const otros = sumarEmbudo(data, "otros");
  const columnas: ColumnaLista<PasoEmbudo>[] = [
    { header: "Paso", value: (p) => p.label },
    { header: "Pacientes", value: (p) => p.valor },
    { header: "% de los contactos", value: (p) => p.pctDelTotal },
    { header: "% del paso anterior", value: (p) => p.pctDelAnterior },
  ];

  return (
    <div className="space-y-[18px]">
      <div className="no-imprimir flex flex-wrap items-center justify-between gap-3">
        <Chips<Canal>
          etiqueta="Canal"
          valor={canal}
          onCambiar={setCanal}
          opciones={[
            { valor: "todos", label: "Todos", cuenta: sumarEmbudo(data).contactos },
            {
              valor: "reserva_en_linea",
              label: ETIQUETA_CANAL.reserva_en_linea,
              cuenta: enLinea.contactos,
            },
            { valor: "otros", label: ETIQUETA_CANAL.otros, cuenta: otros.contactos },
          ]}
        />
        <BotonesExportar
          ctx={ctx}
          filas={pasos}
          columnas={columnas}
          archivo="Embudo de pacientes"
          filtros={{ canal }}
        />
      </div>

      <section
        aria-label="Embudo"
        className={cn(TINTA, "grid gap-7 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]")}
      >
        <div className="min-w-0">
          <EtiquetaTinta>Llegaron a aceptar un presupuesto</EtiquetaTinta>
          {total.contactos === 0 ? (
            <CifraEnTinta valor="Sin datos" />
          ) : (
            <CifraEnTinta valor={String(pasos[4].pctDelTotal ?? 0)} sufijo="%" />
          )}
          <p className="mt-3.5 text-sm font-medium text-on-night-2">
            {total.contactos === 0
              ? "No se crearon fichas en este período."
              : caida
                ? `Donde más se pierde gente: de ${pasos[pasos.indexOf(caida) - 1]?.label.toLowerCase() ?? "contacto"} a ${caida.label.toLowerCase()} (sigue el ${caida.pctDelAnterior}%).`
                : ""}
          </p>
        </div>
        <ul className="grid gap-3">
          {pasos.map((p) => (
            <BarraEnTinta
              key={p.clave}
              etiqueta={`${p.label} · ${p.detalle}`}
              texto={
                p.valor === null
                  ? "Requiere permiso de finanzas"
                  : `${numero(p.valor)}${p.pctDelTotal !== null ? ` · ${p.pctDelTotal}%` : ""}`
              }
              pct={p.pctDelTotal ?? 0}
            />
          ))}
        </ul>
      </section>

      <section className={cn(PANEL, "p-5")}>
        <CabeceraPanel
          titulo="Reserva en línea frente al resto"
          detalle="Fichas creadas en el período según de dónde vino su primera cita. Cada paso cuenta pacientes que llegaron a él hasta hoy."
        />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-control/50 text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 font-semibold">
                  Paso
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  {ETIQUETA_CANAL.reserva_en_linea}
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  {ETIQUETA_CANAL.otros}
                </th>
              </tr>
            </thead>
            <tbody>
              {pasosDelEmbudo(enLinea).map((p, i) => {
                const o = pasosDelEmbudo(otros)[i];
                return (
                  <tr key={p.clave} className="border-b border-hairline last:border-0">
                    <th scope="row" className="py-2.5 text-left font-medium">
                      {p.label}
                    </th>
                    {[p, o].map((x, j) => (
                      <td key={j} className="py-2.5 text-right">
                        {x.valor === null ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Lock className="size-3" aria-hidden /> Sin permiso
                          </span>
                        ) : x.clave === "contactos" && x.valor > 0 ? (
                          <CifraClicable
                            etiqueta="Ver las fichas nuevas del período"
                            onClick={() =>
                              ctx.onDetalle({
                                titulo: "Pacientes nuevos",
                                metrica: "pacientes_nuevos",
                                corte: "total",
                                clave: "total",
                              })
                            }
                          >
                            {numero(x.valor)}
                          </CifraClicable>
                        ) : (
                          <span className="cifra">
                            {numero(x.valor)}
                            {x.pctDelTotal !== null && x.clave !== "contactos" && (
                              <span className="text-muted-foreground"> · {x.pctDelTotal}%</span>
                            )}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
