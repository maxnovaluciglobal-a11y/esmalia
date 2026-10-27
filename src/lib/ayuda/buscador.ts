// src/lib/ayuda/buscador.ts
//
// Buscador del centro de ayuda (ONB-10). Puro: recibe los artículos y la
// consulta, devuelve los resultados ordenados. Sin índice ni librería: son
// unas decenas de artículos y la búsqueda corre en el navegador.
//
// Reglas:
//   - Sin mayúsculas ni tildes ("cotizacion" encuentra "cotización").
//   - Cada palabra útil de la consulta tiene que aparecer en el artículo
//     (desde el comienzo de una palabra: "pres" encuentra "presupuesto").
//   - Las palabras vacías ("cómo", "de", "la"…) no cuentan: "cómo cierro la
//     caja" busca "cierro" y "caja".
//   - Pesa más el título, después los sinónimos, el resumen y el texto.
//   - Hay un puñado de sinónimos de clínica (abono → pago, cotización →
//     presupuesto) que se suman a la consulta.
import { normalizarTexto } from "@/lib/search";

export type TipoArticulo = "pantalla" | "leccion" | "guia" | "novedad";

export type ArticuloBuscable = {
  id: string;
  tipo: TipoArticulo;
  titulo: string;
  resumen: string;
  /** Texto completo (pasos, cuerpo). */
  texto: string;
  /** Sinónimos y palabras con que la gente lo busca. */
  palabras: readonly string[];
  /** A dónde lleva el resultado. */
  href: string;
};

export type Resultado = { articulo: ArticuloBuscable; puntaje: number };

const PALABRAS_VACIAS = new Set(
  [
    "a",
    "al",
    "como",
    "con",
    "cual",
    "de",
    "del",
    "donde",
    "el",
    "en",
    "es",
    "esta",
    "hago",
    "hay",
    "la",
    "las",
    "lo",
    "los",
    "me",
    "mi",
    "mis",
    "para",
    "por",
    "puedo",
    "que",
    "se",
    "si",
    "su",
    "un",
    "una",
    "y",
    "yo",
  ].map(normalizarTexto),
);

/** Sinónimos de clínica: la palabra escrita también busca estas. */
const SINONIMOS: Readonly<Record<string, readonly string[]>> = {
  abono: ["pago", "cobro"],
  cotizacion: ["presupuesto"],
  cotizar: ["presupuesto"],
  hora: ["cita", "agenda"],
  horas: ["cita", "agenda"],
  turno: ["cita", "agenda"],
  turnos: ["cita", "agenda"],
  boleta: ["folio", "pago"],
  cobrar: ["caja", "pago"],
  plata: ["caja", "pago"],
  efectivo: ["caja", "arqueo"],
  ficha: ["paciente"],
  historia: ["ficha", "nota"],
  receta: ["recetas", "documento"],
  whatsapp: ["mensaje", "recordatorio"],
  wsp: ["whatsapp", "mensaje"],
  clave: ["contrasena", "acceso"],
  contrasena: ["clave", "acceso"],
  usuario: ["equipo", "integrante"],
  usuarios: ["equipo", "integrante"],
  permiso: ["permisos", "rol"],
  reporte: ["informe", "informes"],
  reportes: ["informe", "informes"],
  estadisticas: ["informe", "informes"],
};

/** Palabras útiles de un texto, normalizadas. */
export function palabrasDe(texto: string): string[] {
  return normalizarTexto(texto)
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length > 0 && !PALABRAS_VACIAS.has(p));
}

/** ¿Alguna palabra del campo empieza con `termino`? */
function empiezaCon(campo: readonly string[], termino: string): boolean {
  return campo.some((p) => p.startsWith(termino));
}

const PESOS = { titulo: 5, palabras: 4, resumen: 2, texto: 1 } as const;

type Indexado = {
  articulo: ArticuloBuscable;
  campos: Record<keyof typeof PESOS, string[]>;
};

function indexar(articulo: ArticuloBuscable): Indexado {
  return {
    articulo,
    campos: {
      titulo: palabrasDe(articulo.titulo),
      palabras: articulo.palabras.flatMap(palabrasDe),
      resumen: palabrasDe(articulo.resumen),
      texto: palabrasDe(articulo.texto),
    },
  };
}

/** Puntaje de un término (o sus sinónimos) en un artículo; 0 = no aparece. */
function puntajeTermino(ix: Indexado, termino: string): number {
  const variantes = [termino, ...(SINONIMOS[termino] ?? [])];
  let mejor = 0;
  for (const v of variantes) {
    // El término escrito vale entero; un sinónimo, algo menos.
    const factor = v === termino ? 1 : 0.6;
    let suma = 0;
    for (const campo of Object.keys(PESOS) as (keyof typeof PESOS)[]) {
      if (empiezaCon(ix.campos[campo], v)) suma += PESOS[campo];
    }
    mejor = Math.max(mejor, suma * factor);
  }
  return mejor;
}

/**
 * Busca en los artículos. Consulta vacía (o solo palabras vacías) = sin
 * resultados: el centro de ayuda muestra entonces su índice, no una lista
 * de todo.
 */
export function buscarAyuda(
  articulos: readonly ArticuloBuscable[],
  consulta: string,
  limite = 20,
): Resultado[] {
  const terminos = [...new Set(palabrasDe(consulta))];
  if (terminos.length === 0) return [];
  const resultados: Resultado[] = [];
  for (const articulo of articulos) {
    const ix = indexar(articulo);
    let total = 0;
    let todas = true;
    for (const t of terminos) {
      const p = puntajeTermino(ix, t);
      if (p === 0) {
        todas = false;
        break;
      }
      total += p;
    }
    if (todas) resultados.push({ articulo, puntaje: total });
  }
  return resultados
    .sort((a, b) => b.puntaje - a.puntaje || a.articulo.titulo.localeCompare(b.articulo.titulo))
    .slice(0, limite);
}
