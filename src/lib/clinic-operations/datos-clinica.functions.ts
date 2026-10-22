import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";
import {
  camposDatosClinica,
  errorRutEmpresa,
  type DatosClinica,
} from "@/lib/clinic-operations/datos-clinica";
import { mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

const SIN_PERMISO = "No tienes permisos para ver o editar los datos de la clínica.";

/** Datos de la clínica activa. Par en el servidor de `requirePermission("settings:manage")`. */
export const getDatosClinica = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<DatosClinica> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage", SIN_PERMISO);
    const { data: row, error } = await supabase
      .from("clinics")
      .select(
        "id, name, legal_name, tax_id, country, currency, timezone, business_activity, tax_address, tax_commune, tax_receipt_kind",
      )
      .eq("id", data.clinicId)
      .maybeSingle();
    if (error || !row)
      throw new Error(mensajeDb(error, "No pudimos cargar los datos de la clínica."));
    return {
      id: row.id,
      name: row.name,
      legalName: row.legal_name,
      taxId: row.tax_id,
      country: row.country,
      currency: row.currency,
      timezone: row.timezone,
      giro: row.business_activity,
      direccionTributaria: row.tax_address,
      comunaTributaria: row.tax_commune,
      tipoBoleta:
        row.tax_receipt_kind === "exenta" || row.tax_receipt_kind === "afecta"
          ? row.tax_receipt_kind
          : null,
    };
  });

/**
 * Edita la clínica actual: nombre, datos tributarios (FIN-16: razón social,
 * RUT, giro, dirección y comuna tributarias, tipo de boleta) y zona horaria. País y moneda quedan fuera a propósito (ver `datos-clinica.ts`).
 * RLS (`clinics_update_managers`) ya exige `can_manage_clinic`; esto lo
 * repite con la matriz de la app y el modo solo lectura (`requireEscritura`).
 */
export const updateDatosClinica = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid() }).merge(camposDatosClinica).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage", SIN_PERMISO);
    const { data: actual } = await supabase
      .from("clinics")
      .select("country, tax_id")
      .eq("id", data.clinicId)
      .maybeSingle();
    // Solo si cambia: una clínica con un RUT viejo mal escrito puede seguir
    // guardando el resto (mismo criterio que el trigger de la base).
    if (actual && (data.taxId || null) !== actual.tax_id) {
      const errorRut = errorRutEmpresa(data.taxId, actual.country);
      if (errorRut) throw new Error(errorRut);
    }
    const { data: fila, error } = await supabase
      .from("clinics")
      .update({
        name: data.name,
        legal_name: data.legalName || null,
        tax_id: data.taxId || null,
        timezone: data.timezone,
        business_activity: data.giro || null,
        tax_address: data.direccionTributaria || null,
        tax_commune: data.comunaTributaria || null,
        tax_receipt_kind: data.tipoBoleta || null,
      })
      .eq("id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos guardar los datos de la clínica."));
    if (!fila) throw new Error(SIN_PERMISO);
    return { ok: true as const };
  });
