/**
 * IMG-01 · Subir (o editar) un examen: tipo, archivo(s), fecha, piezas,
 * profesional, sesión de fotos y nota. Desde el celular, "Tomar foto" abre la
 * cámara trasera. Varias fotos de una vez quedan con los mismos datos.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, FileUp, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { CLASE_CAMPO } from "@/components/cita-formulario";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { leerPiezas } from "@/lib/clinical/consentimientos";
import { listProfesionalesClinicos } from "@/lib/clinical/prescriptions.functions";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { cabeEnElCupo, type EstadoCupo } from "@/lib/examenes/cupo";
import {
  actualizarExamen,
  cancelarSubidaExamen,
  confirmarSubidaExamen,
  prepararSubidaExamen,
  type ExamenDeFicha,
  type SesionDeFotos,
} from "@/lib/examenes/examenes.functions";
import {
  INFO_TIPO,
  TIPOS_EXAMEN,
  acceptDe,
  formatearBytes,
  limitePorArchivo,
  problemaDeArchivo,
  type TipoExamen,
} from "@/lib/examenes/tipos";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

import { ErrorDeSubida } from "@/lib/examenes/subida-reanudable";

import { limpiarSubidasVencidas, subirExamen } from "./subida";
import { AvisoDeCupo } from "./uso-de-almacenamiento";

export interface PreseleccionSubida {
  kind?: TipoExamen;
  photoSessionId?: string | null;
  teeth?: number[];
  /** Abre la cámara apenas se abre el diálogo (botón "Tomar foto"). */
  camara?: boolean;
}

interface EnvioEnCurso {
  nombre: string;
  enviados: number;
  total: number;
  /** Segundos que faltan; null mientras no hay una velocidad estable. */
  resto: number | null;
  aviso: string | null;
}

/** Estima los segundos que faltan con la velocidad de los últimos ~8 s. */
function crearMedidor() {
  const muestras: { t: number; n: number }[] = [];
  return (enviados: number, total: number): number | null => {
    const t = performance.now();
    muestras.push({ t, n: enviados });
    while (muestras.length > 2 && t - muestras[0].t > 8000) muestras.shift();
    const a = muestras[0];
    const dt = (t - a.t) / 1000;
    if (dt < 2 || enviados <= a.n) return null;
    return Math.max(0, Math.round((total - enviados) / ((enviados - a.n) / dt)));
  };
}

function textoDeTiempo(segundos: number): string {
  if (segundos < 60) return `${Math.max(5, Math.ceil(segundos / 5) * 5)} s`;
  const m = Math.ceil(segundos / 60);
  return m === 1 ? "1 minuto" : `${m} minutos`;
}

