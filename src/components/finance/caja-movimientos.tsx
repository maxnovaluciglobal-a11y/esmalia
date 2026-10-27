/**
 * Movimientos de efectivo de una caja (Ola 10 · CAJ-04): traspasos a otra
 * caja, retiros y depósitos al banco. Va en la columna derecha de la caja,
 * arriba del arqueo, dentro de la composición A+ (#164).
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDownLeft, ArrowUpRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { PANEL } from "@/components/finance/caja-del-dia";
import { MoneyInput } from "@/components/money-input";
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
import {
  CASH_MOVEMENT_KINDS,
  CASH_MOVEMENT_LABELS,
  nombreDeCaja,
  type CashMovement,
  type CashMovementKind,
  type CashRegister,
} from "@/lib/finance/cash-registers";
import { createCashMovement, listOpenCashRegisters } from "@/lib/finance/cash-registers.functions";
import { formatMoney } from "@/lib/finance/finance";
import { hora } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

const INPUT =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function MovimientosDeCajaPanel({
  clinicId,
  caja,
  userId,
  movimientos,
  cargando,
  disponibleCents,
  clinicTz,
  onRegistrado,
}: {
  clinicId: string;
  caja: CashRegister;
  userId: string;
  movimientos: CashMovement[];
  cargando: boolean;
  /** Efectivo que hay ahora en el cajón (tope del movimiento). */
  disponibleCents: number | null;
  clinicTz: string | undefined;
  onRegistrado: () => void;
}) {
  const uid = useId();
  const [abierto, setAbierto] = useState(false);
  const currency = caja.currency;
  return (
    <section aria-labelledby={`${uid}-titulo`} className={cn(PANEL, "p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${uid}-titulo`} className="font-display text-[30px] font-medium leading-none">
            Movimientos de <em className="text-brand-600">efectivo</em>
          </h2>
          <p className="mt-1.5 text-[12.5px] font-medium text-muted-foreground">
            Traspasos entre cajas, retiros y depósitos. Ajustan el esperado del arqueo.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-10 rounded-full px-4"
          onClick={() => setAbierto(true)}
        >
          <Plus aria-hidden /> Registrar
        </Button>
      </div>
      {cargando ? (
        <p className="mt-3 text-sm text-muted-foreground">Cargando movimientos…</p>
      ) : movimientos.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Sin movimientos en este turno: todo el efectivo sigue en el cajón.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-hairline border-y border-hairline">
          {movimientos.map((m) => {
            const entra = m.toRegisterId === caja.id;
            return (
              <li key={m.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <span className="flex min-w-0 items-start gap-2">
                  {entra ? (
                    <ArrowDownLeft className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <ArrowUpRight
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {entra ? "Traspaso recibido" : CASH_MOVEMENT_LABELS[m.kind]}
                    </span>
                    <span className="block text-[12.5px] text-muted-foreground">
                      {hora(m.createdAt, clinicTz)} · {m.reason}
                      {m.reference ? ` · Comprobante ${m.reference}` : ""}
                    </span>
                  </span>
                </span>
                <span className={cn("cifra shrink-0 font-medium", entra && "text-success")}>
                  {entra ? "+" : "−"}
                  {formatMoney(m.amountCents, currency)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <NuevoMovimientoDialog
        abierto={abierto}
        onCambiar={setAbierto}
        clinicId={clinicId}
        caja={caja}
        userId={userId}
        disponibleCents={disponibleCents}
        onRegistrado={() => {
          setAbierto(false);
          onRegistrado();
        }}
      />
    </section>
  );
}

function NuevoMovimientoDialog({
  abierto,
  onCambiar,
  clinicId,
  caja,
  userId,
  disponibleCents,
  onRegistrado,
}: {
  abierto: boolean;
  onCambiar: (v: boolean) => void;
  clinicId: string;
  caja: CashRegister;
  userId: string;
  disponibleCents: number | null;
  onRegistrado: () => void;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<CashMovementKind>("deposito");
  const [monto, setMonto] = useState<number | null>(null);
  const [destino, setDestino] = useState("");
  const [motivo, setMotivo] = useState("");
  const [comprobante, setComprobante] = useState("");

  const fetchAbiertas = useServerFn(listOpenCashRegisters);
  const { data: abiertas } = useQuery({
    queryKey: ["cajas-abiertas", clinicId],
    queryFn: () => fetchAbiertas({ data: { clinicId } }),
    enabled: abierto && kind === "traspaso",
  });
  const otras = (abiertas ?? []).filter((c) => c.id !== caja.id);

  const crear = useServerFn(createCashMovement);
  const mutation = useMutation({
    mutationFn: () =>
      crear({
        data: {
          clinicId,
          kind,
          fromRegisterId: caja.id,
          toRegisterId: kind === "traspaso" ? destino || null : null,
          amountCents: monto ?? 0,
          reason: motivo.trim(),
          reference: comprobante.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Movimiento registrado.");
      setMonto(null);
      setMotivo("");
      setComprobante("");
      setDestino("");
      queryClient.invalidateQueries({ queryKey: ["cajas-del-dia", clinicId] });
      onRegistrado();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const excede = disponibleCents !== null && (monto ?? 0) > disponibleCents;
  const faltaDestino = kind === "traspaso" && !destino;
  const listo = (monto ?? 0) > 0 && motivo.trim().length >= 4 && !faltaDestino && !excede;

  return (
    <Dialog open={abierto} onOpenChange={onCambiar}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar movimiento de efectivo</DialogTitle>
          <DialogDescription>
            Sale de {nombreDeCaja(caja, userId).toLowerCase()}
            {disponibleCents !== null &&
              `; hay ${formatMoney(disponibleCents, caja.currency)} en el cajón`}
            . Queda registrado con tu nombre y no se puede borrar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Tipo</legend>
            <div className="flex flex-wrap gap-1.5">
              {CASH_MOVEMENT_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-semibold pointer-coarse:h-11",
                    kind === k
                      ? "border-foreground bg-foreground text-background"
                      : "border-control bg-card hover:border-foreground",
                  )}
                >
                  {CASH_MOVEMENT_LABELS[k]}
                </button>
              ))}
            </div>
          </fieldset>
          {kind === "traspaso" && (
            <div className="space-y-2">
              <Label htmlFor={`${fid}-destino`}>Caja que recibe</Label>
              <select
                id={`${fid}-destino`}
                className={INPUT}
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
              >
                <option value="">Elige una caja abierta</option>
                {otras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nombreDeCaja(c, userId)}
                  </option>
                ))}
              </select>
              {abiertas && otras.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No hay otra caja abierta en este momento.
                </p>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${fid}-monto`}>Monto</Label>
            <MoneyInput
              id={`${fid}-monto`}
              valueCents={monto}
              onValueChange={setMonto}
              currency={caja.currency}
            />
            {excede && (
              <p className="text-xs text-destructive">Es más de lo que hay en el cajón.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fid}-motivo`}>Motivo</Label>
            <textarea
              id={`${fid}-motivo`}
              className={INPUT}
              rows={2}
              value={motivo}
              placeholder={
                kind === "deposito"
                  ? "Depósito del efectivo de la mañana"
                  : kind === "retiro"
                    ? "Compra de insumos de aseo"
                    : "Sencillo para vuelto"
              }
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          {kind !== "traspaso" && (
            <div className="space-y-2">
              <Label htmlFor={`${fid}-comprobante`}>N.º de comprobante (opcional)</Label>
              <input
                id={`${fid}-comprobante`}
                className={INPUT}
                maxLength={80}
                value={comprobante}
                onChange={(e) => setComprobante(e.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!listo || mutation.isPending}>
            {mutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
