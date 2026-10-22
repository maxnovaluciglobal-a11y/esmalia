import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Profesional, Sucursal } from "@/lib/clinic-operations/clinic-data";
import { atiendePacientes } from "@/lib/clinic-operations/cita-formulario";
import { mensajeDb } from "@/lib/db-errors";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/** Sucursales de la clínica. RLS: solo las de clínicas donde el usuario es miembro. */
export const listBranches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Sucursal[]> => {
    const { data: rows, error } = await context.supabase
      .from("branches")
      .select("id, name, city")
      .eq("clinic_id", data.clinicId)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las sucursales de la clínica."));

    return (rows ?? []).map((r) => ({ id: r.id, nombre: r.name, ciudad: r.city ?? "Sin ciudad" }));
  });

/** Sucursales de la clínica con su link de reseña de Google, para la sección
 * de configuración donde el staff lo carga (audit finding product-2:
 * review_request pedía la reseña sin dar un link directo). */
export const listBranchesForReviewLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ id: string; name: string; googleReviewUrl: string | null }[]> => {
      const { data: rows, error } = await context.supabase
        .from("branches")
        .select("id, name, google_review_url")
        .eq("clinic_id", data.clinicId)
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (error)
        throw new Error(
          mensajeDb(error, "No pudimos cargar las sucursales con su link de reseña."),
        );

      return (rows ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        googleReviewUrl: r.google_review_url,
      }));
    },
  );

/** Actualiza el link de reseña de Google de una sucursal. RLS
 * (`branches_update`) ya exige `can_manage_clinic`; `clinicId` en el `.eq()`
 * es cinturón de defensa en profundidad, no la fuente de la autorización. */
export const updateBranchGoogleReviewUrl = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        branchId: z.string().uuid(),
        // Vacío = borrar el link (columna nullable, "sin link" es válido).
        googleReviewUrl: z.string().trim().url().max(2048).or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("branches")
      .update({ google_review_url: data.googleReviewUrl || null })
      .eq("id", data.branchId)
      .eq("clinic_id", data.clinicId);

    if (error) throw new Error(mensajeDb(error, "No pudimos guardar el link de reseña de Google."));
    return { ok: true };
  });

/** Profesionales de la clínica, con especialidad y box por defecto resueltos. */
export const listProfessionals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Profesional[]> => {
    const { supabase } = context;

    const { data: rows, error } = await supabase
      .from("professionals")
      .select("id, full_name, branch_id, specialty_id, default_operatory_id, color, user_id")
      .eq("clinic_id", data.clinicId)
      .eq("is_active", true)
      .order("full_name", { ascending: true });

    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar los profesionales de la clínica."));

    const specialtyIds = [
      ...new Set((rows ?? []).map((r) => r.specialty_id).filter((v): v is string => Boolean(v))),
    ];
    const operatoryIds = [
      ...new Set(
        (rows ?? []).map((r) => r.default_operatory_id).filter((v): v is string => Boolean(v)),
      ),
    ];

    const userIds = [
      ...new Set((rows ?? []).map((r) => r.user_id).filter((v): v is string => Boolean(v))),
    ];

    const [
      { data: specialties, error: specError },
      { data: operatories, error: opError },
      { data: miembros, error: miembrosError },
    ] = await Promise.all([
      supabase
        .from("specialties")
        .select("id, name")
        .in("id", specialtyIds.length ? specialtyIds : [""]),
      supabase
        .from("operatories")
        .select("id, name")
        .in("id", operatoryIds.length ? operatoryIds : [""]),
      // Rol en el equipo de quien tiene usuario vinculado: decide si atiende
      // pacientes (AGE-17). Sin usuario vinculado, atiende.
      supabase
        .from("clinic_members")
        .select("user_id, role")
        .eq("clinic_id", data.clinicId)
        .in("user_id", userIds.length ? userIds : [""]),
    ]);

    if (specError) throw new Error(mensajeDb(specError, "No pudimos cargar las especialidades."));
    if (opError) throw new Error(mensajeDb(opError, "No pudimos cargar los boxes."));
    if (miembrosError)
      throw new Error(mensajeDb(miembrosError, "No pudimos cargar los roles del equipo."));

    const specialtyById = new Map((specialties ?? []).map((s) => [s.id, s.name]));
    const operatoryById = new Map((operatories ?? []).map((o) => [o.id, o.name]));
    const rolPorUsuario = new Map((miembros ?? []).map((m) => [m.user_id, m.role]));

    return (rows ?? []).map((r) => ({
      id: r.id,
      nombre: r.full_name,
      box:
        (r.default_operatory_id && operatoryById.get(r.default_operatory_id)) || "Sin box asignado",
      boxId: r.default_operatory_id,
      especialidad: (r.specialty_id && specialtyById.get(r.specialty_id)) || "Sin especialidad",
      sucursalId: r.branch_id ?? "",
      color: r.color,
      atiende: atiendePacientes(r.user_id ? (rolPorUsuario.get(r.user_id) ?? null) : null),
    }));
  });

/** Especialidades de la clínica — catálogo liviano para selects. */
export const listSpecialties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ id: string; name: string }[]> => {
    const { data: rows, error } = await context.supabase
      .from("specialties")
      .select("id, name")
      .eq("clinic_id", data.clinicId)
      .order("name", { ascending: true });
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar las especialidades de la clínica."));
    return rows ?? [];
  });
