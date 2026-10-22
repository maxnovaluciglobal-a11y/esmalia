/**
 * Vademécum odontológico (MKT-05): los medicamentos de uso dental frecuente
 * en Chile, con principio activo, presentación, concentración, vía y una
 * posología SUGERIDA que se copia al recetar y el profesional edita.
 *
 * Lo redactó Esmalia a partir de las dosis habituales de adulto de cada
 * principio activo; no copia ninguna fuente con derechos. Las dosis son una
 * ayuda para no escribir todo desde cero, no una indicación: la decide el
 * profesional para cada paciente (peso, edad, función renal y hepática,
 * embarazo, interacciones). Conviene una revisión clínica antes de darlo por
 * cerrado (docs/RECETA_FHIR.md, "Límites").
 *
 * En las presentaciones pediátricas la dosis va vacía a propósito: depende
 * del peso y la receta no se puede emitir sin escribirla.
 *
 * La clínica agrega los suyos en `clinic_medications` (mismo formato).
 * Lógica pura: sin red ni base.
 */

// ─── Familias (para el aviso de alergias) ───────────────────────────────────

export const GRUPOS_FARMACOLOGICOS = [
  "penicilinas",
  "cefalosporinas",
  "macrolidos",
  "lincosamidas",
  "nitroimidazoles",
  "aine",
  "analgesicos",
  "opioides",
  "corticoides",
  "antisepticos",
  "antifungicos",
  "antivirales",
  "anestesicos_locales",
  "fluoruros",
  "gastroprotectores",
] as const;
export type GrupoFarmacologico = (typeof GRUPOS_FARMACOLOGICOS)[number];

export const ETIQUETA_GRUPO_FARMACOLOGICO: Record<GrupoFarmacologico, string> = {
  penicilinas: "penicilinas",
  cefalosporinas: "cefalosporinas",
  macrolidos: "macrólidos",
  lincosamidas: "lincosamidas",
  nitroimidazoles: "nitroimidazoles",
  aine: "antiinflamatorios no esteroideos (AINE)",
  analgesicos: "analgésicos",
  opioides: "opioides",
  corticoides: "corticoides",
  antisepticos: "antisépticos",
  antifungicos: "antifúngicos",
  antivirales: "antivirales",
  anestesicos_locales: "anestésicos locales",
  fluoruros: "fluoruros",
  gastroprotectores: "gastroprotectores",
};

export function esGrupoFarmacologico(valor: unknown): valor is GrupoFarmacologico {
  return typeof valor === "string" && (GRUPOS_FARMACOLOGICOS as readonly string[]).includes(valor);
}

// ─── Vías de administración ─────────────────────────────────────────────────

export const VIAS = [
  "oral",
  "sublingual",
  "enjuague_bucal",
  "topica_bucal",
  "dental",
  "cutanea",
] as const;
export type ViaAdministracion = (typeof VIAS)[number];

/** Cómo se lee en la receta: "vía oral", "en enjuague bucal"… */
export const ETIQUETA_VIA: Record<ViaAdministracion, string> = {
  oral: "Oral",
  sublingual: "Sublingual",
  enjuague_bucal: "Enjuague bucal",
  topica_bucal: "Tópica en la boca",
  dental: "Sobre los dientes",
  cutanea: "Cutánea (piel o labios)",
};

/** Texto de la vía dentro de la posología: "vía oral". */
export const VIA_EN_POSOLOGIA: Record<ViaAdministracion, string> = {
  oral: "vía oral",
  sublingual: "vía sublingual",
  enjuague_bucal: "en enjuague bucal",
  topica_bucal: "sobre la mucosa de la boca",
  dental: "sobre los dientes",
  cutanea: "sobre la piel o los labios",
};

export function esVia(valor: unknown): valor is ViaAdministracion {
  return typeof valor === "string" && (VIAS as readonly string[]).includes(valor);
}

// ─── Catálogo ───────────────────────────────────────────────────────────────

