import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ChipsDetalleOrden } from "@/components/laboratorio/detalle-orden";
import { Button } from "@/components/ui/button";
import { LAB_ORDER_STATUS_LABELS, type LabOrderStatus } from "@/lib/finance/finance";
import { fechaCorta } from "@/lib/formato-fecha";
import {
  getMyLabPortalOrders,
  updateLabOrderStatusFromPortal,
  type LabPortalOrder,
} from "@/lib/clinic-operations/lab-portal.functions";
import { diasEntre } from "@/lib/clinic-operations/operacion-resumen";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/portal-laboratorio/inicio")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: LabPortalInicio,
});

const SIGUIENTE_ESTADO: Partial<Record<LabOrderStatus, { next: LabOrderStatus; label: string }>> = {
  enviado: { next: "en_proceso", label: "Marcar en proceso" },
  en_proceso: { next: "recibido", label: "Marcar entregado" },
  reprocesar: { next: "en_proceso", label: "Marcar en proceso" },
};

/** Plazo de la orden: atraso calculado por la base con el hoy de la clínica. */
function Plazo({ orden, hoy }: { orden: LabPortalOrder; hoy: string | null }) {
  if (!orden.dueOn) return <span className="text-muted-foreground">Sin fecha comprometida</span>;
  if (orden.diasAtraso !== null) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-destructive">
        <TriangleAlert className="size-3.5" aria-hidden />
        Comprometido {fechaCorta(orden.dueOn)} · {orden.diasAtraso}{" "}
        {orden.diasAtraso === 1 ? "día" : "días"} tarde
      </span>
    );
  }
  const dias = hoy ? diasEntre(hoy, orden.dueOn) : null;
  return (
    <span className="inline-flex items-center gap-1">
      <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
      Comprometido <span className="cifra">{fechaCorta(orden.dueOn)}</span>
      {dias !== null && dias >= 0 && dias <= 7 && (
        <span className="font-semibold text-warning">
          · {dias === 0 ? "vence hoy" : `en ${dias} ${dias === 1 ? "día" : "días"}`}
        </span>
      )}
    </span>
  );
}

function LabPortalInicio() {
  const queryClient = useQueryClient();
  const fetchOrders = useServerFn(getMyLabPortalOrders);
  const updateFn = useServerFn(updateLabOrderStatusFromPortal);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["lab-portal-orders"],
    queryFn: () => fetchOrders({}),
  });

  const avanzar = useMutation({
    mutationFn: (v: { orderId: string; status: LabOrderStatus }) => updateFn({ data: v }),
    onSuccess: () => {
      toast.success("Estado actualizado.");
      queryClient.invalidateQueries({ queryKey: ["lab-portal-orders"] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (isLoading) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-2xl items-center justify-center p-6">
        <Loader2 className="size-6 animate-spin text-brand" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium">Tu sesión venció.</p>
        <p className="text-xs text-muted-foreground">Pide a la clínica un enlace nuevo.</p>
      </div>
    );
  }

  const pendientes = data.orders
    .filter((o) => o.status !== "recibido" && o.status !== "cancelado")
    // Lo atrasado primero, después por fecha comprometida (sin fecha al final).
    .sort(
      (a, b) =>
        (b.diasAtraso ?? -1) - (a.diasAtraso ?? -1) ||
        (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"),
    );
  const entregadas = data.orders.filter((o) => o.status === "recibido" || o.status === "cancelado");
  const atrasadas = pendientes.filter((o) => o.diasAtraso !== null).length;

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-6 text-base sm:px-6">
      <header>
        <p className="text-sm font-medium text-muted-foreground">
          <b className="font-semibold text-foreground/85">{data.labName}</b> · Órdenes de{" "}
          {data.clinicName}
        </p>
        <h1 className="mt-2 font-display text-[clamp(2rem,6vw,3rem)] font-medium leading-none tracking-[-0.02em]">
          {pendientes.length} {pendientes.length === 1 ? "trabajo" : "trabajos"}{" "}
          <em className="text-brand-600">
            {atrasadas > 0
              ? `${atrasadas} ${atrasadas === 1 ? "atrasado" : "atrasados"}`
              : "pendientes"}
          </em>
        </h1>
      </header>

      <section className="space-y-3" aria-labelledby="pendientes">
        <h2
          id="pendientes"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Pendientes ({pendientes.length})
        </h2>
        {pendientes.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin órdenes pendientes.</p>
        )}
        {pendientes.map((o) => {
          const accion = SIGUIENTE_ESTADO[o.status];
          return (
            <article
              key={o.id}
              className={cn(
                "rounded-[14px] border bg-card p-4",
                o.diasAtraso !== null ? "border-destructive-border" : "border-hairline",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{o.description}</p>
                  <p className="text-sm text-muted-foreground">
                    {o.patientName}
                    {o.toothNumbers?.length ? (
                      <>
                        {" · Piezas "}
                        <span className="cifra">{o.toothNumbers.join(", ")}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold">
                  {LAB_ORDER_STATUS_LABELS[o.status]}
                </span>
              </div>
              <ChipsDetalleOrden detalle={o} catalogName={o.catalogName} className="mt-2.5" />
              <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                <span className="text-muted-foreground">
                  Enviado <span className="cifra">{fechaCorta(o.sentOn)}</span>
                </span>
                <Plazo orden={o} hoy={data.hoy} />
              </p>
              {o.notes && <p className="mt-2 text-sm text-foreground/80">{o.notes}</p>}
              {accion && (
                <Button
                  className="mt-3"
                  size="sm"
                  disabled={avanzar.isPending}
                  onClick={() => avanzar.mutate({ orderId: o.id, status: accion.next })}
                >
                  {avanzar.isPending && <Loader2 className="mr-2 size-3.5 animate-spin" />}
                  {accion.label}
                </Button>
              )}
            </article>
          );
        })}
      </section>

      {entregadas.length > 0 && (
        <section className="space-y-3" aria-labelledby="historial">
          <h2
            id="historial"
            className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Historial
          </h2>
          {entregadas.map((o) => (
            <div key={o.id} className="rounded-[14px] border border-hairline p-4 opacity-75">
              <p className="font-medium">{o.description}</p>
              <p className="text-sm text-muted-foreground">
                {o.patientName} · {LAB_ORDER_STATUS_LABELS[o.status]}
                {o.receivedOn ? ` el ${fechaCorta(o.receivedOn)}` : ""}
              </p>
              <ChipsDetalleOrden detalle={o} catalogName={o.catalogName} className="mt-2" />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
