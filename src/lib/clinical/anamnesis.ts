/**
 * Anamnesis estructurada (hallazgo CLI-10, auditoría 360 del 18-oct-2026).
 *
 * Parte pura: el catálogo del cuestionario de riesgo, los schemas que valida
 * el servidor, cómo se concilian las alergias con su severidad y qué alertas
 * salen de todo eso. Sin red ni base: se prueba entero en
 * `tests/anamnesis-estructurada.test.ts`.
 *
 * Decisiones:
 * - `patient_medical_history.allergies` (text[]) sigue siendo la lista
 *   canónica de alergias: la leen la agenda, la exportación y la fusión de
 *   fichas. `allergy_details` solo le agrega severidad y reacción a cada
 *   nombre. Una alergia sin detalle es "sin especificar", nunca "leve".
 * - Pregunta sin responder = clave ausente. No se fabrica un "no" que nadie
 *   confirmó (regla 11 del CLAUDE.md).
 * - El catálogo se completó en la Ola 9 (FIC-09: antecedentes por grupo,
 *   ver `GRUPOS_ANTECEDENTES`). Profilaxis antibiótica y ASA siguen
 *   pendientes de un odontólogo revisor (CLI-22).
 */
import { z } from "zod";

// ── Alergias ──────────────────────────────────────────────────────────────

export const SEVERIDADES_ALERGIA = ["severe", "moderate", "mild", "unknown"] as const;
export type SeveridadAlergia = (typeof SEVERIDADES_ALERGIA)[number];

export const etiquetaSeveridad: Record<SeveridadAlergia, string> = {
  severe: "Grave",
  moderate: "Moderada",
  mild: "Leve",
  unknown: "Sin especificar",
};

export type AlergiaDetallada = {
  name: string;
  severity: SeveridadAlergia;
  reaction?: string;
};

export const alergiaSchema = z.object({
  name: z.string().trim().min(1).max(80),
  severity: z.enum(SEVERIDADES_ALERGIA),
  reaction: z.string().trim().max(160).optional(),
});

export const alergiasSchema = z.array(alergiaSchema).max(30);

function clave(nombre: string): string {
  return nombre.trim().toLocaleLowerCase("es");
}

/**
 * Lista final de alergias con severidad, en el orden de `nombres` (la lista
 * canónica). Toma la severidad guardada si existe un detalle con el mismo
 * nombre (sin distinguir mayúsculas) y, si no, "sin especificar". Los
 * detalles de alergias que ya no están en la lista se descartan, y un nombre
 * repetido sale una sola vez.
 */
export function conciliarAlergias(
  nombres: readonly string[],
  detalles: readonly AlergiaDetallada[],
): AlergiaDetallada[] {
  const porClave = new Map<string, AlergiaDetallada>();
  for (const d of detalles) {
    if (!porClave.has(clave(d.name))) porClave.set(clave(d.name), d);
  }
  const vistas = new Set<string>();
  const resultado: AlergiaDetallada[] = [];
  for (const bruto of nombres) {
    const nombre = bruto.trim();
    if (!nombre || vistas.has(clave(nombre))) continue;
    vistas.add(clave(nombre));
    const detalle = porClave.get(clave(nombre));
    resultado.push(
      detalle
        ? {
            name: nombre,
            severity: detalle.severity,
            ...(detalle.reaction ? { reaction: detalle.reaction } : {}),
          }
        : { name: nombre, severity: "unknown" },
    );
  }
  return resultado;
}

/** Nombres únicos, en orden, para la columna canónica `allergies`. */
export function nombresDeAlergias(detalles: readonly AlergiaDetallada[]): string[] {
  return conciliarAlergias(
    detalles.map((d) => d.name),
    detalles,
  ).map((d) => d.name);
}

/** Lee `allergy_details` de la base sin confiar en su forma (es jsonb). */
export function leerDetallesDeAlergias(valor: unknown): AlergiaDetallada[] {
  if (!Array.isArray(valor)) return [];
  const resultado: AlergiaDetallada[] = [];
  for (const item of valor) {
    const parsed = alergiaSchema.safeParse(item);
    if (parsed.success) resultado.push(parsed.data);
  }
  return resultado;
}

// ── Cuestionario de riesgo ────────────────────────────────────────────────

