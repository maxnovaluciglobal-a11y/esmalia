import { useEffect, useId, useRef } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Printer } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { KpisEnFilete, type KpiFilete } from "@/components/kpis-en-filete";
import { Button } from "@/components/ui/button";
import {
  Chips,
  CifraEnTinta,
  DatosEnTinta,
  Destacado,
  EncabezadoEditorial,
  EtiquetaTinta,
  MontoEnTinta,
  PANEL,
  TINTA,
  TITULO_PANEL,
  TintaCargando,
} from "@/components/reportes/aplus";
import resultadosPilotoCss from "@/components/resultados-piloto.css?url";
import { requirePermission } from "@/lib/access/route-guards";
import { formatMoney } from "@/lib/finance/finance";
import { diasDelRango, hayDatos, type ResultadosDelPiloto } from "@/lib/finance/resultados-piloto";
import { getResultadosDelPiloto } from "@/lib/finance/resultados-piloto.functions";
import { fecha, numero } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { str } from "@/lib/search";
import { cn } from "@/lib/utils";

interface PilotoSearch {
  /** Vacío = desde el día en que se creó la clínica (lo resuelve el servidor). */
  desde: string;
  /** Vacío = hoy en el huso de la clínica. */
  hasta: string;
}

/**
 * Resultados del piloto (INF-14, Ola 2): lo que una clínica piloto ganó desde
 * que usa Esmalia, para la conversación de cierre del piloto. Solo
 * owner/admin (`settings:manage` es exactamente esos dos roles); el servidor
 * lo vuelve a exigir y pasa los montos por `requireFinanceView`.
 */
export const Route = createFileRoute("/_authenticated/_clinic/resultados-del-piloto")({
  validateSearch: (search: Record<string, unknown>): PilotoSearch => ({
    desde: str(search.desde),
    hasta: str(search.hasta),
  }),
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Resultados del piloto | Esmalia" },
      {
        name: "description",
        content:
          "Lo que tu clínica ganó desde que usa Esmalia: citas, asistencia, recordatorios, pacientes nuevos, presupuestos y cobros.",
      },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "stylesheet", href: resultadosPilotoCss }],
  }),
  component: ResultadosDelPilotoPage,
});

const CAMPO_FECHA =
  "h-[30px] rounded-full border border-control bg-card px-3 text-[12.5px] font-medium tabular-nums pointer-coarse:h-11 pointer-coarse:text-base outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function CampoFecha({
  ref,
  label,
  value,
  min,
  max,
  onChange,
}: {
  ref?: React.Ref<HTMLInputElement>;
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={CAMPO_FECHA}
      />
    </>
  );
}

/**
 * El modo oscuro no se imprime: texto claro sobre papel blanco no se lee.
 * Se apaga solo mientras dura la impresión y vuelve como estaba.
 */
function useImpresionEnClaro() {
  useEffect(() => {
    const raiz = document.documentElement;
    let estabaOscuro = false;
    const antes = () => {
      estabaOscuro = raiz.classList.contains("dark");
      raiz.classList.remove("dark");
    };
    const despues = () => {
      if (estabaOscuro) raiz.classList.add("dark");
    };
    window.addEventListener("beforeprint", antes);
    window.addEventListener("afterprint", despues);
    return () => {
      window.removeEventListener("beforeprint", antes);
      window.removeEventListener("afterprint", despues);
    };
  }, []);
}

const SIN_DATOS = "Sin datos";

function plural(n: number, uno: string, varios: string) {
  return `${numero(n)} ${n === 1 ? uno : varios}`;
}

