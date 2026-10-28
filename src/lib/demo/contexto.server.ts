import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import { diaEnLaZona, sumarDiasCiviles, ZONA_DE_LA_DEMO } from "@/lib/demo/dia-de-la-clinica";

/**
 * Lo que comparten los pasos de siembra de la "demo completa": la clínica, su
 * huso, el "hoy" de la clínica (nunca el de UTC, regla 7) y las personas y
 * sucursales sembradas por `reset_demo_clinic()`. Todo dato ficticio: nombres
 * inventados y RUT sintéticos, como el resto de la demo.
 */

export type Admin = SupabaseClient<Database>;

/** Clínica demo pública (mismo id fijo que `reset_demo_clinic()`). */
export const CLINICA_DEMO_ID = "20cea989-de9b-4a3e-852a-31347dc3fe83";
/** Usuario dueño de la clínica demo (demo@esmalia.com). */
export const USUARIO_DEMO_ID = "139dd209-8495-415c-b6cd-6bbc63367bad";

export type PacienteDemo = {
  id: string;
  /** `new`, `active` o `inactive`. */
  estado: string;
  nombre: string;
  nacimiento: string | null;
  sucursalId: string | null;
};
export type ProfesionalDemo = {
  id: string;
  nombre: string;
  sucursalId: string | null;
  userId: string | null;
};
export type SucursalDemo = { id: string; nombre: string };

export type ContextoDemo = {
  admin: Admin;
  clinicId: string;
  zona: string;
  /** AAAA-MM-DD de hoy en el huso de la clínica. */
  hoy: string;
  pacientes: PacienteDemo[];
  profesionales: ProfesionalDemo[];
  sucursales: SucursalDemo[];
};

export async function cargarContextoDeLaDemo(admin: Admin): Promise<ContextoDemo | null> {
  const { data: clinica } = await admin
    .from("clinics")
    .select("id, timezone")
    .eq("id", CLINICA_DEMO_ID)
    .eq("is_demo", true)
    .maybeSingle();
  if (!clinica) return null;
  const [{ data: pacientes }, { data: profesionales }, { data: sucursales }] = await Promise.all([
    admin
      .from("patients")
      .select("id, full_name, birth_date, branch_id, status")
      .eq("clinic_id", clinica.id)
      .is("archived_at", null)
      .is("merged_into", null)
      .order("full_name"),
    admin
      .from("professionals")
      .select("id, full_name, branch_id, user_id")
      .eq("clinic_id", clinica.id)
      .order("full_name"),
    admin.from("branches").select("id, name").eq("clinic_id", clinica.id).order("name"),
  ]);
  const zona = clinica.timezone || ZONA_DE_LA_DEMO;
  return {
    admin,
    clinicId: clinica.id,
    zona,
    hoy: diaEnLaZona(zona),
    pacientes: (pacientes ?? []).map((p) => ({
      id: p.id,
      estado: p.status,
      nombre: p.full_name,
      nacimiento: p.birth_date,
      sucursalId: p.branch_id,
    })),
    profesionales: (profesionales ?? []).map((p) => ({
      id: p.id,
      nombre: p.full_name,
      sucursalId: p.branch_id,
      userId: p.user_id,
    })),
    sucursales: (sucursales ?? []).map((s) => ({ id: s.id, nombre: s.name })),
  };
}

/** Día civil `desplazamiento` días antes (negativo) o después de hoy en la clínica. */
export function diaRelativo(ctx: Pick<ContextoDemo, "hoy">, desplazamiento: number): string {
  return sumarDiasCiviles(ctx.hoy, desplazamiento);
}

/** Instante UTC (ISO) de una hora de pared de la clínica en un día dado. */
export function instanteDeLaClinica(
  ctx: Pick<ContextoDemo, "zona">,
  dia: string,
  hhmm: string,
): string {
  return wallTimeInTzToUtc(`${dia}T${hhmm}:00`, ctx.zona).toISOString();
}

/** Cuántas filas tiene una tabla de la clínica (para la idempotencia de cada paso). */
export async function contarFilas(admin: Admin, tabla: string, clinicId: string): Promise<number> {
  const { count, error } = await admin
    .from(tabla as "patients")
    .select("*", { count: "exact", head: true })
    .eq("clinic_id", clinicId);
  if (error) throw new Error(`${tabla}: ${error.message}`);
  return count ?? 0;
}

/** Hash SHA-256 en hexadecimal de un texto (huellas de ejemplo de los documentos sembrados). */
export async function sha256Hex(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Un paso de siembra: nunca lanza hacia afuera sin nombre; `sembrarTodoLoDeLaDemo` lo registra. */
export type PasoDeSiembra = { nombre: string; correr: () => Promise<void> };

/**
 * Convierte una función de siembra con contexto en un paso: carga el contexto y,
 * si la clínica demo no existe, no hace nada.
 */
export function paso(
  admin: Admin,
  nombre: string,
  fn: (ctx: ContextoDemo) => Promise<void>,
): PasoDeSiembra {
  return {
    nombre,
    correr: async () => {
      const ctx = await cargarContextoDeLaDemo(admin);
      if (!ctx) return;
      await fn(ctx);
    },
  };
}

/** RUT sintético con dígito verificador válido ("17.456.789-2"): ficticio, con el patrón de la demo. */
export function rutSintetico(numero: number): string {
  let suma = 0;
  let multiplicador = 2;
  for (const d of String(numero).split("").reverse()) {
    suma += Number(d) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  const cuerpo = String(numero).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cuerpo}-${dv}`;
}
