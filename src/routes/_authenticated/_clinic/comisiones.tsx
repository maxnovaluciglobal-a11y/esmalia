import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock, Percent } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { DateField, FilterBar } from "@/components/filters";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAnyPermission } from "@/lib/access/route-guards";
import { hasPermission } from "@/lib/access/access";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { formatMoney } from "@/lib/finance/finance";
import {
  closeCommissionPeriod,
  getCommissionReport,
  markCommissionSettlementPaid,
} from "@/lib/finance/commissions.functions";
import { str } from "@/lib/search";
import { mensajeDeError } from "@/lib/mensaje-error";

interface ComisionesSearch {
  desde: string;
  hasta: string;
}

// validateSearch corre antes del componente (sin Route.useRouteContext(),
// mismo problema estructural que ya documenta agenda.tsx:HOY) — impacto
// acotado al rango por defecto del reporte mientras la URL no traiga fecha
// explícita. Dentro del componente (onReset más abajo) sí usamos
// access.clinic?.timezone real.
function primerDiaDelMes(timeZone?: string): string {
  const hoy = hoyISO(timeZone);
  return `${hoy.slice(0, 7)}-01`;
}

export const Route = createFileRoute("/_authenticated/_clinic/comisiones")({
  validateSearch: (search: Record<string, unknown>): ComisionesSearch => ({
    desde: str(search.desde, primerDiaDelMes()),
    hasta: str(search.hasta, hoyISO()),
  }),
  // ux-3 auditoría 360 v2: finance:view ve a todo el equipo; commission:view-own
  // deja pasar a un dentist a ver SOLO su propia liquidación (el componente
  // decide qué renderiza según cuál de los dos permisos tiene el rol).
  beforeLoad: requireAnyPermission("finance:view", "commission:view-own"),
  head: () => ({
    meta: [
      { title: "Comisiones | Esmalia" },
      {
        name: "description",
        content:
          "Liquidación de comisiones por profesional según producción realizada en el período.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ComisionesPage,
});

function ComisionesPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const clinicId = access.clinic?.id;
  const currency = access.clinic?.currency ?? "CLP";

  // Ve todo el equipo (owner/admin/accounting) vs. solo su propia línea
  // (dentist con commission:view-own, sin finance:view).
  const veTodo = hasPermission(access.role, "finance:view");
  const puedeGestionar = access.role === "owner" || access.role === "admin";
  const soloMiProfessionalId = !veTodo ? (access.myProfessionalId ?? undefined) : undefined;

  const [confirmarCierre, setConfirmarCierre] = useState(false);

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  const fetchReport = useServerFn(getCommissionReport);
  const closePeriod = useServerFn(closeCommissionPeriod);
  const markPaid = useServerFn(markCommissionSettlementPaid);

  // veTodo entra en la key: sin esto, un dentist sin professionalId resuelto
  // (soloMiProfessionalId undefined, igual que el caso "veo todo") reusaría
  // el cache de la vista completa y vería momentáneamente las líneas de sus
  // colegas hasta el próximo refetch.
  const queryKey = [
    "commission-report",
    clinicId,
    search.desde,
    search.hasta,
    veTodo,
    soloMiProfessionalId ?? null,
  ];

  const {
    data: lineas,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey,
    enabled: Boolean(clinicId) && !bloqueado && (veTodo || Boolean(soloMiProfessionalId)),
    queryFn: () =>
      fetchReport({
        data: {
          clinicId: clinicId!,
          from: search.desde,
          to: search.hasta,
          professionalId: soloMiProfessionalId,
        },
      }),
  });

  const cerrarPeriodo = useMutation({
    mutationFn: () =>
      closePeriod({ data: { clinicId: clinicId!, from: search.desde, to: search.hasta } }),
    onSuccess: (res) => {
      toast.success(
        res.closed > 0
          ? `Período cerrado para ${res.closed} profesional${res.closed === 1 ? "" : "es"}.`
          : "No había nada nuevo para cerrar en este período.",
      );
      setConfirmarCierre(false);
      queryClient.invalidateQueries({ queryKey: ["commission-report"] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const marcarPagado = useMutation({
    mutationFn: (settlementId: string) => markPaid({ data: { clinicId: clinicId!, settlementId } }),
    onSuccess: () => {
      toast.success("Liquidación marcada como pagada.");
      queryClient.invalidateQueries({ queryKey: ["commission-report"] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const set = (patch: Partial<ComisionesSearch>) =>
    navigate({ search: (prev: ComisionesSearch) => ({ ...prev, ...patch }) });

  const totalComision = (lineas ?? []).reduce((acc, l) => acc + (l.commissionCents ?? 0), 0);
  const totalProduccion = (lineas ?? []).reduce((acc, l) => acc + l.productionCents, 0);
  const sinRegla = (lineas ?? []).filter((l) => l.commissionCents === null).length;

  return (
    <AppShell title="Comisiones" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Comisiones" sub={sub ?? null} />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">
                {veTodo ? "Liquidación de comisiones" : "Mi comisión"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {veTodo
                  ? "Según los procedimientos completados en el período. La comisión se calcula con la regla vigente de cada profesional (se edita en Profesionales)."
                  : "Tu comisión según los procedimientos completados en el período, con la regla vigente configurada por la clínica."}
              </p>
            </div>

            {veTodo && puedeGestionar && (
              <Button
                variant="outline"
                onClick={() => setConfirmarCierre(true)}
                disabled={!clinicId || isLoading || (lineas ?? []).length === 0}
              >
                <Lock className="size-3.5" />
                Cerrar período
              </Button>
            )}
          </div>

          <FilterBar
            activos={0}
            onReset={() =>
              set({
                desde: primerDiaDelMes(access.clinic?.timezone),
                hasta: hoyISO(access.clinic?.timezone),
              })
            }
          >
            <DateField label="Desde" value={search.desde} onChange={(desde) => set({ desde })} />
            <DateField label="Hasta" value={search.hasta} onChange={(hasta) => set({ hasta })} />
          </FilterBar>

          {isLoading && (
            <p className="px-1 py-10 text-center text-sm text-muted-foreground">Cargando…</p>
          )}

          {isError && (
            <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar las comisiones." />
          )}

          {!isLoading && !veTodo && !soloMiProfessionalId && (
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-xs text-warning">
              Todavía no hay una ficha de profesional vinculada a tu cuenta en esta clínica — no
              podemos mostrarte tu comisión. Pide a un administrador que revise tu perfil en
              Profesionales.
            </p>
          )}

          {!isLoading && lineas && (
            <>
              <section className="grid gap-4 sm:grid-cols-2">
                <div className="card-clinical p-5">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Percent className="size-3.5" />{" "}
                    {veTodo ? "Comisión total del período" : "Mi comisión del período"}
                  </p>
                  <p className="font-display text-2xl font-semibold">
                    {formatMoney(totalComision, currency)}
                  </p>
                </div>
                <div className="card-clinical p-5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Producción {veTodo ? "total" : "mía"}
                  </p>
                  <p className="font-display text-2xl font-semibold">
                    {formatMoney(totalProduccion, currency)}
                  </p>
                </div>
              </section>

              {veTodo && sinRegla > 0 && (
                <p className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-xs text-warning">
                  {sinRegla} profesional{sinRegla === 1 ? "" : "es"} sin regla de comisión
                  configurada — no se les calcula nada. Configura la regla en Profesionales.
                </p>
              )}

              <div className="card-clinical overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Profesional</TableHead>
                      <TableHead>Regla</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Procedimientos</TableHead>
                      <TableHead className="text-right">Producción</TableHead>
                      <TableHead className="text-right">Comisión</TableHead>
                      {veTodo && puedeGestionar && (
                        <TableHead className="text-right">Acciones</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineas.map((l) => (
                      <TableRow key={l.professionalId}>
                        <TableCell className="font-medium">{l.professionalName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {l.ruleLabel}
                        </TableCell>
                        <TableCell>
                          {l.closed ? (
                            <div className="flex flex-wrap gap-1.5">
                              <Badge variant="secondary">Cerrado</Badge>
                              {l.paidAt && <Badge variant="default">Pagado</Badge>}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Abierto</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right cifra">{l.procedureCount}</TableCell>
                        <TableCell className="text-right cifra">
                          {formatMoney(l.productionCents, currency)}
                        </TableCell>
                        <TableCell className="text-right font-semibold cifra">
                          {l.commissionCents === null
                            ? "—"
                            : formatMoney(l.commissionCents, currency)}
                        </TableCell>
                        {veTodo && puedeGestionar && (
                          <TableCell className="text-right">
                            {l.closed && !l.paidAt && l.settlementId && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={marcarPagado.isPending}
                                onClick={() => marcarPagado.mutate(l.settlementId!)}
                              >
                                {marcarPagado.isPending && (
                                  <Loader2 className="size-3.5 animate-spin" />
                                )}
                                Marcar pagado
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {lineas.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={veTodo && puedeGestionar ? 7 : 6}
                          className="py-10 text-center text-sm text-muted-foreground"
                        >
                          {veTodo
                            ? "No hay profesionales cargados."
                            : "No hay producción registrada a tu nombre en este período."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      )}

      <AlertDialog open={confirmarCierre} onOpenChange={setConfirmarCierre}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrar período de comisiones</AlertDialogTitle>
            <AlertDialogDescription>
              Esto congela los montos actuales de {search.desde} a {search.hasta} para todos los
              profesionales con producción o regla configurada. Una vez cerrado, editar la regla de
              comisión de un profesional ya NO afecta lo liquidado en este rango — solo se puede
              revertir con una migración correctiva manual. ¿Confirmas el cierre?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cerrarPeriodo.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={cerrarPeriodo.isPending}
              onClick={(e) => {
                e.preventDefault();
                cerrarPeriodo.mutate();
              }}
            >
              {cerrarPeriodo.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Cerrar período
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
