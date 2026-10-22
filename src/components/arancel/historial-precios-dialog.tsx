import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown } from "lucide-react";

import { ErrorDeCarga } from "@/components/estado-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listRealineaciones, type Realineacion } from "@/lib/arancel/arancel.functions";
import { formatMoney } from "@/lib/finance/finance";
import { fechaHora, numero } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

function regla(r: Realineacion): string {
  const redondeo = r.redondeoCents
    ? `, redondeado a ${formatMoney(r.redondeoCents, r.currency)}`
    : "";
  if (r.modo === "percent" && r.porcentaje !== null)
    return `${r.porcentaje > 0 ? "+" : ""}${numero(r.porcentaje, { maximumFractionDigits: 3 })} %${redondeo}`;
  if (r.montoCents !== null)
    return `${r.montoCents > 0 ? "+" : "-"}${formatMoney(Math.abs(r.montoCents), r.currency)} por prestación${redondeo}`;
  return "Sin detalle";
}

/** Historial de realineaciones de precios (ADM-04): quién, cuándo, qué regla y a qué. */
export function HistorialPreciosDialog({
  clinicId,
  zona,
  open,
  onOpenChange,
}: {
  clinicId: string;
  zona: string | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const fetchFn = useServerFn(listRealineaciones);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["realineaciones", clinicId],
    enabled: open,
    queryFn: () => fetchFn({ data: { clinicId } }),
  });
  const [abierta, setAbierta] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Historial de precios</DialogTitle>
          <DialogDescription>
            Las últimas realineaciones del arancel, con el precio de antes de cada prestación por si
            hay que volver atrás.
          </DialogDescription>
        </DialogHeader>

        {isPending && <p className="text-sm text-muted-foreground">Cargando historial…</p>}
        {isError && (
          <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar el historial." />
        )}
        {data && data.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Todavía no se realinearon precios en esta clínica.
          </p>
        )}
        {data && data.length > 0 && (
          <ul className="space-y-2">
            {data.map((r) => {
              const expandida = abierta === r.id;
              return (
                <li key={r.id} className="rounded-lg border border-hairline">
                  <button
                    type="button"
                    aria-expanded={expandida}
                    onClick={() => setAbierta(expandida ? null : r.id)}
                    className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {regla(r)} · {r.alcance}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {fechaHora(r.createdAt, zona)} · {r.autor ?? "Sin nombre"} · {r.cantidad}{" "}
                        {r.cantidad === 1 ? "prestación" : "prestaciones"}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "mt-0.5 size-4 shrink-0 transition-transform",
                        expandida && "rotate-180",
                      )}
                    />
                  </button>
                  {expandida && (
                    <ul className="divide-y divide-hairline border-t border-hairline text-xs">
                      {r.items.map((it) => (
                        <li
                          key={it.procedureId}
                          className="flex items-center justify-between gap-3 px-3 py-1.5"
                        >
                          <span className="min-w-0 truncate">{it.name}</span>
                          <span className="shrink-0 cifra">
                            <span className="text-muted-foreground">
                              {formatMoney(it.oldCents, r.currency)}
                            </span>{" "}
                            → {formatMoney(it.newCents, r.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
