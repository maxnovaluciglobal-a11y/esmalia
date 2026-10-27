import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCheck, Eye, Lock } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { FiltroCompacto } from "@/components/a-plus/lista";
import { ErrorDeCarga } from "@/components/estado-error";
import { LiquidacionCerradaDialog, TramosYLineas } from "@/components/finance/liquidacion-detalle";
import {
  DatosEnTinta,
  Destacado,
  EncabezadoEditorial,
  EtiquetaTinta,
  MontoEnTinta,
  PANEL,
  Pastilla,
  SelectorPeriodo,
  SinDatos,
  TINTA,
  TITULO_PANEL,
  TintaCargando,
} from "@/components/reportes/aplus";
import { Button } from "@/components/ui/button";
import { requireAnyPermission } from "@/lib/access/route-guards";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { BASE_COMISION_LABELS } from "@/lib/finance/comisiones-vigencia";
import { getMiDesempeno } from "@/lib/finance/commissions.functions";
import { formatMoney } from "@/lib/finance/finance";
import { nombreDelPeriodo } from "@/lib/finance/periodos-reporte";
import { fecha, numero } from "@/lib/formato-fecha";
import { str } from "@/lib/search";
import { cn } from "@/lib/utils";

interface MiDesempenoSearch {
  desde: string;
  hasta: string;
  profesional?: string;
}

