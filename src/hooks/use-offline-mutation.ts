import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useConnectivity } from "@/hooks/use-connectivity";
import {
  conflictos,
  encolar,
  leerCola,
  pendientes,
  registrarConflicto,
  suscribirCola,
  fallidos,
  type ItemCola,
  type OperacionKind,
} from "@/lib/offline/offline-queue";
import { sincronizarCola } from "@/lib/offline/offline-sync";

type Opciones<P> = {
  kind: OperacionKind;
  userId: string;
  /** Server function del camino online. */
  ejecutar: (payload: P) => Promise<unknown>;
  /** Claves de React Query a refrescar cuando sí hubo red. */
  invalidar?: unknown[][];
  resumen: (payload: P) => string;
  onDone?: () => void;
  /**
   * Identidad de la entidad que edita este payload (ej. noteId), para
   * coalescer varias ediciones offline seguidas — ver `identidad` en
   * `ItemCola`. Kinds que no editan una entidad puntual la omiten.
   */
  identidad?: (payload: P) => string | undefined;
  /**
   * Server functions con resolución de conflictos (notas, odontograma)
   * devuelven `{conflict:true}` sin lanzar error en vez de aplicar la
   * escritura. Sin esto, cualquier resultado online se trata como éxito.
   */
  esConflicto?: (resultado: unknown) => boolean;
  /** Éxito online real (no conflicto): acá el caller lee noteId/version/etc del resultado. */
  onExito?: (resultado: unknown) => void;
};

/**
 * Envuelve una escritura para que funcione con y sin conexión.
 *
 * Mantiene la forma que ya usan todos los diálogos del repo (mutar → refrescar
 * → toast → cerrar), así que conectarlo es cambiar la llamada, no reescribir
 * el componente.
 *
 * Sin red no falla: guarda la operación en la cola y le dice al usuario que
 * quedó pendiente. Es la diferencia entre "no se pudo cobrar" y "cobrado, se
 * sincroniza cuando vuelva internet".
 */
export function useOfflineMutation<P extends Record<string, unknown>>({
  kind,
  userId,
  ejecutar,
  invalidar = [],
  resumen,
  onDone,
  identidad,
  esConflicto,
  onExito,
}: Opciones<P>) {
  const queryClient = useQueryClient();
  const { online } = useConnectivity();
  const [enCurso, setEnCurso] = useState(false);

  const mutar = useCallback(
    async (payload: P) => {
      setEnCurso(true);
      try {
        if (!online) {
          await encolarOperacion(payload);
          return;
        }
        try {
          const resultado = await ejecutar(payload);
          for (const clave of invalidar) queryClient.invalidateQueries({ queryKey: clave });
          if (esConflicto?.(resultado)) {
            // Rarísimo estando online (dos pestañas, otro dispositivo), pero
            // el resultado es el mismo que un conflicto detectado al
            // sincronizar: va a la misma bandeja, no se pierde.
            await registrarConflicto({
              localId: crypto.randomUUID(),
              userId,
              kind,
              payload,
              capturedAt: new Date().toISOString(),
              resumen: resumen(payload),
              detalleConflicto: resultado as Record<string, unknown>,
              identidad: identidad?.(payload),
            });
            toast.error(
              "Alguien más cambió esto mientras tanto. Quedó en Conflictos para decidir.",
            );
          } else {
            onExito?.(resultado);
          }
          onDone?.();
        } catch (error) {
          // Creíamos tener conexión pero el envío falló. Si es de red, va a
          // la cola igual — el usuario no tiene por qué perder lo que cargó
          // solo porque el corte empezó justo ahora.
          if (error instanceof TypeError || /failed to fetch/i.test(String(error))) {
            await encolarOperacion(payload);
            return;
          }
          toast.error(error instanceof Error ? error.message : "No se pudo guardar.");
        }
      } finally {
        setEnCurso(false);
      }

      async function encolarOperacion(p: P) {
        await encolar({
          localId: crypto.randomUUID(),
          userId,
          kind,
          // Verbatim: exactamente lo que recibiría la server function online.
          payload: p,
          capturedAt: new Date().toISOString(),
          resumen: resumen(p),
          identidad: identidad?.(p),
        });
        toast.success("Guardado sin conexión. Se sincroniza solo cuando vuelva internet.");
        onDone?.();
      }
    },
    [
      online,
      ejecutar,
      invalidar,
      queryClient,
      onDone,
      kind,
      userId,
      resumen,
      identidad,
      esConflicto,
      onExito,
    ],
  );

  return { mutar, enCurso };
}

const snapshotVacio: ItemCola[] = [];
let cache: ItemCola[] = snapshotVacio;

/**
 * Suscripción estable, fuera del componente. Con una función nueva en cada
 * render, React se des-suscribía y volvía a suscribir en cada render;
 * `suscribirCola` lee la cola al suscribirse y entrega un arreglo nuevo, eso
 * provocaba otro render, y así sin fin: la pestaña quedaba al 100 % de CPU
 * leyendo IndexedDB (visto en la verificación local de la Ola 2).
 */
function suscribirseALaCola(cb: () => void) {
  return suscribirCola((nuevos) => {
    cache = nuevos;
    cb();
  });
}

/** Estado de la cola, compartido por la UI de pendientes y el sincronizador. */
export function useColaOffline(userId: string | undefined) {
  const items = useSyncExternalStore(
    suscribirseALaCola,
    () => cache,
    () => snapshotVacio,
  );

  const mios = userId ? items.filter((i) => i.userId === userId) : snapshotVacio;
  return { pendientes: pendientes(mios), fallidos: fallidos(mios), conflictos: conflictos(mios) };
}

/**
 * Dispara la sincronización cuando vuelve la conexión.
 *
 * Se monta una sola vez (en el AppShell): si cada pantalla lo hiciera, varias
 * sincronizaciones competirían por la misma cola.
 */
export function useSincronizacionAutomatica(userId: string | undefined) {
  const { online } = useConnectivity();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!online || !userId) return;
    let cancelado = false;

    (async () => {
      const hay = pendientes(await leerCola()).some((i) => i.userId === userId);
      if (!hay || cancelado) return;

      const {
        sincronizados,
        conflictos: nuevosConflictos,
        avisos,
      } = await sincronizarCola(queryClient, userId);
      if (cancelado) return;
      if (sincronizados > 0) {
        toast.success(
          sincronizados === 1
            ? "Se sincronizó 1 operación pendiente."
            : `Se sincronizaron ${sincronizados} operaciones pendientes.`,
        );
      }
      if (nuevosConflictos > 0) {
        toast.error(
          nuevosConflictos === 1
            ? "1 cambio necesita que decidas cuál versión vale — revisa Conflictos."
            : `${nuevosConflictos} cambios necesitan que decidas cuál versión vale — revisa Conflictos.`,
        );
      }
      // Citas creadas offline que se solapan con otra del mismo profesional
      // (ver appointments.functions.ts) — se crearon igual, esto solo avisa.
      for (const aviso of avisos) toast.warning(aviso);
    })();

    return () => {
      cancelado = true;
    };
  }, [online, userId, queryClient]);
}
