// Contenido editorial de la web pública (páginas de funciones, país,
// comparativas, guías, plantillas). Cada página es un módulo de datos en
// src/content/paginas/ y se registra en src/content/index.ts; las rutas, el
// sitemap y /llms.txt se arman desde ese registro.
//
// Texto en línea: se aceptan **negrita** y [texto](/ruta o https://…). Nada
// más: ni HTML ni otros marcadores de Markdown.

export type Bloque =
  | { tipo: "p"; texto: string }
  | { tipo: "lista"; items: string[]; ordenada?: boolean }
  | {
      tipo: "tabla";
      columnas: string[];
      filas: string[][];
      nota?: string;
      /** Formulario para imprimir y llenar a mano: celdas altas con líneas. */
      rellenable?: boolean;
    }
  /** Recuadro destacado: límites del producto, advertencias, "qué no hace". */
  | { tipo: "aviso"; texto: string }
  /** Texto para copiar y pegar (mensajes de WhatsApp, cláusulas de plantilla). */
  | { tipo: "plantilla"; titulo: string; texto: string };

export interface Seccion {
  /** Mejor en forma de pregunta: es como la gente le pregunta a una IA. */
  h2: string;
  bloques: Bloque[];
}

export type Coleccion =
  "funciones" | "pais" | "comparar" | "alternativas" | "guias" | "plantillas" | "para";

export interface PaginaContenido {
  coleccion: Coleccion;
  /** Ruta pública completa, con barra inicial (ej. "/funciones/odontograma"). */
  path: string;
  /** <title>, hasta ~60 caracteres, termina en "| Esmalia". */
  titulo: string;
  /** Meta description, 120-155 caracteres. */
  descripcion: string;
  /** Etiqueta corta sobre el H1 (ej. "Funciones", "Comparativa"). */
  kicker: string;
  h1: string;
  /** Respuesta directa de 40-60 palabras: la primera cosa que lee un motor de IA. */
  resumen: string;
  /** AAAA-MM-DD */
  publicado: string;
  /** AAAA-MM-DD; para comparativas, la fecha en que se relevaron los datos. */
  actualizado: string;
  autor: { nombre: string; rol: string };
  /** Revisión profesional (odontólogo, contador, abogado). Obligatoria en
   *  guías clínicas o normativas: sin revisor, esas páginas van como borrador. */
  revisor?: { nombre: string; credencial: string };
  /** true: no se publica (sin ruta, sin sitemap, sin llms.txt). */
  borrador?: boolean;
  secciones: Seccion[];
  faq?: { q: string; a: string }[];
  fuentes?: { titulo: string; url: string }[];
  /** Paths de otras páginas para "Sigue leyendo". */
  relacionados?: string[];
  /** Texto de una línea para el índice de su colección y para /llms.txt. */
  enUnaLinea: string;
}
