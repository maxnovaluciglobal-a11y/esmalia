import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Loader2, Package, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { ETIQUETA_ESTADO_PLAN } from "@/lib/finance/estados-presupuesto";
import {
  fechaHoraPlanilla,
  fechaPlanilla,
  montoPlanilla,
  type ColumnaLista,
} from "@/lib/exportacion/listas-csv";
import { ErrorDeCarga } from "@/components/estado-error";
import {
  AvatarIniciales,
  BOTON_PASTILLA,
  BuscadorCompacto,
  ChipFiltro,
  EncabezadoEditorial,
  FiltroCompacto,
  LimpiarFiltros,
  PANEL_LISTA,
} from "@/components/a-plus/lista";
import { EmbudoPresupuestos } from "@/components/presupuestos/embudo-presupuestos";
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
import { fecha, numero, relativa } from "@/lib/formato-fecha";
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

  const columnasCsv: ColumnaLista<PresupuestoDeClinica>[] = [
    { header: "Número", value: (p) => p.number },
    { header: "Paciente", value: (p) => p.patientName },
    { header: "Profesional", value: (p) => p.professionalName },
    { header: "Estado", value: (p) => ETIQUETA_ESTADO_PLAN[estadoDe(p, hoy)] },
    { header: "Creado", value: (p) => fechaPlanilla(p.createdAt, tz) },
    { header: "Enviado", value: (p) => fechaPlanilla(p.sentAt, tz) },
    { header: "Válido hasta", value: (p) => fechaPlanilla(p.validUntil, tz) },
    { header: "Aceptado", value: (p) => fechaPlanilla(p.acceptedAt, tz) },
    { header: "Rechazado", value: (p) => fechaPlanilla(p.rejectedAt, tz) },
    {
      header: "Total",
      value: (p) => montoPlanilla(p.totalCents, p.currency),
      dinero: true,
    },
    {
      header: "Total aceptado",
      value: (p) => montoPlanilla(p.acceptedTotalCents, p.currency),
      dinero: true,
    },
    { header: "Moneda", value: (p) => p.currency, dinero: true },
    {
      header: "Último contacto",
      value: (p) => fechaHoraPlanilla(p.ultimoContactoAt, tz),
    },
    { header: "Próxima acción", value: (p) => p.proximaAccion },
    {
      header: "Fecha próxima acción",
      value: (p) => fechaPlanilla(p.proximaAccionOn, tz),
    },
  ];

  const pendientes = resumen.pendientes;
  const porVencer = resumen.por_vencer;

  return (
    <AppShell title="Presupuestos" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-6 text-base max-md:space-y-5">
        <EncabezadoEditorial
          contexto={[
            access.clinic!.name,
            !isLoading && porVencer.cantidad > 0 && `${numero(porVencer.cantidad)} por vencer`,
          ]}
          titulo={
            isLoading
              ? "Presupuestos"
              : `${numero(pendientes.cantidad)} ${pendientes.cantidad === 1 ? "presupuesto" : "presupuestos"}`
          }
          enfasis={
            isLoading ? undefined : `${pendientes.cantidad === 1 ? "pendiente" : "pendientes"}`
          }
          acciones={
            <>
              <ExportarCsvLista<PresupuestoDeClinica>
                clinicId={clinicId}
                rol={access.role}
                lista="presupuestos"
                filas={filtrados}
                timezone={tz}
                filtros={{ estado, q: termino, profesional }}
                columnas={columnasCsv}
              />
              {puedeConfigurar && <ConfigurarValidez clinicId={clinicId} />}
              <Link to="/presupuestos/paquetes" className={BOTON_PASTILLA}>
                <Package className="size-4" aria-hidden /> Paquetes
              </Link>
            </>
          }
        >
          <p className="mt-2 text-sm text-muted-foreground">
            {!isLoading && pendientes.cantidad > 0 && (
              <>
                Esperan respuesta por{" "}
                <span className="cifra text-foreground">
                  {formatMoney(pendientes.montoCents, moneda0)}
                </span>
                .{" "}
              </>
            )}
            Para crear uno, abre la ficha del paciente.
          </p>
        </EncabezadoEditorial>

        {!isLoading && !isError && todos.length > 0 && (
          <EmbudoPresupuestos f={funnel} moneda={moneda0} />
        )}

        <div className="space-y-3">
          <div
            role="group"
            aria-label="Filtrar por estado"
            className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
          >
            {FILTROS_ESTADO.map((f) => (
              <ChipFiltro
                key={f}
                activo={estado === f}
                onClick={() => cambiar({ estado: f })}
                className="h-auto min-h-[30px] py-1"
              >
                {ETIQUETA_FILTRO[f]}
                <span className="cifra text-[11.5px] font-normal tabular-nums opacity-80">
                  {resumen[f].cantidad}
                </span>
                <span className="cifra hidden text-[11.5px] font-normal tabular-nums opacity-70 sm:inline">
                  · {formatMoney(resumen[f].montoCents, moneda0)}
                </span>
              </ChipFiltro>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BuscadorCompacto
              etiqueta="Buscar presupuestos"
              placeholder="Paciente o número"
              valor={termino}
              onChange={(v) => cambiar({ q: v })}
              className="sm:w-72"
            />
            <FiltroCompacto
              etiqueta="Profesional"
              valor={profesional === "todos" ? "" : profesional}
              onChange={(v) => cambiar({ prof: v || "todos" })}
              todas="Profesional"
              opciones={[
                { value: "sin_asignar", label: "Sin asignar" },
                ...(data?.profesionales ?? []).map((p) => ({ value: p.id, label: p.nombre })),
              ]}
            />
            {(termino || profesional !== "todos") && (
              <LimpiarFiltros onClick={() => cambiar({ q: "", prof: "todos" })} />
            )}
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
          <div className={cn(PANEL_LISTA, "px-5 py-10 text-center")}>
            <p className="font-display text-2xl font-medium">
              {todos.length === 0
                ? "Todavía no hay presupuestos."
                : estado === "por_vencer"
                  ? "Nada por vencer esta semana."
                  : "Ningún presupuesto coincide."}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {todos.length === 0
                ? "Se crean desde la pestaña Finanzas de la ficha de cada paciente."
                : estado === "por_vencer"
                  ? "Ningún presupuesto pendiente vence en los próximos 7 días."
                  : "Prueba con otra pestaña o limpia la búsqueda."}
            </p>
          </div>
        ) : (
          <div className={cn(PANEL_LISTA, "overflow-hidden")}>
            {/* Tabla en escritorio, tarjetas en el celular: la tabla no ensancha la página. */}
            <table className="hidden w-full border-collapse text-sm lg:table">
              <caption className="sr-only">Presupuestos de la clínica</caption>
              <thead>
                <tr className="border-b border-control/50 text-left text-xs font-semibold text-muted-foreground">
                  <th scope="col" className="py-2.5 pr-3 pl-5 font-semibold">
                    Paciente
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Presupuesto
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Estado
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Seguimiento
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Monto
                  </th>
                  {puedeSeguir && (
                    <th scope="col" className="w-12 py-2.5 pr-5 pl-3">
                      <span className="sr-only">Acciones</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-hairline align-middle last:border-0 hover:bg-muted/40"
                  >
                    <td className="py-3 pr-3 pl-5">
                      <div className="flex items-center gap-3">
                        <AvatarIniciales nombre={p.patientName ?? "?"} />
                        <span className="font-display text-[18px] font-medium leading-tight">
                          <NombrePaciente
                            id={p.patientId}
                            nombre={p.patientName}
                            enlazar={puedeAbrirFichas}
                          />
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        to="/presupuestos/$presupuestoId"
                        params={{ presupuestoId: p.id }}
                        className="cifra rounded-sm font-medium underline decoration-border underline-offset-4 outline-none hover:text-brand-700 hover:decoration-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {p.number}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {fecha(p.createdAt, tz)} · {p.professionalName ?? "Sin asignar"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <EstadoCelda p={p} hoy={hoy} />
                    </td>
                    <td className="px-3 py-3">
                      <SeguimientoCelda p={p} hoy={hoy} tz={tz} />
                    </td>
                    <td className="cifra px-3 py-3 text-right text-[14.5px] tabular-nums whitespace-nowrap">
                      <Monto p={p} />
                    </td>
                    {puedeSeguir && (
                      <td className="py-2 pr-5 pl-3 text-right">
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
                <li key={p.id} className="space-y-2.5 px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <AvatarIniciales nombre={p.patientName ?? "?"} />
                      <span className="min-w-0 truncate font-display text-[18px] font-medium leading-tight">
                        <NombrePaciente
                          id={p.patientId}
                          nombre={p.patientName}
                          enlazar={puedeAbrirFichas}
                        />
                      </span>
                    </div>
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
                      className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700"
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
        <Button
          variant="ghost"
          className="h-10 rounded-full px-4 text-[14.5px] pointer-coarse:h-11"
        >
          <Settings2 className="size-4" aria-hidden /> Validez:{" "}
          <span className="cifra">{data?.diasValidez ?? 30}</span> días
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
