/**
 * FIC-17 · Exámenes en la ficha (Ola 13): exámenes por tipo (IMG-01) con
 * miniatura, fecha, piezas, profesional y nota; filtro por familia y por
 * pieza (el odontograma enlaza acá); sesiones de fotos y antes/después
 * (IMG-02); "Ver en 3D" / "Ver DICOM" para el visor del frente B.
 *
 * Datos clínicos (regla 2): la pestaña solo existe con `clinical:view` y la
 * base vuelve a exigir rol clínico en la tabla y en Storage.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  Camera,
  Download,
  Eye,
  FileText,
  Loader2,
  Pencil,
  RotateCcw,
  ScanLine,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  archivarExamen,
  restaurarExamen,
  urlDeExamen,
  type ExamenDeFicha,
} from "@/lib/examenes/examenes.functions";
import {
  FAMILIAS,
  INFO_TIPO,
  esImagen,
  formatearBytes,
  formatoVisor,
  type FamiliaExamen,
} from "@/lib/examenes/tipos";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

import { ArchivarConMotivo } from "./archivar-con-motivo";
import { BotonVisor } from "./boton-visor";
import { SesionesDeFotos } from "./sesiones-de-fotos";
import { SubirExamenDialog, type PreseleccionSubida } from "./subir-examen-dialog";
import { useEstadoDelCupo, useExamenes, useInvalidarExamenes } from "./use-examenes";
import { AvisoDeCupo } from "./uso-de-almacenamiento";

type Filtro = "todos" | FamiliaExamen;
type Orden = "recientes" | "antiguos";

const CLASE_CHIP =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap pointer-coarse:h-11";

export function ExamenesDelPaciente({
  clinicId,
  patientId,
  timezone,
  puedeEditar,
  puedeRestaurar,
  myProfessionalId,
  pieza,
  onCambiarPieza,
}: {
  clinicId: string;
  patientId: string;
  timezone: string | undefined;
  puedeEditar: boolean;
  puedeRestaurar: boolean;
  myProfessionalId: string | null;
  /** Filtro por pieza (FDI) que llega desde el odontograma. */
  pieza: number | null;
  onCambiarPieza: (pieza: number | null) => void;
}) {
  const consulta = useExamenes(clinicId, patientId);
  const invalidar = useInvalidarExamenes(clinicId, patientId);
  const estadoCupo = useEstadoDelCupo(clinicId);
  const archivar = useServerFn(archivarExamen);
  const restaurar = useServerFn(restaurarExamen);

  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [orden, setOrden] = useState<Orden>("recientes");
  const [verArchivados, setVerArchivados] = useState(false);
  const [subiendo, setSubiendo] = useState<PreseleccionSubida | null>(null);
  const [editando, setEditando] = useState<ExamenDeFicha | null>(null);
  const [archivando, setArchivando] = useState<ExamenDeFicha | null>(null);
  const [viendo, setViendo] = useState<ExamenDeFicha | null>(null);

  const datos = consulta.data;
  const examenes = useMemo(() => datos?.examenes ?? [], [datos]);
  const vigentes = examenes.filter((e) => !e.archivedAt);
  const archivados = examenes.filter((e) => e.archivedAt);
  const conPieza = pieza ? vigentes.filter((e) => e.teeth.includes(pieza)) : vigentes;
  const conteo = (f: Filtro) =>
    f === "todos"
      ? conPieza.length
      : conPieza.filter((e) => INFO_TIPO[e.kind].familia === f).length;
  const visibles = (
    filtro === "todos" ? conPieza : conPieza.filter((e) => INFO_TIPO[e.kind].familia === filtro)
  )
    .slice()
    .sort((a, b) => {
      const c = a.takenOn.localeCompare(b.takenOn) || a.createdAt.localeCompare(b.createdAt);
      return orden === "recientes" ? -c : c;
    });
  const grupos =
    filtro === "todos"
      ? FAMILIAS.map((f) => ({
          ...f,
          items: visibles.filter((e) => INFO_TIPO[e.kind].familia === f.id),
        })).filter((g) => g.items.length > 0)
      : [{ id: filtro, etiqueta: "", items: visibles }];
  const lleno = estadoCupo?.nivel === "lleno";

  return (
    <div className="space-y-[18px]">
      <section
        aria-labelledby="examenes-titulo"
        className="rounded-panel border border-border bg-card p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="kicker">Exámenes e imágenes</p>
            <h3
              id="examenes-titulo"
              className="mt-1 font-display text-[30px] leading-none font-medium tracking-[-0.01em]"
            >
              Exámenes
              {vigentes.length > 0 && (
                <em className="text-brand-600">
                  {" "}
                  · <span className="cifra not-italic">{vigentes.length}</span>
                </em>
              )}
            </h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Radiografías, CBCT, escaneos intraorales, fotos clínicas y documentos del paciente.
            </p>
          </div>
          {puedeEditar && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSubiendo({ kind: "foto_clinica", camara: true })}
                disabled={lleno}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-control px-3.5 text-sm font-semibold hover:border-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:hidden pointer-coarse:h-11"
              >
                <Camera className="size-4" aria-hidden /> Tomar foto
              </button>
              <button
                type="button"
                onClick={() =>
                  setSubiendo({
                    kind: pieza ? "periapical" : "foto_clinica",
                    teeth: pieza ? [pieza] : [],
                  })
                }
                disabled={lleno}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-foreground bg-foreground px-3.5 text-sm font-semibold text-background disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:h-11"
              >
                <Upload className="size-4" aria-hidden /> Subir examen
              </button>
            </div>
          )}
        </div>

        <AvisoDeCupo estado={estadoCupo} className="mt-4" />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div
            className="-mx-1 flex max-w-full gap-2 overflow-x-auto px-1 pb-1"
            role="group"
            aria-label="Filtrar por tipo"
          >
            {(["todos", ...FAMILIAS.map((f) => f.id)] as Filtro[]).map((f) => {
              const activo = filtro === f;
              const n = conteo(f);
              if (f !== "todos" && n === 0 && !activo) return null;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => setFiltro(f)}
                  className={cn(
                    CLASE_CHIP,
                    activo
                      ? "border-foreground bg-foreground text-background"
                      : "border-control text-foreground/80 hover:border-foreground",
                  )}
                >
                  {f === "todos" ? "Todos" : FAMILIAS.find((x) => x.id === f)?.etiqueta}
                  <span className="cifra text-xs opacity-80">{n}</span>
                </button>
              );
            })}
          </div>
          {pieza && (
            <button
              type="button"
              onClick={() => onCambiarPieza(null)}
              className={cn(CLASE_CHIP, "border-brand bg-brand/10 text-brand-700")}
              aria-label={`Quitar el filtro de la pieza ${pieza}`}
            >
              Pieza <span className="cifra">{pieza}</span>
              <X className="size-3.5" aria-hidden />
            </button>
          )}
          <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <span className="sr-only sm:not-sr-only">Ordenar</span>
            <select
              value={orden}
              onChange={(e) => setOrden(e.target.value as Orden)}
              className="h-9 rounded-full border border-control bg-transparent px-3 text-sm font-semibold text-foreground pointer-coarse:h-11"
            >
              <option value="recientes">Más recientes</option>
              <option value="antiguos">Más antiguos</option>
            </select>
          </label>
        </div>

        <div className="mt-4">
          {consulta.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando exámenes…
            </p>
          ) : consulta.isError ? (
            <p className="text-sm text-muted-foreground">{mensajeDeError(consulta.error)}</p>
          ) : visibles.length === 0 ? (
            <p className="text-base text-muted-foreground">
              {pieza
                ? `Sin exámenes de la pieza ${pieza}.`
                : vigentes.length === 0
                  ? "Todavía no hay exámenes. Sube la primera radiografía o foto clínica."
                  : "Ningún examen de este tipo."}
            </p>
          ) : (
            <div className="space-y-5">
              {grupos.map((g) => (
                <div key={g.id}>
                  {g.etiqueta && (
                    <h4 className="kicker mb-2">
                      {g.etiqueta} · <span className="cifra">{g.items.length}</span>
                    </h4>
                  )}
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {g.items.map((e) => (
                      <TarjetaExamen
                        key={e.id}
                        examen={e}
                        clinicId={clinicId}
                        timezone={timezone}
                        puedeEditar={puedeEditar}
                        onVer={() => setViendo(e)}
                        onEditar={() => setEditando(e)}
                        onArchivar={() => setArchivando(e)}
                        onPieza={onCambiarPieza}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {archivados.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setVerArchivados((v) => !v)}
              aria-expanded={verArchivados}
              className="text-sm font-semibold underline underline-offset-2"
            >
              {verArchivados ? "Ocultar archivados" : `Ver archivados (${archivados.length})`}
            </button>
            {verArchivados && (
              <ul className="mt-3 divide-y divide-hairline rounded-[14px] border border-hairline">
                {archivados.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-semibold">{INFO_TIPO[e.kind].corta}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · <span className="cifra">{fecha(e.takenOn, timezone)}</span> · {e.filename}
                      </span>
                      <span className="block text-muted-foreground">
                        Archivado el <span className="cifra">{fecha(e.archivedAt, timezone)}</span>:{" "}
                        {e.archiveReason}
                      </span>
                    </span>
                    {puedeRestaurar && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await restaurar({ data: { clinicId, examId: e.id } });
                            toast.success("Examen restaurado.");
                            await invalidar();
                          } catch (err) {
                            toast.error(mensajeDeError(err));
                          }
                        }}
                        className="inline-flex h-8 items-center gap-1 rounded-full border border-control px-3 text-[13px] font-semibold hover:border-foreground pointer-coarse:h-11"
                      >
                        <RotateCcw className="size-3.5" aria-hidden /> Restaurar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <SesionesDeFotos
        clinicId={clinicId}
        patientId={patientId}
        timezone={timezone}
        sesiones={datos?.sesiones ?? []}
        fotos={vigentes.filter((e) => e.kind === "foto_clinica" && esImagen(e.mimeType))}
        planes={datos?.planes ?? []}
        puedeEditar={puedeEditar}
        onAgregarFotos={(sessionId) =>
          setSubiendo({ kind: "foto_clinica", photoSessionId: sessionId })
        }
        onCambio={() => void invalidar()}
      />

      <SubirExamenDialog
        abierto={subiendo !== null || editando !== null}
        onCerrar={() => {
          setSubiendo(null);
          setEditando(null);
        }}
        clinicId={clinicId}
        patientId={patientId}
        timezone={timezone}
        myProfessionalId={myProfessionalId}
        sesiones={datos?.sesiones ?? []}
        estadoCupo={estadoCupo}
        preseleccion={subiendo ?? undefined}
        examen={editando}
        onListo={() => void invalidar()}
      />
      <ArchivarConMotivo
        abierto={archivando !== null}
        titulo="Archivar el examen"
        descripcion="El examen deja de verse en la ficha, pero no se borra (la ficha clínica se conserva completa): queda con el motivo, quién y cuándo. Owner o admin lo pueden restaurar."
        onCerrar={() => setArchivando(null)}
        onConfirmar={async (motivo) => {
          if (!archivando) return;
          await archivar({ data: { clinicId, examId: archivando.id, motivo } });
          toast.success("Examen archivado.");
          await invalidar();
        }}
      />
      <VerExamen
        examen={viendo}
        clinicId={clinicId}
        timezone={timezone}
        onCerrar={() => setViendo(null)}
      />
    </div>
  );
}

function TarjetaExamen({
  examen: e,
  clinicId,
  timezone,
  puedeEditar,
  onVer,
  onEditar,
  onArchivar,
  onPieza,
}: {
  examen: ExamenDeFicha;
  clinicId: string;
  timezone: string | undefined;
  puedeEditar: boolean;
  onVer: () => void;
  onEditar: () => void;
  onArchivar: () => void;
  onPieza: (pieza: number) => void;
}) {
  const info = INFO_TIPO[e.kind];
  const formato = formatoVisor(e.filename, e.mimeType, e.kind);
  const Icono = info.familia === "documento" ? FileText : ScanLine;
  const descargar = useDescargar(clinicId);

  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-[14px] border border-border bg-background">
      <button
        type="button"
        onClick={onVer}
        className="group relative block aspect-[4/3] w-full overflow-hidden bg-muted text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-700"
        aria-label={`Ver ${info.etiqueta.toLowerCase()} del ${fecha(e.takenOn, timezone)}`}
      >
        {e.thumbUrl ? (
          <img
            src={e.thumbUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform group-hover:scale-[1.02] motion-reduce:transition-none"
          />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Icono className="size-8" aria-hidden />
            <span className="cifra text-xs uppercase">{e.filename.split(".").pop()}</span>
          </span>
        )}
        <span className="absolute top-2 left-2 inline-flex h-[24px] items-center rounded-full bg-foreground/85 px-2 text-[12px] font-semibold text-background">
          {info.corta}
        </span>
      </button>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="text-sm">
          <span className="cifra font-semibold">{fecha(e.takenOn, timezone)}</span>
          {e.professionalName && (
            <span className="text-muted-foreground"> · {e.professionalName}</span>
          )}
        </p>
        {e.teeth.length > 0 && (
          <p className="flex flex-wrap gap-1" aria-label="Piezas">
            {e.teeth.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onPieza(t)}
                className="cifra inline-flex h-6 items-center rounded-full border border-control px-2 text-xs font-semibold hover:border-foreground pointer-coarse:h-9"
                aria-label={`Ver exámenes de la pieza ${t}`}
              >
                {t}
              </button>
            ))}
          </p>
        )}
        {e.notes && <p className="line-clamp-2 text-sm text-muted-foreground">{e.notes}</p>}
        <p className="truncate text-xs text-muted-foreground" title={e.filename}>
          {e.filename} · <span className="cifra">{formatearBytes(e.sizeBytes)}</span>
        </p>
        <div className="mt-auto flex flex-wrap items-start gap-1.5 pt-1.5">
          <button
            type="button"
            onClick={onVer}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-control px-3 text-[13px] font-semibold hover:border-foreground pointer-coarse:h-11"
          >
            <Eye className="size-3.5" aria-hidden /> Ver
          </button>
          <button
            type="button"
            onClick={() => descargar(e.id)}
            aria-label={`Descargar ${e.filename}`}
            className="grid size-8 place-items-center rounded-full border border-control hover:border-foreground pointer-coarse:size-11"
          >
            <Download className="size-3.5" aria-hidden />
          </button>
          {formato && (
            <BotonVisor clinicId={clinicId} examId={e.id} formato={formato} nombre={e.filename} />
          )}
          {puedeEditar && (
            <>
              <button
                type="button"
                onClick={onEditar}
                aria-label={`Editar ${e.filename}`}
                className="grid size-8 place-items-center rounded-full border border-control hover:border-foreground pointer-coarse:size-11"
              >
                <Pencil className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={onArchivar}
                aria-label={`Archivar ${e.filename}`}
                className="grid size-8 place-items-center rounded-full border border-control hover:border-destructive hover:text-destructive pointer-coarse:size-11"
              >
                <Archive className="size-3.5" aria-hidden />
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function useDescargar(clinicId: string) {
  const pedir = useServerFn(urlDeExamen);
  return async (examId: string) => {
    try {
      const { url } = await pedir({ data: { clinicId, examId, descargar: true } });
      // La URL trae Content-Disposition: attachment, así que no navega.
      window.location.assign(url);
    } catch (err) {
      toast.error(mensajeDeError(err));
    }
  };
}

function VerExamen({
  examen,
  clinicId,
  timezone,
  onCerrar,
}: {
  examen: ExamenDeFicha | null;
  clinicId: string;
  timezone: string | undefined;
  onCerrar: () => void;
}) {
  const pedir = useServerFn(urlDeExamen);
  const descargar = useDescargar(clinicId);
  // URL firmada de 5 minutos, pedida recién al abrir.
  const consulta = useQuery({
    queryKey: ["examen-url", clinicId, examen?.id ?? ""],
    queryFn: async () => (await pedir({ data: { clinicId, examId: examen!.id } })).url,
    enabled: examen !== null,
    staleTime: 4 * 60 * 1000,
  });
  const listo = consulta.data ?? null;
  const error = consulta.isError ? mensajeDeError(consulta.error) : null;
  const cerrar = onCerrar;

  return (
    <Dialog open={examen !== null} onOpenChange={(v) => !v && cerrar()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-4xl">
        {examen && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl font-medium">
                {INFO_TIPO[examen.kind].etiqueta}
              </DialogTitle>
              <DialogDescription>
                <span className="cifra">{fecha(examen.takenOn, timezone)}</span>
                {examen.teeth.length > 0 && (
                  <>
                    {" "}
                    · Piezas <span className="cifra">{examen.teeth.join(", ")}</span>
                  </>
                )}
                {examen.professionalName && <> · {examen.professionalName}</>}
              </DialogDescription>
            </DialogHeader>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : !listo ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Abriendo el archivo…
              </p>
            ) : esImagen(examen.mimeType) ? (
              <img
                src={listo}
                alt={`${INFO_TIPO[examen.kind].etiqueta} del ${fecha(examen.takenOn, timezone)}`}
                className="max-h-[70dvh] w-full rounded-[14px] border border-border bg-muted object-contain"
              />
            ) : (
              <div className="rounded-[14px] border border-border p-4 text-sm">
                <p>
                  {examen.filename} ·{" "}
                  <span className="cifra">{formatearBytes(examen.sizeBytes)}</span>
                </p>
                <p className="mt-1 text-muted-foreground">
                  Este archivo no se muestra dentro de la ficha. Ábrelo en otra pestaña o
                  descárgalo.
                </p>
                <a
                  href={listo}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-foreground px-3.5 font-semibold pointer-coarse:h-11"
                >
                  <Eye className="size-4" aria-hidden /> Abrir en otra pestaña
                </a>
              </div>
            )}
            {examen.notes && <p className="text-sm text-muted-foreground">{examen.notes}</p>}
            <div>
              <button
                type="button"
                onClick={() => descargar(examen.id)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-control px-3.5 text-sm font-semibold hover:border-foreground pointer-coarse:h-11"
              >
                <Download className="size-4" aria-hidden /> Descargar original
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
