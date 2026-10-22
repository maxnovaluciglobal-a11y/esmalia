import { createFileRoute } from "@tanstack/react-router";

import {
  TIMEZONE_POR_DEFECTO,
  TOPE_CLINICAS_POR_CORRIDA,
  armarResumen,
  desdeCuandoBuscarDuplicado,
  esHoraDelResumen,
} from "@/lib/messaging/digest-diario";
import { ROLES_BANDEJA, notifyClinicStaff } from "@/lib/messaging/notifications.functions";
import { cronAutorizado } from "@/lib/cron-auth.server";

/**
 * Resumen diario para el equipo de cada clínica (F3 del plan Clinera).
 * Disparado por Vercel Cron cada hora (ver "crons" en vercel.json).
 *
 * ⚠️ **Este cron no le escribe a ningún paciente.** Es una decisión, no una
 * limitación técnica: el outreach se arma en la app y lo despacha una
 * persona (ver el comentario de `listPendingOutreach`). Acá solo se cuenta
 * lo pendiente y se avisa adentro de la app. Estructuralmente el handler no
 * importa ninguna función de envío, así que no puede mandar nada aunque
 * alguien lo edite distraído.
 *
 * Los frenos, en orden:
 *  1. Hora local — corre cada hora y solo actúa donde son entre las 8:00 y las 11:59 (ventana: GitHub no garantiza el disparo horario).
 *  2. Una por día — no repite si ya hubo un resumen en las últimas 20 h.
 *  3. Silencio — si no hay nada pendiente, nadie recibe nada.
 *  4. La demo queda afuera — se resetea sola todos los días.
 *  5. Tope de clínicas por corrida, para no pasarse del tiempo de la función.
 */

const HORAS_48 = 48 * 60 * 60 * 1000;
/** Cuántos mensajes mirar hacia atrás para deducir hilos sin responder. */
const VENTANA_MENSAJES = 300;

export const Route = createFileRoute("/api/daily-digest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (!secret) return new Response("CRON_SECRET no configurado", { status: 500 });
        if (!cronAutorizado(request.headers.get("authorization"), secret)) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const ahora = new Date();

        // Mantenimiento horario, antes de los frenos (Ola 3, PLA-06): los
        // presupuestos pendientes cuya validez ya pasó quedan vencidos en
        // todas las clínicas, en su huso. No avisa ni le escribe a nadie; la
        // función es idempotente y la app igual vence al listar.
        const { data: vencidos, error: errVencer } = await supabaseAdmin.rpc(
          "vencer_presupuestos",
          {},
        );
        if (errVencer) console.error("[daily-digest] vencer_presupuestos", errVencer.message);
        else console.log(`[daily-digest] presupuestos_vencidos=${vencidos ?? 0}`);

        const { data: clinicas, error } = await supabaseAdmin
          .from("clinics")
          .select("id, timezone, is_demo")
          .limit(TOPE_CLINICAS_POR_CORRIDA);
        if (error) {
          console.error("[daily-digest] no se pudieron listar las clínicas", error.message);
          return new Response(`error: ${error.message}`, { status: 500 });
        }

        // Freno 1 y 4: solo las clínicas donde ahora mismo son las 8, y nunca la demo.
        const enHorario = (clinicas ?? []).filter(
          (c) => !c.is_demo && esHoraDelResumen(ahora, c.timezone || TIMEZONE_POR_DEFECTO),
        );

        let avisadas = 0;
        for (const clinica of enHorario) {
          // Freno 2: ¿ya salió el resumen de hoy?
          const { count: yaHubo } = await supabaseAdmin
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("clinic_id", clinica.id)
            .eq("kind", "daily_digest")
            .gte("created_at", desdeCuandoBuscarDuplicado(ahora));
          if ((yaHubo ?? 0) > 0) continue;

          const insumos = await contarPendientes(supabaseAdmin, clinica.id, ahora);
          const resumen = armarResumen(insumos);
          if (!resumen) continue; // Freno 3: sin novedades, sin aviso.

          const enviados = await notifyClinicStaff(supabaseAdmin, {
            clinicId: clinica.id,
            roles: ROLES_BANDEJA,
            kind: "daily_digest",
            title: resumen.titulo,
            body: resumen.cuerpo,
            link: resumen.link,
          });
          if (enviados > 0) avisadas += 1;
        }

        // Deja rastro SIEMPRE, también cuando no avisa a nadie. Sin esto
        // "corrió y no había nada" y "nunca corrió" se ven idénticos desde
        // afuera, que es el mismo modo de falla que un backup incapaz de
        // detectar su propia incompletitud.
        console.log(
          `[daily-digest] clinicas=${(clinicas ?? []).length} en_horario=${enHorario.length} avisadas=${avisadas}`,
        );

        return new Response(JSON.stringify({ revisadas: enHorario.length, avisadas }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});

type ClienteAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

/**
 * Cuenta lo pendiente de una clínica.
 *
 * Sobre los recordatorios: la pantalla `/recordatorios` deduplica **por
 * canal** (un aviso por WhatsApp no tapa el de email). Para el resumen eso
 * sería una trampa: mientras no haya `RESEND_API_KEY` el canal email nunca
 * se marca, así que toda cita quedaría "pendiente" para siempre y el número
 * no bajaría nunca. Acá se cuenta la medida más gruesa y honesta: citas de
 * las próximas 48 h a las que todavía no se les mandó **ningún** aviso, por
 * ningún canal. El resumen es un empujón, no la fuente de verdad.
 */
async function contarPendientes(
  supabaseAdmin: ClienteAdmin,
  clinicId: string,
  ahora: Date,
): Promise<{ recordatorios: number; sinResponder: number }> {
  const hasta = new Date(ahora.getTime() + HORAS_48).toISOString();

  const [citas, mensajes] = await Promise.all([
    supabaseAdmin
      .from("appointments")
      .select("id")
      .eq("clinic_id", clinicId)
      .neq("status", "cancelada")
      .gte("starts_at", ahora.toISOString())
      .lte("starts_at", hasta),
    supabaseAdmin
      .from("messages")
      .select("patient_id, direction")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false })
      .limit(VENTANA_MENSAJES),
  ]);

  let recordatorios = 0;
  const ids = (citas.data ?? []).map((c) => c.id);
  if (ids.length > 0) {
    const { data: avisadas } = await supabaseAdmin
      .from("messages")
      .select("appointment_id")
      .eq("clinic_id", clinicId)
      .in("appointment_id", ids)
      .in("template_kind", ["appointment_reminder", "appointment_checkin"])
      .in("status", ["sent", "queued"]);
    const conAviso = new Set((avisadas ?? []).map((m) => m.appointment_id));
    recordatorios = ids.filter((id) => !conAviso.has(id)).length;
  }

  // Mismo criterio que el badge de la bandeja: un hilo está sin responder
  // cuando su mensaje más nuevo es del paciente.
  const visto = new Set<string>();
  let sinResponder = 0;
  for (const m of mensajes.data ?? []) {
    if (!m.patient_id || visto.has(m.patient_id)) continue;
    visto.add(m.patient_id);
    if (m.direction === "inbound") sinResponder += 1;
  }

  return { recordatorios, sinResponder };
}
