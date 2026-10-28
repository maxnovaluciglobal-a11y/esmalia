/**
 * Subida de un examen desde el navegador (ver `examenes.functions.ts`):
 * reservar → subir directo a Storage con la URL firmada → confirmar.
 *
 * Archivos de hasta 6 MB: una sola petición. Más grandes (CBCT, escaneos):
 * subida reanudable por trozos (`subida-reanudable.ts`) con progreso,
 * cancelar y reintento automático. Si la conexión se corta del todo, la
 * reserva se conserva (con la dirección de la subida en este navegador) para
 * retomarla desde el último trozo al reintentar con el mismo archivo y los
 * mismos datos; si no se retoma, el servidor libera el cupo de las reservas
 * vencidas al preparar la siguiente subida. Cancelar la libera al instante.
 */
import { supabase } from "@/integrations/supabase/client";
import type { SubidaPreparada } from "@/lib/examenes/examenes.functions";
import {
  ErrorDeSubida,
  MAX_SUBIDA_SIMPLE,
  subirReanudable,
  terminarSubida,
} from "@/lib/examenes/subida-reanudable";
import { esImagen, mimeDeArchivo, type TipoExamen } from "@/lib/examenes/tipos";

const BUCKET = "clinical-exams";
const LADO_MINIATURA = 480;

/** Miniatura WebP de una imagen (lado mayor 480 px). null si no se puede. */
export async function miniaturaDe(archivo: File): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(archivo);
    const escala = Math.min(1, LADO_MINIATURA / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.max(1, Math.round(bitmap.width * escala));
    const alto = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", 0.8),
    );
  } catch {
    return null;
  }
}

type Llamada<I, O> = (opciones: { data: I }) => Promise<O>;

export interface DatosDeSubida {
  clinicId: string;
  patientId: string;
  kind: TipoExamen;
  takenOn: string;
  teeth: number[];
  professionalId: string | null;
  notes: string;
  photoSessionId: string | null;
}

export interface OpcionesDeSubida {
  /** Bytes enviados del archivo en curso. */
  alProgreso?: (enviados: number, total: number) => void;
  /** Un trozo falló y se reintenta solo. */
  alReintento?: (info: { intento: number; esperaMs: number; sinConexion: boolean }) => void;
  /** Cancela la subida y libera el cupo reservado. */
  senal?: AbortSignal;
}

// ─── Subida retomable entre intentos ──────────────────────────────────────

/** La firma de subida dura 2 h; se retoma solo dentro de 100 minutos. */
const VIGENCIA_REANUDAR_MS = 100 * 60 * 1000;
const PREFIJO_REANUDAR = "esmalia:subida-reanudable:";

interface SubidaGuardada {
  examId: string;
  path: string;
  token: string;
  url: string | null;
  datos: string;
  guardado: number;
}

/** Misma clínica, paciente, tipo y archivo (nombre, tamaño y fecha de modificación). */
export function huellaDeSubida(archivo: File, datos: DatosDeSubida): string {
  return `${PREFIJO_REANUDAR}${datos.clinicId}:${datos.patientId}:${datos.kind}:${archivo.name}:${archivo.size}:${archivo.lastModified}`;
}

function datosComparables(d: DatosDeSubida): string {
  return JSON.stringify([d.takenOn, d.teeth, d.professionalId, d.notes, d.photoSessionId]);
}

function leerGuardada(huella: string, datos: DatosDeSubida): SubidaGuardada | null {
  try {
    const crudo = window.localStorage.getItem(huella);
    if (!crudo) return null;
    const g = JSON.parse(crudo) as SubidaGuardada;
    if (Date.now() - g.guardado > VIGENCIA_REANUDAR_MS || g.datos !== datosComparables(datos)) {
      window.localStorage.removeItem(huella);
      return null;
    }
    return g;
  } catch {
    return null;
  }
}

function guardar(huella: string, g: SubidaGuardada) {
  try {
    window.localStorage.setItem(huella, JSON.stringify(g));
  } catch {
    // Sin almacenamiento local no se puede retomar tras recargar; el resto funciona.
  }
}

function olvidar(huella: string) {
  try {
    window.localStorage.removeItem(huella);
  } catch {
    // nada
  }
}

/** Quita las subidas guardadas que ya vencieron. */
export function limpiarSubidasVencidas() {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (!k?.startsWith(PREFIJO_REANUDAR)) continue;
      const g = JSON.parse(window.localStorage.getItem(k) ?? "null") as SubidaGuardada | null;
      if (!g || Date.now() - g.guardado > VIGENCIA_REANUDAR_MS) window.localStorage.removeItem(k);
    }
  } catch {
    // nada
  }
}

