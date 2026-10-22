import type { SlugEspecialidad } from "@/lib/arancel/especialidades";

/**
 * Catálogo semilla de prestaciones dentales para Chile (ADM-03, Ola 3).
 *
 * Redactado por Esmalia, con nombres propios. NO es copia del arancel del
 * Colegio de Cirujano Dentistas ni del de ningún otro software: además de la
 * propiedad intelectual, un arancel de precios recomendado por un gremio ya
 * fue objeto de un requerimiento ante el TDLC. Por eso:
 *
 * - El rango de precio es una referencia orientativa amplia, en CLP, que la
 *   clínica ve al lado de su precio y puede editar o borrar. Nunca se impone
 *   ni se copia como precio sin que la clínica lo pida: por defecto la
 *   prestación importada entra sin precio (0) para que la clínica ponga el
 *   suyo; usar el piso del rango como punto de partida es una opción
 *   explícita del diálogo de importación.
 * - El código Fonasa y la marca MAI quedan vacíos en la semilla: la clínica
 *   los completa con su propia fuente (el arancel vigente de Fonasa). Un
 *   código inventado sería peor que ninguno.
 *
 * Importar es copiar (regla 10): la prestación queda en el arancel de la
 * clínica con `catalog_key` para saber de dónde vino, sin FK viva. Cambiar
 * este archivo no toca lo que una clínica ya importó.
 *
 * Las claves (`key`) no se cambian una vez publicadas: son lo que permite
 * saber qué ítems ya importó cada clínica.
 */

export interface ItemCatalogo {
  key: string;
  name: string;
  specialty: SlugEspecialidad;
  durationMin: number | null;
  /** Código Fonasa (MLE). Vacío en la semilla; ver arriba. */
  fonasaCode: string | null;
  /** Tiene equivalente en la Modalidad de Atención Institucional. */
  isMai: boolean;
  /** Rango orientativo en pesos chilenos [mín, máx]. null = sin referencia. */
  rangoClp: readonly [number, number] | null;
}

type Fila = [
  key: string,
  name: string,
  specialty: SlugEspecialidad,
  durationMin: number | null,
  rangoClp: readonly [number, number] | null,
];

