import { createFileRoute } from "@tanstack/react-router";

import { cronAutorizado } from "@/lib/cron-auth.server";
import { TOPE_CLINICAS_POR_CORRIDA } from "@/lib/messaging/digest-diario";

/** Tope de correos a pacientes por corrida (todas las clínicas juntas). */
const TOPE_CORREOS_POR_CORRIDA = 300;

/**
 * Correos automáticos al PACIENTE (Ola 7 · frente B): confirmación al
 * agendar (REC-03), recordatorio N horas antes (REC-02), encuesta después de
 * la cita (MKT-08) y el link del formulario (MKT-07). Lo dispara cada hora
 * Vercel Cron (vercel.json, minuto 27) y, de respaldo,
 * `.github/workflows/patient-emails.yml` (minuto 57), los dos con
 * `CRON_SECRET`.
 *
 * Frenos: freno de emergencia `PATIENT_EMAILS_DISABLED=true` (no toca la base), la
 * configuración de cada clínica (todo apagado por defecto), ventana local
 * 8:00-20:59, la demo afuera, baja, tutor, modo de prueba de la clínica e
 * idempotencia en `patient_email_dispatches`. Ver docs/CORREOS.md.
 *
 * ⚠️ Nunca manda WhatsApp: solo correo.
 */
export const Route = createFileRoute("/api/patient-emails")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (!secret) return new Response("CRON_SECRET no configurado", { status: 500 });
        if (!cronAutorizado(request.headers.get("authorization"), secret)) {
          return new Response("unauthorized", { status: 401 });
        }

        const json = (cuerpo: unknown, status = 200) =>
          new Response(JSON.stringify(cuerpo), {
            status,
            headers: { "content-type": "application/json" },
          });

        if (process.env.PATIENT_EMAILS_DISABLED === "true") {
          console.log("[patient-emails] apagado (PATIENT_EMAILS_DISABLED = true)");
          return json({ habilitado: false });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { correrCorreosAPacientes } =
          await import("@/lib/notificaciones-pacientes/cron.server");
        const { appOrigin } = await import("@/lib/app-origin.server");
        const { enlaceGestionCita } = await import("@/lib/reserva/enlace-cita.server");
        try {
          const resumen = await correrCorreosAPacientes(supabaseAdmin, new Date(), {
            appUrl: appOrigin(),
            topeClinicas: TOPE_CLINICAS_POR_CORRIDA,
            topeCorreos: TOPE_CORREOS_POR_CORRIDA,
            // REC-11: botones "Confirmar asistencia" / "Cancelar o reagendar"
            // hacia /mi-cita/:token.
            enlaceGestion: enlaceGestionCita,
          });
          // Rastro SIEMPRE, también cuando no envía nada.
          console.log(
            `[patient-emails] revisadas=${resumen.clinicasRevisadas} enviados=${resumen.enviados} omitidos=${resumen.omitidos} duplicados=${resumen.duplicados} errores=${resumen.errores} tope=${resumen.topeAlcanzado}`,
          );
          return json(resumen);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[patient-emails] falló la corrida", msg);
          return json({ habilitado: true, error: msg }, 500);
        }
      },
    },
  },
});
