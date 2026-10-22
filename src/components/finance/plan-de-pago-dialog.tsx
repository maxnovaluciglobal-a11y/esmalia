import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { MoneyInput } from "@/components/money-input";
import { BloqueoEscritura } from "@/components/solo-lectura";
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
  MAX_CUOTAS,
  cuotasIguales,
  esDiaIso,
  sumarMeses,
  validarCuotas,
  type CuentaPorCobrar,
} from "@/lib/finance/cuentas-por-cobrar";
import { definirPlanDePago } from "@/lib/finance/cuentas-por-cobrar.functions";
import { formatMoney } from "@/lib/finance/finance";
import { mensajeDeError } from "@/lib/mensaje-error";

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type Fila = { key: string; dueOn: string; amountCents: number | null };

function filasDe(cuotas: { dueOn: string; amountCents: number }[]): Fila[] {
  return cuotas.map((c) => ({ key: crypto.randomUUID(), ...c }));
}

/**
 * Plan de pago de una cuenta por cobrar (FIN-03): dividirla en N cuotas con
 * fecha, o dejarla en un solo pago con vencimiento opcional. Lo ya pagado se
 * imputa solo a la cuota más antigua; no hay cobro automático (no hay
 * proveedor de pagos): las cuotas vencidas quedan a la vista para cobrarlas.
 */
