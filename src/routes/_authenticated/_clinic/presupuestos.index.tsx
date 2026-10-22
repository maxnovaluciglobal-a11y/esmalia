import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Loader2, Package, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { SearchField, SelectField } from "@/components/filters";
import {
  SeguimientoDialog,
  type ValoresSeguimiento,
} from "@/components/presupuestos/dialogos-estado";
import { AvisoValidez, ChipEstadoPlan } from "@/components/presupuestos/estado-plan";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSoloLectura } from "@/hooks/use-solo-lectura";
import { hasPermission } from "@/lib/access/access";
import { requirePermission } from "@/lib/access/route-guards";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { formatMoney } from "@/lib/finance/finance";
import {
  ETIQUETA_FILTRO,
  FILTROS_ESTADO,
  FILTRO_POR_DEFECTO,
  embudo,
  estadoDe,
  filtrarPresupuestos,
  leerFiltroEstado,
  montoDe,
  resumenPorFiltro,
  seguimientoAtrasado,
  deProfesional,
  type FiltroEstado,
  type PresupuestoDeClinica,
} from "@/lib/finance/presupuestos";
import {
  actualizarSeguimiento,
  getConfiguracionPresupuestos,
  guardarValidezPorDefecto,
  listPresupuestosDeClinica,
} from "@/lib/finance/presupuestos.functions";
import { fecha, relativa } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { str } from "@/lib/search";
import { cn } from "@/lib/utils";

type PresupuestosSearch = { estado?: FiltroEstado; q?: string; prof?: string };

/**
 * Presupuestos de toda la clínica (UX-13 de la Ola 0, UX-16 de la Ola 3):
 * embudo emitidos → aceptados con montos, pestañas de trabajo (pendientes,
 * por vencer, aceptados, rechazados), seguimiento (último contacto y próxima
 * acción) y filtro por profesional. Cada fila abre el detalle del plan.
 */
