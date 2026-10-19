import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";
import {
  PERIODONTAL_POINTS,
  type PeriodontalChart,
  type PeriodontalChartSummary,
  type PeriodontalPoint,
  type PeriodontalToothMeasurement,
} from "@/lib/clinical/periodontal";

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

const POINT_ENUM = z.enum(PERIODONTAL_POINTS);

const POINT_MEASUREMENT_INPUT = z.object({
  point: POINT_ENUM,
  pocketDepthMm: z.number().int().min(0).max(15).nullable().optional(),
  bleeding: z.boolean().nullable().optional(),
  recessionMm: z.number().int().min(-10).max(15).nullable().optional(),
});

const TOOTH_MEASUREMENT_INPUT = z.object({
  toothNumber: TOOTH_NUMBER,
  points: z.array(POINT_MEASUREMENT_INPUT).min(1).max(6),
  mobility: z.number().int().min(0).max(3).nullable().optional(),
  furcation: z.number().int().min(0).max(3).nullable().optional(),
});

type MeasurementRow = {
  id: string;
  chart_id: string;
  tooth_number: number;
  point: string;
  pocket_depth_mm: number | null;
  bleeding: boolean | null;
  recession_mm: number | null;
  mobility: number | null;
  furcation: number | null;
};

type ChartRow = {
  id: string;
  patient_id: string;
  notes: string | null;
  recorded_by: string;
  recorded_at: string;
};

/** Agrupa las filas planas de measurements en la forma por-pieza que usa la UI. */
function groupMeasurements(rows: MeasurementRow[]): PeriodontalToothMeasurement[] {
  const byTooth = new Map<number, PeriodontalToothMeasurement>();
  for (const row of rows) {
    const tooth = byTooth.get(row.tooth_number) ?? {
      toothNumber: row.tooth_number,
      points: [],
      mobility: null,
      furcation: null,
    };
    if (row.point === "whole") {
      tooth.mobility = row.mobility;
      tooth.furcation = row.furcation;
    } else {
      tooth.points.push({
        point: row.point as PeriodontalPoint,
        pocketDepthMm: row.pocket_depth_mm,
        bleeding: row.bleeding,
        recessionMm: row.recession_mm,
      });
    }
    byTooth.set(row.tooth_number, tooth);
  }
  return [...byTooth.values()].sort((a, b) => a.toothNumber - b.toothNumber);
}

/** Historial de sondajes de un paciente (resumen, sin el detalle de cada punto). */
export const listPeriodontalCharts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PeriodontalChartSummary[]> => {
    const { supabase } = context;
    // SEG-02: en paralelo con la carga; se espera antes de responder.
    const lectura = registrarLecturaDeFicha(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "periodontograma",
    });

    const { data: charts, error } = await supabase
      .from("periodontal_charts")
      .select("id, patient_id, notes, recorded_by, recorded_at")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .order("recorded_at", { ascending: false });

    if (error)
      throw new Error(
        mensajeDb(error, "No pudimos cargar el historial de sondajes periodontales del paciente."),
      );

    const chartRows = (charts ?? []) as ChartRow[];
    if (chartRows.length === 0) {
      await lectura;
      return [];
    }

    const chartIds = chartRows.map((c) => c.id);
    const { data: measurements, error: mErr } = await supabase
      .from("periodontal_measurements")
      .select("chart_id, tooth_number, point, pocket_depth_mm, bleeding")
      .in("chart_id", chartIds);
    if (mErr)
      throw new Error(
        mensajeDb(
          mErr,
          "No pudimos cargar las mediciones del historial de sondajes periodontales.",
        ),
      );

    const userIds = [...new Set(chartRows.map((c) => c.recorded_by))];
    const { data: profiles } = userIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
      : { data: [] };
    const nameByUser = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

    await lectura;
    return chartRows.map((c) => {
      const rows = (measurements ?? []).filter((m) => m.chart_id === c.id);
      const teeth = new Set(rows.map((r) => r.tooth_number));
      const pdValues = rows.map((r) => r.pocket_depth_mm).filter((v): v is number => v != null);
      const bleedingSites = rows.filter((r) => r.bleeding === true).length;
      return {
        id: c.id,
        notes: c.notes,
        recordedById: c.recorded_by,
        recordedByName: nameByUser.get(c.recorded_by) ?? null,
        recordedAt: c.recorded_at,
        teethCount: teeth.size,
        maxPocketDepthMm: pdValues.length ? Math.max(...pdValues) : null,
        bleedingSitesCount: bleedingSites,
      };
    });
  });