// prettier-ignore
const FILAS: readonly Fila[] = [
  // Odontología general: diagnóstico, prevención y urgencia
  ["gen-primera-evaluacion", "Primera evaluación y plan de tratamiento", "general", 30, [10_000, 40_000]],
  ["gen-control", "Control clínico", "general", 20, [8_000, 30_000]],
  ["gen-urgencia", "Atención de urgencia", "general", 30, [20_000, 60_000]],
  ["gen-higiene", "Limpieza y pulido coronario", "general", 30, [20_000, 60_000]],
  ["gen-fluor", "Aplicación tópica de flúor", "general", 15, [8_000, 25_000]],
  ["gen-sellante", "Sellante de fosas y fisuras (por pieza)", "general", 15, [10_000, 30_000]],
  ["gen-instruccion-higiene", "Educación en higiene oral", "general", 20, [5_000, 20_000]],
  ["gen-certificado", "Informe o certificado odontológico", "general", 15, [5_000, 20_000]],
  // Operatoria
  ["ope-resina-1", "Restauración de resina, una cara", "operatoria", 30, [25_000, 60_000]],
  ["ope-resina-2", "Restauración de resina, dos caras", "operatoria", 45, [35_000, 75_000]],
  ["ope-resina-3", "Restauración de resina, tres caras o más", "operatoria", 60, [45_000, 95_000]],
  ["ope-vidrio-ionomero", "Restauración de vidrio ionómero", "operatoria", 30, [20_000, 50_000]],
  ["ope-provisoria", "Obturación provisoria", "operatoria", 15, [10_000, 25_000]],
  ["ope-reconstruccion", "Reconstrucción de pieza con perno de fibra", "operatoria", 60, [50_000, 120_000]],
  ["ope-incrustacion", "Incrustación de resina o cerámica", "operatoria", 60, [150_000, 350_000]],
  // Endodoncia
  ["end-anterior", "Tratamiento de conducto, pieza anterior", "endodoncia", 60, [90_000, 200_000]],
  ["end-premolar", "Tratamiento de conducto, premolar", "endodoncia", 75, [110_000, 240_000]],
  ["end-molar", "Tratamiento de conducto, molar", "endodoncia", 90, [150_000, 320_000]],
  ["end-retratamiento", "Retratamiento de conducto", "endodoncia", 90, [180_000, 380_000]],
  ["end-pulpotomia", "Pulpotomía", "endodoncia", 30, [30_000, 70_000]],
  ["end-urgencia", "Apertura y medicación de urgencia", "endodoncia", 30, [30_000, 70_000]],
  // Periodoncia
  ["per-diagnostico", "Evaluación periodontal con periodontograma", "periodoncia", 45, [20_000, 60_000]],
  ["per-destartraje", "Destartraje supragingival", "periodoncia", 30, [25_000, 60_000]],
  ["per-raspado-cuadrante", "Raspado y alisado radicular por cuadrante", "periodoncia", 45, [40_000, 110_000]],
  ["per-mantencion", "Mantención periodontal", "periodoncia", 45, [30_000, 80_000]],
  ["per-cirugia-colgajo", "Cirugía periodontal a colgajo por sextante", "periodoncia", 90, [150_000, 380_000]],
  ["per-gingivectomia", "Gingivectomía por sextante", "periodoncia", 60, [80_000, 200_000]],
  ["per-alargamiento", "Alargamiento coronario", "periodoncia", 60, [100_000, 250_000]],
  ["per-injerto-encia", "Injerto de encía", "periodoncia", 90, [200_000, 500_000]],
  // Ortodoncia
  ["ort-estudio", "Estudio de ortodoncia (modelos, fotos y análisis)", "ortodoncia", 45, [40_000, 120_000]],
  ["ort-instalacion-metalica", "Instalación de aparatología fija metálica (por arcada)", "ortodoncia", 60, [250_000, 700_000]],
  ["ort-instalacion-estetica", "Instalación de aparatología fija estética (por arcada)", "ortodoncia", 60, [350_000, 900_000]],
  ["ort-control", "Control mensual de ortodoncia", "ortodoncia", 30, [30_000, 70_000]],
  ["ort-retenedor", "Retenedor removible (por arcada)", "ortodoncia", 30, [60_000, 160_000]],
  ["ort-retencion-fija", "Retención fija lingual (por arcada)", "ortodoncia", 30, [60_000, 150_000]],
  ["ort-alineadores", "Tratamiento con alineadores transparentes", "ortodoncia", 45, [1_500_000, 4_500_000]],
  ["ort-ortopedia", "Aparato de ortopedia funcional", "ortodoncia", 45, [200_000, 550_000]],
  // Implantología
  ["imp-evaluacion", "Evaluación para implante con planificación", "implantologia", 45, [20_000, 80_000]],
  ["imp-instalacion", "Instalación de implante (fase quirúrgica)", "implantologia", 90, [450_000, 1_100_000]],
  ["imp-corona", "Corona sobre implante", "implantologia", 60, [400_000, 900_000]],
  ["imp-injerto-oseo", "Injerto óseo o de biomaterial", "implantologia", 60, [200_000, 600_000]],
  ["imp-elevacion-seno", "Elevación de seno maxilar", "implantologia", 120, [600_000, 1_500_000]],
  ["imp-sobredentadura", "Sobredentadura sobre implantes", "implantologia", 60, [1_200_000, 3_000_000]],
  // Odontopediatría
  ["ped-evaluacion", "Evaluación odontopediátrica", "odontopediatria", 30, [15_000, 45_000]],
  ["ped-restauracion", "Restauración en diente temporal", "odontopediatria", 30, [25_000, 55_000]],
  ["ped-pulpotomia", "Pulpotomía en diente temporal", "odontopediatria", 30, [35_000, 75_000]],
  ["ped-corona-acero", "Corona preformada de acero", "odontopediatria", 30, [40_000, 90_000]],
  ["ped-mantenedor", "Mantenedor de espacio", "odontopediatria", 30, [60_000, 150_000]],
  ["ped-exodoncia", "Extracción de diente temporal", "odontopediatria", 20, [20_000, 50_000]],
  // Rehabilitación oral
  ["reh-corona-metal-ceramica", "Corona metal-cerámica", "rehabilitacion", 60, [220_000, 450_000]],
  ["reh-corona-libre-metal", "Corona libre de metal (cerámica o zirconio)", "rehabilitacion", 60, [300_000, 650_000]],
  ["reh-corona-provisoria", "Corona provisoria", "rehabilitacion", 30, [30_000, 80_000]],
  ["reh-perno-colado", "Perno muñón colado", "rehabilitacion", 45, [70_000, 160_000]],
  ["reh-puente-pieza", "Puente fijo (por pieza)", "rehabilitacion", 60, [220_000, 500_000]],
  ["reh-protesis-acrilica", "Prótesis removible acrílica (por arcada)", "rehabilitacion", 45, [150_000, 400_000]],
  ["reh-protesis-metalica", "Prótesis removible de estructura metálica (por arcada)", "rehabilitacion", 45, [300_000, 700_000]],
  ["reh-protesis-total", "Prótesis total (por arcada)", "rehabilitacion", 45, [250_000, 600_000]],
  ["reh-rebasado", "Rebasado de prótesis", "rehabilitacion", 30, [40_000, 110_000]],
  ["reh-reparacion", "Reparación de prótesis", "rehabilitacion", 30, [25_000, 80_000]],
  ["reh-placa-bruxismo", "Placa de relajación para bruxismo", "rehabilitacion", 30, [100_000, 280_000]],
  // Cirugía
  ["cir-exodoncia-simple", "Extracción simple", "cirugia", 30, [30_000, 70_000]],
  ["cir-exodoncia-compleja", "Extracción compleja con colgajo", "cirugia", 45, [60_000, 140_000]],
  ["cir-tercer-molar", "Extracción de tercer molar incluido", "cirugia", 60, [120_000, 300_000]],
  ["cir-frenectomia", "Frenectomía", "cirugia", 30, [80_000, 200_000]],
  ["cir-biopsia", "Biopsia de tejido blando", "cirugia", 30, [60_000, 160_000]],
  ["cir-drenaje", "Drenaje de absceso", "cirugia", 30, [30_000, 80_000]],
  ["cir-regularizacion", "Regularización de reborde", "cirugia", 45, [80_000, 200_000]],
  // Estética
  ["est-blanqueamiento-clinica", "Blanqueamiento en clínica", "estetica", 60, [120_000, 350_000]],
  ["est-blanqueamiento-casa", "Blanqueamiento con cubetas para la casa", "estetica", 30, [90_000, 250_000]],
  ["est-carilla-resina", "Carilla de resina directa", "estetica", 60, [70_000, 180_000]],
  ["est-carilla-ceramica", "Carilla cerámica", "estetica", 60, [300_000, 700_000]],
  ["est-contorneado", "Contorneado estético", "estetica", 30, [30_000, 90_000]],
  // Radiología
  ["rad-periapical", "Radiografía periapical", "radiologia", 10, [5_000, 15_000]],
  ["rad-bite-wing", "Radiografía bite-wing", "radiologia", 10, [5_000, 15_000]],
  ["rad-panoramica", "Radiografía panorámica", "radiologia", 15, [15_000, 45_000]],
  ["rad-telerradiografia", "Telerradiografía de perfil", "radiologia", 15, [15_000, 45_000]],
  ["rad-cbct", "Tomografía de haz cónico (CBCT)", "radiologia", 20, [50_000, 150_000]],
  // Otra
  ["otr-anestesia-adicional", "Anestesia adicional", "otra", 10, [5_000, 20_000]],
  ["otr-sedacion", "Sedación consciente", "otra", 60, [80_000, 250_000]],
  ["otr-tto-sensibilidad", "Tratamiento de sensibilidad dentaria", "otra", 20, [15_000, 45_000]],
];

