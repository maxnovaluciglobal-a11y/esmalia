import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setPatientWhatsAppOptIn } from "@/lib/messaging/messaging.functions";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";

interface Props {
  clinicId: string;
  patientId: string;
  initialOptIn: boolean;
}

/**
 * Consentimiento para outreach proactivo (recall/reseña/saldo) — NO gatea los
 * recordatorios de cita, que son transaccionales a un turno que el paciente
 * ya reservó. Apagarlo es inmediato para cualquier operador; prenderlo
 * asume que ya se habló con el paciente (no hay doble confirmación acá,
 * como sí la hay del lado del paciente cuando responde BAJA por WhatsApp).
 */
export function WhatsAppOptInToggle({ clinicId, patientId, initialOptIn }: Props) {
  const [optIn, setOptIn] = useState(initialOptIn);
  const setOptInFn = useServerFn(setPatientWhatsAppOptIn);

  const mut = useMutation({
    mutationFn: (next: boolean) => setOptInFn({ data: { clinicId, patientId, optIn: next } }),
    onSuccess: (_data, next) => {
      setOptIn(next);
      toast.success(
        next ? "Outreach por WhatsApp activado." : "Outreach por WhatsApp desactivado.",
      );
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <button
        type="button"
        role="switch"
        aria-checked={optIn}
        aria-label="Mensajes proactivos por WhatsApp (control periódico, reseña, saldo)"
        disabled={mut.isPending}
        onClick={() => mut.mutate(!optIn)}
        // Área táctil de 44 px alrededor del interruptor (UX-12), sin
        // agrandar el dibujo ni la fila.
        className="-my-3 grid h-11 w-11 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:opacity-50"
      >
        <span
          aria-hidden
          className={cn(
            "relative h-5 w-9 rounded-full border border-border transition-colors",
            optIn ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-3.5 rounded-full bg-background shadow transition-all",
              optIn ? "left-[1.15rem]" : "left-0.5",
            )}
          />
        </span>
      </button>
      <span>
        {mut.isPending ? (
          <Loader2 className="inline size-3 animate-spin" />
        ) : optIn ? (
          "Acepta controles periódicos, reseñas y avisos de saldo por WhatsApp"
        ) : (
          "Sin consentimiento para mensajes proactivos"
        )}
      </span>
    </div>
  );
}
