import { useId } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { KpisEnFilete, type KpiFilete } from "@/components/kpis-en-filete";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
import { buttonVariants } from "@/components/ui/button";
import { requirePermission } from "@/lib/access/route-guards";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import { formatoFecha, hoyISO, parseIsoDate } from "@/lib/clinic-operations/clinic-data";
import { formatMoney, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/finance/finance";
import {
  getFinanceSummary,
  getQuoteConversionReport,
  type FinanceSummary,
} from "@/lib/finance/finance-reports.functions";
import { str } from "@/lib/search";
import { cn } from "@/lib/utils";
import { diaSemana, fechaCorta } from "@/lib/formato-fecha";

/**
 * Rangos largos (ej. 3 meses) volvían el gráfico de caja una lista de barras
 * finas día por día, difícil de escanear — agrupa por semana (lunes a
 * domingo) cuando hay más de 30 puntos, sin tocar el resumen que llega del
 * servidor.
 */
function agruparPorSemana(dias: { date: string; totalCents: number }[]) {
  const totales = new Map<string, number>();
  for (const d of dias) {
    const fecha = new Date(`${d.date}T00:00:00`);
    const diaSemana = fecha.getDay();
    const offsetALunes = (diaSemana + 6) % 7;
    fecha.setDate(fecha.getDate() - offsetALunes);
    const inicioSemana = fecha.toISOString().slice(0, 10);
    totales.set(inicioSemana, (totales.get(inicioSemana) ?? 0) + d.totalCents);
  }
  return [...totales.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totalCents]) => ({ date, totalCents }));
}

function etiquetaBarra(date: string, agrupadoPorSemana: boolean) {
  if (agrupadoPorSemana) return `Semana del ${fechaCorta(date)}`;
  return parseIsoDate(date) ? diaSemana(date) : date;
}

interface FinanzasSearch {
  desde: string;
  hasta: string;
}

// validateSearch corre antes del componente (sin Route.useRouteContext(),
// mismo problema estructural que ya documenta agenda.tsx:HOY) — el default
// de estas dos fechas cae a la timezone de Chile mientras no haya un valor
// explícito en la URL. Impacto acotado: solo el rango por defecto del
// reporte, unas horas al día, y solo si la clínica no es de Chile — dentro
// del componente (el botón "Este mes" más abajo) sí usamos access.clinic?.timezone real.
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
        content: "Caja del período, desglose por método de pago y producción por profesional.",
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

const CAMPO_FECHA =
  "h-10 rounded-lg border border-input bg-card px-3 text-sm tabular-nums pointer-coarse:text-base outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function CampoFecha({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="kicker">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={CAMPO_FECHA}
      />
    </div>
  );
}

/** Conclusión del período en una frase: es lo que el dueño viene a saber. */
function titularDelPeriodo(resumen: FinanceSummary | undefined) {
  if (!resumen) return "Finanzas del período";
  if (resumen.paymentsCount === 0 && resumen.expensesCount === 0) {
    return "Sin movimientos en el período.";
  }
  if (resumen.resultCents < 0) return "El período va en negativo.";
  if (resumen.resultCents === 0) return "El período cierra en cero.";
  return "El período va en positivo.";
}

