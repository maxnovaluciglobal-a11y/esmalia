import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/lib/access/route-guards";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import { formatoFecha } from "@/lib/clinic-operations/clinic-data";
import { AGING_BUCKET_LABELS, formatMoney, type AgingBucket } from "@/lib/finance/finance";
import { getAccountsReceivableAging } from "@/lib/finance/finance-reports.functions";

export const Route = createFileRoute("/_authenticated/_clinic/morosidad")({
  beforeLoad: requirePermission("finance:view"),
  head: () => ({
    meta: [
      { title: "Morosidad | Esmalia" },
      {
        name: "description",
        content: "Cartera pendiente de cobro, agrupada por antigüedad de la deuda.",
      },
    ],
  }),
  component: MorosidadPage,
});

const BUCKET_TONE: Record<AgingBucket, string> = {
  "0-30": "bg-muted text-muted-foreground",
  "31-60": "bg-warning-soft text-warning",
  "61-90": "bg-destructive-soft text-destructive",
  "90+": "bg-destructive text-destructive-foreground",
  sin_fecha: "bg-muted text-muted-foreground",
};

function MorosidadPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  const fetchAging = useServerFn(getAccountsReceivableAging);
  const {
    data: filas,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["accounts-receivable-aging", clinicId],
    queryFn: () => fetchAging({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId) && !bloqueado,
  });

  if (!clinicId) return null;

  const currency = filas?.[0]?.currency ?? access.clinic?.currency ?? "CLP";
  const totalCents = (filas ?? []).reduce((s, f) => s + f.balanceCents, 0);

  return (
    <AppShell title="Morosidad" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Morosidad" sub={sub ?? null} />
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="font-display text-xl font-semibold">Morosidad</h2>
            <p className="text-sm text-muted-foreground">
              Quién debe, cuánto y desde cuándo. Ordenado por lo más antiguo primero — es lo que
              conviene llamar hoy.
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando cartera pendiente…
            </div>
          ) : isError ? (
            // Antes un error se leía como "todos están al día".
            <ErrorDeCarga
              onReintentar={refetch}
              mensaje="No pudimos calcular la cartera pendiente."
            />
          ) : (filas ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin cartera pendiente — todos los pacientes con tratamiento están al día.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">
                Total pendiente: {formatMoney(totalCents, currency)} en {filas!.length} paciente
                {filas!.length === 1 ? "" : "s"}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Saldo</TableHead>
                    <TableHead>Antigüedad</TableHead>
                    <TableHead>Referencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas!.map((f) => (
                    <TableRow key={f.patientId}>
                      <TableCell className="font-medium">{f.patientName}</TableCell>
                      <TableCell className="cifra">
                        {formatMoney(f.balanceCents, f.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge className={BUCKET_TONE[f.bucket]} variant="secondary">
                          {AGING_BUCKET_LABELS[f.bucket]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {f.referenceDate ? formatoFecha(f.referenceDate) : "Sin dato"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