/**
 * FIC-09 (Ola 9): antecedentes completos. El cuestionario de riesgo pasa a
 * cubrir los antecedentes de una ficha odontológica completa, agrupados
 * como los lee el profesional: mórbidos, quirúrgicos, medicamentos, hábitos,
 * familiares, gineco-obstétricos y odontológicos. Alergias y medicación
 * crónica siguen en sus listas propias (columnas `allergies` y
 * `chronic_medications`), así que la agenda, la receta y la exportación no
 * cambian.
 *
 * Las respuestas se guardan en la misma columna `risk_questionnaire` (un
 * objeto JSON): sumar preguntas no necesita migración, y una ficha guardada
 * antes de este cambio se sigue leyendo igual (lo que no respondió queda
 * "sin responder", regla 11). El formulario antes de la cita (Ola 7) usa
 * este mismo catálogo, así que el paciente responde lo mismo que ve el
 * profesional.
 *
 * Críticas (alerta roja en la cabecera): solo anticoagulantes y embarazo,
 * como hasta ahora. Las nuevas (bifosfonatos, trastornos de coagulación,
 * radioterapia…) salen como precaución hasta que un odontólogo revisor
 * (CLI-22) decida cuáles suben a críticas.
 */
export const GRUPOS_ANTECEDENTES = [
  { key: "morbidos", label: "Antecedentes mórbidos" },
  { key: "quirurgicos", label: "Quirúrgicos" },
  { key: "medicamentos", label: "Medicamentos" },
  { key: "habitos", label: "Hábitos" },
  { key: "familiares", label: "Familiares" },
  { key: "gineco", label: "Embarazo y lactancia" },
  { key: "odontologicos", label: "Odontológicos" },
  { key: "otros", label: "Otros" },
] as const;

export type GrupoAntecedente = (typeof GRUPOS_ANTECEDENTES)[number]["key"];

