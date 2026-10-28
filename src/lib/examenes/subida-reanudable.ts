/**
 * Subida reanudable de archivos grandes (protocolo TUS de Supabase Storage).
 *
 * Un CBCT o un escaneo intraoral pesa 20-200 MB. Una subida normal es una sola
 * petición: si se corta la conexión a los 150 MB hay que empezar de cero y no
 * hay barra de progreso. Aquí el archivo se parte en trozos de 6 MB (el tamaño
 * que exige Supabase), cada trozo se reintenta solo, y si la conexión se cae
 * se pregunta al servidor hasta dónde llegó y se sigue desde ahí.
 *
 * Seguridad: usa la MISMA firma de subida que ya entrega el servidor
 * (`createSignedUploadUrl`, atada a una sola ruta y con vencimiento) en el
 * endpoint `/storage/v1/upload/resumable/sign`. No hay credenciales nuevas en
 * el navegador, ni service role, ni políticas de storage nuevas: solo se puede
 * escribir en la ruta que el servidor reservó para este examen.
 *
 * Puro: la red entra por `Transporte`, así se prueba con un servidor falso.
 */

/** Tamaño de trozo que exige Supabase Storage para TUS (último trozo, menor). */
export const TAMANO_TROZO = 6 * 1024 * 1024;
/** Hasta este tamaño basta una subida normal (una petición). */
export const MAX_SUBIDA_SIMPLE = TAMANO_TROZO;

export type CodigoErrorSubida =
  "cancelada" | "red" | "expirada" | "rechazada" | "demasiado_grande" | "no_disponible";

export class ErrorDeSubida extends Error {
  constructor(
    readonly codigo: CodigoErrorSubida,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorDeSubida";
  }
}

export interface RespuestaTus {
  status: number;
  encabezado(nombre: string): string | null;
}

export interface PeticionTus {
  metodo: "POST" | "HEAD" | "PATCH" | "DELETE";
  url: string;
  encabezados: Record<string, string>;
  cuerpo?: Blob;
  /** Bytes del cuerpo ya enviados (0..cuerpo.size). */
  alProgreso?: (enviados: number) => void;
  senal?: AbortSignal;
}

/** Hace una petición TUS. Rechaza con cualquier error de red; nunca por el status. */
export type Transporte = (p: PeticionTus) => Promise<RespuestaTus>;

export interface OpcionesTus {
  /** `${SUPABASE_URL}/storage/v1/upload/resumable/sign` */
  endpoint: string;
  /** Clave pública del proyecto (la pide la puerta de entrada de Supabase). */
  apikey: string;
  /** Firma de subida que entregó el servidor. */
  firma: string;
  bucket: string;
  objeto: string;
  contentType: string;
  archivo: Blob;
  /** URL de una subida anterior del mismo archivo, para retomarla. */
  urlPrevia?: string | null;
  /** Se llama con la URL de la subida apenas existe (para poder retomarla). */
  alCrear?: (url: string) => void;
  alProgreso?: (enviados: number, total: number) => void;
  /** Se avisa cada vez que un trozo falla y se va a reintentar. */
  alReintento?: (info: { intento: number; esperaMs: number; sinConexion: boolean }) => void;
  senal?: AbortSignal;
  transporte?: Transporte;
  /** Reintentos seguidos sin avanzar antes de rendirse. */
  maxReintentos?: number;
  /** Espera antes del reintento n (1, 2, 3…). */
  esperaMs?: (intento: number) => number;
  /** Resuelve cuando el navegador recupera la conexión (o de inmediato). */
  esperarConexion?: (senal?: AbortSignal) => Promise<void>;
  hayConexion?: () => boolean;
  dormir?: (ms: number, senal?: AbortSignal) => Promise<void>;
}

const b64 = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

/** 1 s, 2 s, 4 s… hasta 15 s. */
export const esperaPorDefecto = (intento: number): number =>
  Math.min(15_000, 1000 * 2 ** Math.max(0, intento - 1));

function dormirPorDefecto(ms: number, senal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (senal?.aborted) return reject(cancelada());
    const t = setTimeout(() => {
      senal?.removeEventListener("abort", alAbortar);
      resolve();
    }, ms);
    const alAbortar = () => {
      clearTimeout(t);
      reject(cancelada());
    };
    senal?.addEventListener("abort", alAbortar, { once: true });
  });
}

