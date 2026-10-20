import type { FocusEvent } from "react";
import { CloudOff, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { WhatsAppButton } from "@/components/whatsapp-button";
import { Button } from "@/components/ui/button";

/** Mínimo 8 s (WCAG 2.2.1); mientras el aviso tiene foco o el mouse encima no se va. */
export const DURACION_AVISO_MS = 10_000;

export interface DatosAvisoWhatsApp {
  clinicId: string;
  patientId: string;
  appointmentId: string;
  /** Variables de `appointment_rescheduled` (el servidor completa `paciente`). */
  variables: { clinica: string; fecha_larga: string; hora: string; profesional: string };
}

interface Props {
  id: string | number;
  frase: string;
  /** Sin conexión: el cambio quedó en la cola y no se ofrece avisar todavía. */
  enCola: boolean;
  whatsapp: DatosAvisoWhatsApp | null;
  onDeshacer: () => void;
}

// Avisos ya cerrados: el blur que sigue al clic en un botón no tiene que
// volver a mostrarlos.
const cerrados = new Set<string | number>();

function cerrar(id: string | number) {
  cerrados.add(id);
  toast.dismiss(id);
}

// eslint-disable-next-line react-refresh/only-export-components -- rendered only through toast.custom; the module's API is the imperative mostrarAvisoReprogramacion
function AvisoReprogramacion({ id, frase, enCola, whatsapp, onDeshacer }: Props) {
  // Sonner pausa el tiempo con el mouse encima; con el foco adentro lo
  // pausamos acá (teclado y lector de pantalla). Al salir, vuelve a correr.
  const congelar = () => {
    if (!cerrados.has(id)) mostrar({ id, frase, enCola, whatsapp, onDeshacer }, Infinity);
  };
  const soltar = (e: FocusEvent<HTMLDivElement>) => {
    if (cerrados.has(id) || e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    mostrar({ id, frase, enCola, whatsapp, onDeshacer }, DURACION_AVISO_MS);
  };
  return (
    <div
      role="group"
      aria-label="Cita movida"
      onFocus={congelar}
      onBlur={soltar}
      className="w-[var(--width,356px)] max-w-[calc(100vw-2rem)] rounded-lg border border-hairline bg-popover p-4 text-sm text-popover-foreground shadow-lg"
    >
      <p className="font-medium">{frase}</p>
      {enCola ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CloudOff className="size-3.5" aria-hidden />
          Sin conexión: el cambio queda en cola y se sincroniza solo.
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">¿Avisar al paciente?</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!enCola && whatsapp && (
          <WhatsAppButton
            variant="full"
            label="Avisar por WhatsApp"
            className="h-8 border-foreground bg-foreground text-background hover:text-background"
            clinicId={whatsapp.clinicId}
            patientId={whatsapp.patientId}
            appointmentId={whatsapp.appointmentId}
            templateKind="appointment_rescheduled"
            variables={whatsapp.variables}
            onSent={() => cerrar(id)}
          />
        )}
        {!enCola && (
          <Button type="button" variant="outline" size="sm" onClick={() => cerrar(id)}>
            No avisar
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            cerrar(id);
            onDeshacer();
          }}
        >
          <Undo2 aria-hidden /> Deshacer
        </Button>
      </div>
    </div>
  );
}

function mostrar(props: Omit<Props, "id"> & { id?: string | number }, duration: number) {
  // El id lo ponemos nosotros: con `toast.custom` sin id, el que recibe el
  // render y el que guarda sonner no coinciden, y "cerrar" no cerraba nada.
  const id = props.id ?? `aviso-reprogramacion-${crypto.randomUUID()}`;
  return toast.custom(() => <AvisoReprogramacion {...props} id={id} />, {
    id,
    duration,
    onDismiss: (t) => cerrados.add(t.id),
    onAutoClose: (t) => cerrados.add(t.id),
  });
}

/**
 * Aviso después de mover una cita: "Avisar por WhatsApp", "No avisar" y
 * "Deshacer". Nunca se avisa sin un clic (regla de envío humano): el botón
 * usa la plantilla `appointment_rescheduled` y el servidor respeta la baja
 * del paciente (`wa_opt_out_at`) antes de registrar o abrir nada.
 */
export function mostrarAvisoReprogramacion(props: Omit<Props, "id">) {
  return mostrar(props, DURACION_AVISO_MS);
}
