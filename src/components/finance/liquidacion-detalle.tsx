/**
 * Detalle de una liquidación (Ola 10 · COM-04 y COM-05): tramos de regla y
 * líneas (fecha, concepto, monto, comisión). Sirve para la foto congelada de
 * una liquidación cerrada y para la estimación en vivo de Mi desempeño.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LineaLiquidacion, TramoLiquidacion } from "@/lib/finance/comisiones-vigencia";
import { getCommissionSettlement } from "@/lib/finance/commissions.functions";
import { formatMoney } from "@/lib/finance/finance";
import { fecha } from "@/lib/formato-fecha";

export function TramosYLineas({
  tramos,
  lineas,
  currency,
  maxLineas = 200,
}: {
  tramos: TramoLiquidacion[];
  lineas: LineaLiquidacion[];
  currency: string;
  maxLineas?: number;
}) {
  const dinero = (c: number) => formatMoney(c, currency);
  return (
    <div className="space-y-4">
      {tramos.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground">Reglas del período</h3>
          <ul className="mt-1.5 divide-y divide-hairline border-y border-hairline text-sm">
            {tramos.map((t) => (
              <li key={`${t.versionId}-${t.desde}`} className="flex justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block font-medium">{t.regla}</span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    {fecha(t.desde)} al {fecha(t.hasta)} · base {dinero(t.baseCents)}
                  </span>
                </span>
                <span className="cifra shrink-0 font-medium">{dinero(t.comisionCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground">
          Detalle ({lineas.length} {lineas.length === 1 ? "línea" : "líneas"})
        </h3>
        {lineas.length === 0 ? (
          <p className="mt-1.5 text-sm text-muted-foreground">
            Nada entra al cálculo en este período.
          </p>
        ) : (
          <ul className="mt-1.5 max-h-80 divide-y divide-hairline overflow-y-auto border-y border-hairline text-sm">
            {lineas.slice(0, maxLineas).map((l) => (
              <li key={`${l.origen}-${l.id}`} className="flex justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block">{l.concepto}</span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    {fecha(l.fecha)} · {l.origen === "realizado" ? "realizado" : "cobrado"}{" "}
                    {dinero(l.cents)}
                  </span>
                </span>
                <span className="cifra shrink-0">{dinero(l.comisionCents)}</span>
              </li>
            ))}
            {lineas.length > maxLineas && (
              <li className="py-2 text-[12.5px] text-muted-foreground">
                Y {lineas.length - maxLineas} líneas más.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Diálogo con la foto congelada de una liquidación cerrada. */
export function LiquidacionCerradaDialog({
  clinicId,
  settlementId,
  currency: monedaClinica,
  onCerrar,
}: {
  clinicId: string;
  settlementId: string | null;
  /** Moneda de la clínica (la de la foto manda si la trae). */
  currency: string;
  onCerrar: () => void;
}) {
  const fetchLiq = useServerFn(getCommissionSettlement);
  const { data, isLoading } = useQuery({
    queryKey: ["commission-settlement", clinicId, settlementId],
    queryFn: () => fetchLiq({ data: { clinicId, settlementId: settlementId! } }),
    enabled: Boolean(settlementId),
  });
  const currency = data?.detalle?.currency ?? monedaClinica;
  return (
    <Dialog open={Boolean(settlementId)} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Liquidación cerrada</DialogTitle>
          {data && (
            <DialogDescription>
              {fecha(data.desde)} al {fecha(data.hasta)} · {data.regla}. Comisión{" "}
              {formatMoney(data.commissionCents, currency)}
              {data.paidAt ? `, pagada el ${fecha(data.paidAt)}` : ", por pagar"}. Es una foto
              guardada al cerrar: no cambia aunque cambie la regla.
            </DialogDescription>
          )}
        </DialogHeader>
        {isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">Cargando la liquidación…</p>
        ) : !data ? (
          <p className="py-4 text-sm text-muted-foreground">No encontramos esa liquidación.</p>
        ) : data.detalle ? (
          <TramosYLineas
            tramos={data.detalle.tramos}
            lineas={data.detalle.lineas}
            currency={data.detalle.currency}
          />
        ) : (
          <p className="py-2 text-sm text-muted-foreground">
            Esta liquidación se cerró antes de que se guardara el detalle línea por línea: tiene{" "}
            {data.procedureCount} prestaciones y {formatMoney(data.productionCents, currency)} de
            producción.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
