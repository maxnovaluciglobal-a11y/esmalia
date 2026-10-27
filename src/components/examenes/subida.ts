/**
 * Subida de un examen desde el navegador (ver `examenes.functions.ts`):
 * reservar → subir directo a Storage con la URL firmada → confirmar. Si algo
 * falla después de reservar, se cancela la reserva para no ocupar cupo.
 */
import { supabase } from "@/integrations/supabase/client";
import type { SubidaPreparada } from "@/lib/examenes/examenes.functions";
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
): Promise<void> {
  const mime = mimeDeArchivo(archivo.name, archivo.type);
  const miniatura = esImagen(mime) ? await miniaturaDe(archivo) : null;

  const reserva = await fns.preparar({
    data: {
      ...datos,
      filename: archivo.name,
      mimeType: mime,
      sizeBytes: archivo.size,
      conMiniatura: miniatura !== null,
    },
  });

  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .uploadToSignedUrl(reserva.path, reserva.token, archivo, { contentType: mime });
    if (error)
      throw new Error("No pudimos subir el archivo. Revisa tu conexión e intenta de nuevo.");

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
  } catch (e) {
    try {
      await fns.cancelar({ data: { clinicId: datos.clinicId, examId: reserva.examId } });
    } catch {
      // La reserva queda pendiente: no se muestra y el servidor la ignora.
    }
    throw e;
  }
}
