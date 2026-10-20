import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  fraseDeMovimiento,
  payloadDeMovimiento,
  type Destino,
} from "@/components/agenda-movimiento";
import { horaDeMinutos } from "@/components/agenda-hueco";
import { mostrarAvisoReprogramacion } from "@/components/aviso-reprogramacion";
import { useConnectivity } from "@/hooks/use-connectivity";
import { moveAppointment } from "@/lib/clinic-operations/appointments.functions";
import { formatoFechaLarga, type Cita } from "@/lib/clinic-operations/clinic-data";
import { mensajeDeError } from "@/lib/mensaje-error";
import { encolar } from "@/lib/offline/offline-queue";

type ListadoCitas = { items: Cita[]; truncated?: boolean } | undefined;

function esFalloDeRed(error: unknown) {
  return (
    error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(error))
  );
}

/**
 * Reprogramar una cita desde la agenda (arrastre, Alt + flechas o "Mover a…").
 *
 * - Con conexión: la cita se pinta en el destino al instante (optimista),
 *   `moveAppointment` valida en el servidor y, si lo rechaza, vuelve a su
 *   lugar con el motivo.
 * - Sin conexión: va a la cola (`reprogramar-cita`, identidad = la cita). Dos
 *   movimientos seguidos de la misma cita se fusionan en uno, y deshacer
 *   hasta la posición original la saca de la cola (ver `agregarACola`).
 * - Siempre: aviso con "Avisar por WhatsApp" (nunca automático), "No avisar"
 *   y "Deshacer", y una frase para el `aria-live` de la página.
 */
export function useReprogramarCita({
  clinicId,
  userId,
  clinicName,
  nombreProfesional,
}: {
  clinicId: string | undefined;
  userId: string;
  clinicName: string | undefined;
  nombreProfesional: (id: string) => string;
}) {
  const queryClient = useQueryClient();
  const { online } = useConnectivity();
  const moverFn = useServerFn(moveAppointment);
  const [anuncio, setAnuncio] = useState("");

  const pintar = useCallback(
    (citaId: string, destino: Destino) => {
      queryClient.setQueryData<ListadoCitas>(["appointments", clinicId], (prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((c) =>
                c.id === citaId
                  ? {
                      ...c,
                      fecha: destino.fecha,
                      inicio: destino.inicio,
                      profesionalId: destino.profesionalId,
                    }
                  : c,
              ),
            }
          : prev,
      );
    },
    [queryClient, clinicId],
  );

  const mover = useCallback(
    async (cita: Cita, destino: Destino, opciones: { esDeshacer?: boolean } = {}) => {
      if (!clinicId) return;
      const anterior: Destino = {
        fecha: cita.fecha,
        inicio: cita.inicio,
        profesionalId: cita.profesionalId,
      };
      const payload = payloadDeMovimiento(clinicId, cita.id, destino);
      const original = payloadDeMovimiento(clinicId, cita.id, anterior);
      const profesional = nombreProfesional(destino.profesionalId);
      const frase = opciones.esDeshacer
        ? `La cita de ${cita.paciente} volvió a las ${horaDeMinutos(destino.inicio)}.`
        : fraseDeMovimiento({
            paciente: cita.paciente,
            destino,
            nombreProfesional: profesional,
            cambioProfesional: destino.profesionalId !== cita.profesionalId,
          });
      const movida: Cita = { ...cita, ...destino };
      const deshacer = () => void mover(movida, anterior, { esDeshacer: true });

      const encolarMovimiento = async () => {
        await encolar({
          localId: crypto.randomUUID(),
          userId,
          kind: "reprogramar-cita",
          payload,
          original,
          identidad: cita.id,
          capturedAt: new Date().toISOString(),
          resumen: `${cita.paciente}: ${frase}`,
        });
        setAnuncio(`${frase} Sin conexión: quedó en cola. Deshacer disponible.`);
        if (opciones.esDeshacer) toast.success(frase);
        else
          mostrarAvisoReprogramacion({ frase, enCola: true, whatsapp: null, onDeshacer: deshacer });
      };

      if (!online) {
        // Se pinta ya: guardar en IndexedDB puede tardar, y la cita no
        // puede "quedarse quieta" mientras tanto. Después la sostiene
        // `aplicarMovimientosPendientes` desde la cola.
        pintar(cita.id, destino);
        await encolarMovimiento();
        return;
      }

      pintar(cita.id, destino);
      try {
        const resultado = await moverFn({ data: payload });
        void queryClient.invalidateQueries({ queryKey: ["appointments", clinicId] });
        setAnuncio(opciones.esDeshacer ? frase : `${frase} Deshacer disponible.`);
        if (opciones.esDeshacer) {
          toast.success(frase);
        } else {
          mostrarAvisoReprogramacion({
            frase,
            enCola: false,
            onDeshacer: deshacer,
            whatsapp: clinicName
              ? {
                  clinicId,
                  patientId: cita.pacienteId,
                  appointmentId: cita.id,
                  variables: {
                    clinica: clinicName,
                    fecha_larga: formatoFechaLarga(destino.fecha),
                    hora: horaDeMinutos(destino.inicio),
                    profesional: profesional,
                  },
                }
              : null,
          });
        }
        if (resultado.solapamiento) {
          toast.warning(
            `Ojo: se solapa con "${resultado.solapamiento.treatmentLabel}" del mismo profesional.`,
          );
        }
      } catch (error) {
        if (esFalloDeRed(error)) {
          // El corte empezó justo ahora: no se pierde, va a la cola.
          await encolarMovimiento();
          return;
        }
        pintar(cita.id, anterior);
        void queryClient.invalidateQueries({ queryKey: ["appointments", clinicId] });
        const mensaje = mensajeDeError(error);
        setAnuncio(`No se movió la cita de ${cita.paciente}: ${mensaje}`);
        toast.error(mensaje);
      }
    },
    [clinicId, clinicName, moverFn, nombreProfesional, online, pintar, queryClient, userId],
  );

  return { mover, anuncio, avisar: setAnuncio };
}
