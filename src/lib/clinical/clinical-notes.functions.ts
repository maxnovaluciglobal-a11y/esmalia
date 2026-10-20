import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { filaYaCreada } from "@/lib/idempotency";
import { mensajeDb } from "@/lib/db-errors";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";
import { cargarFusiones, fichasAbsorbidas } from "@/lib/patients/fusion";
import { createNotification } from "@/lib/messaging/notifications.functions";
import type { Database } from "@/integrations/supabase/types";

type SupabaseCtx = SupabaseClient<Database>;
import { versionVigenteSegunCoincidencia } from "@/lib/clinical/clinical-notes";
import { leerTodasLasPaginas } from "@/lib/paginacion";
import { PROMPTS_NOTA, PROMPT_ENTIDADES, SYSTEM_BASE } from "@/lib/ai/prompts";
import type {
  ClinicalEntityKind,
  ClinicalNote,
  ClinicalNoteAuditEntry,
  ClinicalNoteEntity,
  ClinicalNoteReview,
  ClinicalNoteVersion,
  ClinicalNoteVersionMeta,
  NoteReviewAction,
  NoteReviewStatus,
  NoteStatus,
} from "@/lib/clinical/clinical-notes";
import {
  requireEscritura,
  requireEscrituraDeNotaClinica,
  requireEscrituraPorFila,
} from "@/lib/solo-lectura.middleware";

/** Devuelve el mensaje de la base de datos (reglas de permisos) o un texto por defecto. */
const clinicPatient = z.object({
  clinicId: z.string().uuid(),
  patientRef: z.string().min(1).max(64),
});

