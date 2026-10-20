import type { QueryClient } from "@tanstack/react-query";

import {
  createAppointment,
  moveAppointment,
  setAppointmentStatus,
} from "@/lib/clinic-operations/appointments.functions";
import { registerPayment } from "@/lib/finance/finance.functions";
import { saveClinicalNote, restoreNoteVersion } from "@/lib/clinical/clinical-notes.functions";
import { setOdontogramMark } from "@/lib/clinical/odontogram.functions";
import { setMedicalHistory } from "@/lib/clinical/medical-history.functions";
import {
  contarIntento,
  leerCola,
  marcarConflicto,
  marcarFallido,
  pendientes,
  quitarDeCola,
  type ItemCola,
  type OperacionKind,
} from "@/lib/offline/offline-queue";

/**
 * Cómo se reproduce cada operación al recuperar conexión.
 *
 * El payload se pasa TAL CUAL se capturó. Nada de recalcular montos, fechas
 * ni nada acá: si algo hay que derivar, se derivó en la captura y viajó
 * dentro del payload.
 */
const despachadores: Record<OperacionKind, (payload: never) => Promise<unknown>> = {
  "crear-cita": (payload) => createAppointment({ data: payload }),
  "registrar-pago": (payload) => registerPayment({ data: payload }),
  "cambiar-estado-cita": (payload) => setAppointmentStatus({ data: payload }),
  "guardar-nota": (payload) => saveClinicalNote({ data: payload }),
  "marcar-odontograma": (payload) => setOdontogramMark({ data: payload }),
  "actualizar-anamnesis": (payload) => setMedicalHistory({ data: payload }),
  "reprogramar-cita": (payload) => moveAppointment({ data: payload }),
};

/**
 * `guardar-nota` y `marcar-odontograma` pueden resolver con `{conflict:true}`
 * sin lanzar error: el servidor guardó la captura pero no la aplicó porque
 * alguien más cambió lo mismo mientras el equipo estaba offline. Distinguirlo
 * de un éxito común importa para no marcarlo "sincronizado" cuando en
 * realidad necesita que una persona decida.
 */
function esConflicto(kind: OperacionKind, resultado: unknown): boolean {
  return (
    (kind === "guardar-nota" || kind === "marcar-odontograma") &&
    Boolean(resultado) &&
    typeof resultado === "object" &&
    (resultado as { conflict?: boolean }).conflict === true
  );
}

/**
 * Un fallo de red se reintenta; uno de validación o permisos, no.
 *
 * Distinguirlos importa: reintentar para siempre un pago que el servidor
 * rechaza por regla de negocio deja al equipo esperando una sincronización
 * que nunca va a pasar, sin enterarse de que hay algo que revisar.
 */
function esFalloDeRed(error: unknown) {
  if (error instanceof TypeError) return true; // fetch caído
  const mensaje = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    mensaje.includes("failed to fetch") ||
    mensaje.includes("networkerror") ||
    mensaje.includes("load failed") ||
    mensaje.includes("network request failed")
  );
}

/** Claves a refrescar después de sincronizar, por tipo de operación. */
const invalidaciones: Record<OperacionKind, string[]> = {
  "crear-cita": ["appointments"],
  "registrar-pago": ["payments", "patient", "patients", "finance-summary"],
  "cambiar-estado-cita": ["appointments"],
  "guardar-nota": ["clinical-notes"],
  "marcar-odontograma": ["odontogram-marks", "odontogram-history"],
  "actualizar-anamnesis": ["medical-history"],
  "reprogramar-cita": ["appointments"],
};

let sincronizando = false;

/**
 * Despacha la cola en orden de captura (FIFO).
 *
 * Si algo falla por red, PARA — no sigue con el resto. Mantener el orden
 * importa: un pago y el cambio de estado de la misma cita tienen que llegar
 * como se hicieron. Además, si se cayó la red, el siguiente también va a
 * fallar; seguir intentando solo suma ruido.
 */
