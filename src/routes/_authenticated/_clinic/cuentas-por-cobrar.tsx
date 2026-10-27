import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { fechaPlanilla, montoPlanilla } from "@/lib/exportacion/listas-csv";
import { ErrorDeCarga } from "@/components/estado-error";
import { SearchField } from "@/components/filters";
import { ChipEstadoCuenta } from "@/components/finance/chip-estado-cuenta";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
import { hasPermission } from "@/lib/access/access";
import { requirePermission } from "@/lib/access/route-guards";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import {
  ETIQUETA_ESTADO_CUENTA,
  ETIQUETA_FILTRO_CUENTA,
  ETIQUETA_TRAMO,
  FILTROS_CUENTA,
  TRAMOS_ATRASO,
  contarPorFiltro,
  filtrarCuentas,
  leerFiltroCuenta,
  leerTramo,
  totalesCartera,
  type CuentaPorCobrar,
  type FiltroCuenta,
  type TramoAtraso,
} from "@/lib/finance/cuentas-por-cobrar";
import { listCuentasPorCobrar } from "@/lib/finance/cuentas-por-cobrar.functions";
import { formatMoney } from "@/lib/finance/finance";
import { fecha } from "@/lib/formato-fecha";
import { str } from "@/lib/search";
import { cn } from "@/lib/utils";

type Busqueda = { estado?: FiltroCuenta; tramo?: TramoAtraso; q?: string };

/**
 * Cartera de cuentas por cobrar de la clínica (FIN-02). Una fila por cuenta
 * (presupuesto aceptado o plan), con su estado, lo vencido y los días de
 * atraso. La ficha del paciente sigue siendo donde se cobra y se arman las
 * cuotas; esta es la lista de trabajo de "a quién llamar hoy".
 */
