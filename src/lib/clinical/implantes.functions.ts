/**
 * MKT-09 · Seguimiento de implantes: server functions. RLS del usuario
 * (solo roles clínicos); las reglas (profesional de la clínica, snapshot de
 * su nombre, estado desde el control) las pone la base.
 *
 *   listImplantesDelPaciente  implantes del paciente (y fichas fusionadas) con sus controles
 *   guardarImplante           crea o corrige un implante
 *   registrarControlImplante  control append-only; su estado pasa al implante
 *   buscarImplantesPorLote    toda la clínica, para un retiro de lote del fabricante
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  controlImplanteSchema,
  esEstadoImplante,
  implanteSchema,
  patronDeLote,
  type ControlImplante,
  type EstadoImplante,
  type Implante,
} from "@/lib/clinical/implantes";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";
import { mensajeDb } from "@/lib/db-errors";
import { cargarFusiones, fichasAbsorbidas } from "@/lib/patients/fusion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

const SIN_PERMISO = "No tienes permisos para registrar implantes.";

const COLUMNAS =
  "id, patient_id, tooth, brand, model, diameter_mm, length_mm, lot, reference, placed_on, professional_id, professional_name, status, removed_on, notes";

type FilaImplante = {
  id: string;
  patient_id: string;
  tooth: number;
  brand: string;
  model: string | null;
  diameter_mm: number | null;
  length_mm: number | null;
  lot: string;
  reference: string | null;
  placed_on: string;
  professional_id: string | null;
  professional_name: string | null;
  status: string;
  removed_on: string | null;
  notes: string | null;
};

function estado(v: string): EstadoImplante {
  return esEstadoImplante(v) ? v : "colocado";
}

function aImplante(f: FilaImplante, controles: ControlImplante[]): Implante {
  return {
    id: f.id,
    patientId: f.patient_id,
    tooth: f.tooth,
    brand: f.brand,
    model: f.model,
    diameterMm: f.diameter_mm == null ? null : Number(f.diameter_mm),
    lengthMm: f.length_mm == null ? null : Number(f.length_mm),
    lot: f.lot,
    reference: f.reference,
    placedOn: f.placed_on,
    professionalId: f.professional_id,
    professionalName: f.professional_name,
    status: estado(f.status),
    removedOn: f.removed_on,
    notes: f.notes,
    controles,
  };
}

export const listImplantesDelPaciente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<Implante[]> => {
    const { supabase } = context;
    const lectura = registrarLecturaDeFicha(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "odontograma",
    });
    const fusiones = await cargarFusiones(supabase, data.clinicId);
    const ids = [data.patientId, ...fichasAbsorbidas(data.patientId, fusiones)];
    const { data: filas, error } = await supabase
      .from("patient_implants")
      .select(COLUMNAS)
      .eq("clinic_id", data.clinicId)
      .in("patient_id", ids)
      .order("placed_on", { ascending: false });
    if (error) {
      await lectura;
      throw new Error(mensajeDb(error, "No pudimos cargar los implantes del paciente."));
    }
    const implantes = (filas ?? []) as FilaImplante[];
    const porImplante = new Map<string, ControlImplante[]>();
    if (implantes.length) {
      const { data: controles, error: errorControles } = await supabase
        .from("patient_implant_controls")
        .select(
          "id, implant_id, controlled_on, finding, isq, status_after, recorded_by, created_at",
        )
        .eq("clinic_id", data.clinicId)
        .in(
          "implant_id",
          implantes.map((i) => i.id),
        )
        .order("controlled_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (errorControles) {
        await lectura;
        throw new Error(
          mensajeDb(errorControles, "No pudimos cargar los controles de los implantes."),
        );
      }
      const autores = [
        ...new Set((controles ?? []).map((c) => c.recorded_by).filter(Boolean)),
      ] as string[];
      const nombres = new Map<string, string | null>();
      if (autores.length) {
        const { data: perfiles } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", autores);
        for (const p of perfiles ?? []) nombres.set(p.id, p.full_name ?? p.email);
      }
      for (const c of controles ?? []) {
        const lista = porImplante.get(c.implant_id) ?? [];
        lista.push({
          id: c.id,
          controlledOn: c.controlled_on,
          finding: c.finding,
          isq: c.isq,
          statusAfter: c.status_after && esEstadoImplante(c.status_after) ? c.status_after : null,
          recordedByName: c.recorded_by ? (nombres.get(c.recorded_by) ?? null) : null,
          createdAt: c.created_at,
        });
        porImplante.set(c.implant_id, lista);
      }
    }
    await lectura;
    return implantes.map((f) => aImplante(f, porImplante.get(f.id) ?? []));
  });

export const guardarImplante = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        implantId: z.string().uuid().optional(),
      })
      .and(implanteSchema)
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const valores = {
      tooth: data.tooth,
      brand: data.brand,
      model: data.model ?? null,
      diameter_mm: data.diameterMm ?? null,
      length_mm: data.lengthMm ?? null,
      lot: data.lot,
      reference: data.reference ?? null,
      placed_on: data.placedOn,
      professional_id: data.professionalId ?? null,
      status: data.status,
      notes: data.notes ?? null,
    };
    if (data.implantId) {
      const { data: filas, error } = await context.supabase
        .from("patient_implants")
        .update(valores)
        .eq("id", data.implantId)
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .select("id");
      if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
      if (!filas?.length) throw new Error(SIN_PERMISO);
      return { id: data.implantId };
    }
    const { data: fila, error } = await context.supabase
      .from("patient_implants")
      .insert({
        ...valores,
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !fila) throw new Error(mensajeDb(error, SIN_PERMISO));
    return { id: fila.id };
  });

export const registrarControlImplante = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        implantId: z.string().uuid(),
      })
      .and(controlImplanteSchema)
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.from("patient_implant_controls").insert({
      clinic_id: data.clinicId,
      patient_id: data.patientId,
      implant_id: data.implantId,
      controlled_on: data.controlledOn,
      finding: data.finding,
      isq: data.isq ?? null,
      status_after: data.statusAfter ?? null,
      recorded_by: context.userId,
    });
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para registrar controles."));
    return { ok: true };
  });

export type ImplanteEncontrado = {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  patientEmail: string | null;
  tooth: number;
  brand: string;
  model: string | null;
  lot: string;
  reference: string | null;
  placedOn: string;
  professionalName: string | null;
  status: EstadoImplante;
};

/**
 * Retiro de lote: todos los implantes de la clínica cuyo lote contiene el
 * texto buscado (sin distinguir mayúsculas), con el paciente y su contacto
 * para avisarle. Mismas reglas de RLS: solo roles clínicos.
 */
