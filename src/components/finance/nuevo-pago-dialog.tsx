import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CircleDollarSign, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  formatMoney,
  type PaymentMethod,
  type PaymentMethodConfig,
  type TreatmentPlan,
} from "@/lib/finance/finance";
import { registerPayment } from "@/lib/finance/finance.functions";
import { MoneyInput } from "@/components/money-input";
import { listPaymentMethods } from "@/lib/finance/clinic-finance.functions";
import {
  MAX_PARTES_COBRO,
  estaPorCobrar,
  restantePorAsignar,
  validarReparto,
  type CuentaPorCobrar,
} from "@/lib/finance/cuentas-por-cobrar";
import { metodoDelMedio } from "@/lib/finance/medios-de-pago";
import { useOfflineMutation } from "@/hooks/use-offline-mutation";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { AccionDeshabilitada } from "@/components/accion-deshabilitada";

const SELECT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type Parte = { key: string; paymentMethodId: string; amountCents: number | null };

/** Lo que conviene cobrar de una cuenta: la cuota impaga más antigua, o el saldo. */
function sugeridoDeCuenta(cuenta: CuentaPorCobrar): number {
  const cuota = cuenta.resumen.cuotas.find((c) => c.pendienteCents > 0);
  return cuota?.pendienteCents ?? cuenta.resumen.saldoCents;
}

function metodoDe(medio: PaymentMethodConfig | undefined): PaymentMethod {
  return medio ? metodoDelMedio(medio.kind, medio.legacyKey) : "other";
}

