/**
 * Bloques de la vista general de Finanzas (Ola 10 · frente A): por cobrar y
 * resultado por sucursal (FIN-01), venta real (FIN-18), folios de boletas
 * emitidas afuera (FIN-15) y la planilla del período para el contador
 * (FIN-13). Todo lo lee el servidor con `finance:view`; las sumas las hace
 * Postgres.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleDashed, FileCheck2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ErrorDeCarga } from "@/components/estado-error";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { INPUT } from "@/components/finanzas/piezas";
import {
  BarraFina,
  Chips,
  colorDeSerie,
  Destacado,
  FILA,
  PANEL,
  Pastilla,
  SinDatos,
  TITULO_PANEL,
  TablaAPlus,
  celda,
} from "@/components/reportes/aplus";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { hasPermission, type SujetoDePermisos } from "@/lib/access/access";
import { colorProfesional } from "@/lib/clinic-operations/color-profesional";
import { fechaPlanilla, montoPlanilla } from "@/lib/exportacion/listas-csv";
import { formatMoney } from "@/lib/finance/finance";
import {
  ETIQUETA_DOCUMENTO,
  ETIQUETA_MOVIMIENTO,
  TIPOS_DOCUMENTO,
  leerVentaReal,
  ordenarSucursales,
  ordenarVentaReal,
  resultadoDeSucursal,
  totalizarSucursales,
  totalizarVentaReal,
  validarFolio,
  type TipoDocumento,
} from "@/lib/finance/vista-general";
import {
  borrarFolio,
  getVistaGeneralFinanzas,
  guardarFolio,
  listMovimientosDelPeriodo,
  listPagosConFolio,
  type PagoConFolio,
} from "@/lib/finance/vista-general.functions";
import { fecha, numero } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

interface Props {
  clinicId: string;
  desde: string;
  hasta: string;
  currency: string;
  timezone: string;
  /** El acceso del usuario (con sus ajustes por persona) o un rol suelto. */
  rol: SujetoDePermisos;
}