/** El sondaje más reciente del paciente, con el detalle completo por pieza/punto. */
export const getLatestPeriodontalChart = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PeriodontalChart | null> => {
    const { supabase } = context;
    // SEG-02: en paralelo con la carga; se espera antes de responder.
    const lectura = registrarLecturaDeFicha(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "periodontograma",
    });

    const { data: chart, error } = await supabase
      .from("periodontal_charts")
      .select("id, patient_id, notes, recorded_by, recorded_at")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error)
      throw new Error(
        mensajeDb(error, "No pudimos cargar el último sondaje periodontal del paciente."),
      );
    await lectura;
    if (!chart) return null;

    return getPeriodontalChartById({
      data: { clinicId: data.clinicId, chartId: (chart as ChartRow).id },
    });
  });

/** Detalle completo de un chart puntual (usado por getLatestPeriodontalChart y por el historial). */
export const getPeriodontalChartById = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), chartId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PeriodontalChart | null> => {
    const { supabase } = context;

    const { data: chart, error } = await supabase
      .from("periodontal_charts")
      .select("id, patient_id, notes, recorded_by, recorded_at")
      .eq("clinic_id", data.clinicId)
      .eq("id", data.chartId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el sondaje periodontal."));
    if (!chart) return null;

    const chartRow = chart as ChartRow;

    const { data: measurements, error: mErr } = await supabase
      .from("periodontal_measurements")
      .select(
        "id, chart_id, tooth_number, point, pocket_depth_mm, bleeding, recession_mm, mobility, furcation",
      )
      .eq("chart_id", chartRow.id)
      .order("tooth_number", { ascending: true });
    if (mErr)
      throw new Error(mensajeDb(mErr, "No pudimos cargar las mediciones del sondaje periodontal."));

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("id", chartRow.recorded_by);
    const recordedByName = (profiles ?? [])[0]?.full_name ?? null;

    return {
      id: chartRow.id,
      patientId: chartRow.patient_id,
      notes: chartRow.notes,
      recordedById: chartRow.recorded_by,
      recordedByName,
      recordedAt: chartRow.recorded_at,
      teeth: groupMeasurements((measurements ?? []) as MeasurementRow[]),
    };
  });

/**
 * Registra un sondaje completo: crea el chart y todas sus mediciones en un
 * solo request. Inmutable — nunca se edita un chart existente, un sondaje
 * nuevo es siempre un chart nuevo (mismo criterio que odontogram_marks/
 * clinical_notes: la historia clínica no se corrige en duro).
 */
export const createPeriodontalChart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        notes: z.string().trim().max(1000).optional(),
        teeth: z.array(TOOTH_MEASUREMENT_INPUT).min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ chartId: string }> => {
    const { supabase } = context;

    const { data: chart, error: chartError } = await supabase
      .from("periodontal_charts")
      .insert({
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        notes: data.notes || null,
      })
      .select("id")
      .single();

    if (chartError) {
      throw new Error("No tienes permisos para registrar un periodontograma.");
    }

    const rows: Array<{
      clinic_id: string;
      chart_id: string;
      tooth_number: number;
      point: PeriodontalPoint | "whole";
      pocket_depth_mm: number | null;
      bleeding: boolean | null;
      recession_mm: number | null;
      mobility: number | null;
      furcation: number | null;
    }> = [];

    for (const tooth of data.teeth) {
      for (const p of tooth.points) {
        rows.push({
          clinic_id: data.clinicId,
          chart_id: chart.id,
          tooth_number: tooth.toothNumber,
          point: p.point,
          pocket_depth_mm: p.pocketDepthMm ?? null,
          bleeding: p.bleeding ?? null,
          recession_mm: p.recessionMm ?? null,
          mobility: null,
          furcation: null,
        });
      }
      // Fila "whole" solo si hay movilidad o furca cargadas para esta pieza.
      if (tooth.mobility != null || tooth.furcation != null) {
        rows.push({
          clinic_id: data.clinicId,
          chart_id: chart.id,
          tooth_number: tooth.toothNumber,
          point: "whole",
          pocket_depth_mm: null,
          bleeding: null,
          recession_mm: null,
          mobility: tooth.mobility ?? null,
          furcation: tooth.furcation ?? null,
        });
      }
    }

    if (rows.length > 0) {
      const { error: measurementsError } = await supabase
        .from("periodontal_measurements")
        .insert(rows);
      if (measurementsError) {
        throw new Error("No se pudieron guardar las mediciones del sondaje.");
      }
    }

    return { chartId: chart.id };
  });
