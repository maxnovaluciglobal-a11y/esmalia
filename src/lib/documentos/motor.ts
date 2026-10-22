/**
 * Motor de plantillas (DOC-01): texto con {{variables}} → bloques → HTML.
 * Lógica pura, sin red ni base: corre igual en el navegador (vista previa,
 * PDF) y en el servidor (emisión).
 *
 * Formato de una plantilla (pensado para escribirse sin saber HTML):
 *
 *   # Título del documento        → título
 *   ## Subtítulo                  → subtítulo
 *   Texto con **negrita**         → párrafo (las líneas seguidas son un mismo
 *   y {{paciente.nombre}}            párrafo con salto de línea)
 *   (línea en blanco)             → separa párrafos
 *   - un ítem                     → lista
 *   {{reembolso.prestaciones}}    → variable de bloque, sola en su línea: tabla
 *
 * Nada de HTML: si alguien escribe `<b>` en la plantilla, se imprime tal cual.
 * Los valores de la ficha tampoco se interpretan. El HTML canónico lo arma
 * `bloquesAHtml`, escapando todo, y es lo que se hashea al emitir.
 */
import type {
  Bloque,
  ContextoDocumento,
  DocumentoRenderizado,
  TablaDeContexto,
  Tramo,
} from "@/lib/documentos/tipos";
import {
  definicionCampo,
  esVariableConocida,
  esVariableDeBloque,
  nombreDeCampo,
} from "@/lib/documentos/variables";
import { numero } from "@/lib/formato-fecha";

/** Línea para completar a mano cuando falta un dato. */
export const LINEA_EN_BLANCO = "__________";
/** Lo que se imprime para un campo opcional vacío. */
export const SIN_VALOR = "—";

/** Una variable bien escrita: `{{ grupo.nombre }}`, minúsculas, dígitos y guion bajo. */
const VARIABLE = /\{\{\s*([^{}]*?)\s*\}\}/g;
const CLAVE_VALIDA = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
const LARGO_MAXIMO_CUERPO = 20_000;

// ─── Análisis y validación ───────────────────────────────────────────────────

export interface ProblemaPlantilla {
  tipo: "desconocida" | "mal_escrita" | "bloque_en_linea" | "vacia" | "muy_larga";
  /** Texto de la variable tal como está escrita (si aplica). */
  variable?: string;
  /** Número de línea (desde 1). */
  linea?: number;
  mensaje: string;
}

export interface AnalisisPlantilla {
  /** Variables bien escritas, sin repetir, en orden de aparición. */
  variables: string[];
  /** Campos que se piden al emitir (sin el prefijo `campo.`), en orden. */
  campos: string[];
  /** Variables bien escritas que el motor no conoce. */
  desconocidas: string[];
  problemas: ProblemaPlantilla[];
}

/** Recorre las variables de un texto: { clave, original, inicio, fin }. */
function* variablesDe(texto: string) {
  for (const m of texto.matchAll(VARIABLE)) {
    yield { clave: m[1], original: m[0], inicio: m.index ?? 0, fin: (m.index ?? 0) + m[0].length };
  }
}

/** Lista de variables (válidas o no) de un texto, sin repetir, en orden. */
export function extraerVariables(cuerpo: string): string[] {
  const vistas: string[] = [];
  for (const { clave } of variablesDe(cuerpo)) if (!vistas.includes(clave)) vistas.push(clave);
  return vistas;
}

/**
 * Valida una plantilla para el editor y para guardarla: variables que el
 * motor no conoce, llaves sin cerrar, una tabla en medio de un párrafo.
 * Una plantilla con problemas no se guarda ni se emite.
 */
