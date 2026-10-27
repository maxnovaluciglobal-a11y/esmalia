// src/lib/ayuda/progreso.functions.ts
//
// Progreso de la ayuda de cada persona (ONB-03, ONB-04, NAV-10): recorridos
// vistos, lecciones vistas y novedades leídas. Tabla `help_progress`, cada
// usuario solo sus filas (RLS user_id = auth.uid()).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const TIPOS_PROGRESO = ["tour", "leccion", "novedad"] as const;
export type TipoProgreso = (typeof TIPOS_PROGRESO)[number];

/** Progreso agrupado por tipo: ids vistos. */
export type ProgresoDeAyuda = Record<TipoProgreso, string[]>;

const clave = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "Id de contenido inválido.");

export const listarProgresoDeAyuda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProgresoDeAyuda> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("help_progress")
      .select("kind, item_key")
      .eq("user_id", userId)
      .limit(2000);
    if (error) throw new Error("No pudimos cargar tu avance en la ayuda.");
    const salida: ProgresoDeAyuda = { tour: [], leccion: [], novedad: [] };
    for (const fila of data ?? []) {
      if ((TIPOS_PROGRESO as readonly string[]).includes(fila.kind)) {
        salida[fila.kind as TipoProgreso].push(fila.item_key);
      }
    }
    return salida;
  });

const marcarSchema = z.object({
  tipo: z.enum(TIPOS_PROGRESO),
  ids: z.array(clave).min(1).max(100),
  /** false = desmarcar (volver a "no vista"). */
  hecho: z.boolean().default(true),
});

export const marcarProgresoDeAyuda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => marcarSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    if (data.hecho) {
      const { error } = await supabase.from("help_progress").upsert(
        data.ids.map((id) => ({ user_id: userId, kind: data.tipo, item_key: id })),
        { onConflict: "user_id,kind,item_key", ignoreDuplicates: true },
      );
      if (error) throw new Error("No pudimos guardar tu avance.");
    } else {
      const { error } = await supabase
        .from("help_progress")
        .delete()
        .eq("user_id", userId)
        .eq("kind", data.tipo)
        .in("item_key", data.ids);
      if (error) throw new Error("No pudimos guardar tu avance.");
    }
    return { ok: true };
  });
