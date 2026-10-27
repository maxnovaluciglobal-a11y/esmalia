import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { BoletasDelPeriodo, VistaGeneralFinanzas } from "@/components/finanzas/vista-general";
import {
  BarraApilada,
  BarraFina,
  BarrasEnTinta,
  DatosEnTinta,
  Destacado,
  EncabezadoEditorial,
  EtiquetaTinta,
  MontoEnTinta,
  PANEL,
  SelectorPeriodo,
  SinDatos,
  TINTA,
  TITULO_PANEL,
  TintaCargando,
} from "@/components/reportes/aplus";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
import { buttonVariants } from "@/components/ui/button";
import { requirePermission } from "@/lib/access/route-guards";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { colorProfesional } from "@/lib/clinic-operations/color-profesional";
import { formatMoney, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/finance/finance";
import {
  getFinanceSummary,
  getQuoteConversionReport,
  type FinanceSummary,
} from "@/lib/finance/finance-reports.functions";
import { nombreDelPeriodo, serieDeCaja } from "@/lib/finance/periodos-reporte";
import { str } from "@/lib/search";
import { cn } from "@/lib/utils";
import { diaSemana, fechaCorta, numero } from "@/lib/formato-fecha";

interface FinanzasSearch {
  desde: string;
  hasta: string;
}

// validateSearch corre antes del componente (sin Route.useRouteContext(),
// mismo problema estructural que ya documenta agenda.tsx:HOY) — el default
// de estas dos fechas cae a la timezone de Chile mientras no haya un valor
// explícito en la URL. Impacto acotado: solo el rango por defecto del
// reporte, unas horas al día, y solo si la clínica no es de Chile — dentro
// del componente (los chips de período) sí usamos access.clinic?.timezone real.
function primerDiaDelMes(timeZone?: string): string {
  const hoy = hoyISO(timeZone);
  return `${hoy.slice(0, 7)}-01`;
}

export const Route = createFileRoute("/_authenticated/_clinic/finanzas")({
  validateSearch: (search: Record<string, unknown>): FinanzasSearch => ({
    desde: str(search.desde, primerDiaDelMes()),
    hasta: str(search.hasta, hoyISO()),
  }),
  beforeLoad: requirePermission("finance:view"),
  head: () => ({
    meta: [
      { title: "Finanzas | Esmalia" },
      {
        name: "description",
        content:
          "Ingresos, por cobrar, gastos y resultado del período, venta real, sucursales y folios de boletas.",
      },
      { property: "og:title", content: "Finanzas | Esmalia" },
      {
        property: "og:description",
        content: "Caja, métodos de pago y producción por profesional en un rango de fechas.",
      },
    ],
  }),
  component: FinanzasPage,
});

function plural(n: number, uno: string, varios: string) {
  return `${numero(n)} ${n === 1 ? uno : varios}`;
}

/** Conclusión del período en lenguaje simple: es lo que el dueño viene a saber. */
function conclusionDelPeriodo(r: FinanceSummary, currency: string) {
  if (r.paymentsCount === 0 && r.expensesCount === 0) {
    return <>No hubo cobros ni gastos cargados en este período.</>;
  }
  const dinero = (c: number) => formatMoney(c, currency);
  if (r.resultCents < 0) {
    return (
      <>
        <b className="font-semibold text-foreground">El período va en negativo.</b> Los gastos
        superan lo que entró por {dinero(Math.abs(r.resultCents))}.
      </>
    );
  }
  if (r.resultCents === 0) {
    return <b className="font-semibold text-foreground">El período cierra en cero.</b>;
  }
  return (
    <>
      <b className="font-semibold text-foreground">El período va en positivo.</b> Quedan{" "}
      {dinero(r.resultCents)} después de los gastos.
      {r.expensesCount === 0 &&
        " Sin gastos cargados, el resultado es igual a lo cobrado: carga arriendo, insumos y laboratorio para que refleje lo que de verdad queda."}
    </>
  );
}

function FinanzasPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const clinicId = access.clinic?.id;
  const clinicTz = access.clinic?.timezone;
  const hoy = hoyISO(clinicTz);

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  const fetchSummary = useServerFn(getFinanceSummary);
  const {
    data: resumen,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["finance-summary", clinicId, search.desde, search.hasta],
    enabled: Boolean(clinicId) && !bloqueado,
    queryFn: () =>
      fetchSummary({ data: { clinicId: clinicId!, desde: search.desde, hasta: search.hasta } }),
  });

  const fetchConversion = useServerFn(getQuoteConversionReport);
  const {
    data: conversion,
    isLoading: cargandoConversion,
    isError: conversionConError,
    isFetching: recargandoConversion,
    refetch: reintentarConversion,
  } = useQuery({
    queryKey: ["quote-conversion", clinicId, search.desde, search.hasta],
    enabled: Boolean(clinicId) && !bloqueado,
    queryFn: () =>
      fetchConversion({ data: { clinicId: clinicId!, desde: search.desde, hasta: search.hasta } }),
  });

  const set = (patch: Partial<FinanzasSearch>) =>
    navigate({ search: (prev: FinanzasSearch) => ({ ...prev, ...patch }) });

  const currency = resumen?.currency ?? access.clinic?.currency ?? "CLP";
  const periodo = nombreDelPeriodo(search.desde, search.hasta, hoy);

  return (
    <AppShell title="Finanzas" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Finanzas" sub={sub ?? null} />
      ) : (
        <div className="mx-auto max-w-[84rem] space-y-[18px]">
          <div className="space-y-4 pb-2">
            <EncabezadoEditorial
              seccion="Reportes"
              pagina="Finanzas"
              titulo={
                <>
                  Finanzas de <Destacado>{periodo}</Destacado>
                </>
              }
              conclusion={resumen ? conclusionDelPeriodo(resumen, currency) : undefined}
            />
            <SelectorPeriodo
              desde={search.desde}
              hasta={search.hasta}
              hoy={hoy}
              onCambiar={(r) => set(r)}
            />
          </div>

          {isError ? (
            <ErrorDeCarga
              mensaje="No pudimos cargar las finanzas de este período. Revisa la conexión."
              onReintentar={() => void refetch()}
              reintentando={isFetching}
            />
          ) : !resumen ? (
            <TintaCargando texto="Cargando las finanzas del período…" />
          ) : (
            <>
              <ResumenDelPeriodo
                resumen={resumen}
                currency={currency}
                desde={search.desde}
                hasta={search.hasta}
              />

              {clinicId && (
                <VistaGeneralFinanzas
                  clinicId={clinicId}
                  desde={search.desde}
                  hasta={search.hasta}
                  currency={currency}
                  timezone={clinicTz ?? "America/Santiago"}
                  rol={access.role}
                />
              )}

              <div className="grid items-start gap-[18px] lg:grid-cols-2">
                <ProduccionPorProfesional resumen={resumen} currency={currency} />
                <GastosPorCategoria
                  resumen={resumen}
                  currency={currency}
                  desde={search.desde}
                  hasta={search.hasta}
                />
              </div>

              <section aria-labelledby="fin-conversion" className={cn(PANEL, "p-5")}>
                <h2 id="fin-conversion" className={TITULO_PANEL}>
                  Conversión de <Destacado>presupuestos</Destacado>
                </h2>
                {conversionConError ? (
                  <ErrorDeCarga
                    className="mt-4"
                    mensaje="No pudimos cargar la conversión de presupuestos."
                    onReintentar={() => void reintentarConversion()}
                    reintentando={recargandoConversion}
                  />
                ) : cargandoConversion ? (
                  <p className="mt-3 text-sm text-muted-foreground">Cargando presupuestos…</p>
                ) : !conversion || conversion.created === 0 ? (
                  <SinDatos
                    className="px-0 pb-0"
                    titulo="No se crearon presupuestos en este rango."
                    detalle="Los presupuestos se arman desde la ficha del paciente; acá vas a ver cuántos se aceptan."
                  />
                ) : (
                  <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:items-start">
                    <div>
                      <p className="whitespace-nowrap font-display text-[56px] font-medium leading-none tracking-[-0.03em] [font-variant-numeric:lining-nums]">
                        {conversion.conversionRate === null ? "—" : conversion.conversionRate}
                        {conversion.conversionRate !== null && (
                          <span className="text-brand-600">%</span>
                        )}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {conversion.conversionRate === null
                          ? "Ninguno resuelto todavía."
                          : "de los aceptados o rechazados se aceptó."}
                      </p>
                      <p className="mt-3 text-sm text-muted-foreground">
                        {plural(conversion.created, "presupuesto creado", "presupuestos creados")}{" "}
                        por{" "}
                        <span className="cifra text-foreground">
                          {formatMoney(conversion.createdTotalCents, currency)}
                        </span>
                        .
                      </p>
                    </div>
                    <div className="min-w-0">
                      <BarraApilada
                        sobre="papel"
                        sinPorcentaje
                        partes={[
                          {
                            clave: "aceptados",
                            etiqueta: `Aceptados · ${formatMoney(conversion.acceptedTotalCents, currency)}`,
                            valor: conversion.accepted,
                            texto: String(conversion.accepted),
                            color: "var(--color-success)",
                          },
                          {
                            clave: "pendientes",
                            etiqueta: "Pendientes · esperan respuesta",
                            valor: conversion.pending,
                            texto: String(conversion.pending),
                            color: "var(--color-warning-border)",
                          },
                          {
                            clave: "rechazados",
                            etiqueta: "Rechazados · vale preguntar por qué",
                            valor: conversion.rejected,
                            texto: String(conversion.rejected),
                            color: "var(--color-destructive)",
                          },
                        ]}
                      />
                    </div>
                  </div>
                )}
              </section>

              {clinicId && (
                <BoletasDelPeriodo
                  clinicId={clinicId}
                  desde={search.desde}
                  hasta={search.hasta}
                  currency={currency}
                  timezone={clinicTz ?? "America/Santiago"}
                  rol={access.role}
                />
              )}
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}

function ResumenDelPeriodo({
  resumen,
  currency,
  desde,
  hasta,
}: {
  resumen: FinanceSummary;
  currency: string;
  desde: string;
  hasta: string;
}) {
  const { porSemana, puntos } = serieDeCaja(resumen.byDay, desde, hasta);
  const mejor = puntos.reduce((m, p) => (p.totalCents > m.totalCents ? p : m), {
    date: "",
    totalCents: 0,
  });
  const sinPagos = resumen.paymentsCount === 0;
  const dinero = (c: number) => formatMoney(c, currency);

  return (
    <section
      aria-label="Resumen del período"
      className={cn(TINTA, "grid gap-7 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]")}
    >
      <div className="min-w-0">
        <EtiquetaTinta>Cobrado en el período</EtiquetaTinta>
        <MontoEnTinta cents={resumen.totalCents} currency={currency} />
        <p className="mt-3.5 text-sm font-medium text-on-night-2">
          {sinPagos ? (
            "Todavía no hay pagos en este período."
          ) : (
            <>
              <b className="font-semibold text-on-night">
                {plural(resumen.paymentsCount, "pago", "pagos")}
              </b>
              {resumen.retentionCents !== null && resumen.retentionCents > 0 && (
                <>
                  {" · entra "}
                  <b className="font-semibold text-on-night">{dinero(resumen.netCents ?? 0)}</b>
                  {`, retienen ${dinero(resumen.retentionCents)}`}
                </>
              )}
              {mejor.totalCents > 0 && (
                <>
                  {` · mejor ${porSemana ? "semana" : "día"} `}
                  <b className="font-semibold text-on-night">{dinero(mejor.totalCents)}</b>
                </>
              )}
            </>
          )}
        </p>
        {puntos.length > 0 && (
          <BarrasEnTinta
            titulo={porSemana ? "Caja por semana" : "Caja por día"}
            puntos={puntos.map((p) => ({
              clave: p.date,
              etiqueta: porSemana ? fechaCorta(p.date) : String(Number(p.date.slice(8))),
              valor: p.totalCents,
              descripcion: `${porSemana ? `Semana del ${fechaCorta(p.date)}` : diaSemana(p.date)}: ${
                p.totalCents > 0 ? dinero(p.totalCents) : "sin cobros"
              }`,
            }))}
          />
        )}
        <p className="mt-2 text-xs text-on-night-2">
          {porSemana ? "Caja por semana, de lunes a domingo." : "Caja por día."}
        </p>
      </div>

      <div className="flex min-w-0 flex-col">
        <EtiquetaTinta>Por método de pago</EtiquetaTinta>
        <BarraApilada
          sobre="tinta"
          vacio="Sin pagos en este período."
          partes={resumen.byMethod.map((m) => ({
            clave: m.method,
            etiqueta: `${PAYMENT_METHOD_LABELS[m.method as PaymentMethod] ?? m.method} · ${m.count}`,
            valor: m.totalCents,
            texto: dinero(m.totalCents),
          }))}
        />
        <div className="mt-auto pt-5">
          <DatosEnTinta
            columnas={3}
            datos={[
              {
                label: "Gastos",
                valor: dinero(resumen.expensesCents),
                nota:
                  resumen.expensesCount === 0
                    ? "sin gastos cargados"
                    : plural(resumen.expensesCount, "gasto", "gastos"),
              },
              {
                label: "Resultado",
                // formatMoney ya pone el signo adelante: "-$120.000".
                valor: dinero(resumen.resultCents),
                nota:
                  resumen.resultCents < 0
                    ? "en negativo"
                    : resumen.retentionCents === null
                      ? "sin retenciones"
                      : "neto, menos gastos",
              },
              {
                label: "Ticket promedio",
                // Regla 11: sin pagos no hay ticket promedio, no un $0 fabricado.
                valor: sinPagos ? "Sin datos" : dinero(resumen.averageTicketCents),
                nota: sinPagos ? "sin pagos" : "por pago",
              },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function ProduccionPorProfesional({
  resumen,
  currency,
}: {
  resumen: FinanceSummary;
  currency: string;
}) {
  const max = Math.max(0, ...resumen.byProfessional.map((p) => p.totalCents));
  return (
    <section aria-labelledby="fin-produccion" className={cn(PANEL, "p-5")}>
      <h2 id="fin-produccion" className={TITULO_PANEL}>
        Producción por <Destacado>profesional</Destacado>
      </h2>
      {resumen.byProfessional.length === 0 ? (
        <SinDatos
          className="px-0 pb-0"
          titulo="Ningún tratamiento se completó en este rango."
          detalle="La producción cuenta los ítems del plan marcados como completados, no lo cobrado."
        />
      ) : (
        <>
          <ul className="mt-4 grid gap-3.5">
            {resumen.byProfessional.map((p) => (
              <li key={p.professionalId}>
                <div className="flex justify-between gap-2.5 text-sm font-semibold">
                  <span className="min-w-0 truncate">{p.professionalName}</span>
                  <span className="cifra font-medium">{formatMoney(p.totalCents, currency)}</span>
                </div>
                <BarraFina
                  className="mt-1.5"
                  pct={max > 0 ? (p.totalCents / max) * 100 : 0}
                  color={
                    p.color === null ? "var(--color-muted-foreground)" : colorProfesional(p.color)
                  }
                />
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  {plural(p.itemsCount, "ítem completado", "ítems completados")}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Cada barra lleva el color del profesional en la agenda. Cuenta lo realizado, no lo
            cobrado.
          </p>
        </>
      )}
    </section>
  );
}

function GastosPorCategoria({
  resumen,
  currency,
  desde,
  hasta,
}: {
  resumen: FinanceSummary;
  currency: string;
  desde: string;
  hasta: string;
}) {
  return (
    <section aria-labelledby="fin-gastos" className={cn(PANEL, "p-5")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="fin-gastos" className={TITULO_PANEL}>
          Gastos por <Destacado>categoría</Destacado>
        </h2>
        <Link
          to="/gastos"
          search={{ desde, hasta, categoria: "" }}
          className="rounded-sm text-sm font-medium text-brand-700 underline-offset-4 outline-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Ver gastos →
        </Link>
      </div>
      {resumen.byExpenseCategory.length === 0 ? (
        <SinDatos
          className="px-0 pb-0"
          titulo="No hay gastos cargados en este rango."
          detalle="Sin gastos, el resultado es igual a lo cobrado. Carga arriendo, insumos y laboratorio para que refleje lo que de verdad queda."
          accion={
            <Link
              to="/gastos"
              search={{ desde, hasta, categoria: "" }}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Cargar un gasto
            </Link>
          }
        />
      ) : (
        <ul className="mt-4 grid gap-3.5">
          {resumen.byExpenseCategory.map((c) => {
            const pct = resumen.expensesCents
              ? Math.round((c.totalCents / resumen.expensesCents) * 100)
              : 0;
            return (
              <li key={c.category}>
                <div className="flex justify-between gap-2.5 text-sm font-semibold">
                  <span className="min-w-0 truncate">{c.category}</span>
                  <span className="cifra font-medium">{formatMoney(c.totalCents, currency)}</span>
                </div>
                <BarraFina className="mt-1.5" pct={pct} color="var(--color-warning-border)" />
                <p className="mt-1 flex justify-between text-[12.5px] text-muted-foreground">
                  <span>{plural(c.count, "gasto", "gastos")}</span>
                  <span className="cifra">{pct}%</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
