import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { BloqueoEscritura } from "@/components/solo-lectura";
import {
  setAtiendePacientes,
  type ProfessionalDetail,
} from "@/lib/clinic-operations/professionals.functions";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * EQU-04 · "Atiende pacientes": solo quien atiende aparece como profesional
 * en la agenda y en la reserva en línea. Sin marca, se deduce del rol (una
 * cuenta de recepción o contabilidad no atiende); el interruptor la fija.
 */
export function AtiendePacientes({
  clinicId,
  professional,
}: {
  clinicId: string;
  professional: Pick<ProfessionalDetail, "id" | "fullName" | "atiende" | "attendsPatients">;
}) {
  const qc = useQueryClient();
  const setFn = useServerFn(setAtiendePacientes);
  const cambiar = useMutation({
    mutationFn: (atiende: boolean) =>
      setFn({ data: { clinicId, professionalId: professional.id, atiende } }),
    onSuccess: (_, atiende) => {
      void qc.invalidateQueries({ queryKey: ["professionals-detailed", clinicId] });
      void qc.invalidateQueries({ queryKey: ["professionals", clinicId] });
      toast.success(
        atiende
          ? `${professional.fullName} aparece en la agenda y en la reserva en línea.`
          : `${professional.fullName} ya no aparece como profesional en la agenda.`,
      );
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const activo = professional.atiende;
  return (
    <BloqueoEscritura>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        disabled={cambiar.isPending}
        onClick={() => cambiar.mutate(!activo)}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          activo
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-card text-muted-foreground",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            activo ? "bg-brand-on-night" : "bg-muted-foreground/50",
          )}
        />
        {activo ? "Atiende pacientes" : "No atiende pacientes"}
      </button>
    </BloqueoEscritura>
  );
}
