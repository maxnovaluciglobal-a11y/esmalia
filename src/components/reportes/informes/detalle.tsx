/**
 * INF-03 · De cualquier cifra al listado que la compone. Hoja lateral con
 * los hechos (citas, fichas, presupuestos, prestaciones o pagos) de esa
 * celda, los más recientes primero, enlace a la ficha y exportación a CSV.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { ErrorDeCarga } from "@/components/estado-error";
import {
  BotonesExportar,
  type ContextoInforme,
  type PedidoDetalle,
} from "@/components/reportes/informes/comunes";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  fechaHoraPlanilla,
  fechaPlanilla,
  fechaCortaHora,
  fechaCorta,
  numero,
} from "@/lib/formato-fecha";
import { montoPlanilla, type ColumnaLista } from "@/lib/exportacion/listas-csv";
import {
  DEF_METRICAS,
  etiquetaClave,
  formatearValor,
  NOMBRES_VACIOS,
} from "@/lib/reportes/informes";
import {
  getInformeDetalle,
  LIMITE_DETALLE,
  type FilaDetalle,
} from "@/lib/reportes/informes.functions";

export function DetalleDeCifra({
  ctx,
  pedido,
  onCerrar,
}: {
  ctx: ContextoInforme;
  pedido: PedidoDetalle | null;
  onCerrar: () => void;
}) {
  const fetchDetalle = useServerFn(getInformeDetalle);
  const desde = pedido?.desde ?? ctx.desde;
  const hasta = pedido?.hasta ?? ctx.hasta;
  const profesional = pedido?.profesional !== undefined ? pedido.profesional : ctx.profesional;
  const sucursal = pedido?.sucursal !== undefined ? pedido.sucursal : ctx.sucursal;
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ["informe-detalle", ctx.clinicId, pedido, desde, hasta, profesional, sucursal],
    enabled: Boolean(pedido),
    queryFn: () =>
      fetchDetalle({
        data: {
          clinicId: ctx.clinicId,
          desde,
          hasta,
          sucursal,
          profesional,
          metrica: pedido!.metrica,
          corte: pedido!.corte,
          clave: pedido!.clave,
          corte2: pedido!.corte2 ?? "total",
          clave2: pedido!.clave2 === undefined ? "total" : pedido!.clave2,
        },
      }),
  });

  const def = pedido ? DEF_METRICAS[pedido.metrica] : null;
  const currency = data?.currency ?? ctx.currency;

  const columnas: ColumnaLista<FilaDetalle>[] = [
    {
      header: "Fecha",
      value: (f) =>
        f.momento ? fechaHoraPlanilla(f.momento, ctx.timezone) : fechaPlanilla(f.fecha),
    },
    { header: "Paciente", value: (f) => f.paciente },
    { header: "Profesional", value: (f) => f.profesional },
    { header: "Box", value: (f) => f.box },
    { header: "Sucursal", value: (f) => f.sucursal },
    {
      header: "Estado",
      value: (f) => (f.estado ? etiquetaClave("estado", f.estado, NOMBRES_VACIOS) : null),
    },
    ...(def?.unidad === "dinero"
      ? [
          { header: "Moneda", value: () => currency, dinero: true },
          {
            header: "Monto",
            value: (f: FilaDetalle) => montoPlanilla(f.valor, currency),
            dinero: true,
          },
        ]
      : def?.unidad === "minutos"
        ? [{ header: "Minutos", value: (f: FilaDetalle) => f.valor }]
        : []),
  ];

  return (
    <Sheet open={Boolean(pedido)} onOpenChange={(abierta) => !abierta && onCerrar()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-hairline px-5 pb-4 pt-6 text-left">
          <SheetTitle className="pr-10 font-display text-[26px] font-medium leading-tight">
            {pedido?.titulo}
          </SheetTitle>
          <SheetDescription>
            {def?.descripcion} {fechaCorta(desde)} — {fechaCorta(hasta)}.
          </SheetDescription>
          {data && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <p className="text-sm">
                <b className="cifra">{numero(data.total)}</b>{" "}
                {data.total === 1 ? "registro" : "registros"}
                {data.total > data.filas.length && (
                  <span className="text-muted-foreground">
                    {" "}
                    · se muestran los {numero(LIMITE_DETALLE)} más recientes
                  </span>
                )}
              </p>
              <BotonesExportar
                ctx={ctx}
                filas={data.filas}
                columnas={columnas}
                archivo={`Detalle ${pedido?.titulo ?? "informe"}`}
                filtros={{ metrica: pedido?.metrica ?? "", corte: pedido?.corte ?? "" }}
              />
            </div>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="p-5">
              <ErrorDeCarga
                mensaje="No pudimos abrir el detalle."
                onReintentar={() => void refetch()}
              />
            </div>
          ) : isPending ? (
            <p className="p-5 text-sm text-muted-foreground" aria-busy>
              Buscando los registros…
            </p>
          ) : !data?.filas.length ? (
            <p className="p-5 text-sm text-muted-foreground">Sin registros para esta cifra.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {data.filas.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    {f.pacienteId ? (
                      <Link
                        to="/pacientes/$pacienteId"
                        params={{ pacienteId: f.pacienteId }}
                        className="font-medium text-brand-700 underline-offset-2 hover:underline"
                      >
                        {f.paciente}
                      </Link>
                    ) : (
                      <span className="font-medium">{f.paciente}</span>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {f.momento ? fechaCortaHora(f.momento, ctx.timezone) : fechaCorta(f.fecha)} ·{" "}
                      {f.profesional}
                      {f.box ? ` · ${f.box}` : ""}
                      {f.estado ? ` · ${etiquetaClave("estado", f.estado, NOMBRES_VACIOS)}` : ""}
                    </p>
                  </div>
                  {def && def.unidad !== "conteo" && (
                    <span className="cifra shrink-0">
                      {formatearValor(def.unidad, f.valor, currency)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