export async function sincronizarCola(queryClient: QueryClient, userId: string) {
  if (sincronizando)
    return { sincronizados: 0, conflictos: 0, corte: true, avisos: [] as string[] };
  sincronizando = true;

  let sincronizados = 0;
  let conflictosNuevos = 0;
  let corte = false;
  const kindsTocados = new Set<OperacionKind>();
  // Avisos SOLAPADO de `crear-cita` y `reprogramar-cita` (ver
  // appointments.functions.ts): la cita se sincronizó igual, esto solo junta
  // el mensaje para mostrarlo al final — durante la sincronización en segundo
  // plano no hay ningún diálogo abierto donde avisar en el momento.
  const avisos: string[] = [];

  try {
    const cola = pendientes(await leerCola()).filter((i) => i.userId === userId);

    for (const item of cola) {
      try {
        await contarIntento(item.localId);
        const resultado = await (despachadores[item.kind] as (p: unknown) => Promise<unknown>)(
          item.payload,
        );
        kindsTocados.add(item.kind);
        if (item.kind === "crear-cita" || item.kind === "reprogramar-cita") {
          const solapamiento = (
            resultado as { solapamiento?: { treatmentLabel: string } } | undefined
          )?.solapamiento;
          if (solapamiento) {
            avisos.push(
              `${item.resumen}: se solapa con "${solapamiento.treatmentLabel}" del mismo profesional.`,
            );
          }
        }
        if (esConflicto(item.kind, resultado)) {
          await marcarConflicto(item.localId, resultado as Record<string, unknown>);
          conflictosNuevos += 1;
        } else {
          await quitarDeCola(item.localId);
          sincronizados += 1;
        }
      } catch (error) {
        if (esFalloDeRed(error)) {
          corte = true;
          break;
        }
        // El servidor lo rechazó por una razón real. Queda visible para que
        // alguien lo mire, en vez de desaparecer o reintentarse eternamente.
        await marcarFallido(
          item.localId,
          error instanceof Error ? error.message : "Error desconocido",
        );
      }
    }
  } finally {
    sincronizando = false;
  }

  for (const kind of kindsTocados) {
    for (const clave of invalidaciones[kind]) {
      queryClient.invalidateQueries({ queryKey: [clave] });
    }
  }

  return { sincronizados, conflictos: conflictosNuevos, corte, avisos };
}

/**
 * Resuelve un ítem en conflicto. "usar-mio" aplica la captura offline como
 * vigente (para notas, reusa `restoreNoteVersion` sobre la versión que ya se
 * guardó en conflicto; para odontograma, reenvía la marca con `force`).
 * "descartar" se queda con lo que ya está vigente en el servidor — no hace
 * ninguna llamada, la captura offline simplemente se abandona.
 */
export async function resolverConflicto(
  queryClient: QueryClient,
  item: ItemCola,
  decision: "usar-mio" | "descartar",
) {
  if (decision === "usar-mio") {
    if (item.kind === "guardar-nota") {
      const versionId = (item.detalleConflicto as { versionId?: string } | undefined)?.versionId;
      if (versionId) await restoreNoteVersion({ data: { versionId } });
      queryClient.invalidateQueries({ queryKey: ["clinical-notes"] });
    } else if (item.kind === "marcar-odontograma") {
      await setOdontogramMark({ data: { ...item.payload, force: true } as never });
      queryClient.invalidateQueries({ queryKey: ["odontogram-marks"] });
      queryClient.invalidateQueries({ queryKey: ["odontogram-history"] });
    }
  }
  await quitarDeCola(item.localId);
}

/** Texto corto para la lista de pendientes. */
export function describirItem(item: ItemCola) {
  switch (item.kind) {
    case "crear-cita":
      return "Cita nueva";
    case "registrar-pago":
      return "Cobro registrado";
    case "cambiar-estado-cita":
      return "Cambio de estado de una cita";
    case "guardar-nota":
      return "Nota clínica";
    case "marcar-odontograma":
      return "Marca de odontograma";
    case "actualizar-anamnesis":
      return "Antecedentes médicos";
    case "reprogramar-cita":
      return "Cita reprogramada";
  }
}
