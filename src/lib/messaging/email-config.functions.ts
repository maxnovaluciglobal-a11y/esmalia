import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicRole } from "@/lib/access/clinic-guards.server";
import { mensajeDb } from "@/lib/db-errors";
import {
  DEFAULT_EMAIL_SANDBOX,
  clampMinEntregas,
  normalizeEmail,
  type EmailSandboxConfig,
} from "@/lib/messaging/email-sandbox";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/** Pruebas de email y Modo prueba de email son herramientas del propietario
 * (UX-13): par en el servidor del `requireOwner()` de sus rutas. El envío
 * real (`email.server.ts`) lee la config por su cuenta y no pasa por acá. */
const SOLO_PROPIETARIO = "Solo el propietario de la clínica puede ver la configuración de email.";

type EmailSandboxRow = {
  mode: string;
  redirect_to: string;
  allowlist: string[];
  redirect_enabled: boolean;
  prefix_subject: boolean;
  min_entregas_produccion: number;
};

function rowToConfig(row: EmailSandboxRow): EmailSandboxConfig {
  return {
    mode: row.mode === "production" ? "production" : "sandbox",
    redirectTo: row.redirect_to ?? "",
    allowlist: Array.isArray(row.allowlist) ? row.allowlist : [],
    redirectEnabled: row.redirect_enabled,
    prefixSubject: row.prefix_subject,
    minEntregasProduccion: clampMinEntregas(row.min_entregas_produccion),
  };
}

/** Lee la config de sandbox de email de una clínica desde la DB. Sin fila =
 * DEFAULT_EMAIL_SANDBOX (modo sandbox, default seguro). Es la única fuente de
 * verdad — la misma que consulta el servidor al enviar. */
export const getEmailSandboxConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<EmailSandboxConfig> => {
    await requireClinicRole(
      context.supabase,
      data.clinicId,
      context.userId,
      ["owner"],
      SOLO_PROPIETARIO,
    );
    const { data: row, error } = await context.supabase
      .from("email_sandbox_config")
      .select(
        "mode, redirect_to, allowlist, redirect_enabled, prefix_subject, min_entregas_produccion",
      )
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error)
      throw new Error(
        mensajeDb(error, "No pudimos cargar la configuración de email de la clínica."),
      );
    if (!row) return DEFAULT_EMAIL_SANDBOX;
    return rowToConfig(row as EmailSandboxRow);
  });

export const setEmailSandboxConfig = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        mode: z.enum(["sandbox", "production"]),
        redirectTo: z.string().trim().max(200),
        allowlist: z.array(z.string().trim().max(200)).max(100),
        redirectEnabled: z.boolean(),
        prefixSubject: z.boolean(),
        minEntregasProduccion: z.number().int().min(0).max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireClinicRole(
      context.supabase,
      data.clinicId,
      context.userId,
      ["owner"],
      SOLO_PROPIETARIO,
    );
    const allowlist = Array.from(
      new Set(data.allowlist.map(normalizeEmail).filter((e) => e.length > 0)),
    );
    const { error } = await context.supabase.from("email_sandbox_config").upsert(
      {
        clinic_id: data.clinicId,
        mode: data.mode,
        redirect_to: normalizeEmail(data.redirectTo),
        allowlist,
        redirect_enabled: data.redirectEnabled,
        prefix_subject: data.prefixSubject,
        min_entregas_produccion: clampMinEntregas(data.minEntregasProduccion),
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clinic_id" },
    );
    if (error) throw new Error("No tienes permisos para editar la configuración de email.");
    return { ok: true };
  });