function esperarConexionPorDefecto(senal?: AbortSignal): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const alVolver = () => {
      window.removeEventListener("online", alVolver);
      senal?.removeEventListener("abort", alAbortar);
      resolve();
    };
    const alAbortar = () => {
      window.removeEventListener("online", alVolver);
      reject(cancelada());
    };
    window.addEventListener("online", alVolver, { once: true });
    senal?.addEventListener("abort", alAbortar, { once: true });
  });
}

const cancelada = () => new ErrorDeSubida("cancelada", "Subida cancelada.");

/** Transporte real: fetch para lo corto y XMLHttpRequest para los trozos (progreso). */
export const transporteDelNavegador: Transporte = (p) => {
  if (p.metodo !== "PATCH" || typeof XMLHttpRequest === "undefined") {
    return fetch(p.url, {
      method: p.metodo,
      headers: p.encabezados,
      body: p.cuerpo,
      signal: p.senal,
      credentials: "omit",
    }).then((r) => ({ status: r.status, encabezado: (n: string) => r.headers.get(n) }));
  }
  return new Promise<RespuestaTus>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PATCH", p.url);
    for (const [k, v] of Object.entries(p.encabezados)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => p.alProgreso?.(e.loaded);
    xhr.onload = () =>
      resolve({ status: xhr.status, encabezado: (n: string) => xhr.getResponseHeader(n) });
    xhr.onerror = () => reject(new TypeError("Fallo de red"));
    xhr.ontimeout = () => reject(new TypeError("Tiempo agotado"));
    xhr.onabort = () => reject(cancelada());
    const alAbortar = () => xhr.abort();
    if (p.senal?.aborted) return reject(cancelada());
    p.senal?.addEventListener("abort", alAbortar, { once: true });
    xhr.send(p.cuerpo);
  });
};

/** Fallo que no tiene sentido reintentar. */
function errorDeEstado(status: number, accion: string): ErrorDeSubida | null {
  if (status === 401 || status === 403)
    return new ErrorDeSubida(
      "expirada",
      "La autorización de la subida venció. Vuelve a intentarlo para empezar de nuevo.",
    );
  if (status === 413)
    return new ErrorDeSubida(
      "demasiado_grande",
      "El servidor rechazó el archivo por su tamaño. Comprímelo en un ZIP o sube solo la serie que usas.",
    );
  if (status === 404 || status === 405 || status === 501)
    return new ErrorDeSubida(
      "no_disponible",
      `La subida reanudable no está disponible (${accion}).`,
    );
  if (
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 423 &&
    status !== 429
  )
    return new ErrorDeSubida("rechazada", `No pudimos subir el archivo (error ${status}).`);
  return null;
}

/**
 * Sube `archivo` por TUS. Devuelve cuando el servidor confirma el último
 * trozo. Rechaza con `ErrorDeSubida`.
 */
