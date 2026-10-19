// src/lib/marketing/suscripcion-activada.server.ts
//
// `suscripcion_activada` desde dos fuentes, contado una sola vez por
// suscripción de Stripe (TODO de #68, auditoría 360 del 18-oct-2026):
//
//   - `webhook`: `checkout.session.completed` / `customer.subscription.created`.
//     Fuente confiable: cuenta aunque la persona cierre la pestaña en Stripe.
//   - `retorno_checkout`: la vuelta con `?checkout=success`. Trae el
//     `session_hash` de la visita (atribución por UTM / referrer).
//
// El primero que llega reclama la suscripción en
// `subscriptions.activation_tracked_sub_id` con un UPDATE condicional (dos
// entregas a la vez no pueden ganar las dos) y escribe el evento. Si el
// webhook ganó, la vuelta del checkout le suma su `session_hash` al evento
// ya escrito en vez de crear otro.
//
// Mientras la migración 20261019210000 no esté aplicada, las columnas no
// existen: el webhook no emite (así no se duplica) y la vuelta del checkout
// sigue emitiendo como hasta ahora.
//
// Nunca lanza: la telemetría no puede tumbar el webhook ni la vuelta del pago.
// Sin ids en las propiedades del evento (regla de `medicion.ts`).

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { isUndefinedColumnError } from "@/lib/db-errors";

type Admin = SupabaseClient<Database>;

export type FuenteActivacion = "webhook" | "retorno_checkout";

export type ResultadoActivacion =
  /** Se escribió el evento. */
  | "registrado"
  /** Ya estaba contada; no se escribió nada. */
  | "duplicado"
  /** Ya estaba contada por el webhook; se le sumó la atribución. */
  | "atribuido"
  /** Sin columnas de dedupe (migración sin aplicar): se escribió sin dedupe. */
  | "sin_dedupe"
  /** Sin columnas de dedupe: el webhook no emite para no duplicar. */
  | "omitido"
  | "error";

const ID_SUSCRIPCION = /^sub_[A-Za-z0-9]+$/;

export async function registrarSuscripcionActivadaUnaVez(args: {
  admin: Admin;
  clinicId: string;
  subscriptionId: string;
  estado: string;
  fuente: FuenteActivacion;
  interno: boolean;
  sessionHash?: string | null;
}): Promise<ResultadoActivacion> {
  const { admin, clinicId, subscriptionId, fuente } = args;
  try {
    if (!ID_SUSCRIPCION.test(subscriptionId)) return "error";
    const props: Record<string, string | boolean> = { estado: args.estado, fuente };
    if (args.interno) props.interno = true;

    const insertarEvento = async (): Promise<number | null | "error"> => {
      const { data, error } = await admin
        .from("marketing_events")
        .insert({ name: "suscripcion_activada", props, session_hash: args.sessionHash ?? null })
        .select("id")
        .maybeSingle();
      if (error) {
        console.warn("[ev] suscripcion_activada no se guardó:", error.message);
        return "error";
      }
      return data?.id ?? null;
    };

    // 1. Reclamar la suscripción. Solo gana quien la ve sin reclamar (o
    //    reclamada por otra suscripción anterior de la misma clínica).
    const { data: reclamadas, error: errReclamo } = await admin
      .from("subscriptions")
      .update({ activation_tracked_sub_id: subscriptionId })
      .eq("clinic_id", clinicId)
      .eq("stripe_subscription_id", subscriptionId)
      .or(`activation_tracked_sub_id.is.null,activation_tracked_sub_id.neq.${subscriptionId}`)
      .select("clinic_id");

    if (errReclamo) {
      if (!isUndefinedColumnError(errReclamo)) {
        console.warn("[ev] suscripcion_activada: no se pudo reclamar:", errReclamo.message);
        return "error";
      }
      if (fuente === "webhook") return "omitido";
      return (await insertarEvento()) === "error" ? "error" : "sin_dedupe";
    }

    // 2. Ya estaba contada.
    if (!reclamadas || reclamadas.length === 0) {
      if (fuente !== "retorno_checkout" || !args.sessionHash) return "duplicado";
      const { data: fila } = await admin
        .from("subscriptions")
        .select("activation_event_id, activation_tracked_sub_id")
        .eq("clinic_id", clinicId)
        .maybeSingle();
      if (!fila?.activation_event_id || fila.activation_tracked_sub_id !== subscriptionId) {
        return "duplicado";
      }
      const { data: atribuidos, error: errAtrib } = await admin
        .from("marketing_events")
        .update({ session_hash: args.sessionHash })
        .eq("id", fila.activation_event_id)
        .is("session_hash", null)
        .select("id");
      if (errAtrib) return "duplicado";
      return atribuidos && atribuidos.length > 0 ? "atribuido" : "duplicado";
    }

    // 3. Ganó este: escribir el evento y dejar anotado cuál es.
    const id = await insertarEvento();
    if (id === "error") {
      // Liberar el reclamo para que la otra fuente (o un reintento) lo cuente.
      await admin
        .from("subscriptions")
        .update({ activation_tracked_sub_id: null })
        .eq("clinic_id", clinicId)
        .eq("activation_tracked_sub_id", subscriptionId);
      return "error";
    }
    if (id !== null) {
      await admin
        .from("subscriptions")
        .update({ activation_event_id: id })
        .eq("clinic_id", clinicId)
        .eq("activation_tracked_sub_id", subscriptionId);
    }
    return "registrado";
  } catch (err) {
    console.warn("[ev] suscripcion_activada falló:", err instanceof Error ? err.message : err);
    return "error";
  }
}

/** ¿Clínica del equipo o de la demo? Para marcar el evento `interno`. */
export async function clinicaEsInterna(
  admin: Admin,
  clinicId: string,
  esUsuarioInterno: (userId: string) => Promise<boolean>,
): Promise<boolean> {
  try {
    const [{ data: clinica }, { data: duenos }] = await Promise.all([
      admin.from("clinics").select("is_demo").eq("id", clinicId).maybeSingle(),
      admin.from("clinic_members").select("user_id").eq("clinic_id", clinicId).eq("role", "owner"),
    ]);
    if (clinica?.is_demo) return true;
    for (const d of duenos ?? []) {
      if (await esUsuarioInterno(d.user_id)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