async function nombresPorUsuario(
  supabase: SupabaseCtx,
  ids: string[],
): Promise<Map<string, string | null>> {
  const unicos = [...new Set(ids)].filter(Boolean);
  if (!unicos.length) return new Map();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", unicos);
  return new Map(
    ((data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
      (p) => [p.id, p.full_name ?? p.email],
    ),
  );
}

/** Notas, versiones y auditoría de un paciente dentro de la clínica activa. */
export const getPatientNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => clinicPatient.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      notes: ClinicalNote[];
      versions: ClinicalNoteVersionMeta[];
      audit: ClinicalNoteAuditEntry[];
      entities: ClinicalNoteEntity[];
      reviews: ClinicalNoteReview[];
    }> => {
      const { supabase } = context;
      // SEG-02: en paralelo con la carga; se espera antes de responder.
      // patientRef es el id del paciente; si no lo es, no hay ficha que anotar.
      const lectura = z.string().uuid().safeParse(data.patientRef).success
        ? registrarLecturaDeFicha(supabase, {
            clinicId: data.clinicId,
            patientId: data.patientRef,
            seccion: "notas",
          })
        : Promise.resolve();

      // CLI-06: las notas de una ficha fusionada en esta se quedan con su
      // `patient_ref` original (una nota firmada no se reescribe), así que
      // se leen junto con las propias.
      const fusiones = await cargarFusiones(supabase, data.clinicId);
      const refs = [data.patientRef, ...fichasAbsorbidas(data.patientRef, fusiones)];

      // security-review 01-sep: clinical_note_versions no tiene columna
      // patient_ref (solo note_id) — antes se traía TODA la tabla de la
      // clínica (todos los pacientes) y se filtraba acá en JS con noteIds.
      // Costoso (escaneo completo en cada visita a la ficha, es la tabla de
      // mayor tráfico de la app) y frágil: la única barrera contra que un
      // paciente vea versiones de notas de otro era este filtro en memoria,
      // no una policy de RLS a nivel de paciente. Ahora: notes primero, y
      // versions solo por los note_id que ya sabemos que son de este
      // paciente — mismo patrón .in()+Map que ya pide CLAUDE.md.
      const [notesRes, auditRes, entitiesRes, reviewsRes] = await Promise.all([
        supabase
          .from("clinical_notes")
          .select("*")
          .eq("clinic_id", data.clinicId)
          .in("patient_ref", refs)
          .order("updated_at", { ascending: false }),
        supabase
          .from("clinical_note_audit")
          .select("*")
          .eq("clinic_id", data.clinicId)
          .in("patient_ref", refs)
          .order("created_at", { ascending: false })
          .limit(40),
        supabase
          .from("clinical_note_entities")
          .select("*")
          .eq("clinic_id", data.clinicId)
          .in("patient_ref", refs)
          .order("created_at", { ascending: false }),
        supabase
          .from("clinical_note_reviews")
          .select("*")
          .eq("clinic_id", data.clinicId)
          .in("patient_ref", refs)
          .order("created_at", { ascending: false })
          .limit(60),
      ]);

      if (notesRes.error)
        throw new Error(
          mensajeDb(notesRes.error, "No pudimos cargar las notas clínicas de este paciente."),
        );

      const notes = notesRes.data ?? [];
      const noteIds = notes.map((n) => n.id);
      // Auditoría de rendimiento (20-oct-2026): antes `select("*")` de todas
      // las versiones de todas las notas del paciente, contenido completo
      // incluido, en cada visita a la ficha, y con los ids en un `.in()` de
      // la URL. Ahora la RPC `clinical_note_versions_meta` (SECURITY INVOKER,
      // misma RLS) devuelve solo metadatos + un extracto, recibe los ids en
      // el cuerpo del POST y ya compara cada versión con la nota para saber
      // cuál es la vigente. El contenido se pide al abrir el comparador.
      const versionsRes = noteIds.length
        ? await leerTodasLasPaginas((desde, hasta) =>
            supabase
              .rpc("clinical_note_versions_meta", {
                p_clinic_id: data.clinicId,
                p_note_ids: noteIds,
              })
              .order("created_at", { ascending: false })
              .order("id", { ascending: true })
              .range(desde, hasta),
          )
        : { filas: [], error: null };
      if (versionsRes.error)
        throw new Error(
          mensajeDb(versionsRes.error, "No pudimos cargar las versiones de las notas clínicas."),
        );

      const versions = versionsRes.filas;
      const audit = auditRes.data ?? [];
      const entities = entitiesRes.data ?? [];
      const reviews = reviewsRes.data ?? [];

      const nombres = await nombresPorUsuario(
        supabase,
        [
          ...versions.map((v) => v.author_id),
          ...audit.map((a) => a.actor_id),
          ...reviews.map((r) => r.actor_id),
          ...reviews.map((r) => r.reviewer_id),
          ...notes.map((n) => n.reviewer_id),
          ...notes.map((n) => n.review_requested_by),
        ].filter((id): id is string => Boolean(id)),
      );

      const versionesPorNota = new Map<string, number>();
      for (const n of notes) {
        const propias = versions
          .filter((v) => v.note_id === n.id)
          .map((v) => ({ version: v.version, coincide: v.matches_note }));
        versionesPorNota.set(n.id, versionVigenteSegunCoincidencia(propias));
      }

      await lectura;
      return {
        notes: notes.map((n) => ({
          id: n.id,
          patientRef: n.patient_ref,
          title: n.title,
          content: n.content,
          summary: n.summary,
          status: (n.status === "signed" ? "signed" : "draft") as NoteStatus,
          version: versionesPorNota.get(n.id) ?? 1,
          createdAt: n.created_at,
          reviewStatus: (n.review_status ?? "none") as NoteReviewStatus,
          reviewerId: n.reviewer_id ?? null,
          reviewerName: n.reviewer_id ? (nombres.get(n.reviewer_id) ?? null) : null,
          reviewRequestedBy: n.review_requested_by ?? null,
          reviewRequestedByName: n.review_requested_by
            ? (nombres.get(n.review_requested_by) ?? null)
            : null,
          reviewRequestedAt: n.review_requested_at ?? null,
          reviewedAt: n.reviewed_at ?? null,
          addendumOf: n.addendum_of ?? null,
          signedAt: n.signed_at ?? null,
          signerName: n.signer_name ?? null,
          signerLicense: n.signer_license ?? null,

          updatedAt: n.updated_at,
          updatedBy: n.updated_by,
        })),
        versions: versions.map((v) => ({
          id: v.id,
          noteId: v.note_id,
          version: v.version,
          title: v.title,
          preview: v.preview,
          aiAssisted: v.ai_assisted,
          aiAction: v.ai_action,
          authorId: v.author_id,
          authorName: nombres.get(v.author_id) ?? null,
          createdAt: v.created_at,
        })),
        audit: audit.map((a) => ({
          id: a.id,
          noteId: a.note_id,
          action: a.action,
          detail: a.detail,
          actorId: a.actor_id,
          actorName: nombres.get(a.actor_id) ?? null,
          createdAt: a.created_at,
        })),
        entities: entities.map((e) => ({
          id: e.id,
          noteId: e.note_id,
          kind: e.kind as ClinicalEntityKind,
          term: e.term,
          code: e.code,
          tooth: e.tooth,
          quantity: e.quantity,
          dosage: e.dosage,
          severity: e.severity,
          status: e.status,
          notes: e.notes,
          confidence: e.confidence,
          aiGenerated: e.ai_generated,
          confirmed: e.confirmed,
          createdAt: e.created_at,
        })),
        reviews: reviews.map((r) => ({
          id: r.id,
          noteId: r.note_id,
          action: r.action as NoteReviewAction,
          comment: r.comment,
          actorId: r.actor_id,
          actorName: nombres.get(r.actor_id) ?? null,
          reviewerId: r.reviewer_id ?? null,
          reviewerName: r.reviewer_id ? (nombres.get(r.reviewer_id) ?? null) : null,
          noteVersion: r.note_version ?? null,
          createdAt: r.created_at,
        })),
      };
    },
  );

/**
 * Contenido completo de las versiones de UNA nota, para el comparador. Se
 * pide recién cuando alguien lo abre: `getPatientNotes` solo trae metadatos.
 * Misma RLS que cualquier lectura de `clinical_note_versions` (solo roles
 * clínicos), más el filtro por clínica de siempre.
 */
