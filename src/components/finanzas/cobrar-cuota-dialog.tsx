import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { INPUT } from "@/components/finanzas/piezas";
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
import { listPaymentMethods } from "@/lib/finance/clinic-finance.functions";
import { formatMoney } from "@/lib/finance/finance";
import { etiquetaPeriodoCuota } from "@/lib/finance/membresias";
import { cobrarCuotaMembresia, type CuotaMembresia } from "@/lib/finance/membresias.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

/**
 * Registrar el cobro de una cuota de membresía (FIN-12): una persona anota que
 * el paciente pagó, con qué medio y la referencia. No hay cobro automático.
 * Lo usan Membresías y la ficha del paciente.
 */
export function DialogoCobrar({
  clinicId,
  cuota,
  onCerrar,
}: {
  clinicId: string;
  cuota: CuotaMembresia;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const fetchMedios = useServerFn(listPaymentMethods);
  const { data: medios = [] } = useQuery({
    queryKey: ["payment-methods", clinicId],
    queryFn: () => fetchMedios({ data: { clinicId } }),
  });
  const [elegido, setElegido] = useState("");
  const [referencia, setReferencia] = useState("");
  // El medio por defecto es el efectivo (si la clínica lo tiene): es lo que
  // entra al cajón y se cuenta en el arqueo.
  const medio =
    elegido || (medios.find((m) => m.kind === "cash" || m.legacyKey === "cash")?.id ?? "");
  const fn = useServerFn(cobrarCuotaMembresia);
  const cobrar = useMutation({
    mutationFn: () =>
      fn({
        data: {
          clinicId,
          id: cuota.id,
          paymentMethodId: medio,
          reference: referencia.trim() || null,
        },
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["membresias-cuotas", clinicId] });
      void qc.invalidateQueries({ queryKey: ["membresia-paciente", clinicId] });
      void qc.invalidateQueries({ queryKey: ["payments", clinicId] });
      void qc.invalidateQueries({ queryKey: ["caja-del-dia", clinicId] });
      void qc.invalidateQueries({ queryKey: ["cash-register-breakdown"] });
      void qc.invalidateQueries({ queryKey: ["cajas-del-dia", clinicId] });
      if (res.yaCobrada) {
        toast.info("Esa cuota ya estaba cobrada: no se registró otro cobro.");
      } else {
        toast.success("Cuota cobrada y registrada en la caja");
      }
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cobrar {formatMoney(cuota.amountCents, cuota.currency)}</DialogTitle>
          <DialogDescription>
            Cuota de {cuota.planName}, {etiquetaPeriodoCuota(cuota.periodStart, cuota.periodEnd)}
            {cuota.patientName ? `, de ${cuota.patientName}` : ""}. Registra el cobro que ya
            recibiste; no se carga ninguna tarjeta. Queda como un pago en tu caja, con el medio que
            elijas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cc-medio">Medio de pago</Label>
            <select
              id="cc-medio"
              value={medio}
              onChange={(e) => setElegido(e.target.value)}
              className={INPUT}
            >
              <option value="" disabled>
                Elige un medio
              </option>
              {medios.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-ref">Referencia</Label>
            <input
              id="cc-ref"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="N.º de transferencia o comprobante (opcional)"
              className={INPUT}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => cobrar.mutate()} disabled={cobrar.isPending || !medio}>
            {cobrar.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Clock className="size-4" />
            )}
            Registrar cobro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
