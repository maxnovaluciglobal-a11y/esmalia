// Ejecuta las tareas pesadas de los visores en un Web Worker. Un worker por
// tarea: se crea al abrir el examen y se termina al cerrarlo o cancelarlo,
// así la memoria del parseo se devuelve al sistema de inmediato.

import { ErrorDeVisor } from "./limites";
import {
  ejecutarTarea,
  mensajeAError,
  type MensajeDelWorker,
  type PedidoDeTarea,
  type ResultadoDeTarea,
} from "./tareas";

const crear = () => new Worker(new URL("./visores.worker.ts", import.meta.url), { type: "module" });

let calentado: Worker | null = null;

/**
 * Crea el worker antes de que termine la descarga: así su código ya está
 * cargado cuando llegan los bytes y un corte de internet justo ahí no
 * impide abrir el estudio. Si nadie lo usa en 5 minutos se descarta.
 */
export function precalentarTrabajador(): void {
  if (typeof Worker === "undefined" || calentado) return;
  try {
    const w = crear();
    calentado = w;
    setTimeout(() => {
      if (calentado === w) {
        w.terminate();
        calentado = null;
      }
    }, 5 * 60_000);
  } catch {
    calentado = null;
  }
}

/** Copia el arreglo solo si es una vista parcial (un búfer se transfiere entero). */
function exacto(a: Uint8Array): Uint8Array {
  return a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a : a.slice();
}

export function ejecutarEnTrabajador(
  pedido: PedidoDeTarea,
  senal: AbortSignal,
  alProgreso: (fraccion: number) => void,
): Promise<ResultadoDeTarea> {
  if (typeof Worker === "undefined") {
    // Sin workers (entornos viejos): en el hilo principal, cediendo un cuadro antes.
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(ejecutarTarea(pedido, alProgreso));
        } catch (e) {
          reject(e);
        }
      }, 30),
    );
  }
  return new Promise<ResultadoDeTarea>((resolve, reject) => {
    const worker = calentado ?? crear();
    calentado = null;
    const terminar = () => {
      senal.removeEventListener("abort", alAbortar);
      worker.terminate();
    };
    const alAbortar = () => {
      terminar();
      reject(new DOMException("Cancelado", "AbortError"));
    };
    senal.addEventListener("abort", alAbortar, { once: true });
    worker.onmessage = (e: MessageEvent<MensajeDelWorker>) => {
      const m = e.data;
      if (m.tipo === "progreso") return alProgreso(m.fraccion);
      terminar();
      if (m.tipo === "listo") resolve(m.resultado);
      else reject(mensajeAError(m));
    };
    worker.onerror = (e) => {
      terminar();
      reject(
        new ErrorDeVisor(
          "No se pudo preparar el archivo en este navegador. Revisa la conexión y toca Reintentar.",
        ),
      );
      console.error(e.message);
    };
    const pedidoLimpio: PedidoDeTarea =
      pedido.tipo === "malla"
        ? { ...pedido, bytes: exacto(pedido.bytes) }
        : { ...pedido, archivos: pedido.archivos.map(exacto) };
    const transferir =
      pedidoLimpio.tipo === "malla"
        ? [pedidoLimpio.bytes.buffer]
        : pedidoLimpio.archivos.map((a) => a.buffer);
    worker.postMessage(pedidoLimpio, transferir as Transferable[]);
  });
}
