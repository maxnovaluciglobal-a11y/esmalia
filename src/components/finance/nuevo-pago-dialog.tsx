import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CircleDollarSign, Loader2 } from "lucide-react";
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
  type TreatmentPlan,
} from "@/lib/finance/finance";
import { registerPayment } from "@/lib/finance/finance.functions";
import { MoneyInput } from "@/components/money-input";
import { listPaymentMethods } from "@/lib/finance/clinic-finance.functions";
import { useOfflineMutation } from "@/hooks/use-offline-mutation";
import { BloqueoEscritura } from "@/components/solo-lectura";

export function NuevoPagoDialog({
  clinicId,
  patientId,
  userId,
  plans,
  suggestedAmountCents,
  currency,
  abrirAhora,
  onAbierto,
}: {
  clinicId: string;
  patientId: string;
  userId: string;
  plans: TreatmentPlan[];
  suggestedAmountCents: number;
  currency: string;
  abrirAhora?: boolean;
  onAbierto?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(suggestedAmountCents);
  useEffect(() => {
    if (!abrirAhora) return;
    setAmount(suggestedAmountCents);
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
  const [planId, setPlanId] = useState<string>("");
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
      setPlanId("");
      setReference("");
      setNotes("");
    },
  });

  function guardar() {
    void create.mutar({
      // El id lo genera el equipo, no la base: si esto se captura sin
      // conexión y el reintento llega dos veces, el segundo choca contra la
      // PK y el servidor lo reconoce como el mismo cobro (no cobra doble).
      id: crypto.randomUUID(),
      clinicId,
      patientId,
      amountCents: amount ?? 0,
      method,
      // Se manda vacío como undefined: el server solo busca la retención
      // cuando hay un medio configurado elegido.
      paymentMethodId: paymentMethodId || undefined,
      // ⚠️ Sellado en la CAPTURA. Sin esto, un cobro tomado a las 10:00 que
      // sincroniza a las 15:00 entraría con la hora del servidor y el cierre
      // de caja del día quedaría mal.
      paidAt: new Date().toISOString(),
      treatmentPlanId: planId || undefined,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setAmount(suggestedAmountCents);
      }}
    >
      <BloqueoEscritura>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <CircleDollarSign className="size-4" /> Registrar pago
          </Button>
        </DialogTrigger>
      </BloqueoEscritura>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
          <DialogDescription>
            El saldo del paciente se recalcula automáticamente al guardar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Monto</Label>
              <MoneyInput
                id="pay-amount"
                currency={currency}
                min={0}
                valueCents={amount}
                onValueChange={setAmount}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">Método</Label>
              {mediosDePago.length > 0 ? (
                <select
                  id="pay-method"
                  value={paymentMethodId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setPaymentMethodId(id);
                    // El enum sigue guardándose: es lo que leen los reportes
                    // viejos y la cola offline. `legacyKey` lo mapea; un medio
                    // propio de la clínica ("Klap - Crédito") cae en 'other'.
                    const medio = mediosDePago.find((m) => m.id === id);
                    setMethod(medio?.legacyKey ?? "other");
                  }}
                  className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
                  className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-plan">Aplicar a</Label>
            <select
              id="pay-plan"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value="">A cuenta (sin asignar a un plan)</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatMoney(p.totalCents, p.currency)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-ref">Referencia (opcional)</Label>
            <input
              id="pay-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Nº de transacción, comprobante…"
              className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-notes">Notas</Label>
            <textarea
              id="pay-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={guardar} disabled={create.enCurso || (amount ?? 0) <= 0}>
            {create.enCurso && <Loader2 className="size-3.5 animate-spin" />}
            Guardar pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Aceptar un presupuesto capturando (opcionalmente) la firma del paciente.
 * La firma es evidencia adicional del consentimiento — aceptar sin firma sigue
 * siendo válido (queda el nombre + IP como antes). */
