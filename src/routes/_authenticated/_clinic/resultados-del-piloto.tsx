import { useEffect, useId } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Printer } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { KpisEnFilete, type KpiFilete } from "@/components/kpis-en-filete";
import { buttonVariants } from "@/components/ui/button";
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
  "h-10 rounded-lg border border-input bg-card px-3 text-sm tabular-nums pointer-coarse:text-base outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function CampoFecha({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
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
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={CAMPO_FECHA}
      />
    </div>
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
  const clinica = access.clinic?.name ?? "Tu clínica";

  return (
    <AppShell title="Resultados del piloto" access={access}>
      <div className="informe-piloto mx-auto max-w-6xl space-y-10">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <p className="kicker">
              Resultados del piloto
              {data
                ? ` · ${fecha(data.desde)} — ${fecha(data.hasta)} · ${plural(diasDelRango(data.desde, data.hasta), "día", "días")}`
                : ""}
            </p>
            <h2 className="mt-2 font-display text-4xl font-normal leading-tight text-balance sm:text-[44px] sm:leading-none">
              {clinica} con Esmalia
            </h2>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Lo que pasó en la clínica desde que empezó a usar Esmalia: la agenda, los pacientes
              que llegaron y lo que se presupuestó y cobró.
            </p>
          </div>
          <div className="no-imprimir flex flex-wrap items-end gap-3">
            <CampoFecha
              label="Desde"
              value={search.desde || data?.desde || ""}
              min={data?.inicio}
              max={data?.hasta}
              onChange={(desde) => set({ desde })}
            />
            <CampoFecha
              label="Hasta"
              value={search.hasta || data?.hasta || ""}
              min={data?.desde}
              onChange={(hasta) => set({ hasta })}
            />
            {!esDesdeElInicio && (
              <button
                type="button"
                onClick={() => set({ desde: "", hasta: "" })}
                className={cn(buttonVariants({ variant: "ghost" }), "h-10")}
              >
                Desde el inicio
              </button>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!data}
              className={cn(buttonVariants({ variant: "outline" }), "h-10")}
            >
              <Printer aria-hidden /> Guardar como PDF
            </button>
          </div>
        </header>

        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Calculando resultados…
          </p>
        ) : isError ? (
          <ErrorDeCarga
            mensaje={mensajeDeError(error as Error)}
            reintentando={isFetching}
            onReintentar={() => void refetch()}
          />
        ) : !data ? null : !hayDatos(data) ? (
          <section className="rounded-lg border border-border p-8 text-center">
            <p className="font-display text-2xl">Sin datos</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Todavía no hay citas, pacientes ni cobros en este período. Cuando la clínica empiece a
              agendar y cobrar en Esmalia, acá vas a ver lo que ganó.
            </p>
          </section>
        ) : (
          <div className={cn("space-y-10", isFetching && "opacity-70 transition-opacity")}>
            <section aria-labelledby="piloto-agenda" className="space-y-3">
              <h3 id="piloto-agenda" className="font-display text-2xl font-semibold">
                Agenda
              </h3>
              <KpisEnFilete kpis={kpisDeAgenda(data)} tamano="md" />
            </section>

            <section aria-labelledby="piloto-pacientes" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="piloto-pacientes" className="font-display text-2xl font-semibold">
                  Pacientes nuevos
                </h3>
                <p className="font-display text-3xl tabular-nums">{numero(data.pacientesNuevos)}</p>
              </div>
              {data.origenes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin datos de pacientes nuevos.</p>
              ) : (
                <ul className="divide-y divide-hairline border-y border-border">
                  {data.origenes.map((o) => (
                    <li
                      key={o.origen}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-2.5"
                    >
                      <span className="min-w-0 truncate text-sm">{o.origen}</span>
                      <span className="text-sm tabular-nums">
                        {numero(o.pacientes)}{" "}
                        <span className="text-muted-foreground">· {o.porcentaje} %</span>
                      </span>
                      <span
                        aria-hidden
                        className="col-span-2 mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted"
                      >
                        <span
                          className="block h-full rounded-full bg-brand"
                          style={{ width: `${Math.max(o.porcentaje, 2)}%` }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Según el origen anotado en la ficha de cada paciente. "Sin dato" son las fichas sin
                origen.
              </p>
            </section>

            <section aria-labelledby="piloto-dinero" className="space-y-3">
              <h3 id="piloto-dinero" className="font-display text-2xl font-semibold">
                Presupuestos y cobros
              </h3>
              {kpisDeDinero(data) ? (
                <KpisEnFilete kpis={kpisDeDinero(data)!} tamano="md" />
              ) : (
                <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  Los montos no están disponibles con el estado actual de la suscripción. Revísalo
                  en{" "}
                  <Link
                    to="/suscripcion"
                    className="text-brand-700 underline-offset-4 hover:underline"
                  >
                    Suscripción
                  </Link>
                  .
                </p>
              )}
            </section>

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
