import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicPermission, requireClinicRole } from "@/lib/access/clinic-guards.server";
import { mensajeDb } from "@/lib/db-errors";
import {
  ROLES_AFILIACION,
  validarEmpresa,
  TIPOS_DESCUENTO,
  type EmpresaConvenio,
  type FilaEstadoDeCuenta,
  type TipoDescuento,
} from "@/lib/finance/empresas-convenio";
import { requireFinanceView } from "@/lib/finance/finance-reports.functions";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Empresas con convenio y descuento por planilla (Ola 10 · frente A: FIN-11,
 * FIC-05).
 *
 * - Catálogo de empresas: lo administra quien ve finanzas (owner, admin,
 *   accounting), en el servidor y en la RLS. Lo leen además dentist y
 *   reception, porque la ficha muestra la empresa del paciente.
 * - Afiliación de un paciente: la edita el equipo que atiende y cobra (owner,
 *   admin, dentist, reception, accounting). Assistant no (regla 2: el
 *   convenio trae dinero).
 * - Estado de cuenta: `finance:view` (rol + suscripción, como Morosidad).
 */

const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SIN_PERMISO = "No tienes permisos para administrar empresas con convenio.";

const COLUMNAS =
  "id, name, tax_id, contact_name, contact_email, contact_phone, discount_kind, discount_percent, discount_cents, currency, payroll_deduction, notes, active";

type FilaEmpresa = {
  id: string;
  name: string;
  tax_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  discount_kind: string;
  discount_percent: number | null;
  discount_cents: number | null;
  currency: string;
  payroll_deduction: boolean;
  notes: string | null;
  active: boolean;
};

function aEmpresa(f: FilaEmpresa, afiliados: number): EmpresaConvenio {
  return {
    id: f.id,
    name: f.name,
    taxId: f.tax_id,
    contactName: f.contact_name,
    contactEmail: f.contact_email,
    contactPhone: f.contact_phone,
    discountKind: (TIPOS_DESCUENTO as readonly string[]).includes(f.discount_kind)
      ? (f.discount_kind as TipoDescuento)
      : "none",
    discountPercent: f.discount_percent === null ? null : Number(f.discount_percent),
    discountCents: f.discount_cents,
    currency: f.currency,
    payrollDeduction: f.payroll_deduction,
    notes: f.notes,
    active: f.active,
    affiliates: afiliados,
  };
}

/** Empresas de la clínica con cuántos afiliados tiene cada una. */
export const listEmpresasConvenio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<EmpresaConvenio[]> => {
    const { supabase, userId } = context;
    await requireClinicRole(supabase, data.clinicId, userId, ROLES_AFILIACION, SIN_PERMISO);
    const { data: filas, error } = await supabase
      .from("partner_companies")
      .select(COLUMNAS)
      .eq("clinic_id", data.clinicId)
      .order("active", { ascending: false })
      .order("name")
      .limit(500);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las empresas con convenio."));

    const conteo = new Map<string, number>();
    const ids = (filas ?? []).map((f) => f.id);
    if (ids.length) {
      // Una fila por afiliado; una clínica chica tiene pocas, y si pasa de
      // 1000 el conteo se pide por empresa con count exacto.
      const { data: afiliados, error: errAf } = await supabase
        .from("partner_company_patients")
        .select("company_id")
        .eq("clinic_id", data.clinicId)
        .limit(1000);
      if (errAf) throw new Error(mensajeDb(errAf, "No pudimos contar los afiliados."));
      if ((afiliados ?? []).length < 1000) {
        for (const a of afiliados ?? [])
          conteo.set(a.company_id, (conteo.get(a.company_id) ?? 0) + 1);
      } else {
        for (const id of ids) {
          const { count } = await supabase
            .from("partner_company_patients")
            .select("id", { count: "exact", head: true })
            .eq("clinic_id", data.clinicId)
            .eq("company_id", id);
          conteo.set(id, count ?? 0);
        }
      }
    }
    return ((filas ?? []) as FilaEmpresa[]).map((f) => aEmpresa(f, conteo.get(f.id) ?? 0));
  });

const EntradaEmpresa = z.object({
  clinicId: z.string().uuid(),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  taxId: z.string().trim().max(20).nullable(),
  contactName: z.string().trim().max(120).nullable(),
  contactEmail: z.string().trim().max(200).nullable(),
  contactPhone: z.string().trim().max(40).nullable(),
  discountKind: z.enum(TIPOS_DESCUENTO),
  discountPercent: z.number().min(0).max(100).nullable(),
  discountCents: z.number().int().min(0).nullable(),
  payrollDeduction: z.boolean(),
  notes: z.string().trim().max(500).nullable(),
});

