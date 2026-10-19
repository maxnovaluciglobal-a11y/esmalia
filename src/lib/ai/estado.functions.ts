import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * ¿Está prendida Patty en este servidor? La UI lo usa para mostrar
 * "Patty está en habilitación" en vez de botones que fallarían. No expone
 * proveedor, modelo ni claves.
 */
export const getEstadoIa = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ habilitada: boolean }> => {
    const { iaHabilitada } = await import("@/lib/ai-gateway.server");
    return { habilitada: iaHabilitada() };
  });
