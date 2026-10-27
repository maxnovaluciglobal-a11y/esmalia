/**
 * Lectura SOAP de una nota clínica (A+, 26-oct-2026). Las notas son texto
 * libre; las plantillas y la demo las escriben con "S)" o "S:" al inicio de
 * cada sección. Si el texto trae las cuatro letras en orden, la ficha las
 * muestra con la jerarquía del prototipo (letra grande en Cormorant y el
 * texto al lado). Si no, se muestra el texto tal cual: nunca se inventa una
 * estructura que la nota no tiene.
 */

export type LetraSoap = "S" | "O" | "A" | "P";

export interface SeccionSoap {
  letra: LetraSoap;
  texto: string;
}

const ORDEN: readonly LetraSoap[] = ["S", "O", "A", "P"];
const NOMBRE: Record<LetraSoap, string> = {
  S: "Subjetivo",
  O: "Objetivo",
  A: "Análisis",
  P: "Plan",
};

/** Nombre completo de la sección, para lectores de pantalla y títulos. */
export function nombreSeccionSoap(letra: LetraSoap): string {
  return NOMBRE[letra];
}

// "S)", "S:", "S." o "S -" al comienzo de una línea (con espacios antes).
const ENCABEZADO = /^[ \t]*([SOAP])[ \t]*[):.\-–][ \t]*/;

/**
 * Separa la nota en S, O, A y P. Devuelve `null` si falta alguna sección o
 * si aparecen fuera de orden (en ese caso la nota no es SOAP y se lee como
 * texto corrido). El texto antes de la "S" también anula la lectura: no se
 * esconde nada de lo que escribió el profesional.
 */
export function separarSoap(contenido: string): SeccionSoap[] | null {
  const lineas = contenido.replace(/\r\n?/g, "\n").split("\n");
  const secciones: { letra: LetraSoap; lineas: string[] }[] = [];
  for (const linea of lineas) {
    const m = ENCABEZADO.exec(linea);
    const siguiente = ORDEN[secciones.length];
    if (m && m[1] === siguiente) {
      secciones.push({ letra: siguiente, lineas: [linea.slice(m[0].length)] });
      continue;
    }
    if (secciones.length === 0) {
      if (linea.trim()) return null;
      continue;
    }
    secciones[secciones.length - 1].lineas.push(linea);
  }
  if (secciones.length !== 4) return null;
  return secciones.map((s) => ({ letra: s.letra, texto: s.lineas.join("\n").trim() }));
}
