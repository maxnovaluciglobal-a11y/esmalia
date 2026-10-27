/**
 * Vista del día por caja (Ola 10 · CAJ-05), solo owner/admin: una fila por
 * caja abierta o cerrada hoy, con apertura, efectivo, movimientos, esperado,
 * contado y diferencia con su motivo. Abajo, los cobros que no quedaron en
 * ninguna caja y los movimientos del día. Va debajo de la composición A+ de
 * la caja, antes del historial.
 */
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCheck, CircleDashed, TriangleAlert } from "lucide-react";

import {
  celda,
  Destacado,
  FILA,
  PANEL,
  Pastilla,
  SinDatos,
  TablaAPlus,
  TITULO_PANEL,
  type ColumnaTabla,
} from "@/components/reportes/aplus";
import { ErrorDeCarga } from "@/components/estado-error";
import { CASH_MOVEMENT_LABELS } from "@/lib/finance/cash-registers";
import { getCajasDelDia, type CajaDelDiaFila } from "@/lib/finance/cash-registers.functions";
import { formatMoney } from "@/lib/finance/finance";
import { hora } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

function EstadoCaja({ fila, currency }: { fila: CajaDelDiaFila; currency: string }) {
  if (fila.status === "open") {
    return (
      <Pastilla tono="info" icono={CircleDashed}>
        Abierta
      </Pastilla>
    );
  }
  const d = fila.diferenciaCents ?? 0;
  if (d === 0) {
    return (
      <Pastilla tono="success" icono={CheckCheck}>
        Cuadró
      </Pastilla>
    );
  }
  return (
    <Pastilla tono={d > 0 ? "warning" : "danger"} icono={TriangleAlert}>
      {d > 0 ? "Sobran" : "Faltan"} {formatMoney(Math.abs(d), currency)}
    </Pastilla>
  );
}

export function CajasDelDiaPanel({
  clinicId,
  clinicTz,
}: {
  clinicId: string;
  clinicTz: string | undefined;
}) {
  const uid = useId();
  const fetchCajas = useServerFn(getCajasDelDia);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["cajas-del-dia", clinicId],
    queryFn: () => fetchCajas({ data: { clinicId } }),
  });

  const columnas: ColumnaTabla[] = [
    { label: "Caja" },
    { label: "Estado" },
    { label: "Apertura", derecha: true, className: "hidden lg:table-cell" },
    { label: "Efectivo", derecha: true, className: "hidden md:table-cell" },
    { label: "Movimientos", derecha: true, className: "hidden lg:table-cell" },
    { label: "Esperado", derecha: true },
    { label: "Contado", derecha: true, className: "hidden sm:table-cell" },
  ];
  const n = columnas.length;
  const currency = data?.currency ?? "CLP";
  const dinero = (c: number) => formatMoney(c, currency);
  const abiertas = (data?.cajas ?? []).filter((c) => c.status === "open").length;

  return (
    <section aria-labelledby={`${uid}-titulo`} className={cn(PANEL, "overflow-hidden")}>
      <div className="px-5 pt-[18px] pb-3">
        <h2 id={`${uid}-titulo`} className={TITULO_PANEL}>
          Cajas del <Destacado>día</Destacado>
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {data
            ? `${data.cajas.length} ${data.cajas.length === 1 ? "caja" : "cajas"} hoy, ${abiertas} ${abiertas === 1 ? "abierta" : "abiertas"}. Cada persona cobra en su caja y la cierra con su arqueo.`
            : "Cada persona cobra en su caja y la cierra con su arqueo."}
        </p>
      </div>
      {isError ? (
        <div className="px-5 pb-5">
          <ErrorDeCarga
            mensaje="No pudimos cargar las cajas del día."
            onReintentar={() => void refetch()}
            reintentando={isFetching}
          />
        </div>
      ) : isLoading || !data ? (
        <p className="border-t border-hairline px-5 py-6 text-sm text-muted-foreground">
          Cargando las cajas del día…
        </p>
      ) : data.cajas.length === 0 ? (
        <SinDatos
          className="border-t border-hairline"
          titulo="Todavía nadie abrió caja hoy."
          detalle="Cada persona que cobra abre su caja al empezar el turno."
        />
      ) : (
        <TablaAPlus columnas={columnas}>
          {data.cajas.map((c) => {
            const neto = c.entradasCents - c.salidasCents;
            return (
              <tr key={c.id} className={FILA}>
                <td className={celda(0, n, "min-w-[9rem]")}>
                  <span className="font-medium">{c.nombre}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                    {hora(c.openedAt, clinicTz)}
                    {c.closedAt ? ` → ${hora(c.closedAt, clinicTz)}` : " · abierta"}
                    {c.otrosMediosCantidad > 0 &&
                      ` · ${dinero(c.otrosMediosCents)} en tarjeta o transferencia`}
                  </span>
                  {c.motivo && c.diferenciaCents !== 0 && (
                    <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                      Motivo: {c.motivo}
                    </span>
                  )}
                </td>
                <td className={celda(1, n)}>
                  <EstadoCaja fila={c} currency={currency} />
                </td>
                <td className={celda(2, n, "cifra hidden text-right lg:table-cell")}>
                  {dinero(c.aperturaCents)}
                </td>
                <td className={celda(3, n, "cifra hidden text-right md:table-cell")}>
                  {dinero(c.efectivoCents)}
                </td>
                <td className={celda(4, n, "cifra hidden text-right lg:table-cell")}>
                  {neto === 0 ? "—" : `${neto > 0 ? "+" : "−"}${dinero(Math.abs(neto))}`}
                </td>
                <td className={celda(5, n, "cifra text-right font-semibold whitespace-nowrap")}>
                  {dinero(c.esperadoCents)}
                </td>
                <td className={celda(6, n, "cifra hidden text-right sm:table-cell")}>
                  {c.contadoCents === null ? "—" : dinero(c.contadoCents)}
                </td>
              </tr>
            );
          })}
        </TablaAPlus>
      )}
      {data && (data.sinCaja.cantidad > 0 || data.movimientos.length > 0) && (
        <div className="space-y-3 border-t border-hairline px-5 py-4 text-sm">
          {data.sinCaja.cantidad > 0 && (
            <p className="rounded-[10px] border border-dashed border-warning-border bg-warning-soft px-3.5 py-2.5">
              <b className="font-semibold">
                {data.sinCaja.cantidad === 1
                  ? "Un cobro de hoy no quedó en ninguna caja"
                  : `${data.sinCaja.cantidad} cobros de hoy no quedaron en ninguna caja`}
              </b>{" "}
              ({dinero(data.sinCaja.cents)}, {dinero(data.sinCaja.efectivoCents)} en efectivo):
              quien cobró no tenía su caja abierta.
            </p>
          )}
          {data.movimientos.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground">Movimientos del día</h3>
              <ul className="mt-1.5 divide-y divide-hairline">
                {data.movimientos.map((m) => (
                  <li key={m.id} className="flex justify-between gap-3 py-2">
                    <span className="min-w-0">
                      {hora(m.createdAt, clinicTz)} · {CASH_MOVEMENT_LABELS[m.kind]}: {m.desde}
                      {m.hacia ? ` → ${m.hacia}` : ""}
                      <span className="block text-[12.5px] text-muted-foreground">{m.reason}</span>
                    </span>
                    <span className="cifra shrink-0">{dinero(m.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
