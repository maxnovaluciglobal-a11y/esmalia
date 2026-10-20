import { createFileRoute } from "@tanstack/react-router";

import { TOPE_CLINICAS_POR_CORRIDA } from "@/lib/messaging/digest-diario";
import { cronAutorizado } from "@/lib/cron-auth.server";

/**
 * Correos programados a la clínica: aviso de llamada de puesta en marcha
 * pendiente (una vez, 24 h después del alta), aviso de fin de prueba (T-3 y
 * T-0) y el reporte "Tu semana en la clínica" de los lunes. Lo dispara cada hora Vercel
 * Cron (vercel.json, minuto 47) y, de respaldo,
 * `.github/workflows/lifecycle-emails.yml` (minuto 17), los dos con
 * `CRON_SECRET`.
 *
 * ⚠️ Nunca le escribe a un paciente: los destinatarios salen de
 * `clinic_members` (dueños y administradores).
 *
 * Frenos: interruptor `LIFECYCLE_EMAILS_ENABLED` (sin él no toca la base),
 * ventana local 8:00-20:59 de cada clínica, la demo afuera, idempotencia en
 * `lifecycle_emails` y tope de clínicas y de correos por corrida.
 */
export const Route = createFileRoute("/api/lifecycle-emails")({
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

        if (process.env.LIFECYCLE_EMAILS_ENABLED !== "true") {
          console.log("[lifecycle-emails] apagado (LIFECYCLE_EMAILS_ENABLED != true)");
          return json({ habilitado: false });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { correrCorreosProgramados } = await import("@/lib/email/ciclo-de-vida.server");
        try {
          const resumen = await correrCorreosProgramados(
            supabaseAdmin,
            new Date(),
            TOPE_CLINICAS_POR_CORRIDA,
          );
          // Rastro SIEMPRE, también cuando no envía nada: "corrió y no había
          // nada" y "nunca corrió" no pueden verse iguales.
          console.log(
            `[lifecycle-emails] revisadas=${resumen.clinicasRevisadas} enviados=${resumen.enviados} omitidos=${resumen.omitidos} errores=${resumen.errores} tope=${resumen.topeAlcanzado}`,
          );
          return json(resumen);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[lifecycle-emails] falló la corrida", msg);
          return json({ habilitado: true, error: msg }, 500);
        }
      },
    },
  },
});
