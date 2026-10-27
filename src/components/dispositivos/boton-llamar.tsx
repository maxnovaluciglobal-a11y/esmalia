import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";

import { llamarASala } from "@/lib/dispositivos/dispositivos.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

/**
 * "Llamar" (AUT-04) desde la agenda: el paciente que ya está en sala aparece
 * en la TV de la sala de espera con su turno y el box. El servidor y la base
 * exigen un rol de agenda y que la cita sea de hoy y esté en sala.
 */
export function BotonLlamarASala({
  appointmentId,
  className,
}: {
  appointmentId: string;
  className?: string;
}) {
  const llamarFn = useServerFn(llamarASala);
  const llamar = useMutation({
    mutationFn: () => llamarFn({ data: { appointmentId } }),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(
          `Llamado en la sala${r.turno ? ` (N.º ${r.turno})` : ""}${r.box ? ` · ${r.box}` : ""}.`,
        );
      } else {
        toast.error(r.motivo);
      }
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  return (
    <button
      type="button"
      disabled={llamar.isPending}
      onClick={() => llamar.mutate()}
      className={className}
    >
      {llamar.isPending ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : (
        <Megaphone aria-hidden className="size-4" />
      )}
      Llamar
    </button>
  );
}
