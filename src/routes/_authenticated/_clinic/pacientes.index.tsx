import { useCallback, useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Circle,
  CircleDashed,
  FileUp,
  MinusCircle,
  Sparkles,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { fechaPlanilla, montoPlanilla, type ColumnaLista } from "@/lib/exportacion/listas-csv";
import type { Paciente } from "@/lib/clinic-operations/clinic-data";
import { ErrorDeCarga } from "@/components/estado-error";
import { Paginacion } from "@/components/filters";
import {
  AvatarIniciales,
  BOTON_PASTILLA,
  BuscadorCompacto,
  ChipFiltro,
  EncabezadoEditorial,
  FiltroCompacto,
  FiltroRangoFechas,
  LimpiarFiltros,
  PANEL_LISTA,
} from "@/components/a-plus/lista";
import { requirePermission } from "@/lib/access/route-guards";
import { hasPermission } from "@/lib/access/access";
import {
  etiquetaEstadoPaciente,
  hoyISO,
  type EstadoPaciente,
} from "@/lib/clinic-operations/clinic-data";
import { formatMoney } from "@/lib/finance/finance";
import { listBranches, listProfessionals } from "@/lib/clinic-operations/clinic-catalog.functions";
import { listPatients } from "@/lib/patients/patients.functions";
import { coincide, num, paginar, str } from "@/lib/search";
import { cn } from "@/lib/utils";
import {
  ETIQUETA_FILTRO_DE_ARCHIVO,
  parseFiltroDeArchivo,
  type FiltroDeArchivo,
} from "@/lib/patients/archivo";
import { NuevoPacienteDialog } from "@/components/nuevo-paciente-dialog";
import {
  columnasConDatos,
  normalizarPorPagina,
  OPCIONES_POR_PAGINA,
  pasaFiltrosRapidos,
  POR_PAGINA_POR_DEFECTO,
  type ColumnasVisibles,
} from "@/lib/patients/lista-pacientes";
import { fecha, mesAnio, numero } from "@/lib/formato-fecha";
import { colorProfesional } from "@/lib/clinic-operations/color-profesional";
import { enmascararDocumento } from "@/lib/patients/encabezado-ficha";
import { esNuevaDelMes, resumenCartera } from "@/lib/patients/cartera";
import { leerPedidoAbrirCaja, PEDIDO_ABRIR } from "@/lib/shell";
import { coincideNombre } from "@/lib/patients/busqueda-tolerante";
import { ETIQUETA_FALTANTE } from "@/lib/patients/datos-ficha";

interface PacientesSearch {
  q: string;
  sucursal: string;
  profesional: string;
  estado: string;
  desde: string;
  hasta: string;
  page: number;
  /** 25, 50 o 100 (UX-15). */
  porPagina?: number;
  /** Filtro rápido: solo quien debe algo. */
  conSaldo?: boolean;
  /** Filtro rápido: solo quien no tiene una cita futura agendada. */
  sinCita?: boolean;
  /** LEG-08: sin valor = solo fichas activas (las archivadas no se listan). */
  archivo?: FiltroDeArchivo;
  /** `1` abre "Nuevo paciente" al entrar (acción del ⌘K) y se borra. */
  nuevo?: typeof PEDIDO_ABRIR;
  /** SEG-08: solo fichas a las que les falta algo (Decreto 41). */
  incompletas?: boolean;
  /** Franja A+: solo fichas activas (no inactivas). */
  activos?: boolean;
  /** Franja A+: fichas creadas este mes (huso de la clínica). */
  nuevos?: boolean;
}

export const Route = createFileRoute("/_authenticated/_clinic/pacientes/")({
  validateSearch: (search: Record<string, unknown>): PacientesSearch => ({
    q: str(search.q),
    sucursal: str(search.sucursal),
    profesional: str(search.profesional),
    estado: str(search.estado),
    desde: str(search.desde),
    hasta: str(search.hasta),
    page: num(search.page, 1),
    ...(search.porPagina ? { porPagina: normalizarPorPagina(search.porPagina) } : {}),
    ...(search.conSaldo === true || search.conSaldo === "1" ? { conSaldo: true } : {}),
    ...(search.sinCita === true || search.sinCita === "1" ? { sinCita: true } : {}),
    ...(search.archivo ? { archivo: parseFiltroDeArchivo(search.archivo) } : {}),
    ...(leerPedidoAbrirCaja(search.nuevo) ? { nuevo: PEDIDO_ABRIR } : {}),
    ...(search.incompletas === true || search.incompletas === "1" ? { incompletas: true } : {}),
    ...(search.activos === true || search.activos === "1" ? { activos: true } : {}),
    ...(search.nuevos === true || search.nuevos === "1" ? { nuevos: true } : {}),
  }),
  beforeLoad: requirePermission("patients:view"),
  head: () => ({
    meta: [
      { title: "Pacientes | Esmalia" },
      {
        name: "description",
        content:
          "Listado de pacientes con búsqueda global, filtros por sucursal, profesional, estado y rango de fechas, más paginación.",
      },
      { property: "og:title", content: "Pacientes | Esmalia" },
      {
        property: "og:description",
        content:
          "Búsqueda y filtros avanzados de pacientes con saldo, próximo control y riesgo de ausencia.",
      },
    ],
  }),
  component: PacientesPage,
});

// "" (sin filtro) = solo activas; las otras dos opciones se eligen a propósito.
const filtrosDeArchivo: { value: FiltroDeArchivo; label: string }[] = (
  ["archivadas", "todas"] as FiltroDeArchivo[]
).map((f) => ({ value: f, label: ETIQUETA_FILTRO_DE_ARCHIVO[f] }));

const estados: { value: EstadoPaciente; label: string }[] = (
  ["activo", "nuevo", "inactivo"] as EstadoPaciente[]
).map((e) => ({ value: e, label: etiquetaEstadoPaciente[e] }));

/** Columnas del CSV de la lista (EXP-04): lo que muestra la tabla, legible en Excel. */
function columnasCsvPacientes(
  sucursales: readonly { id: string; nombre: string }[],
  profesionales: readonly { id: string; nombre: string }[],
  currency: string,
  timezone: string,
): ColumnaLista<Paciente>[] {
  const sucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));
  const profesional = new Map(profesionales.map((p) => [p.id, p.nombre]));
  return [
    { header: "Nombre", value: (p) => p.nombre },
    { header: "Documento", value: (p) => p.documento || null },
    { header: "Fecha de nacimiento", value: (p) => fechaPlanilla(p.fechaNacimiento, timezone) },
    { header: "Teléfono", value: (p) => p.telefono || null },
    { header: "Correo", value: (p) => p.email || null },
    { header: "Sucursal", value: (p) => sucursal.get(p.sucursalId) ?? null },
    { header: "Profesional", value: (p) => profesional.get(p.profesionalId) ?? null },
    { header: "Estado", value: (p) => etiquetaEstadoPaciente[p.estado] },
    { header: "Última visita", value: (p) => fechaPlanilla(p.ultimaVisitaISO, timezone) },
    { header: "Próximo control", value: (p) => p.proximoControl },
    { header: "Etiquetas", value: (p) => p.etiquetas.join(", ") || null },
    { header: "Saldo", value: (p) => montoPlanilla(p.saldo, currency), dinero: true },
    { header: "Moneda", value: () => currency, dinero: true },
    { header: "Archivada el", value: (p) => fechaPlanilla(p.archivadaEl, timezone) },
  ];
}

