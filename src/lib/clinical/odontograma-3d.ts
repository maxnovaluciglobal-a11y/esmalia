/**
 * Lógica pura del odontograma 3D (ODO-10): dónde va cada pieza en la arcada,
 * qué cara de la corona es cada superficie y de qué color se pinta.
 *
 * No importa three.js: la escena (`src/components/odontograma-3d/escena.ts`)
 * entra en un chunk diferido y consume estas funciones; los tests las prueban
 * sin WebGL. Los colores y la regla de qué marca gana son los del odontograma
 * 2D (`odontograma-reglas.ts`), para que las dos vistas digan lo mismo.
 */
import {
  CONDITION_CATALOG,
  SURFACE_LABELS,
  toothCommonName,
  type OdontogramMark,
  type ToothCondition,
  type ToothSurface,
} from "@/lib/clinical/odontogram";
import {
  OPACIDAD_PLANIFICADO,
  hexDeMarca,
  marcaParaPintar,
  type Denticion,
} from "@/lib/clinical/odontograma-reglas";
import { describirMarca } from "@/lib/clinical/odontograma-texto";

export type CaraDeCorona = Exclude<ToothSurface, "whole">;
export type TipoDePieza = "incisivo" | "canino" | "premolar" | "molar";

export type Pintura = { color: string; opacidad: number; marca: OdontogramMark };

/** Mismas condiciones que tapan el esquema de cinco superficies en el 2D. */
export const CUBREN_CORONA: readonly ToothCondition[] = [
  "ausente",
  "implante",
  "corona",
  "protesis",
  "puente",
  "extraccion_indicada",
  "restos_radiculares",
];

/** Lo que deja el alvéolo sin corona natural: se dibuja como pieza fantasma. */
const SIN_CORONA: readonly ToothCondition[] = ["ausente", "extraccion_indicada"];

export function esTemporal(tooth: number): boolean {
  return Math.floor(tooth / 10) >= 5;
}

export function esSuperior(tooth: number): boolean {
  const c = Math.floor(tooth / 10);
  return c === 1 || c === 2 || c === 5 || c === 6;
}

/** Lado derecho DEL PACIENTE (cuadrantes 1, 4, 5, 8): a la izquierda de quien mira. */
export function esLadoDerecho(tooth: number): boolean {
  const c = Math.floor(tooth / 10);
  return c === 1 || c === 4 || c === 5 || c === 8;
}

export function tipoDePieza(tooth: number): TipoDePieza {
  const p = tooth % 10;
  if (esTemporal(tooth)) {
    if (p <= 2) return "incisivo";
    if (p === 3) return "canino";
    return "molar";
  }
  if (p <= 2) return "incisivo";
  if (p === 3) return "canino";
  if (p <= 5) return "premolar";
  return "molar";
}

/** Ancho mesiodistal relativo de la corona (molar = 1). */
const ANCHO: Record<TipoDePieza, number> = {
  incisivo: 0.72,
  canino: 0.78,
  premolar: 0.74,
  molar: 1,
};
/** Alto de la corona relativo (los anteriores son más altos que anchos). */
const ALTO: Record<TipoDePieza, number> = {
  incisivo: 1.05,
  canino: 1.15,
  premolar: 0.9,
  molar: 0.82,
};
/** Grosor vestíbulo-lingual relativo. */
const GROSOR: Record<TipoDePieza, number> = {
  incisivo: 0.55,
  canino: 0.72,
  premolar: 0.8,
  molar: 1,
};

export type Colocacion = {
  /** Centro de la corona (unidades de escena; Y es arriba, el paciente mira a +Z). */
  x: number;
  y: number;
  z: number;
  /** Giro sobre Y para que la cara vestibular (+Z local) mire hacia afuera de la arcada. */
  rotY: number;
  ancho: number;
  alto: number;
  grosor: number;
  tipo: TipoDePieza;
  superior: boolean;
};

const SEPARACION = 0.08;

/**
 * Ángulo de la elipse (x = a·sen t, z = b·cos t) en el que el arco recorrido
 * desde t = 0 (línea media) llega a `largo`. Integración simple: son a lo
 * sumo unos cientos de pasos por pieza.
 */
