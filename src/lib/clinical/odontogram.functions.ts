import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";
import { filaYaCreada } from "@/lib/idempotency";
import {
  TOOTH_CONDITIONS,
  TOOTH_SURFACES,
  WHOLE_TOOTH_CONDITIONS,
  type OdontogramMark,
} from "@/lib/clinical/odontogram";

const TOOTH_SURFACE_ENUM = z.enum(TOOTH_SURFACES);
const TOOTH_CONDITION_ENUM = z.enum(TOOTH_CONDITIONS);
const TOOTH_NUMBER = z
  .number()
  .int()
  .refine(
    (n) =>
      (n >= 11 && n <= 18) ||
      (n >= 21 && n <= 28) ||
      (n >= 31 && n <= 38) ||
      (n >= 41 && n <= 48) ||
      (n >= 51 && n <= 55) ||
      (n >= 61 && n <= 65) ||
      (n >= 71 && n <= 75) ||
      (n >= 81 && n <= 85),
    "Número de pieza FDI inválido (usar cuadrantes 1-8 con dientes 1-8, permanentes o deciduos).",
  );

type MarkRow = {
  id: string;
  tooth_number: number;
  surface: string;
  condition: string;
  material: string | null;
  notes: string | null;
  superseded_at: string | null;
  recorded_at: string;
  recorded_by: string;
};

function mapRow(row: MarkRow, nameByUser: Map<string, string | null>): OdontogramMark {
  return {
    id: row.id,
    toothNumber: row.tooth_number,
    surface: row.surface as OdontogramMark["surface"],
    condition: row.condition as OdontogramMark["condition"],
    material: row.material,
    notes: row.notes,
    supersededAt: row.superseded_at,
    recordedAt: row.recorded_at,
    recordedById: row.recorded_by,
    recordedByName: nameByUser.get(row.recorded_by) ?? null,
  };
}

const MARK_COLUMNS =
  "id, tooth_number, surface, condition, material, notes, superseded_at, recorded_at, recorded_by";

/** Marcas vigentes del odontograma del paciente. */
export const listOdontogramMarks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<OdontogramMark[]> => {
    const { supabase } = context;
    // SEG-02: en paralelo con la carga; se espera antes de responder.
    const lectura = registrarLecturaDeFicha(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "odontograma",
    });

    const { data: rows, error } = await supabase
      .from("odontogram_marks")
      .select(MARK_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .is("superseded_at", null)
      .order("tooth_number", { ascending: true })
      .order("surface", { ascending: true });

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el odontograma del paciente."));

    const marks = (rows ?? []) as MarkRow[];
    const userIds = [...new Set(marks.map((m) => m.recorded_by))];
    const { data: profiles } = userIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
      : { data: [] };
    const nameByUser = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    await lectura;
    return marks.map((row) => mapRow(row, nameByUser));
  });

/** Historia completa (incluye marcas cerradas) para una pieza específica o todo el paciente. */
export const listOdontogramHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        toothNumber: TOOTH_NUMBER.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<OdontogramMark[]> => {
    const { supabase } = context;
    // SEG-02: en paralelo con la carga; se espera antes de responder.
    const lectura = registrarLecturaDeFicha(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "odontograma",
    });

    let query = supabase
      .from("odontogram_marks")
      .select(MARK_COLUMNS)
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .order("recorded_at", { ascending: false })
      .limit(500);

    if (data.toothNumber !== undefined) {
      query = query.eq("tooth_number", data.toothNumber);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el historial del odontograma."));

    const marks = (rows ?? []) as MarkRow[];
    const userIds = [...new Set(marks.map((m) => m.recorded_by))];
    const { data: profiles } = userIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
      : { data: [] };
    const nameByUser = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    await lectura;
    return marks.map((row) => mapRow(row, nameByUser));
  });

export type OdontogramConflict = { conflict: true; current: OdontogramMark | null };
export type OdontogramSaveResult = { id: string; conflict?: false } | OdontogramConflict;

/**
 * Registra una marca nueva. El trigger de la base cierra automáticamente la
 * marca vigente anterior para la misma (paciente, pieza, superficie) — nunca
 * se hace UPDATE de una marca ya guardada.
 *
 * `baseMarkId` es la marca que el equipo vio como vigente al capturar (o
 * `null` si la superficie estaba sana/sin marcar). El índice sobre
 * `(clinic_id, patient_id, tooth_number, surface) WHERE superseded_at IS NULL`
 * NO es único — dos marcas para la misma superficie pueden insertarse ambas
 * sin que Postgres se queje, y la segunda gana en silencio. Por eso el chequeo
 * de conflicto se hace acá, comparando contra lo que el cliente vio, antes de
 * insertar — no como reacción a un error de la base.
 */
export const setOdontogramMark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        toothNumber: TOOTH_NUMBER,
        surface: TOOTH_SURFACE_ENUM,
        condition: TOOTH_CONDITION_ENUM,
        material: z.string().trim().max(120).optional(),
        notes: z.string().trim().max(500).optional(),
        /** Id generado por el cliente al capturar — permite reintentos idempotentes. */
        id: z.string().uuid().optional(),
        /** Marca vigente vista al capturar, o null si no había ninguna. `undefined` = no verificar (llamadas legacy). */
        baseMarkId: z.string().uuid().nullable().optional(),
        /** Salta el chequeo de conflicto: "aplicar de todos modos" desde la bandeja de conflictos. */
        force: z.boolean().default(false),
      })
      .refine((v) => v.surface === "whole" || !WHOLE_TOOTH_CONDITIONS.includes(v.condition), {
        message:
          "Ausente, implante, corona y prótesis solo pueden marcarse a nivel de pieza completa.",
        path: ["condition"],
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<OdontogramSaveResult> => {
    const { supabase } = context;

    // Reintento idempotente: esta misma captura ya se guardó en un intento anterior.
    if (data.id) {
      const { data: propia } = await supabase
        .from("odontogram_marks")
        .select("id")
        .eq("id", data.id)
        .eq("clinic_id", data.clinicId)
        .maybeSingle();
      if (propia) return { id: propia.id };
    }

    if (!data.force && data.baseMarkId !== undefined) {
      const { data: vigenteRow } = await supabase
        .from("odontogram_marks")
        .select(MARK_COLUMNS)
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .eq("tooth_number", data.toothNumber)
        .eq("surface", data.surface)
        .is("superseded_at", null)
        .maybeSingle();

      const vigenteId = vigenteRow?.id ?? null;
      if (vigenteId !== (data.baseMarkId ?? null)) {
        let current: OdontogramMark | null = null;
        if (vigenteRow) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .eq("id", vigenteRow.recorded_by);
          const nameByUser = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
          current = mapRow(vigenteRow as MarkRow, nameByUser);
        }
        return { conflict: true, current };
      }
    }

    const { data: inserted, error } = await supabase
      .from("odontogram_marks")
      .insert({
        id: data.id,
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        tooth_number: data.toothNumber,
        surface: data.surface,
        condition: data.condition,
        material: data.material || null,
        notes: data.notes || null,
      })
      .select("id")
      .single();

    if (error) {
      const yaCreada = await filaYaCreada(
        supabase,
        "odontogram_marks",
        data.id,
        data.clinicId,
        error,
      );
      if (yaCreada) return { id: yaCreada };
      if ((error as { code?: string }).code === "23505") {
        throw new Error(
          "Otro usuario acaba de marcar esta superficie. Refresca el odontograma y vuelve a intentar.",
        );
      }
      throw new Error("No tienes permisos para modificar el odontograma.");
    }
    return { id: inserted.id };
  });