const ENLACE =
  "rounded-sm text-sm font-medium text-brand-700 underline-offset-4 outline-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function VistaGeneralFinanzas({ clinicId, desde, hasta, currency, timezone, rol }: Props) {
  const fn = useServerFn(getVistaGeneralFinanzas);
  const consulta = useQuery({
    queryKey: ["finanzas-vista-general", clinicId, desde, hasta],
    queryFn: () => fn({ data: { clinicId, desde, hasta } }),
  });
  const dinero = (c: number) => formatMoney(c, currency);

  if (consulta.isError) {
    return (
      <ErrorDeCarga
        mensaje="No pudimos cargar la vista general. Revisa la conexión."
        onReintentar={() => void consulta.refetch()}
        reintentando={consulta.isFetching}
      />
    );
  }
  if (!consulta.data) {
    return <p className="text-sm text-muted-foreground">Cargando la vista general…</p>;
  }
  const v = consulta.data;
  const t = totalizarSucursales(v.sucursales);
  const sucursales = ordenarSucursales(v.sucursales);
  const porCobrarTotal = v.porCobrar.saldoPacientesCents + v.porCobrar.cuotasPendientesCents;

  return (
    <>
      <section aria-labelledby="fin-general" className={cn(PANEL, "p-5")}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="fin-general" className={TITULO_PANEL}>
            Vista <Destacado>general</Destacado>
          </h2>
          <ExportarPlanilla
            clinicId={clinicId}
            desde={desde}
            hasta={hasta}
            timezone={timezone}
            rol={rol}
          />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-4">
          <Dato
            label="Ingresos"
            valor={dinero(t.ingresosCents)}
            nota={
              t.cuotasCobradasCents > 0
                ? `${dinero(t.cobradoCents)} de pagos + ${dinero(t.cuotasCobradasCents)} de membresías`
                : `${numero(t.pagos)} ${t.pagos === 1 ? "pago" : "pagos"}`
            }
          />
          <Dato
            label="Por cobrar hoy"
            valor={dinero(porCobrarTotal)}
            nota={`${numero(v.porCobrar.pacientesConSaldo)} pacientes con saldo${
              v.porCobrar.cuotasPendientes > 0
                ? ` · ${numero(v.porCobrar.cuotasPendientes)} cuotas`
                : ""
            }`}
          />
          <Dato
            label="Gastos"
            valor={dinero(t.gastosCents)}
            nota={`${numero(t.gastos)} ${t.gastos === 1 ? "gasto" : "gastos"}`}
          />
          <Dato
            label="Resultado"
            valor={dinero(t.resultadoCents)}
            nota={t.resultadoCents < 0 ? "en negativo" : "ingresos menos gastos"}
          />
        </dl>
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link to="/morosidad" className={ENLACE}>
            Morosidad →
          </Link>
          <Link to="/gastos-fijos" search={{ mes: "" }} className={ENLACE}>
            Gastos fijos →
          </Link>
          <Link to="/membresias" search={{ mes: "" }} className={ENLACE}>
            Membresías →
          </Link>
          <Link to="/empresas-con-convenio" className={ENLACE}>
            Empresas con convenio →
          </Link>
        </p>

        {sucursales.length > 1 && (
          <div className="-mx-5 mt-5 border-t border-hairline pt-2">
            <TablaAPlus
              minAncho="36rem"
              columnas={[
                { label: "Sucursal" },
                { label: "Ingresos", derecha: true },
                { label: "Gastos", derecha: true },
                { label: "Resultado", derecha: true },
                { label: "Producción", derecha: true },
              ]}
            >
              {sucursales.map((s) => (
                <tr key={s.branchId ?? "sin"} className={FILA}>
                  <td className={celda(0, 5, "font-medium")}>{s.branchName}</td>
                  <td className={celda(1, 5, "cifra text-right")}>
                    {dinero(s.cobradoCents + s.cuotasCobradasCents)}
                  </td>
                  <td className={celda(2, 5, "cifra text-right")}>{dinero(s.gastosCents)}</td>
                  <td className={celda(3, 5, "cifra text-right")}>
                    {dinero(resultadoDeSucursal(s))}
                  </td>
                  <td className={celda(4, 5, "cifra text-right")}>{dinero(s.realizadoCents)}</td>
                </tr>
              ))}
            </TablaAPlus>
            <p className="px-5 pt-2 text-xs text-muted-foreground">
              Un pago va a la sucursal de su caja (o del paciente); los gastos de toda la clínica
              quedan en «Sin sucursal».
            </p>
          </div>
        )}
      </section>

      <VentaReal filas={v.ventaReal} currency={currency} />
    </>
  );
}

function Dato({ label, valor, nota }: { label: string; valor: string; nota?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="cifra mt-0.5 text-[20px] leading-tight">{valor}</dd>
      {nota && <dd className="mt-0.5 text-[12.5px] text-muted-foreground">{nota}</dd>}
    </div>
  );
}

const LECTURA: Record<ReturnType<typeof leerVentaReal>, string> = {
  sin_datos: "Sin presupuestos aceptados, tratamientos realizados ni cobros en este período.",
  se_hizo_mas_de_lo_presupuestado:
    "Se hizo más de lo que se aceptó en el período: se están ejecutando presupuestos de meses anteriores.",
  se_hizo_lo_presupuestado: "Lo realizado va a la par con lo presupuestado.",
  falta_por_hacer:
    "Se aceptó más de lo que se alcanzó a hacer: hay tratamientos aceptados esperando hora.",
  falta_por_cobrar:
    "Lo cobrado no llega al 80 % de lo realizado: revisa Morosidad y las cuentas por cobrar.",
  al_dia: "Lo cobrado va al día con lo realizado.",
};