function anguloPorLargo(largo: number, a: number, b: number): number {
  const dt = 0.002;
  let t = 0;
  let recorrido = 0;
  while (recorrido < largo && t < Math.PI) {
    recorrido += Math.hypot(a * Math.cos(t), b * Math.sin(t)) * dt;
    t += dt;
  }
  return t;
}

/**
 * Coloca una pieza sobre la arcada: una elipse en el plano XZ, con los
 * incisivos centrales adelante (+Z) y los molares atrás. Cada pieza ocupa su
 * ancho relativo medido SOBRE la curva, así que no se pisan. Las temporales
 * (dentición mixta o temporal) van en una arcada interior más chica.
 */
export function colocarPieza(tooth: number): Colocacion {
  const temporal = esTemporal(tooth);
  const posicion = tooth % 10;
  const escala = temporal ? 0.72 : 1;
  const tipoDe = (p: number) => tipoDePieza(Math.floor(tooth / 10) * 10 + p);

  // Desde la línea media hasta el centro de esta pieza (medio espacio inicial
  // para que los dos centrales no se toquen en la línea media).
  let hastaEsta = SEPARACION / 2;
  for (let p = 1; p < posicion; p++) hastaEsta += ANCHO[tipoDe(p)] * escala + SEPARACION;
  hastaEsta += (ANCHO[tipoDe(posicion)] * escala) / 2;
  // Semiejes: ancho de la arcada (a) y profundidad (b). La temporal, adentro.
  const a = temporal ? 2.3 : 3.3;
  const b = temporal ? 2.6 : 3.8;
  const t = anguloPorLargo(hastaEsta, a, b);
  const lado = esLadoDerecho(tooth) ? -1 : 1;
  const x = lado * a * Math.sin(t);
  const z = b * Math.cos(t) - (temporal ? 0.35 : 0);
  // Normal hacia afuera de la elipse en ese punto.
  const nx = (lado * Math.sin(t)) / a;
  const nz = Math.cos(t) / b;
  const tipo = tipoDePieza(tooth);
  const superior = esSuperior(tooth);
  const alto = ALTO[tipo] * escala;
  return {
    x,
    y: (superior ? 1 : -1) * (0.62 + alto / 2),
    z,
    rotY: Math.atan2(nx, nz),
    ancho: ANCHO[tipo] * escala,
    alto,
    grosor: GROSOR[tipo] * escala,
    tipo,
    superior,
  };
}

/**
 * Qué superficie es cada cara de la corona, en el orden de los grupos de
 * BoxGeometry de three.js: [+X, −X, +Y, −Y, +Z, −Z] (ejes locales de la pieza).
 * +Z local mira hacia afuera (vestibular); +X local apunta a la línea media en
 * el lado derecho del paciente y hacia atrás en el izquierdo; la cara oclusal
 * mira al plano de oclusión (abajo en la arcada superior, arriba en la
 * inferior). La cara cervical (`null`) no es una superficie del odontograma.
 */
export function carasDeLaCorona(tooth: number): (CaraDeCorona | null)[] {
  const derecho = esLadoDerecho(tooth);
  const superior = esSuperior(tooth);
  return [
    derecho ? "mesial" : "distal", // +X
    derecho ? "distal" : "mesial", // −X
    superior ? null : "oclusal", // +Y
    superior ? "oclusal" : null, // −Y
    "vestibular", // +Z
    "lingual", // −Z
  ];
}

export type PinturaDePieza = {
  /** Una condición de pieza completa que tapa la corona (corona, implante…): pinta todo. */
  pieza: Pintura | null;
  /** Lo que gana en cada cara, con la misma regla que el 2D. */
  caras: Record<CaraDeCorona, Pintura | null>;
  /** Marca de pieza completa que no tapa la corona (endodoncia, fractura…): anillo cervical. */
  cuello: Pintura | null;
  /** Ausente o extracción indicada: la pieza se ve fantasma. */
  sinCorona: boolean;
  /** Hay algo distinto de sano registrado. */
  conHallazgos: boolean;
};

