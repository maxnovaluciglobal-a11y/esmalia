// src/lib/patients/datos-ficha.functions.ts
//
// Server functions de la Ola 1 · Frente Pacientes: listas editables de la
// ficha (isapres y origen), aviso de documento duplicado, código de referido
// y pacientes con garantía GES dental para la pantalla Hoy.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { mensajeDb } from "@/lib/db-errors";
import { normalizarCodigoReferido } from "@/lib/patients/datos-ficha";
import {
  edadCumplida,
  motivosGes,
  rangoDeNacimientoParaEdad,
  type MotivoGes,
} from "@/lib/patients/ges";
import { idsConElMismoDocumento } from "@/lib/patients/indice-ciego.server";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

export const TIPOS_OPCION = ["isapre", "acquisition_source"] as const;
export type TipoOpcion = (typeof TIPOS_OPCION)[number];

export interface OpcionDeFicha {
  id: string;
  tipo: TipoOpcion;
  texto: string;
  activa: boolean;
}

/** Isapres y orígenes de la clínica, activos e inactivos, en su orden. */
export const listarOpcionesDeFicha = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<OpcionDeFicha[]> => {
    const { data: filas, error } = await context.supabase
      .from("clinic_patient_options")
      .select("id, kind, label, active, position")
      .eq("clinic_id", data.clinicId)
      .order("kind", { ascending: true })
      .order("position", { ascending: true })
      .order("label", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las listas de la ficha."));
    return (filas ?? [])
      .filter((f) => (TIPOS_OPCION as readonly string[]).includes(f.kind))
      .map((f) => ({ id: f.id, tipo: f.kind as TipoOpcion, texto: f.label, activa: f.active }));
  });

const MENSAJE_SIN_PERMISO_LISTAS = "Solo el dueño o un administrador pueden cambiar estas listas.";

/** Agrega una opción a una lista (owner/admin). */
export const agregarOpcionDeFicha = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        tipo: z.enum(TIPOS_OPCION),
        texto: z.string().trim().min(1, "Escribe un nombre.").max(80, "Máximo 80 caracteres."),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    await requireClinicPermission(
      supabase,
      data.clinicId,
      userId,
      "settings:manage",
      MENSAJE_SIN_PERMISO_LISTAS,
    );
    const { data: ultima } = await supabase
      .from("clinic_patient_options")
      .select("position")
      .eq("clinic_id", data.clinicId)
      .eq("kind", data.tipo)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: fila, error } = await supabase
      .from("clinic_patient_options")
      .insert({
        clinic_id: data.clinicId,
        kind: data.tipo,
        label: data.texto,
        position: (ultima?.position ?? 0) + 1,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("Esa opción ya está en la lista.");
      throw new Error(mensajeDb(error, MENSAJE_SIN_PERMISO_LISTAS));
    }
    return { id: fila.id };
  });

/** Activa o desactiva una opción. Las fichas guardan el texto, así que no cambian. */
export const cambiarOpcionDeFicha = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), id: z.string().uuid(), activa: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await requireClinicPermission(
      supabase,
      data.clinicId,
      userId,
      "settings:manage",
      MENSAJE_SIN_PERMISO_LISTAS,
    );
    const { data: fila, error } = await supabase
      .from("clinic_patient_options")
      .update({ active: data.activa })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, MENSAJE_SIN_PERMISO_LISTAS));
    if (!fila) throw new Error(MENSAJE_SIN_PERMISO_LISTAS);
    return { ok: true };
  });

export interface FichaConMismoDocumento {
  id: string;
  nombre: string;
  archivada: boolean;
}

/**
 * PAC-03: otras fichas de la clínica con el mismo documento (escrito como
 * sea). Lo usa el alta para avisar y ofrecer abrir o fusionar antes de crear
 * un duplicado. Solo ids y nombres, nunca el hash.
 */
