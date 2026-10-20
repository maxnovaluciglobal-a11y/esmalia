import { AlertTriangle, CloudUpload, GitMerge } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useColaOffline } from "@/hooks/use-offline-mutation";
import { descartarConflicto, descartarFallido, type ItemCola } from "@/lib/offline/offline-queue";
import { resolverConflicto } from "@/lib/offline/offline-sync";
import { CONDITION_LABELS, type ToothCondition } from "@/lib/clinical/odontogram";

const hora = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });

/** Texto de "lo que hay vigente ahora en el servidor" según el tipo de conflicto. */
function loQueHayVigente(item: ItemCola): string {
  const detalle = item.detalleConflicto ?? {};
  if (item.kind === "guardar-nota") {
    const d = detalle as { currentTitle?: string };
    return d.currentTitle
      ? `Ahora vigente: "${d.currentTitle}"`
      : "Alguien más la editó mientras tanto.";
  }
  if (item.kind === "marcar-odontograma") {
    const d = detalle as { current?: { condition?: ToothCondition } | null };
    return d.current
      ? `Ahora vigente: ${CONDITION_LABELS[d.current.condition!] ?? d.current.condition}`
      : "Alguien dejó esa superficie sin marcar mientras tanto.";
  }
  return "Alguien más cambió esto mientras tanto.";
}

/**
 * Trabajo capturado que todavía no llegó al servidor.
 *
 * Son dos avisos distintos a propósito:
 *
 * - **Pendientes**: informativo. Se sincronizan solos, el equipo no tiene que
 *   hacer nada; sirve para que nadie se vaya de la clínica creyendo que todo
 *   está guardado cuando falta subir cobros.
 * - **Fallidos**: el servidor los rechazó por algo que reintentar no arregla.
 *   Requieren que una persona los mire. Un cobro que se pierde en silencio es
 *   peor que uno que nunca se registró, así que esto NO se auto-descarta.
 */
export function PendingSyncBanner({
  userId,
  soloAccionables = false,
}: {
  userId: string | undefined;
  /** Shell A+ (`shell-v2`): los pendientes ya los cuenta la pastilla de
   *  conexión, así que acá quedan solo fallidos y conflictos. */
  soloAccionables?: boolean;
}) {
  const queryClient = useQueryClient();
  const cola = useColaOffline(userId);
  const { fallidos, conflictos } = cola;
  const pendientes = soloAccionables ? [] : cola.pendientes;

  if (pendientes.length === 0 && fallidos.length === 0 && conflictos.length === 0) return null;

  return (
    <>
      {conflictos.length > 0 && (
        <div className="border-b border-warning/30 bg-warning-soft px-5 py-2 text-sm sm:px-8">
          <div className="flex items-center gap-2 font-medium text-warning">
            <GitMerge className="size-4 shrink-0" aria-hidden />
            <span>
              {conflictos.length === 1
                ? "1 cambio necesita que decidas cuál versión vale."
                : `${conflictos.length} cambios necesitan que decidas cuál versión vale.`}
            </span>
          </div>
          <ul className="mt-1.5 space-y-1.5 pl-6">
            {conflictos.map((item) => (
              <li key={item.localId} className="text-xs">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">Tú: {item.resumen}</span>
                  <span className="text-muted-foreground">
                    ({hora.format(new Date(item.capturedAt))})
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-muted-foreground">{loQueHayVigente(item)}</span>
                  <button
                    type="button"
                    onClick={() => void resolverConflicto(queryClient, item, "usar-mio")}
                    className="underline underline-offset-2 hover:no-underline"
                  >
                    Usar la mía
                  </button>
                  <button
                    type="button"
                    onClick={() => void descartarConflicto(item.localId)}
                    className="underline underline-offset-2 hover:no-underline"
                  >
                    Descartar la mía
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pendientes.length > 0 && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-border bg-muted/40 px-5 py-2 text-sm sm:px-8"
        >
          <CloudUpload className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            {pendientes.length === 1
              ? "1 operación guardada en este equipo"
              : `${pendientes.length} operaciones guardadas en este equipo`}
            , esperando internet para sincronizar.
          </span>
        </div>
      )}

      {fallidos.length > 0 && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-5 py-2 text-sm sm:px-8">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span>
              {fallidos.length === 1
                ? "1 operación no se pudo guardar y necesita tu revisión."
                : `${fallidos.length} operaciones no se pudieron guardar y necesitan tu revisión.`}
            </span>
          </div>
          <ul className="mt-1.5 space-y-1 pl-6">
            {fallidos.map((item) => (
              <li key={item.localId} className="flex flex-wrap items-center gap-x-2 text-xs">
                <span className="font-medium">{item.resumen}</span>
                <span className="text-muted-foreground">
                  ({hora.format(new Date(item.capturedAt))}) — {item.error}
                </span>
                <button
                  type="button"
                  onClick={() => void descartarFallido(item.localId)}
                  className="underline underline-offset-2 hover:no-underline"
                >
                  Descartar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