export const Route = createFileRoute("/_authenticated/_clinic/cuentas-por-cobrar")({
  beforeLoad: requirePermission("finance:view"),
  validateSearch: (search: Record<string, unknown>): Busqueda => {
    const out: Busqueda = {};
    const estado = leerFiltroCuenta(search.estado);
    if (estado !== "por_cobrar") out.estado = estado;
    const tramo = leerTramo(search.tramo);
    if (tramo !== "todos") out.tramo = tramo;
    const q = str(search.q).trim();
    if (q) out.q = q;
    return out;
  },
  head: () => ({
    meta: [{ title: "Cuentas por cobrar | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: CuentasPorCobrarPage,
});

const PILDORA =
  "flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors";
const PILDORA_ACTIVA = "border-brand bg-brand-soft text-brand-800";
const PILDORA_INACTIVA = "border-border text-muted-foreground hover:text-foreground";

function CuentasPorCobrarPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const clinicId = access.clinic!.id;
  const currency = access.clinic?.currency ?? "CLP";
  const timezone = access.clinic?.timezone ?? "America/Santiago";
  const estado = search.estado ?? "por_cobrar";
  const tramo = search.tramo ?? "todos";
  const termino = search.q ?? "";
  const puedeAbrirFichas = hasPermission(access.role, "patients:view");

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId } }),
    staleTime: 60 * 1000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  const fetchLista = useServerFn(listCuentasPorCobrar);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["cuentas-por-cobrar", clinicId],
    queryFn: () => fetchLista({ data: { clinicId } }),
    enabled: !bloqueado,
  });

  const todas = useMemo(() => data?.cuentas ?? [], [data]);
  const cuentasPorFiltro = useMemo(() => contarPorFiltro(todas), [todas]);
  const totales = useMemo(() => totalesCartera(todas), [todas]);
  const filtradas = useMemo(
    () => filtrarCuentas(todas, { estado, tramo, termino }),
    [todas, estado, tramo, termino],
  );

  function cambiar(next: { estado?: FiltroCuenta; tramo?: TramoAtraso | "todos"; q?: string }) {
    void navigate({
      search: (prev) => {
        const merged = { ...prev, ...next };
        const out: Busqueda = {};
        if (merged.estado && merged.estado !== "por_cobrar") out.estado = merged.estado;
        if (merged.tramo && merged.tramo !== "todos") out.tramo = merged.tramo;
        if (merged.q) out.q = merged.q;
        return out;
      },
      replace: true,
    });
  }

  return (
    <AppShell title="Cuentas por cobrar" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Cuentas por cobrar" sub={sub ?? null} />
      ) : (
        <div className="space-y-6">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Cada presupuesto aceptado deja su cuenta por cobrar. Para cobrar, dividir en cuotas o
            anular una cuenta, abre la ficha del paciente.
          </p>

          {data && (
            <dl className="grid gap-3 sm:grid-cols-3">
              <Cifra
                titulo="Por cobrar"
                valor={formatMoney(totales.porCobrarCents, currency)}
                detalle={`${totales.cuentasPorCobrar} cuenta${totales.cuentasPorCobrar === 1 ? "" : "s"}`}
              />
              <Cifra
                titulo="Vencido"
                valor={formatMoney(totales.vencidoCents, currency)}
                detalle={`${totales.cuentasVencidas} cuenta${totales.cuentasVencidas === 1 ? "" : "s"} con atraso`}
                alerta={totales.vencidoCents > 0}
              />
              <Cifra
                titulo="Más de 90 días"
                valor={formatMoney(totales.porTramo["90+"], currency)}
                detalle="saldo de cuentas con más de 90 días de atraso"
                alerta={totales.porTramo["90+"] > 0}
              />
            </dl>
          )}

          <div className="space-y-3">
            <div
              role="group"
              aria-label="Filtrar por estado"
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
            >
              {FILTROS_CUENTA.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={estado === f}
                  onClick={() => cambiar({ estado: f })}
                  className={cn(PILDORA, estado === f ? PILDORA_ACTIVA : PILDORA_INACTIVA)}
                >
                  {ETIQUETA_FILTRO_CUENTA[f]}
                  <span className="cifra text-xs tabular-nums">{cuentasPorFiltro[f]}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <SearchField
                label="Buscar"
                placeholder="Paciente o presupuesto"
                value={termino}
                onChange={(v) => cambiar({ q: v })}
                className="w-full max-w-md"
              />
              <label className="block w-full sm:w-56">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Antigüedad
                </span>
                <select
                  value={tramo}
                  onChange={(e) => cambiar({ tramo: leerTramo(e.target.value) })}
                  className="h-10 w-full rounded-lg border border-hairline bg-transparent px-3 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <option value="todos">Cualquier antigüedad</option>
                  {TRAMOS_ATRASO.map((t) => (
                    <option key={t} value={t}>
                      {ETIQUETA_TRAMO[t]}
                    </option>
                  ))}
                </select>
              </label>
              <ExportarCsvLista<CuentaPorCobrar>
                className="sm:ml-auto"
                clinicId={clinicId}
                rol={access.role}
                lista="cuentas_por_cobrar"
                filas={filtradas}
                timezone={timezone}
                filtros={{ estado, tramo, q: termino }}
                columnas={[
                  { header: "Paciente", value: (c) => c.patientName },
                  { header: "Detalle", value: (c) => c.description },
                  { header: "Estado", value: (c) => ETIQUETA_ESTADO_CUENTA[c.resumen.estado] },
                  { header: "Emitida", value: (c) => fechaPlanilla(c.issuedOn, timezone) },
                  { header: "Vencimiento", value: (c) => fechaPlanilla(c.dueOn, timezone) },
                  {
                    header: "Próximo vencimiento",
                    value: (c) => fechaPlanilla(c.resumen.proximoVencimiento, timezone),
                  },
                  { header: "Días de atraso", value: (c) => c.resumen.diasDeAtraso },
                  { header: "Antigüedad", value: (c) => ETIQUETA_TRAMO[c.resumen.tramo] },
                  {
                    header: "Monto",
                    value: (c) => montoPlanilla(c.amountCents, c.currency),
                    dinero: true,
                  },
                  {
                    header: "Pagado",
                    value: (c) => montoPlanilla(c.resumen.pagadoCents, c.currency),
                    dinero: true,
                  },
                  {
                    header: "Saldo",
                    value: (c) => montoPlanilla(c.resumen.saldoCents, c.currency),
                    dinero: true,
                  },
                  {
                    header: "Vencido",
                    value: (c) => montoPlanilla(c.resumen.vencidoCents, c.currency),
                    dinero: true,
                  },
                  { header: "Moneda", value: (c) => c.currency, dinero: true },
                  { header: "Último pago", value: (c) => fechaPlanilla(c.ultimoPagoAt, timezone) },
                  { header: "Anulada", value: (c) => fechaPlanilla(c.voidedAt, timezone) },
                  { header: "Motivo de anulación", value: (c) => c.voidReason },
                ]}
              />
            </div>
          </div>

          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Calculando la cartera…
            </p>
          ) : isError ? (
            <ErrorDeCarga
              onReintentar={refetch}
              reintentando={isFetching}
              mensaje="No pudimos cargar las cuentas por cobrar."
            />
          ) : filtradas.length === 0 ? (
            <div className="card-clinical px-5 py-10 text-center text-sm text-muted-foreground">
              {todas.length === 0
                ? "Todavía no hay cuentas por cobrar. Se crean solas al aceptar un presupuesto en la ficha del paciente."
                : "Ninguna cuenta coincide con estos filtros."}
            </div>
          ) : (
            <div className="card-clinical overflow-hidden">
              <table className="hidden w-full text-sm md:table">
                <caption className="sr-only">Cuentas por cobrar de la clínica</caption>
                <thead>
                  <tr className="border-b border-hairline text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-5 py-3 font-medium">
                      Paciente
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Cuenta
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Estado
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Próximo vencimiento
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">
                      Atraso
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">
                      Vencido
                    </th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">
                      Saldo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((c) => (
                    <tr key={c.id} className="border-b border-hairline last:border-0">
                      <td className="px-5 py-3">
                        <NombrePaciente cuenta={c} enlazar={puedeAbrirFichas} />
                      </td>
                      <td className="px-3 py-3">
                        <span className="block">{c.description}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatMoney(c.amountCents, c.currency)} · {fecha(c.issuedOn)}
                          {c.resumen.cuotas.length > 0 && ` · ${c.resumen.cuotas.length} cuotas`}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <ChipEstadoCuenta estado={c.resumen.estado} />
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {c.resumen.proximoVencimiento
                          ? fecha(c.resumen.proximoVencimiento)
                          : "Sin vencimiento"}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {c.resumen.diasDeAtraso !== null
                          ? `${c.resumen.diasDeAtraso} día${c.resumen.diasDeAtraso === 1 ? "" : "s"}`
                          : "—"}
                      </td>
                      <td
                        className={cn(
                          "cifra px-3 py-3 text-right tabular-nums",
                          c.resumen.vencidoCents > 0 && "text-destructive",
                        )}
                      >
                        {formatMoney(c.resumen.vencidoCents, c.currency)}
                      </td>
                      <td className="cifra px-5 py-3 text-right tabular-nums">
                        {formatMoney(c.resumen.saldoCents, c.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="divide-y divide-hairline md:hidden">
                {filtradas.map((c) => (
                  <li key={c.id} className="space-y-1.5 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate font-medium">
                        <NombrePaciente cuenta={c} enlazar={puedeAbrirFichas} />
                      </span>
                      <span className="cifra shrink-0 tabular-nums">
                        {formatMoney(c.resumen.saldoCents, c.currency)}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{c.description}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <ChipEstadoCuenta estado={c.resumen.estado} />
                      {c.resumen.diasDeAtraso !== null ? (
                        <span className="text-destructive">
                          {formatMoney(c.resumen.vencidoCents, c.currency)} vencido ·{" "}
                          {c.resumen.diasDeAtraso} día{c.resumen.diasDeAtraso === 1 ? "" : "s"}
                        </span>
                      ) : c.resumen.proximoVencimiento ? (
                        <span>Vence {fecha(c.resumen.proximoVencimiento)}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Cifra({
  titulo,
  valor,
  detalle,
  alerta = false,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  alerta?: boolean;
}) {
  return (
    <div className="card-clinical px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{titulo}</dt>
      <dd className={cn("cifra mt-1 text-lg font-semibold", alerta && "text-destructive")}>
        {valor}
      </dd>
      <dd className="text-xs text-muted-foreground">{detalle}</dd>
    </div>
  );
}

function NombrePaciente({ cuenta, enlazar }: { cuenta: CuentaPorCobrar; enlazar: boolean }) {
  if (!cuenta.patientName)
    return <span className="text-muted-foreground">Paciente no disponible</span>;
  if (!enlazar) return <>{cuenta.patientName}</>;
  return (
    <Link
      to="/pacientes/$pacienteId"
      params={{ pacienteId: cuenta.patientId }}
      search={{ pestana: "finanzas" }}
      className="underline decoration-border underline-offset-4 hover:text-brand-700 hover:decoration-brand"
    >
      {cuenta.patientName}
    </Link>
  );
}
