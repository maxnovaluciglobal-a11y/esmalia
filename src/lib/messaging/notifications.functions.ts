import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  GRUPOS_DE_NOTIFICACION,
  kindsFueraDe,
  type AppNotification,
} from "@/lib/messaging/notifications";
import type { Database } from "@/integrations/supabase/types";

type SupabaseCtx = SupabaseClient<Database>;
type AppRole = Database["public"]["Enums"]["app_role"];

/**
 * Crea una notificación in-app para un integrante de la clínica (best-effort:
 * si falla, el caller decide si romper su propio flujo o no). Punto único de
 * escritura de `notifications` — cualquier dominio que necesite avisar a otro
 * usuario dentro de la clínica pasa por acá en vez de insertar directo.
 */
export async function createNotification(
  supabase: SupabaseCtx,
  payload: {
    clinicId: string;
    recipientId: string | null | undefined;
    actorId: string;
    kind: string;
    title: string;
    body?: string | null;
    noteId?: string | null;
    patientRef?: string | null;
    /** Sobrescribe el link por defecto (`/pacientes/<ref>`). */
    link?: string | null;
  },
) {
  if (!payload.recipientId || payload.recipientId === payload.actorId) return;
  await supabase.from("notifications").insert({
    clinic_id: payload.clinicId,
    recipient_id: payload.recipientId,
    actor_id: payload.actorId,
    kind: payload.kind,
    title: payload.title,
    body: payload.body ?? null,
    link: payload.link ?? (payload.patientRef ? `/pacientes/${payload.patientRef}` : null),
    note_id: payload.noteId ?? null,
    patient_ref: payload.patientRef ?? null,
  });
}

/**
 * Roles que reciben los avisos de la bandeja de conversaciones. Es el mismo
 * conjunto que la política de escritura de `messages` en RLS: avisar a
 * alguien de algo que después no va a poder contestar sería ruido.
 */
export const ROLES_BANDEJA: readonly AppRole[] = ["owner", "admin", "dentist", "reception"];

/**
 * Aviso in-app para TODO el equipo con alguno de los roles pedidos.
 *
 * Existe aparte de `createNotification` porque el disparador no es una
 * persona: lo llama el webhook de WhatsApp con el cliente service_role
 * cuando escribe un paciente. Por eso `actor_id` queda en null (no hay
 * usuario que haya hecho la acción) y no aplica el "no te avises a vos
 * mismo" — nadie del equipo es el actor.
 *
 * Best-effort a propósito: si el aviso falla, el mensaje del paciente YA se
 * guardó y aparece en la bandeja igual. Romper el webhook haría que Meta
 * reintente y duplique el mensaje, que es peor que un aviso perdido.
 */
export async function notifyClinicStaff(
  supabaseAdmin: SupabaseCtx,
  payload: {
    clinicId: string;
    roles: readonly AppRole[];
    kind: string;
    title: string;
    body?: string | null;
    link?: string | null;
    patientRef?: string | null;
  },
): Promise<number> {
  const { data: miembros, error } = await supabaseAdmin
    .from("clinic_members")
    .select("user_id")
    .eq("clinic_id", payload.clinicId)
    .in("role", payload.roles);
  if (error || !miembros || miembros.length === 0) return 0;

  // clinic_members es UNIQUE(clinic_id, user_id, role): alguien con dos roles
  // aparece dos veces y recibiría el aviso duplicado.
  const destinatarios = [...new Set(miembros.map((m) => m.user_id))];

  // `.select()` para contar los avisos que ENTRARON, no los que se intentaron:
  // el trigger `notifications_respetar_preferencia` descarta los de quien
  // apagó los avisos en la app, así que devolver `destinatarios.length` diría
  // que se avisó a gente que pidió no ser avisada.
  const { data: insertados, error: errIns } = await supabaseAdmin
    .from("notifications")
    .insert(
      destinatarios.map((recipientId) => ({
        clinic_id: payload.clinicId,
        recipient_id: recipientId,
        actor_id: null,
        kind: payload.kind,
        title: payload.title,
        body: payload.body ?? null,
        link: payload.link ?? null,
        patient_ref: payload.patientRef ?? null,
      })),
    )
    .select("id");
  if (errIns) {
    console.error("[notifications] no se pudo avisar al equipo:", errIns.message);
    return 0;
  }
  return insertados?.length ?? 0;
}