export const getNoteVersionContents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), noteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ClinicalNoteVersion[]> => {
    const { supabase } = context;
    const { filas, error } = await leerTodasLasPaginas((desde, hasta) =>
      supabase
        .from("clinical_note_versions")
        .select(
          "id, note_id, version, title, content, summary, ai_assisted, ai_action, author_id, created_at",
        )
        .eq("clinic_id", data.clinicId)
        .eq("note_id", data.noteId)
        .order("version", { ascending: true })
        .order("id", { ascending: true })
        .range(desde, hasta),
    );
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar las versiones de la nota clínica."));
    const nombres = await nombresPorUsuario(
      supabase,
      filas.map((v) => v.author_id),
    );
    return filas.map((v) => ({
      id: v.id,
      noteId: v.note_id,
      version: v.version,
      title: v.title,
      content: v.content,
      summary: v.summary,
      aiAssisted: v.ai_assisted,
      aiAction: v.ai_action,
      authorId: v.author_id,
      authorName: nombres.get(v.author_id) ?? null,
      createdAt: v.created_at,
    }));
  });

/** Devuelve el número de versión vigente de una nota. */
async function versionActual(supabase: SupabaseCtx, noteId: string): Promise<number | null> {
  const { data } = await supabase
    .from("clinical_note_versions")
    .select("version")
    .eq("note_id", noteId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.version ?? null;
}

const saveInput = clinicPatient.extend({
  noteId: z.string().uuid().nullable().optional(),
  patientName: z.string().max(160).nullable().optional(),
  title: z.string().min(1).max(160),
  content: z.string().max(20000),
  summary: z.string().max(4000).nullable().optional(),
  aiAssisted: z.boolean().default(false),
  aiAction: z.enum(["draft", "summary", "polish"]).nullable().optional(),
  /** Versión vigente vista al empezar a editar. `undefined` = no verificar (llamadas legacy/IA). */
  baseVersion: z.number().int().positive().nullable().optional(),
  /** Salta el chequeo de conflicto: nunca se usa desde la UI de edición normal. */
  force: z.boolean().default(false),
  /** CLI-07: alta de una adenda a esta nota firmada. Se ignora si la nota ya existe. */
  addendumOf: z.string().uuid().nullable().optional(),
});

export type SaveNoteConflict = {
  noteId: string;
  conflict: true;
  versionId: string;
  version: number;
  currentTitle: string;
  currentContent: string;
};
export type SaveNoteResult =
  { noteId: string; version: number; conflict?: false } | SaveNoteConflict;

/**
 * Guarda la nota creando una nueva versión inmutable y registrando auditoría.
 *
 * Si `noteId` viene de una captura offline, puede no existir todavía en la
 * base — en ese caso es un alta, no una edición (`esCreacion` lo decide con
 * una lectura, nunca confiando en la sola verdad de que el parámetro venga
 * seteado).
 *
 * `baseVersion` es la versión que el equipo tenía cargada al empezar a editar
 * offline. Si al sincronizar la vigente ya avanzó, no pisamos el contenido en
 * silencio: igual guardamos la edición como una versión nueva (nada se
 * pierde, regla #9 del repo) pero NO la hacemos vigente — se devuelve como
 * conflicto para que una persona decida entre las dos.
 */
export const saveClinicalNote = createServerFn({ method: "POST" })
  .middleware([requireEscrituraDeNotaClinica])
  .validator((input: unknown) => saveInput.parse(input))
  .handler(async ({ data, context }): Promise<SaveNoteResult> => {
    const { supabase, userId } = context;
    const noteId = data.noteId ?? null;
    let esCreacion = !noteId;

    if (noteId && !esCreacion) {
      const { data: existente } = await supabase
        .from("clinical_notes")
        .select("id")
        .eq("id", noteId)
        .maybeSingle();
      if (!existente) esCreacion = true;
    }

    if (!esCreacion) {
      if (!data.force && data.baseVersion != null) {
        const vigente = await versionActual(supabase, noteId!);
        if (vigente != null && vigente !== data.baseVersion) {
          const { data: actual } = await supabase
            .from("clinical_notes")
            .select("title, content")
            .eq("id", noteId!)
            .maybeSingle();

          const nuevaVersion = vigente + 1;
          const { data: versionInsertada, error: versionError } = await supabase
            .from("clinical_note_versions")
            .insert({
              note_id: noteId!,
              clinic_id: data.clinicId,
              version: nuevaVersion,
              title: data.title,
              content: data.content,
              summary: data.summary ?? null,
              ai_assisted: data.aiAssisted,
              ai_action: data.aiAction ?? null,
              author_id: userId,
            })
            .select("id")
            .single();
          if (versionError || !versionInsertada)
            throw new Error(mensajeDb(versionError, "No pudimos guardar tu versión en conflicto."));

          // Un choque de la cola offline no deja rastro en el estado de la
          // base: ningún trigger puede verlo. Va por la puerta angosta, que
          // sólo acepta este vocabulario y estampa el actor ella misma.
          await supabase.rpc("registrar_evento_de_nota", {
            p_note_id: noteId!,
            p_clinic_id: data.clinicId,
            p_patient_ref: data.patientRef,
            p_action: "conflict",
            p_detail: `v${nuevaVersion} sin conexión chocó con v${vigente} ya guardada`,
          });

          return {
            noteId: noteId!,
            conflict: true,
            versionId: versionInsertada.id,
            version: nuevaVersion,
            currentTitle: actual?.title ?? data.title,
            currentContent: actual?.content ?? data.content,
          };
        }
      }
    }

    // CLI-07: nota + versión en una sola transacción (`guardar_nota_clinica`).
    // Antes eran dos requests (UPDATE y después INSERT de la versión) y si el
    // segundo fallaba el contenido quedaba cambiado sin versión. La base
    // además rechaza cualquier cambio de contenido sin su versión, así que no
    // hay otro camino.
    const { data: filas, error } = await supabase.rpc("guardar_nota_clinica", {
      p_clinic_id: data.clinicId,
      p_patient_ref: data.patientRef,
      p_note_id: noteId,
      p_title: data.title,
      p_content: data.content,
      p_summary: data.summary ?? undefined,
      p_patient_name: data.patientName ?? undefined,
      p_ai_assisted: data.aiAssisted,
      p_ai_action: data.aiAction ?? undefined,
      p_addendum_of: esCreacion ? (data.addendumOf ?? undefined) : undefined,
    });
    const guardada = filas?.[0];
    if (error || !guardada) {
      // Reintento de un alta offline que ya había quedado completa (la nota
      // existe pero no era visible al leerla, o llegó en paralelo).
      if (esCreacion && data.noteId) {
        const yaCreada = await filaYaCreada(
          supabase,
          "clinical_notes",
          data.noteId,
          data.clinicId,
          error,
        );
        const versionExistente = yaCreada ? await versionActual(supabase, yaCreada) : null;
        if (yaCreada && versionExistente != null)
          return { noteId: yaCreada, version: versionExistente };
      }
      throw new Error(
        mensajeDb(
          error,
          esCreacion
            ? "No tienes permisos para crear notas clínicas en esta clínica."
            : "No tienes permisos para editar notas clínicas en esta clínica.",
        ),
      );
    }

    // La auditoría (create/edit) la escribe el trigger note_versions_auditar
    // a partir de la versión recién insertada. Ver la migración
    // 20260907200000: la app ya no puede escribir en clinical_note_audit.
    return { noteId: guardada.nota_id, version: guardada.version_nueva };
  });

/**
 * Revierte un BORRADOR al contenido de una versión anterior, como versión
 * nueva (origin='revert'). Una nota firmada no se revierte ni se reabre
 * (CLI-07): se corrige con una adenda.
 */
export const restoreNoteVersion = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("clinical_note_versions", "versionId")])
  .validator((input: unknown) => z.object({ versionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: version, error } = await supabase
      .from("clinical_note_versions")
      .select("*")
      .eq("id", data.versionId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar esa versión de la nota."));
    if (!version) throw new Error("No encontramos esa versión.");

    const { data: note } = await supabase
      .from("clinical_notes")
      .select("patient_ref, status, review_status")
      .eq("id", version.note_id)
      .maybeSingle();
    if (!note) throw new Error("No encontramos esa nota.");
    if (note.status === "signed")
      throw new Error("La nota está firmada: para corregirla, agrega una adenda.");
    if (note.review_status === "pending")
      throw new Error("La nota está en revisión: resuélvela antes de revertir a otra versión.");

    // Nota + versión en una sola transacción. Que esto sea una reversión es
    // un dato de la versión (origin/origin_version), no texto libre: el
    // trigger de auditoría la distingue de un guardado normal.
    const { data: filas, error: guardarError } = await supabase.rpc("guardar_nota_clinica", {
      p_clinic_id: version.clinic_id,
      p_patient_ref: note.patient_ref,
      p_note_id: version.note_id,
      p_title: version.title,
      p_content: version.content,
      p_summary: version.summary ?? undefined,
      p_ai_assisted: version.ai_assisted,
      p_ai_action: version.ai_action ?? undefined,
      p_revert_of_version: version.version,
    });
    const guardada = filas?.[0];
    if (guardarError || !guardada)
      throw new Error(mensajeDb(guardarError, "No tienes permisos para revertir esta nota."));

    return {
      ok: true,
      version: guardada.version_nueva,
      title: version.title,
      content: version.content,
      summary: version.summary,
    };
  });

export type SignNoteResult =
  | { ok: true }
  /** CLI-08: a quien firma le faltan nombre completo o registro profesional. */
  | { ok: false; faltanDatosDeFirma: true; nombreSugerido: string | null };

/**
 * Firma una nota (CLI-08). Una nota firmada ya no vuelve a borrador: no hay
 * "reabrir". La base estampa quién firmó, con qué nombre y registro, cuándo y
 * el hash del contenido (trigger `clinical_notes_firmar`), y rechaza la firma
 * si al profesional le falta el registro. Acá se consulta antes para pedirle
 * los datos en vez de mostrarle un error.
 */
export const signClinicalNote = createServerFn({ method: "POST" })
  .middleware([requireEscrituraDeNotaClinica])
  .validator((input: unknown) => z.object({ noteId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SignNoteResult> => {
    const { supabase, userId } = context;

    const { data: note } = await supabase
      .from("clinical_notes")
      .select("clinic_id, status")
      .eq("id", data.noteId)
      .maybeSingle();
    if (!note) throw new Error("No encontramos esa nota.");
    if (note.status === "signed") return { ok: true };

    const datos = await misDatosDeFirma(supabase, note.clinic_id);
    if (!datos.nombre || !datos.registro) {
      const { data: perfil } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();
      return {
        ok: false,
        faltanDatosDeFirma: true,
        nombreSugerido: datos.nombre ?? perfil?.full_name ?? null,
      };
    }

    const { error } = await supabase
      .from("clinical_notes")
      .update({ status: "signed", updated_by: userId })
      .eq("id", data.noteId)
      .eq("clinic_id", note.clinic_id);
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para firmar esta nota."));

    // 'sign' lo escribe el trigger notes_auditar_estado.
    return { ok: true };
  });

async function misDatosDeFirma(
  supabase: SupabaseCtx,
  clinicId: string,
): Promise<{ nombre: string | null; registro: string | null }> {
  const { data, error } = await supabase.rpc("mis_datos_de_firma", { p_clinic_id: clinicId });
  if (error) throw new Error(mensajeDb(error, "No pudimos leer tus datos de firma."));
  const fila = data?.[0];
  return { nombre: fila?.nombre ?? null, registro: fila?.registro ?? null };
}

/**
 * Guarda el nombre completo y el número de registro con los que la persona
 * firma en esta clínica (CLI-08: "si no tiene registro, se le pide"). Cada
 * uno carga SOLO los suyos: la función de la base usa auth.uid().
 */
export const saveMySignatureData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        nombre: z.string().trim().min(3).max(160),
        registro: z.string().trim().min(2).max(60),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("registrar_mis_datos_de_firma", {
      p_clinic_id: data.clinicId,
      p_nombre: data.nombre,
      p_registro: data.registro,
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos guardar tus datos de firma."));
    return { ok: true };
  });

const aiInput = clinicPatient.extend({
  noteId: z.string().uuid().nullable().optional(),
  action: z.enum(["draft", "summary", "polish"]),
  input: z.string().min(1).max(12000),
  context: z.string().max(4000).optional(),
  templateId: z.string().max(64).nullable().optional(),
});

/**
 * Lo que sabemos del paciente que NO puede salir hacia el modelo (IA-02):
 * nombre, documento, teléfono y email registrados. El gateway los quita del
 * texto por valor exacto, además de los patrones genéricos. Si `patientRef`
 * no es un id de la base (demo), no hay nada que buscar.
 */
async function identificadoresDelPaciente(
  supabase: SupabaseCtx,
  clinicId: string,
  patientRef: string,
): Promise<{ nombres: string[]; valores: string[] }> {
  if (!z.string().uuid().safeParse(patientRef).success) return { nombres: [], valores: [] };
  const { data } = await supabase
    .from("patients")
    .select("full_name, document_id, phone, email")
    .eq("id", patientRef)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (!data) return { nombres: [], valores: [] };
  return {
    nombres: [data.full_name].filter(Boolean),
    valores: [data.document_id, data.phone, data.email].filter((v): v is string => Boolean(v)),
  };
}

/** Genera texto con IA y registra la acción en la auditoría. */
export const generateNoteText = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => aiInput.parse(input))
  .handler(async ({ data, context }): Promise<{ text: string }> => {
    const { supabase, userId } = context;

    const { data: membership } = await supabase
      .from("clinic_members")
      .select("role")
      .eq("clinic_id", data.clinicId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership || !["owner", "admin", "dentist", "assistant"].includes(membership.role)) {
      throw new Error("Tu rol no puede redactar notas clínicas.");
    }

    const { getNoteTemplate } = await import("@/lib/clinical/note-templates");
    const plantilla = getNoteTemplate(data.templateId);
    const guiaPlantilla = plantilla
      ? `\n\nPlantilla activa: ${plantilla.specialty} · ${plantilla.motivo}. ${plantilla.guidance}` +
        `\nRespeta esta estructura de secciones:\n${plantilla.scaffold}` +
        "\nCompleta solo con lo que aporte el profesional; deja 'no consignado' donde falte información."
      : "";

    const { gatewayChat, iaHabilitada, IaPausadaError } = await import("@/lib/ai-gateway.server");
    if (!iaHabilitada()) throw new IaPausadaError();
    const text = await gatewayChat({
      uso: "clinico",
      system: `${SYSTEM_BASE}\n\n${PROMPTS_NOTA[data.action]}${guiaPlantilla}`,
      user: data.context
        ? `Contexto del paciente:\n${data.context}\n\nApuntes:\n${data.input}`
        : data.input,
      identificadores: await identificadoresDelPaciente(supabase, data.clinicId, data.patientRef),
    });

    // Una llamada al modelo no cambia el estado de la base: va por la puerta
    // angosta.
    await supabase.rpc("registrar_evento_de_nota", {
      p_note_id: data.noteId ?? undefined,
      p_clinic_id: data.clinicId,
      p_patient_ref: data.patientRef,
      p_action: `ai_${data.action}`,
      p_detail: `${data.input.length} caracteres de entrada`,
    });

    return { text };
  });

const KIND_KEYS = ["diagnoses", "treatments", "medications", "allergies"] as const;
const KIND_BY_KEY: Record<(typeof KIND_KEYS)[number], ClinicalEntityKind> = {
  diagnoses: "diagnosis",
  treatments: "treatment",
  medications: "medication",
  allergies: "allergy",
};

const itemSchema = z.object({
  term: z.string().min(1).max(200),
  code: z.string().max(40).nullish(),
  tooth: z.string().max(20).nullish(),
  quantity: z.coerce.number().nullish(),
  dosage: z.string().max(120).nullish(),
  severity: z.string().max(60).nullish(),
  status: z.string().max(60).nullish(),
  notes: z.string().max(400).nullish(),
  confidence: z.coerce.number().min(0).max(1).nullish(),
});

/** Tolera que el modelo devuelva strings sueltos en lugar de objetos. */
const flexibleItem = z.preprocess((v) => (typeof v === "string" ? { term: v } : v), itemSchema);

const listSchema = z.array(flexibleItem).default([]);

const extractionSchema = z.object({
  diagnoses: listSchema,
  treatments: listSchema,
  medications: listSchema,
  allergies: listSchema,
});

const structureInput = clinicPatient.extend({
  noteId: z.string().uuid(),
  content: z.string().min(10).max(20000),
  replace: z.boolean().default(true),
});

/** Convierte la nota SOAP en campos estructurados (diagnósticos, tratamientos, medicamentos, alergias). */
export const extractNoteEntities = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => structureInput.parse(input))
  .handler(async ({ data, context }): Promise<{ entities: ClinicalNoteEntity[] }> => {
    const { supabase, userId } = context;

    const { data: membership } = await supabase
      .from("clinic_members")
      .select("role")
      .eq("clinic_id", data.clinicId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership || !["owner", "admin", "dentist", "assistant"].includes(membership.role)) {
      throw new Error("Tu rol no puede estructurar notas clínicas.");
    }

    const { gatewayChat, iaHabilitada, IaPausadaError, limpiarJson } =
      await import("@/lib/ai-gateway.server");
    if (!iaHabilitada()) throw new IaPausadaError();
    const raw = await gatewayChat({
      uso: "clinico",
      system: PROMPT_ENTIDADES,
      user: `Nota clínica:\n${data.content}`,
      json: true,
      identificadores: await identificadoresDelPaciente(supabase, data.clinicId, data.patientRef),
    });

    let parsed: z.infer<typeof extractionSchema>;
    try {
      parsed = extractionSchema.parse(JSON.parse(limpiarJson(raw)));
    } catch {
      throw new Error("La IA no devolvió campos estructurados legibles. Intenta nuevamente.");
    }

    const filas = KIND_KEYS.flatMap((key) =>
      parsed[key].map((item) => ({
        note_id: data.noteId,
        clinic_id: data.clinicId,
        patient_ref: data.patientRef,
        kind: KIND_BY_KEY[key],
        term: item.term.trim(),
        code: item.code ?? null,
        tooth: item.tooth ?? null,
        quantity: item.quantity ?? null,
        dosage: item.dosage ?? null,
        severity: item.severity ?? null,
        status: item.status ?? null,
        notes: item.notes ?? null,
        confidence: item.confidence ?? null,
        ai_generated: true,
        created_by: userId,
      })),
    ).filter((f) => f.term.length > 0);

    if (data.replace) {
      await supabase
        .from("clinical_note_entities")
        .delete()
        .eq("note_id", data.noteId)
        .eq("ai_generated", true)
        .eq("confirmed", false);
    }

    let insertadas: ClinicalNoteEntity[] = [];
    if (filas.length) {
      const { data: creadas, error } = await supabase
        .from("clinical_note_entities")
        .insert(filas)
        .select("*");
      if (error) throw new Error("No pudimos guardar los campos estructurados.");
      insertadas = (creadas ?? []).map((e) => ({
        id: e.id,
        noteId: e.note_id,
        kind: e.kind as ClinicalEntityKind,
        term: e.term,
        code: e.code,
        tooth: e.tooth,
        quantity: e.quantity,
        dosage: e.dosage,
        severity: e.severity,
        status: e.status,
        notes: e.notes,
        confidence: e.confidence,
        aiGenerated: e.ai_generated,
        confirmed: e.confirmed,
        createdAt: e.created_at,
      }));
    }

    await supabase.rpc("registrar_evento_de_nota", {
      p_note_id: data.noteId,
      p_clinic_id: data.clinicId,
      p_patient_ref: data.patientRef,
      p_action: "ai_structure",
      p_detail: `${filas.length} campos extraídos`,
    });

    return { entities: insertadas };
  });

/** Confirma (valida clínicamente) un campo estructurado extraído por IA. */
export const confirmNoteEntity = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("clinical_note_entities", "entityId")])
  .validator((input: unknown) =>
    z.object({ entityId: z.string().uuid(), confirmed: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: entity, error } = await supabase
      .from("clinical_note_entities")
      .update({ confirmed: data.confirmed, confirmed_by: data.confirmed ? userId : null })
      .eq("id", data.entityId)
      .select("note_id, clinic_id, patient_ref, term")
      .maybeSingle();
    if (error || !entity) throw new Error("No tienes permisos para validar este campo.");

    // 'entity_confirm' lo escribe el trigger note_entities_auditar_confirm.
    return { ok: true };
  });