export function PlanDePagoDialog({
  clinicId,
  patientId,
  cuenta,
  hoy,
}: {
  clinicId: string;
  patientId: string;
  cuenta: CuentaPorCobrar;
  /** Hoy de la clínica (YYYY-MM-DD). */
  hoy: string;
}) {
  const [open, setOpen] = useState(false);
  const [modo, setModo] = useState<"unico" | "cuotas">("unico");
  const [vence, setVence] = useState("");
  const [cantidad, setCantidad] = useState(3);
  const [primera, setPrimera] = useState(sumarMeses(hoy, 1));
  const [filas, setFilas] = useState<Fila[]>([]);
  const queryClient = useQueryClient();
  const guardarFn = useServerFn(definirPlanDePago);

  function abrir() {
    const actuales = cuenta.resumen.cuotas;
    if (actuales.length > 0) {
      setModo("cuotas");
      setCantidad(actuales.length);
      setPrimera(actuales[0].dueOn);
      setFilas(filasDe(actuales.map((c) => ({ dueOn: c.dueOn, amountCents: c.amountCents }))));
    } else {
      setModo(cuenta.dueOn ? "unico" : "cuotas");
      setVence(cuenta.dueOn ?? "");
      setCantidad(3);
      setPrimera(sumarMeses(hoy, 1));
      setFilas(filasDe(cuotasIguales(cuenta.amountCents, 3, sumarMeses(hoy, 1))));
    }
  }

  function generar(n: number, desde: string) {
    if (!esDiaIso(desde) || n < 1) return;
    setFilas(filasDe(cuotasIguales(cuenta.amountCents, n, desde)));
  }

  const cuotas = filas.map((f) => ({ dueOn: f.dueOn, amountCents: f.amountCents ?? 0 }));
  const suma = cuotas.reduce((s, c) => s + c.amountCents, 0);
  const motivo =
    modo === "cuotas"
      ? cuotas.length === 0
        ? "Agrega al menos una cuota."
        : validarCuotas(cuotas, cuenta.amountCents)
      : vence && !esDiaIso(vence)
        ? "La fecha de vencimiento no es válida."
        : null;

  const guardar = useMutation({
    mutationFn: () =>
      guardarFn({
        data: {
          clinicId,
          receivableId: cuenta.id,
          dueOn: modo === "unico" ? vence || null : null,
          cuotas: modo === "cuotas" ? cuotas : [],
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cuentas-paciente", clinicId, patientId] });
      void queryClient.invalidateQueries({ queryKey: ["cuentas-por-cobrar", clinicId] });
      toast.success(modo === "cuotas" ? "Cuotas guardadas" : "Plan de pago guardado");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) abrir();
        setOpen(o);
      }}
    >
      <BloqueoEscritura>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            <CalendarClock className="size-3.5" /> Plan de pago
          </Button>
        </DialogTrigger>
      </BloqueoEscritura>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Plan de pago</DialogTitle>
          <DialogDescription>
            {cuenta.description} · {formatMoney(cuenta.amountCents, cuenta.currency)}. Lo ya pagado
            ({formatMoney(cuenta.resumen.pagadoCents, cuenta.currency)}) se imputa a la cuota más
            antigua.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div role="radiogroup" aria-label="Forma de pago" className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["unico", "Un solo pago"],
                ["cuotas", "En cuotas"],
              ] as const
            ).map(([valor, texto]) => (
              <label
                key={valor}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft"
              >
                <input
                  type="radio"
                  name="modo-plan"
                  value={valor}
                  checked={modo === valor}
                  onChange={() => setModo(valor)}
                  className="size-4"
                />
                {texto}
              </label>
            ))}
          </div>

          {modo === "unico" ? (
            <div className="space-y-1.5">
              <Label htmlFor="plan-vence">Vence el (opcional)</Label>
              <input
                id="plan-vence"
                type="date"
                value={vence}
                min={cuenta.issuedOn}
                onChange={(e) => setVence(e.target.value)}
                className={INPUT}
              />
              <p className="text-xs text-muted-foreground">
                Sin fecha, la cuenta no vence: no se inventa un plazo que nadie fijó.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="plan-n">Cuotas</Label>
                  <input
                    id="plan-n"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_CUOTAS}
                    value={cantidad}
                    onChange={(e) => {
                      const n = Math.min(
                        MAX_CUOTAS,
                        Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                      );
                      setCantidad(n);
                      generar(n, primera);
                    }}
                    className={INPUT}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="plan-primera">Primera cuota</Label>
                  <input
                    id="plan-primera"
                    type="date"
                    value={primera}
                    onChange={(e) => {
                      setPrimera(e.target.value);
                      generar(cantidad, e.target.value);
                    }}
                    className={INPUT}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Mensuales y del mismo monto; puedes ajustar fechas y montos abajo. Tienen que sumar
                exacto el total de la cuenta.
              </p>
              <ol className="space-y-2">
                {filas.map((f, i) => (
                  <li key={f.key} className="grid grid-cols-[2rem_1fr_1fr] items-center gap-2">
                    <span className="cifra text-xs text-muted-foreground">{i + 1}</span>
                    <input
                      type="date"
                      aria-label={`Vencimiento de la cuota ${i + 1}`}
                      value={f.dueOn}
                      onChange={(e) =>
                        setFilas((prev) =>
                          prev.map((x) => (x.key === f.key ? { ...x, dueOn: e.target.value } : x)),
                        )
                      }
                      className={INPUT}
                    />
                    <MoneyInput
                      aria-label={`Monto de la cuota ${i + 1}`}
                      currency={cuenta.currency}
                      min={0}
                      mostrarMoneda={false}
                      valueCents={f.amountCents}
                      onValueChange={(c) =>
                        setFilas((prev) =>
                          prev.map((x) => (x.key === f.key ? { ...x, amountCents: c } : x)),
                        )
                      }
                    />
                  </li>
                ))}
              </ol>
              <p
                className={
                  suma === cuenta.amountCents ? "text-xs text-success" : "text-xs text-warning"
                }
                aria-live="polite"
              >
                Suman {formatMoney(suma, cuenta.currency)} de{" "}
                {formatMoney(cuenta.amountCents, cuenta.currency)}.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <AccionDeshabilitada motivo={guardar.isPending ? null : motivo}>
            <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
              {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Guardar plan de pago
            </Button>
          </AccionDeshabilitada>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