export const Route = createFileRoute("/_authenticated/_clinic/mi-desempeno")({
  validateSearch: (search: Record<string, unknown>): MiDesempenoSearch => ({
    desde: str(search.desde, `${hoyISO().slice(0, 7)}-01`),
    hasta: str(search.hasta, hoyISO()),
    profesional: typeof search.profesional === "string" ? search.profesional : undefined,
  }),
  // COM-05: el profesional ve solo lo suyo (commission:view-own); quien ve
  // finanzas puede elegir a cualquiera. El par en el servidor es
  // `getMiDesempeno`, que ignora el profesional pedido sin commission:view-all.
  beforeLoad: requireAnyPermission("commission:view-own", "commission:view-all"),
  head: () => ({
    meta: [{ title: "Mi desempeño | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: MiDesempenoPage,
});

function MiDesempenoPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const clinicId = access.clinic?.id;
  const currency = access.clinic?.currency ?? "CLP";
  const hoy = hoyISO(access.clinic?.timezone);
  const [detalle, setDetalle] = useState<string | null>(null);

  const fetchDesempeno = useServerFn(getMiDesempeno);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["mi-desempeno", clinicId, search.desde, search.hasta, search.profesional ?? null],
    queryFn: () =>
      fetchDesempeno({
        data: {
          clinicId: clinicId!,
          from: search.desde,
          to: search.hasta,
          professionalId: search.profesional,
        },
      }),
    enabled: Boolean(clinicId),
  });

  const set = (patch: Partial<MiDesempenoSearch>) =>
    navigate({ search: (prev: MiDesempenoSearch) => ({ ...prev, ...patch }) });
  const dinero = (c: number) => formatMoney(c, currency);
  const periodo = nombreDelPeriodo(search.desde, search.hasta, hoy);
  const liq = data?.liquidacion ?? null;
  const propio = data?.profesional && !data.veTodo;
  const titulo = data?.veTodo && data.profesional ? data.profesional.nombre : "Mi desempeño";

  return (
    <AppShell title="Mi desempeño" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-[18px]">
        <div className="space-y-4 pb-2">
          <EncabezadoEditorial
            seccion="Reportes"
            pagina="Mi desempeño"
            titulo={
              <>
                {titulo} de <Destacado>{periodo}</Destacado>
              </>
            }
            conclusion={
              liq && liq.commissionCents !== null ? (
                <>
                  <b className="font-semibold text-foreground">
                    Comisión estimada: {dinero(liq.commissionCents)}
                  </b>{" "}
                  con {dinero(liq.productionCents)} realizados y {dinero(liq.cobradoCents)}{" "}
                  cobrados.
                </>
              ) : liq ? (
                "Todavía no hay una regla de comisión para este período."
              ) : undefined
            }
            acciones={
              data?.veTodo && data.profesionales.length > 0 ? (
                <FiltroCompacto
                  etiqueta="Profesional"
                  valor={search.profesional ?? data.profesional?.id ?? ""}
                  onChange={(v) => set({ profesional: v || undefined })}
                  todas="Elige un profesional"
                  opciones={data.profesionales.map((p) => ({ value: p.id, label: p.nombre }))}
                />
              ) : undefined
            }
          />
          <SelectorPeriodo
            desde={search.desde}
            hasta={search.hasta}
            hoy={hoy}
            onCambiar={(r) => set(r)}
          />
        </div>

        {isError && (
          <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar tu desempeño." />
        )}
        {isLoading && <TintaCargando texto="Calculando tu desempeño…" />}

        {data && !data.profesional && (
          <p className="rounded-[14px] border border-dashed border-warning-border bg-warning-soft px-5 py-4 text-sm text-foreground/85">
            Todavía no hay una ficha de profesional vinculada a tu cuenta en esta clínica, así que
            no podemos mostrarte tu desempeño. Pide a un administrador que revise tu perfil en
            Profesionales.
          </p>
        )}

        {data?.profesional && liq && (
          <>
            <section
              aria-label="Resumen del período"
              className={cn(TINTA, "grid gap-7 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]")}
            >
              <div className="min-w-0">
                <EtiquetaTinta>
                  {propio ? "Mi comisión estimada" : "Comisión estimada"}
                </EtiquetaTinta>
                <MontoEnTinta cents={liq.commissionCents ?? 0} currency={currency} />
                <p className="mt-3.5 text-sm font-medium text-on-night-2">
                  {liq.vigente
                    ? `Regla vigente: ${liq.tramos.at(-1)?.regla ?? "sin comisión"}`
                    : "Sin regla de comisión configurada"}
                </p>
                <div className="mt-6">
                  <DatosEnTinta
                    columnas={3}
                    datos={[
                      {
                        label: "Producción",
                        valor: dinero(liq.productionCents),
                        nota: "prestaciones completadas",
                      },
                      { label: "Cobrado", valor: dinero(liq.cobradoCents), nota: "atribuido a ti" },
                      {
                        label: "Prestaciones",
                        valor: numero(liq.procedureCount),
                        nota: "realizadas",
                      },
                    ]}
                  />
                </div>
              </div>
              <div className="min-w-0 text-sm text-on-night-2">
                <EtiquetaTinta>Cómo se calcula</EtiquetaTinta>
                <ul className="mt-3 space-y-2">
                  {liq.tramos.length === 0 ? (
                    <li>Sin regla en este período: no se calcula comisión.</li>
                  ) : (
                    liq.tramos.map((t) => (
                      <li key={`${t.versionId}-${t.desde}`} className="text-on-night">
                        {t.regla}
                        <span className="block text-[12.5px] text-on-night-2">
                          {fecha(t.desde)} al {fecha(t.hasta)} ·{" "}
                          {t.kind === "percent"
                            ? `base ${dinero(t.baseCents)} (${BASE_COMISION_LABELS[t.base]})`
                            : t.kind === "fixed"
                              ? "monto fijo por prestación realizada"
                              : "sin comisión"}{" "}
                          · {dinero(t.comisionCents)}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
                <p className="mt-4 text-[12.5px]">
                  Es una estimación: el monto final es el de la liquidación que cierra la clínica.
                </p>
              </div>
            </section>

            <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
              <section aria-labelledby="md-detalle" className={cn(PANEL, "p-5")}>
                <h2 id="md-detalle" className={TITULO_PANEL}>
                  Detalle del <Destacado>período</Destacado>
                </h2>
                <div className="mt-4">
                  <TramosYLineas tramos={[]} lineas={liq.lineas} currency={currency} />
                </div>
                {data.sinAtribuirCents !== null && data.sinAtribuirCents > 0 && (
                  <p className="mt-3 text-[12.5px] text-muted-foreground">
                    En la clínica hay {dinero(data.sinAtribuirCents)} cobrados en el período sin
                    prestación ni plan: no se atribuyen a ningún profesional.
                  </p>
                )}
              </section>

              <section aria-labelledby="md-liquidaciones" className={cn(PANEL, "overflow-hidden")}>
                <div className="px-5 pt-[18px] pb-3">
                  <h2 id="md-liquidaciones" className={TITULO_PANEL}>
                    {propio ? "Mis " : ""}
                    <Destacado>liquidaciones</Destacado>
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Períodos cerrados por la clínica. Cada uno queda congelado al cerrar.
                  </p>
                </div>
                {data.liquidaciones.length === 0 ? (
                  <SinDatos
                    className="border-t border-hairline"
                    titulo="Todavía no hay liquidaciones cerradas."
                  />
                ) : (
                  <ul className="divide-y divide-hairline border-t border-hairline">
                    {data.liquidaciones.map((s) => (
                      <li key={s.id} className="flex items-start justify-between gap-3 px-5 py-3">
                        <span className="min-w-0">
                          <span className="block font-medium">
                            {fecha(s.desde)} al {fecha(s.hasta)}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-2">
                            {s.paidAt ? (
                              <Pastilla tono="success" icono={CheckCheck}>
                                Pagada
                              </Pastilla>
                            ) : (
                              <Pastilla tono="info" icono={Lock}>
                                Por pagar
                              </Pastilla>
                            )}
                            <span className="text-[12.5px] text-muted-foreground">{s.regla}</span>
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className="cifra font-semibold">{dinero(s.commissionCents)}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-full"
                            onClick={() => setDetalle(s.id)}
                            aria-label={`Ver la liquidación del ${fecha(s.desde)} al ${fecha(s.hasta)}`}
                          >
                            <Eye aria-hidden /> Detalle
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {data.reglas.length > 0 && (
              <section aria-labelledby="md-reglas" className={cn(PANEL, "p-5")}>
                <h2 id="md-reglas" className={TITULO_PANEL}>
                  {propio ? "Mi " : ""}
                  <Destacado>regla</Destacado>
                </h2>
                <ul className="mt-3 divide-y divide-hairline border-y border-hairline text-sm">
                  {data.reglas.map((v) => (
                    <li key={v.id} className="flex justify-between gap-3 py-2.5">
                      <span>
                        {v.scope === "prestacion" ? `${v.procedureName ?? "Prestación"}: ` : ""}
                        {v.regla}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {v.effectiveFrom <= "2000-01-01"
                          ? "Regla inicial"
                          : `desde el ${fecha(v.effectiveFrom)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      {clinicId && (
        <LiquidacionCerradaDialog
          clinicId={clinicId}
          settlementId={detalle}
          currency={currency}
          onCerrar={() => setDetalle(null)}
        />
      )}
    </AppShell>
  );
}
