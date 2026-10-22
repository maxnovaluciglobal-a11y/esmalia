/**
 * Grupo de variables `receta.*` del motor de documentos (MKT-05). Lógica
 * pura: la usan el catálogo de variables (`variables.ts`), la vista previa
 * del diálogo de receta y la emisión en el servidor.
 *
 *   {{receta.medicamentos}}           tabla: medicamento, dosis y vía,
 *                                     frecuencia, duración e indicaciones
 *   {{receta.indicaciones_generales}} texto, "—" si no hay
 *   {{receta.alergias}}               alergias anotadas en la anamnesis
 *
 * Solo tienen valor al emitir una receta (desde la tarjeta Recetas de la
 * ficha): en otro documento la tabla sale vacía.
 */
import { nombreConPresentacion } from "@/lib/clinical/recetas";
import { dosisConVia, type RecetaItemGuardado } from "@/lib/clinical/receta-estructurada";
import type { TablaDeContexto } from "@/lib/documentos/tipos";
import type { DefinicionVariable } from "@/lib/documentos/variables";

export const VARIABLES_RECETA: readonly DefinicionVariable[] = [
  {
    clave: "receta.medicamentos",
    grupo: "receta",
    etiqueta: "Tabla de medicamentos y posología",
    ejemplo: "(tabla)",
    bloque: true,
  },
  {
    clave: "receta.indicaciones_generales",
    grupo: "receta",
    etiqueta: "Indicaciones generales",
    ejemplo: "Dieta blanda y fría las primeras 24 horas.",
  },
  {
    clave: "receta.alergias",
    grupo: "receta",
    etiqueta: "Alergias registradas",
    ejemplo: "Penicilina",
  },
];

/** Lo que el contexto necesita de una receta para armar el documento. */
export interface DatosReceta {
  items: readonly Pick<
    RecetaItemGuardado,
    "medication" | "presentation" | "dose" | "frequency" | "duration" | "instructions" | "route"
  >[];
  indicacionesGenerales: string | null;
  /** Alergias de la anamnesis (de la ficha y de las fusionadas en ella). */
  alergias: readonly string[];
}

export const SIN_ALERGIAS_ANOTADAS = "Sin alergias anotadas en la ficha";
const SIN_INDICACIONES = "—";

/** Tabla `{{receta.medicamentos}}`. Los pesos dan más ancho al nombre y a las indicaciones. */
export function tablaDeReceta(items: DatosReceta["items"]): TablaDeContexto {
  return {
    tipo: "tabla",
    columnas: [
      { titulo: "Medicamento", alineacion: "izquierda", peso: 2.4 },
      { titulo: "Dosis y vía", alineacion: "izquierda", peso: 1.6 },
      { titulo: "Frecuencia", alineacion: "izquierda", peso: 1.2 },
      { titulo: "Duración", alineacion: "izquierda", peso: 1.1 },
      { titulo: "Indicaciones", alineacion: "izquierda", peso: 1.9 },
    ],
    filas: items.map((item) => [
      nombreConPresentacion(item),
      dosisConVia(item),
      item.frequency.trim(),
      item.duration.trim(),
      item.instructions?.trim() || SIN_INDICACIONES,
    ]),
    vacia: "Sin medicamentos.",
  };
}

/** Texto de las alergias: sin repetir (sin distinguir mayúsculas), en el orden de la ficha. */
export function textoDeAlergias(alergias: readonly string[]): string {
  const vistas = new Set<string>();
  const lista: string[] = [];
  for (const a of alergias) {
    const t = a.trim();
    const clave = t.toLocaleLowerCase("es");
    if (!t || vistas.has(clave)) continue;
    vistas.add(clave);
    lista.push(t);
  }
  return lista.length ? lista.join(", ") : SIN_ALERGIAS_ANOTADAS;
}

/** Valores y tabla del grupo `receta.*` para el contexto del motor. */
export function contextoDeReceta(datos: DatosReceta): {
  valores: Record<string, string>;
  tablas: Record<string, TablaDeContexto>;
} {
  return {
    valores: {
      "receta.indicaciones_generales": datos.indicacionesGenerales?.trim() || SIN_INDICACIONES,
      "receta.alergias": textoDeAlergias(datos.alergias),
    },
    tablas: { "receta.medicamentos": tablaDeReceta(datos.items) },
  };
}

/** Receta de ejemplo para la vista previa del editor de plantillas. */
export const RECETA_DE_EJEMPLO: DatosReceta = {
  items: [
    {
      medication: "Amoxicilina",
      presentation: "500 mg cápsulas",
      dose: "1 cápsula",
      route: "oral",
      frequency: "cada 8 horas",
      duration: "por 7 días",
      instructions: "Completar el tratamiento aunque el dolor pase antes.",
    },
    {
      medication: "Ibuprofeno",
      presentation: "400 mg comprimidos",
      dose: "1 comprimido",
      route: "oral",
      frequency: "cada 8 horas",
      duration: "por 3 días",
      instructions: "Tomar después de las comidas.",
    },
  ],
  indicacionesGenerales: "Dieta blanda y fría las primeras 24 horas.",
  alergias: ["Látex"],
};
