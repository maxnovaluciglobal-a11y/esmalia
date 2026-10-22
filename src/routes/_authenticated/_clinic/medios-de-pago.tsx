import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
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
import { requirePermission } from "@/lib/access/route-guards";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import { formatMoney, netAfterRetention, type PaymentMethodConfig } from "@/lib/finance/finance";
import {
  createPaymentMethod,
  listPaymentMethods,
  setPaymentMethodActive,
  updatePaymentMethod,
} from "@/lib/finance/clinic-finance.functions";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";

export const Route = createFileRoute("/_authenticated/_clinic/medios-de-pago")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Medios de pago | Esmalia" },
      {
        name: "description",
        content:
          "Medios de pago de la clínica con la retención que cobra cada operador, para que el reporte muestre lo que realmente entra.",
      },
    ],
  }),
  component: MediosDePagoPage,
});

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Monto de ejemplo para mostrar el efecto de la retención en pesos reales. */
const EJEMPLO_CENTS = 100_000;

function MedioDialog({
  clinicId,
  medio,
  currency,
}: {
  clinicId: string;
  medio?: PaymentMethodConfig;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(medio?.name ?? "");
  const [retention, setRetention] = useState(medio?.retentionPct ?? 0);
  const [allowsRefund, setAllowsRefund] = useState(medio?.allowsRefund ?? false);
  const queryClient = useQueryClient();
  const createFn = useServerFn(createPaymentMethod);
  const updateFn = useServerFn(updatePaymentMethod);

  const guardar = useMutation({
    mutationFn: () => {
      const payload = {
        clinicId,
        name: name.trim(),
        retentionPct: retention,
        allowsRefund,
        position: medio?.position ?? 99,
      };
      return medio
        ? updateFn({ data: { ...payload, paymentMethodId: medio.id } }).then(() => undefined)
        : createFn({ data: payload }).then(() => undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment-methods", clinicId] });
      toast.success(medio ? "Medio de pago actualizado" : "Medio de pago creado");
      setOpen(false);
      if (!medio) {
        setName("");
        setRetention(0);
        setAllowsRefund(false);
      }
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && medio) {
          setName(medio.name);
          setRetention(medio.retentionPct);
          setAllowsRefund(medio.allowsRefund);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        {medio ? (
          <Button variant="ghost" size="sm">
            <Pencil className="size-3.5" /> Editar
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="size-4" /> Nuevo medio de pago
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{medio ? "Editar medio de pago" : "Nuevo medio de pago"}</DialogTitle>
          <DialogDescription>
            La retención es lo que se queda el operador. El paciente paga el total igual; a la
            clínica le entra menos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="m-name">Nombre</Label>
            <input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Klap - Crédito"
              className={INPUT}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-ret">Retención (%)</Label>
            <input
              id="m-ret"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={retention}
              onChange={(e) => setRetention(Math.min(100, Math.max(0, Number(e.target.value))))}
              className={INPUT}
            />
            <p className="text-xs text-muted-foreground">
              Con {retention}%, un cobro de {formatMoney(EJEMPLO_CENTS, currency)} deja{" "}
              <strong className="text-foreground">
                {formatMoney(netAfterRetention(EJEMPLO_CENTS, retention), currency)}
              </strong>{" "}
              en la clínica.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowsRefund}
              onChange={(e) => setAllowsRefund(e.target.checked)}
              className="size-4 rounded border-hairline"
            />
            Permite devolución
          </label>
        </div>

        <DialogFooter>
          <Button onClick={() => guardar.mutate()} disabled={!name.trim() || guardar.isPending}>
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {medio ? "Guardar cambios" : "Crear medio de pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediosDePagoPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const currency = access.clinic?.currency ?? "CLP";
  const queryClient = useQueryClient();

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  const fetchMethods = useServerFn(listPaymentMethods);
  const setActiveFn = useServerFn(setPaymentMethodActive);

  const {
    data: medios = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["payment-methods", clinicId, "todos"],
    enabled: Boolean(clinicId) && !bloqueado,
    queryFn: () =>
      fetchMethods({ data: { clinicId: clinicId!, incluirInactivos: true, paraInforme: true } }),
  });

  const setActive = useMutation({
    mutationFn: (v: { paymentMethodId: string; isActive: boolean }) =>
      setActiveFn({ data: { clinicId: clinicId!, ...v } }),
    onSuccess: (_r, v) => {
      queryClient.invalidateQueries({ queryKey: ["payment-methods", clinicId] });
      toast.success(v.isActive ? "Medio de pago habilitado" : "Medio de pago deshabilitado");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const conRetencion = medios.filter((m) => m.retentionPct > 0).length;

  return (
    <AppShell title="Medios de pago" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Medios de pago" sub={sub ?? null} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-sm text-muted-foreground">
              {isError
                ? "Carga la comisión de tus tarjetas para que Finanzas muestre lo que realmente entra al banco."
                : conRetencion === 0
                  ? "Ninguno tiene retención cargada, así que Finanzas muestra lo facturado. Carga la comisión de tus tarjetas para ver lo que realmente entra al banco."
                  : `${conRetencion} de ${medios.length} tienen retención cargada.`}
            </p>
            <MedioDialog clinicId={clinicId!} currency={currency} />
          </div>

          {isLoading && <p className="text-sm text-muted-foreground">Cargando medios de pago…</p>}

          {isError && (
            <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar los medios de pago." />
          )}

          {!isLoading && !isError && (
            <section className="card-clinical overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-xs text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium">Medio de pago</th>
                      <th className="px-3 py-2 text-right font-medium">Retención</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Neto de {formatMoney(EJEMPLO_CENTS, currency)}
                      </th>
                      <th className="px-3 py-2 text-center font-medium">Devolución</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {medios.map((m) => (
                      <tr
                        key={m.id}
                        className={cn(
                          "border-b border-hairline last:border-0",
                          !m.isActive && "opacity-50",
                        )}
                      >
                        <td className="px-4 py-2">
                          {m.name}
                          {!m.isActive && (
                            <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              Deshabilitado
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {m.retentionPct > 0 ? `${m.retentionPct}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-xs cifra text-muted-foreground">
                          {formatMoney(netAfterRetention(EJEMPLO_CENTS, m.retentionPct), currency)}
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-muted-foreground">
                          {m.allowsRefund ? "Sí" : "No"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <MedioDialog clinicId={clinicId!} medio={m} currency={currency} />
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={setActive.isPending}
                              onClick={() =>
                                setActive.mutate({ paymentMethodId: m.id, isActive: !m.isActive })
                              }
                            >
                              {m.isActive ? "Deshabilitar" : "Habilitar"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="text-xs text-muted-foreground">
            Cambiar la retención afecta solo a los cobros futuros: cada pago congela su neto al
            registrarse, así que un recibo viejo sigue diciendo lo que entró ese día.
          </p>
        </div>
      )}
    </AppShell>
  );
}
