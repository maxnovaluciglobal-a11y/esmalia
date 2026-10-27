/**
 * Registro de lecturas de la ficha clínica (SEG-02): vocabulario y textos.
 *
 * Las secciones son las mismas del CHECK de `clinical_access_log`
 * (migración 20261019160000, ampliado en 20261109100100); `tests/lecturas-ficha.test.ts` compara las dos
 * listas para que no se separen. Este archivo no toca la base: lo usan la
 * pantalla de Compliance y el helper del servidor (`lecturas-ficha.server.ts`).
 */
export const SECCIONES_FICHA = [
  "datos",
  "notas",
  "odontograma",
  "periodontograma",
  "anamnesis",
  "documentos",
  "examenes",
] as const;

export type SeccionFicha = (typeof SECCIONES_FICHA)[number];

export const ETIQUETA_SECCION: Record<SeccionFicha, string> = {
  datos: "Datos del paciente",
  notas: "Notas clínicas",
  odontograma: "Odontograma",
  periodontograma: "Periodontograma",
  anamnesis: "Anamnesis",
  documentos: "Documentos y consentimientos",
  examenes: "Exámenes e imágenes",
};

/** Ventana de deduplicación del RPC `registrar_lectura_ficha`. Solo se usa
 * para explicarla en pantalla; la regla vive en la base. */
export const MINUTOS_DEDUP_LECTURA = 15;

export function etiquetaSeccion(seccion: string): string {
  return (ETIQUETA_SECCION as Record<string, string>)[seccion] ?? seccion;
}

export interface LecturaDeFicha {
  id: string;
  accessedAt: string;
  patientId: string;
  /** null si el paciente ya no existe (el registro sobrevive al borrado). */
  patientName: string | null;
  actorId: string;
  /** null si el usuario ya no existe o no tiene perfil. */
  actorName: string | null;
  section: string;
}
