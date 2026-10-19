export type NoteStatus = "draft" | "signed";

/**
 * Número de versión vigente de una nota a partir de su historial. NO es
 * siempre la de número más alto: un guardado offline en conflicto inserta
 * una versión nueva (regla #9 del repo, nada se pierde) sin actualizar el
 * contenido vigente de la nota — esa fila queda "huérfana" hasta que alguien
 * resuelve el conflicto (o para siempre si lo descarta). La vigente real es
 * la versión cuyo contenido coincide con el de la nota; si ninguna calza
 * (no debería pasar en datos sanos), se cae al número más alto como red de
 * seguridad.
 */
export function versionVigente(
  nota: { title: string; content: string },
  versionesDeLaNota: { version: number; title: string; content: string }[],
): number {
  const vigentes = versionesDeLaNota.filter(
    (v) => v.content === nota.content && v.title === nota.title,
  );
  const candidatas = vigentes.length ? vigentes : versionesDeLaNota;
  return candidatas.reduce((max, v) => Math.max(max, v.version), 0) || 1;
}

export type NoteAiAction = "draft" | "summary" | "polish";

export type NoteReviewStatus = "none" | "pending" | "approved" | "changes_requested";

export type NoteReviewAction =
  "requested" | "approved" | "changes_requested" | "comment" | "cancelled";

export interface ClinicalNote {
  id: string;
  patientRef: string;
  title: string;
  content: string;
  summary: string | null;
  status: NoteStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  reviewStatus: NoteReviewStatus;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewRequestedBy: string | null;
  reviewRequestedByName: string | null;
  reviewRequestedAt: string | null;
  reviewedAt: string | null;
  /** CLI-07: nota firmada que esta adenda corrige o completa. null = nota normal. */
  addendumOf: string | null;
  /** CLI-08: foto de la firma (quién, con qué registro, cuándo). null en borradores y en firmas anteriores al 19-oct-2026. */
  signedAt: string | null;
  signerName: string | null;
  signerLicense: string | null;
}

export interface ClinicalNoteReview {
  id: string;
  noteId: string;
  action: NoteReviewAction;
  comment: string | null;
  actorId: string;
  actorName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  /** Versión de la nota vigente cuando ocurrió la acción. */
  noteVersion: number | null;
  createdAt: string;
}

export const REVIEW_STATUS_LABELS: Record<NoteReviewStatus, string> = {
  none: "Sin revisión",
  pending: "Pendiente de aprobación",
  approved: "Aprobada",
  changes_requested: "Cambios solicitados",
};

export const REVIEW_ACTION_LABELS: Record<NoteReviewAction, string> = {
  requested: "Solicitó revisión",
  approved: "Aprobó la nota",
  changes_requested: "Solicitó cambios",
  comment: "Comentó en la revisión",
  cancelled: "Canceló la solicitud",
};

export interface ClinicalNoteVersion {
  id: string;
  noteId: string;
  version: number;
  title: string;
  content: string;
  summary: string | null;
  aiAssisted: boolean;
  aiAction: string | null;
  authorId: string;
  authorName: string | null;
  createdAt: string;
}

export interface ClinicalNoteAuditEntry {
  id: string;
  noteId: string | null;
  action: string;
  detail: string | null;
  actorId: string;
  actorName: string | null;
  createdAt: string;
}

export type ClinicalEntityKind = "diagnosis" | "treatment" | "medication" | "allergy";

export interface ClinicalNoteEntity {
  id: string;
  noteId: string;
  kind: ClinicalEntityKind;
  term: string;
  code: string | null;
  tooth: string | null;
  quantity: number | null;
  dosage: string | null;
  severity: string | null;
  status: string | null;
  notes: string | null;
  confidence: number | null;
  aiGenerated: boolean;
  confirmed: boolean;
  createdAt: string;
}

export const ENTITY_KIND_LABELS: Record<ClinicalEntityKind, string> = {
  diagnosis: "Diagnósticos",
  treatment: "Tratamientos",
  medication: "Medicamentos",
  allergy: "Alergias",
};

