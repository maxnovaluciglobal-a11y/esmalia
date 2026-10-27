/**
 * INF-09 · Informe del equipo (producción, atenciones y ausentismo por
 * profesional) e INF-10 · Red de sucursales (las sucursales lado a lado).
 * La producción y lo cobrado solo se muestran con permiso de finanzas.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

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
  type ContextoInforme,
} from "@/components/reportes/informes/comunes";
import { formatMoney } from "@/lib/finance/finance";
import { montoPlanilla, type ColumnaLista } from "@/lib/exportacion/listas-csv";
import { numero } from "@/lib/formato-fecha";
import {
  ausentismo,
  formatearMinutos,
  type FilaEquipo,
  type Metrica,
} from "@/lib/reportes/informes";
import { getInformeEquipo, getInformeRed, type FilaRed } from "@/lib/reportes/informes.functions";
import { cn } from "@/lib/utils";

function Cuenta({
  ctx,
  valor,
  metrica,
  corte,
  clave,
  nombre,
  titulo,
}: {
  ctx: ContextoInforme;
  valor: number;
  metrica: Metrica;
  corte: "profesional" | "sucursal";
  clave: string | null;
  nombre: string;
  titulo: string;
}) {
  if (valor === 0) return <span className="cifra text-muted-foreground">0</span>;
  return (
    <CifraClicable
      etiqueta={`Ver ${titulo.toLowerCase()} de ${nombre}`}
      onClick={() =>
        ctx.onDetalle({
          titulo: `${titulo} · ${nombre}`,
          metrica,
          corte,
          clave,
          // El detalle por profesional o sucursal no se cruza con el filtro de arriba.
          ...(corte === "profesional" ? { profesional: null } : { sucursal: null }),
        })
      }
    >
      {numero(valor)}
    </CifraClicable>
  );
}

export function VistaEquipo({ ctx }: { ctx: ContextoInforme }) {
  const fetchEquipo = useServerFn(getInformeEquipo);
  const filtros = {
    clinicId: ctx.clinicId,
    desde: ctx.desde,
    hasta: ctx.hasta,
    sucursal: ctx.sucursal,
  };
  const { data, error, refetch } = useQuery({
    queryKey: ["informe-equipo", filtros],
    queryFn: () => fetchEquipo({ data: filtros }),
  });
  if (error)
    return (
      <ErrorDeCarga
        mensaje="No pudimos armar el informe del equipo."
        onReintentar={() => void refetch()}
      />
    );
  if (!data) return <TintaCargando texto="Juntando lo de cada profesional…" />;

  const finanzas = data.some((f) => f.produccionCents !== null);
  const filas = [...data].sort(
    (a, b) =>
      (a.professionalId === null ? 1 : 0) - (b.professionalId === null ? 1 : 0) ||
      (b.produccionCents ?? 0) - (a.produccionCents ?? 0) ||
      b.atenciones - a.atenciones,
  );
  const maxProd = Math.max(0, ...filas.map((f) => f.produccionCents ?? 0));
  const columnasCsv: ColumnaLista<FilaEquipo>[] = [
    { header: "Profesional", value: (f) => f.nombre },
    { header: "Citas", value: (f) => f.citas },
    { header: "Atenciones", value: (f) => f.atenciones },
    { header: "Pacientes atendidos", value: (f) => f.pacientesAtendidos },
    { header: "Ausencias", value: (f) => f.ausencias },
    { header: "Ausentismo %", value: (f) => ausentismo(f) },
    { header: "Cancelaciones", value: (f) => f.cancelaciones },
    { header: "Minutos agendados", value: (f) => f.minutos },
    { header: "Moneda", value: () => ctx.currency, dinero: true },
    {
      header: "Producción",
      value: (f) => montoPlanilla(f.produccionCents, ctx.currency),
      dinero: true,
    },
  ];
  const n = finanzas ? 6 : 5;

  return (
    <section className={cn(PANEL, "overflow-hidden")}>
      <div className="p-5 pb-3">
        <CabeceraPanel
          titulo="Cada profesional"
          detalle={
            <>
              Ausentismo = ausencias sobre las citas que ya se cerraron (atendidas + ausentes).
              {!finanzas && " La producción la ve quien tiene permiso de finanzas."}
            </>
          }
          acciones={
            <BotonesExportar
              ctx={ctx}
              filas={filas}
              columnas={columnasCsv}
              archivo="Informe del equipo"
            />
          }
        />
      </div>
      {filas.length === 0 ? (
        <SinDatos titulo="Sin citas en este período." />
      ) : (
        <TablaAPlus
          minAncho={finanzas ? "46rem" : "38rem"}
          columnas={[
            { label: "Profesional" },
            { label: "Atenciones", derecha: true },
            { label: "Ausentismo", derecha: true },
            { label: "Cancelaciones", derecha: true },
            { label: "Tiempo agendado", derecha: true },
            ...(finanzas ? [{ label: "Producción", derecha: true }] : []),
          ]}
        >
          {filas.map((f) => {
            const aus = ausentismo(f);
            return (
              <tr key={f.professionalId ?? "sin"} className={FILA}>
                <td className={celda(0, n)}>
                  <span className="font-medium">{f.nombre}</span>
                  <span className="block text-xs text-muted-foreground">
                    {numero(f.citas)} citas · {numero(f.pacientesAtendidos)} pacientes
                  </span>
                </td>
                <td className={celda(1, n, "text-right")}>
                  <Cuenta
                    ctx={ctx}
                    valor={f.atenciones}
                    metrica="atenciones"
                    corte="profesional"
                    clave={f.professionalId}
                    nombre={f.nombre}
                    titulo="Atenciones"
                  />
                </td>
                <td className={celda(2, n, "text-right")}>
                  {aus === null ? (
                    <span className="text-xs text-muted-foreground">Sin datos</span>
                  ) : (
                    <span className="cifra">
                      {aus}%{" "}
                      <span className="text-xs text-muted-foreground">
                        (
                        <Cuenta
                          ctx={ctx}
                          valor={f.ausencias}
                          metrica="ausencias"
                          corte="profesional"
                          clave={f.professionalId}
                          nombre={f.nombre}
                          titulo="Ausencias"
                        />
                        )
                      </span>
                    </span>
                  )}
                </td>
                <td className={celda(3, n, "text-right")}>
                  <Cuenta
                    ctx={ctx}
                    valor={f.cancelaciones}
                    metrica="cancelaciones"
                    corte="profesional"
                    clave={f.professionalId}
                    nombre={f.nombre}
                    titulo="Cancelaciones"
                  />
                </td>
                <td className={celda(4, n, "cifra text-right")}>{formatearMinutos(f.minutos)}</td>
                {finanzas && (
                  <td className={celda(5, n, "text-right")}>
                    {f.produccionCents ? (
                      <CifraClicable
                        etiqueta={`Ver la producción de ${f.nombre}`}
                        onClick={() =>
                          ctx.onDetalle({
                            titulo: `Producción · ${f.nombre}`,
                            metrica: "produccion",
                            corte: "profesional",
                            clave: f.professionalId,
                            profesional: null,
                          })
                        }
                      >
                        {formatMoney(f.produccionCents, ctx.currency)}
                      </CifraClicable>
                    ) : (
                      <span className="cifra text-muted-foreground">
                        {formatMoney(0, ctx.currency)}
                      </span>
                    )}
                    <BarraFina
                      pct={maxProd > 0 ? ((f.produccionCents ?? 0) / maxProd) * 100 : 0}
                      color={colorDeSerie(0, "papel")}
                      className="ml-auto mt-1.5 w-24"
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </TablaAPlus>
      )}
    </section>
  );
}

export function VistaRed({ ctx }: { ctx: ContextoInforme }) {
  const fetchRed = useServerFn(getInformeRed);
  const filtros = { clinicId: ctx.clinicId, desde: ctx.desde, hasta: ctx.hasta };
  const { data, error, refetch } = useQuery({
    queryKey: ["informe-red", filtros],
    queryFn: () => fetchRed({ data: filtros }),
  });
  if (error)
    return (
      <ErrorDeCarga
        mensaje="No pudimos comparar las sucursales."
        onReintentar={() => void refetch()}
      />
    );
  if (!data) return <TintaCargando texto="Comparando las sucursales…" />;

  const finanzas = data.some((f) => f.produccionCents !== null);
  const filas = [...data]
    .filter((f) => f.branchId !== null || f.citas + f.pacientesNuevos + (f.cobradoCents ?? 0) > 0)
    .sort(
      (a, b) =>
        (a.branchId === null ? 1 : 0) - (b.branchId === null ? 1 : 0) ||
        b.atenciones - a.atenciones,
    );
  const columnasCsv: ColumnaLista<FilaRed>[] = [
    { header: "Sucursal", value: (f) => f.nombre },
    { header: "Citas", value: (f) => f.citas },
    { header: "Atenciones", value: (f) => f.atenciones },
    { header: "Ausentismo %", value: (f) => ausentismo(f) },
    { header: "Pacientes nuevos", value: (f) => f.pacientesNuevos },
    { header: "Minutos agendados", value: (f) => f.minutos },
    { header: "Moneda", value: () => ctx.currency, dinero: true },
    {
      header: "Producción",
      value: (f) => montoPlanilla(f.produccionCents, ctx.currency),
      dinero: true,
    },
    { header: "Cobrado", value: (f) => montoPlanilla(f.cobradoCents, ctx.currency), dinero: true },
  ];
  const n = finanzas ? 6 : 4;

  return (
    <section className={cn(PANEL, "overflow-hidden")}>
      <div className="p-5 pb-3">
        <CabeceraPanel
          titulo="Sucursales lado a lado"
          detalle={
            filas.filter((f) => f.branchId).length <= 1
              ? "Tienes una sola sucursal: este informe sirve cuando sumes otra."
              : "Las citas cuentan en la sucursal donde se agendaron; los pacientes nuevos, en su sucursal."
          }
          acciones={
            <BotonesExportar
              ctx={ctx}
              filas={filas}
              columnas={columnasCsv}
              archivo="Red de sucursales"
            />
          }
        />
      </div>
      {filas.length === 0 ? (
        <SinDatos titulo="Sin sucursales con movimiento en este período." />
      ) : (
        <TablaAPlus
          minAncho={finanzas ? "44rem" : "32rem"}
          columnas={[
            { label: "Sucursal" },
            { label: "Atenciones", derecha: true },
            { label: "Ausentismo", derecha: true },
            { label: "Pacientes nuevos", derecha: true },
            ...(finanzas
              ? [
                  { label: "Producción", derecha: true },
                  { label: "Cobrado", derecha: true },
                ]
              : []),
          ]}
        >
          {filas.map((f) => {
            const aus = ausentismo(f);
            return (
              <tr key={f.branchId ?? "sin"} className={FILA}>
                <td className={celda(0, n)}>
                  <span className="font-medium">{f.nombre}</span>
                  <span className="block text-xs text-muted-foreground">
                    {numero(f.citas)} citas · {formatearMinutos(f.minutos)}
                  </span>
                </td>
                <td className={celda(1, n, "text-right")}>
                  <Cuenta
                    ctx={ctx}
                    valor={f.atenciones}
                    metrica="atenciones"
                    corte="sucursal"
                    clave={f.branchId}
                    nombre={f.nombre}
                    titulo="Atenciones"
                  />
                </td>
                <td className={celda(2, n, "cifra text-right")}>
                  {aus === null ? (
                    <span className="text-xs text-muted-foreground">Sin datos</span>
                  ) : (
                    `${aus}%`
                  )}
                </td>
                <td className={celda(3, n, "text-right")}>
                  <Cuenta
                    ctx={ctx}
                    valor={f.pacientesNuevos}
                    metrica="pacientes_nuevos"
                    corte="sucursal"
                    clave={f.branchId}
                    nombre={f.nombre}
                    titulo="Pacientes nuevos"
                  />
                </td>
                {finanzas && (
                  <>
                    <td className={celda(4, n, "cifra text-right")}>
                      {formatMoney(f.produccionCents ?? 0, ctx.currency)}
                    </td>
                    <td className={celda(5, n, "cifra text-right")}>
                      {formatMoney(f.cobradoCents ?? 0, ctx.currency)}
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