export function analizarPlantilla(cuerpo: string): AnalisisPlantilla {
  const variables: string[] = [];
  const campos: string[] = [];
  const desconocidas: string[] = [];
  const problemas: ProblemaPlantilla[] = [];

  if (!cuerpo.trim()) {
    problemas.push({ tipo: "vacia", mensaje: "La plantilla está vacía." });
  }
  if (cuerpo.length > LARGO_MAXIMO_CUERPO) {
    problemas.push({
      tipo: "muy_larga",
      mensaje: `La plantilla supera los ${numero(LARGO_MAXIMO_CUERPO)} caracteres.`,
    });
  }

  cuerpo.split(/\r?\n/).forEach((linea, i) => {
    const numero = i + 1;
    for (const { clave, original } of variablesDe(linea)) {
      if (!CLAVE_VALIDA.test(clave)) {
        problemas.push({
          tipo: "mal_escrita",
          variable: original,
          linea: numero,
          mensaje: `La variable ${original} está mal escrita (línea ${numero}): usa minúsculas, sin tildes ni espacios, como {{paciente.nombre}}.`,
        });
        continue;
      }
      if (!esVariableConocida(clave)) {
        if (!desconocidas.includes(clave)) desconocidas.push(clave);
        problemas.push({
          tipo: "desconocida",
          variable: original,
          linea: numero,
          mensaje: `No conocemos la variable {{${clave}}} (línea ${numero}). Elígela de la lista o escríbela como {{campo.nombre}} para pedirla al emitir.`,
        });
        continue;
      }
      if (esVariableDeBloque(clave) && linea.trim() !== original) {
        problemas.push({
          tipo: "bloque_en_linea",
          variable: original,
          linea: numero,
          mensaje: `{{${clave}}} es una tabla: déjala sola en su línea (línea ${numero}).`,
        });
      }
      if (!variables.includes(clave)) variables.push(clave);
      const campo = nombreDeCampo(clave);
      if (campo && !campos.includes(campo)) campos.push(campo);
    }
    // Llaves que abren y no cierran (o al revés): "{{paciente.nombre}" o "{paciente}}".
    const sinVariables = linea.replace(VARIABLE, "");
    if (sinVariables.includes("{{") || sinVariables.includes("}}")) {
      problemas.push({
        tipo: "mal_escrita",
        linea: numero,
        mensaje: `Hay llaves sin cerrar en la línea ${numero}: una variable se escribe {{así}}.`,
      });
    }
  });

  return { variables, campos, desconocidas, problemas };
}

// ─── Render ──────────────────────────────────────────────────────────────────

export interface OpcionesRender {
  /**
   * Firma que se agrega al final (la pone la emisión con los datos del
   * profesional). Sin firma, el documento termina en el último bloque.
   */
  firma?: Extract<Bloque, { tipo: "firma" }> | null;
}

/** Junta tramos de texto contiguos con el mismo estilo (HTML más corto y estable). */
function compactar(tramos: Tramo[]): Tramo[] {
  const out: Tramo[] = [];
  for (const t of tramos) {
    const prev = out.at(-1);
    if (
      t.tipo === "texto" &&
      prev?.tipo === "texto" &&
      !t.variable &&
      !prev.variable &&
      !t.faltante &&
      !prev.faltante &&
      !t.desconocida &&
      !prev.desconocida &&
      Boolean(t.negrita) === Boolean(prev.negrita)
    ) {
      prev.texto += t.texto;
      continue;
    }
    if (t.tipo === "texto" && t.texto === "") continue;
    out.push(t.tipo === "texto" ? { ...t } : t);
  }
  return out;
}

function valorDeVariable(clave: string, contexto: ContextoDocumento): Tramo {
  if (!CLAVE_VALIDA.test(clave) || !esVariableConocida(clave)) {
    return { tipo: "texto", texto: `{{${clave}}}`, desconocida: true };
  }
  const valor = contexto.valores[clave];
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (texto) return { tipo: "texto", texto, variable: clave };
  const campo = nombreDeCampo(clave);
  if (campo && definicionCampo(campo).opcional) {
    return { tipo: "texto", texto: SIN_VALOR, variable: clave };
  }
  return { tipo: "texto", texto: LINEA_EN_BLANCO, variable: clave, faltante: true };
}

