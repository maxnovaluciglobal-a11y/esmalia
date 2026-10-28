// Las dos tareas pesadas de los visores: preparar un modelo 3D y armar el
// volumen de un CBCT. Son funciones puras sobre bytes: corren dentro del
// worker (`visores.worker.ts`) para no congelar la interfaz, y en el hilo
// principal solo si el navegador no tiene workers.

import { ErrorDeVisor } from "./limites";
import {
  parsearMalla,
  prepararParaRender,
  type FormatoMalla,
  type Malla,
  type TopesDeMalla,
} from "./malla";
import { abrirArchivosDicom, construirVolumen, type Volumen } from "./volumen";

export type PedidoDeTarea =
  | { tipo: "malla"; formato: FormatoMalla; bytes: Uint8Array; topes: TopesDeMalla }
  | { tipo: "dicom"; archivos: Uint8Array[]; maxVoxeles: number; maxBytes: number };

export type ResultadoDeTarea =
  { tipo: "malla"; malla: Malla } | { tipo: "dicom"; volumen: Volumen };

export function ejecutarTarea(
  pedido: PedidoDeTarea,
  alProgreso: (fraccion: number) => void = () => {},
): ResultadoDeTarea {
  if (pedido.tipo === "malla") {
    alProgreso(0.05);
    const cruda = parsearMalla(pedido.bytes, pedido.formato, pedido.topes);
    alProgreso(0.6);
    const malla = prepararParaRender(cruda);
    alProgreso(1);
    return { tipo: "malla", malla };
  }
  const cortes = abrirArchivosDicom(pedido.archivos, {
    maxBytes: pedido.maxBytes,
    alProgreso: (f) => alProgreso(f * 0.4),
  });
  const volumen = construirVolumen(cortes, {
    maxVoxeles: pedido.maxVoxeles,
    alProgreso: (f) => alProgreso(0.4 + f * 0.6),
  });
  alProgreso(1);
  return { tipo: "dicom", volumen };
}

/** Los búferes de un resultado, para pasarlos al hilo principal sin copiarlos. */
export function bufferesDe(r: ResultadoDeTarea): ArrayBuffer[] {
  const lista: (ArrayBufferView | null | undefined)[] =
    r.tipo === "malla"
      ? [r.malla.posiciones, r.malla.indices, r.malla.colores, r.malla.normales]
      : [r.volumen.datos];
  const vistos = new Set<ArrayBuffer>();
  for (const v of lista) if (v && v.buffer instanceof ArrayBuffer) vistos.add(v.buffer);
  return [...vistos];
}

export type MensajeDelWorker =
  | { tipo: "progreso"; fraccion: number }
  | { tipo: "listo"; resultado: ResultadoDeTarea }
  | { tipo: "error"; mensaje: string; clase: "visor" | "memoria" | "otro" };

export function errorAMensaje(e: unknown): Extract<MensajeDelWorker, { tipo: "error" }> {
  if (e instanceof ErrorDeVisor) return { tipo: "error", mensaje: e.message, clase: "visor" };
  if (e instanceof RangeError) return { tipo: "error", mensaje: e.message, clase: "memoria" };
  return { tipo: "error", mensaje: e instanceof Error ? e.message : String(e), clase: "otro" };
}

export function mensajeAError(m: Extract<MensajeDelWorker, { tipo: "error" }>): Error {
  if (m.clase === "visor") return new ErrorDeVisor(m.mensaje);
  if (m.clase === "memoria") return new RangeError(m.mensaje);
  return new Error(m.mensaje);
}
