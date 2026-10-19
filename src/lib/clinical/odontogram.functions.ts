import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isUndefinedColumnError, mensajeDb } from "@/lib/db-errors";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";
import { filaYaCreada } from "@/lib/idempotency";
import {
  MARK_CONSERVATIONS,
  MARK_STATUSES,
  TOOTH_CONDITIONS,
  TOOTH_SURFACES,
  type MarkConservation,
  type MarkStatus,
  type OdontogramMark,
} from "@/lib/clinical/odontogram";
import { marcasQueReemplaza, validarMarca } from "@/lib/clinical/odontograma-reglas";

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
  /** Ausentes antes de aplicar la migración 20261019170000. */
  status?: string | null;
  conservation?: string | null;
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
    status: (row.status as MarkStatus | null | undefined) ?? "existente",
    conservation: (row.conservation as MarkConservation | null | undefined) ?? null,
    material: row.material,
    notes: row.notes,
    supersededAt: row.superseded_at,
    recordedAt: row.recorded_at,
    recordedById: row.recorded_by,
    recordedByName: nameByUser.get(row.recorded_by) ?? null,
  };
}

const MARK_COLUMNS_LEGACY =
  "id, tooth_number, surface, condition, material, notes, superseded_at, recorded_at, recorded_by";
const MARK_COLUMNS = `${MARK_COLUMNS_LEGACY}, status, conservation`;

/**
 * SELECT de marcas que tolera la base sin la migración 20261019170000: si
 * `status`/`conservation` todavía no existen, repite sin ellas y cada marca
 * se lee como "existente" sin estado de conservación (lo que eran). Así el
 * deploy del código no rompe la ficha si la migración se aplica después.
 */
