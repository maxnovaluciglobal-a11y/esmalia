// src/lib/ayuda/reportes.ts
//
// Reportar un problema o sugerir algo (ONB-09): validación y armado del aviso
// al equipo de Esmalia. Puro (sin Supabase ni Resend) para testearlo.
import { z } from "zod";

export const TIPOS_REPORTE = ["problema", "sugerencia"] as const;
export type TipoReporte = (typeof TIPOS_REPORTE)[number];

export const ETIQUETA_TIPO_REPORTE: Record<TipoReporte, string> = {
  problema: "Algo no funciona",
  sugerencia: "Una sugerencia",
};

/** Tope de la captura ya comprimida (bytes reales, no base64). */
export const MAX_BYTES_CAPTURA = 1_500_000;

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Bytes que ocupa un base64 (sin decodificarlo). */
export function bytesDeBase64(b64: string): number {
  const relleno = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - relleno;
}

/** Separa una data URL de imagen; null si no es una imagen aceptada o pesa de más. */
export function leerCaptura(dataUrl: string): { mime: string; base64: string } | null {
  const m = DATA_URL.exec(dataUrl);
  if (!m) return null;
  if (bytesDeBase64(m[2]) > MAX_BYTES_CAPTURA) return null;
  return { mime: m[1], base64: m[2] };
}

/**
 * La ruta que se guarda es solo el path: la query string puede traer lo
 * que la persona buscó (un nombre, un RUT). Un uuid en el path no dice nada
 * a quien no tiene acceso a la clínica.
 */
export function rutaSinConsulta(ruta: string): string | null {
  const limpia = ruta.split(/[?#]/)[0]?.trim() ?? "";
  if (!limpia.startsWith("/") || limpia.startsWith("//")) return null;
  return limpia.slice(0, 300);
}

export const reporteSchema = z.object({
  clinicId: z.string().uuid(),
  tipo: z.enum(TIPOS_REPORTE),
  mensaje: z
    .string()
    .trim()
    .min(5, "Cuéntanos un poco más (al menos 5 caracteres).")
    .max(4000, "El mensaje es muy largo (máximo 4.000 caracteres)."),
  ruta: z.string().max(2000).optional(),
  pantalla: z.string().trim().max(120).optional(),
  viewport: z
    .string()
    .regex(/^\d{2,5}x\d{2,5}$/)
    .optional(),
  /** Captura opcional, ya tapada en el navegador. */
  captura: z.string().max(2_100_000).optional(),
});

export type DatosReporte = z.infer<typeof reporteSchema>;

/** Líneas del correo al equipo. No lleva la captura (queda en /admin/reportes). */
export function lineasDelAviso(r: {
  tipo: TipoReporte;
  mensaje: string;
  clinica: string | null;
  autor: string | null;
  rol: string | null;
  ruta: string | null;
  pantalla: string | null;
  conCaptura: boolean;
}): string[] {
  return [
    `${ETIQUETA_TIPO_REPORTE[r.tipo]} desde la app.`,
    `Clínica: ${r.clinica ?? "sin nombre"}`,
    `Quién: ${r.autor ?? "sin nombre"}${r.rol ? ` (${r.rol})` : ""}`,
    `Pantalla: ${r.pantalla ?? "sin dato"}${r.ruta ? ` · ${r.ruta}` : ""}`,
    `Captura: ${r.conCaptura ? "sí (ver en /admin/reportes)" : "no"}`,
    "",
    r.mensaje,
  ];
}
