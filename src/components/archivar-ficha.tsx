import { useState } from "react";
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
import { setPatientArchived } from "@/lib/patients/patients.functions";
import { EXPLICACION_CONSERVACION } from "@/lib/patients/archivo";
import { formatoFecha } from "@/lib/clinic-operations/clinic-data";
import { mensajeDeError } from "@/lib/mensaje-error";
import { BloqueoEscritura } from "@/components/solo-lectura";

/**
 * Archivar o restaurar una ficha (LEG-08 / CLI-05). No existe "eliminar
 * paciente": la historia clínica se conserva por ley. El permiso real lo
 * aplica la base (solo owner/admin, trigger `patients_controlar_archivo`).
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

  const cambiar = useMutation({
    mutationFn: () => archivarFn({ data: { clinicId, patientId, archivar: !archivada } }),
    onSuccess: async () => {
      setAbierto(false);
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
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cambiar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={cambiar.isPending}
              onClick={(e) => {
                e.preventDefault();
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
