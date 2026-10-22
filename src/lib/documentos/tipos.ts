/**
 * Tipos del motor de plantillas y documentos (Ola 4 · DOC-01).
 *
 * Un solo motor para todo documento que Esmalia imprime con datos de la ficha:
 * certificados, informes, el formulario de reembolso y, en la tanda
 * siguiente, el PDF del presupuesto y la receta. El flujo es siempre el mismo:
 *
 *   plantilla (texto con {{variables}})
 *     → renderPlantilla(cuerpo, contexto)  → bloques (estructura neutra)
 *     → bloquesAHtml(bloques)              → HTML canónico (lo que se hashea)
 *     → descargarDocumentoPdf(...)          → PDF con jsPDF, en el navegador
 *
 * Los bloques son la única representación que se dibuja: la pantalla los
 * pinta con React (nunca con `innerHTML`), el PDF los recorre con jsPDF y el
 * HTML canónico sale de ellos con todo escapado. Así un texto de una
 * plantilla, o un valor de la ficha, nunca puede inyectar markup.
 */

/** Un trozo de texto dentro de un párrafo, un título o una lista. */
export type Tramo =
  | {
      tipo: "texto";
      texto: string;
      negrita?: boolean;
      /** Clave de la variable que produjo este texto (para resaltarla en la vista previa). */
      variable?: string;
      /** La variable no tenía valor: se imprime una línea para completar a mano. */
      faltante?: boolean;
      /** La plantilla nombra una variable que el motor no conoce. */
      desconocida?: boolean;
    }
  | { tipo: "salto" };

export type AlineacionColumna = "izquierda" | "derecha";

export interface ColumnaTabla {
  titulo: string;
  alineacion: AlineacionColumna;
  /** Ancho relativo en el PDF (opcional; sin peso, el criterio de siempre). */
  peso?: number;
}

export type Bloque =
  | { tipo: "titulo"; nivel: 1 | 2; tramos: Tramo[] }
  | { tipo: "parrafo"; tramos: Tramo[] }
  | { tipo: "lista"; items: Tramo[][] }
  | {
      tipo: "tabla";
      columnas: ColumnaTabla[];
      filas: string[][];
      /** Fila de totales (opcional), con la misma cantidad de celdas. */
      pie?: string[];
      /** Texto a mostrar si no hay filas. */
      vacia?: string;
      /**
       * Índices de filas que son encabezado de sección (el presupuesto agrupa
       * sus líneas por sección): se imprimen en negrita y con fondo.
       */
      destacadas?: number[];
    }
  | {
      /** Firma del profesional: la agrega el motor al emitir, no la plantilla. */
      tipo: "firma";
      nombre: string;
      /** "Registro Superintendencia de Salud N.º 12345", o null. */
      registro: string | null;
      especialidad: string | null;
    };

/** Tabla que el contexto entrega para una variable de bloque (p. ej. `{{reembolso.prestaciones}}`). */
export type TablaDeContexto = Extract<Bloque, { tipo: "tabla" }>;

/**
 * Lo que el motor necesita para resolver variables: texto ya formateado por
 * clave (`"paciente.nombre" → "Ana Pérez"`) y tablas para las variables de
 * bloque. `null` o "" = sin dato (se imprime una línea para completar).
 */
export interface ContextoDocumento {
  valores: Readonly<Record<string, string | null | undefined>>;
  tablas?: Readonly<Record<string, TablaDeContexto | undefined>>;
}

/** Resultado de renderizar una plantilla con un contexto. */
export interface DocumentoRenderizado {
  bloques: Bloque[];
  /** Variables que usa la plantilla, sin repetir, en orden de aparición. */
  variables: string[];
  /** Variables que el motor no conoce (la emisión las rechaza). */
  desconocidas: string[];
  /** Variables conocidas sin valor en el contexto. */
  faltantes: string[];
}

/** Clases de documento que siembra Esmalia o crea la clínica. */
export const TIPOS_DE_DOCUMENTO = [
  "certificado_atencion",
  "reposo",
  "derivacion",
  "alta",
  "informe",
  "consentimiento",
  "reembolso",
  // Ola 4 · PLA-08: la plantilla del PDF del presupuesto. No se emite desde
  // la ficha: se descarga o se envía desde el presupuesto.
  "presupuesto",
  // MKT-05 · receta: se emite desde la tarjeta Recetas, no desde "Emitir documento".
  "receta",
  "otro",
] as const;
export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

export const ETIQUETA_TIPO_DE_DOCUMENTO: Record<TipoDeDocumento, string> = {
  certificado_atencion: "Certificado de atención",
  reposo: "Certificado de reposo",
  derivacion: "Derivación o interconsulta",
  alta: "Alta odontológica",
  informe: "Informe odontológico",
  consentimiento: "Declaración o consentimiento",
  reembolso: "Reembolso de seguro complementario",
  presupuesto: "Presupuesto",
  receta: "Receta",
  otro: "Otro documento",
};

/**
 * Tipos con su propio flujo: no salen en "Emitir documento" de la ficha.
 * La receta se emite desde la tarjeta Recetas (MKT-05); el presupuesto se
 * descarga o se envía desde el presupuesto (PLA-08).
 */
export const TIPOS_CON_FLUJO_PROPIO: readonly TipoDeDocumento[] = ["presupuesto", "receta"];

export function esTipoDeDocumento(valor: unknown): valor is TipoDeDocumento {
  return typeof valor === "string" && (TIPOS_DE_DOCUMENTO as readonly string[]).includes(valor);
}
