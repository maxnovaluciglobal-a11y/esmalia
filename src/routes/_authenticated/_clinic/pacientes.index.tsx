import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check, FileUp, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { fechaPlanilla, montoPlanilla, type ColumnaLista } from "@/lib/exportacion/listas-csv";
import type { Paciente } from "@/lib/clinic-operations/clinic-data";
import { ErrorDeCarga } from "@/components/estado-error";
import { DateField, FilterBar, Paginacion, SearchField, SelectField } from "@/components/filters";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { requirePermission } from "@/lib/access/route-guards";
import { hasPermission } from "@/lib/access/access";
import { etiquetaEstadoPaciente, type EstadoPaciente } from "@/lib/clinic-operations/clinic-data";
import { formatMoney } from "@/lib/finance/finance";
import { listBranches, listProfessionals } from "@/lib/clinic-operations/clinic-catalog.functions";
import {
  createPatient,
  importPatients,
  listPatients,
  previewImportPatients,
  type ImportPatientsResult,
  type ImportPreviewRow,
} from "@/lib/patients/patients.functions";
import { coincide, num, paginar, str } from "@/lib/search";
import { cn } from "@/lib/utils";
import { CsvColumnMapper } from "@/components/csv-column-mapper";
import {
  aplicarMapeo,
  autoDetectMapping,
  faltanCamposObligatorios,
  parseCsvRaw,
  type CsvFieldSpec,
} from "@/lib/csv/column-mapping";
import { mensajeDeError } from "@/lib/mensaje-error";
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
import { numero } from "@/lib/formato-fecha";
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

interface FilaCsv {
  nombre: string;
  documento?: string;
  fechaNacimiento?: string;
  telefono?: string;
  email?: string;
}

const MAX_FILAS_IMPORT = 2000;

/** Especificacion de columnas para el mapeo manual (recomendacion #5 del
 *  benchmark de onboarding, 25-sep-2026) - ver src/lib/csv/column-mapping.ts.
 *  Los alias cubren los exports mas comunes; cuando no alcanzan,
 *  `CsvColumnMapper` deja elegir la columna a mano en vez de descartar
 *  filas en silencio. */
const CAMPOS_PACIENTE: CsvFieldSpec[] = [
  {
    key: "nombre",
    label: "Nombre",
    required: true,
    aliases: ["nombre", "nombre_completo"],
  },
  {
    key: "documento",
    label: "Documento",
    required: false,
    aliases: ["documento", "rut", "dni", "documento_id"],
  },
  {
    key: "fechaNacimiento",
    label: "Fecha nacimiento",
    required: false,
    aliases: ["fecha_nacimiento", "fecha_de_nacimiento", "nacimiento"],
  },
  { key: "telefono", label: "Telefono", required: false, aliases: ["telefono", "celular"] },
  { key: "email", label: "Email", required: false, aliases: ["email", "correo", "mail"] },
];

