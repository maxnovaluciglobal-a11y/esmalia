import { useId, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
import { buttonVariants } from "@/components/ui/button";
import { archivePatients, setPatientArchived } from "@/lib/patients/patients.functions";
import {
  errorDeMotivoDeArchivo,
  EXPLICACION_CONSERVACION,
  LARGO_MAXIMO_MOTIVO_ARCHIVO,
  MOTIVOS_DE_ARCHIVO_SUGERIDOS,
  tituloArchivoMasivo,
} from "@/lib/patients/archivo";
import { numero } from "@/lib/formato-fecha";
import { formatoFecha } from "@/lib/clinic-operations/clinic-data";
import { mensajeDeError } from "@/lib/mensaje-error";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { cn } from "@/lib/utils";

/**
 * Archivar o restaurar una ficha (LEG-08 / CLI-05). No existe "eliminar
 * paciente": la historia clínica se conserva por ley. El permiso real lo
 * aplica la base (solo owner/admin, trigger `patients_controlar_archivo`).
 * PAC-15 (Ola 8): archivar pide el motivo, que queda en la ficha.
 */
export function ArchivarFichaButton({
  clinicId,
  patientId,
  patientName,
  archivadaEl,
  abierto: abiertoControlado,
  onAbiertoChange,
}: {
  clinicId: string;
  patientId: string;
  patientName: string;
  archivadaEl: string | null;
  /** Modo controlado (menú "Más acciones"): sin botón propio; la confirmación se mantiene. */
  abierto?: boolean;
  onAbiertoChange?: (abierto: boolean) => void;
}) {
  const controlado = abiertoControlado !== undefined;
  const [abiertoInterno, setAbiertoInterno] = useState(false);
  const abierto = controlado ? abiertoControlado : abiertoInterno;
  const setAbierto = (v: boolean) => (controlado ? onAbiertoChange?.(v) : setAbiertoInterno(v));
  const router = useRouter();
  const queryClient = useQueryClient();
  const archivarFn = useServerFn(setPatientArchived);
  const archivada = Boolean(archivadaEl);
  const [motivo, setMotivo] = useState("");
  const [intento, setIntento] = useState(false);
  const errorMotivo = archivada ? null : errorDeMotivoDeArchivo(motivo);

  const cambiar = useMutation({
    mutationFn: () =>
      archivarFn({
        data: archivada
          ? { clinicId, patientId, archivar: false }
          : { clinicId, patientId, archivar: true, motivo: motivo.trim() },
      }),
    onSuccess: async () => {
      setAbierto(false);
      setMotivo("");
      setIntento(false);
      toast.success(archivada ? "Ficha restaurada" : "Ficha archivada");
      await queryClient.invalidateQueries({ queryKey: ["patients", clinicId] });
      void router.invalidate();
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  return (
    <>
      {!controlado && (
        <BloqueoEscritura>
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className={buttonVariants({ variant: "outline" })}
          >
            {archivada ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {archivada ? "Restaurar ficha" : "Archivar ficha"}
          </button>
        </BloqueoEscritura>
      )}

      <AlertDialog open={abierto} onOpenChange={(next) => !cambiar.isPending && setAbierto(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archivada
                ? `Restaurar la ficha de ${patientName}`
                : `Archivar la ficha de ${patientName}`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {archivada ? (
                  <p>
                    La ficha vuelve a aparecer en los listados y en la búsqueda. Está archivada
                    desde el {formatoFecha(archivadaEl!.slice(0, 10))}.
                  </p>
                ) : (
                  <>
                    <p>{EXPLICACION_CONSERVACION}</p>
                    <p>Las citas futuras no se cancelan solas: revísalas en la agenda.</p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!archivada && (
            <CampoMotivoArchivo
              valor={motivo}
              onChange={setMotivo}
              error={intento ? errorMotivo : null}
              deshabilitado={cambiar.isPending}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cambiar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={cambiar.isPending}
              onClick={(e) => {
                e.preventDefault();
                setIntento(true);
                if (errorMotivo) return;
                cambiar.mutate();
              }}
            >
              {cambiar.isPending && <Loader2 className="size-3.5 animate-spin" />}
              {archivada ? "Restaurar" : "Archivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Motivo del archivo (PAC-15): campo con motivos frecuentes de un toque. */
export function CampoMotivoArchivo({
  valor,
  onChange,
  error,
  deshabilitado,
}: {
  valor: string;
  onChange: (v: string) => void;
  error: string | null;
  deshabilitado?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        Motivo
      </label>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Motivos frecuentes">
        {MOTIVOS_DE_ARCHIVO_SUGERIDOS.map((m) => (
          <button
            key={m}
            type="button"
            disabled={deshabilitado}
            onClick={() => onChange(m)}
            aria-pressed={valor === m}
            className={cn(
              "inline-flex h-[30px] items-center rounded-full border px-[11px] text-[12.5px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11",
              valor === m
                ? "border-foreground bg-foreground text-background"
                : "border-control text-foreground/80 hover:border-foreground",
            )}
          >
            {m}
          </button>
        ))}
      </div>
      <textarea
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        disabled={deshabilitado}
        maxLength={LARGO_MAXIMO_MOTIVO_ARCHIVO}
        rows={2}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        placeholder="Ej.: se atiende en otra clínica desde marzo"
        className="block w-full rounded-lg border border-control bg-card px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Archivo masivo (PAC-15) desde la selección de /pacientes: confirma con la
 * cifra y el motivo, y nunca borra (la base solo marca `archived_at`). Solo
 * owner/admin; el par de servidor es el trigger `patients_controlar_archivo`.
 */
export function ArchivarVariasFichasDialog({
  clinicId,
  patientIds,
  abierto,
  onAbiertoChange,
  onArchivadas,
}: {
  clinicId: string;
  patientIds: readonly string[];
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  onArchivadas?: (cantidad: number) => void;
}) {
  const queryClient = useQueryClient();
  const archivarFn = useServerFn(archivePatients);
  const [motivo, setMotivo] = useState("");
  const [intento, setIntento] = useState(false);
  const errorMotivo = errorDeMotivoDeArchivo(motivo);
  const cantidad = patientIds.length;

  const archivar = useMutation({
    mutationFn: () =>
      archivarFn({ data: { clinicId, patientIds: [...patientIds], motivo: motivo.trim() } }),
    onSuccess: async ({ archivadas }) => {
      onAbiertoChange(false);
      setMotivo("");
      setIntento(false);
      toast.success(
        archivadas === 1 ? "1 ficha archivada" : `${numero(archivadas)} fichas archivadas`,
      );
      onArchivadas?.(archivadas);
      await queryClient.invalidateQueries({ queryKey: ["patients", clinicId] });
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  return (
    <AlertDialog
      open={abierto}
      onOpenChange={(next) => !archivar.isPending && onAbiertoChange(next)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tituloArchivoMasivo(cantidad)}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                Vas a archivar {cantidad === 1 ? "1 ficha" : `${numero(cantidad)} fichas`}. Ninguna
                se elimina.
              </p>
              <p>{EXPLICACION_CONSERVACION}</p>
              <p>Las citas futuras no se cancelan solas: revísalas en la agenda.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <CampoMotivoArchivo
          valor={motivo}
          onChange={setMotivo}
          error={intento ? errorMotivo : null}
          deshabilitado={archivar.isPending}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={archivar.isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={archivar.isPending || cantidad === 0}
            onClick={(e) => {
              e.preventDefault();
              setIntento(true);
              if (errorMotivo) return;
              archivar.mutate();
            }}
          >
            {archivar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {tituloArchivoMasivo(cantidad)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
