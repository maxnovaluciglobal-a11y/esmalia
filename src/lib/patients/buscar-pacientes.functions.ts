// src/lib/patients/buscar-pacientes.functions.ts
//
// Búsqueda liviana para la paleta ⌘K: hasta 8 pacientes por nombre, documento
// o teléfono. No reusa `listPatients` porque esa trae la clínica entera con
// sus citas; acá se teclea y cada pulsación tiene que ser barata.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { permissionsForRole, type ClinicRole } from "@/lib/access/access";
import { mensajeDb } from "@/lib/db-errors";

export type PacienteEncontrado = {
  id: string;
  nombre: string;
  documento: string | null;
  telefono: string | null;
};

/**
 * Deja solo lo que puede ir dentro de un filtro `or=(...)` de PostgREST sin
 * cambiarle el sentido: la coma, los paréntesis y el punto separan
 * condiciones, y `%`/`_`/`*` son comodines de `ilike`.
 */
export function limpiarTerminoDeBusqueda(q: string): string {
  return q
    .replace(/[,().%_*\\:"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export const buscarPacientes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), q: z.string().max(80) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PacienteEncontrado[]> => {
    const { supabase, userId } = context;
    const termino = limpiarTerminoDeBusqueda(data.q);
    if (termino.length < 2) return [];

    // Regla 15: el gate de la UI necesita su par acá. RLS ya limita a la
    // clínica del miembro, pero no distingue quién puede ver pacientes.
    const { data: membership } = await supabase
      .from("clinic_members")
      .select("role")
      .eq("clinic_id", data.clinicId)
      .eq("user_id", userId)
      .maybeSingle();
    const puede = membership?.role
      ? permissionsForRole(membership.role as ClinicRole).includes("patients:view")
      : false;
    if (!puede) throw new Error("No tienes permisos");

    const patron = `%${termino}%`;
    const { data: rows, error } = await supabase
      .from("patients")
      .select("id, full_name, document_id, phone")
      .eq("clinic_id", data.clinicId)
      // Las fichas archivadas (LEG-08) no salen en la búsqueda rápida: se
      // ven desde Pacientes con el filtro de archivo.
      .is("archived_at", null)
      .or(`full_name.ilike.${patron},document_id.ilike.${patron},phone.ilike.${patron}`)
      .order("full_name", { ascending: true })
      .limit(8);
    if (error) throw new Error(mensajeDb(error, "No pudimos buscar pacientes."));

    return (rows ?? []).map((r) => ({
      id: r.id,
      nombre: r.full_name,
      documento: r.document_id,
      telefono: r.phone,
    }));
  });
