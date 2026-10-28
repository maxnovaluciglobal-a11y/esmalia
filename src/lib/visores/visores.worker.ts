/// <reference lib="webworker" />
// Worker de los visores: parsea el modelo 3D o arma el volumen del CBCT lejos
// del hilo de la interfaz. Recibe los bytes por transferencia (sin copiarlos)
// y devuelve los arreglos tipados también por transferencia.
import {
  bufferesDe,
  ejecutarTarea,
  errorAMensaje,
  type MensajeDelWorker,
  type PedidoDeTarea,
} from "./tareas";

const alMundo = (m: MensajeDelWorker, transferir: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transferir);

self.onmessage = (e: MessageEvent<PedidoDeTarea>) => {
  try {
    let ultimo = 0;
    const resultado = ejecutarTarea(e.data, (fraccion) => {
      const ahora = Date.now();
      if (fraccion < 1 && ahora - ultimo < 80) return;
      ultimo = ahora;
      alMundo({ tipo: "progreso", fraccion });
    });
    alMundo({ tipo: "listo", resultado }, bufferesDe(resultado));
  } catch (error) {
    alMundo(errorAMensaje(error));
  }
};
