/**
 * FIC-11 · Evolución restringida, en el editor de notas.
 *
 * - `RestriccionDeNota`: el estado de la nota abierta y, para su autor u
 *   owner/admin, el interruptor. La base es la que decide (trigger
 *   `proteger_restriccion_de_nota` y políticas RESTRICTIVE): esto solo
 *   muestra el control a quien lo puede usar.
 * - `AvisoRestringidasOcultas`: "Hay 1 nota restringida que no puedes ver",
 *   sin nada de su contenido, para que nadie crea que la historia está
 *   completa cuando no lo está.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";

import { setNoteRestricted } from "@/lib/clinical/clinical-notes.functions";
import { formatoFechaHora } from "@/lib/clinical/clinical-notes";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

export function RestriccionDeNota({
  clinicId,
  patientId,
  noteId,
  restringida,
  restringidaEl,
  puedeCambiar,
  esAdenda,
}: {
  clinicId: string;
  patientId: string;
  noteId: string;
  restringida: boolean;
  restringidaEl: string | null;
  puedeCambiar: boolean;
  esAdenda: boolean;
}) {
  const queryClient = useQueryClient();
  const cambiar = useServerFn(setNoteRestricted);
  const mutacion = useMutation({
    mutationFn: (restricted: boolean) => cambiar({ data: { clinicId, noteId, restricted } }),
    onSuccess: (_r, restricted) => {
      void queryClient.invalidateQueries({ queryKey: ["clinical-notes", clinicId, patientId] });
      toast.success(
        restricted
          ? "Nota restringida: solo la ven quien la escribió y la administración."
          : "La nota vuelve a verla todo el equipo clínico.",
      );
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (!restringida && !puedeCambiar) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-[14px] border px-3 py-2.5",
        restringida ? "border-foreground/30 bg-secondary/60" : "border-hairline",
      )}
    >
      <p className="flex min-w-0 items-start gap-2 text-sm">
        {restringida ? (
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <LockOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span>
          {restringida ? (
            <>
              <b className="font-semibold">Evolución restringida.</b> Solo la ven quien la escribió
              y la administración de la clínica; cada apertura queda registrada
              {restringidaEl ? ` (restringida el ${formatoFechaHora(restringidaEl)})` : ""}.
            </>
          ) : (
            <span className="text-muted-foreground">
              La ve todo el equipo clínico. Restríngela si contiene algo que solo deben ver tú y la
              administración.
            </span>
          )}
        </span>
      </p>
      {puedeCambiar && !(restringida && esAdenda) && (
        <button
          type="button"
          onClick={() => {
            if (
              restringida &&
              !confirm("¿Quitar la restricción? La nota la va a ver todo el equipo clínico.")
            )
              return;
            mutacion.mutate(!restringida);
          }}
          disabled={mutacion.isPending}
          aria-pressed={restringida}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold disabled:opacity-60 pointer-coarse:h-11",
            restringida
              ? "border-control hover:border-foreground"
              : "border-foreground bg-foreground text-background",
          )}
        >
          {mutacion.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : restringida ? (
            <LockOpen className="size-4" aria-hidden />
          ) : (
            <Lock className="size-4" aria-hidden />
          )}
          {restringida ? "Quitar restricción" : "Restringir"}
        </button>
      )}
      {restringida && esAdenda && (
        <p className="w-full text-[13px] text-muted-foreground">
          Es una adenda de una nota restringida: sigue la restricción de esa nota.
        </p>
      )}
    </div>
  );
}

export function AvisoRestringidasOcultas({ cantidad }: { cantidad: number }) {
  if (cantidad <= 0) return null;
  return (
    <p className="mb-4 flex items-start gap-2 rounded-[14px] border border-hairline bg-secondary/60 px-3 py-2.5 text-sm text-muted-foreground">
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {cantidad === 1
          ? "Hay 1 nota restringida de este paciente que no puedes ver."
          : `Hay ${cantidad} notas restringidas de este paciente que no puedes ver.`}{" "}
        Las ven quien las escribió y la administración de la clínica.
      </span>
    </p>
  );
}