function kpisDeAgenda(r: ResultadosDelPiloto): KpiFilete[] {
  const conDesenlace = r.citas.atendidas + r.citas.inasistencias;
  return [
    {
      label: "Citas agendadas",
      valor: numero(r.citas.agendadas),
      nota:
        r.citas.anuladas > 0
          ? `sin contar ${plural(r.citas.anuladas, "anulada", "anuladas")}`
          : "sin anuladas",
    },
    {
      label: "Asistencia",
      valor: r.citas.pctAsistencia === null ? SIN_DATOS : `${r.citas.pctAsistencia} %`,
      nota:
        conDesenlace === 0
          ? "todavía sin citas cerradas"
          : `${numero(r.citas.atendidas)} de ${plural(conDesenlace, "cita cerrada", "citas cerradas")}`,
      tono: r.citas.pctAsistencia === null ? undefined : "success",
    },
    {
      label: "Inasistencias",
      valor: numero(r.citas.inasistencias),
      nota:
        r.citas.pctAsistencia === null
          ? SIN_DATOS
          : `${100 - r.citas.pctAsistencia} % de las cerradas`,
      tono: r.citas.inasistencias > 0 ? "danger" : undefined,
    },
    {
      label: "Recordatorios enviados",
      valor: numero(r.recordatoriosEnviados),
      nota: "por WhatsApp o email",
    },
  ];
}

function kpisDeDinero(r: ResultadosDelPiloto): KpiFilete[] | null {
  const d = r.dinero;
  if (!d) return null;
  return [
    {
      label: "Presupuestos emitidos",
      valor: numero(d.presupuestosEmitidos),
      nota:
        d.presupuestosEmitidos === 0
          ? SIN_DATOS
          : `${formatMoney(d.presupuestosEmitidosCents, r.currency)} en total`,
    },
    {
      label: "Presupuestos aceptados",
      valor: numero(d.presupuestosAceptados),
      nota:
        d.pctAceptacion === null
          ? SIN_DATOS
          : `${d.pctAceptacion} % · ${formatMoney(d.presupuestosAceptadosCents, r.currency)}`,
      tono: d.presupuestosAceptados > 0 ? "success" : undefined,
    },
    {
      label: "Cobrado",
      valor: d.pagos === 0 ? SIN_DATOS : formatMoney(d.cobradoCents, r.currency),
      nota: d.pagos === 0 ? "sin pagos registrados" : plural(d.pagos, "pago", "pagos"),
    },
    {
      label: "Por pago",
      valor:
        d.pagos === 0 ? SIN_DATOS : formatMoney(Math.round(d.cobradoCents / d.pagos), r.currency),
      nota: "promedio del período",
    },
  ];
}

function ResultadosDelPilotoPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const clinicId = access.clinic?.id;
  const clinicTz = access.clinic?.timezone;
  useImpresionEnClaro();

  const fetchResultados = useServerFn(getResultadosDelPiloto);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["resultados-piloto", clinicId, search.desde, search.hasta],
    queryFn: () =>
      fetchResultados({
        data: {
          clinicId: clinicId!,
          desde: search.desde || null,
          hasta: search.hasta || null,
        },
      }),
    enabled: Boolean(clinicId),
    placeholderData: (prev) => prev,
  });

  const set = (patch: Partial<PilotoSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const esDesdeElInicio = !search.desde && !search.hasta;
  const desdeRef = useRef<HTMLInputElement>(null);
  const clinica = access.clinic?.name ?? "Tu clínica";

  const dias = data ? diasDelRango(data.desde, data.hasta) : null;
  const conclusion = !data ? undefined : !hayDatos(data) ? (
    "Todavía no hay citas, pacientes ni cobros en este período."
  ) : (
    <>
      <b className="font-semibold text-foreground">
        {data.citas.pctAsistencia === null
          ? `${plural(data.citas.agendadas, "cita agendada", "citas agendadas")}, todavía sin citas cerradas.`
          : `Asistió el ${data.citas.pctAsistencia} % de los pacientes citados.`}
      </b>{" "}
      {plural(data.pacientesNuevos, "paciente nuevo", "pacientes nuevos")} y{" "}
      {plural(data.recordatoriosEnviados, "recordatorio enviado", "recordatorios enviados")}
      {data.dinero && data.dinero.pagos > 0
        ? `; se cobraron ${formatMoney(data.dinero.cobradoCents, data.currency)}.`
        : "."}
    </>
  );

  return (
    <AppShell title="Resultados del piloto" access={access}>
      <div className="informe-piloto mx-auto max-w-[84rem] space-y-[18px]">
        <div className="space-y-4 pb-2">
          <EncabezadoEditorial
            seccion="Reportes"
            pagina="Resultados del piloto"
            detalle={data ? `${fecha(data.desde)} — ${fecha(data.hasta)}` : undefined}
            titulo={
              <>
                {clinica} con Esmalia
                {dias !== null && (
                  <>
                    {", "}
                    <Destacado>{plural(dias, "día", "días")}</Destacado>
                  </>
                )}
              </>
            }
            conclusion={conclusion}
            acciones={
              <Button
                variant="outline"
                className="h-10 rounded-full px-4"
                onClick={() => window.print()}
                disabled={!data}
              >
                <Printer aria-hidden /> Guardar como PDF
              </Button>
            }
          />
          <div className="no-imprimir flex flex-wrap items-center gap-x-3 gap-y-2">
            <Chips<"inicio" | "rango">
              etiqueta="Período"
              valor={esDesdeElInicio ? "inicio" : "rango"}
              onCambiar={(v) => {
                if (v === "inicio") set({ desde: "", hasta: "" });
                else desdeRef.current?.focus();
              }}
              opciones={[
                { valor: "inicio", label: "Desde el inicio" },
                { valor: "rango", label: "Personalizado" },
              ]}
            />
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
              <CampoFecha
                ref={desdeRef}
                label="Desde"
                value={search.desde || data?.desde || ""}
                min={data?.inicio}
                max={data?.hasta}
                onChange={(desde) => set({ desde })}
              />
              <span aria-hidden>—</span>
              <CampoFecha
                label="Hasta"
                value={search.hasta || data?.hasta || ""}
                min={data?.desde}
                onChange={(hasta) => set({ hasta })}
              />
            </div>
          </div>
        </div>

        {isLoading ? (
          <TintaCargando texto="Calculando resultados…" />
        ) : isError ? (
          <ErrorDeCarga
            mensaje={mensajeDeError(error as Error)}
            reintentando={isFetching}
            onReintentar={() => void refetch()}
          />
        ) : !data ? null : !hayDatos(data) ? (
          <section className={cn(PANEL, "p-8 text-center")}>
            <p className="font-display text-3xl">Sin datos</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Todavía no hay citas, pacientes ni cobros en este período. Cuando la clínica empiece a
              agendar y cobrar en Esmalia, acá vas a ver lo que ganó.
            </p>
          </section>
        ) : (
          <div className={cn("space-y-[18px]", isFetching && "opacity-70 transition-opacity")}>
            <section
              aria-label="Resumen del piloto"
              className={cn(TINTA, "grid gap-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}
            >
              <div className="min-w-0">
                <EtiquetaTinta>Asistencia</EtiquetaTinta>
                {data.citas.pctAsistencia === null ? (
                  <CifraEnTinta valor={SIN_DATOS} />
                ) : (
                  <CifraEnTinta valor={String(data.citas.pctAsistencia)} sufijo="%" />
                )}
                <p className="mt-3.5 text-sm font-medium text-on-night-2">
                  {data.citas.atendidas + data.citas.inasistencias === 0
                    ? "todavía sin citas cerradas"
                    : `${numero(data.citas.atendidas)} de ${plural(data.citas.atendidas + data.citas.inasistencias, "cita cerrada", "citas cerradas")} terminaron atendidas`}
                </p>
                <div className="mt-6">
                  <DatosEnTinta
                    columnas={3}
                    datos={[
                      { label: "Citas agendadas", valor: numero(data.citas.agendadas) },
                      { label: "Recordatorios", valor: numero(data.recordatoriosEnviados) },
                      { label: "Pacientes nuevos", valor: numero(data.pacientesNuevos) },
                    ]}
                  />
                </div>
              </div>
              <div className="min-w-0">
                <EtiquetaTinta>Cobrado en el período</EtiquetaTinta>
                {data.dinero && data.dinero.pagos > 0 ? (
                  <MontoEnTinta cents={data.dinero.cobradoCents} currency={data.currency} />
                ) : (
                  <CifraEnTinta valor={SIN_DATOS} />
                )}
                <p className="mt-3.5 text-sm font-medium text-on-night-2">
                  {!data.dinero
                    ? "los montos no están disponibles con la suscripción actual"
                    : data.dinero.pagos === 0
                      ? "sin pagos registrados"
                      : plural(data.dinero.pagos, "pago", "pagos")}
                </p>
                {data.dinero && (
                  <div className="mt-6">
                    <DatosEnTinta
                      datos={[
                        {
                          label: "Presupuestos aceptados",
                          valor:
                            data.dinero.pctAceptacion === null
                              ? SIN_DATOS
                              : `${data.dinero.pctAceptacion} %`,
                          nota: `${numero(data.dinero.presupuestosAceptados)} de ${numero(data.dinero.presupuestosEmitidos)}`,
                        },
                        {
                          label: "Monto aceptado",
                          valor: formatMoney(data.dinero.presupuestosAceptadosCents, data.currency),
                        },
                      ]}
                    />
                  </div>
                )}
              </div>
            </section>

            <section aria-labelledby="piloto-agenda" className={cn(PANEL, "p-5")}>
              <h3 id="piloto-agenda" className={TITULO_PANEL}>
                La <Destacado>agenda</Destacado>
              </h3>
              <div className="mt-3">
                <KpisEnFilete kpis={kpisDeAgenda(data)} tamano="md" />
              </div>
            </section>

            <div className="grid items-start gap-[18px] lg:grid-cols-2">
              <section aria-labelledby="piloto-pacientes" className={cn(PANEL, "p-5")}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 id="piloto-pacientes" className={TITULO_PANEL}>
                    Pacientes <Destacado>nuevos</Destacado>
                  </h3>
                  <p className="font-display text-3xl tabular-nums">
                    {numero(data.pacientesNuevos)}
                  </p>
                </div>
                {data.origenes.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Sin datos de pacientes nuevos.
                  </p>
                ) : (
                  <ul className="mt-4 grid gap-3">
                    {data.origenes.map((o) => (
                      <li key={o.origen}>
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate font-medium">{o.origen}</span>
                          <span className="cifra">
                            {numero(o.pacientes)}{" "}
                            <span className="text-muted-foreground">· {o.porcentaje} %</span>
                          </span>
                        </div>
                        <span
                          aria-hidden
                          className="mt-1.5 block h-2 overflow-hidden rounded-[4px] bg-muted"
                        >
                          <span
                            className="block h-full bg-brand"
                            style={{ width: `${Math.max(o.porcentaje, 2)}%` }}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-4 text-xs text-muted-foreground">
                  Según el origen anotado en la ficha de cada paciente. "Sin dato" son las fichas
                  sin origen.
                </p>
              </section>

              <section aria-labelledby="piloto-dinero" className={cn(PANEL, "p-5")}>
                <h3 id="piloto-dinero" className={TITULO_PANEL}>
                  Presupuestos y <Destacado>cobros</Destacado>
                </h3>
                <div className="mt-3">
                  {kpisDeDinero(data) ? (
                    <KpisEnFilete kpis={kpisDeDinero(data)!} tamano="md" columnas={2} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Los montos no están disponibles con el estado actual de la suscripción.
                      Revísalo en{" "}
                      <Link
                        to="/suscripcion"
                        className="text-brand-700 underline-offset-4 hover:underline"
                      >
                        Suscripción
                      </Link>
                      .
                    </p>
                  )}
                </div>
              </section>
            </div>

            <footer className="space-y-1 border-t border-hairline pt-4 text-xs text-muted-foreground">
              <p>
                Citas: las que empiezan en el período, sin las anuladas. Asistencia: atendidas sobre
                las citas cerradas como atendidas o no asistió. Presupuestos: emitidos (no
                borradores) en el período. Cobrado: pagos del período, sin los reversados.
              </p>
              <p>
                Fechas en el huso de la clínica ({clinicTz ?? "America/Santiago"}). Calculado el{" "}
                {fecha(new Date(), clinicTz)}.
              </p>
              <p className="solo-imprimir">esmalia.com</p>
            </footer>
          </div>
        )}
      </div>
    </AppShell>
  );
}