export const PREGUNTAS_RIESGO = [
  // Mórbidos
  {
    key: "diabetes",
    grupo: "morbidos",
    label: "Diabetes",
    ayuda: "Tipo y si está controlada.",
    critica: false,
  },
  {
    key: "hypertension",
    grupo: "morbidos",
    label: "Hipertensión arterial",
    ayuda: undefined,
    critica: false,
  },
  {
    key: "heart_disease",
    grupo: "morbidos",
    label: "Cardiopatía",
    ayuda: "Infarto, arritmia, valvulopatía, marcapasos, endocarditis previa…",
    critica: false,
  },
  {
    key: "bleeding_disorder",
    grupo: "morbidos",
    label: "Trastorno de la coagulación o sangrado prolongado",
    ayuda: "Hemofilia, Von Willebrand, sangra mucho después de una extracción…",
    critica: false,
  },
  {
    key: "respiratory_disease",
    grupo: "morbidos",
    label: "Enfermedad respiratoria",
    ayuda: "Asma, EPOC, apnea del sueño…",
    critica: false,
  },
  {
    key: "kidney_disease",
    grupo: "morbidos",
    label: "Enfermedad renal",
    ayuda: "Insuficiencia renal, diálisis…",
    critica: false,
  },
  {
    key: "liver_disease",
    grupo: "morbidos",
    label: "Enfermedad hepática",
    ayuda: "Cirrosis, hígado graso…",
    critica: false,
  },
  {
    key: "thyroid_disease",
    grupo: "morbidos",
    label: "Enfermedad de la tiroides",
    ayuda: "Hipotiroidismo, hipertiroidismo…",
    critica: false,
  },
  {
    key: "neurological_disease",
    grupo: "morbidos",
    label: "Epilepsia u otra enfermedad neurológica",
    ayuda: "Convulsiones, ACV previo, Parkinson…",
    critica: false,
  },
  {
    key: "cancer",
    grupo: "morbidos",
    label: "Cáncer, radioterapia o quimioterapia",
    ayuda: "Dónde y cuándo; importa sobre todo la radioterapia de cabeza y cuello.",
    critica: false,
  },
  {
    key: "infectious_disease",
    grupo: "morbidos",
    label: "Enfermedad infecciosa",
    ayuda: "VIH, hepatitis B o C, tuberculosis…",
    critica: false,
  },
  // Quirúrgicos
  {
    key: "surgeries",
    grupo: "quirurgicos",
    label: "Cirugías u hospitalizaciones previas",
    ayuda: "Cuál y cuándo.",
    critica: false,
  },
  {
    key: "anesthesia_reaction",
    grupo: "quirurgicos",
    label: "Reacción previa a la anestesia",
    ayuda: "Desmayo, taquicardia, alergia a la anestesia local…",
    critica: false,
  },
  // Medicamentos (la medicación crónica va en su lista)
  {
    key: "anticoagulants",
    grupo: "medicamentos",
    label: "Anticoagulantes o antiagregantes",
    ayuda: "Warfarina, acenocumarol, apixabán, rivaroxabán, aspirina, clopidogrel…",
    critica: true,
  },
  {
    key: "bisphosphonates",
    grupo: "medicamentos",
    label: "Bifosfonatos o antirresortivos",
    ayuda: "Alendronato, ácido zoledrónico, denosumab… Desde cuándo y por qué vía.",
    critica: false,
  },
  {
    key: "immunosuppressants",
    grupo: "medicamentos",
    label: "Corticoides o inmunosupresores",
    ayuda: "Prednisona, metotrexato, tratamiento por trasplante…",
    critica: false,
  },
  // Hábitos
  { key: "tobacco", grupo: "habitos", label: "Tabaco", ayuda: "Cantidad por día.", critica: false },
  { key: "alcohol", grupo: "habitos", label: "Alcohol", ayuda: "Frecuencia.", critica: false },
  {
    key: "bruxism",
    grupo: "habitos",
    label: "Bruxismo o aprieta los dientes",
    ayuda: "De día, de noche, usa plano de relajación…",
    critica: false,
  },
  {
    key: "oral_habits",
    grupo: "habitos",
    label: "Se muerde las uñas, labios u objetos",
    ayuda: undefined,
    critica: false,
  },
  {
    key: "mouth_breathing",
    grupo: "habitos",
    label: "Respira por la boca",
    ayuda: undefined,
    critica: false,
  },
  // Familiares
  {
    key: "family_history",
    grupo: "familiares",
    label: "Antecedentes familiares relevantes",
    ayuda: "Diabetes, cardiopatía, cáncer, enfermedad de las encías… y quién.",
    critica: false,
  },
  // Gineco-obstétricos
  {
    key: "pregnancy",
    grupo: "gineco",
    label: "Embarazo",
    ayuda: "Semanas de gestación.",
    critica: true,
  },
  { key: "breastfeeding", grupo: "gineco", label: "Lactancia", ayuda: undefined, critica: false },
  // Odontológicos
  {
    key: "gum_bleeding",
    grupo: "odontologicos",
    label: "Le sangran las encías",
    ayuda: undefined,
    critica: false,
  },
  {
    key: "tmj_pain",
    grupo: "odontologicos",
    label: "Dolor o ruido en la mandíbula",
    ayuda: "Al abrir, al masticar, en la mañana…",
    critica: false,
  },
  {
    key: "previous_ortho",
    grupo: "odontologicos",
    label: "Tratamiento de ortodoncia previo",
    ayuda: "Cuándo y cuánto duró.",
    critica: false,
  },
  {
    key: "dental_anxiety",
    grupo: "odontologicos",
    label: "Miedo o ansiedad al dentista",
    ayuda: undefined,
    critica: false,
  },
  // Otros
  { key: "other", grupo: "otros", label: "Otros antecedentes", ayuda: undefined, critica: false },
] as const satisfies readonly {
  key: string;
  grupo: GrupoAntecedente;
  label: string;
  ayuda: string | undefined;
  critica: boolean;
}[];

export type PreguntaRiesgo = (typeof PREGUNTAS_RIESGO)[number];

/** Las preguntas en grupos, en el orden de `GRUPOS_ANTECEDENTES` (sin grupos vacíos). */
export function preguntasPorGrupo(): {
  key: GrupoAntecedente;
  label: string;
  preguntas: PreguntaRiesgo[];
}[] {
  return GRUPOS_ANTECEDENTES.map((g) => ({
    key: g.key,
    label: g.label,
    preguntas: PREGUNTAS_RIESGO.filter((p) => p.grupo === g.key),
  })).filter((g) => g.preguntas.length > 0);
}