export async function subirReanudable(o: OpcionesTus): Promise<void> {
  const total = o.archivo.size;
  if (total <= 0) throw new ErrorDeSubida("rechazada", "El archivo está vacío.");
  const transporte = o.transporte ?? transporteDelNavegador;
  const maxReintentos = o.maxReintentos ?? 6;
  const espera = o.esperaMs ?? esperaPorDefecto;
  const dormir = o.dormir ?? dormirPorDefecto;
  const esperarConexion = o.esperarConexion ?? esperarConexionPorDefecto;
  const hayConexion =
    o.hayConexion ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);

  const base: Record<string, string> = {
    "Tus-Resumable": "1.0.0",
    "x-signature": o.firma,
    apikey: o.apikey,
    Authorization: `Bearer ${o.apikey}`,
  };
  const revisar = () => {
    if (o.senal?.aborted) throw cancelada();
  };
  const absoluta = (loc: string) => new URL(loc, o.endpoint).toString();

  let url = o.urlPrevia ?? null;
  let offset = 0;

  // Pregunta al servidor hasta dónde llegó. null = esa subida ya no existe.
  const consultar = async (): Promise<number | null> => {
    const r = await transporte({
      metodo: "HEAD",
      url: url as string,
      encabezados: base,
      senal: o.senal,
    });
    if (r.status === 404 || r.status === 410) return null;
    const falla = errorDeEstado(r.status, "consulta");
    if (falla) throw falla;
    if (r.status >= 400) throw new TypeError(`HEAD ${r.status}`);
    const n = Number(r.encabezado("Upload-Offset"));
    if (!Number.isFinite(n) || n < 0) throw new TypeError("Respuesta sin Upload-Offset");
    return n;
  };

  const crear = async (): Promise<string> => {
    const metadatos = [
      `bucketName ${b64(o.bucket)}`,
      `objectName ${b64(o.objeto)}`,
      `contentType ${b64(o.contentType)}`,
      `cacheControl ${b64("3600")}`,
    ].join(",");
    const r = await transporte({
      metodo: "POST",
      url: o.endpoint,
      encabezados: {
        ...base,
        "Upload-Length": String(total),
        "Upload-Metadata": metadatos,
      },
      senal: o.senal,
    });
    if (r.status === 201) {
      const loc = r.encabezado("Location");
      if (!loc) throw new ErrorDeSubida("no_disponible", "El servidor no devolvió la subida.");
      return absoluta(loc);
    }
    const falla = errorDeEstado(r.status, "crear");
    if (falla) throw falla;
    throw new TypeError(`POST ${r.status}`);
  };

  // Reintenta una operación de red; solo se rinde tras varias fallas seguidas.
  let fallas = 0;
  const conReintentos = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (;;) {
      revisar();
      try {
        const r = await fn();
        return r;
      } catch (e) {
        revisar();
        if (e instanceof ErrorDeSubida) throw e;
        fallas += 1;
        if (fallas > maxReintentos) {
          throw new ErrorDeSubida(
            "red",
            "Se cortó la conexión y no pudimos retomar la subida. Revisa tu internet e inténtalo de nuevo: continuará desde donde quedó.",
          );
        }
        const sinConexion = !hayConexion();
        const ms = espera(fallas);
        o.alReintento?.({ intento: fallas, esperaMs: ms, sinConexion });
        if (sinConexion) await esperarConexion(o.senal);
        else await dormir(ms, o.senal);
      }
    }
  };

  if (url) {
    const previo = await conReintentos(consultar).catch((e) => {
      // Una subida vieja que no se puede consultar se descarta y se empieza de nuevo.
      if (e instanceof ErrorDeSubida && (e.codigo === "no_disponible" || e.codigo === "rechazada"))
        return null;
      throw e;
    });
    if (previo === null) url = null;
    else offset = previo;
  }
  if (!url) {
    url = await conReintentos(crear);
    o.alCrear?.(url);
    offset = 0;
  }
  o.alProgreso?.(offset, total);

  while (offset < total) {
    offset = await conReintentos(async () => {
      let desde = offset;
      if (fallas > 0) {
        // Tras una falla el servidor manda: el trozo pudo llegar aunque la respuesta no.
        const real = await consultar();
        if (real === null)
          throw new ErrorDeSubida(
            "expirada",
            "La subida ya no existe en el servidor. Vuelve a intentarlo para empezar de nuevo.",
          );
        desde = real;
        if (desde >= total) return total;
      }
      const fin = Math.min(desde + TAMANO_TROZO, total);
      const r = await transporte({
        metodo: "PATCH",
        url: url as string,
        encabezados: {
          ...base,
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": String(desde),
        },
        cuerpo: o.archivo.slice(desde, fin),
        alProgreso: (e) => o.alProgreso?.(Math.min(total, desde + e), total),
        senal: o.senal,
      });
      if (r.status === 204 || r.status === 200) {
        const n = Number(r.encabezado("Upload-Offset"));
        if (!Number.isFinite(n) || n <= desde) throw new TypeError("Upload-Offset no avanzó");
        return n;
      }
      const falla = errorDeEstado(r.status, "enviar");
      if (falla) throw falla;
      // 408/409/423/429/5xx: se reintenta con el desplazamiento real.
      throw new TypeError(`PATCH ${r.status}`);
    });
    fallas = 0;
    o.alProgreso?.(offset, total);
  }
}

/** Cancela una subida en curso en el servidor (mejor esfuerzo, nunca lanza). */
export async function terminarSubida(
  url: string,
  o: Pick<OpcionesTus, "apikey" | "firma" | "transporte">,
): Promise<void> {
  try {
    await (o.transporte ?? transporteDelNavegador)({
      metodo: "DELETE",
      url,
      encabezados: {
        "Tus-Resumable": "1.0.0",
        "x-signature": o.firma,
        apikey: o.apikey,
        Authorization: `Bearer ${o.apikey}`,
      },
    });
  } catch {
    // El servidor limpia las subidas abandonadas solo.
  }
}