export const Route = createFileRoute("/_authenticated/_clinic/presupuestos/")({
  beforeLoad: requirePermission("finance:view"),
  validateSearch: (search: Record<string, unknown>): PresupuestosSearch => {
    const out: PresupuestosSearch = {};
    const estado = leerFiltroEstado(search.estado);
    if (estado !== FILTRO_POR_DEFECTO) out.estado = estado;
    const q = str(search.q).trim();
    if (q) out.q = q;
    const prof = str(search.prof).trim();
    if (prof) out.prof = prof;
    return out;
  },
  head: () => ({
    meta: [{ title: "Presupuestos | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: PresupuestosPage,
});

function PresupuestosPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const clinicId = access.clinic!.id;
  const tz = access.clinic!.timezone;
  const moneda = access.clinic!.currency;
  const hoy = hoyISO(tz);
  const estado = search.estado ?? FILTRO_POR_DEFECTO;
  const termino = search.q ?? "";
  const profesional = search.prof ?? "todos";
  const puedeAbrirFichas = hasPermission(access.role, "patients:view");
  const puedeSeguir = hasPermission(access.role, "patients:manage");
  const puedeConfigurar = hasPermission(access.role, "settings:manage");
  const queryClient = useQueryClient();

  const fetchLista = useServerFn(listPresupuestosDeClinica);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["presupuestos-clinica", clinicId],
    queryFn: () => fetchLista({ data: { clinicId } }),
  });

  const todos = useMemo(() => data?.presupuestos ?? [], [data]);
  const delProfesional = useMemo(
    () => todos.filter((p) => deProfesional(p, profesional)),
    [todos, profesional],
  );
  const resumen = useMemo(() => resumenPorFiltro(delProfesional, hoy), [delProfesional, hoy]);
  const funnel = useMemo(() => embudo(delProfesional), [delProfesional]);
  const filtrados = useMemo(
    () => filtrarPresupuestos(todos, { estado, termino, hoy, profesional }),
    [todos, estado, termino, hoy, profesional],
  );
  const moneda0 = todos[0]?.currency ?? moneda;

  const seguimientoFn = useServerFn(actualizarSeguimiento);
  const seguimiento = useMutation({
    mutationFn: (v: {
      quoteId: string;
      contactado: boolean;
      nota?: string;
      proximaAccion: string | null;
      proximaAccionOn: string | null;
      professionalId: string | null;
    }) => seguimientoFn({ data: { clinicId, ...v } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["presupuestos-clinica", clinicId] });
      toast.success("Seguimiento guardado");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  function cambiar(next: PresupuestosSearch) {
    void navigate({
      search: (prev) => {
        const merged = { ...prev, ...next };
        const out: PresupuestosSearch = {};
        if (merged.estado && merged.estado !== FILTRO_POR_DEFECTO) out.estado = merged.estado;
        if (merged.q) out.q = merged.q;
        if (merged.prof && merged.prof !== "todos") out.prof = merged.prof;
        return out;
      },
      replace: true,
    });
  }

  return (
    <AppShell title="Presupuestos" access={access}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Todos los presupuestos de la clínica: qué falta responder, qué está por vencer y cuánto
            se aceptó. Para crear uno, abre la ficha del paciente.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {puedeConfigurar && <ConfigurarValidez clinicId={clinicId} />}
            <Button size="sm" variant="outline" asChild>
              <Link to="/presupuestos/paquetes">
                <Package className="size-3.5" /> Paquetes
              </Link>
            </Button>
          </div>
        </div>

        {!isLoading && !isError && todos.length > 0 && <Embudo f={funnel} moneda={moneda0} />}

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
                    "flex min-h-11 shrink-0 flex-col items-start justify-center rounded-lg border px-3 py-1 text-left text-sm transition-colors",
                    activo
                      ? "border-brand bg-brand-soft text-brand-800"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {ETIQUETA_FILTRO[f]}
                    <span className="cifra text-xs tabular-nums">{resumen[f].cantidad}</span>
                  </span>
                  <span className="cifra text-[11px] tabular-nums opacity-80">
                    {formatMoney(resumen[f].montoCents, moneda0)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <SearchField
              label="Buscar"
              placeholder="Paciente o número de presupuesto"
              value={termino}
              onChange={(v) => cambiar({ q: v })}
              className="w-full max-w-md"
            />
            <SelectField
              label="Profesional"
              value={profesional === "todos" ? "" : profesional}
              onChange={(v) => cambiar({ prof: v || "todos" })}
              options={[
                { value: "sin_asignar", label: "Sin asignar" },
                ...(data?.profesionales ?? []).map((p) => ({ value: p.id, label: p.nombre })),
              ]}
            />
          </div>
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
              : estado === "por_vencer"
                ? "Ningún presupuesto pendiente vence en los próximos 7 días."
                : "Ningún presupuesto coincide con estos filtros."}
          </div>
        ) : (
          <div className="card-clinical overflow-hidden">
            {/* Tabla en escritorio, lista en el celular: la tabla no ensancha la página. */}
            <table className="hidden w-full text-sm lg:table">
              <caption className="sr-only">Presupuestos de la clínica</caption>
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Presupuesto
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Paciente
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Estado
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Seguimiento
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Monto
                  </th>
                  {puedeSeguir && (
                    <th scope="col" className="w-12 px-3 py-3">
                      <span className="sr-only">Acciones</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => (
                  <tr key={p.id} className="border-b border-hairline align-top last:border-0">
                    <td className="px-5 py-3">
                      <Link
                        to="/presupuestos/$presupuestoId"
                        params={{ presupuestoId: p.id }}
                        className="cifra font-medium underline decoration-border underline-offset-4 hover:text-brand-700 hover:decoration-brand"
                      >
                        {p.number}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {fecha(p.createdAt, tz)} · {p.professionalName ?? "Sin asignar"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <NombrePaciente
                        id={p.patientId}
                        nombre={p.patientName}
                        enlazar={puedeAbrirFichas}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <EstadoCelda p={p} hoy={hoy} />
                    </td>
                    <td className="px-3 py-3">
                      <SeguimientoCelda p={p} hoy={hoy} tz={tz} />
                    </td>
                    <td className="cifra px-3 py-3 text-right tabular-nums">
                      <Monto p={p} />
                    </td>
                    {puedeSeguir && (
                      <td className="px-3 py-2 text-right">
                        <SeguimientoRapido
                          p={p}
                          profesionales={data?.profesionales ?? []}
                          pending={seguimiento.isPending}
                          onConfirm={(v) => seguimiento.mutate({ quoteId: p.id, ...v })}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-hairline lg:hidden">
              {filtrados.map((p) => (
                <li key={p.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 truncate font-medium">
                      <NombrePaciente
                        id={p.patientId}
                        nombre={p.patientName}
                        enlazar={puedeAbrirFichas}
                      />
                    </span>
                    <span className="cifra shrink-0 text-right tabular-nums">
                      <Monto p={p} />
                    </span>
                  </div>
                  <EstadoCelda p={p} hoy={hoy} />
                  <SeguimientoCelda p={p} hoy={hoy} tz={tz} />
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      to="/presupuestos/$presupuestoId"
                      params={{ presupuestoId: p.id }}
                      className="inline-flex min-h-11 items-center gap-1 text-sm text-brand-700"
                    >
                      <span className="cifra">{p.number}</span> · Ver detalle
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                    {puedeSeguir && (
                      <SeguimientoRapido
                        p={p}
                        profesionales={data?.profesionales ?? []}
                        pending={seguimiento.isPending}
                        onConfirm={(v) => seguimiento.mutate({ quoteId: p.id, ...v })}
                      />
                    )}
                  </div>
                </li>
              ))}
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

function Embudo({ f, moneda }: { f: ReturnType<typeof embudo>; moneda: string }) {
  const pasos = [
    { etiqueta: "Creados", ...f.creados },
    { etiqueta: "Emitidos", ...f.emitidos },
    { etiqueta: "Aceptados", ...f.aceptados },
  ];
  const max = Math.max(1, f.creados.cantidad);
  return (
    <section aria-label="Embudo de presupuestos" className="card-clinical p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold">Embudo</h2>
        <p className="text-sm text-muted-foreground">
          Tasa de aceptación{" "}
          <span className="cifra font-semibold text-foreground">
            {f.tasaAceptacion === null ? "Sin datos" : `${f.tasaAceptacion}%`}
          </span>
        </p>
      </div>
      {/* Tres columnas también en el celular: el embudo se lee de izquierda a derecha. */}
      <ol className="grid grid-cols-3 gap-3 sm:gap-4">
        {pasos.map((p, i) => (
          <li key={p.etiqueta} className="min-w-0 space-y-1.5">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
              <span className="truncate text-[11px] uppercase tracking-wider text-muted-foreground sm:text-xs">
                {p.etiqueta}
              </span>
              <span className="cifra text-base font-semibold tabular-nums sm:text-sm">
                {p.cantidad}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
              <div
                className={cn("h-full rounded-full", i === 2 ? "bg-success" : "bg-brand")}
                style={{ width: `${Math.round((p.cantidad * 100) / max)}%` }}
              />
            </div>
            <p className="cifra truncate text-[11px] tabular-nums text-muted-foreground sm:text-xs">
              {formatMoney(p.montoCents, moneda)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Seguimiento desde la fila. En solo lectura queda deshabilitado (BIL-01). */
function SeguimientoRapido({
  p,
  profesionales,
  pending,
  onConfirm,
}: {
  p: PresupuestoDeClinica;
  profesionales: { id: string; nombre: string }[];
  pending: boolean;
  onConfirm: (v: ValoresSeguimiento) => void;
}) {
  const soloLectura = useSoloLectura();
  return (
    <SeguimientoDialog
      trigger="icono"
      inicial={{
        proximaAccion: p.proximaAccion,
        proximaAccionOn: p.proximaAccionOn,
        professionalId: p.professionalId,
      }}
      profesionales={profesionales}
      pending={pending || soloLectura}
      onConfirm={onConfirm}
    />
  );
}

function EstadoCelda({ p, hoy }: { p: PresupuestoDeClinica; hoy: string }) {
  const e = estadoDe(p, hoy);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <ChipEstadoPlan estado={e} />
      {(e === "borrador" || e === "emitido") && (
        <AvisoValidez validUntil={p.validUntil} hoy={hoy} />
      )}
    </div>
  );
}

function SeguimientoCelda({ p, hoy, tz }: { p: PresupuestoDeClinica; hoy: string; tz: string }) {
  const atrasado = seguimientoAtrasado(p, hoy);
  if (!p.ultimoContactoAt && !p.proximaAccion && !p.proximaAccionOn) {
    return <span className="text-xs text-muted-foreground">Sin seguimiento</span>;
  }
  return (
    <div className="space-y-0.5 text-xs">
      <p className="text-muted-foreground">
        Último contacto: {p.ultimoContactoAt ? relativa(p.ultimoContactoAt, tz) : "Sin datos"}
      </p>
      {(p.proximaAccion || p.proximaAccionOn) && (
        <p className={cn(atrasado ? "font-medium text-destructive" : "text-foreground")}>
          {p.proximaAccion ?? "Próxima acción"}
          {p.proximaAccionOn && ` · ${relativa(`${p.proximaAccionOn}T12:00:00`, tz)}`}
          {atrasado && " (atrasada)"}
        </p>
      )}
    </div>
  );
}

function Monto({ p }: { p: PresupuestoDeClinica }) {
  const monto = montoDe(p);
  return (
    <>
      {formatMoney(monto, p.currency)}
      {monto !== p.totalCents && (
        <span className="block text-[11px] text-muted-foreground">
          de {formatMoney(p.totalCents, p.currency)}
        </span>
      )}
    </>
  );
}

function ConfigurarValidez({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient();
  const fetchConfig = useServerFn(getConfiguracionPresupuestos);
  const { data } = useQuery({
    queryKey: ["presupuestos-config", clinicId],
    queryFn: () => fetchConfig({ data: { clinicId } }),
  });
  const [dias, setDias] = useState<number | null>(null);
  const guardarFn = useServerFn(guardarValidezPorDefecto);
  const guardar = useMutation({
    mutationFn: (n: number) => guardarFn({ data: { clinicId, dias: n } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["presupuestos-config", clinicId] });
      toast.success("Validez por defecto guardada");
      setDias(null);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const valor = dias ?? data?.diasValidez ?? 30;
  const valido = Number.isInteger(valor) && valor >= 1 && valor <= 365;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">
          <Settings2 className="size-3.5" /> Validez: {data?.diasValidez ?? 30} días
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3">
        <div className="space-y-1">
          <label htmlFor="validez-dias" className="text-sm font-medium">
            Validez por defecto
          </label>
          <p className="text-xs text-muted-foreground">
            Días que dura un presupuesto nuevo. Al pasar la fecha queda vencido solo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="validez-dias"
            type="number"
            min={1}
            max={365}
            value={valor}
            onChange={(e) => setDias(Number(e.target.value))}
            className="w-20 rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <span className="text-sm text-muted-foreground">días</span>
          <BloqueoEscritura>
            <Button
              size="sm"
              className="ml-auto"
              disabled={!valido || guardar.isPending}
              onClick={() => guardar.mutate(valor)}
            >
              {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Guardar
            </Button>
          </BloqueoEscritura>
        </div>
      </PopoverContent>
    </Popover>
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