export type ClavePregunta = (typeof PREGUNTAS_RIESGO)[number]["key"];
export const CLAVES_PREGUNTA = PREGUNTAS_RIESGO.map((p) => p.key) as [
  ClavePregunta,
  ...ClavePregunta[],
];

export type RespuestaRiesgo = { answer: "yes" | "no"; detail?: string };
/** Clave ausente = pregunta sin responder. */
export type CuestionarioRiesgo = Partial<Record<ClavePregunta, RespuestaRiesgo>>;

const respuestaSchema = z.object({
  answer: z.enum(["yes", "no"]),
  detail: z.string().trim().max(300).optional(),
});

export const cuestionarioSchema = z
  .record(z.enum(CLAVES_PREGUNTA), respuestaSchema)
  .transform((c) => limpiarCuestionario(c as CuestionarioRiesgo));

/** Saca detalles vacíos y deja solo claves conocidas. */
export function limpiarCuestionario(c: CuestionarioRiesgo): CuestionarioRiesgo {
  const limpio: CuestionarioRiesgo = {};
  for (const k of CLAVES_PREGUNTA) {
    const r = c[k];
    if (!r) continue;
    const detail = r.detail?.trim();
    limpio[k] = detail ? { answer: r.answer, detail } : { answer: r.answer };
  }
  return limpio;
}

/** Lee `risk_questionnaire` de la base; descarta claves o formas desconocidas. */
export function leerCuestionario(valor: unknown): CuestionarioRiesgo {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const resultado: CuestionarioRiesgo = {};
  for (const k of CLAVES_PREGUNTA) {
    const parsed = respuestaSchema.safeParse((valor as Record<string, unknown>)[k]);
    if (parsed.success) resultado[k] = parsed.data;
  }
  return limpiarCuestionario(resultado);
}

export function preguntasRespondidas(c: CuestionarioRiesgo): number {
  return CLAVES_PREGUNTA.filter((k) => c[k]).length;
}

// ── Cuestionario y antecedentes (UX-14) ───────────────────────────────────
//
// La ficha tenía "Hipertensión" en antecedentes y el cuestionario marcaba
// "0 de 10 respondidas", con "Hipertensión arterial" sin responder. Lo que
// ya está escrito en antecedentes (o en la medicación, para los
// anticoagulantes) se refleja en el cuestionario como "Sí, según
// antecedentes": se muestra y genera su alerta, pero no se guarda como
// respuesta hasta que alguien la confirme (regla 11: no se fabrica una
// respuesta que nadie dio). Una respuesta explícita siempre manda; si dice
// "No" y los antecedentes dicen lo contrario, se avisa la contradicción.

/** Minúsculas y sin tildes, para comparar texto libre. */
function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Palabras que, justo antes del término, lo niegan ("sin diabetes", "ex fumador"). */
const NEGACIONES = new Set(["no", "sin", "niega", "descarta", "ex"]);

type ReglaAntecedente = { key: ClavePregunta; terminos: readonly string[] };

/**
 * Términos (ya normalizados) que mapean un antecedente a una pregunta. Son
 * conservadores a propósito: mejor dejar una pregunta sin inferir que
 * inferir mal. Los fármacos solo cuentan para anticoagulantes, donde el
 * nombre del medicamento es inequívoco.
 */
