import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

export type BranchDetail = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  opensAt: string;
  closesAt: string;
  isActive: boolean;
  operatories: { id: string; name: string }[];
};

const branchInputSchema = z.object({
  name: z.string().trim().min(2, "Nombre de la sucursal requerido").max(120),
  address: z.string().trim().max(180).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  opensAt: z.string().regex(/^\d{2}:\d{2}$/),
  closesAt: z.string().regex(/^\d{2}:\d{2}$/),
  operatories: z.array(z.string().trim().min(1).max(60)).min(1, "Agrega al menos un box"),
});

/** Sucursales con detalle completo (incluye boxes e inactivas) para la
 * pantalla de administración — a diferencia de listBranches en
 * clinic-catalog.functions.ts, que es liviana y solo trae activas. */
export const listBranchesDetailed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<BranchDetail[]> => {
    const { data: branches, error } = await context.supabase
      .from("branches")
      .select("id, name, address, city, phone, opens_at, closes_at, is_active")
      .eq("clinic_id", data.clinicId)
      .order("name", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las sucursales."));

    const branchIds = (branches ?? []).map((b) => b.id);
    const { data: operatories, error: opError } = await context.supabase
      .from("operatories")
      .select("id, name, branch_id")
      .in("branch_id", branchIds.length ? branchIds : [""])
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (opError)
      throw new Error(mensajeDb(opError, "No pudimos cargar los boxes de las sucursales."));

    const opsByBranch = new Map<string, { id: string; name: string }[]>();
    for (const op of operatories ?? []) {
      const list = opsByBranch.get(op.branch_id) ?? [];
      list.push({ id: op.id, name: op.name });
      opsByBranch.set(op.branch_id, list);
    }

    return (branches ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      address: b.address,
      city: b.city,
      phone: b.phone,
      opensAt: b.opens_at,
      closesAt: b.closes_at,
      isActive: b.is_active,
      operatories: opsByBranch.get(b.id) ?? [],
    }));
  });

/** Alta de sucursal fuera del onboarding inicial — misma forma que el paso
 * "Sucursal y boxes" del wizard, reusada acá para que una clínica que crece
 * pueda agregar una sede sin tocar la base de datos a mano. RLS
 * (branches_write / operatories_write) ya exige can_manage_clinic. */
export const createBranch = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), branch: branchInputSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: clinic, error: clinicError } = await supabase
      .from("clinics")
      .select("timezone")
      .eq("id", data.clinicId)
      .single();
    if (clinicError || !clinic) throw new Error("No encontramos la clínica.");

    const { data: branch, error: branchError } = await supabase
      .from("branches")
      .insert({
        clinic_id: data.clinicId,
        name: data.branch.name.trim(),
        address: data.branch.address?.trim() || null,
        city: data.branch.city?.trim() || null,
        phone: data.branch.phone?.trim() || null,
        timezone: clinic.timezone,
        opens_at: data.branch.opensAt,
        closes_at: data.branch.closesAt,
      })
      .select("id")
      .single();
    if (branchError || !branch)
      throw new Error(mensajeDb(branchError, "No se pudo crear la sucursal."));

    const { error: opError } = await supabase.from("operatories").insert(
      data.branch.operatories.map((name) => ({
        clinic_id: data.clinicId,
        branch_id: branch.id,
        name: name.trim(),
      })),
    );
    if (opError) throw new Error(mensajeDb(opError, "No pudimos crear los boxes de la sucursal."));

    return { branchId: branch.id };
  });

/** Edita datos básicos de una sucursal existente (no boxes — ver
 * addOperatory). isActive permite dar de baja una sucursal sin borrar su
 * historial de citas/pacientes asociados. */
export const updateBranch = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        branchId: z.string().uuid(),
        name: z.string().trim().min(2).max(120),
        address: z.string().trim().max(180).optional().or(z.literal("")),
        city: z.string().trim().max(80).optional().or(z.literal("")),
        phone: z.string().trim().max(40).optional().or(z.literal("")),
        opensAt: z.string().regex(/^\d{2}:\d{2}$/),
        closesAt: z.string().regex(/^\d{2}:\d{2}$/),
        isActive: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("branches")
      .update({
        name: data.name.trim(),
        address: data.address?.trim() || null,
        city: data.city?.trim() || null,
        phone: data.phone?.trim() || null,
        opens_at: data.opensAt,
        closes_at: data.closesAt,
        is_active: data.isActive,
      })
      .eq("id", data.branchId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error("No tienes permisos para editar esta sucursal.");
    return { ok: true };
  });

/** Agrega un box/operatorio a una sucursal existente. */
export const addOperatory = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        branchId: z.string().uuid(),
        name: z.string().trim().min(1).max(60),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("operatories").insert({
      clinic_id: data.clinicId,
      branch_id: data.branchId,
      name: data.name.trim(),
    });
    if (error) throw new Error("No tienes permisos para agregar boxes en esta sucursal.");
    return { ok: true };
  });

export interface BranchComparisonRow {
  branchId: string;
  branchName: string;
  totalCitas: number;
  finalizadas: number;
  ausentes: number;
  /** `null` con menos de 5 citas — un porcentaje sobre pocos casos engaña. */
  tasaAsistencia: number | null;
  pacientesDistintos: number;
}

/**
 * Panel de red: comparación operativa entre sucursales en el período dado.
 * Gap de la auditoría comparativa vs. SuperClini (22-sep-2026) — "Panel de
 * red" del competidor compara sucursales en una pantalla.
 *
 * Deliberadamente NO incluye facturación por sucursal: `payments` no tiene
 * `branch_id` (los cobros son de la clínica, no de una sucursal puntual) y
 * reconstruirlo vía `treatment_plans`/`patients` sería una atribución
 * indirecta, no un dato real. Mejor mostrar menos y que sea cierto.
 */
export const getBranchComparison = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<BranchComparisonRow[]> => {
    const desdeIso = `${data.desde}T00:00:00.000Z`;
    const hastaIso = `${data.hasta}T23:59:59.999Z`;

    const [{ data: branches, error: branchesError }, { data: citas, error: citasError }] =
      await Promise.all([
        context.supabase
          .from("branches")
          .select("id, name")
          .eq("clinic_id", data.clinicId)
          .eq("is_active", true)
          .order("name", { ascending: true }),
        context.supabase
          .from("appointments")
          .select("branch_id, status, patient_id")
          .eq("clinic_id", data.clinicId)
          .gte("starts_at", desdeIso)
          .lte("starts_at", hastaIso),
      ]);
    if (branchesError)
      throw new Error(mensajeDb(branchesError, "No pudimos cargar las sucursales."));
    if (citasError)
      throw new Error(mensajeDb(citasError, "No pudimos cargar las citas del período."));

    return (branches ?? []).map((b) => {
      const citasSucursal = (citas ?? []).filter((c) => c.branch_id === b.id);
      const finalizadas = citasSucursal.filter((c) => c.status === "finalizada").length;
      const ausentes = citasSucursal.filter((c) => c.status === "ausente").length;
      const totalCitas = citasSucursal.length;
      const denominadorAsistencia = finalizadas + ausentes;
      return {
        branchId: b.id,
        branchName: b.name,
        totalCitas,
        finalizadas,
        ausentes,
        tasaAsistencia:
          denominadorAsistencia >= 5
            ? Math.round((finalizadas / denominadorAsistencia) * 100)
            : null,
        pacientesDistintos: new Set(citasSucursal.map((c) => c.patient_id)).size,
      };
    });
  });
