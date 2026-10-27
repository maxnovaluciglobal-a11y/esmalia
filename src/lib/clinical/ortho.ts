export const ORTHO_CASE_KINDS = ["brackets", "aligners"] as const;
export type OrthoCaseKind = (typeof ORTHO_CASE_KINDS)[number];

export const ORTHO_CASE_KIND_LABELS: Record<OrthoCaseKind, string> = {
  brackets: "Brackets",
  aligners: "Alineadores",
};

export const ORTHO_CASE_STATUSES = ["active", "on_hold", "completed", "cancelled"] as const;
export type OrthoCaseStatus = (typeof ORTHO_CASE_STATUSES)[number];

export const ORTHO_CASE_STATUS_LABELS: Record<OrthoCaseStatus, string> = {
  active: "Activo",
  on_hold: "En pausa",
  completed: "Finalizado",
  cancelled: "Cancelado",
};

export interface OrthoCase {
  id: string;
  patientId: string;
  patientName: string;
  professionalId: string | null;
  treatmentPlanId: string | null;
  kind: OrthoCaseKind;
  status: OrthoCaseStatus;
  startedOn: string;
  expectedEndOn: string | null;
  currency: string;
  /** `null` = sin cuota fija definida (no todos los casos cobran mensual). */
  monthlyFeeCents: number | null;
  notes: string | null;
  /** Fecha del último control registrado, o `null` si nunca tuvo uno. */
  lastControlOn: string | null;
}

/** Caso con su seguimiento de la Ola 9 (sistema, alineadores, etapa vigente). */
export type OrthoCaseConSeguimiento = OrthoCase & OrthoSeguimiento;

export interface OrthoControl {
  id: string;
  orthoCaseId: string;
  controlDate: string;
  attended: boolean;
  paymentId: string | null;
  notes: string | null;
}

/**
 * Un caso "sin control hace meses" es exactamente el que la auditoría
 * describe como el que "aparece solo, antes de convertirse en un caso
 * abandonado" (deck de SuperClini). 45 días es más laxo que un control
 * mensual estricto — dental suele correr controles cada 4-6 semanas.
 */
const DIAS_SIN_CONTROL_ALERTA = 45;

export function controlAtrasado(caso: OrthoCase, hoyIso: string): boolean {
  if (caso.status !== "active") return false;
  const referencia = caso.lastControlOn ?? caso.startedOn;
  const dias = Math.floor(
    (new Date(hoyIso).getTime() - new Date(referencia).getTime()) / (1000 * 60 * 60 * 24),
  );
  return dias >= DIAS_SIN_CONTROL_ALERTA;
}

// ─── Ola 9 · ORT-02 a ORT-06 ──────────────────────────────────────────────
// Valores iguales a los CHECK de 20261030300100_ortodoncia_seguimiento.sql.

/** ORT-02: sistema del aparato. Refina `kind` (brackets / alineadores). */
export const ORTHO_SYSTEMS = [
  "metalicos",
  "esteticos",
  "autoligado",
  "lingual",
  "alineadores",
] as const;
export type OrthoSystem = (typeof ORTHO_SYSTEMS)[number];

export const ORTHO_SYSTEM_LABELS: Record<OrthoSystem, string> = {
  metalicos: "Brackets metálicos",
  esteticos: "Brackets estéticos",
  autoligado: "Autoligado",
  lingual: "Lingual",
  alineadores: "Alineadores",
};

/** El tipo general que corresponde a cada sistema. */
export function kindDelSistema(sistema: OrthoSystem): OrthoCaseKind {
  return sistema === "alineadores" ? "aligners" : "brackets";
}

/** ORT-05: etapas, en el orden en que se recorren. */
export const ORTHO_STAGES = [
  "alineacion",
  "nivelacion",
  "cierre_espacios",
  "finalizacion",
  "contencion",
] as const;
export type OrthoStage = (typeof ORTHO_STAGES)[number];

export const ORTHO_STAGE_LABELS: Record<OrthoStage, string> = {
  alineacion: "Alineación",
  nivelacion: "Nivelación",
  cierre_espacios: "Cierre de espacios",
  finalizacion: "Finalización",
  contencion: "Contención",
};

export interface OrthoStageEvent {
  id: string;
  orthoCaseId: string;
  stage: OrthoStage;
  startedOn: string;
  notes: string | null;
  createdAt: string;
}

/** Datos de seguimiento que se suman al caso (ORT-02, ORT-03, ORT-05). */
export interface OrthoSeguimiento {
  system: OrthoSystem | null;
  alignerCurrent: number | null;
  alignerTotal: number | null;
  alignerChangeDays: number | null;
  /** Día en que empezó el alineador actual. */
  alignerChangedOn: string | null;
  /** Etapa vigente (la de `startedOn` más reciente), o `null` sin etapas. */
  stage: OrthoStage | null;
  stageSince: string | null;
}

