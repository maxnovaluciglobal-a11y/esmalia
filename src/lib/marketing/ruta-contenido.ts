import { notFound } from "@tanstack/react-router";

import { aEnlace, type Enlace, NOMBRE_COLECCION, paginaPorPath } from "@/content";
import type { Coleccion, PaginaContenido } from "@/content/tipos";
import { contenidoHead } from "@/lib/seo";

// Índice que agrupa cada colección (para la miga de pan y el JSON-LD).
export const INDICE_DE: Partial<Record<Coleccion, string>> = {
  funciones: "/funciones",
  comparar: "/comparar",
  alternativas: "/comparar",
  guias: "/recursos",
  plantillas: "/recursos",
  pais: "/software-dental-latam",
};

export interface DatosPagina {
  pagina: PaginaContenido;
  relacionados: Enlace[];
}

export async function cargarPagina(path: string): Promise<DatosPagina> {
  const pagina = await paginaPorPath(path);
  if (!pagina) throw notFound();
  const relacionados = (await Promise.all((pagina.relacionados ?? []).map((p) => paginaPorPath(p))))
    .filter((p): p is PaginaContenido => Boolean(p))
    .map(aEnlace);
  return { pagina, relacionados };
}

export function headDePagina(datos: DatosPagina | undefined) {
  if (!datos) return {};
  const { pagina } = datos;
  return contenidoHead({
    ...pagina,
    coleccionNombre: NOMBRE_COLECCION[pagina.coleccion],
    coleccionPath: INDICE_DE[pagina.coleccion],
  });
}
