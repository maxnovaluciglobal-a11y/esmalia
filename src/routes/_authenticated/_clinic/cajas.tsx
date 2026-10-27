import { useEffect, useId, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, Download, Loader2, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ExportarCsvLista, useExportarCsvLista } from "@/components/exportar-csv-lista";
import { fechaHoraPlanilla, montoPlanilla, siNoPlanilla } from "@/lib/exportacion/listas-csv";
import {
  ArqueoDenominaciones,
  type CierreArqueo,
} from "@/components/finance/arqueo-denominaciones";
import {
  AtendidasSinCobroPanel,
  ComisionesDelDiaPanel,
  MovimientosDelDia,
  PANEL,
  ResumenEnTinta,
} from "@/components/finance/caja-del-dia";
import { MovimientosDeCajaPanel } from "@/components/finance/caja-movimientos";
import { CajasDelDiaPanel } from "@/components/finance/cajas-del-dia-panel";
import { ErrorDeCarga } from "@/components/estado-error";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/money-input";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { hasPermission } from "@/lib/access/access";
import { requirePermission } from "@/lib/access/route-guards";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import {
  clasePastilla,
  claseTexto,
  type TonoEstado,
} from "@/lib/clinic-operations/estado-cita-tono";
import { formatMoney, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/finance/finance";
import { getCajaDelDia } from "@/lib/finance/caja-del-dia.functions";
import {
  CASH_REGISTER_STATUS_LABELS,
  esperadoConMovimientos,
  nombreDeCaja,
  separarCobrosDelTurno,
  sumarMovimientos,
  type CashRegister,
  type CashRegisterMethodBreakdown,
} from "@/lib/finance/cash-registers";
import type { DetalleDenominaciones } from "@/lib/finance/denominaciones";
import {
  closeCashRegister,
  getCashRegisterBreakdown,
  getOpenCashRegister,
  listCashMovements,
  listCashRegisters,
  openCashRegister,
} from "@/lib/finance/cash-registers.functions";
import { decidirAbrirCaja, leerPedidoAbrirCaja, PEDIDO_ABRIR } from "@/lib/shell";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";
import { fechaCortaHora, fechaLarga, hora } from "@/lib/formato-fecha";

export const Route = createFileRoute("/_authenticated/_clinic/cajas")({
  // `?abrir=1` abre "Abrir caja" al entrar (acción del ⌘K) y se borra.
  validateSearch: (search: Record<string, unknown>): { abrir?: typeof PEDIDO_ABRIR } => ({
    abrir: leerPedidoAbrirCaja(search.abrir),
  }),
  beforeLoad: requirePermission("cash:manage"),
  head: () => ({
    meta: [
      { title: "Caja del día | Esmalia" },
      {
        name: "description",
        content: "Apertura, cierre y arqueo de caja por turno.",
      },
    ],
  }),
  component: CajasPage,
});

const INPUT =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Fecha y hora en la zona de la clínica: un turno se lee por la hora. */
function fechaHora(iso: string | null, timeZone: string | undefined) {
  return fechaCortaHora(iso, timeZone);
}

function etiquetaMetodo(method: string) {
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method;
}

/** Diferencia del arqueo con texto: el tono acompaña, no informa solo. */
function lecturaDiferencia(diff: number, currency: string): { texto: string; tono: TonoEstado } {
  if (diff === 0) return { texto: "Cuadró exacto", tono: "success" };
  if (diff > 0) return { texto: `Sobran ${formatMoney(diff, currency)}`, tono: "warning" };
  return { texto: `Faltan ${formatMoney(-diff, currency)}`, tono: "danger" };
}

/** Texto del anillo del sello: "LUNES 19" (día de la clínica, no del navegador). */
function etiquetaDelDia(hoy: string): string {
  return fechaLarga(hoy).split(" de ")[0].toUpperCase();
}

function notaEsperado(
  aperturaCents: number,
  efectivoCents: number,
  currency: string,
  mov: { entradasCents: number; salidasCents: number } = { entradasCents: 0, salidasCents: 0 },
) {
  let nota = `Apertura ${formatMoney(aperturaCents, currency)} + efectivo ${formatMoney(efectivoCents, currency)}`;
  if (mov.entradasCents > 0) nota += ` + recibido ${formatMoney(mov.entradasCents, currency)}`;
  if (mov.salidasCents > 0) nota += ` − salidas ${formatMoney(mov.salidasCents, currency)}`;
  return nota;
}

function CajasPage() {
  const fid = useId();
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const clinicTz = access.clinic?.timezone;
  const currency = access.clinic?.currency ?? "CLP";
  const queryClient = useQueryClient();

  const fetchOpen = useServerFn(getOpenCashRegister);
  const fetchHistory = useServerFn(listCashRegisters);
  const fetchBreakdown = useServerFn(getCashRegisterBreakdown);
  const openFn = useServerFn(openCashRegister);
  const closeFn = useServerFn(closeCashRegister);

  const openQueryKey = ["open-cash-register", clinicId] as const;
  const historyQueryKey = ["cash-registers", clinicId] as const;

  const {
    data: openRegister,
    isLoading: loadingOpen,
    isError: openConError,
    isFetching: recargandoOpen,
    refetch: reintentarOpen,
  } = useQuery({
    queryKey: openQueryKey,
    // CAJ-02: la caja de quien entra (o la general de antes, para cerrarla).
    queryFn: () => fetchOpen({ data: { clinicId: clinicId!, branchId: null, mine: true } }),
    enabled: !!clinicId,
  });

  const {
    data: history,
    isLoading: loadingHistory,
    isError: historyConError,
    isFetching: recargandoHistory,
    refetch: reintentarHistory,
  } = useQuery({
    queryKey: historyQueryKey,
    queryFn: () => fetchHistory({ data: { clinicId: clinicId!, limit: 30 } }),
    enabled: !!clinicId,
  });

  // Cobros del turno abierto: mismo desglose (y misma suma) que usa el
  // servidor al cerrar, así el "esperado" de acá coincide con el del arqueo.
  const {
    data: cobrosTurno,
    isLoading: loadingCobros,
    isError: cobrosConError,
    isFetching: recargandoCobros,
    refetch: reintentarCobros,
  } = useQuery({
    queryKey: ["cash-register-breakdown", openRegister?.id],
    queryFn: () => fetchBreakdown({ data: { cashRegisterId: openRegister!.id } }),
    enabled: !!openRegister?.id,
  });

  // CAJ-04: traspasos, retiros y depósitos del turno abierto.
  const fetchMovimientos = useServerFn(listCashMovements);
  const movimientosQueryKey = ["cash-movements", openRegister?.id] as const;
  const {
    data: movimientosTurno,
    isLoading: loadingMovimientos,
    isError: movimientosConError,
  } = useQuery({
    queryKey: movimientosQueryKey,
    queryFn: () =>
      fetchMovimientos({ data: { clinicId: clinicId!, cashRegisterId: openRegister!.id } }),
    enabled: !!clinicId && !!openRegister?.id,
  });
  const esGestor = access.role === "owner" || access.role === "admin";

  // Resumen del día (tarjeta en tinta, movimientos, atendidas sin cobro y
  // comisiones). Se pide con la caja abierta para saber quién la abrió.
  const fetchResumen = useServerFn(getCajaDelDia);
  const resumenQueryKey = ["caja-del-dia", clinicId, openRegister?.id ?? null] as const;
  const {
    data: resumen,
    isError: resumenConError,
    isFetching: recargandoResumen,
    refetch: reintentarResumen,
  } = useQuery({
    queryKey: resumenQueryKey,
    queryFn: () =>
      fetchResumen({ data: { clinicId: clinicId!, cashRegisterId: openRegister?.id ?? null } }),
    enabled: !!clinicId && !loadingOpen,
  });

  const [selectedForBreakdown, setSelectedForBreakdown] = useState<CashRegister | null>(null);
  const { data: breakdown, isLoading: loadingBreakdown } = useQuery({
    queryKey: ["cash-register-breakdown", selectedForBreakdown?.id],
    queryFn: () => fetchBreakdown({ data: { cashRegisterId: selectedForBreakdown!.id } }),
    enabled: !!selectedForBreakdown,
  });

  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [openingAmount, setOpeningAmount] = useState<number | null>(0);
  const [openingNotes, setOpeningNotes] = useState("");

  const openMutation = useMutation({
    mutationFn: () =>
      openFn({
        data: {
          clinicId: clinicId!,
          branchId: null,
          openingAmountCents: openingAmount ?? 0,
          notes: openingNotes.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Caja abierta.");
      setOpenDialogOpen(false);
      setOpeningAmount(0);
      setOpeningNotes("");
      queryClient.invalidateQueries({ queryKey: openQueryKey });
      queryClient.invalidateQueries({ queryKey: historyQueryKey });
      queryClient.invalidateQueries({ queryKey: ["caja-del-dia", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["cajas-del-dia", clinicId] });
    },
    onError: (error: Error) => toast.error(mensajeDeError(error)),
  });

  // Pedido del ⌘K (`?abrir=1`): se resuelve una vez que se sabe si ya hay
  // un turno abierto, y el parámetro se borra para que recargar no reabra.
  const { abrir } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const decisionAbrir = decidirAbrirCaja({
    pedido: abrir === PEDIDO_ABRIR,
    cargando: !clinicId || loadingOpen,
    conError: openConError,
    cajaAbierta: Boolean(openRegister),
  });
  useEffect(() => {
    if (decisionAbrir === "nada" || decisionAbrir === "esperar") return;
    if (decisionAbrir === "abrir") setOpenDialogOpen(true);
    if (decisionAbrir === "ya-abierta") toast.info("La caja ya está abierta.");
    void navigate({ search: (prev) => ({ ...prev, abrir: undefined }), replace: true });
  }, [decisionAbrir, navigate]);

  const closeMutation = useMutation({
    mutationFn: (cierre: CierreArqueo) =>
      closeFn({
        data: {
          id: openRegister!.id,
          clinicId: clinicId!,
          ...cierre,
        },
      }),
    onSuccess: ({ differenceCents }) => {
      if (differenceCents === 0) {
        toast.success("Caja cerrada. Cuadró exacto.");
      } else if (differenceCents > 0) {
        toast.warning(`Caja cerrada. Sobran ${formatMoney(differenceCents, currency)}.`);
      } else {
        toast.warning(`Caja cerrada. Faltan ${formatMoney(-differenceCents, currency)}.`);
      }
      queryClient.invalidateQueries({ queryKey: openQueryKey });
      queryClient.invalidateQueries({ queryKey: historyQueryKey });
      queryClient.invalidateQueries({ queryKey: ["caja-del-dia", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["cajas-del-dia", clinicId] });
    },
    onError: (error: Error) => toast.error(mensajeDeError(error)),
  });

  // Movimientos del día: una fila por medio de cada cobro (un cobro
  // repartido sale en dos filas, como se concilia). Usa el mismo registro
  // de exportaciones de las listas (Ola 6, EXP-04) con la lista "caja".
  const filasCsv = (resumen?.movimientos ?? []).flatMap((m) => m.partes.map((p) => ({ m, p })));
  const exportacion = useExportarCsvLista<(typeof filasCsv)[number]>({
    clinicId: clinicId ?? "",
    rol: access.role,
    lista: "caja",
    archivo: "Movimientos de caja",
    filas: filasCsv,
    timezone: clinicTz ?? "America/Santiago",
    filtros: { contenido: "movimientos del día", fecha: resumen?.fecha ?? hoyISO(clinicTz) },
    columnas: [
      { header: "Fecha", value: () => resumen?.fecha ?? hoyISO(clinicTz) },
      { header: "Hora", value: ({ m }) => m.hora },
      { header: "Paciente", value: ({ m }) => m.paciente },
      { header: "Concepto", value: ({ m }) => m.concepto },
      { header: "Profesional", value: ({ m }) => m.profesional },
      { header: "Medio de pago", value: ({ p }) => p.medio },
      { header: "En el cajón", value: ({ p }) => siNoPlanilla(p.enEfectivo) },
      { header: "Monto", value: ({ p }) => montoPlanilla(p.cents, currency), dinero: true },
      { header: "Moneda", value: () => currency, dinero: true },
    ],
  });

  if (!clinicId) return null;

  const hoy = hoyISO(clinicTz);
  // Solo el efectivo está en el cajón; tarjetas y transferencias se
  // concilian con el banco y no entran al esperado (mismo cálculo que el
  // servidor al cerrar).
  const turno = separarCobrosDelTurno(cobrosTurno ?? []);
  const cobradoTurno = turno.efectivoCents;
  const movTurno = openRegister
    ? sumarMovimientos(movimientosTurno ?? [], openRegister.id)
    : { entradasCents: 0, salidasCents: 0 };
  const esperadoTurno =
    !openRegister || loadingCobros || cobrosConError || loadingMovimientos || movimientosConError
      ? null
      : esperadoConMovimientos(openRegister.openingAmountCents, cobradoTurno, movTurno);
  const nombreCaja = openRegister ? nombreDeCaja(openRegister, access.userId) : "Mi caja";
  const ultimaCerrada = (history ?? []).find((r) => r.status === "closed");
  const filas = history ?? [];

  // "lunes 26": el día de la clínica, no el del navegador.
  const diaTitulo = fechaLarga(hoy).split(" de ")[0];
  const sucursal = resumen?.sucursal ?? access.clinic?.name ?? null;
  const estadoTexto = openRegister
    ? `abierta ${hora(openRegister.openedAt, clinicTz)}${resumen?.abiertaPor ? ` por ${resumen.abiertaPor}` : ""}`
    : ultimaCerrada
      ? `último cierre ${fechaHora(ultimaCerrada.closedAt, clinicTz)}`
      : "sin turnos todavía";

  return (
    <AppShell title="Caja del día" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-10">
        <div className="space-y-[18px]">
          <header className="flex flex-wrap items-end justify-between gap-x-7 gap-y-4 pb-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-muted-foreground">
                <b className="font-semibold text-foreground/85">{nombreCaja}</b>
                {sucursal && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{sucursal}</span>
                  </>
                )}
                {!loadingOpen && !openConError && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{estadoTexto}</span>
                  </>
                )}
              </p>
              <h2 className="mt-2 font-display text-[clamp(2.25rem,3.6vw,3.5rem)] font-medium leading-none tracking-[-0.02em] text-balance [font-variant-numeric:lining-nums]">
                {openRegister ? "Cierre del " : "Caja del "}
                <em className="text-brand-600">{diaTitulo}</em>
              </h2>
            </div>
            {!loadingOpen && !openConError && (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap",
                    clasePastilla[openRegister ? "warning" : "neutral"],
                  )}
                >
                  <Clock className="size-3.5" aria-hidden />
                  {openRegister ? `${nombreCaja} abierta` : "Sin caja abierta"}
                </span>
                {exportacion.puede && (
                  <Button
                    variant="outline"
                    className="h-10 rounded-full px-4"
                    onClick={() => void exportacion.exportar()}
                    disabled={!resumen || exportacion.vacia || exportacion.enCurso}
                    title={exportacion.vacia ? "Todavía no hay cobros hoy" : undefined}
                  >
                    {exportacion.enCurso ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Download aria-hidden />
                    )}
                    Exportar CSV
                  </Button>
                )}
                {openRegister ? (
                  // En celular el arqueo queda debajo de los movimientos: el
                  // botón lleva hasta él. En escritorio está a la vista.
                  <Button
                    className="h-10 rounded-full px-4 lg:hidden"
                    onClick={() => {
                      const arqueo = document.getElementById("arqueo");
                      arqueo?.scrollIntoView({ block: "start" });
                      arqueo?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
                    }}
                  >
                    <Lock aria-hidden /> Ir al arqueo
                  </Button>
                ) : (
                  <Button
                    className="h-10 rounded-full px-4"
                    onClick={() => setOpenDialogOpen(true)}
                  >
                    <LockOpen aria-hidden /> Abrir mi caja
                  </Button>
                )}
              </div>
            )}
          </header>

          {openConError ? (
            <ErrorDeCarga
              mensaje="No pudimos revisar el estado de la caja. Revisa la conexión antes de abrir o cerrar."
              onReintentar={() => void reintentarOpen()}
              reintentando={recargandoOpen}
            />
          ) : (
            <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-[18px]">
                {resumenConError ? (
                  <ErrorDeCarga
                    mensaje="No pudimos cargar los cobros de hoy."
                    onReintentar={() => void reintentarResumen()}
                    reintentando={recargandoResumen}
                  />
                ) : !resumen ? (
                  <div
                    aria-busy
                    className="grid h-[22rem] place-items-center rounded-[14px] bg-night text-sm text-on-night-2"
                  >
                    Cargando los cobros de hoy…
                  </div>
                ) : (
                  <>
                    <ResumenEnTinta
                      resumen={resumen}
                      currency={currency}
                      onVerDesglose={
                        openRegister ? () => setSelectedForBreakdown(openRegister) : undefined
                      }
                    />
                    <MovimientosDelDia
                      movimientos={resumen.movimientos}
                      porMedio={resumen.porMedio}
                      currency={currency}
                    />
                  </>
                )}
              </div>

              <div className="min-w-0 space-y-[18px]">
                {openRegister && (
                  <MovimientosDeCajaPanel
                    clinicId={clinicId}
                    caja={openRegister}
                    userId={access.userId}
                    movimientos={movimientosTurno ?? []}
                    cargando={loadingMovimientos}
                    disponibleCents={esperadoTurno}
                    clinicTz={clinicTz}
                    onRegistrado={() => {
                      queryClient.invalidateQueries({ queryKey: movimientosQueryKey });
                    }}
                  />
                )}
                {openRegister ? (
                  <ArqueoDenominaciones
                    // Cambiar de caja (otro turno) arranca el conteo de cero.
                    key={openRegister.id}
                    currency={openRegister.currency}
                    expectedCents={esperadoTurno}
                    expectedNota={
                      cobrosConError || movimientosConError
                        ? "Sin datos"
                        : notaEsperado(
                            openRegister.openingAmountCents,
                            cobradoTurno,
                            openRegister.currency,
                            movTurno,
                          )
                    }
                    notaApertura={openRegister.openingNotes}
                    etiquetaSello={etiquetaDelDia(hoy)}
                    enviando={closeMutation.isPending}
                    onCerrar={(cierre) => closeMutation.mutate(cierre)}
                  />
                ) : (
                  !loadingOpen && (
                    <UltimoCierre
                      registro={ultimaCerrada ?? null}
                      cargando={loadingHistory}
                      clinicTz={clinicTz}
                      onAbrir={() => setOpenDialogOpen(true)}
                    />
                  )
                )}
                {resumen && (
                  <AtendidasSinCobroPanel
                    atendidas={resumen.atendidasSinCobro}
                    currency={currency}
                    puedeCobrar={hasPermission(access, "patients:manage")}
                  />
                )}
                {resumen?.comisiones && (
                  <ComisionesDelDiaPanel comisiones={resumen.comisiones} currency={currency} />
                )}
              </div>
            </div>
          )}
        </div>

        {esGestor && <CajasDelDiaPanel clinicId={clinicId} clinicTz={clinicTz} />}

        <section aria-labelledby="caja-historial" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="caja-historial" className="font-display text-2xl font-semibold">
              Historial de turnos
            </h2>
            {clinicId && (
              <ExportarCsvLista<CashRegister>
                clinicId={clinicId}
                rol={access.role}
                lista="caja"
                filas={filas}
                timezone={clinicTz ?? "America/Santiago"}
                columnas={[
                  { header: "Apertura", value: (r) => fechaHoraPlanilla(r.openedAt, clinicTz) },
                  { header: "Cierre", value: (r) => fechaHoraPlanilla(r.closedAt, clinicTz) },
                  { header: "Estado", value: (r) => CASH_REGISTER_STATUS_LABELS[r.status] },
                  { header: "Caja", value: (r) => nombreDeCaja(r) },
                  {
                    header: "Monto de apertura",
                    value: (r) => montoPlanilla(r.openingAmountCents, r.currency),
                    dinero: true,
                  },
                  {
                    header: "Esperado",
                    value: (r) => montoPlanilla(r.expectedClosingCents, r.currency),
                    dinero: true,
                  },
                  {
                    header: "Contado",
                    value: (r) => montoPlanilla(r.declaredClosingCents, r.currency),
                    dinero: true,
                  },
                  {
                    header: "Diferencia",
                    value: (r) => montoPlanilla(r.differenceCents, r.currency),
                    dinero: true,
                  },
                  { header: "Moneda", value: (r) => r.currency, dinero: true },
                  { header: "Notas de apertura", value: (r) => r.openingNotes },
                  { header: "Notas de cierre", value: (r) => r.closingNotes },
                ]}
              />
            )}
          </div>
          {historyConError ? (
            <ErrorDeCarga
              mensaje="No pudimos cargar el historial de cajas."
              onReintentar={() => void reintentarHistory()}
              reintentando={recargandoHistory}
            />
          ) : loadingHistory ? (
            <p className="border-y border-border py-8 text-sm text-muted-foreground">
              Cargando historial…
            </p>
          ) : filas.length === 0 ? (
            <div className="border-y border-border py-6">
              <p className="text-sm font-medium">Todavía no hay turnos registrados.</p>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                Abre la caja al empezar el día con el efectivo que hay; al cerrar, cuenta lo que
                quedó y Esmalia te dice si cuadra.
              </p>
            </div>
          ) : (
            <>
              {/* Celular: filas apiladas. La tabla de 7 columnas obligaba a
                  deslizar de costado. */}
              <ul className="divide-y divide-hairline border-y border-border md:hidden">
                {filas.map((r) => {
                  const lectura =
                    r.differenceCents === null
                      ? null
                      : lecturaDiferencia(r.differenceCents, r.currency);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedForBreakdown(r)}
                        className="flex w-full items-start gap-3 py-3 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            {nombreDeCaja(r, access.userId)}
                          </span>
                          <span className="block text-sm cifra">
                            {fechaHora(r.openedAt, clinicTz)}
                            {r.closedAt && ` → ${fechaHora(r.closedAt, clinicTz)}`}
                          </span>
                          <span className="block text-sm text-muted-foreground tabular-nums">
                            Esperado{" "}
                            {r.expectedClosingCents === null
                              ? "—"
                              : formatMoney(r.expectedClosingCents, r.currency)}{" "}
                            · Contado{" "}
                            {r.declaredClosingCents === null
                              ? "—"
                              : formatMoney(r.declaredClosingCents, r.currency)}
                          </span>
                          {lectura && (
                            <span
                              className={cn(
                                "mt-0.5 block text-sm tabular-nums",
                                claseTexto[lectura.tono],
                              )}
                            >
                              {lectura.texto}
                            </span>
                          )}
                        </span>
                        <PastillaEstado estado={r.status} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="hidden overflow-x-auto border-y border-border md:block">
                <table className="w-full min-w-[48rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-muted-foreground">
                      <th scope="col" className="py-2.5 pr-3 font-normal">
                        Estado
                      </th>
                      <th scope="col" className="py-2.5 pr-3 font-normal">
                        Caja
                      </th>
                      <th scope="col" className="py-2.5 pr-3 font-normal">
                        Apertura
                      </th>
                      <th scope="col" className="py-2.5 pr-3 font-normal">
                        Cierre
                      </th>
                      <th scope="col" className="py-2.5 pr-3 text-right font-normal">
                        Monto inicial
                      </th>
                      <th scope="col" className="py-2.5 pr-3 text-right font-normal">
                        Esperado
                      </th>
                      <th scope="col" className="py-2.5 pr-3 text-right font-normal">
                        Contado
                      </th>
                      <th scope="col" className="py-2.5 pr-3 text-right font-normal">
                        Diferencia
                      </th>
                      <th scope="col" className="py-2.5 font-normal">
                        <span className="sr-only">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline border-t border-hairline">
                    {filas.map((r: CashRegister) => {
                      const lectura =
                        r.differenceCents === null
                          ? null
                          : lecturaDiferencia(r.differenceCents, r.currency);
                      return (
                        <tr key={r.id} className="align-middle">
                          <td className="py-3 pr-3">
                            <PastillaEstado estado={r.status} />
                          </td>
                          <td className="py-3 pr-3">{nombreDeCaja(r, access.userId)}</td>
                          <td className="py-3 pr-3 cifra">{fechaHora(r.openedAt, clinicTz)}</td>
                          <td className="py-3 pr-3 cifra text-muted-foreground">
                            {fechaHora(r.closedAt, clinicTz)}
                          </td>
                          <td className="py-3 pr-3 text-right cifra">
                            {formatMoney(r.openingAmountCents, r.currency)}
                          </td>
                          <td className="py-3 pr-3 text-right cifra">
                            {r.expectedClosingCents !== null
                              ? formatMoney(r.expectedClosingCents, r.currency)
                              : "—"}
                          </td>
                          <td className="py-3 pr-3 text-right cifra">
                            {r.declaredClosingCents !== null
                              ? formatMoney(r.declaredClosingCents, r.currency)
                              : "—"}
                          </td>
                          <td
                            className={cn(
                              "py-3 pr-3 text-right tabular-nums",
                              lectura && claseTexto[lectura.tono],
                            )}
                          >
                            {lectura?.texto ?? "—"}
                          </td>
                          <td className="py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setSelectedForBreakdown(r)}
                              className={buttonVariants({ variant: "ghost", size: "sm" })}
                            >
                              Desglose
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <Dialog open={openDialogOpen} onOpenChange={setOpenDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Abrir mi caja</DialogTitle>
              <DialogDescription>
                Registra con cuánto empieza tu turno. Lo que cobres queda en tu caja y lo cierras
                con tu propio arqueo.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={`${fid}-inicial`}>Monto inicial</Label>
                <MoneyInput
                  id={`${fid}-inicial`}
                  valueCents={openingAmount}
                  onValueChange={setOpeningAmount}
                  currency={currency}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${fid}-notas-apertura`}>Notas (opcional)</Label>
                <textarea
                  id={`${fid}-notas-apertura`}
                  className={INPUT}
                  rows={2}
                  value={openingNotes}
                  onChange={(e) => setOpeningNotes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => openMutation.mutate()}
                disabled={openMutation.isPending || openingAmount === null}
              >
                {openMutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Abrir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!selectedForBreakdown}
          onOpenChange={(o) => !o && setSelectedForBreakdown(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Desglose por medio de pago</DialogTitle>
              {selectedForBreakdown && (
                <DialogDescription>
                  Turno abierto el {fechaHora(selectedForBreakdown.openedAt, clinicTz)}
                  {selectedForBreakdown.closedAt
                    ? `, cerrado el ${fechaHora(selectedForBreakdown.closedAt, clinicTz)}`
                    : ", todavía abierto"}
                  .
                </DialogDescription>
              )}
            </DialogHeader>
            {loadingBreakdown ? (
              <p className="py-4 text-sm text-muted-foreground">Cargando desglose…</p>
            ) : (breakdown ?? []).length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                Ningún cobro quedó vinculado a este turno.
              </p>
            ) : (
              <TablaDesglose
                filas={breakdown ?? []}
                currency={selectedForBreakdown?.currency ?? currency}
              />
            )}
            {selectedForBreakdown?.closingDenominations && (
              <DetalleArqueo detalle={selectedForBreakdown.closingDenominations} />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

/** Conteo por billete y moneda guardado en el cierre (solo filas con piezas). */
function DetalleArqueo({ detalle }: { detalle: DetalleDenominaciones }) {
  const filas = detalle.filas.filter((f) => f.cantidad > 0);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Conteo del cierre por billete y moneda</h3>
      {filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">El cajón se contó vacío.</p>
      ) : (
        <ul className="divide-y divide-hairline border-y border-border text-sm">
          {filas.map((f) => (
            <li key={`${f.tipo}:${f.valorCents}`} className="flex justify-between gap-3 py-2">
              <span className="tabular-nums">
                {f.cantidad} × {formatMoney(f.valorCents, detalle.currency)}{" "}
                <span className="text-muted-foreground">{f.tipo}</span>
              </span>
              <span className="cifra">
                {formatMoney(f.valorCents * f.cantidad, detalle.currency)}
              </span>
            </li>
          ))}
          <li className="flex justify-between gap-3 py-2 font-medium">
            <span>Total contado</span>
            <span className="cifra">{formatMoney(detalle.totalCents, detalle.currency)}</span>
          </li>
        </ul>
      )}
    </div>
  );
}

/**
 * Columna derecha con la caja cerrada: el último arqueo (esperado, contado y
 * diferencia, con el motivo si no cuadró) y el botón para abrir el turno.
 */
function UltimoCierre({
  registro,
  cargando,
  clinicTz,
  onAbrir,
}: {
  registro: CashRegister | null;
  cargando: boolean;
  clinicTz: string | undefined;
  onAbrir: () => void;
}) {
  const uid = useId();
  const lectura =
    registro?.differenceCents == null
      ? null
      : lecturaDiferencia(registro.differenceCents, registro.currency);
  return (
    <section aria-labelledby={`${uid}-titulo`} className={cn(PANEL, "p-[22px]")}>
      <h2 id={`${uid}-titulo`} className="font-display text-[34px] font-medium leading-none">
        Último <em className="text-brand-600">cierre</em>
      </h2>
      {cargando ? (
        <p className="mt-3 text-sm text-muted-foreground">Cargando el último cierre…</p>
      ) : !registro ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Todavía no hay turnos. Abre la caja al empezar el día con el efectivo que hay; al cerrar,
          cuenta lo que quedó y Esmalia te dice si cuadra.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-[12.5px] font-medium text-muted-foreground">
            Cerrada el {fechaHora(registro.closedAt, clinicTz)}
          </p>
          <dl className="mt-[18px] grid grid-cols-2 gap-2.5">
            {(
              [
                ["Esperado", registro.expectedClosingCents, "apertura + efectivo ± movimientos"],
                ["Contado", registro.declaredClosingCents, "en el cajón"],
              ] as const
            ).map(([titulo, cents, nota]) => (
              <div key={titulo} className="rounded-xl border border-hairline px-3.5 py-3">
                <dt className="text-xs font-medium text-muted-foreground">{titulo}</dt>
                <dd className="mt-1 whitespace-nowrap font-display text-[clamp(1.5rem,5.5vw,2.125rem)] font-medium leading-[1.1] [font-variant-numeric:lining-nums]">
                  {cents === null ? "—" : formatMoney(cents, registro.currency)}
                </dd>
                <dd className="text-[11.5px] font-medium text-muted-foreground">{nota}</dd>
              </div>
            ))}
          </dl>
          {lectura && (
            <p className={cn("mt-4 text-[17px] font-semibold", claseTexto[lectura.tono])}>
              {lectura.texto}.
              {registro.closingNotes && (
                <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                  Motivo: {registro.closingNotes}
                </span>
              )}
            </p>
          )}
        </>
      )}
      {!cargando && (
        <Button size="lg" className="mt-5 h-12 w-full rounded-full" onClick={onAbrir}>
          <LockOpen aria-hidden /> Abrir mi caja
        </Button>
      )}
    </section>
  );
}

function PastillaEstado({ estado }: { estado: CashRegister["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs",
        clasePastilla[estado === "open" ? "info" : "neutral"],
      )}
    >
      {CASH_REGISTER_STATUS_LABELS[estado]}
    </span>
  );
}

function TablaDesglose({
  filas,
  currency,
}: {
  filas: CashRegisterMethodBreakdown[];
  currency: string;
}) {
  const turno = separarCobrosDelTurno(filas);
  const grupos = [
    {
      clave: "efectivo",
      titulo: "En el cajón (efectivo)",
      nota: "Entra al arqueo.",
      filas: filas.filter((b) => b.enEfectivo),
      cantidad: turno.efectivoCantidad,
      total: turno.efectivoCents,
    },
    {
      clave: "banco",
      titulo: "A conciliar con el banco",
      nota: "Tarjetas y transferencias: no están en el cajón ni entran a la diferencia.",
      filas: filas.filter((b) => !b.enEfectivo),
      cantidad: turno.aConciliarCantidad,
      total: turno.aConciliarCents,
    },
  ].filter((g) => g.filas.length > 0);
  return (
    <div className="overflow-x-auto border-y border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs font-medium text-muted-foreground">
            <th scope="col" className="py-2.5 pr-3 text-left font-normal">
              Medio de pago
            </th>
            <th scope="col" className="py-2.5 pr-3 text-right font-normal">
              Cobros
            </th>
            <th scope="col" className="py-2.5 text-right font-normal">
              Monto
            </th>
          </tr>
        </thead>
        {grupos.map((g) => (
          <tbody key={g.clave} className="divide-y divide-hairline border-t border-hairline">
            <tr>
              <th scope="rowgroup" colSpan={3} className="pt-4 pb-2 text-left font-normal">
                <span className="block text-sm font-medium">{g.titulo}</span>
                <span className="block text-xs text-muted-foreground">{g.nota}</span>
              </th>
            </tr>
            {g.filas.map((b) => (
              <tr key={`${g.clave}|${b.method}`}>
                <td className="py-3 pr-3">{etiquetaMetodo(b.method)}</td>
                <td className="py-3 pr-3 text-right cifra text-muted-foreground">{b.count}</td>
                <td className="py-3 text-right cifra">{formatMoney(b.amountCents, currency)}</td>
              </tr>
            ))}
            {grupos.length > 1 && (
              <tr className="text-muted-foreground">
                <td className="py-2.5 pr-3">Subtotal</td>
                <td className="py-2.5 pr-3 text-right cifra">{g.cantidad}</td>
                <td className="py-2.5 text-right cifra">{formatMoney(g.total, currency)}</td>
              </tr>
            )}
          </tbody>
        ))}
        <tfoot className="border-t border-border">
          <tr className="font-medium">
            <td className="py-3 pr-3">Total cobrado</td>
            <td className="py-3 pr-3 text-right cifra">
              {turno.efectivoCantidad + turno.aConciliarCantidad}
            </td>
            <td className="py-3 text-right cifra">
              {formatMoney(turno.efectivoCents + turno.aConciliarCents, currency)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
