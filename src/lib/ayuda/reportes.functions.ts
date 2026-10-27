// src/lib/ayuda/reportes.functions.ts
//
// ONB-09: la persona manda un problema o una sugerencia desde la app; llega
// al equipo de Esmalia (tabla `feedback_reports` + aviso por correo a
// ESMALIA_STAFF_EMAILS) y se lee en /admin/reportes.
//
// - La fila se inserta con el cliente del usuario: la RLS exige que sea
//   miembro de la clínica y que `created_by` sea él. La clínica no puede
//   leerla después (no hay política de lectura para `authenticated`).
// - La captura, si la hay, la sube el servidor al bucket privado
//   `reportes-de-ayuda` (sin políticas: solo service_role la lee).
// - El aviso por correo nunca hace fallar el envío.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireEsmaliaStaffEmail } from "@/lib/admin/staff-gate";
import {
  leerCaptura,
  lineasDelAviso,
  reporteSchema,
  rutaSinConsulta,
  type TipoReporte,
} from "@/lib/ayuda/reportes";

const BUCKET = "reportes-de-ayuda";

export const enviarReporte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => reporteSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; conCaptura: boolean }> => {
    const { supabase, userId } = context;
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    const limite = checkRateLimit(userId, {
      scope: "reporte-ayuda",
      windowMs: 10 * 60_000,
      max: 6,
    });
    if (limite.limited) {
      throw new Error("Ya nos mandaste varios mensajes seguidos. Prueba de nuevo en unos minutos.");
    }

    const { data: miembro } = await supabase
      .from("clinic_members")
      .select("role")
      .eq("clinic_id", data.clinicId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!miembro) throw new Error("No tienes permisos.");
    const { data: clinica } = await supabase
      .from("clinics")
      .select("name, is_demo")
      .eq("id", data.clinicId)
      .maybeSingle();
    if (clinica?.is_demo) {
      throw new Error("En la demo no se envían reportes. Escríbenos por WhatsApp o correo.");
    }

    const captura = data.captura ? leerCaptura(data.captura) : null;
    if (data.captura && !captura) {
      throw new Error("La captura no es una imagen válida o pesa más de 1,5 MB.");
    }

    const id = crypto.randomUUID();
    let rutaCaptura: string | null = null;
    if (captura) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const extension =
        captura.mime === "image/png" ? "png" : captura.mime === "image/webp" ? "webp" : "jpg";
      const path = `${data.clinicId}/${id}.${extension}`;
      const { error: errorSubida } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, Buffer.from(captura.base64, "base64"), {
          contentType: captura.mime,
          upsert: false,
        });
      if (errorSubida) {
        console.error("[reporte] no se pudo subir la captura:", errorSubida.message);
        throw new Error("No pudimos guardar la captura. Prueba enviar el mensaje sin ella.");
      }
      rutaCaptura = path;
    }

    const ruta = data.ruta ? rutaSinConsulta(data.ruta) : null;
    const userAgent = getRequest()?.headers.get("user-agent")?.slice(0, 400) ?? null;
    const { error } = await supabase.from("feedback_reports").insert({
      id,
      clinic_id: data.clinicId,
      created_by: userId,
      kind: data.tipo,
      message: data.mensaje,
      screen_path: ruta,
      screen_label: data.pantalla ?? null,
      screenshot_path: rutaCaptura,
      user_agent: userAgent,
      viewport: data.viewport ?? null,
    });
    if (error) {
      console.error("[reporte] insert falló:", error.message);
      throw new Error("No pudimos enviar tu mensaje. Intenta de nuevo en un momento.");
    }

    const { data: perfil } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    const { enviarAvisoStaff } = await import("@/lib/admin/aviso-staff.server");
    const { appOrigin } = await import("@/lib/app-origin.server");
    await enviarAvisoStaff({
      asunto: data.tipo === "problema" ? "Problema reportado" : "Sugerencia",
      clinica: clinica?.name ?? null,
      clave: `reporte-ayuda:${id}`,
      enlaceAdmin: `${appOrigin()}/admin/reportes`,
      lineas: lineasDelAviso({
        tipo: data.tipo,
        mensaje: data.mensaje,
        clinica: clinica?.name ?? null,
        autor: perfil?.full_name ?? null,
        rol: miembro.role,
        ruta,
        pantalla: data.pantalla ?? null,
        conCaptura: Boolean(rutaCaptura),
      }),
    });

    return { ok: true, conCaptura: Boolean(rutaCaptura) };
  });

// ── Staff de Esmalia: /admin/reportes ─────────────────────────────────────

export type ReporteStaff = {
  id: string;
  clinica: string | null;
  autor: string | null;
  tipo: TipoReporte;
  mensaje: string;
  ruta: string | null;
  pantalla: string | null;
  viewport: string | null;
  estado: "nuevo" | "visto" | "resuelto";
  creado: string;
  /** URL firmada por 10 minutos, si hay captura. */
  captura: string | null;
};

export const listarReportesStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReporteStaff[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireEsmaliaStaffEmail(supabaseAdmin, context.userId, context.claims);

    const { data, error } = await supabaseAdmin
      .from("feedback_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("No pudimos cargar los reportes.");
    const filas = data ?? [];

    const clinicIds = [...new Set(filas.map((f) => f.clinic_id))];
    const autores = [...new Set(filas.map((f) => f.created_by))];
    const [{ data: clinicas }, { data: perfiles }] = await Promise.all([
      clinicIds.length
        ? supabaseAdmin.from("clinics").select("id, name").in("id", clinicIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      autores.length
        ? supabaseAdmin.from("profiles").select("id, full_name").in("id", autores)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    ]);
    const nombreClinica = new Map((clinicas ?? []).map((c) => [c.id, c.name]));
    const nombreAutor = new Map((perfiles ?? []).map((p) => [p.id, p.full_name]));

    const conCaptura = filas.filter((f) => f.screenshot_path).map((f) => f.screenshot_path!);
    const firmadas = new Map<string, string>();
    if (conCaptura.length) {
      const { data: urls } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrls(conCaptura, 600);
      for (const u of urls ?? []) if (u.path && u.signedUrl) firmadas.set(u.path, u.signedUrl);
    }

    return filas.map((f) => ({
      id: f.id,
      clinica: nombreClinica.get(f.clinic_id) ?? null,
      autor: nombreAutor.get(f.created_by) ?? null,
      tipo: f.kind as TipoReporte,
      mensaje: f.message,
      ruta: f.screen_path,
      pantalla: f.screen_label,
      viewport: f.viewport,
      estado: f.status as ReporteStaff["estado"],
      creado: f.created_at,
      captura: f.screenshot_path ? (firmadas.get(f.screenshot_path) ?? null) : null,
    }));
  });

export const cambiarEstadoReporteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ id: z.string().uuid(), estado: z.enum(["nuevo", "visto", "resuelto"]) })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireEsmaliaStaffEmail(supabaseAdmin, context.userId, context.claims);
    const { error } = await supabaseAdmin
      .from("feedback_reports")
      .update({ status: data.estado })
      .eq("id", data.id);
    if (error) throw new Error("No pudimos cambiar el estado.");
    return { ok: true };
  });
