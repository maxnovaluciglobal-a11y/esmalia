/**
 * INF-04 · Constructor libre: elegir métrica, corte (y un segundo corte
 * opcional para cruzar), período y comparación; guardar el informe con
 * nombre (propio o compartido con el equipo). Lo guardado es la
 * configuración: se recalcula al abrirlo con los permisos de quien lo abre.
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { ErrorDeCarga } from "@/components/estado-error";
import {
  BarraFina,
  FILA,
  PANEL,
  SinDatos,
  TablaAPlus,
  TintaCargando,
  celda,
  colorDeSerie,
} from "@/components/reportes/aplus";
import {
  BotonesExportar,
  CabeceraPanel,
  CifraClicable,
  VariacionTexto,
  type ContextoInforme,
} from "@/components/reportes/informes/comunes";
import { Button } from "@/components/ui/button";
import { montoPlanilla, type ColumnaLista } from "@/lib/exportacion/listas-csv";
import { mensajeDeError } from "@/lib/mensaje-error";
import {
  CORTES,
  DEF_METRICAS,
  ETIQUETA_COMPARACION,
  ETIQUETA_CORTE,
  corteAdmitido,
  formatearValor,
  nombreSugerido,
  ordenarPorCorte,
  totalesPorClave,
  unirComparacion,
  variacion,
  type ConfigInforme,
  type Corte,
  type Metrica,
  type ModoComparacion,
} from "@/lib/reportes/informes";
import { getInformeMetrica } from "@/lib/reportes/informes.functions";
import {
  borrarInformeGuardado,
  guardarInforme,
  listInformesGuardados,
  type InformeGuardado,
} from "@/lib/reportes/informes-guardados.functions";
import { cn } from "@/lib/utils";

export interface EstadoConstructor {
  metrica: Metrica;
  corte: Corte;
  corte2: Corte;
  comparar: ModoComparacion | null;
}

const SELECT = cn(
  "h-10 w-full rounded-[10px] border border-control bg-card px-3 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11 pointer-coarse:text-base",
);

export function Constructor({
  ctx,
  estado,
  periodo,
  onCambiar,
  onAbrirGuardado,
}: {
  ctx: ContextoInforme;
  estado: EstadoConstructor;
  /** Chip de período activo, para guardar el informe relativo a hoy. */
  periodo: ConfigInforme["periodo"];
  onCambiar: (e: Partial<EstadoConstructor>) => void;
  onAbrirGuardado: (c: ConfigInforme) => void;
}) {
  const uid = useId();
  const def = DEF_METRICAS[estado.metrica];
  const fetchMetrica = useServerFn(getInformeMetrica);
  const { data, error, isPending, refetch } = useQuery({
    queryKey: [
      "informe-constructor",
      ctx.clinicId,
      estado,
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
          metrica: estado.metrica,
          corte: estado.corte,
          corte2: estado.corte2,
          comparar: estado.corte2 === "total" ? estado.comparar : null,
        },
      }),
  });

  const cambiarMetrica = (metrica: Metrica) =>
    onCambiar({
      metrica,
      corte: corteAdmitido(metrica, estado.corte) ? estado.corte : "total",
      corte2: corteAdmitido(metrica, estado.corte2) ? estado.corte2 : "total",
    });

  return (
    <div className="space-y-[18px]">
      <section className={cn(PANEL, "no-imprimir p-5")} aria-label="Armar el informe">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor={`${uid}-m`} className="text-xs font-semibold text-muted-foreground">
              Qué quieres medir
            </label>
            <select
              id={`${uid}-m`}
              className={cn(SELECT, "mt-1")}
              value={estado.metrica}
              onChange={(e) => cambiarMetrica(e.target.value as Metrica)}
            >
              {ctx.opciones.metricas.map((m) => (
                <option key={m} value={m}>
                  {DEF_METRICAS[m].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-c`} className="text-xs font-semibold text-muted-foreground">
              Separado por
            </label>
            <select
              id={`${uid}-c`}
              className={cn(SELECT, "mt-1")}
              value={estado.corte}
              onChange={(e) => onCambiar({ corte: e.target.value as Corte })}
            >
              {CORTES.filter((c) => corteAdmitido(estado.metrica, c)).map((c) => (
                <option key={c} value={c}>
                  {ETIQUETA_CORTE[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-c2`} className="text-xs font-semibold text-muted-foreground">
              Cruzado con
            </label>
            <select
              id={`${uid}-c2`}
              className={cn(SELECT, "mt-1")}
              value={estado.corte2}
              disabled={estado.corte === "total"}
              onChange={(e) => onCambiar({ corte2: e.target.value as Corte })}
            >
              {CORTES.filter(
                (c) => corteAdmitido(estado.metrica, c) && (c === "total" || c !== estado.corte),
              ).map((c) => (
                <option key={c} value={c}>
                  {c === "total" ? "Nada" : ETIQUETA_CORTE[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-cmp`} className="text-xs font-semibold text-muted-foreground">
              Comparar con
            </label>
            <select
              id={`${uid}-cmp`}
              className={cn(SELECT, "mt-1")}
              value={estado.comparar ?? ""}
              disabled={estado.corte2 !== "total"}
              onChange={(e) =>
                onCambiar({ comparar: (e.target.value || null) as ModoComparacion | null })
              }
            >
              <option value="">No comparar</option>
              <option value="anterior">{ETIQUETA_COMPARACION.anterior}</option>
              <option value="anio">{ETIQUETA_COMPARACION.anio}</option>
            </select>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{def.descripcion}</p>
      </section>

      <Guardados
        ctx={ctx}
        config={{
          ...estado,
          periodo,
          desde: ctx.desde,
          hasta: ctx.hasta,
          sucursal: ctx.sucursal,
          profesional: ctx.profesional,
        }}
        onAbrir={onAbrirGuardado}
      />

      {error ? (
        <ErrorDeCarga
          mensaje="No pudimos calcular el informe."
          onReintentar={() => void refetch()}
        />
      ) : isPending || !data ? (
        <TintaCargando texto="Calculando el informe…" />
      ) : estado.corte2 !== "total" ? (
        <Matriz ctx={ctx} estado={estado} filas={data.filas} currency={data.currency} />
      ) : (
        <Lista ctx={ctx} estado={estado} resultado={data} />
      )}
    </div>
  );
}

type Resultado = Awaited<ReturnType<typeof getInformeMetrica>>;

function Lista({
  ctx,
  estado,
  resultado,
}: {
  ctx: ContextoInforme;
  estado: EstadoConstructor;
  resultado: Resultado;
}) {
  const def = DEF_METRICAS[estado.metrica];
  const etiquetas = new Map(resultado.filas.map((f) => [f.clave, f.etiqueta]));
  for (const f of resultado.anterior?.filas ?? [])
    if (!etiquetas.has(f.clave)) etiquetas.set(f.clave, f.etiqueta);
  const filas = resultado.anterior
    ? unirComparacion(estado.corte, resultado.filas, resultado.anterior.filas)
    : ordenarPorCorte(estado.corte, totalesPorClave(resultado.filas)).map((f) => ({
        clave: f.clave,
        valor: f.valor as number | null,
        anterior: null as number | null,
      }));
  const max = Math.max(0, ...filas.map((f) => f.valor ?? 0));
  const titulo = nombreSugerido(estado);
  type Fila = (typeof filas)[number];
  const dinero = def.unidad === "dinero";
  const columnasCsv: ColumnaLista<Fila>[] = [
    { header: ETIQUETA_CORTE[estado.corte], value: (f) => etiquetas.get(f.clave) ?? "" },
    {
      header: def.label,
      value: (f) => (dinero ? montoPlanilla(f.valor, resultado.currency) : f.valor),
      dinero,
    },
    ...(resultado.anterior
      ? [
          {
            header: `${def.label} (comparación)`,
            value: (f: Fila) =>
              dinero ? montoPlanilla(f.anterior, resultado.currency) : f.anterior,
            dinero,
          },
          {
            header: "Variación %",
            value: (f: Fila) => variacion(f.valor, f.anterior)?.pct ?? null,
          },
        ]
      : []),
  ];

  return (
    <section className={cn(PANEL, "overflow-hidden")}>
      <div className="p-5 pb-3">
        <CabeceraPanel
          titulo={titulo}
          detalle={
            resultado.anterior
              ? `Comparado con ${ETIQUETA_COMPARACION[estado.comparar ?? "anterior"].toLowerCase()}. Toca una cifra para ver de dónde sale.`
              : "Toca una cifra para ver de dónde sale."
          }
          acciones={
            <BotonesExportar
              ctx={ctx}
              filas={filas}
              columnas={columnasCsv}
              archivo={titulo}
              filtros={{ metrica: estado.metrica, corte: estado.corte }}
            />
          }
        />
      </div>
      {filas.length === 0 ? (
        <SinDatos
          titulo="Sin datos en este período."
          detalle="Prueba con otro período o sin filtros."
        />
      ) : (
        <TablaAPlus
          columnas={[
            { label: ETIQUETA_CORTE[estado.corte] },
            { label: def.label, derecha: true },
            ...(resultado.anterior
              ? [
                  { label: "Antes", derecha: true },
                  { label: "Cambio", derecha: true },
                ]
              : []),
          ]}
        >
          {filas.map((f, i) => {
            const total = resultado.anterior ? 4 : 2;
            const etiqueta = etiquetas.get(f.clave) ?? "";
            return (
              <tr key={`${f.clave ?? "sin"}-${i}`} className={FILA}>
                <td className={celda(0, total, "min-w-[10rem]")}>
                  <span className="block truncate">{etiqueta}</span>
                  <BarraFina
                    pct={max > 0 && f.valor ? (f.valor / max) * 100 : 0}
                    color={colorDeSerie(0, "papel")}
                    className="mt-1.5 max-w-[18rem]"
                  />
                </td>
                <td className={celda(1, total, "text-right")}>
                  {f.valor === null ? (
                    <span className="text-muted-foreground">Sin datos</span>
                  ) : (
                    <CifraClicable
                      etiqueta={`Ver el detalle de ${def.label.toLowerCase()}: ${etiqueta}`}
                      onClick={() =>
                        ctx.onDetalle({
                          titulo: `${def.label} · ${etiqueta}`,
                          metrica: estado.metrica,
                          corte: estado.corte,
                          clave: f.clave,
                        })
                      }
                    >
                      {formatearValor(def.unidad, f.valor, resultado.currency)}
                    </CifraClicable>
                  )}
                </td>
                {resultado.anterior && (
                  <>
                    <td className={celda(2, total, "cifra text-right text-muted-foreground")}>
                      {f.anterior === null
                        ? "Sin datos"
                        : formatearValor(def.unidad, f.anterior, resultado.currency)}
                    </td>
                    <td className={celda(3, total, "text-right")}>
                      <VariacionTexto
                        v={variacion(f.valor, f.anterior)}
                        unidad={def.unidad}
                        currency={resultado.currency}
                      />
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </TablaAPlus>
      )}
    </section>
  );
}

function Matriz({
  ctx,
  estado,
  filas,
  currency,
}: {
  ctx: ContextoInforme;
  estado: EstadoConstructor;
  filas: Resultado["filas"];
  currency: string;
}) {
  const def = DEF_METRICAS[estado.metrica];
  const filasUnicas = ordenarPorCorte(estado.corte, totalesPorClave(filas));
  const columnas = ordenarPorCorte(
    estado.corte2,
    totalesPorClave(filas.map((f) => ({ ...f, clave: f.clave2, clave2: f.clave }))),
  );
  const etiqueta1 = new Map(filas.map((f) => [f.clave, f.etiqueta]));
  const etiqueta2 = new Map(filas.map((f) => [f.clave2, f.etiqueta2]));
  const celdaDe = (a: string | null, b: string | null) =>
    filas.find((f) => f.clave === a && f.clave2 === b);
  const titulo = nombreSugerido(estado);
  const dinero = def.unidad === "dinero";
  const columnasCsv: ColumnaLista<Resultado["filas"][number]>[] = [
    { header: ETIQUETA_CORTE[estado.corte], value: (f) => f.etiqueta },
    { header: ETIQUETA_CORTE[estado.corte2], value: (f) => f.etiqueta2 },
    {
      header: def.label,
      value: (f) => (dinero ? montoPlanilla(f.valor, currency) : f.valor),
      dinero,
    },
  ];

  return (
    <section className={cn(PANEL, "overflow-hidden")}>
      <div className="p-5 pb-3">
        <CabeceraPanel
          titulo={titulo}
          detalle="Cada celda se puede tocar para ver los registros que la componen. Vacío = no hubo registros."
          acciones={
            <BotonesExportar ctx={ctx} filas={filas} columnas={columnasCsv} archivo={titulo} />
          }
        />
      </div>
      {filas.length === 0 ? (
        <SinDatos titulo="Sin datos en este período." />
      ) : (
        <TablaAPlus
          minAncho={`${Math.max(28, 10 + columnas.length * 7)}rem`}
          columnas={[
            { label: `${ETIQUETA_CORTE[estado.corte]} / ${ETIQUETA_CORTE[estado.corte2]}` },
            ...columnas.map((c) => ({ label: etiqueta2.get(c.clave) ?? "", derecha: true })),
            { label: "Total", derecha: true },
          ]}
        >
          {filasUnicas.map((fila) => {
            const total = columnas.length + 2;
            const e1 = etiqueta1.get(fila.clave) ?? "";
            return (
              <tr key={fila.clave ?? "sin"} className={FILA}>
                <th scope="row" className={celda(0, total, "text-left font-medium")}>
                  {e1}
                </th>
                {columnas.map((c, j) => {
                  const x = celdaDe(fila.clave, c.clave);
                  const e2 = etiqueta2.get(c.clave) ?? "";
                  return (
                    <td key={c.clave ?? "sin"} className={celda(j + 1, total, "text-right")}>
                      {x ? (
                        <CifraClicable
                          etiqueta={`Ver el detalle: ${e1}, ${e2}`}
                          onClick={() =>
                            ctx.onDetalle({
                              titulo: `${def.label} · ${e1} · ${e2}`,
                              metrica: estado.metrica,
                              corte: estado.corte,
                              clave: fila.clave,
                              corte2: estado.corte2,
                              clave2: c.clave,
                            })
                          }
                        >
                          {formatearValor(def.unidad, x.valor, currency)}
                        </CifraClicable>
                      ) : (
                        <span className="text-muted-foreground" aria-label="Sin registros">
                          ·
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className={celda(total - 1, total, "cifra text-right font-semibold")}>
                  {formatearValor(def.unidad, fila.valor, currency)}
                </td>
              </tr>
            );
          })}
        </TablaAPlus>
      )}
    </section>
  );
}

function Guardados({
  ctx,
  config,
  onAbrir,
}: {
  ctx: ContextoInforme;
  config: ConfigInforme;
  onAbrir: (c: ConfigInforme) => void;
}) {
  const uid = useId();
  const qc = useQueryClient();
  const clave = ["informes-guardados", ctx.clinicId];
  const fetchLista = useServerFn(listInformesGuardados);
  const guardar = useServerFn(guardarInforme);
  const borrar = useServerFn(borrarInformeGuardado);
  const [nombre, setNombre] = useState("");
  const [compartido, setCompartido] = useState(false);
  const { data: lista } = useQuery({
    queryKey: clave,
    queryFn: () => fetchLista({ data: { clinicId: ctx.clinicId } }),
  });
  const mGuardar = useMutation({
    mutationFn: () =>
      guardar({
        data: {
          clinicId: ctx.clinicId,
          nombre: nombre.trim() || nombreSugerido(config),
          config,
          compartido,
        },
      }),
    onSuccess: () => {
      toast.success("Informe guardado");
      setNombre("");
      void qc.invalidateQueries({ queryKey: clave });
    },
    onError: (e) =>
      toast.error("No pudimos guardar el informe", { description: mensajeDeError(e) }),
  });
  const mBorrar = useMutation({
    mutationFn: (g: InformeGuardado) => borrar({ data: { clinicId: ctx.clinicId, id: g.id } }),
    onSuccess: () => {
      toast.success("Informe borrado");
      void qc.invalidateQueries({ queryKey: clave });
    },
    onError: (e) => toast.error("No pudimos borrar el informe", { description: mensajeDeError(e) }),
  });

  return (
    <section className={cn(PANEL, "no-imprimir p-5")} aria-label="Informes guardados">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          mGuardar.mutate();
        }}
      >
        <div className="min-w-[12rem] flex-1">
          <label htmlFor={`${uid}-n`} className="text-xs font-semibold text-muted-foreground">
            Guardar este informe como
          </label>
          <input
            id={`${uid}-n`}
            value={nombre}
            maxLength={80}
            placeholder={nombreSugerido(config)}
            onChange={(e) => setNombre(e.target.value)}
            className={cn(SELECT, "mt-1")}
          />
        </div>
        <label className="flex h-10 items-center gap-2 text-sm pointer-coarse:h-11">
          <input
            type="checkbox"
            checked={compartido}
            onChange={(e) => setCompartido(e.target.checked)}
            className="size-4 accent-foreground"
          />
          Compartir con el equipo
        </label>
        <Button
          type="submit"
          size="sm"
          className="h-10 rounded-full pointer-coarse:h-11"
          disabled={mGuardar.isPending}
        >
          <Bookmark className="size-4" aria-hidden />
          Guardar
        </Button>
      </form>
      {lista && lista.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Tus informes guardados">
          {lista.map((g) => (
            <li key={g.id} className="inline-flex items-center rounded-full border border-control">
              <button
                type="button"
                onClick={() => onAbrir(g.config)}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-full pl-3 pr-2 text-[12.5px] font-semibold hover:bg-muted pointer-coarse:h-11"
              >
                {g.compartido && <Users className="size-3.5" aria-label="Compartido" />}
                {g.nombre}
              </button>
              {g.propio && (
                <button
                  type="button"
                  aria-label={`Borrar ${g.nombre}`}
                  onClick={() => {
                    if (window.confirm(`¿Borrar el informe "${g.nombre}"?`)) mBorrar.mutate(g);
                  }}
                  className="grid size-[30px] place-items-center rounded-full text-muted-foreground hover:text-foreground pointer-coarse:size-11"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
