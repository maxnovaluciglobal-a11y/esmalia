import { useId, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { KpisEnFilete, type KpiFilete } from "@/components/kpis-en-filete";
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
import { requirePermission } from "@/lib/access/route-guards";
import { formatoFechaLarga, hoyISO } from "@/lib/clinic-operations/clinic-data";
import {
  clasePastilla,
  claseTexto,
  type TonoEstado,
} from "@/lib/clinic-operations/estado-cita-tono";
import { formatMoney, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/finance/finance";
import {
  CASH_REGISTER_STATUS_LABELS,
  esperadoEnCaja,
  type CashRegister,
  type CashRegisterMethodBreakdown,
} from "@/lib/finance/cash-registers";
import {
  closeCashRegister,
  getCashRegisterBreakdown,
  getOpenCashRegister,
  listCashRegisters,
  openCashRegister,
} from "@/lib/finance/cash-registers.functions";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_clinic/cajas")({
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
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timeZone || "America/Santiago",
  }).format(new Date(iso));
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
    queryFn: () => fetchOpen({ data: { clinicId: clinicId!, branchId: null } }),
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
    },
    onError: (error: Error) => toast.error(mensajeDeError(error)),
  });

  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [declaredAmount, setDeclaredAmount] = useState<number | null>(0);
  const [closingNotes, setClosingNotes] = useState("");

  const closeMutation = useMutation({
    mutationFn: () =>
      closeFn({
        data: {
          id: openRegister!.id,
          clinicId: clinicId!,
          declaredClosingCents: declaredAmount ?? 0,
          notes: closingNotes.trim() || undefined,
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
      setCloseDialogOpen(false);
      setDeclaredAmount(0);
      setClosingNotes("");
      queryClient.invalidateQueries({ queryKey: openQueryKey });
      queryClient.invalidateQueries({ queryKey: historyQueryKey });
    },
    onError: (error: Error) => toast.error(mensajeDeError(error)),
  });

  if (!clinicId) return null;

  const hoy = hoyISO(clinicTz);
  const cobradoTurno = (cobrosTurno ?? []).reduce((s, b) => s + b.amountCents, 0);
  const cantidadCobros = (cobrosTurno ?? []).reduce((s, b) => s + b.count, 0);
  const ultimaCerrada = (history ?? []).find((r) => r.status === "closed");

  // ── KPIs: con caja abierta, el turno en curso; cerrada, el último arqueo.
  let kpis: KpiFilete[];
  if (openRegister) {
    const esperadoListo = !loadingCobros && !cobrosConError;
    kpis = [
      {
        label: "Estado",
        valor: "Abierta",
        nota: `Desde ${fechaHora(openRegister.openedAt, clinicTz)}`,
        tono: "info",
      },
      {
        label: "Esperado",
        valor: esperadoListo
          ? formatMoney(esperadoEnCaja(openRegister.openingAmountCents, cobradoTurno), currency)
          : "—",
        nota: esperadoListo
          ? `Apertura ${formatMoney(openRegister.openingAmountCents, currency)} + ${cantidadCobros} ${cantidadCobros === 1 ? "cobro" : "cobros"}`
          : cobrosConError
            ? "Sin datos"
            : "Cargando…",
      },
      { label: "Contado", valor: "—", nota: "Se anota al cerrar" },
      { label: "Diferencia", valor: "—", nota: "Se calcula al cerrar" },
    ];
  } else if (ultimaCerrada) {
    const diff = ultimaCerrada.differenceCents;
    const lectura = diff === null ? null : lecturaDiferencia(diff, ultimaCerrada.currency);
    kpis = [
      {
        label: "Estado",
        valor: "Cerrada",
        nota: `Último cierre ${fechaHora(ultimaCerrada.closedAt, clinicTz)}`,
      },
      {
        label: "Esperado",
        valor:
          ultimaCerrada.expectedClosingCents === null
            ? "—"
            : formatMoney(ultimaCerrada.expectedClosingCents, ultimaCerrada.currency),
        nota: "Apertura + cobros del turno",
      },
      {
        label: "Contado",
        valor:
          ultimaCerrada.declaredClosingCents === null
            ? "—"
            : formatMoney(ultimaCerrada.declaredClosingCents, ultimaCerrada.currency),
        nota: "Lo que se contó al cerrar",
      },
      {
        label: "Diferencia",
        valor: diff === null ? "—" : formatMoney(diff, ultimaCerrada.currency),
        nota: lectura?.texto ?? "Sin datos",
        tono: lectura?.tono,
        tonoNota: lectura?.tono,
      },
    ];
  } else {
    kpis = [
      { label: "Estado", valor: "Cerrada", nota: "Todavía no hay turnos" },
      { label: "Esperado", valor: "—", nota: "Apertura + cobros" },
      { label: "Contado", valor: "—", nota: "Se anota al cerrar" },
      { label: "Diferencia", valor: "—", nota: "Se calcula al cerrar" },
    ];
  }

  const filas = history ?? [];

  return (
    <AppShell title="Caja del día" access={access}>
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="kicker">Caja · {formatoFechaLarga(hoy)}</p>
            <h2 className="mt-2 font-display text-4xl font-normal leading-tight text-balance sm:text-[44px] sm:leading-none">
              {loadingOpen
                ? "Caja del día"
                : openRegister
                  ? "La caja está abierta."
                  : "La caja está cerrada."}
            </h2>
            <p className="mt-3 max-w-prose text-sm text-muted-foreground">
              Los cobros que registres mientras la caja está abierta se suman solos al esperado del
              cierre.
            </p>
          </div>
          {!loadingOpen && !openConError && (
            <div className="flex flex-wrap gap-2">
              {openRegister ? (
                <Button onClick={() => setCloseDialogOpen(true)}>
                  <Lock aria-hidden /> Cerrar caja (arqueo)
                </Button>
              ) : (
                <Button onClick={() => setOpenDialogOpen(true)}>
                  <LockOpen aria-hidden /> Abrir caja
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
          <KpisEnFilete kpis={kpis} cargando={loadingOpen || (!openRegister && loadingHistory)} />
        )}

        {openRegister && (
          <section aria-labelledby="caja-turno" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="caja-turno" className="font-display text-2xl font-semibold">
                Cobros del turno
              </h2>
              {openRegister.openingNotes && (
                <p className="text-sm text-muted-foreground">
                  Nota de apertura: {openRegister.openingNotes}
                </p>
              )}
            </div>
            {cobrosConError ? (
              <ErrorDeCarga
                mensaje="No pudimos cargar los cobros de este turno."
                onReintentar={() => void reintentarCobros()}
                reintentando={recargandoCobros}
              />
            ) : loadingCobros ? (
              <p className="border-y border-border py-8 text-sm text-muted-foreground">
                Cargando cobros…
              </p>
            ) : (cobrosTurno ?? []).length === 0 ? (
              <div className="border-y border-border py-6">
                <p className="text-sm font-medium">Todavía no hay cobros en este turno.</p>
                <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                  Los pagos que registres desde la ficha del paciente, en Presupuestos y pagos, se
                  suman acá mientras la caja esté abierta.
                </p>
              </div>
            ) : (
              <TablaDesglose filas={cobrosTurno ?? []} currency={currency} />
            )}
          </section>
        )}

        <section aria-labelledby="caja-historial" className="space-y-3">
          <h2 id="caja-historial" className="font-display text-2xl font-semibold">
            Historial de turnos
          </h2>
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
                    <tr className="kicker text-left">
                      <th scope="col" className="py-2.5 pr-3 font-normal">
                        Estado
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
              <DialogTitle>Abrir caja</DialogTitle>
              <DialogDescription>
                Registra con cuánto empieza el turno. Los cobros de hoy se van sumando solos.
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

        <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cerrar caja</DialogTitle>
              <DialogDescription>
                Cuenta lo que hay en caja y anota el total. El sistema calcula solo la diferencia
                contra lo esperado (apertura + cobros del turno).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={`${fid}-contado`}>Monto contado</Label>
                <MoneyInput
                  id={`${fid}-contado`}
                  valueCents={declaredAmount}
                  onValueChange={setDeclaredAmount}
                  currency={currency}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${fid}-notas-cierre`}>Notas (opcional)</Label>
                <textarea
                  id={`${fid}-notas-cierre`}
                  className={INPUT}
                  rows={3}
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  placeholder="Ej: faltante por vuelto mal dado en la mañana"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending || declaredAmount === null}
              >
                {closeMutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Confirmar cierre
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
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
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
  const total = filas.reduce((s, b) => s + b.amountCents, 0);
  const cantidad = filas.reduce((s, b) => s + b.count, 0);
  return (
    <div className="overflow-x-auto border-y border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="kicker">
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
        <tbody className="divide-y divide-hairline border-t border-hairline">
          {filas.map((b) => (
            <tr key={b.method}>
              <td className="py-3 pr-3">{etiquetaMetodo(b.method)}</td>
              <td className="py-3 pr-3 text-right cifra text-muted-foreground">{b.count}</td>
              <td className="py-3 text-right cifra">{formatMoney(b.amountCents, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border">
          <tr className="font-medium">
            <td className="py-3 pr-3">Total</td>
            <td className="py-3 pr-3 text-right cifra">{cantidad}</td>
            <td className="py-3 text-right cifra">{formatMoney(total, currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