export const CATALOGO_CHILE: readonly ItemCatalogo[] = FILAS.map(
  ([key, name, specialty, durationMin, rangoClp]) => ({
    key,
    name,
    specialty,
    durationMin,
    fonasaCode: null,
    isMai: false,
    rangoClp,
  }),
);

const POR_CLAVE = new Map(CATALOGO_CHILE.map((i) => [i.key, i]));

export function itemDelCatalogo(key: string): ItemCatalogo | undefined {
  return POR_CLAVE.get(key);
}

/** Lo mínimo que hace falta saber del arancel actual para importar. */
export interface PrestacionExistente {
  name: string;
  catalogKey?: string | null;
}

/** Fila lista para insertar en `procedures` (sin clinic_id ni moneda). */
export interface FilaImportada {
  catalogKey: string;
  name: string;
  specialtySlug: SlugEspecialidad;
  durationMin: number | null;
  fonasaCode: string | null;
  isMai: boolean;
  defaultPriceCents: number;
  suggestedMinCents: number | null;
  suggestedMaxCents: number | null;
}

function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Decide qué ítems del catálogo se importan y cómo quedan en el arancel.
 *
 * - Claves desconocidas o repetidas se ignoran.
 * - Un ítem ya importado (misma `catalog_key`) o con el mismo nombre que una
 *   prestación existente se salta: importar nunca duplica ni pisa.
 * - El rango de referencia está en CLP: solo se copia si la clínica cobra en
 *   CLP. En otra moneda la prestación entra sin rango y con precio 0, para
 *   que la clínica ponga el suyo (nunca se convierte una moneda en otra).
 * - Precio inicial: 0 (la clínica pone el suyo), salvo que pida
 *   explícitamente partir del piso del rango (`precioInicial: "piso"`).
 */