async function seleccionarMarcas(
  construir: (
    columnas: string,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
): Promise<{ rows: MarkRow[]; error: { code?: string; message?: string } | null }> {
  const primero = await construir(MARK_COLUMNS);
  if (primero.error && isUndefinedColumnError(primero.error)) {
    const legado = await construir(MARK_COLUMNS_LEGACY);
    return { rows: (legado.data ?? []) as MarkRow[], error: legado.error };
  }
  return { rows: (primero.data ?? []) as MarkRow[], error: primero.error };
}

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

    const { rows: marks, error } = await seleccionarMarcas((columnas) =>
      supabase
        .from("odontogram_marks")
        .select(columnas)
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .is("superseded_at", null)
        .order("tooth_number", { ascending: true })
        .order("surface", { ascending: true })
        .order("recorded_at", { ascending: true }),
    );

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el odontograma del paciente."));

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

    const { rows: marks, error } = await seleccionarMarcas((columnas) => {
      let query = supabase
        .from("odontogram_marks")
        .select(columnas)
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .order("recorded_at", { ascending: false })
        .limit(500);
      if (data.toothNumber !== undefined) {
        query = query.eq("tooth_number", data.toothNumber);
      }
      return query;
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el historial del odontograma."));

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
 * Registra una marca nueva. El trigger de la base cierra las marcas vigentes
 * que esta reemplaza según la regla de CLI-01 (`marcasQueReemplaza`): mismo
 * grupo, misma zona y mismo estado, el plan que se cumplió, "sano" y
 * "ausente". Nunca se hace UPDATE de una marca ya guardada.
 *
 * Conflictos: el cliente manda `baseMarkIds`, las marcas que él calculó que
 * la nueva iba a reemplazar con lo que tenía en pantalla. Acá se recalcula
 * con lo vigente en la base; si no coincide, alguien cambió esa zona mientras
 * tanto y se devuelve `{conflict:true}` en vez de pisarlo. El índice de
 * marcas vigentes no es único, así que el chequeo tiene que ser este y no un
 * error de la base.
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
        /** Por defecto "existente": la cola offline puede traer marcas de antes de CLI-02. */
        status: z.enum(MARK_STATUSES).default("existente"),
        conservation: z.enum(MARK_CONSERVATIONS).nullable().optional(),
        material: z.string().trim().max(120).optional(),
        notes: z.string().trim().max(500).optional(),
        /** Id generado por el cliente al capturar — permite reintentos idempotentes. */
        id: z.string().uuid().optional(),
        /** Marcas que el cliente calculó que la nueva reemplaza. `undefined` = no verificar. */
        baseMarkIds: z.array(z.string().uuid()).max(50).optional(),
        /** Formato anterior (una marca por superficie), todavía en colas offline viejas. */
        baseMarkId: z.string().uuid().nullable().optional(),
        /** Salta el chequeo de conflicto: "aplicar de todos modos" desde la bandeja de conflictos. */
        force: z.boolean().default(false),
      })
      .superRefine((v, ctx) => {
        const problema = validarMarca(v);
        if (problema) ctx.addIssue({ code: "custom", message: problema, path: ["condition"] });
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

    const verificar =
      !data.force && (data.baseMarkIds !== undefined || data.baseMarkId !== undefined);
    if (verificar) {
      const { rows: vigentesRows } = await seleccionarMarcas((columnas) =>
        supabase
          .from("odontogram_marks")
          .select(columnas)
          .eq("clinic_id", data.clinicId)
          .eq("patient_id", data.patientId)
          .eq("tooth_number", data.toothNumber)
          .is("superseded_at", null),
      );
      const sinNombres = new Map<string, string | null>();
      const vigentes = vigentesRows.map((r) => mapRow(r, sinNombres));

      let conflicto: OdontogramMark | null | undefined;
      if (data.baseMarkIds !== undefined) {
        const esperadas = [...data.baseMarkIds].sort();
        const reales = marcasQueReemplaza(vigentes, data);
        if (esperadas.join(",") !== reales.join(",")) {
          conflicto = vigentes.find((m) => reales.includes(m.id)) ?? null;
        }
      } else if (data.baseMarkId) {
        // Cola vieja: la marca que el equipo vio tiene que seguir vigente.
        if (!vigentes.some((m) => m.id === data.baseMarkId)) {
          conflicto =
            vigentes.find((m) => m.surface === data.surface && m.condition !== "sano") ?? null;
        }
      }

      if (conflicto !== undefined) {
        let current: OdontogramMark | null = null;
        if (conflicto) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .eq("id", conflicto.recordedById);
          current = { ...conflicto, recordedByName: profiles?.[0]?.full_name ?? null };
        }
        return { conflict: true, current };
      }
    }

    const fila = {
      id: data.id,
      clinic_id: data.clinicId,
      patient_id: data.patientId,
      tooth_number: data.toothNumber,
      surface: data.surface,
      condition: data.condition,
      material: data.material || null,
      notes: data.notes || null,
    };
    const conEstado = { ...fila, status: data.status, conservation: data.conservation ?? null };

    let { data: inserted, error } = await supabase
      .from("odontogram_marks")
      .insert(conEstado)
      .select("id")
      .single();

    // Base sin la migración 20261019170000: una marca "existente" sin estado de
    // conservación es exactamente lo que la base vieja sabe guardar.
    if (error && isUndefinedColumnError(error)) {
      if (data.status !== "existente" || data.conservation) {
        throw new Error(
          "El odontograma todavía no tiene activados los estados. Guarda la marca como existente sin estado o avísale al equipo de Esmalia.",
        );
      }
      ({ data: inserted, error } = await supabase
        .from("odontogram_marks")
        .insert(fila)
        .select("id")
        .single());
    }

    if (error || !inserted) {
      const yaCreada = await filaYaCreada(
        supabase,
        "odontogram_marks",
        data.id,
        data.clinicId,
        error,
      );
      if (yaCreada) return { id: yaCreada };
      const code = (error as { code?: string } | null)?.code;
      if (code === "23505") {
        throw new Error(
          "Otro usuario acaba de marcar esta superficie. Refresca el odontograma y vuelve a intentar.",
        );
      }
      // 23514: la validación del catálogo (validate_odontogram_mark) ya trae
      // el mensaje en español. 22P02: condición nueva en una base sin migrar.
      if (code === "23514") throw new Error(mensajeDb(error, "La marca no es válida."));
      if (code === "22P02") {
        throw new Error(
          "Esa condición todavía no está activada en el odontograma. Avísale al equipo de Esmalia.",
        );
      }
      throw new Error("No tienes permisos para modificar el odontograma.");
    }
    return { id: inserted.id };
  });