function VentaReal({
  filas,
  currency,
}: {
  filas: Parameters<typeof totalizarVentaReal>[0];
  currency: string;
}) {
  const t = totalizarVentaReal(filas);
  const lista = ordenarVentaReal(filas);
  const dinero = (c: number) => formatMoney(c, currency);
  const max = Math.max(t.presupuestadoCents, t.realizadoCents, t.cobradoCents, 1);

  return (
    <section aria-labelledby="fin-venta-real" className={cn(PANEL, "p-5")}>
      <h2 id="fin-venta-real" className={TITULO_PANEL}>
        Venta <Destacado>real</Destacado>
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm text-foreground/80">{LECTURA[leerVentaReal(t)]}</p>
      <ul className="mt-4 grid gap-3.5 md:grid-cols-3">
        {[
          {
            k: "Presupuestado",
            v: t.presupuestadoCents,
            n: `${numero(t.presupuestos)} aceptados en el período`,
          },
          {
            k: "Realizado",
            v: t.realizadoCents,
            n:
              t.realizadoSobrePresupuestado === null
                ? `${numero(t.realizadoItems)} tratamientos completados`
                : `${t.realizadoSobrePresupuestado} % de lo presupuestado`,
          },
          {
            k: "Cobrado",
            v: t.cobradoCents,
            n:
              t.cobradoSobreRealizado === null
                ? "pagos del período"
                : `${t.cobradoSobreRealizado} % de lo que le toca al paciente`,
          },
        ].map((x, i) => (
          <li key={x.k}>
            <div className="flex justify-between gap-2 text-sm font-semibold">
              <span>{x.k}</span>
              <span className="cifra font-medium">{dinero(x.v)}</span>
            </div>
            <BarraFina
              className="mt-1.5"
              pct={(x.v / max) * 100}
              color={
                i === 0
                  ? "var(--color-muted-foreground)"
                  : i === 1
                    ? colorDeSerie(0, "papel")
                    : "var(--color-success)"
              }
            />
            <p className="mt-1 text-[12.5px] text-muted-foreground">{x.n}</p>
          </li>
        ))}
      </ul>
      {lista.length > 0 && (
        <div className="-mx-5 mt-5 border-t border-hairline pt-2">
          <TablaAPlus
            minAncho="34rem"
            columnas={[
              { label: "Profesional" },
              { label: "Presupuestado", derecha: true },
              { label: "Realizado", derecha: true },
              { label: "Cobrado", derecha: true },
            ]}
          >
            {lista.map((f) => (
              <tr key={f.professionalId ?? "sin"} className={FILA}>
                <td className={celda(0, 4)}>
                  <span className="inline-flex items-center gap-2 font-medium">
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full"
                      style={{
                        background:
                          f.color === null
                            ? "var(--color-muted-foreground)"
                            : colorProfesional(f.color),
                      }}
                    />
                    {f.professionalName}
                  </span>
                </td>
                <td className={celda(1, 4, "cifra text-right")}>{dinero(f.presupuestadoCents)}</td>
                <td className={celda(2, 4, "cifra text-right")}>{dinero(f.realizadoCents)}</td>
                <td className={celda(3, 4, "cifra text-right")}>{dinero(f.cobradoCents)}</td>
              </tr>
            ))}
          </TablaAPlus>
          <p className="px-5 pt-2 text-xs text-muted-foreground">
            Presupuestado: aceptado en el período. Realizado: tratamientos completados, a precio de
            lista. Cobrado: pagos del período; va al profesional solo si el pago se imputó a un
            tratamiento suyo.
          </p>
        </div>
      )}
    </section>
  );
}