/** Filtros de la URL, como texto, para el registro de la exportación. */
function filtrosParaRegistro(search: Record<string, unknown>): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(search)) {
    if (clave === "page" || clave === "porPagina" || clave === "nuevo") continue;
    if (valor === undefined || valor === null || valor === "") continue;
    salida[clave] = String(valor).slice(0, 200);
  }
  return salida;
}

function PacientesPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const currency = access.clinic?.currency ?? "CLP";
  const navigate = useNavigate({ from: Route.fullPath });
  const clinicId = access.clinic?.id;

  const limpiarPedidoNuevo = useCallback(() => {
    void navigate({ search: (prev) => ({ ...prev, nuevo: undefined }), replace: true });
  }, [navigate]);

  const fetchPatients = useServerFn(listPatients);
  const veFinanzas = hasPermission(access.role, "finance:view");
  const fetchBranches = useServerFn(listBranches);
  const archivo: FiltroDeArchivo = search.archivo ?? "activas";
  const fetchProfessionals = useServerFn(listProfessionals);

  const {
    data: patientsRes,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["patients", clinicId, archivo, "con-saldos", "con-completitud"],
    enabled: Boolean(clinicId),
    queryFn: () =>
      fetchPatients({
        data: { clinicId: clinicId!, archivo, conSaldos: true, conCompletitud: true },
      }),
  });
  const pacientes = useMemo(() => patientsRes?.items ?? [], [patientsRes]);
  const { data: sucursales = [] } = useQuery({
    queryKey: ["branches", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchBranches({ data: { clinicId: clinicId! } }),
  });
  const { data: profesionales = [] } = useQuery({
    queryKey: ["professionals", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchProfessionals({ data: { clinicId: clinicId! } }),
  });

  const timezone = access.clinic?.timezone ?? "America/Santiago";
  const hoy = hoyISO(timezone);

  const set = (patch: Partial<PacientesSearch>) =>
    navigate({ search: (prev: PacientesSearch) => ({ ...prev, ...patch, page: patch.page ?? 1 }) });

  const filtrados = useMemo(
    () =>
      pacientes.filter((p) => {
        // PAC-02: el nombre tolera tildes y errores de tipeo ("jose peres" → José
        // Pérez); documento, email, teléfono y etiquetas, por subcadena (el RUT
        // con o sin puntos y guion: `coincide` los ignora). Funciona sin conexión.
        if (
          !coincideNombre(search.q, p.nombre) &&
          !coincide(search.q, p.documento, p.email, p.telefono, ...p.etiquetas)
        )
          return false;
        if (search.sucursal && p.sucursalId !== search.sucursal) return false;
        if (search.profesional && p.profesionalId !== search.profesional) return false;
        if (search.estado && p.estado !== search.estado) return false;
        if (search.desde && p.ultimaVisitaISO < search.desde) return false;
        if (search.hasta && p.ultimaVisitaISO > search.hasta) return false;
        if (!pasaFiltrosRapidos(p, { conSaldo: search.conSaldo, sinCitaFutura: search.sinCita }))
          return false;
        if (search.incompletas && !(p.faltantes && p.faltantes.length > 0)) return false;
        if (search.activos && (p.archivadaEl || p.estado === "inactivo")) return false;
        if (search.nuevos && !esNuevaDelMes(p, hoy, timezone)) return false;
        return true;
      }),
    [pacientes, search, hoy, timezone],
  );

  // La foto de la cartera: sobre todas las fichas cargadas, no sobre los filtros.
  const cartera = useMemo(
    () => resumenCartera(pacientes, hoy, timezone),
    [pacientes, hoy, timezone],
  );

  const porPagina = search.porPagina ?? POR_PAGINA_POR_DEFECTO;
  const pagina = paginar(filtrados, search.page, porPagina);
  const columnas = columnasConDatos(pagina.items, sucursales.length);
  const plantilla = plantillaDeColumnas(columnas);
  const toggle = (clave: "conSaldo" | "sinCita" | "incompletas" | "activos" | "nuevos") =>
    set({ [clave]: search[clave] ? undefined : true });
  const activos = [
    search.q,
    search.sucursal,
    search.profesional,
    search.estado,
    search.desde,
    search.hasta,
    search.archivo && search.archivo !== "activas" ? search.archivo : "",
    search.conSaldo ? "1" : "",
    search.sinCita ? "1" : "",
    search.incompletas ? "1" : "",
    search.activos ? "1" : "",
    search.nuevos ? "1" : "",
  ].filter(Boolean).length;

  const limpiar = () =>
    navigate({
      search: {
        q: "",
        sucursal: "",
        profesional: "",
        estado: "",
        desde: "",
        hasta: "",
        page: 1,
        porPagina: search.porPagina,
        archivo: undefined,
        conSaldo: undefined,
        sinCita: undefined,
        incompletas: undefined,
        activos: undefined,
        nuevos: undefined,
      },
    });

  const profesionalPorId = new Map(profesionales.map((p) => [p.id, p]));
  const sucursalPorId = new Map(sucursales.map((s) => [s.id, s]));
  const mes = mesAnio(`${hoy}T12:00:00`, timezone).split(" ")[0];

  const tituloArchivo =
    archivo === "archivadas"
      ? { n: cartera.total, texto: cartera.total === 1 ? "ficha" : "fichas", enfasis: "archivadas" }
      : archivo === "todas"
        ? { n: cartera.total, texto: cartera.total === 1 ? "ficha" : "fichas", enfasis: "en total" }
        : {
            n: cartera.activos,
            texto: cartera.activos === 1 ? "paciente" : "pacientes",
            enfasis: cartera.activos === 1 ? "activo" : "activos",
          };

  return (
    <AppShell title="Pacientes" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-6 text-base max-md:space-y-5">
        <EncabezadoEditorial
          contexto={[
            access.clinic?.name,
            !isLoading && cartera.conSaldo && `${numero(cartera.conSaldo.cantidad)} con saldo`,
            !isLoading &&
              cartera.incompletas > 0 &&
              `${numero(cartera.incompletas)} ${cartera.incompletas === 1 ? "ficha incompleta" : "fichas incompletas"}`,
          ]}
          titulo={isLoading ? "Pacientes" : `${numero(tituloArchivo.n)} ${tituloArchivo.texto}`}
          enfasis={isLoading ? undefined : tituloArchivo.enfasis}
          acciones={
            <>
              {clinicId && (
                <ExportarCsvLista<Paciente>
                  clinicId={clinicId}
                  rol={access.role}
                  lista="pacientes"
                  filas={filtrados}
                  columnas={columnasCsvPacientes(sucursales, profesionales, currency, timezone)}
                  timezone={timezone}
                  filtros={filtrosParaRegistro(search)}
                />
              )}
              {clinicId && hasPermission(access.role, "patients:manage") && (
                <>
                  {hasPermission(access.role, "settings:manage") && (
                    <Link to="/migracion" className={BOTON_PASTILLA}>
                      <FileUp className="size-4" aria-hidden /> Importar
                    </Link>
                  )}
                  <NuevoPacienteDialog
                    clinicId={clinicId}
                    pais={access.clinic?.country ?? null}
                    abrirAhora={search.nuevo === PEDIDO_ABRIR}
                    onAbierto={limpiarPedidoNuevo}
                  />
                </>
              )}
            </>
          }
        />

        {patientsRes?.truncated && (
          <p className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-warning">
            Mostrando los primeros {numero(pacientes.length)} pacientes. Usa la búsqueda para
            encontrar a alguien que no aparezca en la lista.
          </p>
        )}

        {/* Franja protagonista en tinta: la foto de la cartera. Cada cifra filtra la lista. */}
        <section
          aria-label="Tu cartera"
          className="dark tinta-de-pagina overflow-hidden rounded-[14px] border border-night-line bg-night text-on-night"
        >
          <div
            role="group"
            aria-label="Filtrar por indicador"
            className="flex snap-x overflow-x-auto divide-x divide-night-line sm:grid sm:grid-cols-3 sm:divide-x-0 lg:grid-cols-5 lg:divide-x"
          >
            <Indicador
              etiqueta="Activos"
              cifra={cartera.activos}
              detalle={`de ${numero(cartera.total)} ${cartera.total === 1 ? "ficha" : "fichas"}`}
              activo={Boolean(search.activos)}
              onClick={() => toggle("activos")}
              cargando={isLoading}
            />
            <Indicador
              etiqueta="Nuevos del mes"
              cifra={cartera.nuevosDelMes}
              detalle={`fichas creadas en ${mes}`}
              activo={Boolean(search.nuevos)}
              onClick={() => toggle("nuevos")}
              cargando={isLoading}
            />
            {/* El saldo solo llega a quien tiene `finance:view` (el servidor lo calcula igual). */}
            {veFinanzas && (
              <Indicador
                etiqueta="Con saldo"
                cifra={cartera.conSaldo?.cantidad ?? null}
                detalle={
                  cartera.conSaldo
                    ? formatMoney(cartera.conSaldo.montoCents, currency)
                    : "Sin datos de cobros"
                }
                detalleCifra={Boolean(cartera.conSaldo)}
                enfasis
                activo={Boolean(search.conSaldo)}
                onClick={() => toggle("conSaldo")}
                cargando={isLoading}
              />
            )}
            <Indicador
              etiqueta="Sin cita futura"
              cifra={cartera.sinCitaFutura}
              detalle="sin próxima cita agendada"
              activo={Boolean(search.sinCita)}
              onClick={() => toggle("sinCita")}
              cargando={isLoading}
            />
            <Indicador
              etiqueta="Fichas incompletas"
              cifra={cartera.incompletas}
              detalle="les falta un dato obligatorio"
              activo={Boolean(search.incompletas)}
              onClick={() => toggle("incompletas")}
              cargando={isLoading}
            />
          </div>
        </section>

        {/* Filtros: buscador compacto (o ⌘K), pastillas y chips de estado. */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <BuscadorCompacto
              etiqueta="Buscar pacientes"
              valor={search.q}
              onChange={(q) => set({ q })}
              placeholder="Nombre, RUT, correo o teléfono"
              className="sm:w-72"
            />
            {sucursales.length > 1 && (
              <FiltroCompacto
                etiqueta="Sucursal"
                valor={search.sucursal}
                onChange={(sucursal) => set({ sucursal })}
                todas="Sucursal"
                opciones={sucursales.map((s) => ({ value: s.id, label: s.nombre }))}
              />
            )}
            <FiltroCompacto
              etiqueta="Profesional"
              valor={search.profesional}
              onChange={(profesional) => set({ profesional })}
              todas="Profesional"
              opciones={profesionales.map((p) => ({ value: p.id, label: p.nombre }))}
            />
            <FiltroCompacto
              etiqueta="Archivo"
              valor={archivo === "activas" ? "" : archivo}
              onChange={(valor) =>
                set({ archivo: valor ? parseFiltroDeArchivo(valor) : undefined })
              }
              todas={ETIQUETA_FILTRO_DE_ARCHIVO.activas}
              opciones={filtrosDeArchivo}
            />
            <FiltroRangoFechas
              etiqueta="Última visita"
              desde={search.desde}
              hasta={search.hasta}
              onChange={(rango) => set(rango)}
            />
            {activos > 0 && <LimpiarFiltros onClick={() => void limpiar()} />}
          </div>
          <div role="group" aria-label="Estado" className="flex flex-wrap gap-1.5">
            <ChipFiltro activo={!search.estado} onClick={() => set({ estado: "" })}>
              Todos
            </ChipFiltro>
            {estados.map((e) => (
              <ChipFiltro
                key={e.value}
                activo={search.estado === e.value}
                onClick={() => set({ estado: search.estado === e.value ? "" : e.value })}
              >
                {e.label}
              </ChipFiltro>
            ))}
          </div>
        </div>

        <div className={cn(PANEL_LISTA, "overflow-hidden")}>
          <div
            className="hidden gap-4 border-b border-control/50 px-5 py-2.5 text-xs font-semibold text-muted-foreground md:grid"
            style={{ gridTemplateColumns: plantilla }}
          >
            <span>Paciente</span>
            <span>Profesional</span>
            {columnas.sucursal && <span>Sucursal</span>}
            {columnas.ultimaVisita && <span>Última visita</span>}
            <span>Estado</span>
            {columnas.riesgo && <span>Riesgo</span>}
            {columnas.saldo && <span className="text-right">Saldo</span>}
          </div>

          <div className="divide-y divide-hairline">
            {isLoading && (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                Cargando pacientes…
              </p>
            )}

            {!isLoading &&
              pagina.items.map((p) => {
                const sucursal = sucursalPorId.get(p.sucursalId);
                const profesional = profesionalPorId.get(p.profesionalId);
                const doc = p.documento?.trim() ?? "";
                return (
                  <Link
                    key={p.id}
                    to="/pacientes/$pacienteId"
                    params={{ pacienteId: p.id }}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2.5 px-4 py-3.5 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5 md:grid-cols-[var(--columnas)] md:items-center md:gap-y-2 md:py-3"
                    style={{ "--columnas": plantilla } as React.CSSProperties}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {p.foto ? (
                        <img
                          src={p.foto}
                          alt=""
                          width={512}
                          height={512}
                          loading="lazy"
                          className="size-10 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <AvatarIniciales nombre={p.nombre} className="size-10" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-display text-[19px] font-medium leading-tight">
                          {p.nombre}
                        </p>
                        <p className="cifra truncate text-[12px] text-muted-foreground">
                          {doc ? (
                            <>
                              {p.documentoTipo === "rut" || !p.documentoTipo ? "RUT " : "Doc. "}
                              {enmascararDocumento(doc)}
                            </>
                          ) : (
                            <span className="font-sans">Sin documento</span>
                          )}
                        </p>
                        {search.incompletas && p.faltantes && p.faltantes.length > 0 && (
                          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-warning">
                            <AlertTriangle className="size-3 shrink-0" aria-hidden />
                            Falta: {p.faltantes.map((f) => ETIQUETA_FALTANTE[f]).join(", ")}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* En el celular, el saldo va arriba a la derecha (lo que se mira primero). */}
                    <div className="text-right md:hidden">
                      {columnas.saldo && <Saldo saldo={p.saldo} currency={currency} />}
                    </div>

                    <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 md:contents">
                      <div className="flex min-w-0 items-center gap-2 text-[13.5px] md:order-none">
                        {profesional ? (
                          <>
                            <span
                              aria-hidden
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: colorProfesional(profesional.color) }}
                            />
                            <span className="truncate">{profesional.nombre}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Sin profesional</span>
                        )}
                      </div>
                      {columnas.sucursal && (
                        <span className="truncate text-[13px] text-muted-foreground">
                          {sucursal?.nombre ?? <SinDato />}
                        </span>
                      )}
                      {columnas.ultimaVisita && (
                        <div className="min-w-0 text-[13px] leading-tight">
                          <span className="md:hidden text-muted-foreground">Última visita </span>
                          {p.ultimaVisitaISO ? (
                            <span className="cifra">
                              {fecha(`${p.ultimaVisitaISO}T12:00:00`, timezone)}
                            </span>
                          ) : (
                            <SinDato />
                          )}
                          <span className="mt-0.5 hidden text-xs text-muted-foreground md:block">
                            {p.proximoControl ? (
                              <>
                                <CalendarDays className="mr-1 inline size-3" aria-hidden />
                                Próxima {p.proximoControl}
                              </>
                            ) : (
                              "Sin cita futura"
                            )}
                          </span>
                        </div>
                      )}
                      <EstadoDelPaciente
                        estado={p.estado}
                        archivada={Boolean(p.archivadaEl)}
                        nueva={esNuevaDelMes(p, hoy, timezone)}
                      />
                      {columnas.riesgo && (
                        <span className="text-xs">
                          {p.riesgoAusencia == null ? (
                            <SinDato />
                          ) : (
                            <span
                              className={cn(
                                "cifra",
                                p.riesgoAusencia > 50
                                  ? "text-destructive"
                                  : p.riesgoAusencia > 25
                                    ? "text-warning"
                                    : "text-success",
                              )}
                            >
                              {`${p.riesgoAusencia}%`}
                              <span className="font-sans text-muted-foreground"> ausencia</span>
                            </span>
                          )}
                        </span>
                      )}
                      {columnas.saldo && (
                        <div className="hidden text-right md:block">
                          <Saldo saldo={p.saldo} currency={currency} />
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}

            {isError && (
              <div className="p-4">
                <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar los pacientes." />
              </div>
            )}

            {!isLoading && !isError && pagina.items.length === 0 && (
              <div className="px-5 py-10 text-center">
                <p className="font-display text-2xl font-medium">
                  {pacientes.length === 0
                    ? archivo === "archivadas"
                      ? "No hay fichas archivadas."
                      : "Todavía no hay pacientes."
                    : "Nadie coincide con estos filtros."}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {pacientes.length === 0
                    ? archivo === "archivadas"
                      ? "Las fichas que archives quedan acá, con su historia completa."
                      : "Crea el primero con Nuevo paciente o trae tu base con Importar."
                    : "Prueba con otra búsqueda o limpia los filtros."}
                </p>
              </div>
            )}
          </div>

          <Paginacion
            pagina={pagina}
            etiqueta="pacientes"
            onPage={(page) => navigate({ search: (p: PacientesSearch) => ({ ...p, page }) })}
            porPagina={{
              valor: porPagina,
              opciones: OPCIONES_POR_PAGINA,
              onChange: (n) =>
                set({ porPagina: n === POR_PAGINA_POR_DEFECTO ? undefined : n, page: 1 }),
            }}
          />
        </div>
      </div>
    </AppShell>
  );
}

/** Un indicador de la franja en tinta: cifra grande en Cormorant y, al tocarlo, filtra. */
function Indicador({
  etiqueta,
  cifra,
  detalle,
  detalleCifra,
  enfasis,
  activo,
  onClick,
  cargando,
  className,
}: {
  etiqueta: string;
  cifra: number | null;
  detalle: string;
  detalleCifra?: boolean;
  enfasis?: boolean;
  activo: boolean;
  onClick: () => void;
  cargando: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn(
        "group relative flex min-h-[7rem] w-[10.5rem] shrink-0 snap-start flex-col items-start justify-between gap-3 border-night-line p-[clamp(16px,2vw,24px)] sm:min-h-[8.5rem] sm:w-auto sm:border-b text-left outline-none transition-colors hover:bg-night-2 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring lg:border-b-0",
        activo && "bg-night-2",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-on-night-2">
        {activo ? (
          <CheckCircle2 className="size-3.5 text-brand-on-night" aria-hidden />
        ) : (
          <Circle className="size-3.5 opacity-50" aria-hidden />
        )}
        {etiqueta}
      </span>
      <span>
        <span
          className={cn(
            "block font-display text-[2.5rem] sm:text-[clamp(2.5rem,4.2vw,3.5rem)] font-medium leading-[0.9] tracking-[-0.03em] [font-variant-numeric:lining-nums]",
            enfasis && cifra ? "text-brand-on-night" : "text-on-night",
          )}
        >
          {cargando ? (
            <span className="inline-block h-[0.8em] w-14 animate-pulse rounded bg-night-3 motion-reduce:animate-none" />
          ) : cifra == null ? (
            <span className="text-on-night-2">—</span>
          ) : (
            numero(cifra)
          )}
        </span>
        <span
          className={cn(
            "mt-2 block text-[12.5px] text-on-night-2",
            detalleCifra && "cifra text-on-night",
          )}
        >
          {detalle}
        </span>
      </span>
      {/* Filete ocre bajo el indicador activo (forma, no solo color). */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 bottom-0 h-[3px] bg-brand-on-night",
          activo ? "opacity-100" : "opacity-0",
        )}
      />
    </button>
  );
}

/** Estado con forma + ícono + texto (como los estados de cita). */
function EstadoDelPaciente({
  estado,
  archivada,
  nueva,
}: {
  estado: EstadoPaciente;
  archivada: boolean;
  nueva: boolean;
}) {
  const conf = archivada
    ? { texto: "Archivada", Icono: MinusCircle, clase: "border-neutral-border text-neutral" }
    : estado === "activo"
      ? {
          texto: etiquetaEstadoPaciente.activo,
          Icono: CheckCircle2,
          clase: "border-success-border bg-success-soft text-success",
        }
      : estado === "nuevo"
        ? {
            texto: nueva ? "Nuevo este mes" : etiquetaEstadoPaciente.nuevo,
            Icono: Sparkles,
            clase: "border-info-border bg-info-soft text-info",
          }
        : {
            texto: etiquetaEstadoPaciente.inactivo,
            Icono: CircleDashed,
            clase: "border-dashed border-neutral-border text-neutral",
          };
  return (
    <span
      className={cn(
        "inline-flex h-[26px] w-fit items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap",
        conf.clase,
      )}
    >
      <conf.Icono className="size-3.5" aria-hidden />
      {conf.texto}
    </span>
  );
}

function Saldo({ saldo, currency }: { saldo: number | null; currency: string }) {
  if (saldo == null) return <SinDato />;
  if (saldo > 0)
    return (
      <span className="cifra text-[14px] font-medium text-warning">
        {formatMoney(saldo, currency)}
      </span>
    );
  return <span className="text-[13px] text-muted-foreground">Al día</span>;
}

/** Columnas de la grilla según lo que se muestra: la de "Paciente" se lleva el resto. */
function plantillaDeColumnas(columnas: ColumnasVisibles): string {
  return [
    "minmax(0,2.2fr)",
    "minmax(0,1.2fr)",
    columnas.sucursal && "minmax(0,1fr)",
    columnas.ultimaVisita && "minmax(0,1fr)",
    "minmax(0,1fr)",
    columnas.riesgo && "minmax(0,0.8fr)",
    columnas.saldo && "minmax(0,0.9fr)",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Sin dato: un guion tenue, no una frase repetida en cada fila. */
function SinDato() {
  return (
    <span className="text-muted-foreground" title="Sin datos">
      —
    </span>
  );
}
