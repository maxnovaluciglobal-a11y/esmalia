import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { SearchField } from "@/components/filters";
import { hasPermission } from "@/lib/access/access";
import { requirePermission } from "@/lib/access/route-guards";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { formatMoney } from "@/lib/finance/finance";
import {
  ETIQUETA_ESTADO,
  ETIQUETA_FILTRO,
  FILTROS_ESTADO,
  contarPorFiltro,
  estadoVisible,
  filtrarPresupuestos,
  leerFiltroEstado,
  type EstadoVisible,
  type FiltroEstado,
} from "@/lib/finance/presupuestos";
import { listPresupuestosDeClinica } from "@/lib/finance/presupuestos.functions";
import { str } from "@/lib/search";
import { cn } from "@/lib/utils";

type PresupuestosSearch = { estado?: FiltroEstado; q?: string };

/**
 * Presupuestos de toda la clínica (UX-13, Ola 0). Antes solo se veían
 * dentro de cada ficha: no había forma de responder "¿qué presupuestos
 * siguen sin respuesta?". Solo lectura; crear y editar sigue en la ficha.
 */
export const Route = createFileRoute("/_authenticated/_clinic/presupuestos")({
  beforeLoad: requirePermission("finance:view"),
  validateSearch: (search: Record<string, unknown>): PresupuestosSearch => {
    const out: PresupuestosSearch = {};
    const estado = leerFiltroEstado(search.estado);
    if (estado !== "todos") out.estado = estado;
    const q = str(search.q).trim();
    if (q) out.q = q;
    return out;
  },
  head: () => ({
    meta: [{ title: "Presupuestos | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: PresupuestosPage,
});

const TONO_ESTADO: Record<EstadoVisible, string> = {
  borrador: "border-border bg-muted text-muted-foreground",
  enviado: "border-info-border bg-info-soft text-info",
  aceptado: "border-success-border bg-success-soft text-success",
  convertido: "border-success-border bg-success-soft text-success",
  rechazado: "border-destructive-border bg-destructive-soft text-destructive",
  vencido: "border-warning-border bg-warning-soft text-warning",
};

function fechaCorta(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}

/** `valid_until` es una fecha sin hora: se formatea tal cual, sin huso. */
function fechaSinHora(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(a, m - 1, d)));
}

function PresupuestosPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const clinicId = access.clinic!.id;
  const tz = access.clinic!.timezone;
  const hoy = hoyISO(tz);
  const estado = search.estado ?? "todos";
  const termino = search.q ?? "";
  const puedeAbrirFichas = hasPermission(access.role, "patients:view");

  const fetchLista = useServerFn(listPresupuestosDeClinica);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["presupuestos-clinica", clinicId],
    queryFn: () => fetchLista({ data: { clinicId } }),
  });

  const todos = useMemo(() => data?.presupuestos ?? [], [data]);
  const cuentas = useMemo(() => contarPorFiltro(todos, hoy), [todos, hoy]);
  const filtrados = useMemo(
    () => filtrarPresupuestos(todos, { estado, termino, hoy }),
    [todos, estado, termino, hoy],
  );

  function cambiar(next: PresupuestosSearch) {
    void navigate({
      search: (prev) => {
        const merged = { ...prev, ...next };
        const out: PresupuestosSearch = {};
        if (merged.estado && merged.estado !== "todos") out.estado = merged.estado;
        if (merged.q) out.q = merged.q;
        return out;
      },
      replace: true,
    });
  }

  return (
    <AppShell title="Presupuestos" access={access}>
      <div className="space-y-6">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Todos los presupuestos de la clínica en un solo lugar. Para crear, enviar o cobrar uno,
          abre la ficha del paciente.
        </p>

        <div className="space-y-3">
          <div
            role="group"
            aria-label="Filtrar por estado"
            className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
          >
            {FILTROS_ESTADO.map((f) => {
              const activo = estado === f;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => cambiar({ estado: f })}
                  className={cn(
                    "flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                    activo
                      ? "border-brand bg-brand-soft text-brand-800"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {ETIQUETA_FILTRO[f]}
                  <span className="cifra text-xs tabular-nums">{cuentas[f]}</span>
                </button>
              );
            })}
          </div>
          <SearchField
            label="Buscar"
            placeholder="Paciente o número de presupuesto"
            value={termino}
            onChange={(v) => cambiar({ q: v })}
            className="max-w-md"
          />
        </div>

        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando presupuestos…
          </p>
        ) : isError ? (
          <ErrorDeCarga
            onReintentar={refetch}
            reintentando={isFetching}
            mensaje="No pudimos cargar los presupuestos."
          />
        ) : filtrados.length === 0 ? (
          <div className="card-clinical px-5 py-10 text-center text-sm text-muted-foreground">
            {todos.length === 0
              ? "Todavía no hay presupuestos. Se crean desde la pestaña Finanzas de la ficha de cada paciente."
              : "Ningún presupuesto coincide con estos filtros."}
          </div>
        ) : (
          <div className="card-clinical overflow-hidden">
            {/* Tabla en escritorio, lista en el celular: la tabla no ensancha la página. */}
            <table className="hidden w-full text-sm md:table">
              <caption className="sr-only">Presupuestos de la clínica</caption>
              <thead>
                <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Número
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Paciente
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Fecha
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Válido hasta
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Estado
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Monto
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => {
                  const e = estadoVisible(p, hoy);
                  return (
                    <tr key={p.id} className="border-b border-hairline last:border-0">
                      <td className="cifra px-5 py-3 text-muted-foreground">{p.number}</td>
                      <td className="px-3 py-3">
                        <NombrePaciente
                          id={p.patientId}
                          nombre={p.patientName}
                          enlazar={puedeAbrirFichas}
                        />
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {fechaCorta(p.createdAt, tz)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {p.validUntil ? fechaSinHora(p.validUntil) : "Sin fecha"}
                      </td>
                      <td className="px-3 py-3">
                        <ChipEstado estado={e} />
                      </td>
                      <td className="cifra px-5 py-3 text-right tabular-nums">
                        {formatMoney(p.totalCents, p.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="divide-y divide-hairline md:hidden">
              {filtrados.map((p) => {
                const e = estadoVisible(p, hoy);
                return (
                  <li key={p.id} className="space-y-1.5 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate font-medium">
                        <NombrePaciente
                          id={p.patientId}
                          nombre={p.patientName}
                          enlazar={puedeAbrirFichas}
                        />
                      </span>
                      <span className="cifra shrink-0 tabular-nums">
                        {formatMoney(p.totalCents, p.currency)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <ChipEstado estado={e} />
                      <span className="cifra">{p.number}</span>
                      <span>{fechaCorta(p.createdAt, tz)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {data?.truncado && (
          <p className="text-xs text-muted-foreground">
            Se muestran los 500 presupuestos más recientes.
          </p>
        )}
      </div>
    </AppShell>
  );
}

function ChipEstado({ estado }: { estado: EstadoVisible }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        TONO_ESTADO[estado],
      )}
    >
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}

function NombrePaciente({
  id,
  nombre,
  enlazar,
}: {
  id: string;
  nombre: string | null;
  enlazar: boolean;
}) {
  if (!nombre) return <span className="text-muted-foreground">Paciente no disponible</span>;
  if (!enlazar) return <>{nombre}</>;
  return (
    <Link
      to="/pacientes/$pacienteId"
      params={{ pacienteId: id }}
      search={{ pestana: "finanzas" }}
      className="underline decoration-border underline-offset-4 hover:text-brand-700 hover:decoration-brand"
    >
      {nombre}
    </Link>
  );
}