function ImportarPacientesDialog({ clinicId }: { clinicId: string }) {
  const [open, setOpen] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapeo, setMapeo] = useState<Record<string, string | null>>({});
  const [necesitaMapeo, setNecesitaMapeo] = useState(false);
  const [filas, setFilas] = useState<FilaCsv[]>([]);
  const [sinNombre, setSinNombre] = useState(0);
  const [truncado, setTruncado] = useState(false);
  const [resultado, setResultado] = useState<ImportPatientsResult | null>(null);
  const [preview, setPreview] = useState<ImportPreviewRow[] | null>(null);

  const queryClient = useQueryClient();
  const importFn = useServerFn(importPatients);
  const previewFn = useServerFn(previewImportPatients);

  const reset = () => {
    setHeaders([]);
    setRawRows([]);
    setMapeo({});
    setNecesitaMapeo(false);
    setFilas([]);
    setSinNombre(0);
    setTruncado(false);
    setResultado(null);
    setPreview(null);
  };

  const construirFilas = (
    mapping: Record<string, string | null>,
    rows: Record<string, string>[],
  ) => {
    const mapeadas = aplicarMapeo(rows, mapping, CAMPOS_PACIENTE);
    const parseadas: FilaCsv[] = [];
    let sinNombreCount = 0;
    for (const m of mapeadas) {
      if (!m.nombre) {
        sinNombreCount += 1;
        continue;
      }
      parseadas.push({
        nombre: m.nombre,
        documento: m.documento || undefined,
        fechaNacimiento: m.fechaNacimiento || undefined,
        telefono: m.telefono || undefined,
        email: m.email || undefined,
      });
    }
    setSinNombre(sinNombreCount);
    setTruncado(parseadas.length > MAX_FILAS_IMPORT);
    setFilas(parseadas.slice(0, MAX_FILAS_IMPORT));
    setNecesitaMapeo(false);
  };

  const onFile = async (file: File) => {
    reset();
    // Import dinamico: papaparse solo hace falta en esta accion puntual de
    // onboarding (una vez por clinica), pero se cargaba estatico y era la
    // mayor parte del peso de /pacientes - la ruta que el staff abre mas
    // veces por dia de toda la app (auditoria de rendimiento, 01-sep).
    try {
      const { headers: hs, rows } = await parseCsvRaw(file);
      const auto = autoDetectMapping(hs, CAMPOS_PACIENTE);
      setHeaders(hs);
      setRawRows(rows);
      setMapeo(auto);
      if (faltanCamposObligatorios(auto, CAMPOS_PACIENTE)) {
        setNecesitaMapeo(true);
      } else {
        construirFilas(auto, rows);
      }
    } catch (err) {
      toast.error("No pudimos leer el CSV: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const cargarPreview = useMutation({
    mutationFn: () => previewFn({ data: { clinicId, rows: filas } }),
    onSuccess: (res) => setPreview(res),
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const importar = useMutation({
    mutationFn: () => importFn({ data: { clinicId, rows: filas } }),
    onSuccess: (res) => {
      setResultado(res);
      queryClient.invalidateQueries({ queryKey: ["patients", clinicId] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const aCrear = (preview ?? []).filter((p) => p.action === "create").length;
  const aSaltear = (preview ?? []).filter((p) => p.action === "skip_duplicate").length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <FileUp className="size-4" /> Importar CSV
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar pacientes desde CSV</DialogTitle>
          <DialogDescription>
            Columnas reconocidas: nombre, documento, fecha_nacimiento, telefono, email. Solo nombre
            es obligatorio. No importa citas — eso se sigue cargando desde la agenda.{" "}
            <a
              href="/plantillas/plantilla-pacientes.csv"
              download
              className="font-medium text-brand-700 underline underline-offset-2"
            >
              Descargar plantilla
            </a>{" "}
            (trae una fila de ejemplo: bórrala antes de subirla).
          </DialogDescription>
        </DialogHeader>

        {!resultado && !preview && necesitaMapeo && (
          <CsvColumnMapper
            fields={CAMPOS_PACIENTE}
            headers={headers}
            sampleRow={rawRows[0]}
            mapping={mapeo}
            onChange={(key, header) => setMapeo((prev) => ({ ...prev, [key]: header }))}
          />
        )}

        {!resultado && !preview && !necesitaMapeo && (
          <div className="space-y-3">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
              className="w-full rounded-lg border border-dashed border-hairline px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium"
            />

            {filas.length > 0 && (
              <div className="rounded-lg border border-hairline p-3 text-xs text-muted-foreground">
                <p>
                  <strong className="text-foreground">{filas.length}</strong> paciente
                  {filas.length === 1 ? "" : "s"} listo{filas.length === 1 ? "" : "s"} para revisar.
                  {sinNombre > 0 && ` ${sinNombre} fila(s) sin nombre se ignoraron.`}
                </p>
                {truncado && (
                  <p className="mt-1 flex items-center gap-1 text-warning">
                    <AlertTriangle className="size-3.5" /> El archivo tiene más de{" "}
                    {MAX_FILAS_IMPORT} filas — se importarán solo las primeras {MAX_FILAS_IMPORT}.
                  </p>
                )}
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                  {filas.slice(0, 5).map((f, i) => (
                    <li key={i} className="truncate">
                      {f.nombre} {f.documento ? `· ${f.documento}` : ""}
                    </li>
                  ))}
                  {filas.length > 5 && <li>… y {filas.length - 5} más.</li>}
                </ul>
              </div>
            )}
          </div>
        )}

        {!resultado && preview && (
          <div className="space-y-2 rounded-lg border border-hairline p-3 text-sm">
            <p>
              <strong className="text-foreground">{aCrear}</strong> se van a crear
              {aSaltear > 0 && (
                <>
                  {" "}
                  · <strong className="text-muted-foreground">{aSaltear}</strong> se van a saltear
                  (documento duplicado)
                </>
              )}
              .
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {preview.map((p) => (
                <li
                  key={p.row}
                  className={cn("truncate", p.action === "skip_duplicate" && "line-through")}
                >
                  {p.nombre} {p.documento ? `· ${p.documento}` : ""}
                  {p.warning && ` · ${p.warning}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {resultado && (
          <div className="space-y-2 rounded-lg border border-hairline p-3 text-sm">
            <p>
              <strong className="text-success">{resultado.created}</strong> pacientes importados.
            </p>
            {resultado.skipped > 0 && (
              <p className="text-muted-foreground">
                {resultado.skipped} se saltearon por documento duplicado.
              </p>
            )}
            {resultado.warnings.length > 0 && (
              <p className="text-warning">
                {resultado.warnings.length} con fecha de nacimiento inválida (se importaron sin
                ella).
              </p>
            )}
            {resultado.errors.length > 0 && (
              <p className="text-destructive">
                {resultado.errors.length} lote(s) fallaron: {resultado.errors[0].message}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {resultado ? (
            <Button onClick={() => setOpen(false)}>Listo</Button>
          ) : preview ? (
            <>
              <Button variant="outline" onClick={() => setPreview(null)}>
                Volver
              </Button>
              <Button
                onClick={() => importar.mutate()}
                disabled={aCrear === 0 || importar.isPending}
              >
                {importar.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Confirmar importación ({aCrear})
              </Button>
            </>
          ) : necesitaMapeo ? (
            <Button
              onClick={() => construirFilas(mapeo, rawRows)}
              disabled={faltanCamposObligatorios(mapeo, CAMPOS_PACIENTE)}
            >
              Continuar
            </Button>
          ) : (
            <Button
              onClick={() => cargarPreview.mutate()}
              disabled={filas.length === 0 || cargarPreview.isPending}
            >
              {cargarPreview.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Ver vista previa
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
        return true;
      }),
    [pacientes, search],
  );

  const timezone = access.clinic?.timezone ?? "America/Santiago";

  const porPagina = search.porPagina ?? POR_PAGINA_POR_DEFECTO;
  const pagina = paginar(filtrados, search.page, porPagina);
  const columnas = columnasConDatos(pagina.items, sucursales.length);
  const plantilla = plantillaDeColumnas(columnas);
  const toggle = (clave: "conSaldo" | "sinCita" | "incompletas") =>
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
  ].filter(Boolean).length;

  return (
    <AppShell title="Pacientes" access={access}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-end gap-2">
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
              <ImportarPacientesDialog clinicId={clinicId} />
              <NuevoPacienteDialog
                clinicId={clinicId}
                pais={access.clinic?.country ?? null}
                abrirAhora={search.nuevo === PEDIDO_ABRIR}
                onAbierto={limpiarPedidoNuevo}
              />
            </>
          )}
        </div>

        {patientsRes?.truncated && (
          <p className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-warning">
            Mostrando los primeros {numero(pacientes.length)} pacientes. Usa la búsqueda para
            encontrar a alguien que no aparezca en la lista.
          </p>
        )}

        <FilterBar
          activos={activos}
          onReset={() =>
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
              },
            })
          }
        >
          <SearchField
            label="Buscar"
            value={search.q}
            onChange={(q) => set({ q })}
            placeholder="Nombre, documento, email…"
          />
          <SelectField
            label="Sucursal"
            value={search.sucursal}
            onChange={(sucursal) => set({ sucursal })}
            allLabel="Todas las sucursales"
            options={sucursales.map((s) => ({ value: s.id, label: s.nombre }))}
          />
          <SelectField
            label="Profesional"
            value={search.profesional}
            onChange={(profesional) => set({ profesional })}
            allLabel="Todos los profesionales"
            options={profesionales.map((p) => ({ value: p.id, label: p.nombre }))}
          />
          <SelectField
            label="Estado"
            value={search.estado}
            onChange={(estado) => set({ estado })}
            allLabel="Todos los estados"
            options={estados}
          />
          <SelectField
            label="Archivo"
            value={archivo === "activas" ? "" : archivo}
            onChange={(valor) => set({ archivo: valor ? parseFiltroDeArchivo(valor) : undefined })}
            allLabel={ETIQUETA_FILTRO_DE_ARCHIVO.activas}
            options={filtrosDeArchivo}
          />
          <DateField
            label="Última visita desde"
            value={search.desde}
            onChange={(desde) => set({ desde })}
          />
          <DateField
            label="Última visita hasta"
            value={search.hasta}
            onChange={(hasta) => set({ hasta })}
          />
        </FilterBar>

        <div role="group" aria-label="Filtros rápidos" className="flex flex-wrap gap-2">
          {(
            [
              // El saldo solo llega a quien tiene `finance:view` (el servidor lo calcula igual).
              ...(veFinanzas ? ([["conSaldo", "Con saldo"]] as const) : []),
              ["sinCita", "Sin cita futura"],
              ["incompletas", "Fichas incompletas"],
            ] as const
          ).map(([clave, texto]) => (
            <button
              key={clave}
              type="button"
              aria-pressed={Boolean(search[clave])}
              onClick={() => toggle(clave)}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors",
                search[clave]
                  ? "border-brand bg-brand-soft text-brand-700"
                  : "border-hairline text-muted-foreground hover:border-brand hover:text-foreground",
              )}
            >
              {search[clave] && <Check className="size-3.5" aria-hidden />}
              {texto}
            </button>
          ))}
        </div>

        <div className="card-clinical overflow-hidden">
          <div
            className="hidden gap-4 border-b border-hairline bg-secondary/40 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid"
            style={{ gridTemplateColumns: plantilla }}
          >
            <span>Paciente</span>
            {columnas.sucursal && <span>Sucursal</span>}
            {columnas.ultimaVisita && <span>Última visita</span>}
            <span>Estado</span>
            {columnas.saldo && <span>Saldo</span>}
            {columnas.riesgo && <span>Riesgo</span>}
          </div>

          <div className="divide-y divide-hairline">
            {isLoading && (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                Cargando pacientes…
              </p>
            )}

            {!isLoading &&
              pagina.items.map((p) => {
                const sucursal = sucursales.find((s) => s.id === p.sucursalId);
                const profesional = profesionales.find((pr) => pr.id === p.profesionalId);
                return (
                  <Link
                    key={p.id}
                    to="/pacientes/$pacienteId"
                    params={{ pacienteId: p.id }}
                    className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 transition-colors hover:bg-secondary/50 md:grid-cols-[var(--columnas)] md:items-center md:gap-y-2"
                    style={{ "--columnas": plantilla } as React.CSSProperties}
                  >
                    <div className="col-span-2 flex items-center gap-3 md:col-span-1">
                      {p.foto ? (
                        <img
                          src={p.foto}
                          alt={p.nombre}
                          width={512}
                          height={512}
                          loading="lazy"
                          className="size-9 rounded-full object-cover"
                        />
                      ) : (
                        <span className="grid size-9 place-items-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
                          {p.nombre
                            .split(" ")
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.nombre}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[p.documento, profesional?.nombre ?? "Sin profesional asignado"]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {search.incompletas && p.faltantes && p.faltantes.length > 0 && (
                          <p className="truncate text-xs text-warning">
                            Falta: {p.faltantes.map((f) => ETIQUETA_FALTANTE[f]).join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                    {columnas.sucursal && (
                      <Celda etiqueta="Sucursal">
                        <span className="text-xs text-muted-foreground">
                          {sucursal?.nombre ?? <SinDato />}
                        </span>
                      </Celda>
                    )}
                    {columnas.ultimaVisita && (
                      <Celda etiqueta="Última visita">
                        <span className="text-xs text-muted-foreground">
                          {p.ultimaVisitaISO ? p.ultimaVisita : <SinDato />}
                        </span>
                      </Celda>
                    )}
                    <Celda etiqueta="Estado">
                      <span
                        className={cn(
                          "w-fit rounded px-1.5 py-0.5 text-[11px] font-medium",
                          p.archivadaEl
                            ? "bg-secondary text-muted-foreground"
                            : p.estado === "activo"
                              ? "bg-success-soft text-success"
                              : p.estado === "nuevo"
                                ? "bg-info-soft text-info"
                                : "bg-secondary text-muted-foreground",
                        )}
                      >
                        {p.archivadaEl ? "Archivada" : etiquetaEstadoPaciente[p.estado]}
                      </span>
                    </Celda>
                    {columnas.saldo && (
                      <Celda etiqueta="Saldo">
                        <span
                          className={cn(
                            "text-xs",
                            p.saldo != null && p.saldo > 0
                              ? "font-medium text-warning"
                              : "text-muted-foreground",
                          )}
                        >
                          {p.saldo == null ? (
                            <SinDato />
                          ) : p.saldo > 0 ? (
                            formatMoney(p.saldo, currency)
                          ) : (
                            "Al día"
                          )}
                        </span>
                      </Celda>
                    )}
                    {columnas.riesgo && (
                      <Celda etiqueta="Riesgo">
                        {p.riesgoAusencia == null ? (
                          <SinDato />
                        ) : (
                          <span
                            className={cn(
                              "w-fit rounded px-1.5 py-0.5 text-[11px] font-medium",
                              p.riesgoAusencia > 50
                                ? "bg-destructive/10 text-destructive"
                                : p.riesgoAusencia > 25
                                  ? "bg-warning-soft text-warning"
                                  : "bg-success-soft text-success",
                            )}
                          >
                            {`${p.riesgoAusencia}% ausencia`}
                          </span>
                        )}
                      </Celda>
                    )}
                  </Link>
                );
              })}

            {isError && (
              <div className="p-4">
                <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar los pacientes." />
              </div>
            )}

            {!isLoading && !isError && pagina.items.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                {pacientes.length === 0
                  ? archivo === "archivadas"
                    ? "No hay fichas archivadas."
                    : "Todavía no hay pacientes registrados en esta clínica."
                  : "No hay pacientes que coincidan con los filtros aplicados."}
              </p>
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

/** Columnas de la grilla según lo que se muestra: la de "Paciente" se lleva el resto. */
function plantillaDeColumnas(columnas: ColumnasVisibles): string {
  return [
    "minmax(0,2fr)",
    columnas.sucursal && "minmax(0,1fr)",
    columnas.ultimaVisita && "minmax(0,1fr)",
    "minmax(0,1fr)",
    columnas.saldo && "minmax(0,1fr)",
    columnas.riesgo && "minmax(0,1fr)",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Celda con su etiqueta visible solo en el teléfono (en escritorio la da el encabezado). */
function Celda({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground md:hidden">{etiqueta}</span>
      {children}
    </div>
  );
}

/** Sin dato: un guion tenue, no una frase repetida en cada fila. */
function SinDato() {
  return (
    <span className="text-muted-foreground" title="Sin datos">
      —
    </span>
  );
}
