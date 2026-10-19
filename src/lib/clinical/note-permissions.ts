import type { ClinicRole } from "../access/access";

/** Estado combinado de una nota clínica (firma + flujo de revisión). */
export const NOTE_STATES = [
  "draft",
  "draft_changes_requested",
  "signed",
  "signed_pending",
  "signed_approved",
] as const;

export type NoteState = (typeof NOTE_STATES)[number];

export const NOTE_STATE_LABELS: Record<NoteState, string> = {
  draft: "Borrador",
  draft_changes_requested: "Borrador con cambios solicitados",
  signed: "Firmada",
  signed_pending: "Firmada en revisión",
  signed_approved: "Firmada y aprobada",
};

export const NOTE_ACTIONS = [
  "edit",
  "version",
  "sign",
  "addendum",
  "request_review",
  "resolve_review",
  "cancel_review",
  "export",
] as const;

export type NoteAction = (typeof NOTE_ACTIONS)[number];

export const NOTE_ACTION_LABELS: Record<NoteAction, string> = {
  edit: "Editar contenido",
  version: "Guardar versión / revertir",
  sign: "Firmar",
  addendum: "Agregar adenda",
  request_review: "Enviar a revisión",
  resolve_review: "Aprobar o pedir cambios",
  cancel_review: "Cancelar revisión",
  export: "Exportar PDF",
};

export type Verdict = "allow" | "deny" | "conditional";

export interface Resultado {
  verdict: Verdict;
  /** Condición o motivo que aplica la base de datos. */
  detalle: string;
}

const MANAGER: ClinicRole[] = ["owner", "admin"];
const CLINICO: ClinicRole[] = ["owner", "admin", "dentist", "assistant"];

const permitido = (detalle = "Permitido"): Resultado => ({ verdict: "allow", detalle });
const denegado = (detalle: string): Resultado => ({ verdict: "deny", detalle });
const condicional = (detalle: string): Resultado => ({ verdict: "conditional", detalle });

const esBorrador = (estado: NoteState) =>
  estado === "draft" || estado === "draft_changes_requested";
const enRevision = (estado: NoteState) => estado === "signed_pending";

/**
 * Evalúa una acción sobre una nota clínica según rol y estado.
 * Refleja las reglas que aplican los triggers `enforce_clinical_note_update`,
 * `enforce_note_review_insert` y `enforce_note_version_insert` en la base de datos.
 */
export function evaluarAccionNota(
  role: ClinicRole,
  estado: NoteState,
  accion: NoteAction,
): Resultado {
  const manager = MANAGER.includes(role);
  const clinico = CLINICO.includes(role);

  if (accion === "export") {
    return clinico || role === "reception"
      ? permitido("Cualquier integrante con acceso a la ficha puede exportar el PDF.")
      : denegado("Sin acceso a la historia clínica.");
  }

  if (!clinico) {
    return denegado("Este rol no participa en la historia clínica.");
  }

  switch (accion) {
    case "edit":
    case "version": {
      if (enRevision(estado))
        return denegado("La nota está en revisión: primero hay que resolverla.");
      if (!esBorrador(estado))
        return denegado("La nota está firmada: no se edita, se corrige con una adenda.");
      if (manager || role === "dentist")
        return permitido("Doctor/a y administración editan cualquier borrador.");
      return condicional("El asistente solo puede editar los borradores que creó.");
    }

    case "sign": {
      if (!esBorrador(estado)) return denegado("La nota ya está firmada.");
      if (role === "assistant") return denegado("El asistente no puede firmar notas clínicas.");
      return permitido("Doctor/a, propietario y administración pueden firmar.");
    }

    // CLI-07: una nota firmada no se reabre. Se le agrega una adenda (otra
    // nota vinculada, con su autor, su fecha y su propia firma).
    case "addendum": {
      if (esBorrador(estado))
        return denegado("Un borrador se edita directamente: la adenda es para notas firmadas.");
      if (manager || role === "dentist")
        return permitido("Doctor/a y administración agregan y firman adendas.");
      return condicional("El asistente redacta la adenda; la firma un doctor/a o administración.");
    }

    case "request_review": {
      if (esBorrador(estado)) return denegado("Solo se envía a revisión una nota firmada.");
      if (enRevision(estado)) return denegado("Ya existe una revisión pendiente.");
      if (role === "assistant")
        return condicional("Solo si es autor de la nota; el revisor debe ser otra persona.");
      return permitido("Debe elegir a otro doctor/a, administrador o propietario como revisor.");
    }

    case "resolve_review": {
      if (!enRevision(estado)) return denegado("No hay una revisión pendiente.");
      if (manager) return permitido("Administración puede resolver cualquier revisión.");
      return condicional("Solo si es el revisor asignado.");
    }

    case "cancel_review": {
      if (!enRevision(estado)) return denegado("No hay una revisión pendiente.");
      if (manager) return permitido("Administración puede cancelar cualquier revisión.");
      return condicional("Solo quien solicitó la revisión o el revisor asignado.");
    }

    default:
      return denegado("Acción no reconocida.");
  }
}