export const buscarImplantesPorLote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        lote: z.string().trim().min(2, "Escribe al menos 2 caracteres del lote.").max(60),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ImplanteEncontrado[]> => {
    const { supabase } = context;
    const { data: filas, error } = await supabase
      .from("patient_implants")
      .select(COLUMNAS)
      .eq("clinic_id", data.clinicId)
      .ilike("lot", patronDeLote(data.lote))
      .order("placed_on", { ascending: false })
      .limit(500);
    if (error) throw new Error(mensajeDb(error, "No pudimos buscar por lote."));
    const implantes = (filas ?? []) as FilaImplante[];
    const ids = [...new Set(implantes.map((i) => i.patient_id))];
    const pacientes = new Map<
      string,
      { full_name: string; phone: string | null; email: string | null }
    >();
    if (ids.length) {
      const { data: fichas, error: errorFichas } = await supabase
        .from("patients")
        .select("id, full_name, phone, email")
        .eq("clinic_id", data.clinicId)
        .in("id", ids);
      if (errorFichas) throw new Error(mensajeDb(errorFichas, "No pudimos cargar los pacientes."));
      for (const p of fichas ?? []) pacientes.set(p.id, p);
    }
    return implantes.map((f) => {
      const p = pacientes.get(f.patient_id);
      return {
        id: f.id,
        patientId: f.patient_id,
        patientName: p?.full_name ?? "Paciente",
        patientPhone: p?.phone ?? null,
        patientEmail: p?.email ?? null,
        tooth: f.tooth,
        brand: f.brand,
        model: f.model,
        lot: f.lot,
        reference: f.reference,
        placedOn: f.placed_on,
        professionalName: f.professional_name,
        status: estado(f.status),
      };
    });
  });