function pintar(m: OdontogramMark | undefined): Pintura | null {
  if (!m) return null;
  return {
    color: hexDeMarca(m),
    opacidad: m.status === "planificado" ? OPACIDAD_PLANIFICADO : 1,
    marca: m,
  };
}

/** Pintura de una pieza a partir de sus marcas vigentes (sin observaciones). */
export function pinturaDePieza(marcas: readonly OdontogramMark[]): PinturaDePieza {
  const reales = marcas.filter((m) => m.condition !== "sano" && m.condition !== "observacion");
  const deLaPieza = reales.filter((m) => m.surface === "whole");
  const tapa = marcaParaPintar(
    deLaPieza.filter((m) => m.status === "existente" && CUBREN_CORONA.includes(m.condition)),
  );
  const caras = {} as Record<CaraDeCorona, Pintura | null>;
  for (const cara of ["mesial", "distal", "oclusal", "vestibular", "lingual"] as const) {
    caras[cara] = pintar(marcaParaPintar(reales.filter((m) => m.surface === cara)));
  }
  const resto = deLaPieza.filter((m) => m !== tapa);
  return {
    pieza: pintar(tapa),
    caras,
    cuello: pintar(marcaParaPintar(resto)),
    sinCorona: Boolean(tapa && SIN_CORONA.includes(tapa.condition)),
    conHallazgos: reales.length > 0,
  };
}

/** Piezas que se muestran según la dentición, en el orden del 2D. */
export function piezasDeLaDenticion(filas: readonly { teeth: readonly number[] }[]): number[] {
  return filas.flatMap((f) => [...f.teeth]);
}

/** Texto de una pieza con hallazgos: "16 primer molar superior derecho: Caries en oclusal; Endodoncia". */
export function describirPieza(tooth: number, marcas: readonly OdontogramMark[]): string | null {
  const reales = marcas.filter((m) => m.condition !== "sano" && m.condition !== "observacion");
  if (reales.length === 0) return null;
  const partes = reales
    .slice()
    .sort((a, b) => a.surface.localeCompare(b.surface))
    .map((m) =>
      m.surface === "whole"
        ? describirMarca(m)
        : `${describirMarca(m)} en ${SURFACE_LABELS[m.surface].toLowerCase()}`,
    );
  const nombre = toothCommonName(tooth);
  return `${tooth}${nombre ? ` ${nombre}` : ""}: ${partes.join("; ")}`;
}

/**
 * Descripción textual de la vista 3D (alternativa accesible): cuántas piezas
 * se ven y qué tiene cada una con hallazgos. Las marcas se siguen haciendo en
 * el 2D; esto es lo mismo que el modelo muestra, dicho en palabras.
 */
export function describirVista3D(
  piezas: readonly number[],
  porPieza: ReadonlyMap<number, readonly OdontogramMark[]>,
  denticion: Denticion,
): { resumen: string; piezas: { tooth: number; texto: string }[] } {
  const conHallazgos = piezas
    .map((tooth) => ({ tooth, texto: describirPieza(tooth, porPieza.get(tooth) ?? []) }))
    .filter((p): p is { tooth: number; texto: string } => p.texto !== null);
  const ausentes = piezas.filter((t) =>
    (porPieza.get(t) ?? []).some(
      (m) => m.surface === "whole" && m.status === "existente" && m.condition === "ausente",
    ),
  ).length;
  const resumen =
    `Modelo 3D de la dentición ${denticion}: ${piezas.length} piezas. ` +
    (conHallazgos.length === 0
      ? "Ninguna tiene hallazgos registrados."
      : `${conHallazgos.length} con hallazgos registrados` +
        (ausentes ? `, ${ausentes} ${ausentes === 1 ? "ausente" : "ausentes"}` : "") +
        ".");
  return { resumen, piezas: conHallazgos };
}

/** Sigla corta para la etiqueta flotante de la pieza (la de la marca que se pinta). */
export function siglaDePieza(p: PinturaDePieza): string | null {
  const m = p.pieza?.marca ?? p.cuello?.marca;
  return m ? CONDITION_CATALOG[m.condition].sigla || null : null;
}
