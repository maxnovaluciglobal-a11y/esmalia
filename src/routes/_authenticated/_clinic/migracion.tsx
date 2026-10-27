// /migracion — Migración asistida por lotes (EXP-05, EXP-06, EXP-07, REC-06).
//
// Un archivo = un lote. Flujo: elegir qué se importa y el archivo → revisar
// el mapeo de columnas (editable) → vista previa con filas válidas, con error
// y duplicadas → confirmar con la cifra exacta → lote en el historial, que se
// puede deshacer completo mientras nadie haya trabajado sobre lo importado.
// Solo owner/admin (`settings:manage`); el servidor y la base lo vuelven a
// exigir.

import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BellOff, FileUp, Loader2, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requirePermission } from "@/lib/access/route-guards";
import { aplicarMapeo, autoDetectMapping, type CsvParsed } from "@/lib/csv/column-mapping";
import { fechaHora, numero } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { EXTENSIONES_ACEPTADAS, leerArchivoDeMigracion } from "@/lib/migracion/leer-archivo";
import {
  activarRecordatoriosDeLote,
  deshacerLoteMigracion,
  importarLoteMigracion,
  listarLotesDeMigracion,
  revisarReversaDeLote,
  vistaPreviaMigracion,
  type LoteDeMigracion,
  type ResultadoImportacion,
  type VistaPrevia,
} from "@/lib/migracion/migracion.functions";
import {
  afectadas,
  MAX_FILAS_POR_LOTE,
  type EstadoFila,
  type PoliticaDuplicados,
} from "@/lib/migracion/normalizar";
import {
  camposDelPerfil,
  ETIQUETA_TIPO_LOTE,
  nombreDelOrigen,
  PERFILES,
  PERFILES_DE_MIGRACION,
  sugerirPerfil,
  type PerfilId,
  type TipoLote,
} from "@/lib/migracion/perfiles";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_clinic/migracion")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Migración de datos | Esmalia" },
      {
        name: "description",
        content: "Trae pacientes y citas desde otro sistema por lotes, con vista previa y reversa.",
      },
    ],
  }),
  component: MigracionPage,
});

const SIN_COLUMNA = "__sin_columna__";

/** "1 ficha" / "3 fichas", con separador de miles. */
function cuenta(n: number, uno: string, varios: string): string {
  return `${numero(n)} ${n === 1 ? uno : varios}`;
}
const FILAS_VISIBLES = 200;

const ETIQUETA_ESTADO: Record<EstadoFila, string> = {
  valida: "Válida",
  error: "Con error",
  duplicada: "Duplicada",
};

function MigracionPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const zona = access.clinic?.timezone;

  if (!clinicId) return null;
  return (
    <AppShell title="Migración de datos" access={access}>
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="max-w-3xl space-y-2 text-sm text-muted-foreground">
          <p>
            Trae tus pacientes y tus citas desde otro sistema (Dentalink, una planilla propia…).
            Cada archivo se importa como un <strong className="text-foreground">lote</strong>: antes
            de escribir nada ves qué filas son válidas, cuáles tienen errores y cuáles ya existen, y
            si algo salió mal puedes deshacer el lote completo.
          </p>
          <p>
            Importa primero los pacientes y después las citas: las citas se enlazan con las fichas
            por el id del sistema anterior, el documento o el nombre. ¿Pacientes repetidos de antes?
            Revísalos en{" "}
            <Link to="/fusionar-fichas" className="font-medium text-brand-700 hover:underline">
              Fichas duplicadas
            </Link>
            .
          </p>
        </div>

        <NuevaImportacion clinicId={clinicId} />
        <HistorialDeLotes clinicId={clinicId} zona={zona} />
      </div>
    </AppShell>
  );
}

// ─── Nueva importación ─────────────────────────────────────────────────────

interface Archivo {
  nombre: string;
  datos: CsvParsed;
}