/** Etapa vigente: la de `startedOn` más reciente; a igual día, la última cargada. */
export function etapaVigente(
  eventos: Pick<OrthoStageEvent, "stage" | "startedOn" | "createdAt">[],
): { stage: OrthoStage; startedOn: string } | null {
  let vigente: (typeof eventos)[number] | null = null;
  for (const e of eventos) {
    if (
      !vigente ||
      e.startedOn > vigente.startedOn ||
      (e.startedOn === vigente.startedOn && e.createdAt > vigente.createdAt)
    ) {
      vigente = e;
    }
  }
  return vigente ? { stage: vigente.stage, startedOn: vigente.startedOn } : null;
}

const MS_DIA = 86_400_000;

function diasEntreFechas(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / MS_DIA);
}

function sumarDiasIso(iso: string, n: number): string {
  const f = new Date(`${iso}T00:00:00Z`);
  f.setUTCDate(f.getUTCDate() + n);
  return f.toISOString().slice(0, 10);
}

/** Meses civiles completos entre dos fechas (14-ene → 13-mar = 1; → 14-mar = 2). */
export function mesesCompletos(desde: string, hasta: string): number {
  if (hasta < desde) return 0;
  const [ay, am, ad] = desde.split("-").map(Number);
  const [by, bm, bd] = hasta.split("-").map(Number);
  let meses = (by - ay) * 12 + (bm - am);
  if (bd < ad) meses -= 1;
  return Math.max(0, meses);
}

/**
 * ORT-03: próximo cambio de alineador (día en que empezó el actual + cada
 * cuántos días). `null` si falta alguno de los dos datos o ya va en el último.
 */
export function proximoCambioAlineador(
  s: Pick<
    OrthoSeguimiento,
    "alignerChangedOn" | "alignerChangeDays" | "alignerCurrent" | "alignerTotal"
  >,
): string | null {
  if (!s.alignerChangedOn || !s.alignerChangeDays) return null;
  if (s.alignerTotal !== null && s.alignerCurrent !== null && s.alignerCurrent >= s.alignerTotal) {
    return null;
  }
  return sumarDiasIso(s.alignerChangedOn, s.alignerChangeDays);
}

/** Días hasta el próximo cambio (negativo = atrasado), o `null`. */
export function diasParaCambio(proximo: string | null, hoy: string): number | null {
  return proximo ? diasEntreFechas(hoy, proximo) : null;
}

export type BaseProgreso = "alineadores" | "meses";

export interface ProgresoOrtodoncia {
  /** 0-100, entero; `null` = no hay con qué calcularlo (regla 11). */
  porcentaje: number | null;
  base: BaseProgreso | null;
  mesesTranscurridos: number;
  /** Duración estimada en meses (inicio → término estimado), o `null`. */
  mesesEstimados: number | null;
}

/**
 * ORT-04: progreso del tratamiento. Con alineadores y total cargado, cuenta
 * alineadores (es lo que el paciente ve avanzar); si no, el tiempo
 * transcurrido sobre la duración estimada. Sin término estimado no se
 * inventa un porcentaje. Un caso finalizado es 100 %.
 */
export function progresoOrtodoncia(
  caso: Pick<OrthoCase, "status" | "startedOn" | "expectedEndOn"> &
    Pick<OrthoSeguimiento, "alignerCurrent" | "alignerTotal">,
  hoy: string,
): ProgresoOrtodoncia {
  const mesesTranscurridos = mesesCompletos(caso.startedOn, hoy);
  const conTermino = caso.expectedEndOn !== null && caso.expectedEndOn > caso.startedOn;
  const mesesEstimados = conTermino
    ? Math.max(1, Math.round(diasEntreFechas(caso.startedOn, caso.expectedEndOn!) / 30.4375))
    : null;
  const acotar = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

  if (caso.status === "completed") {
    return { porcentaje: 100, base: null, mesesTranscurridos, mesesEstimados };
  }
  if (caso.alignerTotal && caso.alignerCurrent !== null) {
    return {
      porcentaje: acotar((caso.alignerCurrent / caso.alignerTotal) * 100),
      base: "alineadores",
      mesesTranscurridos,
      mesesEstimados,
    };
  }
  if (conTermino) {
    const total = diasEntreFechas(caso.startedOn, caso.expectedEndOn!);
    const hechos = diasEntreFechas(caso.startedOn, hoy);
    return {
      porcentaje: acotar((hechos / total) * 100),
      base: "meses",
      mesesTranscurridos,
      mesesEstimados,
    };
  }
  return { porcentaje: null, base: null, mesesTranscurridos, mesesEstimados };
}
