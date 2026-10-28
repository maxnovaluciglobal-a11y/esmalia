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

/** Espera antes de reintentar; si no hay internet, hasta que vuelva. */
function esperarAntesDeReintentar(intento: number, senal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortar = () => reject(new DOMException("Cancelado", "AbortError"));
    if (senal.aborted) return abortar();
    const terminar = () => {
      clearTimeout(t);
      if (typeof window !== "undefined") window.removeEventListener("online", terminar);
      senal.removeEventListener("abort", alAbortar);
      resolve();
    };
    const alAbortar = () => {
      clearTimeout(t);
      if (typeof window !== "undefined") window.removeEventListener("online", terminar);
      abortar();
    };
    const sinConexion = typeof navigator !== "undefined" && navigator.onLine === false;
    const t = setTimeout(
      terminar,
      sinConexion ? 120_000 : Math.min(8000, 1000 * 2 ** (intento - 1)),
    );
    if (sinConexion && typeof window !== "undefined")
      window.addEventListener("online", terminar, { once: true });
    senal.addEventListener("abort", alAbortar, { once: true });
  });
}

/** Cuántas veces se retoma una descarga cortada antes de rendirse. */
const REINTENTOS_DE_DESCARGA = 4;

export async function descargar(
  url: string,
  maxBytes: number,
  alProgreso: AlProgreso,
  senal: AbortSignal,
): Promise<Uint8Array> {
  const errorDeRed = () =>
    new ErrorDeVisor("No se pudo descargar el archivo. Revisa la conexión e inténtalo de nuevo.");
  let respuesta: Response | null = null;
  for (let intento = 1; respuesta === null; intento++) {
    try {
      respuesta = await fetch(url, { signal: senal, credentials: "omit" });
    } catch (e) {
      if (senal.aborted) throw e;
      if (intento > 2) throw errorDeRed();
      await esperarAntesDeReintentar(intento, senal);
    }
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
      `El archivo pesa más de ${megas(maxBytes)}, el máximo que este equipo abre sin trabarse. Ábrelo en un computador o descárgalo y ábrelo en el software del equipo.`,
    );
  if (declarado && declarado > maxBytes) throw muyGrande();
  if (!respuesta.body) {
    const b = new Uint8Array(await respuesta.arrayBuffer());
    if (b.byteLength > maxBytes) throw muyGrande();
    alProgreso(b.byteLength, b.byteLength);
    return b;
  }
  let lector = respuesta.body.getReader();
  // Con el tamaño declarado se llena un solo búfer (sin juntar trozos al final,
  // que duplicaría la memoria justo con el archivo más grande) y, si se corta
  // la conexión, se retoma desde el último byte con `Range`.
  let destino: Uint8Array | null = declarado ? new Uint8Array(declarado) : null;
  const partes: Uint8Array[] = [];
  let cargados = 0;
  let fallas = 0;
  /** Retoma desde `cargados`; lanza si ya no hay más intentos o se canceló. */
  const retomar = async (causa: unknown) => {
    if (senal.aborted) throw causa;
    if (!destino || fallas >= REINTENTOS_DE_DESCARGA) throw errorDeRed();
    fallas += 1;
    await esperarAntesDeReintentar(fallas, senal);
    try {
      const r = await fetch(url, {
        signal: senal,
        credentials: "omit",
        headers: cargados > 0 ? { Range: `bytes=${cargados}-` } : undefined,
      });
      if (r.body && r.status === 206) lector = r.body.getReader();
      else if (r.body && r.ok) {
        // El servidor ignoró el rango: se empieza de cero.
        cargados = 0;
        lector = r.body.getReader();
      }
    } catch (e2) {
      if (senal.aborted) throw e2;
      // Sin respuesta todavía: el lector roto falla de nuevo y se cuenta otro intento.
    }
  };
  for (;;) {
    let paso: ReadableStreamReadResult<Uint8Array>;
    try {
      paso = await lector.read();
    } catch (e) {
      await retomar(e);
      continue;
    }
    const { done, value } = paso;
    if (done) {
      if (destino && cargados < destino.byteLength) {
        // El servidor cortó antes de tiempo sin avisar: se retoma igual.
        await retomar(new Error("Descarga incompleta"));
        continue;
      }
      break;
    }
    if (cargados + value.byteLength > maxBytes) {
      await lector.cancel();
      throw muyGrande();
    }
    if (destino && cargados + value.byteLength <= destino.byteLength) {
      destino.set(value, cargados);
    } else {
      // El servidor mandó más de lo declarado (o no declaró): se sigue por trozos.
      if (destino) {
        partes.push(destino.subarray(0, cargados));
        destino = null;
      }
      partes.push(value);
    }
    cargados += value.byteLength;
    alProgreso(cargados, declarado);
  }
  if (destino) return destino;
  const out = new Uint8Array(cargados);
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}
