import { z } from "zod";

/**
 * Recetas (CLI-13): lógica pura, sin red ni base. La usan el server fn
 * (validación), el diálogo de emisión (aviso de alergias) y el PDF.
 *
 * La receta electrónica oficial de cada país (CL, MX, AR…) queda fuera:
 * esto es la receta impresa con los datos del profesional y de la clínica.
 */

export const MAX_MEDICAMENTOS = 10;

export const RecetaItemSchema = z.object({
  medication: z.string().trim().min(2, "Indica el medicamento.").max(120),
  presentation: z.string().trim().max(120).optional().or(z.literal("")),
  dose: z.string().trim().min(1, "Indica la dosis.").max(120),
  frequency: z.string().trim().min(1, "Indica la frecuencia.").max(120),
  duration: z.string().trim().min(1, "Indica la duración.").max(120),
  instructions: z.string().trim().max(500).optional().or(z.literal("")),
});

export type RecetaItem = z.infer<typeof RecetaItemSchema>;

export const RecetaItemsSchema = z
  .array(RecetaItemSchema)
  .min(1, "Agrega al menos un medicamento.")
  .max(MAX_MEDICAMENTOS, `Una receta admite hasta ${MAX_MEDICAMENTOS} medicamentos.`);

/** Deja la fila como se guarda: sin vacíos opcionales, con los textos recortados. */
export function normalizarItem(item: RecetaItem): RecetaItem {
  const limpio: RecetaItem = {
    medication: item.medication.trim(),
    dose: item.dose.trim(),
    frequency: item.frequency.trim(),
    duration: item.duration.trim(),
  };
  const presentacion = item.presentation?.trim();
  const indicaciones = item.instructions?.trim();
  if (presentacion) limpio.presentation = presentacion;
  if (indicaciones) limpio.instructions = indicaciones;
  return limpio;
}

/** "Amoxicilina 500 mg cápsulas" */
export function nombreConPresentacion(item: Pick<RecetaItem, "medication" | "presentation">) {
  return [item.medication.trim(), item.presentation?.trim()].filter(Boolean).join(" ");
}

/** "1 cápsula, cada 8 horas, durante 7 días" */
export function lineaDePosologia(item: Pick<RecetaItem, "dose" | "frequency" | "duration">) {
  return [item.dose.trim(), item.frequency.trim(), item.duration.trim()].filter(Boolean).join(", ");
}

/** "N.º 2026-0042" — correlativo por clínica y año. */
export function folioReceta(year: number, number: number): string {
  return `N.º ${year}-${String(number).padStart(4, "0")}`;
}

/** Edad en años cumplidos a la fecha `hoy` (YYYY-MM-DD). null si no hay fecha. */
export function edadEnAnios(
  fechaNacimiento: string | null | undefined,
  hoy: string,
): number | null {
  if (!fechaNacimiento) return null;
  const [an, mn, dn] = fechaNacimiento.slice(0, 10).split("-").map(Number);
  const [ah, mh, dh] = hoy.slice(0, 10).split("-").map(Number);
  if ([an, mn, dn, ah, mh, dh].some((n) => !Number.isFinite(n))) return null;
  let edad = ah - an;
  if (mh < mn || (mh === mn && dh < dn)) edad -= 1;
  return edad >= 0 ? edad : null;
}

// ---------------------------------------------------------------
// Vademécum corto y aviso de alergias
// ---------------------------------------------------------------

export type GrupoFarmacologico =
  | "penicilinas"
  | "cefalosporinas"
  | "macrolidos"
  | "lincosamidas"
  | "nitroimidazoles"
  | "aine"
  | "analgesicos"
  | "corticoides"
  | "antisepticos"
  | "antifungicos";

const ETIQUETA_GRUPO: Record<GrupoFarmacologico, string> = {
  penicilinas: "penicilinas",
  cefalosporinas: "cefalosporinas",
  macrolidos: "macrólidos",
  lincosamidas: "lincosamidas",
  nitroimidazoles: "nitroimidazoles",
  aine: "antiinflamatorios no esteroideos (AINE)",
  analgesicos: "analgésicos",
  corticoides: "corticoides",
  antisepticos: "antisépticos",
  antifungicos: "antifúngicos",
};

/**
 * Sugerencias de nombre para el campo "medicamento" y grupo para el aviso de
 * alergias. No sugiere dosis a propósito: la dosis la decide el profesional
 * para cada paciente.
 */