export interface MedicamentoVademecum {
  /** "esmalia:amoxicilina-500-caps" (base) o "clinica:<uuid>" (de la clínica). */
  codigo: string;
  origen: "esmalia" | "clinica";
  principioActivo: string;
  concentracion: string | null;
  forma: string | null;
  grupo: GrupoFarmacologico | null;
  via: ViaAdministracion;
  /** Código ATC de la OMS (FHIR: Medication.code). */
  atc: string | null;
  /** Posología sugerida. "" = la decide el profesional (pediatría). */
  dosis: string;
  frecuencia: string;
  duracion: string;
  indicaciones: string | null;
}

type Semilla = Omit<MedicamentoVademecum, "codigo" | "origen" | "indicaciones"> & {
  id: string;
  indicaciones?: string;
};

const SEGUN_PESO = "Dosis según el peso del niño. Agitar antes de usar.";

const SEMILLAS: readonly Semilla[] = [
  // Antibióticos
  {
    id: "amoxicilina-500-caps",
    principioActivo: "Amoxicilina",
    concentracion: "500 mg",
    forma: "cápsulas",
    grupo: "penicilinas",
    via: "oral",
    atc: "J01CA04",
    dosis: "1 cápsula",
    frecuencia: "cada 8 horas",
    duracion: "por 7 días",
    indicaciones: "Completar el tratamiento aunque el dolor pase antes.",
  },
  {
    id: "amoxicilina-875-comp",
    principioActivo: "Amoxicilina",
    concentracion: "875 mg",
    forma: "comprimidos",
    grupo: "penicilinas",
    via: "oral",
    atc: "J01CA04",
    dosis: "1 comprimido",
    frecuencia: "cada 12 horas",
    duracion: "por 7 días",
    indicaciones: "Completar el tratamiento aunque el dolor pase antes.",
  },
  {
    id: "amoxicilina-250-susp",
    principioActivo: "Amoxicilina",
    concentracion: "250 mg/5 mL",
    forma: "suspensión oral",
    grupo: "penicilinas",
    via: "oral",
    atc: "J01CA04",
    dosis: "",
    frecuencia: "cada 8 horas",
    duracion: "por 7 días",
    indicaciones: SEGUN_PESO,
  },
  {
    id: "amoxicilina-clavulanico-875-comp",
    principioActivo: "Amoxicilina con ácido clavulánico",
    concentracion: "875/125 mg",
    forma: "comprimidos",
    grupo: "penicilinas",
    via: "oral",
    atc: "J01CR02",
    dosis: "1 comprimido",
    frecuencia: "cada 12 horas",
    duracion: "por 7 días",
    indicaciones: "Tomar al comienzo de una comida.",
  },
  {
    id: "amoxicilina-clavulanico-500-comp",
    principioActivo: "Amoxicilina con ácido clavulánico",
    concentracion: "500/125 mg",
    forma: "comprimidos",
    grupo: "penicilinas",
    via: "oral",
    atc: "J01CR02",
    dosis: "1 comprimido",
    frecuencia: "cada 8 horas",
    duracion: "por 7 días",
    indicaciones: "Tomar al comienzo de una comida.",
  },
  {
    id: "penicilina-v-1000000-comp",
    principioActivo: "Penicilina V (fenoximetilpenicilina)",
    concentracion: "1.000.000 UI",
    forma: "comprimidos",
    grupo: "penicilinas",
    via: "oral",
    atc: "J01CE02",
    dosis: "1 comprimido",
    frecuencia: "cada 6 horas",
    duracion: "por 7 días",
    indicaciones: "Tomar con el estómago vacío, una hora antes de las comidas.",
  },
  {
    id: "cefadroxilo-500-caps",
    principioActivo: "Cefadroxilo",
    concentracion: "500 mg",
    forma: "cápsulas",
    grupo: "cefalosporinas",
    via: "oral",
    atc: "J01DB05",
    dosis: "1 cápsula",
    frecuencia: "cada 12 horas",
    duracion: "por 7 días",
  },
  {
    id: "cefalexina-500-caps",
    principioActivo: "Cefalexina",
    concentracion: "500 mg",
    forma: "cápsulas",
    grupo: "cefalosporinas",
    via: "oral",
    atc: "J01DB01",
    dosis: "1 cápsula",
    frecuencia: "cada 6 horas",
    duracion: "por 7 días",
  },
  {
    id: "azitromicina-500-comp",
    principioActivo: "Azitromicina",
    concentracion: "500 mg",
    forma: "comprimidos",
    grupo: "macrolidos",
    via: "oral",
    atc: "J01FA10",
    dosis: "1 comprimido",
    frecuencia: "cada 24 horas",
    duracion: "por 3 días",
    indicaciones: "Tomar una hora antes o dos horas después de comer.",
  },
  {
    id: "claritromicina-500-comp",
    principioActivo: "Claritromicina",
    concentracion: "500 mg",
    forma: "comprimidos",
    grupo: "macrolidos",
    via: "oral",
    atc: "J01FA09",
    dosis: "1 comprimido",
    frecuencia: "cada 12 horas",
    duracion: "por 7 días",
  },
  {
    id: "clindamicina-300-caps",
    principioActivo: "Clindamicina",
    concentracion: "300 mg",
    forma: "cápsulas",
    grupo: "lincosamidas",
    via: "oral",
    atc: "J01FF01",
    dosis: "1 cápsula",
    frecuencia: "cada 8 horas",
    duracion: "por 7 días",
    indicaciones: "Tomar con un vaso de agua. Avisar si aparece diarrea.",
  },
  {
    id: "metronidazol-500-comp",
    principioActivo: "Metronidazol",
    concentracion: "500 mg",
    forma: "comprimidos",
    grupo: "nitroimidazoles",
    via: "oral",
    atc: "P01AB01",
    dosis: "1 comprimido",
    frecuencia: "cada 8 horas",
    duracion: "por 7 días",
    indicaciones: "No beber alcohol durante el tratamiento ni en los 3 días siguientes.",
  },
  // Antiinflamatorios no esteroideos
  {
    id: "ibuprofeno-400-comp",
    principioActivo: "Ibuprofeno",
    concentracion: "400 mg",
    forma: "comprimidos",
    grupo: "aine",
    via: "oral",
    atc: "M01AE01",
    dosis: "1 comprimido",
    frecuencia: "cada 8 horas",
    duracion: "por 3 días",
    indicaciones: "Tomar después de las comidas.",
  },
  {
    id: "ibuprofeno-600-comp",
    principioActivo: "Ibuprofeno",
    concentracion: "600 mg",
    forma: "comprimidos",
    grupo: "aine",
    via: "oral",
    atc: "M01AE01",
    dosis: "1 comprimido",
    frecuencia: "cada 8 horas",
    duracion: "por 3 días",
    indicaciones: "Tomar después de las comidas.",
  },
  {
    id: "ibuprofeno-100-susp",
    principioActivo: "Ibuprofeno",
    concentracion: "100 mg/5 mL",
    forma: "suspensión oral",
    grupo: "aine",
    via: "oral",
    atc: "M01AE01",
    dosis: "",
    frecuencia: "cada 8 horas",
    duracion: "por 3 días",
    indicaciones: SEGUN_PESO,
  },
  {
    id: "naproxeno-550-comp",
    principioActivo: "Naproxeno sódico",
    concentracion: "550 mg",
    forma: "comprimidos",
    grupo: "aine",
    via: "oral",
    atc: "M01AE02",
    dosis: "1 comprimido",
    frecuencia: "cada 12 horas",
    duracion: "por 3 días",
    indicaciones: "Tomar después de las comidas.",
  },
  {
    id: "ketoprofeno-100-comp",
    principioActivo: "Ketoprofeno",
    concentracion: "100 mg",
    forma: "comprimidos",
    grupo: "aine",
    via: "oral",
    atc: "M01AE03",
    dosis: "1 comprimido",
    frecuencia: "cada 12 horas",
    duracion: "por 3 días",
    indicaciones: "Tomar después de las comidas.",
  },
  {
    id: "diclofenaco-50-comp",
    principioActivo: "Diclofenaco sódico",
    concentracion: "50 mg",
    forma: "comprimidos",
    grupo: "aine",
    via: "oral",
    atc: "M01AB05",
    dosis: "1 comprimido",
    frecuencia: "cada 8 horas",
    duracion: "por 3 días",
    indicaciones: "Tomar después de las comidas.",
  },
  {
    id: "ketorolaco-10-comp",
    principioActivo: "Ketorolaco",
    concentracion: "10 mg",
    forma: "comprimidos",
    grupo: "aine",
    via: "oral",
    atc: "M01AB15",
    dosis: "1 comprimido",
    frecuencia: "cada 8 horas",
    duracion: "por 3 días",
    indicaciones: "Tomar después de las comidas. No usar más de 5 días seguidos.",
  },
  {
    id: "nimesulida-100-comp",
    principioActivo: "Nimesulida",
    concentracion: "100 mg",
    forma: "comprimidos",
    grupo: "aine",
    via: "oral",
    atc: "M01AX17",
    dosis: "1 comprimido",
    frecuencia: "cada 12 horas",
    duracion: "por 3 días",
    indicaciones: "Tomar después de las comidas.",
  },
  {
    id: "celecoxib-200-caps",
    principioActivo: "Celecoxib",
    concentracion: "200 mg",
    forma: "cápsulas",
    grupo: "aine",
    via: "oral",
    atc: "M01AH01",
    dosis: "1 cápsula",
    frecuencia: "cada 12 horas",
    duracion: "por 3 días",
  },
  // Analgésicos
  {
    id: "paracetamol-500-comp",
    principioActivo: "Paracetamol",
    concentracion: "500 mg",
    forma: "comprimidos",
    grupo: "analgesicos",
    via: "oral",
    atc: "N02BE01",
    dosis: "2 comprimidos",
    frecuencia: "cada 8 horas",
    duracion: "por 3 días",
    indicaciones: "No superar 4 g de paracetamol al día, contando otros remedios que lo tengan.",
  },
  {
    id: "paracetamol-1g-comp",
    principioActivo: "Paracetamol",
    concentracion: "1 g",
    forma: "comprimidos",
    grupo: "analgesicos",
    via: "oral",
    atc: "N02BE01",
    dosis: "1 comprimido",
    frecuencia: "cada 8 horas",
    duracion: "por 3 días",
    indicaciones: "No superar 4 g de paracetamol al día, contando otros remedios que lo tengan.",
  },
  {
    id: "paracetamol-100-gotas",
    principioActivo: "Paracetamol",
    concentracion: "100 mg/mL",
    forma: "gotas orales",
    grupo: "analgesicos",
    via: "oral",
    atc: "N02BE01",
    dosis: "",
    frecuencia: "cada 6 horas",
    duracion: "por 3 días",
    indicaciones: "Dosis según el peso del niño.",
  },
  {
    id: "metamizol-500-comp",
    principioActivo: "Metamizol sódico",
    concentracion: "500 mg",
    forma: "comprimidos",
    grupo: "analgesicos",
    via: "oral",
    atc: "N02BB02",
    dosis: "1 comprimido",
    frecuencia: "cada 8 horas",
    duracion: "por 3 días",
  },
  {
    id: "tramadol-50-caps",
    principioActivo: "Tramadol",
    concentracion: "50 mg",
    forma: "cápsulas",
    grupo: "opioides",
    via: "oral",
    atc: "N02AX02",
    dosis: "1 cápsula",
    frecuencia: "cada 8 horas",
    duracion: "por 3 días",
    indicaciones: "Puede dar sueño: no conducir ni beber alcohol mientras lo tomes.",
  },
  // Corticoides
  {
    id: "dexametasona-4-comp",
    principioActivo: "Dexametasona",
    concentracion: "4 mg",
    forma: "comprimidos",
    grupo: "corticoides",
    via: "oral",
    atc: "H02AB02",
    dosis: "1 comprimido",
    frecuencia: "cada 12 horas",
    duracion: "por 2 días",
    indicaciones: "Tomar con alimentos.",
  },
  {
    id: "prednisona-20-comp",
    principioActivo: "Prednisona",
    concentracion: "20 mg",
    forma: "comprimidos",
    grupo: "corticoides",
    via: "oral",
    atc: "H02AB07",
    dosis: "1 comprimido",
    frecuencia: "cada 24 horas",
    duracion: "por 3 días",
    indicaciones: "Tomar en la mañana, con el desayuno.",
  },
  // Antisépticos
  {
    id: "clorhexidina-012-colutorio",
    principioActivo: "Clorhexidina",
    concentracion: "0,12 %",
    forma: "colutorio",
    grupo: "antisepticos",
    via: "enjuague_bucal",
    atc: "A01AB03",
    dosis: "15 mL",
    frecuencia: "cada 12 horas",
    duracion: "por 7 días",
    indicaciones:
      "Enjuagar 30 segundos y escupir, sin tragar. No comer ni beber en los 30 minutos siguientes.",
  },
  {
    id: "clorhexidina-02-gel",
    principioActivo: "Clorhexidina",
    concentracion: "0,2 %",
    forma: "gel bucal",
    grupo: "antisepticos",
    via: "topica_bucal",
    atc: "A01AB03",
    dosis: "1 capa fina sobre la zona",
    frecuencia: "cada 12 horas",
    duracion: "por 7 días",
  },
  // Antifúngicos
  {
    id: "nistatina-100000-susp",
    principioActivo: "Nistatina",
    concentracion: "100.000 UI/mL",
    forma: "suspensión oral",
    grupo: "antifungicos",
    via: "oral",
    atc: "A07AA02",
    dosis: "5 mL",
    frecuencia: "cada 6 horas",
    duracion: "por 14 días",
    indicaciones: "Mantener en la boca un minuto antes de tragar.",
  },
  {
    id: "miconazol-2-gel",
    principioActivo: "Miconazol",
    concentracion: "2 %",
    forma: "gel oral",
    grupo: "antifungicos",
    via: "topica_bucal",
    atc: "A01AB09",
    dosis: "2,5 mL",
    frecuencia: "cada 6 horas",
    duracion: "por 7 días",
    indicaciones:
      "Mantener en la boca el mayor tiempo posible antes de tragar. Avisar si usas anticoagulantes.",
  },
  {
    id: "fluconazol-150-caps",
    principioActivo: "Fluconazol",
    concentracion: "150 mg",
    forma: "cápsulas",
    grupo: "antifungicos",
    via: "oral",
    atc: "J02AC01",
    dosis: "1 cápsula",
    frecuencia: "cada 24 horas",
    duracion: "por 7 días",
  },
  // Antivirales
  {
    id: "aciclovir-5-crema",
    principioActivo: "Aciclovir",
    concentracion: "5 %",
    forma: "crema",
    grupo: "antivirales",
    via: "cutanea",
    atc: "D06BB03",
    dosis: "1 capa fina sobre la lesión",
    frecuencia: "5 veces al día",
    duracion: "por 5 días",
    indicaciones: "Empezar apenas aparezca el hormigueo. Lavarse las manos después de aplicar.",
  },
  {
    id: "aciclovir-200-comp",
    principioActivo: "Aciclovir",
    concentracion: "200 mg",
    forma: "comprimidos",
    grupo: "antivirales",
    via: "oral",
    atc: "J05AB01",
    dosis: "1 comprimido",
    frecuencia: "5 veces al día",
    duracion: "por 5 días",
    indicaciones: "Repartir las tomas durante el día (cada 4 horas, sin la noche).",
  },
  // Anestésico local de uso en casa
  {
    id: "benzocaina-20-gel",
    principioActivo: "Benzocaína",
    concentracion: "20 %",
    forma: "gel bucal",
    grupo: "anestesicos_locales",
    via: "topica_bucal",
    atc: null,
    dosis: "1 porción pequeña sobre la zona",
    frecuencia: "hasta 4 veces al día",
    duracion: "por 2 días",
    indicaciones:
      "No usar en menores de 2 años. No comer hasta que pase el adormecimiento de la zona.",
  },
  // Fluoruros
  {
    id: "fluoruro-sodio-5000-pasta",
    principioActivo: "Fluoruro de sodio",
    concentracion: "5.000 ppm",
    forma: "pasta dental",
    grupo: "fluoruros",
    via: "dental",
    atc: "A01AA01",
    dosis: "1 porción del tamaño de una arveja",
    frecuencia: "1 vez al día",
    duracion: "por 3 meses",
    indicaciones:
      "Cepillar en la noche, escupir sin enjuagar y no comer ni beber en los 30 minutos siguientes. Solo mayores de 16 años.",
  },
  // Gastroprotección mientras dura un AINE
  {
    id: "omeprazol-20-caps",
    principioActivo: "Omeprazol",
    concentracion: "20 mg",
    forma: "cápsulas",
    grupo: "gastroprotectores",
    via: "oral",
    atc: "A02BC01",
    dosis: "1 cápsula",
    frecuencia: "cada 24 horas",
    duracion: "mientras dure el antiinflamatorio",
    indicaciones: "Tomar en ayunas, 30 minutos antes del desayuno.",
  },
];