function claveYUrlDelProyecto(): { url: string; clave: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const clave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  return url && clave ? { url: url.replace(/\/+$/, ""), clave } : null;
}

export async function subirExamen(
  archivo: File,
  datos: DatosDeSubida,
  fns: {
    preparar: Llamada<
      DatosDeSubida & {
        filename: string;
        mimeType: string;
        sizeBytes: number;
        conMiniatura: boolean;
      },
      SubidaPreparada
    >;
    confirmar: Llamada<{ clinicId: string; examId: string; thumbPath: string | null }, unknown>;
    cancelar: Llamada<{ clinicId: string; examId: string }, unknown>;
  },
  opciones: OpcionesDeSubida = {},
): Promise<void> {
  const mime = mimeDeArchivo(archivo.name, archivo.type);
  const grande = archivo.size > MAX_SUBIDA_SIMPLE;
  const proyecto = grande ? claveYUrlDelProyecto() : null;
  const reanudable = grande && proyecto !== null;
  const miniatura = esImagen(mime) ? await miniaturaDe(archivo) : null;

  const huella = huellaDeSubida(archivo, datos);
  const previa = reanudable ? leerGuardada(huella, datos) : null;
  const reserva: Pick<SubidaPreparada, "examId" | "path" | "token"> &
    Partial<Pick<SubidaPreparada, "thumbPath" | "thumbToken">> =
    previa ??
    (await fns.preparar({
      data: {
        ...datos,
        filename: archivo.name,
        mimeType: mime,
        sizeBytes: archivo.size,
        conMiniatura: miniatura !== null,
      },
    }));
  let urlTus = previa?.url ?? null;
  if (reanudable) {
    guardar(huella, {
      examId: reserva.examId,
      path: reserva.path,
      token: reserva.token,
      url: urlTus,
      datos: datosComparables(datos),
      guardado: previa?.guardado ?? Date.now(),
    });
  }

  const cancelarReserva = async () => {
    olvidar(huella);
    try {
      await fns.cancelar({ data: { clinicId: datos.clinicId, examId: reserva.examId } });
    } catch {
      // La reserva queda pendiente: no se muestra y el servidor la libera al vencer.
    }
  };

  try {
    if (reanudable && proyecto) {
      try {
        await subirReanudable({
          endpoint: `${proyecto.url}/storage/v1/upload/resumable/sign`,
          apikey: proyecto.clave,
          firma: reserva.token,
          bucket: BUCKET,
          objeto: reserva.path,
          contentType: mime,
          archivo,
          urlPrevia: urlTus,
          alCrear: (url) => {
            urlTus = url;
            guardar(huella, {
              examId: reserva.examId,
              path: reserva.path,
              token: reserva.token,
              url,
              datos: datosComparables(datos),
              guardado: previa?.guardado ?? Date.now(),
            });
          },
          alProgreso: opciones.alProgreso,
          alReintento: opciones.alReintento,
          senal: opciones.senal,
        });
      } catch (e) {
        // Un servidor sin subida reanudable: se usa la subida normal.
        if (e instanceof ErrorDeSubida && e.codigo === "no_disponible") {
          await subidaSimple(reserva, archivo, mime);
          opciones.alProgreso?.(archivo.size, archivo.size);
        } else throw e;
      }
    } else {
      opciones.alProgreso?.(0, archivo.size);
      await subidaSimple(reserva, archivo, mime);
      opciones.alProgreso?.(archivo.size, archivo.size);
    }

    let thumbPath: string | null = null;
    if (miniatura && reserva.thumbPath && reserva.thumbToken) {
      const t = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(reserva.thumbPath, reserva.thumbToken, miniatura, {
          contentType: "image/webp",
        });
      // Sin miniatura la lista muestra la imagen original: no es un error.
      if (!t.error) thumbPath = reserva.thumbPath;
    }

    await fns.confirmar({
      data: { clinicId: datos.clinicId, examId: reserva.examId, thumbPath },
    });
    olvidar(huella);
  } catch (e) {
    if (e instanceof ErrorDeSubida && e.codigo === "red") {
      // Se conserva la reserva: al reintentar con el mismo archivo continúa donde quedó.
      throw e;
    }
    if (e instanceof ErrorDeSubida && e.codigo === "cancelada" && urlTus && proyecto) {
      await terminarSubida(urlTus, { apikey: proyecto.clave, firma: reserva.token });
    }
    await cancelarReserva();
    throw e;
  }
}

async function subidaSimple(
  reserva: Pick<SubidaPreparada, "path" | "token">,
  archivo: File,
  mime: string,
) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(reserva.path, reserva.token, archivo, { contentType: mime });
  if (error) throw new Error("No pudimos subir el archivo. Revisa tu conexión e intenta de nuevo.");
}
