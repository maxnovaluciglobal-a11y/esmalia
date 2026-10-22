import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Extractor de textos de interfaz para los controles de texto del CI (NAV-12,
 * Ola 1). No es un parser de TypeScript: mira línea por línea, descarta
 * comentarios y se queda con
 *
 * - el contenido de los literales de texto ("…", '…', `…`), y
 * - el texto de JSX entre etiquetas (`>Guardar cambios<`) o en líneas que
 *   son solo prosa (el texto largo partido en varias líneas por prettier).
 *
 * Así una regla como "nada de Dashboard en la interfaz" no salta con el
 * nombre de un componente (`function Dashboard`) ni con una ruta
 * (`"/dashboard"`), que son identificadores internos.
 */

export type Texto = { archivo: string; linea: number; texto: string };

export function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosFuente(ruta);
    return /\.tsx?$/.test(nombre) && !/\.gen\.ts$/.test(nombre) ? [ruta] : [];
  });
}

/** Una línea de comentario (// … o * … dentro de un bloque /** *\/). */
export function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*");
}

const LITERAL = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

/** Contenido de los literales de la línea (las `${…}` de una plantilla quedan como espacio). */
export function literales(linea: string): string[] {
  const out: string[] = [];
  for (const m of linea.matchAll(LITERAL)) {
    const v = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, " ");
    out.push(v);
  }
  return out;
}

/** Texto de JSX de la línea: lo que queda entre `>` y `<`, o la línea entera si es prosa. */
export function textoJsx(linea: string): string[] {
  // Sin literales ni expresiones `{…}`: no son texto visible de JSX.
  const sinCodigo = linea.replace(LITERAL, " ").replace(/\{[^{}]*\}/g, " ");
  const out: string[] = [];
  for (const m of sinCodigo.matchAll(/>([^<>]+)</g)) out.push(m[1]);
  const t = sinCodigo.trim();
  // Línea de prosa: arranca con letra, tiene al menos dos palabras en
  // minúscula separadas por espacio y no tiene sintaxis de código (así un
  // `DEFAULT_EMAIL_SANDBOX,` suelto de un import no cuenta como texto).
  const sintaxis =
    /[=;(){}<>]|=>|^\w+:\s|^(?:import|export|const|let|return|type|interface|function|if|else|case)\b/;
  if (/^[\p{L}¿¡]/u.test(t) && /\p{Ll}{2,}\s+\p{L}{2,}/u.test(t) && !sintaxis.test(t)) {
    out.push(t);
  }
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * ¿Un literal es texto para personas? Con espacios (una frase) o una sola
 * palabra que empieza en mayúscula ("Guardar"). Los identificadores
 * (`"sandbox"`, `"/dashboard"`, `"recall_due"`, clases de Tailwind sin
 * mayúsculas) quedan afuera.
 */
export function esTextoVisible(literal: string): boolean {
  const t = literal.trim();
  if (!t) return false;
  if (/^(?:[./@#]|https?:|mailto:|data:)/.test(t)) return false;
  if (/\s/.test(t)) return /\p{L}{2,}\s+\p{L}{2,}/u.test(t);
  return /^\p{Lu}\p{Ll}+$/u.test(t);
}

/** Todos los textos de interfaz de `src/`, con archivo y línea. */
export function textosDeInterfaz(raiz: string): Texto[] {
  const out: Texto[] = [];
  for (const archivo of archivosFuente(raiz)) {
    const rel = path.relative(raiz, archivo);
    readFileSync(archivo, "utf8")
      .split("\n")
      .forEach((linea, i) => {
        if (esComentario(linea)) return;
        // Comentario al final de la línea: fuera (no dentro de un literal: aproximado).
        const sinComentario = linea.replace(/\s\/\/\s.*$/, "");
        for (const lit of literales(sinComentario)) {
          if (esTextoVisible(lit)) out.push({ archivo: rel, linea: i + 1, texto: lit });
        }
        for (const t of textoJsx(sinComentario)) out.push({ archivo: rel, linea: i + 1, texto: t });
      });
  }
  return out;
}

/** Todos los literales (visibles o no), para las reglas que miran identificadores mal puestos. */
export function todosLosLiterales(raiz: string): Texto[] {
  const out: Texto[] = [];
  for (const archivo of archivosFuente(raiz)) {
    const rel = path.relative(raiz, archivo);
    readFileSync(archivo, "utf8")
      .split("\n")
      .forEach((linea, i) => {
        if (esComentario(linea)) return;
        for (const lit of literales(linea)) out.push({ archivo: rel, linea: i + 1, texto: lit });
      });
  }
  return out;
}