export function SubirExamenDialog({
  abierto,
  onCerrar,
  clinicId,
  patientId,
  timezone,
  myProfessionalId,
  sesiones,
  estadoCupo,
  preseleccion,
  examen,
  onListo,
}: {
  abierto: boolean;
  onCerrar: () => void;
  clinicId: string;
  patientId: string;
  timezone: string | undefined;
  myProfessionalId: string | null;
  sesiones: SesionDeFotos[];
  estadoCupo: EstadoCupo | null;
  preseleccion?: PreseleccionSubida;
  /** Con examen: modo edición (sin archivo). */
  examen?: ExamenDeFicha | null;
  onListo: () => void;
}) {
  const id = useId();
  const editando = Boolean(examen);
  const preparar = useServerFn(prepararSubidaExamen);
  const confirmar = useServerFn(confirmarSubidaExamen);
  const cancelar = useServerFn(cancelarSubidaExamen);
  const actualizar = useServerFn(actualizarExamen);
  const listarProfesionales = useServerFn(listProfesionalesClinicos);
  const profesionales = useQuery({
    queryKey: ["profesionales-clinicos", clinicId],
    queryFn: () => listarProfesionales({ data: { clinicId } }),
    enabled: abierto,
    staleTime: 5 * 60 * 1000,
  });

  const [kind, setKind] = useState<TipoExamen>("foto_clinica");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [takenOn, setTakenOn] = useState("");
  const [piezasTexto, setPiezasTexto] = useState("");
  const [professionalId, setProfessionalId] = useState<string>("");
  const [photoSessionId, setPhotoSessionId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);
  const [envio, setEnvio] = useState<EnvioEnCurso | null>(null);
  const control = useRef<AbortController | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const inputCamara = useRef<HTMLInputElement>(null);

  // Al abrir: valores iniciales (edición o preselección).
  useEffect(() => {
    if (!abierto) return;
    setArchivos([]);
    setProgreso(null);
    if (examen) {
      setKind(examen.kind);
      setTakenOn(examen.takenOn);
      setPiezasTexto(examen.teeth.join(", "));
      setProfessionalId(examen.professionalId ?? "");
      setPhotoSessionId(examen.photoSessionId ?? "");
      setNotes(examen.notes ?? "");
    } else {
      setKind(preseleccion?.kind ?? "foto_clinica");
      setTakenOn(hoyISO(timezone));
      setPiezasTexto((preseleccion?.teeth ?? []).join(", "));
      setProfessionalId(myProfessionalId ?? "");
      setPhotoSessionId(preseleccion?.photoSessionId ?? "");
      setNotes("");
      if (preseleccion?.camara) {
        // Después del render, para que el input exista.
        setTimeout(() => inputCamara.current?.click(), 50);
      }
    }
  }, [abierto, examen, preseleccion, timezone, myProfessionalId]);

  const piezas = useMemo(() => leerPiezas(piezasTexto), [piezasTexto]);
  const sesionesVigentes = sesiones.filter((s) => !s.archivedAt);
  const problemas = archivos
    .map((a) => ({ a, p: problemaDeArchivo(kind, a) }))
    .filter((x) => x.p !== null);
  const totalBytes = archivos.reduce((s, a) => s + a.size, 0);
  const sinLugar =
    !editando &&
    estadoCupo !== null &&
    (estadoCupo.nivel === "lleno" || !cabeEnElCupo(estadoCupo.usado, estadoCupo.cupo, totalBytes));
  const subiendo = progreso !== null;

  // Mientras sube, el navegador avisa antes de cerrar la pestaña.
  useEffect(() => {
    if (!subiendo || editando) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [subiendo, editando]);
  useEffect(() => limpiarSubidasVencidas(), []);
  const esFoto = kind === "foto_clinica";

  function elegir(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    const nuevos = Array.from(lista);
    setArchivos((prev) => (esFoto ? [...prev, ...nuevos].slice(0, 20) : nuevos.slice(0, 1)));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (piezas.invalidas.length > 0) {
      toast.error(`Revisa las piezas: ${piezas.invalidas.join(", ")} no es una pieza FDI.`);
      return;
    }
    const comunes = {
      clinicId,
      kind,
      takenOn,
      teeth: piezas.piezas,
      professionalId: professionalId || null,
      notes: notes.trim(),
      photoSessionId: esFoto && photoSessionId ? photoSessionId : null,
    };
    if (editando && examen) {
      setProgreso({ hecho: 0, total: 1 });
      try {
        await actualizar({ data: { ...comunes, examId: examen.id } });
        toast.success("Examen actualizado.");
        onListo();
        onCerrar();
      } catch (err) {
        toast.error(mensajeDeError(err));
      } finally {
        setProgreso(null);
      }
      return;
    }
    if (archivos.length === 0 || problemas.length > 0 || sinLugar) return;
    setProgreso({ hecho: 0, total: archivos.length });
    let subidos = 0;
    const abortador = new AbortController();
    control.current = abortador;
    try {
      for (const archivo of archivos) {
        const medidor = crearMedidor();
        setEnvio({
          nombre: archivo.name,
          enviados: 0,
          total: archivo.size,
          resto: null,
          aviso: null,
        });
        await subirExamen(
          archivo,
          { ...comunes, patientId },
          { preparar, confirmar, cancelar },
          {
            senal: abortador.signal,
            alProgreso: (enviados, total) => {
              const resto = medidor(enviados, total);
              setEnvio({ nombre: archivo.name, enviados, total, resto, aviso: null });
            },
            alReintento: ({ sinConexion }) =>
              setEnvio((e) =>
                e
                  ? {
                      ...e,
                      aviso: sinConexion
                        ? "Sin conexión. La subida continuará sola cuando vuelva internet."
                        : "Se cortó un momento la conexión. Reintentando…",
                    }
                  : e,
              ),
          },
        );
        subidos += 1;
        setProgreso({ hecho: subidos, total: archivos.length });
      }
      toast.success(subidos === 1 ? "Examen subido." : `${subidos} archivos subidos.`);
      onListo();
      onCerrar();
    } catch (err) {
      if (subidos > 0) onListo();
      const cancelada = err instanceof ErrorDeSubida && err.codigo === "cancelada";
      if (cancelada) {
        toast.message("Subida cancelada. No se guardó nada.");
      } else {
        toast.error(
          subidos > 0
            ? `Se subieron ${subidos} de ${archivos.length}. ${mensajeDeError(err)}`
            : mensajeDeError(err),
        );
      }
      setArchivos((prev) => prev.slice(subidos));
    } finally {
      control.current = null;
      setEnvio(null);
      setProgreso(null);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && !subiendo && onCerrar()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-medium">
            {editando ? "Editar examen" : "Subir examen"}
          </DialogTitle>
          <DialogDescription>
            {editando
              ? "Corrige el tipo, la fecha, las piezas o la nota. El archivo no se reemplaza."
              : "Radiografías, CBCT, escaneos intraorales, fotos clínicas o documentos."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={guardar} className="space-y-4">
          {!editando && <AvisoDeCupo estado={estadoCupo} />}

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-tipo`}>Tipo de examen</Label>
            <select
              id={`${id}-tipo`}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as TipoExamen);
                setArchivos([]);
              }}
              className={CLASE_CAMPO}
              disabled={subiendo}
            >
              {TIPOS_EXAMEN.map((t) => (
                <option key={t} value={t}>
                  {INFO_TIPO[t].etiqueta}
                </option>
              ))}
            </select>
          </div>

          {!editando && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Archivo{esFoto ? "s" : ""}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => inputArchivo.current?.click()}
                  disabled={subiendo}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full border border-control px-4 text-sm font-semibold hover:border-foreground pointer-coarse:h-11"
                >
                  <FileUp className="size-4" aria-hidden /> Elegir archivo{esFoto ? "s" : ""}
                </button>
                {esFoto && (
                  <button
                    type="button"
                    onClick={() => inputCamara.current?.click()}
                    disabled={subiendo}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border border-foreground bg-foreground px-4 text-sm font-semibold text-background pointer-coarse:h-11"
                  >
                    <Camera className="size-4" aria-hidden /> Tomar foto
                  </button>
                )}
              </div>
              <input
                ref={inputArchivo}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                accept={acceptDe(kind)}
                multiple={esFoto}
                onChange={(e) => {
                  elegir(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={inputCamara}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  elegir(e.target.files);
                  e.target.value = "";
                }}
              />
              <p className="text-xs text-muted-foreground">
                Admite {INFO_TIPO[kind].extensiones.map((x) => x.toUpperCase()).join(", ")} · hasta{" "}
                <span className="cifra">{formatearBytes(limitePorArchivo(kind))}</span> por archivo.
              </p>
              {archivos.length > 0 && (
                <ul className="divide-y divide-hairline rounded-[14px] border border-hairline">
                  {archivos.map((a, i) => {
                    const p = problemaDeArchivo(kind, a);
                    return (
                      <li
                        key={`${a.name}-${i}`}
                        className="flex items-center gap-2 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{a.name}</span>
                          <span
                            className={cn(
                              "block text-xs",
                              p ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {p ? (
                              p.mensaje
                            ) : (
                              <span className="cifra">{formatearBytes(a.size)}</span>
                            )}
                          </span>
                        </span>
                        {!subiendo && (
                          <button
                            type="button"
                            aria-label={`Quitar ${a.name}`}
                            onClick={() => setArchivos((prev) => prev.filter((_, j) => j !== i))}
                            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary pointer-coarse:size-11"
                          >
                            <X className="size-4" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {sinLugar && archivos.length > 0 && estadoCupo?.nivel !== "lleno" && (
                <p className="text-sm text-destructive" role="alert">
                  Estos archivos pesan {formatearBytes(totalBytes)} y quedan{" "}
                  {formatearBytes(estadoCupo?.restante ?? 0)} de almacenamiento.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-fecha`}>Fecha del examen</Label>
              <input
                id={`${id}-fecha`}
                type="date"
                required
                value={takenOn}
                max={hoyISO(timezone)}
                onChange={(e) => setTakenOn(e.target.value)}
                className={CLASE_CAMPO}
                disabled={subiendo}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-piezas`}>Piezas (opcional)</Label>
              <input
                id={`${id}-piezas`}
                inputMode="numeric"
                placeholder="Ej.: 16, 26"
                value={piezasTexto}
                onChange={(e) => setPiezasTexto(e.target.value)}
                aria-invalid={piezas.invalidas.length > 0}
                aria-describedby={`${id}-piezas-ayuda`}
                className={CLASE_CAMPO}
                disabled={subiendo}
              />
              <p
                id={`${id}-piezas-ayuda`}
                className={cn(
                  "text-xs",
                  piezas.invalidas.length ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {piezas.invalidas.length
                  ? `${piezas.invalidas.join(", ")} no es una pieza FDI.`
                  : "Numeración FDI, separadas por coma."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-profesional`}>Profesional</Label>
              <select
                id={`${id}-profesional`}
                value={professionalId}
                onChange={(e) => setProfessionalId(e.target.value)}
                className={CLASE_CAMPO}
                disabled={subiendo}
              >
                <option value="">Sin indicar</option>
                {(profesionales.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </div>
            {esFoto && (
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-sesion`}>Sesión de fotos</Label>
                <select
                  id={`${id}-sesion`}
                  value={photoSessionId}
                  onChange={(e) => setPhotoSessionId(e.target.value)}
                  className={CLASE_CAMPO}
                  disabled={subiendo}
                >
                  <option value="">Sin sesión</option>
                  {sesionesVigentes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {fecha(s.sessionDate)} · {s.reason}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-nota`}>Nota (opcional)</Label>
            <textarea
              id={`${id}-nota`}
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={CLASE_CAMPO}
              disabled={subiendo}
            />
          </div>

          {envio && (
            <div
              role="status"
              aria-live="polite"
              className="space-y-1.5 rounded-[14px] border border-hairline p-3"
            >
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">{envio.nombre}</span>
                <span className="cifra shrink-0 text-xs text-muted-foreground">
                  {formatearBytes(envio.enviados)} de {formatearBytes(envio.total)}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`Subiendo ${envio.nombre}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((envio.enviados / Math.max(1, envio.total)) * 100)}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full bg-foreground transition-[width] duration-150"
                  style={{ width: `${(envio.enviados / Math.max(1, envio.total)) * 100}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {envio.aviso ??
                  (envio.resto !== null
                    ? `Quedan unos ${textoDeTiempo(envio.resto)}. No cierres esta ventana.`
                    : "Subiendo. No cierres esta ventana.")}
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            {subiendo && !editando ? (
              <Button type="button" variant="outline" onClick={() => control.current?.abort()}>
                Cancelar subida
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={onCerrar} disabled={subiendo}>
                Cancelar
              </Button>
            )}
            <Button
              type="submit"
              disabled={
                subiendo ||
                (!editando && (archivos.length === 0 || problemas.length > 0 || sinLugar))
              }
            >
              {subiendo && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {editando
                ? "Guardar"
                : subiendo && progreso
                  ? `Subiendo ${Math.min(progreso.hecho + 1, progreso.total)} de ${progreso.total}…`
                  : archivos.length > 1
                    ? `Subir ${archivos.length} archivos`
                    : "Subir"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