export const ENTITY_KIND_ORDER: ClinicalEntityKind[] = [
  "diagnosis",
  "treatment",
  "medication",
  "allergy",
];

export const AUDIT_LABELS: Record<string, string> = {
  create: "Creó la nota",
  update: "Guardó cambios",
  ai_draft: "Redactó con Patty (IA)",
  ai_summary: "Resumió con Patty (IA)",
  ai_polish: "Pulió la redacción con Patty (IA)",
  ai_structure: "Estructuró la nota con Patty (IA)",
  entity_confirm: "Confirmó un campo estructurado",
  entity_delete: "Eliminó un campo estructurado",
  restore: "Restauró una versión",
  revert: "Revirtió a una versión anterior",

  sign: "Firmó la nota",
  reopen: "Reabrió la nota",
  addendum: "Agregó una adenda",
  review_requested: "Solicitó revisión",
  review_approved: "Aprobó la nota en revisión",
  review_changes_requested: "Solicitó cambios en la revisión",
  review_comment: "Comentó en la revisión",
  review_cancelled: "Canceló la solicitud de revisión",
};

export const AI_ACTION_LABELS: Record<string, string> = {
  draft: "Borrador de Patty (IA)",
  summary: "Resumen de Patty (IA)",
  polish: "Pulida por Patty (IA)",
};

export function formatoFechaHora(iso: string) {
  return new Date(iso).toLocaleString("es-419", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Orden de la lista de notas (CLI-07): cada nota seguida de sus adendas, de
 * la más vieja a la más nueva, para que se lean como un solo registro. Las
 * notas se mantienen en el orden en que llegan (la consulta ya las trae por
 * última modificación). Una adenda cuya nota no vino (no debería pasar) se
 * muestra igual, al final, para no esconder nada.
 */
export function ordenarConAdendas<
  T extends { id: string; addendumOf: string | null; createdAt: string },
>(notas: T[]): T[] {
  const ids = new Set(notas.map((n) => n.id));
  const adendasDe = new Map<string, T[]>();
  const sueltas: T[] = [];
  for (const n of notas) {
    if (!n.addendumOf) continue;
    if (!ids.has(n.addendumOf)) {
      sueltas.push(n);
      continue;
    }
    adendasDe.set(n.addendumOf, [...(adendasDe.get(n.addendumOf) ?? []), n]);
  }
  const resultado: T[] = [];
  for (const n of notas) {
    if (n.addendumOf) continue;
    resultado.push(n);
    const propias = (adendasDe.get(n.id) ?? []).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    resultado.push(...propias);
  }
  return [...resultado, ...sueltas];
}

/**
 * Texto de la firma para la ficha y el PDF (CLI-08). Las notas firmadas
 * antes de que el registro fuera obligatorio no tienen foto del firmante: se
 * dice tal cual en vez de inventar un nombre (regla 11 del repo).
 */
export function lineaDeFirma(nota: {
  status: NoteStatus;
  signedAt: string | null;
  signerName: string | null;
  signerLicense: string | null;
}): string | null {
  if (nota.status !== "signed") return null;
  if (!nota.signerName || !nota.signerLicense) {
    return "Firmada (sin datos del firmante: firma anterior al registro profesional obligatorio)";
  }
  const fecha = nota.signedAt ? ` · ${formatoFechaHora(nota.signedAt)}` : "";
  return `Firmada por ${nota.signerName} · Registro profesional ${nota.signerLicense}${fecha}`;
}

/** Mismos límites que `registrar_mis_datos_de_firma` en la base. */
export function validarDatosDeFirma(datos: { nombre: string; registro: string }): string | null {
  const nombre = datos.nombre.trim();
  const registro = datos.registro.trim();
  if (nombre.length < 3 || nombre.length > 160)
    return "Escribe tu nombre completo, tal como figura en tu registro profesional.";
  if (registro.length < 2 || registro.length > 60)
    return "Escribe tu número de registro o colegiatura profesional.";
  return null;
}

/** Título por defecto de una adenda nueva. */
export function tituloDeAdenda(tituloOriginal: string): string {
  const base = tituloOriginal.trim() || "Nota clínica";
  return `Adenda: ${base}`.slice(0, 160);
}
