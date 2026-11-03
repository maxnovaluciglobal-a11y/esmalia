import { createFileRoute } from "@tanstack/react-router";

import { cronAutorizado } from "@/lib/cron-auth.server";
import { semanaReportada, tocaEnviar } from "@/lib/marketing/embudo-semanal";

/**
 * Reporte semanal del embudo a la cuenta de empresa, igual al de MOY IQ. Lo
 * dispara Vercel Cron los lunes a cada hora (vercel.json, minuto 12) y, de
 * respaldo, `.github/workflows/embudo-semanal.yml` (minuto 42), los dos con
 * `CRON_SECRET`. Solo envía el lunes de 12:00 a 16:59 hora de Chile.
 *
 * Con `Authorization: Bearer $CRON_SECRET`, `?modo=dry_run` devuelve los números
 * y el asunto sin enviar, y `?modo=preview` manda una copia marcada como vista
 * previa. Definiciones: `docs/MEDICION.md`.
 */
const MODOS = ["cron", "dry_run", "preview"] as const;
type Modo = (typeof MODOS)[number];

export const Route = createFileRoute("/api/embudo-semanal")({
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

        const modo = (new URL(request.url).searchParams.get("modo") ?? "cron") as Modo;
        if (!MODOS.includes(modo)) return json({ error: "modo inválido" }, 400);

        const ahora = new Date();
        const semana = semanaReportada(ahora);
        if (modo === "cron" && !tocaEnviar(ahora)) {
          return json({ estado: "fuera-de-horario", semana });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { enviarReporte, leerDatosDelReporte } =
            await import("@/lib/marketing/embudo-semanal.server");
          const datos = await leerDatosDelReporte(supabaseAdmin, semana);
          if (modo === "dry_run") return json({ estado: "dry_run", datos });
          const estado = await enviarReporte(datos, { vistaPrevia: modo === "preview" });
          console.log(`[embudo-semanal] modo=${modo} semana=${semana} estado=${estado}`);
          return json({ estado, semana });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[embudo-semanal] falló", msg);
          const { capturarErrorDelServidor } = await import("@/lib/sentry.server");
          await capturarErrorDelServidor(new Error(`embudo-semanal: ${msg}`), {
            ruta: "/api/embudo-semanal",
            metodo: "GET",
          });
          return json({ estado: "error", semana }, 500);
        }
      },
    },
  },
});