export const buscarFichasConMismoDocumento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        documento: z.string().trim().max(40),
        excluir: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FichaConMismoDocumento[]> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "patients:view");
    const ids = await idsConElMismoDocumento(supabase, data.clinicId, data.documento, data.excluir);
    if (ids.length === 0) return [];
    const { data: filas, error } = await supabase
      .from("patients")
      .select("id, full_name, archived_at")
      .eq("clinic_id", data.clinicId)
      .in("id", ids)
      .order("full_name", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos revisar si el documento ya existe."));
    return (filas ?? []).map((f) => ({
      id: f.id,
      nombre: f.full_name,
      archivada: Boolean(f.archived_at),
    }));
  });

/** FIC-04: quién tiene ese código de referido en la clínica (o null). */
export const buscarReferente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), codigo: z.string().trim().max(20) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string; nombre: string } | null> => {
    const codigo = normalizarCodigoReferido(data.codigo);
    if (codigo.length < 4) return null;
    const { data: fila, error } = await context.supabase
      .from("patients")
      .select("id, full_name")
      .eq("clinic_id", data.clinicId)
      .eq("referral_code", codigo)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos revisar el código de referido."));
    return fila ? { id: fila.id, nombre: fila.full_name } : null;
  });

export interface PacienteGes {
  id: string;
  nombre: string;
  edad: number | null;
  motivos: MotivoGes[];
}

/**
 * MKT-01: pacientes activos de la clínica que hoy tienen una garantía GES
 * dental: 6 o 60 años cumplidos, o embarazo en la anamnesis. Solo clínicas
 * de Chile. El embarazo es dato clínico: la RLS de patient_medical_history
 * solo se lo da a los roles clínicos, así que recepción ve solo las edades.
 */
export const listarPacientesGes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PacienteGes[]> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "patients:view");
    const { data: clinica } = await supabase
      .from("clinics")
      .select("country, timezone")
      .eq("id", data.clinicId)
      .maybeSingle();
    if ((clinica?.country ?? "").toUpperCase() !== "CL") return [];
    const hoy = hoyISO(clinica?.timezone ?? "America/Santiago");

    const seis = rangoDeNacimientoParaEdad(6, hoy);
    const sesenta = rangoDeNacimientoParaEdad(60, hoy);
    const [porEdad, embarazos] = await Promise.all([
      supabase
        .from("patients")
        .select("id, full_name, birth_date")
        .eq("clinic_id", data.clinicId)
        .is("archived_at", null)
        .or(
          `and(birth_date.gte.${seis.desde},birth_date.lte.${seis.hasta}),` +
            `and(birth_date.gte.${sesenta.desde},birth_date.lte.${sesenta.hasta})`,
        )
        .order("full_name", { ascending: true })
        .limit(200),
      supabase
        .from("patient_medical_history")
        .select("patient_id")
        .eq("clinic_id", data.clinicId)
        .eq("risk_questionnaire->pregnancy->>answer", "yes")
        .limit(200),
    ]);
    if (porEdad.error)
      throw new Error(mensajeDb(porEdad.error, "No pudimos cargar los pacientes GES."));

    const embarazadas = new Set((embarazos.data ?? []).map((f) => f.patient_id));
    const filas = new Map((porEdad.data ?? []).map((f) => [f.id, f]));
    const faltan = [...embarazadas].filter((id) => !filas.has(id));
    if (faltan.length > 0) {
      const { data: extra } = await supabase
        .from("patients")
        .select("id, full_name, birth_date")
        .eq("clinic_id", data.clinicId)
        .is("archived_at", null)
        .in("id", faltan);
      for (const f of extra ?? []) filas.set(f.id, f);
    }

    return [...filas.values()]
      .map((f) => ({
        id: f.id,
        nombre: f.full_name,
        edad: edadCumplida(f.birth_date, hoy),
        motivos: motivosGes({
          pais: "CL",
          fechaNacimiento: f.birth_date,
          hoy,
          embarazada: embarazadas.has(f.id),
        }),
      }))
      .filter((p) => p.motivos.length > 0)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  });