export function prepararImportacion(
  claves: string[],
  existentes: PrestacionExistente[],
  moneda: string,
  precioInicial: "cero" | "piso" = "cero",
): { filas: FilaImportada[]; saltadas: string[] } {
  const yaImportadas = new Set(
    existentes.map((e) => e.catalogKey).filter((k): k is string => Boolean(k)),
  );
  const nombres = new Set(existentes.map((e) => normalizar(e.name)));
  const enClp = moneda.toUpperCase() === "CLP";
  const filas: FilaImportada[] = [];
  const saltadas: string[] = [];
  const vistas = new Set<string>();

  for (const key of claves) {
    if (vistas.has(key)) continue;
    vistas.add(key);
    const item = POR_CLAVE.get(key);
    if (!item) continue;
    if (yaImportadas.has(key) || nombres.has(normalizar(item.name))) {
      saltadas.push(item.name);
      continue;
    }
    nombres.add(normalizar(item.name));
    const rango = enClp ? item.rangoClp : null;
    filas.push({
      catalogKey: item.key,
      name: item.name,
      specialtySlug: item.specialty,
      durationMin: item.durationMin,
      fonasaCode: item.fonasaCode,
      isMai: item.isMai,
      // CLP no tiene subunidad: el peso es el cent (toCents con factor 1).
      defaultPriceCents: rango && precioInicial === "piso" ? rango[0] : 0,
      suggestedMinCents: rango ? rango[0] : null,
      suggestedMaxCents: rango ? rango[1] : null,
    });
  }
  return { filas, saltadas };
}

/**
 * Dónde cae un precio respecto de su rango de referencia. Solo informa: la
 * interfaz lo muestra como dato, no como alerta.
 */
export function posicionEnRango(
  precioCents: number,
  minCents: number | null | undefined,
  maxCents: number | null | undefined,
): "sin-rango" | "debajo" | "dentro" | "encima" {
  if (minCents == null && maxCents == null) return "sin-rango";
  if (minCents != null && precioCents < minCents) return "debajo";
  if (maxCents != null && precioCents > maxCents) return "encima";
  return "dentro";
}