/** Una línea de texto → tramos (negrita con `**` y variables). */
function tramosDeLinea(linea: string, contexto: ContextoDocumento, usadas: Set<string>): Tramo[] {
  const tramos: Tramo[] = [];
  let negrita = false;
  // Separa por marcadores de negrita y por variables, conservándolos.
  const partes = linea.split(/(\*\*|\{\{[^{}]*\}\})/);
  for (const parte of partes) {
    if (parte === "**") {
      negrita = !negrita;
      continue;
    }
    const m = /^\{\{\s*([^{}]*?)\s*\}\}$/.exec(parte);
    if (m) {
      usadas.add(m[1]);
      const t = valorDeVariable(m[1], contexto);
      tramos.push(negrita && t.tipo === "texto" ? { ...t, negrita: true } : t);
      continue;
    }
    if (parte) tramos.push({ tipo: "texto", texto: parte, ...(negrita ? { negrita: true } : {}) });
  }
  return tramos;
}

function tablaVacia(clave: string): TablaDeContexto {
  return {
    tipo: "tabla",
    columnas: [{ titulo: "Detalle", alineacion: "izquierda" }],
    filas: [],
    vacia: `Sin datos para {{${clave}}}.`,
  };
}

/**
 * Renderiza una plantilla con un contexto. Nunca lanza: lo que falta queda
 * marcado (`faltantes`, `desconocidas`) para que quien llama decida si se
 * puede emitir.
 */