function NuevaImportacion({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<TipoLote>("pacientes");
  const [perfil, setPerfil] = useState<PerfilId>("generico");
  const [archivo, setArchivo] = useState<Archivo | null>(null);
  const [mapeo, setMapeo] = useState<Record<string, string | null>>({});
  const [leyendo, setLeyendo] = useState(false);
  const [vista, setVista] = useState<VistaPrevia | null>(null);
  const [profesionales, setProfesionales] = useState<Record<string, string>>({});
  const [sucursalId, setSucursalId] = useState<string | null>(null);
  const [politica, setPolitica] = useState<PoliticaDuplicados>("omitir");
  const [incluirRecordatorios, setIncluirRecordatorios] = useState(false);
  const [filtro, setFiltro] = useState<EstadoFila | "todas">("todas");
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);

  const previewFn = useServerFn(vistaPreviaMigracion);
  const importFn = useServerFn(importarLoteMigracion);

  const campos = useMemo(() => camposDelPerfil(tipo, perfil), [tipo, perfil]);

  function reiniciarVista() {
    setVista(null);
    setResultado(null);
  }

  function aplicarPerfil(t: TipoLote, p: PerfilId, a: Archivo | null) {
    setMapeo(a ? autoDetectMapping(a.datos.headers, camposDelPerfil(t, p)) : {});
    reiniciarVista();
  }

  async function elegirArchivo(f: File | undefined) {
    if (!f) return;
    setLeyendo(true);
    try {
      const datos = await leerArchivoDeMigracion(f);
      if (datos.rows.length > MAX_FILAS_POR_LOTE) {
        toast.error(
          `El archivo tiene ${numero(datos.rows.length)} filas. El máximo por lote es ${numero(MAX_FILAS_POR_LOTE)}: divídelo en varios archivos.`,
        );
        return;
      }
      const nuevo = { nombre: f.name, datos };
      const sugerido = sugerirPerfil(tipo, datos.headers);
      setArchivo(nuevo);
      setPerfil(sugerido);
      setProfesionales({});
      setSucursalId(null);
      aplicarPerfil(tipo, sugerido, nuevo);
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setLeyendo(false);
    }
  }

  function entrada() {
    if (!archivo) throw new Error("Elige un archivo.");
    return {
      clinicId,
      tipo,
      perfil,
      filas: aplicarMapeo(archivo.datos.rows, mapeo, campos),
      originales: archivo.datos.rows,
      profesionales,
      sucursalId,
    };
  }

  const faltaObligatorio = campos.some((c) => c.required && !mapeo[c.key]);
  const faltaPaciente =
    tipo === "citas" &&
    !mapeo.paciente_externo &&
    !mapeo.paciente_documento &&
    !mapeo.paciente_nombre;

  const revisar = useMutation({
    mutationFn: async (extra?: {
      profesionales?: Record<string, string>;
      sucursalId?: string | null;
    }) => {
      const base = entrada();
      return previewFn({ data: { ...base, ...extra } });
    },
    onSuccess: (v) => {
      setVista(v);
      setResultado(null);
      setFiltro("todas");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const cifra = vista
    ? tipo === "pacientes"
      ? afectadas(vista.filas, politica)
      : vista.resumen.validas
    : 0;

  const importar = useMutation({
    mutationFn: () =>
      importFn({
        data: {
          ...entrada(),
          nombreArchivo: archivo?.nombre ?? null,
          politicaDuplicados: politica,
          incluirEnRecordatorios: incluirRecordatorios,
          confirmacion: cifra,
        },
      }),
    onSuccess: (r) => {
      setResultado(r);
      setVista(null);
      setConfirmando(false);
      queryClient.invalidateQueries({ queryKey: ["migracion-lotes", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["patients", clinicId] });
      toast.success("Lote importado");
    },
    onError: (e: Error) => {
      setConfirmando(false);
      toast.error(mensajeDeError(e));
    },
  });

  const filasFiltradas = (vista?.filas ?? []).filter(
    (f) => filtro === "todas" || f.estado === filtro,
  );
  const perfilActual = PERFILES_DE_MIGRACION[perfil];
  const existentes = (vista?.filas ?? []).filter(
    (f) => f.estado === "duplicada" && f.pacienteId !== null,
  ).length;
  const sinParPendientes = (vista?.profesionalesSinPar ?? []).filter((n) => !profesionales[n]);

  return (
    <section className="card-clinical space-y-6 p-5 sm:p-6" aria-labelledby="nueva-importacion">
      <h2 id="nueva-importacion" className="font-display text-xl font-semibold">
        Nueva importación
      </h2>

      {/* 1. Qué y desde dónde */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="tipo-lote">Qué vas a importar</Label>
          <Select
            value={tipo}
            onValueChange={(v) => {
              const t = v as TipoLote;
              setTipo(t);
              aplicarPerfil(t, perfil, archivo);
            }}
          >
            <SelectTrigger id="tipo-lote">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pacientes">Pacientes</SelectItem>
              <SelectItem value="citas">Citas (historial y agenda)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="perfil-lote">Sistema de origen</Label>
          <Select
            value={perfil}
            onValueChange={(v) => {
              const p = v as PerfilId;
              setPerfil(p);
              aplicarPerfil(tipo, p, archivo);
            }}
          >
            <SelectTrigger id="perfil-lote">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERFILES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PERFILES_DE_MIGRACION[p].nombre}
                  {PERFILES_DE_MIGRACION[p].provisional ? " (provisional)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="archivo-lote">Archivo CSV o Excel (.xlsx)</Label>
          <label
            htmlFor="archivo-lote"
            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-secondary/60"
          >
            {leyendo ? (
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
            ) : (
              <FileUp className="size-4 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate">
              {archivo ? archivo.nombre : "Elegir archivo…"}
            </span>
          </label>
          <input
            id="archivo-lote"
            type="file"
            accept={EXTENSIONES_ACEPTADAS}
            className="sr-only"
            onChange={(e) => {
              void elegirArchivo(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <p
        className={cn(
          "rounded-lg border px-4 py-2.5 text-sm",
          perfilActual.provisional
            ? "border-warning-border bg-warning-soft text-foreground"
            : "border-hairline bg-secondary/40 text-muted-foreground",
        )}
      >
        {perfilActual.provisional && (
          <AlertTriangle className="mr-1.5 inline size-4 align-[-3px] text-warning" aria-hidden />
        )}
        {perfilActual.descripcion}
      </p>

      {/* 2. Mapeo de columnas (siempre editable) */}
      {archivo && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">Columnas</h3>
            <p className="text-xs text-muted-foreground">
              {numero(archivo.datos.rows.length)} filas · {archivo.datos.headers.length} columnas.
              Revisa a qué campo va cada columna.
            </p>
          </div>
          <div className="grid gap-x-6 gap-y-2 xl:grid-cols-2">
            {campos.map((campo) => {
              const elegida = mapeo[campo.key];
              const ejemplo = elegida ? archivo.datos.rows[0]?.[elegida] : undefined;
              return (
                <div key={campo.key} className="flex min-w-0 items-center gap-2">
                  <span className="w-32 shrink-0 text-xs sm:w-40">
                    {campo.label}
                    {campo.required && <span className="text-destructive"> *</span>}
                  </span>
                  <Select
                    value={elegida ?? SIN_COLUMNA}
                    onValueChange={(v) => {
                      setMapeo((m) => ({ ...m, [campo.key]: v === SIN_COLUMNA ? null : v }));
                      reiniciarVista();
                    }}
                  >
                    <SelectTrigger
                      className="h-9 min-w-0 flex-1 text-xs"
                      aria-label={`Columna para ${campo.label}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SIN_COLUMNA}>
                        {campo.required ? "Sin columna" : "Ninguna"}
                      </SelectItem>
                      {archivo.datos.headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span
                    className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground sm:block"
                    title={ejemplo}
                  >
                    {ejemplo ? `ej: ${ejemplo}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
          {(faltaObligatorio || faltaPaciente) && (
            <p className="text-xs text-destructive">
              {faltaPaciente
                ? "Elige al menos una columna que identifique al paciente (id, documento o nombre)."
                : "Falta elegir la columna de los campos marcados con *."}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              onClick={() => revisar.mutate(undefined)}
              disabled={faltaObligatorio || faltaPaciente || revisar.isPending}
            >
              {revisar.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Ver vista previa
            </Button>
          </div>
        </div>
      )}

      {/* 3. Vista previa */}
      {vista && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar filas">
            {(
              [
                ["todas", `Todas · ${numero(vista.filas.length)}`],
                ["valida", `Válidas · ${numero(vista.resumen.validas)}`],
                ["error", `Con error · ${numero(vista.resumen.errores)}`],
                ["duplicada", `Duplicadas · ${numero(vista.resumen.duplicadas)}`],
              ] as const
            ).map(([valor, etiqueta]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setFiltro(valor)}
                aria-pressed={filtro === valor}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-xs font-medium",
                  filtro === valor
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background hover:bg-secondary",
                )}
              >
                {etiqueta}
              </button>
            ))}
          </div>

          {vista.tipo === "citas" && (
            <MapeoDeCitas
              vista={vista}
              profesionales={profesionales}
              sucursalId={sucursalId}
              pendientes={sinParPendientes}
              cargando={revisar.isPending}
              onCambiar={(p, s) => {
                setProfesionales(p);
                setSucursalId(s);
                revisar.mutate({ profesionales: p, sucursalId: s });
              }}
            />
          )}

          <div className="overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Fila</th>
                  <th className="px-3 py-2 font-medium">
                    {tipo === "pacientes" ? "Paciente" : "Cita"}
                  </th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filasFiltradas.slice(0, FILAS_VISIBLES).map((f) => (
                  <tr key={f.fila} className="align-top">
                    <td className="cifra px-3 py-2 text-muted-foreground">{f.fila}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{f.titulo}</p>
                      {f.detalle && <p className="text-xs text-muted-foreground">{f.detalle}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium",
                          f.estado === "valida" && "bg-success-soft text-success",
                          f.estado === "error" && "bg-destructive-soft text-destructive",
                          f.estado === "duplicada" && "bg-warning-soft text-foreground",
                        )}
                      >
                        {ETIQUETA_ESTADO[f.estado]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {f.mensajes.length > 0 ? f.mensajes.join(" ") : "—"}
                      {f.pacienteId && tipo === "pacientes" && (
                        <>
                          {" "}
                          <Link
                            to="/pacientes/$pacienteId"
                            params={{ pacienteId: f.pacienteId }}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            Ver ficha
                          </Link>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filasFiltradas.length > FILAS_VISIBLES && (
            <p className="text-xs text-muted-foreground">
              Se muestran las primeras {FILAS_VISIBLES} de {numero(filasFiltradas.length)} filas.
            </p>
          )}

          {/* 4. Opciones */}
          {tipo === "pacientes" && existentes > 0 && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">
                ¿Qué hacemos con{" "}
                {existentes === 1
                  ? "el paciente que ya existe"
                  : `los ${numero(existentes)} pacientes que ya existen`}{" "}
                en Esmalia?
              </legend>
              {(
                [
                  ["omitir", "Omitirlos: las fichas de Esmalia quedan como están."],
                  [
                    "completar",
                    "Completar solo los campos vacíos de la ficha (teléfono, correo, nacimiento…). Nada que ya tenga datos se pisa, y deshacer el lote los vuelve a vaciar.",
                  ],
                ] as const
              ).map(([valor, texto]) => (
                <label key={valor} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="politica-duplicados"
                    className="mt-1 size-4"
                    checked={politica === valor}
                    onChange={() => setPolitica(valor)}
                  />
                  <span>{texto}</span>
                </label>
              ))}
            </fieldset>
          )}

          {tipo === "pacientes" && (
            <p className="flex gap-2 rounded-lg border border-info-border bg-info-soft px-4 py-2.5 text-sm">
              <BellOff className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                No se le envía nada a los pacientes importados: entran sin autorización de WhatsApp
                registrada, así que no aparecen en controles periódicos, cumpleaños ni otros
                mensajes hasta que la registres en su ficha.
              </span>
            </p>
          )}

          {tipo === "citas" && vista.citasFuturas > 0 && (
            <div className="space-y-2 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm">
              <p className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  Este archivo trae {numero(vista.citasFuturas)}{" "}
                  {vista.citasFuturas === 1 ? "cita futura" : "citas futuras"}. Recordatorios lista
                  las citas próximas para que el equipo envíe el aviso (nada sale solo): si las
                  incluyes, estas también aparecerán ahí. Por defecto no se incluyen, para no
                  escribirle a pacientes que quizás ya recibieron el aviso desde el sistema
                  anterior.
                </span>
              </p>
              <label className="flex cursor-pointer items-start gap-2 pl-6">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={incluirRecordatorios}
                  onChange={(e) => setIncluirRecordatorios(e.target.checked)}
                />
                <span>Incluir estas citas en Recordatorios</span>
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {sinParPendientes.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Elige el profesional de cada nombre para importar esas citas.
              </p>
            )}
            <Button
              onClick={() => setConfirmando(true)}
              disabled={cifra === 0 || importar.isPending}
            >
              <Upload className="size-4" aria-hidden />
              Importar {numero(cifra)} {cifra === 1 ? "registro" : "registros"}
            </Button>
          </div>
        </div>
      )}

      {resultado && <ResumenDeImportacion resultado={resultado} tipo={tipo} />}

      <AlertDialog
        open={confirmando}
        onOpenChange={(o) => !o && !importar.isPending && setConfirmando(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Importar {numero(cifra)} {cifra === 1 ? "registro" : "registros"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {vista && tipo === "pacientes" ? (
                  <p>
                    Se {vista.resumen.validas === 1 ? "crea" : "crean"}{" "}
                    {cuenta(vista.resumen.validas, "ficha nueva", "fichas nuevas")}
                    {politica === "completar" && existentes > 0
                      ? ` y se completan los campos vacíos de ${cuenta(cifra - vista.resumen.validas, "ficha que ya existe", "fichas que ya existen")}`
                      : ""}
                    . No se importan {cuenta(vista.filas.length - cifra, "fila", "filas")} (con
                    error o duplicadas).
                  </p>
                ) : (
                  <p>
                    Se {cifra === 1 ? "crea" : "crean"} {cuenta(cifra, "cita", "citas")}
                    {vista && vista.citasFuturas > 0
                      ? incluirRecordatorios
                        ? ", y las futuras aparecerán en Recordatorios"
                        : ", y las futuras no aparecerán en Recordatorios"
                      : ""}
                    . Las citas que ya habían pasado quedan como historial de solo lectura.
                  </p>
                )}
                <p>
                  Todo queda en un lote que puedes deshacer mientras nadie trabaje sobre lo
                  importado.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={importar.isPending}
              onClick={(e) => {
                e.preventDefault();
                importar.mutate();
              }}
            >
              {importar.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Importar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function MapeoDeCitas({
  vista,
  profesionales,
  sucursalId,
  pendientes,
  cargando,
  onCambiar,
}: {
  vista: VistaPrevia;
  profesionales: Record<string, string>;
  sucursalId: string | null;
  pendientes: string[];
  cargando: boolean;
  onCambiar: (p: Record<string, string>, s: string | null) => void;
}) {
  const nombres = [
    ...new Set([...vista.profesionalesSinPar, ...Object.keys(profesionales)]),
  ].sort();
  if (nombres.length === 0 && vista.sucursales.length <= 1) return null;
  return (
    <div className="space-y-3 rounded-lg border border-hairline p-4">
      {vista.sucursales.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-56 shrink-0">Sucursal cuando el archivo no la dice</span>
          <Select value={sucursalId ?? ""} onValueChange={(v) => onCambiar(profesionales, v)}>
            <SelectTrigger
              className="h-9 w-64 max-w-full text-xs"
              aria-label="Sucursal por defecto"
            >
              <SelectValue placeholder="Elegir sucursal…" />
            </SelectTrigger>
            <SelectContent>
              {vista.sucursales.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {nombres.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Profesionales del archivo
            {pendientes.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {pendientes.length} sin elegir
              </span>
            )}
          </p>
          {nombres.map((n) => (
            <div key={n} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-56 shrink-0 truncate" title={n}>
                {n}
              </span>
              <Select
                value={profesionales[n] ?? ""}
                disabled={cargando}
                onValueChange={(v) => onCambiar({ ...profesionales, [n]: v }, sucursalId)}
              >
                <SelectTrigger
                  className="h-9 w-64 max-w-full text-xs"
                  aria-label={`Profesional para ${n}`}
                >
                  <SelectValue placeholder="Elegir profesional…" />
                </SelectTrigger>
                <SelectContent>
                  {vista.profesionales.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResumenDeImportacion({
  resultado,
  tipo,
}: {
  resultado: ResultadoImportacion;
  tipo: TipoLote;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-success-border bg-success-soft px-4 py-3 text-sm">
      <p className="font-medium">
        Lote importado:{" "}
        {tipo === "pacientes"
          ? cuenta(resultado.creados, "ficha nueva", "fichas nuevas")
          : cuenta(resultado.creados, "cita nueva", "citas nuevas")}
        {resultado.actualizados > 0 &&
          `, ${cuenta(resultado.actualizados, "ficha completada", "fichas completadas")}`}
        {resultado.omitidos > 0 && `, ${cuenta(resultado.omitidos, "omitida", "omitidas")}`}
        {resultado.fallidos > 0 && `, ${numero(resultado.fallidos)} con error`}.
      </p>
      {resultado.errores.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {resultado.errores.slice(0, 20).map((e) => (
            <li key={`${e.fila}-${e.mensaje}`}>
              Fila {e.fila}: {e.mensaje}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Historial de lotes ────────────────────────────────────────────────────

const ETIQUETA_ESTADO_LOTE: Record<LoteDeMigracion["estado"], string> = {
  en_curso: "Sin terminar",
  completado: "Importado",
  deshecho: "Deshecho",
};

function HistorialDeLotes({
  clinicId,
  zona,
}: {
  clinicId: string;
  zona: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const listar = useServerFn(listarLotesDeMigracion);
  const revisarFn = useServerFn(revisarReversaDeLote);
  const deshacerFn = useServerFn(deshacerLoteMigracion);
  const activarFn = useServerFn(activarRecordatoriosDeLote);
  const [reversa, setReversa] = useState<{
    lote: LoteDeMigracion;
    motivos: string[];
    registros: number;
  } | null>(null);
  const [revisando, setRevisando] = useState<string | null>(null);

  const {
    data: lotes = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["migracion-lotes", clinicId],
    queryFn: () => listar({ data: { clinicId } }),
  });

  async function abrirReversa(lote: LoteDeMigracion) {
    setRevisando(lote.id);
    try {
      const r = await revisarFn({ data: { clinicId, loteId: lote.id } });
      setReversa({ lote, ...r });
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setRevisando(null);
    }
  }

  const deshacer = useMutation({
    mutationFn: (v: { loteId: string; registros: number }) =>
      deshacerFn({ data: { clinicId, loteId: v.loteId, confirmacion: v.registros } }),
    onSuccess: (r) => {
      toast.success(
        `Lote deshecho: ${cuenta(r.pacientes, "ficha", "fichas")} y ${cuenta(r.citas, "cita", "citas")} borradas${r.campos_vaciados ? `, ${cuenta(r.campos_vaciados, "campo vaciado", "campos vaciados")}` : ""}.`,
      );
      setReversa(null);
      queryClient.invalidateQueries({ queryKey: ["migracion-lotes", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["patients", clinicId] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const activar = useMutation({
    mutationFn: (loteId: string) => activarFn({ data: { clinicId, loteId } }),
    onSuccess: (r) => {
      toast.success(
        `${cuenta(r.citas, "cita ahora aparece", "citas ahora aparecen")} en Recordatorios.`,
      );
      queryClient.invalidateQueries({ queryKey: ["migracion-lotes", clinicId] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <section className="space-y-3" aria-labelledby="historial-lotes">
      <h2 id="historial-lotes" className="font-display text-xl font-semibold">
        Lotes importados
      </h2>
      {isLoading && <p className="text-sm text-muted-foreground">Cargando lotes…</p>}
      {isError && <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar los lotes." />}
      {!isLoading && !isError && lotes.length === 0 && (
        <p className="text-sm text-muted-foreground">Todavía no importaste ningún archivo.</p>
      )}
      {lotes.length > 0 && (
        <ul className="divide-y divide-hairline rounded-lg border border-hairline">
          {lotes.map((l) => (
            <li
              key={l.id}
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-medium">
                  {ETIQUETA_TIPO_LOTE[l.tipo]} · {nombreDelOrigen(l.perfil)}
                  {l.archivo && (
                    <span className="ml-2 font-normal text-muted-foreground">{l.archivo}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {fechaHora(l.creadoEn, zona ?? undefined)}
                  {l.creadoPor ? ` · ${l.creadoPor}` : ""} · {cuenta(l.total, "fila", "filas")}:{" "}
                  {cuenta(l.creados, "creada", "creadas")}
                  {l.actualizados > 0 && `, ${cuenta(l.actualizados, "completada", "completadas")}`}
                  {l.omitidos > 0 && `, ${cuenta(l.omitidos, "omitida", "omitidas")}`}
                  {l.fallidos > 0 && `, ${numero(l.fallidos)} con error`}
                </p>
                {l.estado === "deshecho" && l.deshechoEn && (
                  <p className="text-xs text-muted-foreground">
                    Deshecho el {fechaHora(l.deshechoEn, zona ?? undefined)}
                    {l.deshechoPor ? ` por ${l.deshechoPor}` : ""}
                  </p>
                )}
                {l.tipo === "citas" && l.estado === "completado" && !l.enRecordatorios && (
                  <p className="text-xs text-muted-foreground">
                    Sus citas no aparecen en Recordatorios.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[11px] font-medium",
                    l.estado === "completado" && "bg-success-soft text-success",
                    l.estado === "deshecho" && "bg-neutral-soft text-muted-foreground",
                    l.estado === "en_curso" && "bg-warning-soft text-foreground",
                  )}
                >
                  {ETIQUETA_ESTADO_LOTE[l.estado]}
                </span>
                {l.tipo === "citas" && l.estado === "completado" && !l.enRecordatorios && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={activar.isPending}
                    onClick={() => activar.mutate(l.id)}
                  >
                    Incluir en Recordatorios
                  </Button>
                )}
                {l.estado !== "deshecho" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revisando === l.id}
                    onClick={() => void abrirReversa(l)}
                  >
                    {revisando === l.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <RotateCcw className="size-4" aria-hidden />
                    )}
                    Deshacer
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={reversa !== null}
        onOpenChange={(o) => !o && !deshacer.isPending && setReversa(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-warning" aria-hidden />
              {reversa && reversa.motivos.length > 0
                ? "No se puede deshacer este lote"
                : reversa && reversa.registros > 0
                  ? `¿Deshacer el lote y borrar ${cuenta(reversa.registros, "registro", "registros")}?`
                  : "¿Deshacer el lote?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {reversa && reversa.motivos.length > 0 ? (
                  <>
                    <p>
                      Después de importarlo se trabajó sobre sus registros, y borrarlos haría perder
                      esa actividad:
                    </p>
                    <ul className="list-disc space-y-1 pl-5">
                      {reversa.motivos.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                    <p>
                      Si hay datos mal importados, corrígelos en cada ficha o fusiona las fichas
                      repetidas.
                    </p>
                  </>
                ) : (
                  <p>
                    Se borra lo que creó este lote (
                    {cuenta(reversa?.registros ?? 0, "registro", "registros")}) y se vacían los
                    campos que completó en fichas existentes, si nadie los cambió. El lote queda en
                    el historial como deshecho. No se puede volver atrás.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deshacer.isPending}>
              {reversa && reversa.motivos.length > 0 ? "Entendido" : "Cancelar"}
            </AlertDialogCancel>
            {reversa && reversa.motivos.length === 0 && (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deshacer.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  deshacer.mutate({ loteId: reversa.lote.id, registros: reversa.registros });
                }}
              >
                {deshacer.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Deshacer lote
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