const COLUMNAS_NOTIFICACION =
  "id, kind, title, body, link, note_id, patient_ref, read_at, created_at" as const;

type FilaNotificacion = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  note_id: string | null;
  patient_ref: string | null;
  read_at: string | null;
  created_at: string;
};

function mapNotificacion(n: FilaNotificacion): AppNotification {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    noteId: n.note_id,
    patientRef: n.patient_ref,
    readAt: n.read_at,
    createdAt: n.created_at,
  };
}

/** Lista las notificaciones del usuario autenticado, más recientes primero. */
export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AppNotification[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("notifications")
      .select(COLUMNAS_NOTIFICACION)
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error("No pudimos cargar tus notificaciones.");
    return ((data ?? []) as FilaNotificacion[]).map(mapNotificacion);
  });

export const TAMANO_PAGINA_NOTIFICACIONES = 40;

export interface BandejaDeNotificaciones {
  items: AppNotification[];
  /** Sin leer en la clínica (todos los tipos), para el encabezado. */
  sinLeer: number;
  /** `created_at` de la última fila si puede haber más (para "Ver más"). */
  siguiente: string | null;
}

/**
 * Centro de notificaciones (NAV-11): la bandeja completa de la persona en la
 * clínica activa, con filtro de leídas y por tipo, paginada por fecha. Solo
 * lee las propias (RLS `recipient_id = auth.uid()`, y además el filtro).
 */
export const listNotificationCenter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        estado: z.enum(["todas", "sin-leer"]).default("todas"),
        grupo: z.enum(["clinico", "pacientes", "operacion"]).nullable().optional(),
        antesDe: z.string().datetime({ offset: true }).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<BandejaDeNotificaciones> => {
    const { supabase, userId } = context;
    let query = supabase
      .from("notifications")
      .select(COLUMNAS_NOTIFICACION)
      .eq("recipient_id", userId)
      .eq("clinic_id", data.clinicId)
      .order("created_at", { ascending: false })
      .limit(TAMANO_PAGINA_NOTIFICACIONES + 1);
    if (data.estado === "sin-leer") query = query.is("read_at", null);
    if (data.antesDe) query = query.lt("created_at", data.antesDe);
    if (data.grupo === "operacion") {
      // Lo conocido de los otros grupos queda afuera; lo desconocido, adentro.
      query = query.not("kind", "in", `(${kindsFueraDe("operacion").join(",")})`);
    } else if (data.grupo) {
      const grupo = GRUPOS_DE_NOTIFICACION.find((g) => g.id === data.grupo);
      query = query.in("kind", [...(grupo?.kinds ?? [])]);
    }
    const [{ data: filas, error }, { count, error: errCount }] = await Promise.all([
      query,
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", userId)
        .eq("clinic_id", data.clinicId)
        .is("read_at", null),
    ]);
    if (error || errCount) throw new Error("No pudimos cargar tus notificaciones.");
    const todas = (filas ?? []) as FilaNotificacion[];
    const hayMas = todas.length > TAMANO_PAGINA_NOTIFICACIONES;
    const items = todas.slice(0, TAMANO_PAGINA_NOTIFICACIONES).map(mapNotificacion);
    return {
      items,
      sinLeer: count ?? 0,
      siguiente: hayMas ? (items[items.length - 1]?.createdAt ?? null) : null,
    };
  });

/** Vuelve a marcar una notificación como no leída (NAV-11). Solo las propias. */
export const markNotificationUnread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ notificationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: null })
      .eq("recipient_id", userId)
      .eq("id", data.notificationId);
    if (error) throw new Error("No pudimos actualizar tus notificaciones.");
    return { ok: true };
  });

/** Marca una notificación (o todas) como leídas. */
export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        notificationId: z.string().uuid().nullable().optional(),
        /** "Marcar todo" del centro: solo las de la clínica activa. */
        clinicId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let query = supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", userId)
      .is("read_at", null);
    if (data.notificationId) query = query.eq("id", data.notificationId);
    if (data.clinicId) query = query.eq("clinic_id", data.clinicId);
    const { error } = await query;
    if (error) throw new Error("No pudimos actualizar tus notificaciones.");
    return { ok: true };
  });
