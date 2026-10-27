// Lectura de los descuentos de afiliación de un paciente (cierre · ítem 2).
// Solo servidor: la usan `createQuote`, `updateQuote`, la sugerencia del
// odontograma y la consulta del diálogo. El descuento NUNCA se acepta del
// cliente: se vuelve a leer de la empresa o del plan en la base, así el
// navegador no decide cuánto se rebaja (misma razón que la cobertura del
// convenio en `cargarCoberturaDelPaciente`).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import {
  candidatoDeEmpresa,
  candidatoDeMembresia,
  type CandidatoDescuento,
} from "@/lib/finance/descuento-afiliacion";
import { ROLES_AFILIACION } from "@/lib/finance/empresas-convenio";
import type { ClinicRole } from "@/lib/access/access";

type Supabase = SupabaseClient<Database>;

/**
 * Descuentos que el paciente tiene hoy: el de su empresa con convenio y el de
 * su membresía activa. Lista vacía si el rol no ve afiliaciones (assistant:
 * regla 2) o si el paciente no es afiliado. Un error de lectura se propaga:
 * no se presupuesta "sin descuento" por una caída.
 */
export async function cargarDescuentosDeAfiliacion(
  supabase: Supabase,
  clinicId: string,
  patientId: string,
  rol: ClinicRole | null,
): Promise<CandidatoDescuento[]> {
  if (!rol || !ROLES_AFILIACION.includes(rol)) return [];

  const [{ data: clinica }, { data: afiliacion, error: errA }, { data: inscripcion, error: errM }] =
    await Promise.all([
      supabase.from("clinics").select("timezone").eq("id", clinicId).maybeSingle(),
      supabase
        .from("partner_company_patients")
        .select("company_id, since")
        .eq("clinic_id", clinicId)
        .eq("patient_id", patientId)
        .maybeSingle(),
      supabase
        .from("patient_memberships")
        .select("plan_id, plan_name_snapshot, status, starts_on, ends_on")
        .eq("clinic_id", clinicId)
        .eq("patient_id", patientId)
        .neq("status", "cancelled")
        .maybeSingle(),
    ]);
  if (errA) throw new Error("No pudimos leer la empresa del paciente.");
  if (errM) throw new Error("No pudimos leer la membresía del paciente.");
  const hoy = hoyISO(clinica?.timezone || "America/Santiago");

  const candidatos: CandidatoDescuento[] = [];

  if (afiliacion && (afiliacion.since === null || afiliacion.since <= hoy)) {
    const { data: empresa, error } = await supabase
      .from("partner_companies")
      .select("id, name, active, discount_kind, discount_percent, discount_cents, currency")
      .eq("clinic_id", clinicId)
      .eq("id", afiliacion.company_id)
      .maybeSingle();
    if (error) throw new Error("No pudimos leer la empresa con convenio.");
    const c = empresa
      ? candidatoDeEmpresa({
          id: empresa.id,
          name: empresa.name,
          active: empresa.active,
          discountKind: empresa.discount_kind as "percent" | "amount" | "none",
          discountPercent:
            empresa.discount_percent === null ? null : Number(empresa.discount_percent),
          discountCents: empresa.discount_cents,
          currency: empresa.currency,
        })
      : null;
    if (c) candidatos.push(c);
  }

  if (inscripcion?.plan_id) {
    const { data: plan, error } = await supabase
      .from("membership_plans")
      .select("treatment_discount_percent")
      .eq("clinic_id", clinicId)
      .eq("id", inscripcion.plan_id)
      .maybeSingle();
    if (error) throw new Error("No pudimos leer el plan de membresía.");
    const c = candidatoDeMembresia(
      {
        planId: inscripcion.plan_id,
        planName: inscripcion.plan_name_snapshot,
        status: inscripcion.status,
        startsOn: inscripcion.starts_on,
        endsOn: inscripcion.ends_on,
        treatmentDiscountPercent:
          plan?.treatment_discount_percent == null ? null : Number(plan.treatment_discount_percent),
      },
      hoy,
    );
    if (c) candidatos.push(c);
  }

  return candidatos;
}