function ExportarPlanilla({
  clinicId,
  desde,
  hasta,
  timezone,
  rol,
}: {
  clinicId: string;
  desde: string;
  hasta: string;
  timezone: string;
  /** El acceso del usuario (con sus ajustes por persona) o un rol suelto. */
  rol: SujetoDePermisos;
}) {
  const fn = useServerFn(listMovimientosDelPeriodo);
  const { data: movimientos = [] } = useQuery({
    queryKey: ["finanzas-movimientos", clinicId, desde, hasta],
    queryFn: () => fn({ data: { clinicId, desde, hasta } }),
  });
  return (
    <ExportarCsvLista
      clinicId={clinicId}
      rol={rol}
      lista="finanzas"
      timezone={timezone}
      filas={movimientos}
      filtros={{ desde, hasta }}
      archivo={`Finanzas ${desde} a ${hasta}`}
      columnas={[
        { header: "Fecha", value: (m) => fechaPlanilla(m.fecha) },
        { header: "Tipo", value: (m) => ETIQUETA_MOVIMIENTO[m.tipo] },
        { header: "Detalle", value: (m) => m.detalle },
        { header: "Paciente", value: (m) => m.paciente },
        { header: "Medio", value: (m) => m.medio },
        { header: "Sucursal", value: (m) => m.sucursal },
        {
          header: "Ingreso",
          value: (m) => (m.tipo === "gasto" ? null : montoPlanilla(m.montoCents, m.currency)),
          dinero: true,
        },
        {
          header: "Gasto",
          value: (m) => (m.tipo === "gasto" ? montoPlanilla(m.montoCents, m.currency) : null),
          dinero: true,
        },
        { header: "Moneda", value: (m) => m.currency, dinero: true },
        { header: "Documento", value: (m) => m.documento },
        { header: "Folio", value: (m) => m.folio },
      ]}
    />
  );
}

// ─── Folios (FIN-15) ────────────────────────────────────────────────────────

type FiltroFolio = "sin" | "con" | "todos";

