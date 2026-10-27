/**
 * MKT-08 · Encuesta NPS después de la cita: server functions de la página
 * pública `/encuesta/$token` (sin login; exentas del modo solo lectura en
 * `ESCRITURA_EXENTA`, validan el token en el servidor y llaman a la base con
 * el rol de servicio).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { huellaDeSecreto } from "@/lib/firma-distancia/token";

import { TokenSchema } from "./formulario";
import { exigirLimitePublico, objeto, texto } from "./publico.server";

export type EstadoEncuesta = "abierta" | "respondida" | "vencida" | "invalida";

export interface EncuestaAbierta {
  estado: EstadoEncuesta;
  clinica: string | null;
  zona: string;
  cita: string | null;
  profesional: string | null;
}

export const abrirEncuesta = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: TokenSchema }).parse(input))
  .handler(async ({ data }): Promise<EncuestaAbierta> => {
    exigirLimitePublico();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await supabaseAdmin.rpc("encuesta_nps_abrir", {
      p_token_hash: await huellaDeSecreto(data.token),
    });
    if (error) throw new Error("No pudimos abrir la encuesta. Vuelve a intentarlo.");
    const j = objeto(r);
    return {
      estado: (texto(j.estado) ?? "invalida") as EstadoEncuesta,
      clinica: texto(j.clinica),
      zona: texto(j.zona) ?? "America/Santiago",
      cita: texto(j.cita),
      profesional: texto(j.profesional),
    };
  });

export type RespuestaEncuesta =
  | { estado: "gracias"; promotor: boolean; resenaUrl: string | null }
  | { estado: "respondida" | "vencida" | "invalida" };

export const responderEncuesta = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        token: TokenSchema,
        nota: z.number().int().min(0).max(10),
        comentario: z.string().trim().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<RespuestaEncuesta> => {
    exigirLimitePublico();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await supabaseAdmin.rpc("encuesta_nps_responder", {
      p_token_hash: await huellaDeSecreto(data.token),
      p_score: data.nota,
      p_comment: data.comentario ?? "",
    });
    if (error) throw new Error("No pudimos guardar tu respuesta. Vuelve a intentarlo.");
    const j = objeto(r);
    const estado = texto(j.estado);
    if (estado === "gracias") {
      return { estado, promotor: j.promotor === true, resenaUrl: texto(j.resena_url) };
    }
    return { estado: (estado ?? "invalida") as "respondida" | "vencida" | "invalida" };
  });
