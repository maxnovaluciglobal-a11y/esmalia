/**
 * INF-05 · Mapa de calor de la agenda (ocupación por día y hora) e INF-06 ·
 * uso por box. El calor se lee con texto en cada celda (el % o los minutos)
 * y un resumen en palabras; el color solo refuerza.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { ErrorDeCarga } from "@/components/estado-error";
import {
  BarraFina,
  CifraEnTinta,
  DatosEnTinta,
  EtiquetaTinta,
  FILA,
  PANEL,
  SinDatos,
  TINTA,
  TablaAPlus,
  TintaCargando,
  celda,
  colorDeSerie,
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
  NOMBRE_DIA,
  NOMBRE_DIA_CORTO,
  armarMapaDeCalor,
  formatearMinutos,
  ocupacionBox,
  type CeldaCalor,
} from "@/lib/reportes/informes";
import { getMapaDeCalor, getUsoBox, type FilaBox } from "@/lib/reportes/informes.functions";
import { cn } from "@/lib/utils";

const FONDO_NIVEL: Record<CeldaCalor["nivel"], string> = {
  0: "var(--color-muted)",
  1: "color-mix(in srgb, var(--color-cobalt) 18%, var(--color-card))",
  2: "color-mix(in srgb, var(--color-cobalt) 40%, var(--color-card))",
  3: "color-mix(in srgb, var(--color-cobalt) 66%, var(--color-card))",
  4: "var(--color-cobalt)",
};

const LEYENDA: { nivel: CeldaCalor["nivel"]; texto: string }[] = [
  { nivel: 0, texto: "Libre" },
  { nivel: 1, texto: "Menos de 35%" },
  { nivel: 2, texto: "35% a 64%" },
  { nivel: 3, texto: "65% a 89%" },
  { nivel: 4, texto: "90% o más" },
];

function textoCelda(c: CeldaCalor): string {
  if (c.pct !== null) return `${c.pct}%`;
  if (c.minutosOcupados > 0) return String(c.citas);
  return "·";
}

export function VistaAgenda({ ctx }: { ctx: ContextoInforme }) {
  const fetchCalor = useServerFn(getMapaDeCalor);
  const filtros = {
    clinicId: ctx.clinicId,
    desde: ctx.desde,
    hasta: ctx.hasta,
    sucursal: ctx.sucursal,
    profesional: ctx.profesional,
  };
  const calor = useQuery({
    queryKey: ["informe-calor", filtros],
    queryFn: () => fetchCalor({ data: filtros }),
  });
  const mapa = calor.data ? armarMapaDeCalor(calor.data) : null;

  type FilaCsv = CeldaCalor;
  const columnas: ColumnaLista<FilaCsv>[] = [
    { header: "Día", value: (c) => NOMBRE_DIA[c.diaSemana] },
    { header: "Hora", value: (c) => `${String(c.hora).padStart(2, "0")}:00` },
    { header: "Citas que empiezan", value: (c) => c.citas },
    { header: "Minutos agendados", value: (c) => c.minutosOcupados },
    { header: "Minutos de horario", value: (c) => c.minutosDisponibles },
    { header: "Ocupación %", value: (c) => c.pct },
  ];

  return (
    <div className="space-y-[18px]">
      {calor.error ? (
        <ErrorDeCarga
          mensaje="No pudimos calcular la ocupación."
          onReintentar={() => void calor.refetch()}
        />
      ) : !mapa ? (
        <TintaCargando texto="Calculando la ocupación de la agenda…" />
      ) : (
        <>
          <section aria-label="Ocupación" className={TINTA}>
            <EtiquetaTinta>Ocupación de la agenda</EtiquetaTinta>
            {mapa.ocupacionTotal === null ? (
              <CifraEnTinta valor="Sin datos" />
            ) : (
              <CifraEnTinta valor={String(mapa.ocupacionTotal)} sufijo="%" />
            )}
            <p className="mt-3.5 max-w-[60ch] text-sm font-medium text-on-night-2">
              {!mapa.conHorario
                ? "No hay horarios de atención cargados para los profesionales: el mapa muestra cuántas citas empiezan en cada franja, sin porcentaje."
                : mapa.franjaMasLlena && mapa.franjaMasLibre
                  ? `Lo más lleno: ${NOMBRE_DIA[mapa.franjaMasLlena.diaSemana].toLowerCase()} a las ${mapa.franjaMasLlena.hora}:00 (${mapa.franjaMasLlena.pct}%). Lo más libre: ${NOMBRE_DIA[mapa.franjaMasLibre.diaSemana].toLowerCase()} a las ${mapa.franjaMasLibre.hora}:00 (${mapa.franjaMasLibre.pct}%).`
                  : "Sin citas en este período."}
            </p>
            <div className="mt-6">
              <DatosEnTinta
                columnas={2}
                datos={[
                  {
                    label: "Horas agendadas",
                    valor: formatearMinutos(
                      mapa.filas
                        .flatMap((f) => f.celdas)
                        .reduce((s, c) => s + c.minutosOcupados, 0),
                    ),
                  },
                  {
                    label: "Horas de horario",
                    valor: mapa.conHorario
                      ? formatearMinutos(
                          mapa.filas
                            .flatMap((f) => f.celdas)
                            .reduce((s, c) => s + c.minutosDisponibles, 0),
                        )
                      : "Sin datos",
                  },
                ]}
              />
            </div>
          </section>

          <section className={cn(PANEL, "p-5")}>
            <CabeceraPanel
              titulo="Mapa de calor"
              detalle={
                mapa.conHorario
                  ? "Porcentaje del horario declarado que estuvo agendado, por día y hora. Bloqueos y feriados todavía no se descuentan."
                  : "Citas que empiezan en cada franja."
              }
              acciones={
                <BotonesExportar
                  ctx={ctx}
                  filas={mapa.filas.flatMap((f) => f.celdas)}
                  columnas={columnas}
                  archivo="Ocupación de la agenda"
                />
              }
            />
            {mapa.filas.length === 0 ? (
              <SinDatos className="px-0" titulo="Sin citas ni horarios en este período." />
            ) : (
              <>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[19rem] border-separate border-spacing-[3px] text-center text-[11.5px]">
                    <caption className="sr-only">
                      Ocupación por hora (filas) y día de la semana (columnas)
                    </caption>
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          className="w-12 text-left font-semibold text-muted-foreground"
                        >
                          <span className="sr-only">Hora</span>
                        </th>
                        {mapa.filas.map((f) => (
                          <th
                            key={f.diaSemana}
                            scope="col"
                            className="font-semibold text-muted-foreground"
                          >
                            <abbr title={NOMBRE_DIA[f.diaSemana]} className="no-underline">
                              {NOMBRE_DIA_CORTO[f.diaSemana]}
                            </abbr>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mapa.horas.map((h, i) => (
                        <tr key={h}>
                          <th
                            scope="row"
                            className="cifra text-left font-medium text-muted-foreground"
                          >
                            {String(h).padStart(2, "0")}:00
                          </th>
                          {mapa.filas.map((f) => {
                            const c = f.celdas[i];
                            return (
                              <td
                                key={f.diaSemana}
                                title={c.texto}
                                className={cn(
                                  "cifra h-9 rounded-[5px]",
                                  c.nivel >= 3 ? "text-background" : "text-foreground",
                                )}
                                style={{ background: FONDO_NIVEL[c.nivel] }}
                              >
                                <span aria-hidden>{textoCelda(c)}</span>
                                <span className="sr-only">{c.texto}</span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {mapa.conHorario && (
                  <ul
                    className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"
                    aria-label="Leyenda"
                  >
                    {LEYENDA.map((l) => (
                      <li key={l.nivel} className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="size-3 rounded-[3px] border border-hairline"
                          style={{ background: FONDO_NIVEL[l.nivel] }}
                        />
                        {l.texto}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </>
      )}
      <UsoPorBox ctx={ctx} />
    </div>
  );
}

function UsoPorBox({ ctx }: { ctx: ContextoInforme }) {
  const fetchBox = useServerFn(getUsoBox);
  const filtros = {
    clinicId: ctx.clinicId,
    desde: ctx.desde,
    hasta: ctx.hasta,
    sucursal: ctx.sucursal,
  };
  const { data, error, refetch } = useQuery({
    queryKey: ["informe-box", filtros],
    queryFn: () => fetchBox({ data: filtros }),
  });
  const filas = [...(data ?? [])].sort(
    (a, b) =>
      (a.operatoryId === null ? 1 : 0) - (b.operatoryId === null ? 1 : 0) ||
      b.minutosOcupados - a.minutosOcupados,
  );
  const columnas: ColumnaLista<FilaBox>[] = [
    { header: "Box", value: (f) => f.nombre },
    { header: "Sucursal", value: (f) => f.sucursal },
    { header: "Citas", value: (f) => f.citas },
    { header: "Atenciones", value: (f) => f.atenciones },
    { header: "Minutos ocupados", value: (f) => f.minutosOcupados },
    { header: "Minutos abiertos", value: (f) => f.minutosAbiertos },
    { header: "Ocupación %", value: (f) => ocupacionBox(f.minutosOcupados, f.minutosAbiertos) },
  ];

  return (
    <section className={cn(PANEL, "overflow-hidden")}>
      <div className="p-5 pb-3">
        <CabeceraPanel
          titulo="Uso por box"
          detalle="Tiempo agendado en cada box sobre el horario de apertura de su sucursal."
          acciones={
            <BotonesExportar ctx={ctx} filas={filas} columnas={columnas} archivo="Uso por box" />
          }
        />
      </div>
      {error ? (
        <div className="p-5 pt-0">
          <ErrorDeCarga
            mensaje="No pudimos calcular el uso de los boxes."
            onReintentar={() => void refetch()}
          />
        </div>
      ) : !data ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground" aria-busy>
          Calculando…
        </p>
      ) : filas.length === 0 ? (
        <SinDatos
          titulo="Sin boxes ni citas en este período."
          detalle="Los boxes se crean en la configuración de la agenda."
        />
      ) : (
        <TablaAPlus
          minAncho="34rem"
          columnas={[
            { label: "Box" },
            { label: "Citas", derecha: true },
            { label: "Tiempo", derecha: true },
            { label: "Ocupación", derecha: true },
          ]}
        >
          {filas.map((f) => {
            const pct = ocupacionBox(f.minutosOcupados, f.minutosAbiertos);
            return (
              <tr key={f.operatoryId ?? "sin-box"} className={FILA}>
                <td className={celda(0, 4)}>
                  <span className="font-medium">{f.nombre}</span>
                  {f.sucursal && (
                    <span className="block text-xs text-muted-foreground">{f.sucursal}</span>
                  )}
                </td>
                <td className={celda(1, 4, "text-right")}>
                  {f.citas > 0 ? (
                    <CifraClicable
                      etiqueta={`Ver las citas de ${f.nombre}`}
                      onClick={() =>
                        ctx.onDetalle({
                          titulo: `Citas · ${f.nombre}`,
                          metrica: "citas",
                          corte: "box",
                          clave: f.operatoryId,
                        })
                      }
                    >
                      {numero(f.citas)}
                    </CifraClicable>
                  ) : (
                    <span className="cifra">0</span>
                  )}
                </td>
                <td className={celda(2, 4, "cifra text-right")}>
                  {formatearMinutos(f.minutosOcupados)}
                </td>
                <td className={celda(3, 4, "text-right")}>
                  {pct === null ? (
                    <span className="text-xs text-muted-foreground">
                      {f.operatoryId === null ? "—" : "Sin horario de la sucursal"}
                    </span>
                  ) : (
                    <>
                      <span className="cifra">{pct}%</span>
                      <BarraFina
                        pct={pct}
                        color={colorDeSerie(0, "papel")}
                        className="ml-auto mt-1.5 w-24"
                      />
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </TablaAPlus>
      )}
    </section>
  );
}