const REGLAS_ANTECEDENTES: readonly ReglaAntecedente[] = [
  {
    key: "anticoagulants",
    terminos: ["anticoagulado", "anticoagulada", "anticoagulante", "antiagregante"],
  },
  { key: "diabetes", terminos: ["diabetes", "diabetico", "diabetica", "dm1", "dm2"] },
  {
    key: "hypertension",
    terminos: ["hipertension", "hipertenso", "hipertensa", "hta", "presion alta"],
  },
  {
    key: "heart_disease",
    terminos: [
      "cardiopatia",
      "infarto",
      "arritmia",
      "fibrilacion auricular",
      "marcapasos",
      "valvulopatia",
      "insuficiencia cardiaca",
      "endocarditis",
      "angina",
    ],
  },
  { key: "pregnancy", terminos: ["embarazo", "embarazada", "gestacion"] },
  { key: "breastfeeding", terminos: ["lactancia", "amamantando"] },
  {
    key: "infectious_disease",
    terminos: ["vih", "sida", "hepatitis", "tuberculosis", "tbc"],
  },
  { key: "tobacco", terminos: ["tabaquismo", "tabaco", "fumador", "fumadora", "fuma"] },
  {
    key: "surgeries",
    terminos: ["cirugia", "operado", "operada", "hospitalizacion", "hospitalizado"],
  },
  // FIC-09: los antecedentes nuevos.
  {
    key: "bleeding_disorder",
    terminos: ["hemofilia", "von willebrand", "coagulopatia", "trombocitopenia"],
  },
  { key: "respiratory_disease", terminos: ["asma", "asmatico", "asmatica", "epoc"] },
  {
    key: "kidney_disease",
    terminos: ["insuficiencia renal", "enfermedad renal", "dialisis", "nefropatia"],
  },
  { key: "liver_disease", terminos: ["cirrosis", "higado graso", "hepatopatia"] },
  {
    key: "thyroid_disease",
    terminos: ["hipotiroidismo", "hipertiroidismo", "tiroiditis"],
  },
  { key: "neurological_disease", terminos: ["epilepsia", "convulsiones", "parkinson", "acv"] },
  {
    key: "cancer",
    terminos: ["cancer", "radioterapia", "quimioterapia", "linfoma", "leucemia"],
  },
  { key: "bruxism", terminos: ["bruxismo", "bruxista"] },
];

/** Fármacos anticoagulantes o antiagregantes (nombre genérico o comercial común). */
const FARMACOS_ANTICOAGULANTES = [
  "warfarina",
  "acenocumarol",
  "sintrom",
  "apixaban",
  "eliquis",
  "rivaroxaban",
  "xarelto",
  "dabigatran",
  "pradaxa",
  "edoxaban",
  "heparina",
  "enoxaparina",
  "clopidogrel",
  "plavix",
  "ticagrelor",
  "prasugrel",
  "aspirina",
  "acido acetilsalicilico",
] as const;

/** Bifosfonatos y antirresortivos (FIC-09). */
const FARMACOS_ANTIRRESORTIVOS = [
  "alendronato",
  "risedronato",
  "ibandronato",
  "acido zoledronico",
  "zoledronato",
  "denosumab",
  "prolia",
  "fosamax",
] as const;

/** Corticoides sistémicos e inmunosupresores comunes (FIC-09). */
const FARMACOS_INMUNOSUPRESORES = [
  "prednisona",
  "prednisolona",
  "metilprednisolona",
  "dexametasona",
  "metotrexato",
  "tacrolimus",
  "ciclosporina",
  "micofenolato",
  "azatioprina",
] as const;

type Mencion = "afirmada" | "negada" | "ausente";

/**
 * ¿Aparece `termino` como palabra (o frase) en `texto`? "negada" si hay una
 * negación cerca antes ("sin diabetes", "no es fumador", "niega antecedentes
 * de hipertensión", "ex fumador").
 */
function mencion(texto: string, termino: string): Mencion {
  const palabras = texto.split(/[^a-z0-9]+/).filter(Boolean);
  const partes = termino.split(" ");
  let negada = false;
  for (let i = 0; i + partes.length <= palabras.length; i++) {
    if (!partes.every((p, j) => palabras[i + j] === p)) continue;
    const previas = palabras.slice(Math.max(0, i - 2), i);
    const lejanas = palabras.slice(Math.max(0, i - 4), i);
    if (
      previas.some((p) => NEGACIONES.has(p)) ||
      lejanas.some((p) => p === "sin" || p === "niega")
    ) {
      negada = true;
      continue;
    }
    return "afirmada";
  }
  return negada ? "negada" : "ausente";
}

/** De dónde sale cada respuesta inferida: los textos de antecedentes o medicación. */
export type RiesgosDesdeAntecedentes = Partial<Record<ClavePregunta, string[]>>;

/**
 * Qué preguntas del cuestionario ya quedan contestadas con "Sí" por lo que
 * dicen los antecedentes y la medicación. Un antecedente que no encaja en
 * ninguna pregunta cuenta para "Otros antecedentes".
 */
