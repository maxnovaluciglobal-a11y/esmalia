import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { ChipEstadoCuenta, ChipEstadoCuota } from "@/components/finance/chip-estado-cuenta";
import { PlanDePagoDialog } from "@/components/finance/plan-de-pago-dialog";
import { BloqueoEscritura } from "@/components/solo-lectura";
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
import { Label } from "@/components/ui/label";
import type { CuentaPorCobrar } from "@/lib/finance/cuentas-por-cobrar";
import { anularCuenta, crearCuentaDesdePlan } from "@/lib/finance/cuentas-por-cobrar.functions";
import { formatMoney, type TreatmentPlan } from "@/lib/finance/finance";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Cuentas por cobrar del paciente, dentro de su ficha (FIN-02/03, PLA-07).
 *
 * Una cuenta nace sola al aceptar un presupuesto; para los planes que no
 * tienen (anteriores a esto), se crea desde acá. El saldo del encabezado de la
 * ficha no cambia: las cuentas son la misma deuda ordenada por origen y
 * vencimiento, no deuda nueva.
 */
export function CuentasDelPaciente({
  clinicId,
  patientId,
  cuentas,
  hoy,
  plans,
  cargando,
  error,
  puedeEditar,
  puedeAnular,
}: {
  clinicId: string;
  patientId: string;
  cuentas: CuentaPorCobrar[];
  hoy: string;
  plans: TreatmentPlan[];
  cargando: boolean;
  error: boolean;
  puedeEditar: boolean;
  puedeAnular: boolean;
}) {
  const queryClient = useQueryClient();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<CuentaPorCobrar | null>(null);
  const [motivo, setMotivo] = useState("");
  const crearFn = useServerFn(crearCuentaDesdePlan);
  const anularFn = useServerFn(anularCuenta);

  function refrescar() {
    void queryClient.invalidateQueries({ queryKey: ["cuentas-paciente", clinicId, patientId] });
    void queryClient.invalidateQueries({ queryKey: ["cuentas-por-cobrar", clinicId] });
  }

  const crear = useMutation({
    mutationFn: (planId: string) => crearFn({ data: { clinicId, planId } }),
    onSuccess: () => {
      refrescar();
      toast.success("Cuenta por cobrar creada");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const anular = useMutation({
    mutationFn: (v: { receivableId: string; reason: string }) =>
      anularFn({ data: { clinicId, ...v } }),
    onSuccess: () => {
      refrescar();
      toast.success("Cuenta anulada");
      setAnulando(null);
      setMotivo("");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const planesConCuenta = new Set(cuentas.filter((c) => !c.voidedAt).map((c) => c.treatmentPlanId));
  const planesSinCuenta = plans.filter(
    (p) =>
      p.status !== "cancelled" &&
      !planesConCuenta.has(p.id) &&
      p.items.some((it) => (it.patientCents ?? it.priceCents) > 0),
  );

  return (
    <section aria-labelledby="titulo-cuentas">
      <p
        id="titulo-cuentas"
        className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Cuentas por cobrar
      </p>

      {cargando && <p className="text-xs text-muted-foreground">Cargando cuentas…</p>}
      {!cargando && error && (
        <p className="text-xs text-destructive">
          No pudimos cargar las cuentas por cobrar. El saldo de arriba sigue siendo el correcto.
        </p>
      )}
      {!cargando && !error && cuentas.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Sin cuentas por cobrar. Se crean solas al aceptar un presupuesto.
        </p>
      )}

      {cuentas.map((c) => {
        const r = c.resumen;
        const expandida = abierta === c.id;
        return (
          <div
            key={c.id}
            className={cn("mb-2 rounded-lg border border-hairline", c.voidedAt && "opacity-70")}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => setAbierta(expandida ? null : c.id)}
                aria-expanded={expandida}
                className="flex min-w-0 flex-1 items-start gap-2 text-left"
              >
                {expandida ? (
                  <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 space-y-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{c.description}</span>
                    <ChipEstadoCuenta estado={r.estado} />
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {r.cuotas.length > 0
                      ? `${r.cuotas.filter((q) => q.estado === "pagada").length} de ${r.cuotas.length} cuotas pagadas`
                      : c.dueOn
                        ? `Vence el ${fecha(c.dueOn)}`
                        : "Sin vencimiento"}
                    {r.diasDeAtraso !== null &&
                      ` · ${r.diasDeAtraso} día${r.diasDeAtraso === 1 ? "" : "s"} de atraso`}
                    {c.voidedAt && c.voidReason && ` · Anulada: ${c.voidReason}`}
                  </span>
                </span>
              </button>
              <div className="text-right">
                <p className="cifra text-sm font-semibold">
                  {r.estado === "anulada" || r.estado === "pagada"
                    ? formatMoney(c.amountCents, c.currency)
                    : formatMoney(r.saldoCents, c.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.estado === "anulada" || r.estado === "pagada"
                    ? r.aFavorCents > 0
                      ? `${formatMoney(r.aFavorCents, c.currency)} a favor`
                      : "Total"
                    : `por cobrar de ${formatMoney(c.amountCents, c.currency)}`}
                </p>
              </div>
            </div>

            {expandida && (
              <div className="space-y-3 border-t border-hairline px-4 py-3 text-xs">
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Emitida</dt>
                    <dd>{fecha(c.issuedOn)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Pagado</dt>
                    <dd className="cifra">{formatMoney(r.pagadoCents, c.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Vencido</dt>
                    <dd className={cn("cifra", r.vencidoCents > 0 && "text-destructive")}>
                      {formatMoney(r.vencidoCents, c.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Próximo vencimiento</dt>
                    <dd>{r.proximoVencimiento ? fecha(r.proximoVencimiento) : "Sin dato"}</dd>
                  </div>
                </dl>

                {r.cuotas.length > 0 && (
                  <table className="w-full">
                    <caption className="sr-only">Cuotas de {c.description}</caption>
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th scope="col" className="py-1 font-medium">
                          Cuota
                        </th>
                        <th scope="col" className="py-1 font-medium">
                          Vence
                        </th>
                        <th scope="col" className="py-1 text-right font-medium">
                          Monto
                        </th>
                        <th
                          scope="col"
                          className="hidden py-1 text-right font-medium sm:table-cell"
                        >
                          Pagado
                        </th>
                        <th scope="col" className="py-1 text-right font-medium">
                          Estado
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.cuotas.map((q) => (
                        <tr key={q.id} className="border-t border-hairline">
                          <td className="cifra py-1.5">{q.number}</td>
                          <td className="py-1.5">{fecha(q.dueOn)}</td>
                          <td className="cifra py-1.5 text-right">
                            {formatMoney(q.amountCents, c.currency)}
                          </td>
                          <td className="cifra hidden py-1.5 text-right sm:table-cell">
                            {formatMoney(q.pagadoCents, c.currency)}
                          </td>
                          <td className="py-1.5 text-right">
                            <ChipEstadoCuota estado={q.estado} vencida={q.vencida} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {!c.voidedAt && (puedeEditar || puedeAnular) && (
                  <div className="flex flex-wrap justify-end gap-1">
                    {puedeEditar && r.estado !== "pagada" && (
                      <PlanDePagoDialog
                        clinicId={clinicId}
                        patientId={patientId}
                        cuenta={c}
                        hoy={hoy}
                      />
                    )}
                    {puedeAnular && (
                      <BloqueoEscritura>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setAnulando(c)}
                        >
                          Anular
                        </Button>
                      </BloqueoEscritura>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {puedeEditar && planesSinCuenta.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {planesSinCuenta.map((p) => (
            <BloqueoEscritura key={p.id}>
              <Button
                variant="outline"
                size="sm"
                disabled={crear.isPending}
                onClick={() => crear.mutate(p.id)}
              >
                {crear.isPending && crear.variables === p.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Crear cuenta de {p.name}
              </Button>
            </BloqueoEscritura>
          ))}
        </div>
      )}

      <AlertDialog
        open={anulando !== null}
        onOpenChange={(o) => {
          if (!o) {
            setAnulando(null);
            setMotivo("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anular cuenta por cobrar</AlertDialogTitle>
            <AlertDialogDescription>
              La cuenta no se borra: queda anulada con el motivo y deja de contar como deuda en la
              cartera. Los pagos que tenga no se tocan; si hay que devolver plata, reversa el pago
              aparte. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo-anular" className="text-xs">
              Motivo (obligatorio)
            </Label>
            <textarea
              id="motivo-anular"
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: se renegoció el tratamiento"
              className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={anular.isPending || motivo.trim().length < 3}
              onClick={(e) => {
                e.preventDefault();
                if (anulando) anular.mutate({ receivableId: anulando.id, reason: motivo.trim() });
              }}
            >
              {anular.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Anular cuenta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
