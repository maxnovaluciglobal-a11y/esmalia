import { createFileRoute } from "@tanstack/react-router";
import { cronAutorizado } from "@/lib/cron-auth.server";

/**
 * Reset de la clínica demo pública. Disparado por Vercel Cron (ver "crons" en
 * vercel.json) o manualmente con el mismo secret (`demo-reset.yml`).
 *
 * Dos modos:
 *  - Sin parámetros: el reseteo entero (función SQL `reset_demo_clinic()` más
 *    todos los pasos de siembra de `src/lib/demo/reseteo.server.ts`). Es el
 *    cron diario (05:05 UTC, la hora de menor tráfico en Chile).
 *  - `?solo-si-hace-falta=1`: el cron horario. Mira primero si la demo está al
 *    día respecto de HOY en el huso de la clínica y de que cada sección tenga
 *    datos; solo si no (por ejemplo pasada la medianoche de Santiago) la rehace.
 *    Así la demo no queda vacía durante el día aunque cambie la fecha.
 *
 * La función SQL es SECURITY DEFINER, así que sus INSERT/UPDATE/DELETE pasan
 * el trigger `block_demo_writes`; los pasos de siembra usan el rol de servicio.
 */
export const Route = createFileRoute("/api/demo-reset")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const secret = process.env.CRON_SECRET;
        if (!secret) {
          return new Response("CRON_SECRET no configurado", { status: 500 });
        }
        if (!cronAutorizado(auth, secret)) {
          return new Response("unauthorized", { status: 401 });
        }

        const soloSiHaceFalta = new URL(request.url).searchParams.has("solo-si-hace-falta");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { reiniciarLaDemo } = await import("@/lib/demo/reseteo.server");
        try {
          const r = await reiniciarLaDemo(supabaseAdmin, { soloSiHaceFalta });
          // Un paso que falla no tumba el reseteo (queda en el log); se informa.
          return new Response(
            r.fallos.length > 0
              ? `ok (${r.accion}); pasos con error: ${r.fallos.map((f) => f.paso).join(", ")}`
              : `ok (${r.accion})`,
            { status: 200 },
          );
        } catch (e) {
          const mensaje = e instanceof Error ? e.message : String(e);
          console.error("[demo-reset] failure", mensaje);
          return new Response(`reset error: ${mensaje}`, { status: 500 });
        }
      },
    },
  },
});