export const PREFIJO_BASE = "esmalia:";
export const PREFIJO_CLINICA = "clinica:";

/** Vademécum base de Esmalia, igual para todas las clínicas. */
export const VADEMECUM_BASE: readonly MedicamentoVademecum[] = SEMILLAS.map(
  ({ id, indicaciones, ...resto }) => ({
    ...resto,
    codigo: `${PREFIJO_BASE}${id}`,
    origen: "esmalia" as const,
    indicaciones: indicaciones ?? null,
  }),
);

const BASE_POR_CODIGO = new Map(VADEMECUM_BASE.map((m) => [m.codigo, m]));

export function medicamentoBase(codigo: string | null | undefined): MedicamentoVademecum | null {
  return codigo ? (BASE_POR_CODIGO.get(codigo) ?? null) : null;
}

/** "500 mg cápsulas": lo que va en el campo "presentación" de la receta. */
export function presentacionDe(m: Pick<MedicamentoVademecum, "concentracion" | "forma">): string {
  return [m.concentracion?.trim(), m.forma?.trim()].filter(Boolean).join(" ");
}

/** "Amoxicilina 500 mg cápsulas" */
export function etiquetaMedicamento(
  m: Pick<MedicamentoVademecum, "principioActivo" | "concentracion" | "forma">,
): string {
  return [m.principioActivo.trim(), presentacionDe(m)].filter(Boolean).join(" ");
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Busca en el vademécum (base + clínica) para el autocompletado. Primero lo
 * que empieza con lo escrito, después lo que lo contiene; los de la clínica
 * van antes que los base con el mismo puntaje.
 */
export function buscarEnVademecum(
  lista: readonly MedicamentoVademecum[],
  termino: string,
  maximo = 8,
): MedicamentoVademecum[] {
  const t = normalizar(termino);
  if (!t) return [];
  const puntaje = (m: MedicamentoVademecum) => {
    const nombre = normalizar(etiquetaMedicamento(m));
    if (nombre.startsWith(t)) return 0;
    if (nombre.split(" ").some((p) => p.startsWith(t))) return 1;
    if (nombre.includes(t)) return 2;
    return null;
  };
  return lista
    .map((m) => ({ m, p: puntaje(m) }))
    .filter((x): x is { m: MedicamentoVademecum; p: number } => x.p !== null)
    .sort(
      (a, b) =>
        a.p - b.p ||
        (a.m.origen === b.m.origen ? 0 : a.m.origen === "clinica" ? -1 : 1) ||
        etiquetaMedicamento(a.m).localeCompare(etiquetaMedicamento(b.m), "es"),
    )
    .slice(0, maximo)
    .map((x) => x.m);
}
