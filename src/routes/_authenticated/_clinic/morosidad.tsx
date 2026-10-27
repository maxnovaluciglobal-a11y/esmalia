import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleDashed, Clock, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { fechaPlanilla, montoPlanilla } from "@/lib/exportacion/listas-csv";
import { ErrorDeCarga } from "@/components/estado-error";
import {
  BarraApilada,
  Chips,
  DatosEnTinta,
  Destacado,
  EncabezadoEditorial,
  EtiquetaTinta,
  FILA,
  MontoEnTinta,
  PANEL,
  Pastilla,
  SinDatos,
  TablaAPlus,
  TINTA,
  TITULO_PANEL,
  TintaCargando,
  celda,
} from "@/components/reportes/aplus";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
import { requirePermission } from "@/lib/access/route-guards";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import type { TonoEstado } from "@/lib/clinic-operations/estado-cita-tono";
import {
  AGING_BUCKET_LABELS,
  AGING_BUCKETS,
  formatMoney,
  type AgingBucket,
} from "@/lib/finance/finance";
import { getAccountsReceivableAging } from "@/lib/finance/finance-reports.functions";
import { fecha, numero } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

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

/** Estado de cada tramo: tono + ícono; la etiqueta siempre va escrita. */
const TRAMO: Record<AgingBucket, { tono: TonoEstado; icono: LucideIcon }> = {
  "0-30": { tono: "neutral", icono: Clock },
  "31-60": { tono: "warning", icono: Clock },
  "61-90": { tono: "danger", icono: TriangleAlert },
  "90+": { tono: "danger", icono: OctagonAlert },
  sin_fecha: { tono: "neutral", icono: CircleDashed },
};

/** En la barra, lo más antiguo primero (y con el cobalto más lleno). */
const ORDEN_BARRA: AgingBucket[] = ["90+", "61-90", "31-60", "0-30", "sin_fecha"];

type Filtro = AgingBucket | "todos";

function MorosidadPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const [filtro, setFiltro] = useState<Filtro>("todos");

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

  const porTramo = useMemo(() => {
    const m = new Map<AgingBucket, { cents: number; pacientes: number }>();
    for (const f of filas ?? []) {
      const t = m.get(f.bucket) ?? { cents: 0, pacientes: 0 };
      t.cents += f.balanceCents;
      t.pacientes += 1;
      m.set(f.bucket, t);
    }
    return m;
  }, [filas]);

  if (!clinicId) return null;

  const todas = filas ?? [];
  const currency = todas[0]?.currency ?? access.clinic?.currency ?? "CLP";
  const totalCents = todas.reduce((s, f) => s + f.balanceCents, 0);
  const masDe90 = porTramo.get("90+");
  const filtroVigente = filtro !== "todos" && porTramo.has(filtro) ? filtro : "todos";
  const visibles =
    filtroVigente === "todos" ? todas : todas.filter((f) => f.bucket === filtroVigente);
  const dinero = (c: number) => formatMoney(c, currency);

  const conclusion =
    todas.length === 0 ? (
      "Nadie debe: todos los pacientes con tratamiento están al día."
    ) : (
      <>
        <b className="font-semibold text-foreground">
          {numero(todas.length)} {todas.length === 1 ? "paciente debe" : "pacientes deben"}{" "}
          {dinero(totalCents)}.
        </b>{" "}
        {masDe90
          ? `${dinero(masDe90.cents)} lleva más de 90 días: es lo que conviene llamar hoy.`
          : "Ninguna deuda pasa de 90 días. La lista va de la más antigua a la más nueva."}
      </>
    );

  const columnas = [
    { label: "Paciente" },
    { label: "Antigüedad" },
    { label: "Referencia", className: "hidden sm:table-cell" },
    { label: "Saldo", derecha: true },
  ];

  return (
    <AppShell title="Morosidad" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Morosidad" sub={sub ?? null} />
      ) : (
        <div className="mx-auto max-w-[84rem] space-y-[18px]">
          <div className="pb-2">
            <EncabezadoEditorial
              seccion="Finanzas"
              pagina="Morosidad"
              titulo={
                <>
                  Lo que te <Destacado>deben</Destacado>
                </>
              }
              conclusion={filas ? conclusion : undefined}
              acciones={
                todas.length > 0 ? (
                  <ExportarCsvLista<(typeof todas)[number]>
                    clinicId={clinicId}
                    rol={access.role}
                    lista="morosidad"
                    filas={todas}
                    timezone={access.clinic?.timezone ?? "America/Santiago"}
                    columnas={[
                      { header: "Paciente", value: (f) => f.patientName },
                      {
                        header: "Saldo",
                        value: (f) => montoPlanilla(f.balanceCents, f.currency),
                        dinero: true,
                      },
                      { header: "Moneda", value: (f) => f.currency, dinero: true },
                      { header: "Antigüedad", value: (f) => AGING_BUCKET_LABELS[f.bucket] },
                      {
                        header: "Fecha de referencia",
                        value: (f) => fechaPlanilla(f.referenceDate, access.clinic?.timezone),
                      },
                    ]}
                  />
                ) : undefined
              }
            />
          </div>

          {isError ? (
            // Antes un error se leía como "todos están al día".
            <ErrorDeCarga
              onReintentar={refetch}
              mensaje="No pudimos calcular la cartera pendiente."
            />
          ) : isLoading || !filas ? (
            <TintaCargando texto="Calculando la cartera pendiente…" />
          ) : (
            <>
              <section
                aria-label="Cartera pendiente"
                className={cn(TINTA, "grid gap-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]")}
              >
                <div className="min-w-0">
                  <EtiquetaTinta>Por cobrar hoy</EtiquetaTinta>
                  <MontoEnTinta cents={totalCents} currency={currency} />
                  <p className="mt-3.5 text-sm font-medium text-on-night-2">
                    {todas.length === 0 ? (
                      "Sin cartera pendiente."
                    ) : (
                      <>
                        en{" "}
                        <b className="font-semibold text-on-night">
                          {numero(todas.length)} {todas.length === 1 ? "paciente" : "pacientes"}
                        </b>
                      </>
                    )}
                  </p>
                  <div className="mt-6">
                    <DatosEnTinta
                      datos={[
                        {
                          label: "Más de 90 días",
                          valor: masDe90 ? dinero(masDe90.cents) : "Ninguna",
                          nota: masDe90
                            ? `${numero(masDe90.pacientes)} ${masDe90.pacientes === 1 ? "paciente" : "pacientes"}`
                            : undefined,
                        },
                        {
                          label: "Deuda promedio",
                          valor:
                            todas.length === 0
                              ? "Sin datos"
                              : dinero(Math.round(totalCents / todas.length)),
                          nota: todas.length === 0 ? undefined : "por paciente",
                        },
                      ]}
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <EtiquetaTinta>Por antigüedad de la deuda</EtiquetaTinta>
                  <BarraApilada
                    sobre="tinta"
                    vacio="Nadie debe."
                    partes={ORDEN_BARRA.map((b) => ({
                      clave: b,
                      etiqueta: `${AGING_BUCKET_LABELS[b]} · ${porTramo.get(b)?.pacientes ?? 0}`,
                      valor: porTramo.get(b)?.cents ?? 0,
                      texto: dinero(porTramo.get(b)?.cents ?? 0),
                    }))}
                  />
                </div>
              </section>

              <section aria-labelledby="mor-lista" className={cn(PANEL, "overflow-hidden")}>
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-[18px] pb-3">
                  <h2 id="mor-lista" className={TITULO_PANEL}>
                    Quién debe
                  </h2>
                  {todas.length > 0 && (
                    <Chips<Filtro>
                      etiqueta="Filtrar por antigüedad"
                      valor={filtroVigente}
                      onCambiar={setFiltro}
                      opciones={[
                        { valor: "todos", label: "Todos", cuenta: todas.length },
                        ...AGING_BUCKETS.filter((b) => porTramo.has(b)).map((b) => ({
                          valor: b as Filtro,
                          label: AGING_BUCKET_LABELS[b],
                          cuenta: porTramo.get(b)!.pacientes,
                        })),
                      ]}
                    />
                  )}
                </div>
                {todas.length === 0 ? (
                  <SinDatos
                    className="border-t border-hairline"
                    titulo="Sin cartera pendiente."
                    detalle="Todos los pacientes con tratamiento están al día."
                  />
                ) : (
                  <TablaAPlus
                    columnas={columnas}
                    pie={
                      <tr className="border-t border-foreground font-semibold">
                        <td colSpan={2} className="py-3 pl-3.5 sm:pl-5">
                          Total · {numero(visibles.length)}{" "}
                          {visibles.length === 1 ? "paciente" : "pacientes"}
                        </td>
                        <td className="hidden sm:table-cell" />
                        <td className="cifra py-3 pr-3.5 text-right whitespace-nowrap sm:pr-5">
                          {dinero(visibles.reduce((s, f) => s + f.balanceCents, 0))}
                        </td>
                      </tr>
                    }
                  >
                    {visibles.map((f) => {
                      const t = TRAMO[f.bucket];
                      return (
                        <tr key={f.patientId} className={FILA}>
                          <td className={celda(0, 4)}>
                            <Link
                              to="/pacientes/$pacienteId"
                              params={{ pacienteId: f.patientId }}
                              className="rounded-sm font-medium outline-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            >
                              {f.patientName}
                            </Link>
                            <span className="mt-0.5 block text-[12.5px] text-muted-foreground sm:hidden">
                              {f.referenceDate ? `desde el ${fecha(f.referenceDate)}` : "Sin dato"}
                            </span>
                          </td>
                          <td className={celda(1, 4)}>
                            <Pastilla tono={t.tono} icono={t.icono}>
                              {AGING_BUCKET_LABELS[f.bucket]}
                            </Pastilla>
                          </td>
                          <td
                            className={celda(
                              2,
                              4,
                              "hidden text-[13px] text-muted-foreground sm:table-cell",
                            )}
                          >
                            {f.referenceDate ? fecha(f.referenceDate) : "Sin dato"}
                            {f.daysOverdue !== null && f.daysOverdue > 0 && (
                              <span className="cifra block text-xs">
                                hace {numero(f.daysOverdue)} {f.daysOverdue === 1 ? "día" : "días"}
                              </span>
                            )}
                          </td>
                          <td className={celda(3, 4, "cifra text-right whitespace-nowrap")}>
                            {formatMoney(f.balanceCents, f.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </TablaAPlus>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