export function renderPlantilla(
  cuerpo: string,
  contexto: ContextoDocumento,
  opciones: OpcionesRender = {},
): DocumentoRenderizado {
  const usadas = new Set<string>();
  const bloques: Bloque[] = [];
  let parrafo: Tramo[] | null = null;
  let lista: Tramo[][] | null = null;

  const cerrar = () => {
    if (parrafo) {
      const tramos = compactar(parrafo);
      if (tramos.length) bloques.push({ tipo: "parrafo", tramos });
      parrafo = null;
    }
    if (lista) {
      bloques.push({ tipo: "lista", items: lista });
      lista = null;
    }
  };

  for (const lineaCruda of cuerpo.split(/\r?\n/)) {
    const linea = lineaCruda.trimEnd();
    const recortada = linea.trim();

    if (!recortada) {
      cerrar();
      continue;
    }

    const soloVariable = /^\{\{\s*([^{}]*?)\s*\}\}$/.exec(recortada);
    if (soloVariable && esVariableDeBloque(soloVariable[1])) {
      cerrar();
      usadas.add(soloVariable[1]);
      bloques.push(contexto.tablas?.[soloVariable[1]] ?? tablaVacia(soloVariable[1]));
      continue;
    }

    const titulo = /^(#{1,2})\s+(.*)$/.exec(recortada);
    if (titulo) {
      cerrar();
      bloques.push({
        tipo: "titulo",
        nivel: titulo[1].length === 1 ? 1 : 2,
        tramos: compactar(tramosDeLinea(titulo[2], contexto, usadas)),
      });
      continue;
    }

    const item = /^[-*]\s+(.*)$/.exec(recortada);
    if (item && !recortada.startsWith("**")) {
      if (parrafo) cerrar();
      lista ??= [];
      lista.push(compactar(tramosDeLinea(item[1], contexto, usadas)));
      continue;
    }

    if (lista) cerrar();
    const tramos = tramosDeLinea(recortada, contexto, usadas);
    if (parrafo) parrafo.push({ tipo: "salto" }, ...tramos);
    else parrafo = tramos;
  }
  cerrar();

  if (opciones.firma) bloques.push(opciones.firma);

  const variables = [...usadas];
  const desconocidas = variables.filter((v) => !CLAVE_VALIDA.test(v) || !esVariableConocida(v));
  const faltantes = variables.filter((v) => {
    if (desconocidas.includes(v) || esVariableDeBloque(v)) return false;
    const valor = contexto.valores[v];
    if (typeof valor === "string" && valor.trim()) return false;
    const campo = nombreDeCampo(v);
    return !(campo && definicionCampo(campo).opcional);
  });
  return { bloques, variables, desconocidas, faltantes };
}

// ─── HTML canónico ───────────────────────────────────────────────────────────

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function tramosAHtml(tramos: readonly Tramo[]): string {
  return tramos
    .map((t) => {
      if (t.tipo === "salto") return "<br>";
      const texto = escaparHtml(t.texto);
      return t.negrita ? `<strong>${texto}</strong>` : texto;
    })
    .join("");
}

function celda(etiqueta: "th" | "td", texto: string, derecha: boolean): string {
  return derecha
    ? `<${etiqueta} class="num">${escaparHtml(texto)}</${etiqueta}>`
    : `<${etiqueta}>${escaparHtml(texto)}</${etiqueta}>`;
}

/**
 * HTML canónico de los bloques: siempre el mismo texto para los mismos
 * bloques (sin espacios variables ni atributos dinámicos), porque es lo que
 * se hashea al emitir. Todo texto va escapado.
 */
export function bloquesAHtml(bloques: readonly Bloque[]): string {
  const partes: string[] = [];
  for (const b of bloques) {
    switch (b.tipo) {
      case "titulo":
        partes.push(`<h${b.nivel}>${tramosAHtml(b.tramos)}</h${b.nivel}>`);
        break;
      case "parrafo":
        partes.push(`<p>${tramosAHtml(b.tramos)}</p>`);
        break;
      case "lista":
        partes.push(`<ul>${b.items.map((i) => `<li>${tramosAHtml(i)}</li>`).join("")}</ul>`);
        break;
      case "tabla": {
        const der = b.columnas.map((c) => c.alineacion === "derecha");
        const cabeza = `<thead><tr>${b.columnas.map((c, i) => celda("th", c.titulo, der[i])).join("")}</tr></thead>`;
        const destacadas = new Set(b.destacadas ?? []);
        const cuerpo = b.filas.length
          ? b.filas
              .map(
                (f, j) =>
                  `<tr${destacadas.has(j) ? ' class="seccion"' : ""}>${f.map((v, i) => celda("td", v, der[i])).join("")}</tr>`,
              )
              .join("")
          : `<tr><td colspan="${b.columnas.length}">${escaparHtml(b.vacia ?? "Sin datos.")}</td></tr>`;
        const pie = b.pie
          ? `<tfoot><tr>${b.pie.map((v, i) => celda("td", v, der[i])).join("")}</tr></tfoot>`
          : "";
        partes.push(`<table>${cabeza}<tbody>${cuerpo}</tbody>${pie}</table>`);
        break;
      }
      case "firma": {
        const lineas = [b.nombre, b.especialidad, b.registro].filter((l): l is string =>
          Boolean(l && l.trim()),
        );
        partes.push(
          `<div class="firma">${lineas.map((l) => `<p>${escaparHtml(l)}</p>`).join("")}</div>`,
        );
        break;
      }
    }
  }
  return partes.join("\n");
}

/** Texto plano de los bloques (para buscar, para tests y para el portapapeles). */
export function bloquesATexto(bloques: readonly Bloque[]): string {
  const deTramos = (tramos: readonly Tramo[]) =>
    tramos.map((t) => (t.tipo === "salto" ? "\n" : t.texto)).join("");
  return bloques
    .map((b) => {
      switch (b.tipo) {
        case "titulo":
        case "parrafo":
          return deTramos(b.tramos);
        case "lista":
          return b.items.map((i) => `- ${deTramos(i)}`).join("\n");
        case "tabla":
          return [b.columnas.map((c) => c.titulo), ...b.filas, ...(b.pie ? [b.pie] : [])]
            .map((f) => f.join(" | "))
            .join("\n");
        case "firma":
          return [b.nombre, b.especialidad, b.registro].filter(Boolean).join("\n");
      }
    })
    .join("\n\n");
}

/** Firma del profesional como bloque (la agrega la emisión). */
export function bloqueDeFirma(profesional: {
  nombre: string;
  registroSis: string | null;
  especialidad: string | null;
}): Extract<Bloque, { tipo: "firma" }> {
  const registro = profesional.registroSis?.trim();
  return {
    tipo: "firma",
    nombre: profesional.nombre.trim(),
    registro: registro ? `Registro Superintendencia de Salud N.º ${registro}` : null,
    especialidad: profesional.especialidad?.trim() || null,
  };
}

/** Folio legible: "N.º 2026-0007" (mismo formato que la receta). */
export function folioDocumento(year: number, number: number): string {
  return `N.º ${year}-${String(number).padStart(4, "0")}`;
}