export function NuevoPagoDialog({
  clinicId,
  patientId,
  userId,
  plans,
  cuentas = [],
  suggestedAmountCents,
  saldoCargado = true,
  currency,
  abrirAhora,
  onAbierto,
}: {
  clinicId: string;
  patientId: string;
  userId: string;
  plans: TreatmentPlan[];
  /** Cuentas por cobrar del paciente (FIN-02). Las que tienen saldo se ofrecen para imputar. */
  cuentas?: CuentaPorCobrar[];
  /** Saldo pendiente del paciente (0 si está al día o a favor). Precarga el monto. */
  suggestedAmountCents: number;
  /** false mientras planes o pagos cargan: el saldo todavía no es el real. */
  saldoCargado?: boolean;
  currency: string;
  abrirAhora?: boolean;
  onAbierto?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(suggestedAmountCents);
  // Si se abrió antes de tener el saldo, se precarga cuando llega, salvo que
  // ya se haya tocado el monto.
  const [montoEditado, setMontoEditado] = useState(false);
  useEffect(() => {
    if (open && saldoCargado && !montoEditado) setAmount(suggestedAmountCents);
  }, [open, saldoCargado, montoEditado, suggestedAmountCents]);
  useEffect(() => {
    if (!abrirAhora) return;
    setAmount(suggestedAmountCents);
    setMontoEditado(false);
    setOpen(true);
    onAbierto?.();
  }, [abrirAhora, suggestedAmountCents, onAbierto]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  // G-6: el medio configurado de la clínica. El enum `method` se sigue
  // guardando para el histórico y para los pagos capturados sin conexión.
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const fetchPaymentMethods = useServerFn(listPaymentMethods);
  const { data: mediosDePago = [] } = useQuery({
    queryKey: ["payment-methods", clinicId],
    queryFn: () => fetchPaymentMethods({ data: { clinicId } }),
  });
  const medioPorId = useMemo(() => new Map(mediosDePago.map((m) => [m.id, m])), [mediosDePago]);
  // Sin elegir nada, el primer medio de la lista es el que muestra el select.
  const medioElegido = paymentMethodId || mediosDePago[0]?.id || "";

  // "" = a cuenta; "cuenta:<id>" = una cuenta por cobrar; "plan:<id>" = un plan.
  const [destino, setDestino] = useState("");
  const cuentasPorCobrar = cuentas.filter((c) => estaPorCobrar(c.resumen.estado));
  const planesConCuenta = new Set(cuentas.filter((c) => !c.voidedAt).map((c) => c.treatmentPlanId));
  const planesSinCuenta = plans.filter((p) => !planesConCuenta.has(p.id));

  // FIN-04: un cobro repartido en varios medios.
  const [repartir, setRepartir] = useState(false);
  const [partes, setPartes] = useState<Parte[]>([]);

  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const payFn = useServerFn(registerPayment);
  const router = useRouter();

  const create = useOfflineMutation({
    kind: "registrar-pago",
    userId,
    ejecutar: (payload) => payFn({ data: payload }),
    invalidar: [
      ["payments", clinicId, patientId],
      ["patients", clinicId],
      ["cuentas-paciente", clinicId, patientId],
      ["cuentas-por-cobrar", clinicId],
    ],
    resumen: (p) => `Cobro de ${formatMoney(p.amountCents as number, currency)}`,
    onDone: () => {
      // "Saldo fantasma" (auditoría de rendimiento/prácticas, 01-sep): el
      // Saldo del header de la ficha viene del loader de la ruta, no de
      // React Query — invalidateQueries no lo toca. La queryKey ["patient",
      // clinicId, patientId] de acá nunca tuvo ningún useQuery suscrito
      // (confirmado por grep); router.invalidate() es el fix real.
      void router.invalidate();
      setOpen(false);
      setAmount(null);
      setMethod("cash");
      setPaymentMethodId("");
      setDestino("");
      setRepartir(false);
      setPartes([]);
      setReference("");
      setNotes("");
    },
  });

  const total = amount ?? 0;
  const partesValidas = partes.map((p) => ({
    paymentMethodId: p.paymentMethodId,
    amountCents: p.amountCents ?? 0,
  }));
  const restante = restantePorAsignar(total, partesValidas);
  // El primer medio todavía sin monto: "Completar" le pone lo que falta.
  const sinMonto = partes.find((p) => (p.amountCents ?? 0) === 0);
  const motivoReparto = repartir ? validarReparto(total, partesValidas) : null;
  const motivo = total <= 0 ? "Ingresa un monto mayor que cero." : (motivoReparto ?? null);

  function elegirDestino(valor: string) {
    setDestino(valor);
    if (montoEditado) return;
    const cuenta = valor.startsWith("cuenta:")
      ? cuentas.find((c) => c.id === valor.slice("cuenta:".length))
      : undefined;
    setAmount(cuenta ? sugeridoDeCuenta(cuenta) : suggestedAmountCents);
  }

  function activarReparto(activo: boolean) {
    setRepartir(activo);
    if (!activo) {
      setPartes([]);
      return;
    }
    const otro = mediosDePago.find((m) => m.id !== medioElegido);
    setPartes([
      { key: crypto.randomUUID(), paymentMethodId: medioElegido, amountCents: null },
      { key: crypto.randomUUID(), paymentMethodId: otro?.id ?? "", amountCents: null },
    ]);
  }

  function cambiarParte(key: string, cambio: Partial<Parte>) {
    setPartes((prev) => prev.map((p) => (p.key === key ? { ...p, ...cambio } : p)));
  }

  function guardar() {
    const cuentaId = destino.startsWith("cuenta:") ? destino.slice("cuenta:".length) : null;
    const cuenta = cuentaId ? cuentas.find((c) => c.id === cuentaId) : undefined;
    const planId = destino.startsWith("plan:")
      ? destino.slice("plan:".length)
      : (cuenta?.treatmentPlanId ?? null);
    const medioUnico = medioPorId.get(medioElegido);
    void create.mutar({
      // El id lo genera el equipo, no la base: si esto se captura sin
      // conexión y el reintento llega dos veces, el segundo choca contra la
      // PK y el servidor lo reconoce como el mismo cobro (no cobra doble).
      id: crypto.randomUUID(),
      clinicId,
      patientId,
      amountCents: total,
      method: medioUnico ? metodoDe(medioUnico) : method,
      // Se manda vacío como undefined: el server solo busca la retención
      // cuando hay un medio configurado elegido.
      paymentMethodId: medioUnico ? medioUnico.id : undefined,
      // ⚠️ Sellado en la CAPTURA. Sin esto, un cobro tomado a las 10:00 que
      // sincroniza a las 15:00 entraría con la hora del servidor y el cierre
      // de caja del día quedaría mal.
      paidAt: new Date().toISOString(),
      treatmentPlanId: planId ?? undefined,
      receivableId: cuentaId ?? undefined,
      ...(repartir && {
        partes: partes.map((p) => ({
          paymentMethodId: p.paymentMethodId || null,
          method: metodoDe(medioPorId.get(p.paymentMethodId)),
          amountCents: p.amountCents ?? 0,
        })),
      }),
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setAmount(suggestedAmountCents);
          setMontoEditado(false);
        }
      }}
    >
      <BloqueoEscritura>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <CircleDollarSign className="size-4" /> Registrar pago
          </Button>
        </DialogTrigger>
      </BloqueoEscritura>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
          <DialogDescription>
            El saldo del paciente se recalcula automáticamente al guardar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-plan">Aplicar a</Label>
            <select
              id="pay-plan"
              value={destino}
              onChange={(e) => elegirDestino(e.target.value)}
              className={SELECT}
            >
              <option value="">A cuenta (sin asignar)</option>
              {cuentasPorCobrar.length > 0 && (
                <optgroup label="Cuentas por cobrar">
                  {cuentasPorCobrar.map((c) => (
                    <option key={c.id} value={`cuenta:${c.id}`}>
                      {c.description} · saldo {formatMoney(c.resumen.saldoCents, c.currency)}
                    </option>
                  ))}
                </optgroup>
              )}
              {planesSinCuenta.length > 0 && (
                <optgroup label="Planes de tratamiento">
                  {planesSinCuenta.map((p) => (
                    <option key={p.id} value={`plan:${p.id}`}>
                      {p.name} · {formatMoney(p.totalCents, p.currency)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {destino.startsWith("cuenta:") && (
              <p className="text-xs text-muted-foreground">
                Se imputa primero a la cuota más antigua.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Monto</Label>
              <MoneyInput
                id="pay-amount"
                currency={currency}
                min={0}
                valueCents={amount}
                onValueChange={(c) => {
                  setAmount(c);
                  setMontoEditado(true);
                }}
                aria-describedby="pay-amount-saldo"
              />
              <p id="pay-amount-saldo" className="text-xs text-muted-foreground">
                {!saldoCargado ? (
                  "Calculando saldo…"
                ) : suggestedAmountCents > 0 ? (
                  <>
                    Saldo pendiente:{" "}
                    <span className="cifra text-foreground">
                      {formatMoney(suggestedAmountCents, currency)}
                    </span>
                    {amount !== suggestedAmountCents && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          onClick={() => {
                            setAmount(suggestedAmountCents);
                            setMontoEditado(false);
                          }}
                          className="font-medium text-brand-700 underline-offset-2 hover:underline"
                        >
                          Usar saldo
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  "Sin saldo pendiente: lo que cobres queda a favor del paciente."
                )}
              </p>
            </div>
            {!repartir && (
              <div className="space-y-1.5">
                <Label htmlFor="pay-method">Medio de pago</Label>
                {mediosDePago.length > 0 ? (
                  <select
                    id="pay-method"
                    value={medioElegido}
                    onChange={(e) => setPaymentMethodId(e.target.value)}
                    className={SELECT}
                  >
                    {mediosDePago.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.retentionPct > 0 ? ` · retiene ${m.retentionPct}%` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    id="pay-method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                    className={SELECT}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {mediosDePago.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={repartir}
                onChange={(e) => activarReparto(e.target.checked)}
                className="size-4 rounded border-hairline"
              />
              Pagar con varios medios (por ejemplo, efectivo y tarjeta)
            </label>
          )}

          {repartir && (
            <fieldset className="space-y-2 rounded-lg border border-hairline p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                Reparto entre medios
              </legend>
              {partes.map((p, i) => (
                <div
                  key={p.key}
                  className={
                    partes.length > 2
                      ? "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_2.25rem] items-center gap-2"
                      : "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-2"
                  }
                >
                  <select
                    aria-label={`Medio ${i + 1}`}
                    value={p.paymentMethodId}
                    onChange={(e) => cambiarParte(p.key, { paymentMethodId: e.target.value })}
                    className={SELECT}
                  >
                    <option value="" disabled>
                      Elige un medio
                    </option>
                    {mediosDePago.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <MoneyInput
                    aria-label={`Monto del medio ${i + 1}`}
                    currency={currency}
                    min={0}
                    valueCents={p.amountCents}
                    onValueChange={(c) => cambiarParte(p.key, { amountCents: c })}
                  />
                  {partes.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar medio ${i + 1}`}
                      onClick={() => setPartes((prev) => prev.filter((x) => x.key !== p.key))}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                <span
                  className={
                    total > 0 && restante === 0
                      ? "text-success"
                      : restante < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                  aria-live="polite"
                >
                  {total <= 0
                    ? "Ingresa primero el monto del cobro."
                    : restante === 0
                      ? "El reparto cuadra con el monto."
                      : restante > 0
                        ? `Falta asignar ${formatMoney(restante, currency)}.`
                        : `Asignaste ${formatMoney(-restante, currency)} de más.`}
                </span>
                {restante > 0 && sinMonto && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => cambiarParte(sinMonto.key, { amountCents: restante })}
                  >
                    Completar {medioPorId.get(sinMonto.paymentMethodId)?.name ?? "el medio vacío"}
                  </Button>
                )}
                {partes.length < Math.min(MAX_PARTES_COBRO, mediosDePago.length) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setPartes((prev) => [
                        ...prev,
                        {
                          key: crypto.randomUUID(),
                          paymentMethodId:
                            mediosDePago.find((m) => !prev.some((x) => x.paymentMethodId === m.id))
                              ?.id ?? "",
                          amountCents: null,
                        },
                      ])
                    }
                  >
                    <Plus className="size-3.5" /> Agregar medio
                  </Button>
                )}
              </div>
            </fieldset>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">Referencia (opcional)</Label>
            <input
              id="pay-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Nº de transacción, comprobante, folio del bono…"
              className={SELECT}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-notes">Notas</Label>
            <textarea
              id="pay-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={SELECT}
            />
          </div>
        </div>
        <DialogFooter className="items-center gap-2">
          <AccionDeshabilitada motivo={create.enCurso ? null : motivo}>
            <Button onClick={guardar} disabled={create.enCurso}>
              {create.enCurso && <Loader2 className="size-3.5 animate-spin" />}
              Guardar pago
            </Button>
          </AccionDeshabilitada>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