export const VADEMECUM: readonly { nombre: string; grupo: GrupoFarmacologico }[] = [
  { nombre: "Amoxicilina", grupo: "penicilinas" },
  { nombre: "Amoxicilina con ácido clavulánico", grupo: "penicilinas" },
  { nombre: "Penicilina V", grupo: "penicilinas" },
  { nombre: "Cefadroxilo", grupo: "cefalosporinas" },
  { nombre: "Cefalexina", grupo: "cefalosporinas" },
  { nombre: "Azitromicina", grupo: "macrolidos" },
  { nombre: "Claritromicina", grupo: "macrolidos" },
  { nombre: "Clindamicina", grupo: "lincosamidas" },
  { nombre: "Metronidazol", grupo: "nitroimidazoles" },
  { nombre: "Ibuprofeno", grupo: "aine" },
  { nombre: "Naproxeno", grupo: "aine" },
  { nombre: "Ketoprofeno", grupo: "aine" },
  { nombre: "Diclofenaco", grupo: "aine" },
  { nombre: "Ketorolaco", grupo: "aine" },
  { nombre: "Nimesulida", grupo: "aine" },
  { nombre: "Ácido acetilsalicílico", grupo: "aine" },
  { nombre: "Paracetamol", grupo: "analgesicos" },
  { nombre: "Metamizol", grupo: "analgesicos" },
  { nombre: "Tramadol", grupo: "analgesicos" },
  { nombre: "Dexametasona", grupo: "corticoides" },
  { nombre: "Betametasona", grupo: "corticoides" },
  { nombre: "Clorhexidina 0,12 % colutorio", grupo: "antisepticos" },
  { nombre: "Nistatina", grupo: "antifungicos" },
  { nombre: "Fluconazol", grupo: "antifungicos" },
];

/** Palabras con las que se suele anotar una alergia a todo un grupo. */
const ALIAS_GRUPO: Record<GrupoFarmacologico, string[]> = {
  penicilinas: ["penicilina", "betalactamico", "amoxicilina", "ampicilina"],
  cefalosporinas: ["cefalosporina", "betalactamico"],
  macrolidos: ["macrolido", "eritromicina"],
  lincosamidas: ["lincosamida", "clindamicina", "lincomicina"],
  nitroimidazoles: ["metronidazol", "tinidazol"],
  aine: ["aine", "antiinflamatorio", "aspirina", "acido acetilsalicilico", "salicilato"],
  analgesicos: ["dipirona", "metamizol", "paracetamol", "acetaminofen", "tramadol"],
  corticoides: ["corticoide", "corticoesteroide"],
  antisepticos: ["clorhexidina"],
  antifungicos: ["azol", "nistatina"],
};

/** Grupos con reactividad cruzada conocida que conviene avisar. */
const CRUZADOS: Partial<Record<GrupoFarmacologico, GrupoFarmacologico[]>> = {
  penicilinas: ["cefalosporinas"],
  cefalosporinas: ["penicilinas"],
};

/** Minúsculas, sin tildes ni signos: "Ácido Acetil-salicílico" → "acido acetil salicilico". */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Palabras demasiado genéricas para identificar un medicamento por sí solas. */
const GENERICAS = new Set(["acido", "con", "colutorio", "comprimidos", "capsulas", "jarabe"]);

function palabrasSignificativas(texto: string): string[] {
  return normalizarTexto(texto)
    .split(" ")
    .filter((p) => p.length >= 5 && !GENERICAS.has(p));
}

/** Una palabra suelta calza como inicio de palabra ("aine" calza "aines", no "cocaina"). */
function contiene(texto: string, alias: string): boolean {
  if (alias.includes(" ")) return texto.includes(alias);
  return texto.split(" ").some((palabra) => palabra.startsWith(alias));
}

export function grupoDe(medicamento: string): GrupoFarmacologico | null {
  const m = normalizarTexto(medicamento);
  if (!m) return null;
  // El nombre más largo primero: "amoxicilina con acido clavulanico" antes que "amoxicilina".
  const ordenado = [...VADEMECUM].sort((a, b) => b.nombre.length - a.nombre.length);
  for (const v of ordenado) {
    const nombre = normalizarTexto(v.nombre);
    const base = palabrasSignificativas(v.nombre)[0];
    if (m.includes(nombre) || (base && m.split(" ").includes(base))) return v.grupo;
  }
  return null;
}

