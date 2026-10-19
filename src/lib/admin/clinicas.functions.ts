// src/lib/admin/clinicas.functions.ts
//
// Pantalla interna para que Walter marque "llamada hecha" después de la
// puesta en marcha con una clínica — ver `requiereLlamadaOSuscripcion` en
// billing.ts: mientras `onboarding_call_at` sea null, la clínica en trial
// tiene WhatsApp automático, portal del paciente y /efectividad bloqueados.
//
// Mismo gate que `listMarketingLeads` (leads.functions.ts): no hay rol
// "staff de la empresa" en el schema, así que la autorización real es la
// allowlist `ESMALIA_STAFF_EMAILS`, ahora compartida vía
// `requireEsmaliaStaffEmail` (src/lib/admin/staff-gate.ts).
//
// Con `supabaseAdmin` (service_role) a propósito: RLS de `clinics` y
// `subscriptions` solo deja ver la propia clínica a sus miembros
// (`is_clinic_member`) — el staff de Esmalia no es miembro de ninguna.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireEsmaliaStaffEmail } from "@/lib/admin/staff-gate";
import type { CobroStaffFila } from "@/lib/admin/estado-cobro";

export type ClinicaStaffRow = {
  id: string;
  name: string;
  createdAt: string;
  /** `null` = todavía no se creó fila en `subscriptions` para esta clínica
   *  (clínica piloto anterior al trigger — ver `requiereLlamadaOSuscripcion`). */
  subscriptionStatus: string | null;
  trialEnd: string | null;
  /** Fila de cobro completa (mora, gracia, disputa). `null` = sin fila. */
  cobro: CobroStaffFila | null;
  onboardingCallAt: string | null;
  /** Métrica de activación (benchmark de onboarding, 25-sep): fecha de la
   *  PRIMERA cita real que se creó en esta clínica, o `null` si todavía no
   *  agendó ninguna. Derivada de `appointments.created_at` — sin tabla ni
   *  evento nuevo, para no necesitar una migración de schema. */
  firstAppointmentAt: string | null;
  /** Última vez que el staff extendió la prueba (quién, cuándo y cuántos
   *  días), o `null` si nunca. Sale de `trial_extensions`. */
  ultimaExtension: {
    at: string;
    byEmail: string;
    days: number;
    newTrialEnd: string;
    reason: string | null;
  } | null;
};

/** Máximo de días que se puede dar en una sola extensión (3 meses de la
 *  oferta de clínicas fundadoras, con margen). Misma cota que el CHECK de
 *  `trial_extensions.days`. */
export const MAX_DIAS_EXTENSION = 120;

/** ¿Se puede extender la prueba de esta clínica? Solo la prueba de la base:
 *  `trialing` y SIN suscripción en Stripe (si ya pasó por el checkout, el
 *  calendario lo lleva Stripe). Mismo criterio que la función SQL
 *  `extender_prueba_de_la_clinica`, que es la que manda; esto solo decide si
 *  se muestra el botón. */
export function puedeExtenderPrueba(cobro: CobroStaffFila | null): boolean {
  return !!cobro && cobro.status === "trialing" && !cobro.stripeSubscriptionId && !!cobro.trialEnd;
}

/** Traduce el error de la función SQL a un texto seguro para mostrar. */
export function mensajeDeExtensionFallida(codigo: string | undefined): string {
  switch (codigo) {
    case "sin_prueba":
      return "Esta clínica no tiene una prueba registrada.";
    case "no_es_prueba_de_la_base":
      return "Solo se puede extender una prueba que no pasó por Stripe.";
    case "no_extiende":
      return "La nueva fecha no es posterior al fin de prueba actual. Elige más días.";
    case "dias_invalidos":
      return `Los días tienen que estar entre 1 y ${MAX_DIAS_EXTENSION}.`;
    default:
      return "No pudimos extender la prueba.";
  }
}

const VENTANA_ACTIVACION_HORAS = 72;

/** `true` si la clínica agendó su primera cita dentro de las 72h de darse de
 *  alta — la métrica de activación de la recomendación #7 del benchmark de
 *  onboarding. `null` (no `false`) cuando todavía no hay dato suficiente
 *  (sin cita) para no mostrar una cruz roja a una clínica de ayer que puede
 *  activarse mañana — mismo criterio que los placeholders nullable del
 *  CLAUDE.md (regla 11: no fabricar un valor falso cuando no hay dato). */
export function activadaEn72h(
  createdAt: string,
  firstAppointmentAt: string | null,
): boolean | null {
  if (!firstAppointmentAt) return null;
  const horas =
    (new Date(firstAppointmentAt).getTime() - new Date(createdAt).getTime()) / 3_600_000;
  return horas >= 0 && horas <= VENTANA_ACTIVACION_HORAS;
}

/** Clínicas + su suscripción + si ya se hizo la llamada de puesta en marcha.
 *  Dos queries + Map en vez de un embedded `select('subscriptions(...)')` —
 *  mismo criterio que el resto del repo (CLAUDE.md: "evitar embedded select
 *  cuando los tipos generados no lo pillen"). */
