import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleDashed, Loader2, Pause, Pencil, Play, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { INPUT, SelectorMes } from "@/components/finanzas/piezas";
import { MoneyInput } from "@/components/money-input";
import {
  DatosEnTinta,
  Destacado,
  EncabezadoEditorial,
  EtiquetaTinta,
  MontoEnTinta,
  PANEL,
  Pastilla,
  SinDatos,
  TINTA,
  TITULO_PANEL,
  TintaCargando,
} from "@/components/reportes/aplus";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { requirePermission } from "@/lib/access/route-guards";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { listBranches } from "@/lib/clinic-operations/clinic-catalog.functions";
import { listPaymentMethods } from "@/lib/finance/clinic-finance.functions";
import { formatMoney } from "@/lib/finance/finance";
import {
  CATEGORIAS_GASTO_FIJO,
  costoMensualDeReferencia,
  mesDe,
  resumenGastosFijos,
  validarGastoFijo,
  type GastoFijo,
  type GastoFijoDelMes,
} from "@/lib/finance/gastos-fijos";
import {
  confirmarGastosFijos,
  getGastosFijos,
  saveGastoFijo,
  setGastoFijoActivo,
} from "@/lib/finance/gastos-fijos.functions";
import { fechaPlanilla, montoPlanilla, siNoPlanilla } from "@/lib/exportacion/listas-csv";
import { fecha, mesAnio, numero } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { str } from "@/lib/search";
import { cn } from "@/lib/utils";

interface GastosFijosSearch {
  mes: string;
}

export const Route = createFileRoute("/_authenticated/_clinic/gastos-fijos")({
  validateSearch: (search: Record<string, unknown>): GastosFijosSearch => ({
    mes: str(search.mes, ""),
  }),
  beforeLoad: requirePermission("finance:view"),
  head: () => ({
    meta: [
      { title: "Gastos fijos | Esmalia" },
      {
        name: "description",
        content:
          "Arriendo, sueldos y servicios que se repiten cada mes: confírmalos con su monto real y quedan en Gastos.",
      },
    ],
  }),
  component: GastosFijosPage,
});

function GastosFijosPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const clinicId = access.clinic?.id;
  const tz = access.clinic?.timezone;
  const currency = access.clinic?.currency ?? "CLP";
  const hoy = hoyISO(tz);
  const mes = /^\d{4}-\d{2}-\d{2}$/.test(search.mes) ? mesDe(search.mes) : mesDe(hoy);

  const fetchSub = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSub({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60_000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  const fetchGastos = useServerFn(getGastosFijos);
  const consulta = useQuery({
    queryKey: ["gastos-fijos", clinicId, mes],
    queryFn: () => fetchGastos({ data: { clinicId: clinicId!, mes } }),
    enabled: Boolean(clinicId) && !bloqueado,
  });

  const [editando, setEditando] = useState<GastoFijo | "nuevo" | null>(null);
  const [confirmando, setConfirmando] = useState<GastoFijoDelMes[] | null>(null);

  const delMes = consulta.data?.delMes ?? [];
  const resumen = resumenGastosFijos(delMes);
  const pendientes = delMes.filter((g) => g.estado === "pendiente");
  const plantillas = consulta.data?.plantillas ?? [];

  return (
    <AppShell title="Gastos fijos" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Gastos fijos" sub={sub ?? null} />
      ) : (
        <div className="mx-auto max-w-[84rem] space-y-[18px]">
          <EncabezadoEditorial
            seccion="Finanzas"
            pagina="Gastos fijos"
            titulo={
              <>
                Gastos fijos de <Destacado>{mesAnio(mes)}</Destacado>
              </>
            }
            conclusion={
              consulta.data
                ? resumen.pendientes > 0
                  ? `Faltan ${numero(resumen.pendientes)} por confirmar este mes, por ${formatMoney(resumen.pendientesCents, currency)} de referencia. Nada se carga solo: confírmalos con el monto real.`
                  : delMes.length > 0
                    ? "Todos los gastos fijos del mes están confirmados y ya cuentan en Gastos y en el resultado."
                    : "Todavía no hay gastos fijos. Agrega el arriendo, los sueldos o los servicios que pagas cada mes."
                : undefined
            }
            acciones={
              <>
                <SelectorMes mes={mes} onCambiar={(m) => navigate({ search: { mes: m } })} />
                <Button size="sm" onClick={() => setEditando("nuevo")}>
                  <Plus className="size-4" /> Agregar gasto fijo
                </Button>
              </>
            }
          />

          {consulta.isError ? (
            <ErrorDeCarga
              mensaje="No pudimos cargar los gastos fijos. Revisa la conexión."
              onReintentar={() => void consulta.refetch()}
              reintentando={consulta.isFetching}
            />
          ) : !consulta.data ? (
            <TintaCargando texto="Cargando los gastos fijos…" />
          ) : (
            <>
              <section
                aria-label="Resumen del mes"
                className={cn(TINTA, "grid gap-6 md:grid-cols-2")}
              >
                <div className="min-w-0">
                  <EtiquetaTinta>Gastos fijos del mes</EtiquetaTinta>
                  <MontoEnTinta cents={resumen.totalCents} currency={currency} />
                  <p className="mt-3 text-sm font-medium text-on-night-2">
                    Referencia mensual de lo activo:{" "}
                    <b className="font-semibold text-on-night">
                      {formatMoney(costoMensualDeReferencia(plantillas, mes), currency)}
                    </b>
                  </p>
                </div>
                <div className="flex min-w-0 flex-col justify-end gap-4">
                  <DatosEnTinta
                    datos={[
                      {
                        label: "Por confirmar",
                        valor: formatMoney(resumen.pendientesCents, currency),
                        nota: `${numero(resumen.pendientes)} ${resumen.pendientes === 1 ? "gasto" : "gastos"}`,
                      },
                      {
                        label: "Confirmados",
                        valor: formatMoney(resumen.confirmadosCents, currency),
                        nota: `${numero(resumen.confirmados)} en Gastos`,
                      },
                    ]}
                  />
                  {pendientes.length > 0 && (
                    <Button
                      variant="secondary"
                      className="self-start"
                      onClick={() => setConfirmando(pendientes)}
                    >
                      Confirmar los {numero(pendientes.length)} pendientes
                    </Button>
                  )}
                </div>
              </section>

              <section aria-labelledby="gf-mes" className={cn(PANEL, "p-0")}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
                  <h2 id="gf-mes" className={TITULO_PANEL}>
                    Este <Destacado>mes</Destacado>
                  </h2>
                  <Link
                    to="/gastos"
                    search={{ desde: mes, hasta: `${mes.slice(0, 8)}31`, categoria: "" }}
                    className="rounded-sm text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
                  >
                    Ver todos los gastos →
                  </Link>
                </div>
                {delMes.length === 0 ? (
                  <SinDatos
                    titulo="No hay gastos fijos que correspondan a este mes."
                    detalle="Un gasto fijo corre desde su primer mes y hasta el último, si lo tiene."
                  />
                ) : (
                  <ul className="mt-3 divide-y divide-hairline">
                    {delMes.map((g) => (
                      <li
                        key={g.gasto.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold">
                            {g.gasto.description}
                          </p>
                          <p className="text-[13px] text-muted-foreground">
                            {g.gasto.category} · vence el {fecha(g.fecha)}
                            {g.gasto.supplier ? ` · ${g.gasto.supplier}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="cifra text-[15px]">
                            {formatMoney(g.montoConfirmadoCents ?? g.gasto.amountCents, currency)}
                          </span>
                          {g.estado === "confirmado" ? (
                            <Pastilla tono="success" icono={CheckCircle2}>
                              Confirmado
                            </Pastilla>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setConfirmando([g])}>
                              <CircleDashed className="size-3.5" /> Confirmar
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="gf-plantillas" className={cn(PANEL, "p-0")}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
                  <h2 id="gf-plantillas" className={TITULO_PANEL}>
                    Todos los gastos <Destacado>fijos</Destacado>
                  </h2>
                  {clinicId && (
                    <ExportarCsvLista
                      clinicId={clinicId}
                      rol={access.role}
                      lista="gastos_fijos"
                      timezone={tz ?? "America/Santiago"}
                      filas={plantillas}
                      columnas={[
                        { header: "Descripción", value: (g) => g.description },
                        { header: "Categoría", value: (g) => g.category },
                        { header: "Proveedor", value: (g) => g.supplier },
                        {
                          header: "Monto",
                          value: (g) => montoPlanilla(g.amountCents, g.currency),
                          dinero: true,
                        },
                        { header: "Moneda", value: (g) => g.currency, dinero: true },
                        { header: "Día del mes", value: (g) => String(g.dayOfMonth) },
                        { header: "Desde", value: (g) => fechaPlanilla(g.startsOn) },
                        { header: "Hasta", value: (g) => fechaPlanilla(g.endsOn) },
                        { header: "Activo", value: (g) => siNoPlanilla(g.active) },
                      ]}
                    />
                  )}
                </div>
                {plantillas.length === 0 ? (
                  <SinDatos
                    titulo="Sin gastos fijos todavía."
                    detalle="Sugerencias: arriendo, sueldos, luz, internet, software, contador."
                    accion={
                      <Button size="sm" variant="outline" onClick={() => setEditando("nuevo")}>
                        <Plus className="size-4" /> Agregar el primero
                      </Button>
                    }
                  />
                ) : (
                  <ul className="mt-3 divide-y divide-hairline">
                    {plantillas.map((g) => (
                      <FilaPlantilla
                        key={g.id}
                        gasto={g}
                        clinicId={clinicId!}
                        currency={currency}
                        onEditar={() => setEditando(g)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {editando && clinicId && (
        <DialogoGastoFijo
          clinicId={clinicId}
          currency={currency}
          hoy={hoy}
          gasto={editando === "nuevo" ? null : editando}
          onCerrar={() => setEditando(null)}
        />
      )}
      {confirmando && clinicId && (
        <DialogoConfirmar
          clinicId={clinicId}
          currency={currency}
          mes={mes}
          gastos={confirmando}
          onCerrar={() => setConfirmando(null)}
        />
      )}
    </AppShell>
  );
}

function FilaPlantilla({
  gasto,
  clinicId,
  currency,
  onEditar,
}: {
  gasto: GastoFijo;
  clinicId: string;
  currency: string;
  onEditar: () => void;
}) {
  const qc = useQueryClient();
  const activarFn = useServerFn(setGastoFijoActivo);
  const activar = useMutation({
    mutationFn: () => activarFn({ data: { clinicId, id: gasto.id, active: !gasto.active } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["gastos-fijos", clinicId] });
      toast.success(gasto.active ? "Gasto fijo pausado" : "Gasto fijo reanudado");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <p
          className={cn(
            "truncate text-[15px] font-semibold",
            !gasto.active && "text-muted-foreground",
          )}
        >
          {gasto.description}
        </p>
        <p className="text-[13px] text-muted-foreground">
          {gasto.category} · día {gasto.dayOfMonth} · desde {mesAnio(gasto.startsOn)}
          {gasto.endsOn ? ` hasta ${mesAnio(gasto.endsOn)}` : ""}
          {!gasto.active && " · pausado"}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <span className="cifra mr-2 text-[15px]">{formatMoney(gasto.amountCents, currency)}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEditar}
          aria-label={`Editar ${gasto.description}`}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => activar.mutate()}
          disabled={activar.isPending}
          aria-label={
            gasto.active ? `Pausar ${gasto.description}` : `Reanudar ${gasto.description}`
          }
        >
          {gasto.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
      </div>
    </li>
  );
}

function DialogoGastoFijo({
  clinicId,
  currency,
  hoy,
  gasto,
  onCerrar,
}: {
  clinicId: string;
  currency: string;
  hoy: string;
  gasto: GastoFijo | null;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const fetchSuc = useServerFn(listBranches);
  const fetchMedios = useServerFn(listPaymentMethods);
  const { data: sucursales = [] } = useQuery({
    queryKey: ["branches", clinicId],
    queryFn: () => fetchSuc({ data: { clinicId } }),
  });
  const { data: medios = [] } = useQuery({
    queryKey: ["payment-methods", clinicId],
    queryFn: () => fetchMedios({ data: { clinicId } }),
  });
  const [d, setD] = useState({
    category: gasto?.category ?? "",
    description: gasto?.description ?? "",
    supplier: gasto?.supplier ?? "",
    amount: gasto?.amountCents ?? (null as number | null),
    dayOfMonth: gasto?.dayOfMonth ?? 5,
    startsOn: (gasto?.startsOn ?? mesDe(hoy)).slice(0, 7),
    endsOn: gasto?.endsOn?.slice(0, 7) ?? "",
    branchId: gasto?.branchId ?? "",
    paymentMethodId: gasto?.paymentMethodId ?? "",
    notes: gasto?.notes ?? "",
  });
  const patch = (p: Partial<typeof d>) => setD((x) => ({ ...x, ...p }));
  const entrada = {
    category: d.category,
    description: d.description,
    amountCents: d.amount ?? 0,
    dayOfMonth: d.dayOfMonth,
    startsOn: `${d.startsOn}-01`,
    endsOn: d.endsOn ? `${d.endsOn}-01` : null,
  };
  const errores = validarGastoFijo(entrada);
  const guardarFn = useServerFn(saveGastoFijo);
  const guardar = useMutation({
    mutationFn: () =>
      guardarFn({
        data: {
          clinicId,
          ...(gasto ? { id: gasto.id } : {}),
          ...entrada,
          supplier: d.supplier.trim() || null,
          branchId: d.branchId || null,
          paymentMethodId: d.paymentMethodId || null,
          notes: d.notes.trim() || null,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["gastos-fijos", clinicId] });
      toast.success(gasto ? "Gasto fijo actualizado" : "Gasto fijo agregado");
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{gasto ? "Editar gasto fijo" : "Agregar gasto fijo"}</DialogTitle>
          <DialogDescription>
            Lo que pagas todos los meses. No se carga solo: cada mes lo confirmas con el monto real
            y queda en Gastos. Editarlo no cambia los meses ya confirmados.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gf-cat">Categoría *</Label>
              <input
                id="gf-cat"
                list="gf-categorias"
                value={d.category}
                onChange={(e) => patch({ category: e.target.value })}
                placeholder="Ej: Arriendo"
                className={INPUT}
              />
              <datalist id="gf-categorias">
                {CATEGORIAS_GASTO_FIJO.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gf-monto">Monto de referencia *</Label>
              <MoneyInput
                id="gf-monto"
                currency={currency}
                min={0}
                valueCents={d.amount}
                onValueChange={(amount) => patch({ amount })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gf-desc">Qué se paga *</Label>
            <input
              id="gf-desc"
              value={d.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Ej: Arriendo de la consulta"
              className={INPUT}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="gf-dia">Día del mes</Label>
              <input
                id="gf-dia"
                type="number"
                min={1}
                max={28}
                value={d.dayOfMonth}
                onChange={(e) => patch({ dayOfMonth: Number(e.target.value) })}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gf-desde">Desde</Label>
              <input
                id="gf-desde"
                type="month"
                value={d.startsOn}
                onChange={(e) => patch({ startsOn: e.target.value })}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gf-hasta">Hasta (opcional)</Label>
              <input
                id="gf-hasta"
                type="month"
                value={d.endsOn}
                onChange={(e) => patch({ endsOn: e.target.value })}
                className={INPUT}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gf-prov">Proveedor</Label>
              <input
                id="gf-prov"
                value={d.supplier}
                onChange={(e) => patch({ supplier: e.target.value })}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gf-medio">Medio de pago</Label>
              <select
                id="gf-medio"
                value={d.paymentMethodId}
                onChange={(e) => patch({ paymentMethodId: e.target.value })}
                className={INPUT}
              >
                <option value="">Sin especificar</option>
                {medios.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gf-suc">Sucursal</Label>
            <select
              id="gf-suc"
              value={d.branchId}
              onChange={(e) => patch({ branchId: e.target.value })}
              className={INPUT}
            >
              <option value="">Toda la clínica</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter className="flex-col items-end gap-1.5 sm:flex-row sm:items-center">
          {errores.length > 0 && (
            <p id="gf-motivo" className="text-xs text-muted-foreground">
              {errores[0]}
            </p>
          )}
          <Button
            onClick={() => guardar.mutate()}
            disabled={errores.length > 0 || guardar.isPending}
            aria-describedby={errores.length > 0 ? "gf-motivo" : undefined}
          >
            {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoConfirmar({
  clinicId,
  currency,
  mes,
  gastos,
  onCerrar,
}: {
  clinicId: string;
  currency: string;
  mes: string;
  gastos: GastoFijoDelMes[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const [montos, setMontos] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(gastos.map((g) => [g.gasto.id, g.gasto.amountCents])),
  );
  const total = useMemo(
    () => gastos.reduce((s, g) => s + (montos[g.gasto.id] ?? 0), 0),
    [gastos, montos],
  );
  const todosValidos = gastos.every((g) => (montos[g.gasto.id] ?? 0) > 0);
  const confirmarFn = useServerFn(confirmarGastosFijos);
  const confirmar = useMutation({
    mutationFn: () =>
      confirmarFn({
        data: {
          clinicId,
          mes,
          items: gastos.map((g) => ({
            recurringExpenseId: g.gasto.id,
            amountCents: montos[g.gasto.id] ?? null,
          })),
        },
      }),
    onSuccess: ({ creados }) => {
      void qc.invalidateQueries({ queryKey: ["gastos-fijos", clinicId] });
      void qc.invalidateQueries({ queryKey: ["expenses", clinicId] });
      void qc.invalidateQueries({ queryKey: ["finance-summary", clinicId] });
      toast.success(
        creados === gastos.length
          ? `${numero(creados)} ${creados === 1 ? "gasto confirmado" : "gastos confirmados"}`
          : `${numero(creados)} de ${numero(gastos.length)} confirmados: el resto ya estaba cargado.`,
      );
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <AlertDialog open onOpenChange={(o) => !o && onCerrar()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Confirmar {numero(gastos.length)} {gastos.length === 1 ? "gasto" : "gastos"} de{" "}
            {mesAnio(mes)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Se cargan en Gastos por {formatMoney(total, currency)} en total. Ajusta el monto si este
            mes fue distinto (luz, agua).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-[50vh] space-y-2.5 overflow-y-auto">
          {gastos.map((g) => (
            <li key={g.gasto.id} className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3">
              <label htmlFor={`gfc-${g.gasto.id}`} className="min-w-0 text-sm">
                <span className="block truncate font-medium">{g.gasto.description}</span>
                <span className="text-xs text-muted-foreground">vence el {fecha(g.fecha)}</span>
              </label>
              <MoneyInput
                id={`gfc-${g.gasto.id}`}
                currency={currency}
                min={0}
                valueCents={montos[g.gasto.id] ?? null}
                onValueChange={(v) => setMontos((m) => ({ ...m, [g.gasto.id]: v }))}
              />
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              confirmar.mutate();
            }}
            disabled={!todosValidos || confirmar.isPending}
          >
            {confirmar.isPending && <Loader2 className="size-4 animate-spin" />}
            Confirmar {formatMoney(total, currency)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