export function riesgosDesdeAntecedentes(datos: {
  antecedentes: readonly string[];
  medicacion: readonly string[];
}): RiesgosDesdeAntecedentes {
  const resultado: RiesgosDesdeAntecedentes = {};
  const sumar = (key: ClavePregunta, origen: string) => {
    const lista = resultado[key] ?? [];
    if (!lista.includes(origen)) lista.push(origen);
    resultado[key] = lista;
  };

  for (const bruto of datos.antecedentes) {
    const origen = bruto.trim();
    if (!origen) continue;
    const texto = normalizarTexto(origen);
    let encajo = false;
    let negado = false;
    for (const regla of REGLAS_ANTECEDENTES) {
      const menciones = regla.terminos.map((t) => mencion(texto, t));
      if (menciones.includes("afirmada")) {
        sumar(regla.key, origen);
        encajo = true;
      } else if (menciones.includes("negada")) {
        negado = true;
      }
    }
    // Un antecedente negado ("sin diabetes") no es un antecedente.
    if (!encajo && !negado) sumar("other", origen);
  }

  for (const bruto of datos.medicacion) {
    const origen = bruto.trim();
    if (!origen) continue;
    const texto = normalizarTexto(origen);
    if (FARMACOS_ANTICOAGULANTES.some((f) => mencion(texto, f) === "afirmada")) {
      sumar("anticoagulants", origen);
    }
    if (FARMACOS_ANTIRRESORTIVOS.some((f) => mencion(texto, f) === "afirmada")) {
      sumar("bisphosphonates", origen);
    }
    if (FARMACOS_INMUNOSUPRESORES.some((f) => mencion(texto, f) === "afirmada")) {
      sumar("immunosuppressants", origen);
    }
  }
  return resultado;
}

export type CuestionarioConciliado = {
  /** Respuestas guardadas + las inferidas de antecedentes donde no había respuesta. */
  efectivo: CuestionarioRiesgo;
  /** Preguntas que están en "Sí" solo por los antecedentes (sin confirmar). */
  desdeAntecedentes: ClavePregunta[];
  /** Respondidas "No" aunque los antecedentes dicen lo contrario. */
  contradicciones: ClavePregunta[];
};

/** Junta el cuestionario guardado con lo que se infiere de los antecedentes. */
export function conciliarCuestionario(
  cuestionario: CuestionarioRiesgo,
  inferidos: RiesgosDesdeAntecedentes,
): CuestionarioConciliado {
  const efectivo: CuestionarioRiesgo = { ...cuestionario };
  const desdeAntecedentes: ClavePregunta[] = [];
  const contradicciones: ClavePregunta[] = [];
  for (const k of CLAVES_PREGUNTA) {
    const origen = inferidos[k];
    if (!origen || origen.length === 0) continue;
    const guardada = cuestionario[k];
    if (!guardada) {
      efectivo[k] = { answer: "yes", detail: origen.join(", ") };
      desdeAntecedentes.push(k);
    } else if (guardada.answer === "no") {
      contradicciones.push(k);
    }
  }
  return { efectivo, desdeAntecedentes, contradicciones };
}

// ── Alertas ───────────────────────────────────────────────────────────────

export type NivelAlerta = "critica" | "precaucion";
export type AlertaClinica = {
  clave: string;
  nivel: NivelAlerta;
  /** Texto corto para la cabecera de la ficha. */
  texto: string;
};

function conDetalle(base: string, detalle?: string): string {
  return detalle ? `${base} (${detalle})` : base;
}

/**
 * Alertas de la anamnesis, primero las críticas. Críticas: alergias (todas,
 * porque una "sin especificar" puede ser grave), anticoagulantes y embarazo.
 * El resto de los "sí" del cuestionario son precauciones.
 */
export function alertasDeAnamnesis(datos: {
  alergias: readonly AlergiaDetallada[];
  cuestionario: CuestionarioRiesgo;
}): AlertaClinica[] {
  const criticas: AlertaClinica[] = [];
  const precauciones: AlertaClinica[] = [];

  if (datos.alergias.length > 0) {
    const ordenadas = [...datos.alergias].sort(
      (a, b) => SEVERIDADES_ALERGIA.indexOf(a.severity) - SEVERIDADES_ALERGIA.indexOf(b.severity),
    );
    criticas.push({
      clave: "allergies",
      nivel: "critica",
      texto: `Alergia: ${ordenadas
        .map((a) => (a.severity === "severe" ? `${a.name} (grave)` : a.name))
        .join(", ")}`,
    });
  }

  for (const p of PREGUNTAS_RIESGO) {
    const r = datos.cuestionario[p.key];
    if (r?.answer !== "yes") continue;
    const alerta: AlertaClinica = {
      clave: p.key,
      nivel: p.critica ? "critica" : "precaucion",
      texto: conDetalle(p.label, r.detail),
    };
    (p.critica ? criticas : precauciones).push(alerta);
  }
  return [...criticas, ...precauciones];
}

