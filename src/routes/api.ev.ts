// src/routes/api.ev.ts
//
// Embudo mínimo propio. Existe porque la CSP prohíbe PostHog/GA/GTM
// (script-src 'self'), y sin ninguna medición no hay forma de saber si la
// calculadora convierte. Same-origin, cubierto por el rate limiter de /api/.
// Tracking plan completo: src/lib/marketing/medicion.ts y docs/MEDICION.md.
// Acá sólo entran los eventos anónimos del navegador; los de la cuenta y los
// del servidor no se aceptan por esta puerta (cualquiera puede hacer un POST).

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { EVENTOS_CLIENTE, paisDeCabecera } from "@/lib/marketing/medicion";

const MAX_PROPS = 20;
/** Un evento legítimo pesa unos cientos de bytes. */
const MAX_BYTES = 4096;

const Esquema = z.object({
  name: z.enum(EVENTOS_CLIENTE),
  // Sólo buckets y strings cortos. Nunca cifras de la clínica.
  // Tope de claves (auditoría 10-oct-2026): sin él, un POST anónimo podía
  // meter miles de claves por fila en `marketing_events`.
  props: z
    .record(z.string().max(40), z.union([z.string().max(60), z.boolean()]))
    .refine((p) => Object.keys(p).length <= MAX_PROPS, "Demasiadas propiedades.")
    .optional(),
  sessionHash: z.string().max(64).optional(),
});

export const Route = createFileRoute("/api/ev")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let cuerpo: unknown;
        try {
          const texto = await request.text();
          if (texto.length > MAX_BYTES) return new Response(null, { status: 204 });
          cuerpo = JSON.parse(texto);
        } catch {
          return new Response(null, { status: 204 });
        }
        const parsed = Esquema.safeParse(cuerpo);
        // La telemetría nunca rompe nada ni informa al cliente: 204 siempre.
        if (!parsed.success) return new Response(null, { status: 204 });

        // País de la visita por la cabecera de Vercel: se guarda el país (dos
        // letras), nunca la IP. Lo pone el servidor, no el cliente.
        let props = parsed.data.props ?? null;
        if (parsed.data.name === "page_view") {
          const pais = paisDeCabecera(request.headers.get("x-vercel-ip-country"));
          if (pais) props = { ...props, pais };
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("marketing_events").insert({
            name: parsed.data.name,
            props,
            session_hash: parsed.data.sessionHash ?? null,
          });
          if (error) {
            console.error("[ev] insert failed:", error.message);
          }
        } catch (err) {
          console.error("[ev] insert threw:", (err as Error).message);
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