export const listClinicsForStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClinicaStaffRow[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireEsmaliaStaffEmail(supabaseAdmin, context.userId, context.claims);

    const { data: clinics, error } = await supabaseAdmin
      .from("clinics")
      .select("id, name, created_at, onboarding_call_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error("No pudimos cargar las clínicas.");

    const clinicIds = (clinics ?? []).map((c) => c.id);
    // `*` y no columnas sueltas: `past_due_since` y `disputed_at`/`dispute_id`
    // llegan con migraciones propias; si alguna faltara, la pantalla muestra
    // "sin dato" en vez de fallar entera.
    const { data: subs, error: subsError } = clinicIds.length
      ? await supabaseAdmin.from("subscriptions").select("*").in("clinic_id", clinicIds)
      : { data: [], error: null };
    if (subsError) throw new Error("No pudimos cargar las suscripciones.");

    const subPorClinica = new Map((subs ?? []).map((s) => [s.clinic_id, s]));

    // Primera cita por clínica: reducido en memoria en vez de una agregación
    // SQL (GROUP BY MIN) porque supabase-js no la expresa directo y esta
    // pantalla es interna/de pocas filas — no vale la pena un RPC nuevo para
    // esto. Ordenado ascendente para que la primera aparición de cada
    // `clinic_id` en el Map ya sea la más antigua.
    const { data: primerasCitas } = clinicIds.length
      ? await supabaseAdmin
          .from("appointments")
          .select("clinic_id, created_at")
          .in("clinic_id", clinicIds)
          .order("created_at", { ascending: true })
      : { data: [] as { clinic_id: string; created_at: string }[] };

    const primeraCitaPorClinica = new Map<string, string>();
    for (const a of primerasCitas ?? []) {
      if (!primeraCitaPorClinica.has(a.clinic_id)) {
        primeraCitaPorClinica.set(a.clinic_id, a.created_at);
      }
    }

    // Última extensión por clínica (orden descendente: la primera aparición
    // de cada `clinic_id` es la más reciente). Si la migración todavía no
    // está aplicada la tabla no existe: se muestra "sin dato" en vez de
    // romper la pantalla entera.
    const { data: extensiones } = clinicIds.length
      ? await supabaseAdmin
          .from("trial_extensions")
          .select("clinic_id, extended_at, extended_by_email, days, new_trial_end, reason")
          .in("clinic_id", clinicIds)
          .order("extended_at", { ascending: false })
      : { data: [] };
    const ultimaExtensionPorClinica = new Map<
      string,
      NonNullable<ClinicaStaffRow["ultimaExtension"]>
    >();
    for (const e of extensiones ?? []) {
      if (!ultimaExtensionPorClinica.has(e.clinic_id)) {
        ultimaExtensionPorClinica.set(e.clinic_id, {
          at: e.extended_at,
          byEmail: e.extended_by_email,
          days: e.days,
          newTrialEnd: e.new_trial_end,
          reason: e.reason,
        });
      }
    }

    return (clinics ?? []).map((c) => {
      const sub = subPorClinica.get(c.id);
      return {
        id: c.id,
        name: c.name,
        createdAt: c.created_at,
        subscriptionStatus: sub?.status ?? null,
        trialEnd: sub?.trial_end ?? null,
        cobro: sub
          ? {
              clinicId: c.id,
              status: sub.status,
              trialEnd: sub.trial_end,
              currentPeriodEnd: sub.current_period_end,
              stripeSubscriptionId: sub.stripe_subscription_id,
              pastDueSince: sub.past_due_since ?? null,
              disputedAt: sub.disputed_at ?? null,
              disputeId: sub.dispute_id ?? null,
            }
          : null,
        onboardingCallAt: c.onboarding_call_at,
        firstAppointmentAt: primeraCitaPorClinica.get(c.id) ?? null,
        ultimaExtension: ultimaExtensionPorClinica.get(c.id) ?? null,
      };
    });
  });

/**
 * Marca la llamada de puesta en marcha como hecha. Idempotente: si la
 * clínica ya tenía `onboarding_call_at` seteado, el `.is(...)` de abajo hace
 * que el UPDATE no toque ninguna fila en vez de pisar la fecha original —
 * mismo espíritu que `consent_at` en marketing_leads (evidencia de CUÁNDO
 * pasó algo, no un valor que un segundo click deba poder correr en el
 * tiempo).
 */
export const marcarLlamadaHecha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireEsmaliaStaffEmail(supabaseAdmin, context.userId, context.claims);

    const { error } = await supabaseAdmin
      .from("clinics")
      .update({ onboarding_call_at: new Date().toISOString() })
      .eq("id", data.clinicId)
      .is("onboarding_call_at", null);
    if (error) throw new Error("No pudimos marcar la llamada como hecha.");

    return { ok: true };
  });

/**
 * Extiende la prueba de una clínica `p_dias` días a partir de hoy y deja
 * registrado quién y cuándo (`trial_extensions`). Toda la lógica y el
 * registro viven en la función SQL `extender_prueba_de_la_clinica`, que hace
 * el UPDATE y el INSERT en una sola transacción: acá solo se autoriza (staff
 * + MFA) y se traduce el error.
 */
export const extenderPrueba = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        dias: z.number().int().min(1).max(MAX_DIAS_EXTENSION),
        motivo: z.string().trim().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; nuevoFin: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = await requireEsmaliaStaffEmail(supabaseAdmin, context.userId, context.claims);

    const { data: nuevoFin, error } = await supabaseAdmin.rpc("extender_prueba_de_la_clinica", {
      p_clinic_id: data.clinicId,
      p_dias: data.dias,
      p_actor_id: context.userId,
      p_actor_email: email,
      p_motivo: data.motivo || undefined,
    });
    if (error || !nuevoFin) throw new Error(mensajeDeExtensionFallida(error?.message));

    return { ok: true, nuevoFin };
  });
