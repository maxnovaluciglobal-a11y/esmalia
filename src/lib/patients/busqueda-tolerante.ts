/**
 * PAC-02: búsqueda de nombres que tolera tildes y errores de tipeo, para el
 * filtro local del listado de pacientes (funciona también sin conexión, con
 * la lista ya cargada). En el servidor el par es
 * `buscar_pacientes_por_nombre` (pg_trgm + unaccent).
 *
 * "jose peres" encuentra "José Pérez": cada palabra de lo escrito tiene que
 * coincidir con alguna palabra del nombre, por el comienzo o con hasta un
 * error (dos en palabras largas).
 */
import { normalizarTexto } from "@/lib/search";

/** Distancia de edición (Levenshtein) acotada: corta apenas pasa de `maximo`. */
export function distanciaDeEdicion(a: string, b: string, maximo = 2): number {
  if (Math.abs(a.length - b.length) > maximo) return maximo + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    let minimoFila = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + costo);
      minimoFila = Math.min(minimoFila, actual[j]);
    }
    if (minimoFila > maximo) return maximo + 1;
    previa = actual;
  }
  return previa[b.length];
}

function erroresPermitidos(palabra: string): number {
  if (palabra.length >= 8) return 2;
  if (palabra.length >= 4) return 1;
  return 0;
}

function palabraCoincide(buscada: string, palabras: readonly string[]): boolean {
  const tolerancia = erroresPermitidos(buscada);
  return palabras.some((p) => {
    if (p.startsWith(buscada)) return true;
    if (tolerancia === 0) return false;
    // Contra la palabra entera y contra su comienzo del mismo largo
    // ("gonsal" ~ "gonzalez").
    if (distanciaDeEdicion(buscada, p, tolerancia) <= tolerancia) return true;
    const prefijo = p.slice(0, buscada.length);
    return (
      prefijo.length === buscada.length &&
      distanciaDeEdicion(buscada, prefijo, tolerancia) <= tolerancia
    );
  });
}

/** ¿El nombre coincide con lo escrito, sin importar tildes, mayúsculas ni un error de tipeo? */
export function coincideNombre(termino: string, nombre: string | null | undefined): boolean {
  const t = normalizarTexto(termino);
  if (!t) return true;
  if (!nombre) return false;
  const n = normalizarTexto(nombre);
  if (n.includes(t)) return true;
  const palabrasNombre = n.split(" ").filter(Boolean);
  return t
    .split(" ")
    .filter(Boolean)
    .every((palabra) => palabraCoincide(palabra, palabrasNombre));
}