// ── Signos vitales ────────────────────────────────────────────────────────

/** Mismos rangos que los CHECK de `patient_vital_signs` (migración 20261019180000). */
export const RANGOS_SIGNOS = {
  systolic: { min: 50, max: 300 },
  diastolic: { min: 20, max: 200 },
  heartRate: { min: 20, max: 250 },
  temperature: { min: 30, max: 45 },
} as const;

export const signosVitalesSchema = z
  .object({
    systolicMmhg: z.number().int().min(RANGOS_SIGNOS.systolic.min).max(RANGOS_SIGNOS.systolic.max),
    diastolicMmhg: z
      .number()
      .int()
      .min(RANGOS_SIGNOS.diastolic.min)
      .max(RANGOS_SIGNOS.diastolic.max),
    heartRateBpm: z
      .number()
      .int()
      .min(RANGOS_SIGNOS.heartRate.min)
      .max(RANGOS_SIGNOS.heartRate.max),
    temperatureC: z
      .number()
      .min(RANGOS_SIGNOS.temperature.min)
      .max(RANGOS_SIGNOS.temperature.max)
      .transform((t) => Math.round(t * 10) / 10)
      .optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.systolicMmhg > v.diastolicMmhg, {
    message: "La presión sistólica tiene que ser mayor que la diastólica.",
    path: ["diastolicMmhg"],
  });

export type SignosVitalesInput = z.input<typeof signosVitalesSchema>;

/**
 * Convierte lo que se tipeó en el formulario (texto) en números. Devuelve
 * `null` en el campo que no es un número; la validación de rangos la hace el
 * schema. La temperatura acepta coma decimal ("36,5").
 */
export function leerSignosDelFormulario(campos: {
  sistolica: string;
  diastolica: string;
  pulso: string;
  temperatura: string;
}): {
  systolicMmhg: number | null;
  diastolicMmhg: number | null;
  heartRateBpm: number | null;
  temperatureC: number | null | undefined;
} {
  const entero = (s: string) => (/^\s*\d{1,3}\s*$/.test(s) ? Number(s.trim()) : null);
  const t = campos.temperatura.trim().replace(",", ".");
  return {
    systolicMmhg: entero(campos.sistolica),
    diastolicMmhg: entero(campos.diastolica),
    heartRateBpm: entero(campos.pulso),
    temperatureC: t === "" ? undefined : /^\d{2}(\.\d)?$/.test(t) ? Number(t) : null,
  };
}

export function formatearPresion(sistolica: number, diastolica: number): string {
  return `${sistolica}/${diastolica} mmHg`;
}

/** Ventana para asociar una medición a la cita del día (la atención en curso). */
export const VENTANA_CITA_MS = 6 * 60 * 60 * 1000;

/**
 * La cita del paciente más cercana a `ahora` dentro de la ventana, sin
 * contar las canceladas ni las ausentes: es la atención en la que se toman los
 * signos. `null` si no hay ninguna (una urgencia sin cita, por ejemplo).
 */
export function citaDeLaAtencion(
  citas: readonly { id: string; starts_at: string; status: string }[],
  ahora: Date,
  ventanaMs: number = VENTANA_CITA_MS,
): string | null {
  let mejor: { id: string; distancia: number } | null = null;
  for (const c of citas) {
    if (c.status === "cancelada" || c.status === "ausente") continue;
    const distancia = Math.abs(new Date(c.starts_at).getTime() - ahora.getTime());
    if (Number.isNaN(distancia) || distancia > ventanaMs) continue;
    if (!mejor || distancia < mejor.distancia) mejor = { id: c.id, distancia };
  }
  return mejor?.id ?? null;
}