/**
 * Avisos para un medicamento contra las alergias anotadas en la anamnesis.
 * Es una ayuda, no un control: el texto libre de la anamnesis puede decir
 * cualquier cosa y el vademécum es corto. El profesional decide.
 */
export function alertasDeAlergia(medicamento: string, alergias: readonly string[]): string[] {
  const med = normalizarTexto(medicamento);
  if (!med) return [];
  const grupo = grupoDe(medicamento);
  const avisos: string[] = [];

  for (const alergiaOriginal of alergias) {
    const alergia = normalizarTexto(alergiaOriginal);
    if (!alergia) continue;
    if (palabrasSignificativas(med).some((p) => contiene(alergia, p))) {
      avisos.push(`El paciente tiene anotada alergia a "${alergiaOriginal.trim()}".`);
      continue;
    }
    if (grupo && ALIAS_GRUPO[grupo].some((alias) => contiene(alergia, alias))) {
      avisos.push(
        `Alergia anotada: "${alergiaOriginal.trim()}". Este medicamento es del grupo de las ${ETIQUETA_GRUPO[grupo]}.`,
      );
      continue;
    }
    const cruzado = grupo
      ? (CRUZADOS[grupo] ?? []).find((g) =>
          ALIAS_GRUPO[g].some((alias) => contiene(alergia, alias)),
        )
      : undefined;
    if (grupo && cruzado) {
      avisos.push(
        `Alergia anotada: "${alergiaOriginal.trim()}". Puede haber reacción cruzada entre ${ETIQUETA_GRUPO[cruzado]} y ${ETIQUETA_GRUPO[grupo]}.`,
      );
    }
  }
  return avisos;
}

// ---------------------------------------------------------------
// Contenido imprimible
// ---------------------------------------------------------------

export type RecetaEmitida = {
  id: string;
  year: number;
  number: number;
  issuedAt: string;
  professionalName: string;
  professionalLicense: string;
  professionalSpecialty: string | null;
  clinicName: string;
  clinicLegalName: string | null;
  clinicTaxId: string | null;
  clinicAddress: string | null;
  clinicPhone: string | null;
  patientName: string;
  patientBirthDate: string | null;
  items: RecetaItem[];
  instructions: string | null;
  contentSha256: string;
  voidedAt: string | null;
  voidReason: string | null;
};

/**
 * Lo que va impreso, en orden, separado del dibujo en PDF para poder
 * probarlo sin jsPDF. `fecha` llega ya formateada en la zona de la clínica.
 */
export function contenidoReceta(
  receta: RecetaEmitida,
  opciones: { fecha: string; edad: number | null; documentoPaciente?: string | null },
) {
  const encabezado = [
    receta.clinicLegalName && receta.clinicLegalName !== receta.clinicName
      ? `${receta.clinicName} · ${receta.clinicLegalName}`
      : receta.clinicName,
    receta.clinicTaxId ? `ID tributario: ${receta.clinicTaxId}` : null,
    [receta.clinicAddress, receta.clinicPhone ? `Tel. ${receta.clinicPhone}` : null]
      .filter(Boolean)
      .join(" · ") || null,
  ].filter((l): l is string => Boolean(l));

  const paciente = [
    `Paciente: ${receta.patientName}`,
    [
      opciones.documentoPaciente ? `Documento: ${opciones.documentoPaciente}` : null,
      opciones.edad !== null ? `Edad: ${opciones.edad} años` : null,
      `Fecha: ${opciones.fecha}`,
    ]
      .filter(Boolean)
      .join(" · "),
  ];

  const medicamentos = receta.items.map((item, i) => ({
    titulo: `${i + 1}. ${nombreConPresentacion(item)}`,
    posologia: lineaDePosologia(item),
    indicaciones: item.instructions?.trim() || null,
  }));

  const profesional = [
    receta.professionalName,
    receta.professionalSpecialty,
    `Registro profesional: ${receta.professionalLicense}`,
  ].filter((l): l is string => Boolean(l));

  return {
    titulo: `Receta ${folioReceta(receta.year, receta.number)}`,
    encabezado,
    paciente,
    medicamentos,
    indicacionesGenerales: receta.instructions?.trim() || null,
    profesional,
    anulada: receta.voidedAt ? `ANULADA${receta.voidReason ? `: ${receta.voidReason}` : ""}` : null,
    pie: `Código de verificación: ${receta.contentSha256.slice(0, 16)}`,
  };
}