export function BoletasDelPeriodo({ clinicId, desde, hasta, currency, timezone, rol }: Props) {
  const fn = useServerFn(listPagosConFolio);
  const consulta = useQuery({
    queryKey: ["finanzas-folios", clinicId, desde, hasta],
    queryFn: () => fn({ data: { clinicId, desde, hasta } }),
  });
  const [filtro, setFiltro] = useState<FiltroFolio>("sin");
  const [editando, setEditando] = useState<PagoConFolio | null>(null);
  const puedeAnotar = hasPermission(rol, "cash:manage");
  const pagos = consulta.data ?? [];
  const sin = pagos.filter((p) => !p.folio).length;
  const visibles = pagos
    .filter((p) => (filtro === "todos" ? true : filtro === "sin" ? !p.folio : Boolean(p.folio)))
    .slice(0, 200);

  return (
    <section aria-labelledby="fin-boletas" className={cn(PANEL, "p-0")}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div>
          <h2 id="fin-boletas" className={TITULO_PANEL}>
            Boletas y <Destacado>facturas</Destacado>
          </h2>
          <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">
            Esmalia no emite documentos tributarios: anota acá el folio de la boleta o factura que
            emitiste en el SII u otro sistema, para cuadrar con el contador.
          </p>
        </div>
        <Chips
          etiqueta="Folio"
          valor={filtro}
          onCambiar={setFiltro}
          opciones={[
            { valor: "sin", label: "Sin folio", cuenta: sin },
            { valor: "con", label: "Con folio", cuenta: pagos.length - sin },
            { valor: "todos", label: "Todos", cuenta: pagos.length },
          ]}
        />
      </div>
      {consulta.isError ? (
        <ErrorDeCarga
          className="m-5"
          mensaje="No pudimos cargar los pagos del período."
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        />
      ) : !consulta.data ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Cargando pagos…</p>
      ) : visibles.length === 0 ? (
        <SinDatos
          titulo={
            filtro === "sin" && pagos.length > 0
              ? "Todos los pagos del período tienen su folio."
              : "No hay pagos con este filtro en el período."
          }
        />
      ) : (
        <ul className="mt-3 divide-y divide-hairline">
          {visibles.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{p.patientName}</p>
                <p className="text-[13px] text-muted-foreground">
                  {fecha(p.paidAt, timezone)} · {p.medio}
                  {p.paymentGroupId ? " · cobro con varios medios" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="cifra text-[15px]">{formatMoney(p.amountCents, currency)}</span>
                {p.folio ? (
                  <button
                    type="button"
                    onClick={() => puedeAnotar && setEditando(p)}
                    disabled={!puedeAnotar}
                    className="rounded-full outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`Editar folio ${p.folio.folio}`}
                  >
                    <Pastilla tono="success" icono={FileCheck2}>
                      {ETIQUETA_DOCUMENTO[p.folio.docType]} {p.folio.folio}
                    </Pastilla>
                  </button>
                ) : puedeAnotar ? (
                  <Button size="sm" variant="outline" onClick={() => setEditando(p)}>
                    <CircleDashed className="size-3.5" /> Anotar folio
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Sin folio</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editando && (
        <DialogoFolio
          clinicId={clinicId}
          pago={editando}
          currency={currency}
          timezone={timezone}
          onCerrar={() => setEditando(null)}
        />
      )}
    </section>
  );
}

function DialogoFolio({
  clinicId,
  pago,
  currency,
  timezone,
  onCerrar,
}: {
  clinicId: string;
  pago: PagoConFolio;
  currency: string;
  timezone: string;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState({
    docType: (pago.folio?.docType ?? "boleta") as TipoDocumento,
    folio: pago.folio?.folio ?? "",
    issuedOn: pago.folio?.issuedOn ?? pago.dia,
    issuer: pago.folio?.issuer ?? "SII",
  });
  const patch = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  const errores = validarFolio(d);
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ["finanzas-folios", clinicId] });
    void qc.invalidateQueries({ queryKey: ["finanzas-movimientos", clinicId] });
  };
  const guardarFn = useServerFn(guardarFolio);
  const guardar = useMutation({
    mutationFn: () =>
      guardarFn({ data: { clinicId, paymentId: pago.id, ...d, aplicarAlGrupo: true } }),
    onSuccess: ({ anotados }) => {
      invalidar();
      toast.success(
        anotados > 1 ? `Folio anotado en ${anotados} pagos del cobro` : "Folio anotado",
      );
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const borrarFn = useServerFn(borrarFolio);
  const borrar = useMutation({
    mutationFn: () => borrarFn({ data: { clinicId, paymentId: pago.id } }),
    onSuccess: () => {
      invalidar();
      toast.success("Folio quitado");
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{pago.folio ? "Editar folio" : "Anotar folio"}</DialogTitle>
          <DialogDescription>
            Pago de {pago.patientName} por {formatMoney(pago.amountCents, currency)} del{" "}
            {fecha(pago.paidAt, timezone)}.
            {pago.paymentGroupId && " Se anota en todos los medios de este cobro."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fo-tipo">Documento</Label>
              <select
                id="fo-tipo"
                value={d.docType}
                onChange={(e) => patch({ docType: e.target.value as TipoDocumento })}
                className={INPUT}
              >
                {TIPOS_DOCUMENTO.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_DOCUMENTO[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fo-folio">Folio *</Label>
              <input
                id="fo-folio"
                inputMode="numeric"
                value={d.folio}
                onChange={(e) => patch({ folio: e.target.value })}
                className={INPUT}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fo-fecha">Emitida el</Label>
              <input
                id="fo-fecha"
                type="date"
                value={d.issuedOn}
                onChange={(e) => patch({ issuedOn: e.target.value })}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fo-emisor">Emitida en</Label>
              <input
                id="fo-emisor"
                value={d.issuer}
                onChange={(e) => patch({ issuer: e.target.value })}
                className={INPUT}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="flex-col items-end gap-1.5 sm:flex-row sm:items-center">
          {errores.length > 0 && (
            <p id="fo-motivo" className="text-xs text-muted-foreground">
              {errores[0]}
            </p>
          )}
          {pago.folio && (
            <Button variant="ghost" onClick={() => borrar.mutate()} disabled={borrar.isPending}>
              <Trash2 className="size-4" /> Quitar
            </Button>
          )}
          <Button
            onClick={() => guardar.mutate()}
            disabled={errores.length > 0 || guardar.isPending}
            aria-describedby={errores.length > 0 ? "fo-motivo" : undefined}
          >
            {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