/** Elimina un campo estructurado incorrecto. */
export const deleteNoteEntity = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("clinical_note_entities", "entityId")])
  .validator((input: unknown) => z.object({ entityId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: entity } = await supabase
      .from("clinical_note_entities")
      .select("note_id, clinic_id, patient_ref, term")
      .eq("id", data.entityId)
      .maybeSingle();
    if (!entity) throw new Error("No encontramos ese campo.");

    const { error } = await supabase
      .from("clinical_note_entities")
      .delete()
      .eq("id", data.entityId);
    if (error) throw new Error("No tienes permisos para eliminar este campo.");

    // 'entity_delete' lo escribe el trigger note_entities_auditar_delete.
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Flujo de revisión: una nota firmada puede requerir aprobación de    */
/* otro profesional (supervisor) con estados, comentarios y auditoría. */
/* ------------------------------------------------------------------ */

const ROLES_CLINICOS = ["owner", "admin", "dentist", "assistant"] as const;
const ROLES_REVISORES = ["owner", "admin", "dentist"] as const;

async function rolEnClinica(
  supabase: SupabaseCtx,
  clinicId: string,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("clinic_members")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role ?? null;
}

/** Profesionales habilitados para aprobar notas clínicas en la clínica. */
export const listNoteReviewers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(
    async ({ data, context }): Promise<Array<{ userId: string; name: string; role: string }>> => {
      const { supabase, userId } = context;
      const { data: rows } = await supabase
        .from("clinic_members")
        .select("user_id, role")
        .eq("clinic_id", data.clinicId)
        .in("role", [...ROLES_REVISORES]);

      const miembros = (rows ?? []).filter((m) => m.user_id !== userId);
      const nombres = await nombresPorUsuario(
        supabase,
        miembros.map((m) => m.user_id),
      );
      return miembros.map((m) => ({
        userId: m.user_id,
        name: nombres.get(m.user_id) ?? "Profesional",
        role: m.role,
      }));
    },
  );

/** Resuelve el nombre visible de un usuario para los mensajes de notificación. */
async function nombreDe(supabase: SupabaseCtx, userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();
  return data?.full_name || data?.email || "Un profesional";
}

/** Solicita la revisión de una nota firmada. */
export const requestNoteReview = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("clinical_notes", "noteId")])
  .validator((input: unknown) =>
    z
      .object({
        noteId: z.string().uuid(),
        reviewerId: z.string().uuid(),
        comment: z.string().max(2000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: note } = await supabase
      .from("clinical_notes")
      .select("clinic_id, patient_ref, status, review_status, title")
      .eq("id", data.noteId)
      .maybeSingle();
    if (!note) throw new Error("No encontramos esa nota.");
    if (note.status !== "signed")
      throw new Error("Solo puedes enviar a revisión una nota firmada.");
    if (note.review_status === "pending")
      throw new Error("Esta nota ya está pendiente de aprobación.");
    if (data.reviewerId === userId) throw new Error("Elige a otro profesional como revisor.");

    const rolSolicitante = await rolEnClinica(supabase, note.clinic_id, userId);
    if (!rolSolicitante || !(ROLES_CLINICOS as readonly string[]).includes(rolSolicitante))
      throw new Error("Tu rol no puede solicitar revisiones clínicas.");

    const rolRevisor = await rolEnClinica(supabase, note.clinic_id, data.reviewerId);
    if (!rolRevisor || !(ROLES_REVISORES as readonly string[]).includes(rolRevisor))
      throw new Error("El revisor debe ser doctor/a, administrador o propietario de la clínica.");

    const ahora = new Date().toISOString();
    const { error } = await supabase
      .from("clinical_notes")
      .update({
        review_status: "pending",
        reviewer_id: data.reviewerId,
        review_requested_by: userId,
        review_requested_at: ahora,
        reviewed_at: null,
        updated_by: userId,
      })
      .eq("id", data.noteId)
      .eq("clinic_id", note.clinic_id);
    if (error)
      throw new Error(mensajeDb(error, "No tienes permisos para enviar esta nota a revisión."));

    await supabase.from("clinical_note_reviews").insert({
      note_id: data.noteId,
      clinic_id: note.clinic_id,
      patient_ref: note.patient_ref,
      action: "requested",
      comment: data.comment?.trim() || null,
      actor_id: userId,
      reviewer_id: data.reviewerId,
      note_version: await versionActual(supabase, data.noteId),
    });

    // 'review_requested' lo escribe el trigger note_reviews_auditar a partir
    // de la fila de revisión recién insertada.

    const solicitante = await nombreDe(supabase, userId);
    await createNotification(supabase, {
      clinicId: note.clinic_id,
      recipientId: data.reviewerId,
      actorId: userId,
      kind: "review_requested",
      title: `${solicitante} solicitó tu revisión`,
      body: `Nota "${note.title}"${data.comment?.trim() ? ` · ${data.comment.trim()}` : ""}`,
      noteId: data.noteId,
      patientRef: note.patient_ref,
    });

    return { ok: true };
  });

/** Resuelve o comenta una revisión: aprobar, pedir cambios, comentar o cancelar. */
export const resolveNoteReview = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("clinical_notes", "noteId")])
  .validator((input: unknown) =>
    z
      .object({
        noteId: z.string().uuid(),
        action: z.enum(["approved", "changes_requested", "comment", "cancelled"]),
        comment: z.string().max(2000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; reviewStatus: NoteReviewStatus }> => {
    const { supabase, userId } = context;

    const { data: note } = await supabase
      .from("clinical_notes")
      .select(
        "clinic_id, patient_ref, status, review_status, reviewer_id, review_requested_by, title",
      )
      .eq("id", data.noteId)
      .maybeSingle();
    if (!note) throw new Error("No encontramos esa nota.");

    const rol = await rolEnClinica(supabase, note.clinic_id, userId);
    if (!rol || !(ROLES_CLINICOS as readonly string[]).includes(rol))
      throw new Error("Tu rol no participa en revisiones clínicas.");

    const esRevisor = note.reviewer_id === userId;
    const esSupervisor = rol === "owner" || rol === "admin";
    const esSolicitante = note.review_requested_by === userId;
    const comentario = data.comment?.trim() || null;

    if (data.action === "approved" || data.action === "changes_requested") {
      if (note.review_status !== "pending")
        throw new Error("Esta nota no está pendiente de aprobación.");
      if (!esRevisor && !esSupervisor)
        throw new Error("Solo el revisor asignado puede resolver esta revisión.");
      if (data.action === "changes_requested" && !comentario)
        throw new Error("Indica qué cambios se requieren antes de devolver la nota.");
    }

    if (data.action === "cancelled") {
      if (note.review_status !== "pending")
        throw new Error("No hay una solicitud de revisión activa.");
      if (!esSolicitante && !esSupervisor)
        throw new Error("Solo quien solicitó la revisión puede cancelarla.");
    }

    if (data.action === "comment" && !comentario)
      throw new Error("Escribe un comentario antes de enviarlo.");

    const ahora = new Date().toISOString();
    let nuevoEstado: NoteReviewStatus = (note.review_status ?? "none") as NoteReviewStatus;
    const patch: {
      updated_by: string;
      review_status?: NoteReviewStatus;
      reviewed_at?: string | null;
      reviewer_id?: string | null;
      review_requested_by?: string | null;
      review_requested_at?: string | null;
      status?: string;
    } = { updated_by: userId };

    if (data.action === "approved") {
      nuevoEstado = "approved";
      patch.review_status = "approved";
      patch.reviewed_at = ahora;
    } else if (data.action === "changes_requested") {
      nuevoEstado = "changes_requested";
      patch.review_status = "changes_requested";
      patch.reviewed_at = ahora;
      // La nota sigue firmada: los cambios pedidos se aplican con una adenda
      // (CLI-07), y la adenda se puede volver a mandar a revisión.
    } else if (data.action === "cancelled") {
      nuevoEstado = "none";
      patch.review_status = "none";
      patch.reviewer_id = null;
      patch.review_requested_by = null;
      patch.review_requested_at = null;
      patch.reviewed_at = null;
    }

    if (Object.keys(patch).length > 1) {
      const { error } = await supabase
        .from("clinical_notes")
        .update(patch)
        .eq("id", data.noteId)
        .eq("clinic_id", note.clinic_id);
      if (error)
        throw new Error(mensajeDb(error, "No tienes permisos para actualizar esta revisión."));
    }

    const accion: NoteReviewAction = data.action;
    await supabase.from("clinical_note_reviews").insert({
      note_id: data.noteId,
      clinic_id: note.clinic_id,
      patient_ref: note.patient_ref,
      action: accion,
      comment: comentario,
      actor_id: userId,
      reviewer_id: note.reviewer_id ?? null,
      note_version: await versionActual(supabase, data.noteId),
    });

    // 'review_*' lo escribe el trigger note_reviews_auditar.

    const actor = await nombreDe(supabase, userId);
    const destinatario = note.reviewer_id === userId ? note.review_requested_by : note.reviewer_id;
    const titulos: Record<NoteReviewAction, string> = {
      requested: `${actor} solicitó tu revisión`,
      approved: `${actor} aprobó la nota`,
      changes_requested: `${actor} solicitó cambios`,
      comment: `${actor} comentó en la revisión`,
      cancelled: `${actor} canceló la solicitud de revisión`,
    };
    await createNotification(supabase, {
      clinicId: note.clinic_id,
      recipientId: destinatario,
      actorId: userId,
      kind: `review_${accion}`,
      title: titulos[accion],
      body: `Nota "${note.title}"${comentario ? ` · ${comentario}` : ""}`,
      noteId: data.noteId,
      patientRef: note.patient_ref,
    });

    return { ok: true, reviewStatus: nuevoEstado };
  });
