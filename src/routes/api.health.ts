import { createFileRoute } from "@tanstack/react-router";
import { respuestaDeSalud } from "@/lib/salud";

/**
 * Healthcheck público, sin auth. Lo consultan el monitor de uptime de Sentry
 * (SLI de docs/SLO.md) y la página pública /estado desde el navegador.
 *
 * Responde 200 si el proceso está vivo y un ping trivial a Supabase (select
 * de 1 id sobre `clinics`, sin filtrar por clínica) funciona; 503 si la base
 * no contesta. El cuerpo es SIEMPRE `{status, timestamp}`: ni el mensaje de
 * error, ni el id leído, ni versión, región o variables de entorno. El detalle
 * va solo al log del servidor. `no-store` para que ningún CDN ni navegador
 * sirva un "ok" viejo durante una caída.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("clinics").select("id").limit(1);
          if (error) {
            console.error("[health] supabase ping failed:", error.message);
            return respuestaDeSalud(false);
          }
        } catch (err) {
          console.error("[health] supabase ping threw:", (err as Error).message);
          return respuestaDeSalud(false);
        }

        return respuestaDeSalud(true);
      },
    },
  },
});
