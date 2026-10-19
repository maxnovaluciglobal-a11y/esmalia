/**
 * Archivo de fichas (LEG-08 / CLI-05, auditoría 360 del 18-oct-2026).
 *
 * Una ficha clínica no se borra: la historia clínica se conserva por ley
 * (Chile 15 años, Ley 20.584 art. 13; Colombia 15, Res. 839/2017; Argentina
 * 10, Ley 26.529 art. 18; México al menos 5, NOM-004-SSA3-2012 5.4). Archivar
 * la saca de los listados y de la búsqueda, y se puede restaurar.
 */

export const FILTROS_DE_ARCHIVO = ["activas", "archivadas", "todas"] as const;
export type FiltroDeArchivo = (typeof FILTROS_DE_ARCHIVO)[number];

export const ETIQUETA_FILTRO_DE_ARCHIVO: Record<FiltroDeArchivo, string> = {
  activas: "Fichas activas",
  archivadas: "Solo archivadas",
  todas: "Activas y archivadas",
};

/** Lee el filtro desde la URL: cualquier valor desconocido es "activas". */
export function parseFiltroDeArchivo(valor: unknown): FiltroDeArchivo {
  return (FILTROS_DE_ARCHIVO as readonly string[]).includes(valor as string)
    ? (valor as FiltroDeArchivo)
    : "activas";
}

/** Texto del diálogo de archivar: explica por qué no existe "eliminar". */
export const EXPLICACION_CONSERVACION =
  "La historia clínica no se elimina: la ley obliga a conservarla entre 5 y 15 años según el país " +
  "(15 en Chile y Colombia, 10 en Argentina, al menos 5 en México). Archivar saca la ficha de los " +
  "listados y de la búsqueda, pero sus notas, odontograma, documentos, consentimientos y pagos " +
  "quedan guardados y puedes restaurarla cuando quieras.";