export const saveEmpresaConvenio = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => EntradaEmpresa.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "finance:view", SIN_PERMISO);
    const errores = validarEmpresa(data);
    if (errores.length) throw new Error(errores[0]);
    const fila = {
      name: data.name,
      tax_id: data.taxId || null,
      contact_name: data.contactName || null,
      contact_email: data.contactEmail || null,
      contact_phone: data.contactPhone || null,
      discount_kind: data.discountKind,
      discount_percent: data.discountKind === "percent" ? data.discountPercent : null,
      discount_cents: data.discountKind === "amount" ? data.discountCents : null,
      payroll_deduction: data.payrollDeduction,
      notes: data.notes || null,
    };
    const DUPLICADA = "Ya hay una empresa con ese nombre en la clínica.";
    if (data.id) {
      const { error } = await supabase
        .from("partner_companies")
        .update(fila)
        .eq("id", data.id)
        .eq("clinic_id", data.clinicId);
      if (error)
        throw new Error(
          error.code === "23505" ? DUPLICADA : mensajeDb(error, "No pudimos guardar la empresa."),
        );
      return { id: data.id };
    }
    const { data: creada, error } = await supabase
      .from("partner_companies")
      .insert({ ...fila, clinic_id: data.clinicId, created_by: userId })
      .select("id")
      .single();
    if (error || !creada)
      throw new Error(
        error?.code === "23505" ? DUPLICADA : mensajeDb(error, "No pudimos guardar la empresa."),
      );
    return { id: creada.id };
  });

export const setEmpresaConvenioActiva = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), id: z.string().uuid(), active: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "finance:view", SIN_PERMISO);
    const { error } = await supabase
      .from("partner_companies")
      .update({ active: data.active })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos cambiar la empresa."));
    return { ok: true };
  });

/** Estado de cuenta de una empresa en un período (FIN-11). */
export const getEstadoDeCuentaEmpresa = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        companyId: z.string().uuid(),
        desde: DIA,
        hasta: DIA,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FilaEstadoDeCuenta[]> => {
    const { supabase, userId } = context;
    await requireFinanceView(supabase, data.clinicId, userId);
    const { data: filas, error } = await supabase
      .rpc("estado_cuenta_empresa", {
        p_clinic_id: data.clinicId,
        p_company_id: data.companyId,
        p_desde: data.desde,
        p_hasta: data.hasta,
      })
      .limit(1000);
    if (error) throw new Error(mensajeDb(error, "No pudimos armar el estado de cuenta."));
    return (filas ?? []).map((f) => ({
      patientId: f.patient_id,
      fullName: f.full_name,
      employeeCode: f.employee_code,
      realizadoCents: Number(f.realizado_cents),
      pagadoCents: Number(f.pagado_cents),
      saldoCents: Number(f.saldo_cents),
    }));
  });

export interface AfiliacionDelPaciente {
  id: string;
  companyId: string;
  employeeCode: string | null;
  since: string | null;
}

/** Empresa del paciente (FIC-05). null = sin empresa. */
export const getEmpresaDelPaciente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<AfiliacionDelPaciente | null> => {
    const { supabase, userId } = context;
    await requireClinicRole(supabase, data.clinicId, userId, ROLES_AFILIACION, SIN_PERMISO);
    const { data: fila, error } = await supabase
      .from("partner_company_patients")
      .select("id, company_id, employee_code, since")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la empresa del paciente."));
    return fila
      ? {
          id: fila.id,
          companyId: fila.company_id,
          employeeCode: fila.employee_code,
          since: fila.since,
        }
      : null;
  });

/** Afilia al paciente a una empresa, cambia sus datos o lo desafilia (`companyId: null`). */
export const setEmpresaDelPaciente = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        companyId: z.string().uuid().nullable(),
        employeeCode: z.string().trim().max(40).nullable(),
        since: DIA.nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicRole(supabase, data.clinicId, userId, ROLES_AFILIACION, SIN_PERMISO);
    if (data.companyId === null) {
      const { error } = await supabase
        .from("partner_company_patients")
        .delete()
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId);
      if (error) throw new Error(mensajeDb(error, "No pudimos quitar la empresa."));
      return { ok: true };
    }
    const { data: empresa } = await supabase
      .from("partner_companies")
      .select("id, active")
      .eq("id", data.companyId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (!empresa) throw new Error("La empresa no existe en esta clínica.");

    const { data: actual } = await supabase
      .from("partner_company_patients")
      .select("id, company_id")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .maybeSingle();
    if (!actual && !empresa.active)
      throw new Error("La empresa está desactivada: actívala antes de afiliar pacientes.");

    const campos = {
      company_id: data.companyId,
      employee_code: data.employeeCode || null,
      since: data.since,
    };
    const { error } = actual
      ? await supabase
          .from("partner_company_patients")
          .update(campos)
          .eq("id", actual.id)
          .eq("clinic_id", data.clinicId)
      : await supabase.from("partner_company_patients").insert({
          ...campos,
          clinic_id: data.clinicId,
          patient_id: data.patientId,
          created_by: userId,
        });
    if (error) throw new Error(mensajeDb(error, "No pudimos guardar la empresa del paciente."));
    return { ok: true };
  });