function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`;
}

function FinanzasPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const clinicId = access.clinic?.id;
  const clinicTz = access.clinic?.timezone;

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
    isLoading,
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

  const mesDesde = primerDiaDelMes(clinicTz);
  const mesHasta = hoyISO(clinicTz);
  const esEsteMes = search.desde === mesDesde && search.hasta === mesHasta;

  const currency = resumen?.currency ?? access.clinic?.currency ?? "CLP";
  const agrupadoPorSemana = (resumen?.byDay.length ?? 0) > 30;
  const serieCaja = resumen
    ? agrupadoPorSemana
      ? agruparPorSemana(resumen.byDay)
      : resumen.byDay
    : [];
  const maxDia = Math.max(1, ...serieCaja.map((d) => d.totalCents));

  const kpis: KpiFilete[] = resumen
    ? [
        {
          label: "Cobrado",
          valor: formatMoney(resumen.totalCents, currency),
          nota:
            resumen.retentionCents !== null && resumen.retentionCents > 0
              ? `Entra ${formatMoney(resumen.netCents ?? 0, currency)} · retienen ${formatMoney(resumen.retentionCents, currency)}`
              : plural(resumen.paymentsCount, "pago", "pagos"),
        },
        {
          label: "Gastos",
          valor: formatMoney(resumen.expensesCents, currency),
          nota:
            resumen.expensesCount === 0
              ? "Sin gastos cargados"
              : plural(resumen.expensesCount, "gasto", "gastos"),
          tonoNota:
            resumen.expensesCount === 0 && resumen.paymentsCount > 0 ? "warning" : undefined,
        },
        {
          label: "Resultado",
          // formatMoney ya pone el signo adelante: "-$120.000", nunca "$-120.000".
          valor: formatMoney(resumen.resultCents, currency),
          nota:
            resumen.retentionCents === null
              ? "Sobre lo facturado, sin retenciones"
              : "Neto de retenciones, menos gastos",
          tono:
            resumen.resultCents < 0 ? "danger" : resumen.resultCents > 0 ? "success" : undefined,
        },
        // Regla 11: sin pagos no hay ticket promedio, no un $0 fabricado.
        resumen.paymentsCount === 0
          ? { label: "Ticket promedio", valor: "—", nota: "Sin pagos en el período" }
          : {
              label: "Ticket promedio",
              valor: formatMoney(resumen.averageTicketCents, currency),
              nota: "Promedio por pago",
            },
      ]
    : ["Cobrado", "Gastos", "Resultado", "Ticket promedio"].map((label) => ({
        label,
        valor: "—",
        nota: isError ? "Sin datos" : "",
      }));

  const kpisConversion: KpiFilete[] =
    conversion && conversion.created > 0
      ? [
          {
            label: "Conversión",
            valor: conversion.conversionRate === null ? "—" : `${conversion.conversionRate}%`,
            nota:
              conversion.conversionRate === null
                ? "Ninguno resuelto todavía"
                : "De los aceptados o rechazados",
          },
          {
            label: "Aceptados",
            valor: String(conversion.accepted),
            nota: `Por ${formatMoney(conversion.acceptedTotalCents, currency)}`,
            tono: conversion.accepted > 0 ? "success" : undefined,
          },
          {
            label: "Rechazados",
            valor: String(conversion.rejected),
            nota: conversion.rejected > 0 ? "Vale preguntar por qué" : "Ninguno",
            tono: conversion.rejected > 0 ? "danger" : undefined,
          },
          {
            label: "Pendientes",
            valor: String(conversion.pending),
            nota: conversion.pending > 0 ? "Esperan respuesta" : "Ninguno",
            tono: conversion.pending > 0 ? "warning" : undefined,
          },
        ]
      : [];

  return (
    <AppShell title="Finanzas" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Finanzas" sub={sub ?? null} />
      ) : (
        <div className="mx-auto max-w-6xl space-y-10">
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <p className="kicker">
                Reportes · {formatoFecha(search.desde)} — {formatoFecha(search.hasta)}
              </p>
              <h2 className="mt-2 font-display text-4xl font-normal leading-tight text-balance sm:text-[44px] sm:leading-none">
                {isLoading ? "Finanzas del período" : titularDelPeriodo(resumen)}
              </h2>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <CampoFecha label="Desde" value={search.desde} onChange={(desde) => set({ desde })} />
              <CampoFecha label="Hasta" value={search.hasta} onChange={(hasta) => set({ hasta })} />
              {!esEsteMes && (
                <button
                  type="button"
                  onClick={() => set({ desde: mesDesde, hasta: mesHasta })}
                  className={cn(buttonVariants({ variant: "ghost" }), "h-10")}
                >
                  Este mes
                </button>
              )}
            </div>
          </header>

          {isError ? (
            <ErrorDeCarga
              mensaje="No pudimos cargar las finanzas de este período. Revisa la conexión."
              onReintentar={() => void refetch()}
              reintentando={isFetching}
            />
          ) : (
            <KpisEnFilete kpis={kpis} cargando={isLoading} />
          )}

          {resumen && (
            <>
              <section aria-labelledby="fin-caja" className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="fin-caja" className="font-display text-2xl font-semibold">
                    {agrupadoPorSemana ? "Caja por semana" : "Caja por día"}
                  </h2>
                  {serieCaja.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Mejor {agrupadoPorSemana ? "semana" : "día"}:{" "}
                      <span className="tabular-nums text-foreground">
                        {formatMoney(maxDia, currency)}
                      </span>
                    </p>
                  )}
                </div>
                {serieCaja.length === 0 ? (
                  <Vacio
                    titulo="No hay pagos registrados en este rango."
                    detalle="Los cobros se registran desde la ficha de cada paciente, en Presupuestos y pagos, y aparecen acá día por día."
                  />
                ) : (
                  <ul className="divide-y divide-hairline border-y border-border">
                    {serieCaja.map((d) => (
                      <li
                        key={d.date}
                        className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)_8rem] sm:gap-5"
                      >
                        <span className="truncate text-sm capitalize text-muted-foreground tabular-nums">
                          {etiquetaBarra(d.date, agrupadoPorSemana)}
                        </span>
                        <span aria-hidden className="h-2 overflow-hidden rounded-sm bg-muted">
                          <span
                            className="block h-full rounded-sm bg-chart-1"
                            style={{ width: `${Math.max(2, (d.totalCents / maxDia) * 100)}%` }}
                          />
                        </span>
                        <span className="text-right text-sm cifra">
                          {formatMoney(d.totalCents, currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="grid gap-10 lg:grid-cols-2">
                <section aria-labelledby="fin-metodos" className="min-w-0 space-y-3">
                  <h2 id="fin-metodos" className="font-display text-2xl font-semibold">
                    Por método de pago
                  </h2>
                  {resumen.byMethod.length === 0 ? (
                    <Vacio
                      titulo="Sin pagos en este rango."
                      detalle="Cuando registres cobros vas a ver cuánto entró por efectivo, tarjeta o transferencia."
                    />
                  ) : (
                    <Tabla columnas={["Método", "Pagos", "Monto"]}>
                      {resumen.byMethod.map((m) => (
                        <tr key={m.method}>
                          <td className="py-3 pr-3">
                            {PAYMENT_METHOD_LABELS[m.method as PaymentMethod] ?? m.method}
                          </td>
                          <td className="py-3 pr-3 text-right cifra text-muted-foreground">
                            {m.count}
                          </td>
                          <td className="py-3 text-right cifra">
                            {formatMoney(m.totalCents, currency)}
                          </td>
                        </tr>
                      ))}
                    </Tabla>
                  )}
                </section>

                <section aria-labelledby="fin-produccion" className="min-w-0 space-y-3">
                  <h2 id="fin-produccion" className="font-display text-2xl font-semibold">
                    Producción por profesional
                  </h2>
                  {resumen.byProfessional.length === 0 ? (
                    <Vacio
                      titulo="Ningún tratamiento se completó en este rango."
                      detalle="La producción cuenta los ítems del plan marcados como completados, no lo cobrado."
                    />
                  ) : (
                    <Tabla columnas={["Profesional", "Ítems", "Producción"]}>
                      {resumen.byProfessional.map((p) => (
                        <tr key={p.professionalId}>
                          <td className="py-3 pr-3">{p.professionalName}</td>
                          <td className="py-3 pr-3 text-right cifra text-muted-foreground">
                            {p.itemsCount}
                          </td>
                          <td className="py-3 text-right cifra">
                            {formatMoney(p.totalCents, currency)}
                          </td>
                        </tr>
                      ))}
                    </Tabla>
                  )}
                </section>
              </div>

              <div className="grid gap-10 lg:grid-cols-2">
                <section aria-labelledby="fin-gastos" className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="fin-gastos" className="font-display text-2xl font-semibold">
                      Gastos por categoría
                    </h2>
                    <Link
                      to="/gastos"
                      search={{ desde: search.desde, hasta: search.hasta, categoria: "" }}
                      className="text-sm text-brand-700 hover:underline"
                    >
                      Ver gastos →
                    </Link>
                  </div>
                  {resumen.byExpenseCategory.length === 0 ? (
                    <Vacio
                      titulo="No hay gastos cargados en este rango."
                      detalle="Sin gastos, el resultado es igual a lo cobrado. Carga arriendo, insumos y laboratorio para que refleje lo que de verdad queda."
                      accion={
                        <Link
                          to="/gastos"
                          search={{ desde: search.desde, hasta: search.hasta, categoria: "" }}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          Cargar un gasto
                        </Link>
                      }
                    />
                  ) : (
                    <Tabla columnas={["Categoría", "Peso", "Monto"]}>
                      {resumen.byExpenseCategory.map((c) => {
                        const pct = resumen.expensesCents
                          ? Math.round((c.totalCents / resumen.expensesCents) * 100)
                          : 0;
                        return (
                          <tr key={c.category}>
                            <td className="py-3 pr-3">{c.category}</td>
                            <td className="w-[38%] py-3 pr-3">
                              <span className="flex items-center gap-2.5">
                                <span
                                  aria-hidden
                                  className="h-1.5 flex-1 overflow-hidden rounded-sm bg-muted"
                                >
                                  <span
                                    className="block h-full rounded-sm bg-warning-border"
                                    style={{ width: `${pct}%` }}
                                  />
                                </span>
                                <span className="w-10 text-right text-muted-foreground cifra">
                                  {pct}%
                                </span>
                              </span>
                            </td>
                            <td className="py-3 text-right cifra">
                              {formatMoney(c.totalCents, currency)}
                            </td>
                          </tr>
                        );
                      })}
                    </Tabla>
                  )}
                </section>

                <section aria-labelledby="fin-conversion" className="min-w-0 space-y-3">
                  <h2 id="fin-conversion" className="font-display text-2xl font-semibold">
                    Conversión de presupuestos
                  </h2>
                  {conversionConError ? (
                    <ErrorDeCarga
                      mensaje="No pudimos cargar la conversión de presupuestos."
                      onReintentar={() => void reintentarConversion()}
                      reintentando={recargandoConversion}
                    />
                  ) : cargandoConversion ? (
                    <p className="border-y border-border py-8 text-sm text-muted-foreground">
                      Cargando presupuestos…
                    </p>
                  ) : !conversion || conversion.created === 0 ? (
                    <Vacio
                      titulo="No se crearon presupuestos en este rango."
                      detalle="Los presupuestos se arman desde la ficha del paciente; acá vas a ver cuántos se aceptan."
                    />
                  ) : (
                    <>
                      <KpisEnFilete kpis={kpisConversion} columnas={2} tamano="md" />
                      <p className="text-sm text-muted-foreground">
                        {plural(conversion.created, "presupuesto creado", "presupuestos creados")}{" "}
                        por{" "}
                        <span className="tabular-nums">
                          {formatMoney(conversion.createdTotalCents, currency)}
                        </span>
                        .
                      </p>
                    </>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Tabla({ columnas, children }: { columnas: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto border-y border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs font-medium text-muted-foreground">
            {columnas.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  "py-2.5 font-normal",
                  i === 0 ? "pr-3 text-left" : "text-right",
                  i > 0 && i < columnas.length - 1 && "pr-3",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline border-t border-hairline">{children}</tbody>
      </table>
    </div>
  );
}

function Vacio({
  titulo,
  detalle,
  accion,
}: {
  titulo: string;
  detalle: string;
  accion?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-y border-border py-6">
      <div className="max-w-prose space-y-1">
        <p className="text-sm font-medium">{titulo}</p>
        <p className="text-sm text-muted-foreground">{detalle}</p>
      </div>
      {accion}
    </div>
  );
}
