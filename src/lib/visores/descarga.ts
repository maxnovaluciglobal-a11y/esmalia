// Descarga de un examen desde su URL firmada, con progreso y tope de tamaño.
// El tope se revisa antes de bajar (Content-Length) y mientras baja, para no
// llenar la memoria del navegador con un archivo que después no se puede abrir.

import { numero } from "@/lib/formato-fecha";

import { ErrorDeVisor } from "./limites";

export type AlProgreso = (cargados: number, total: number | null) => void;

/** Los visores reciben una función que entrega los bytes del examen. */
export type Cargador = (alProgreso: AlProgreso, senal: AbortSignal) => Promise<Uint8Array[]>;

export function megas(bytes: number): string {
  return `${numero(bytes / 1024 / 1024, { maximumFractionDigits: 1 })} MB`;
}

export async function descargar(
  url: string,
  maxBytes: number,
  alProgreso: AlProgreso,
  senal: AbortSignal,
): Promise<Uint8Array> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, { signal: senal, credentials: "omit" });
  } catch (e) {
    if (senal.aborted) throw e;
    throw new ErrorDeVisor(
      "No se pudo descargar el archivo. Revisa la conexión e inténtalo de nuevo.",
    );
  }
  if (!respuesta.ok) {
    throw new ErrorDeVisor(
      respuesta.status === 403 || respuesta.status === 400
        ? "El enlace del archivo venció. Cierra el visor y vuelve a abrir el examen."
        : `No se pudo descargar el archivo (error ${respuesta.status}).`,
    );
  }
  const declarado = Number(respuesta.headers.get("content-length")) || null;
  const muyGrande = () =>
    new ErrorDeVisor(
      `El archivo pesa más de ${megas(maxBytes)}, el máximo que el visor del navegador abre sin trabarse. Descárgalo y ábrelo en el software del equipo.`,
    );
  if (declarado && declarado > maxBytes) throw muyGrande();
  if (!respuesta.body) {
    const b = new Uint8Array(await respuesta.arrayBuffer());
    if (b.byteLength > maxBytes) throw muyGrande();
    alProgreso(b.byteLength, b.byteLength);
    return b;
  }
  const lector = respuesta.body.getReader();
  const partes: Uint8Array[] = [];
  let cargados = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    cargados += value.byteLength;
    if (cargados > maxBytes) {
      await lector.cancel();
      throw muyGrande();
    }
    partes.push(value);
    alProgreso(cargados, declarado);
  }
  const out = new Uint8Array(cargados);
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}
