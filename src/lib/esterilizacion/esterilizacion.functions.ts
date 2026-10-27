import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { mensajeDb } from "@/lib/db-errors";
import {
  INDICADORES,
  TIPOS_CICLO,
  normalizarCodigo,
  type EstadoPaquete,
  type Indicador,
  type PaqueteResumen,
  type ResultadoCiclo,
  type TipoCiclo,
} from "@/lib/esterilizacion/esterilizacion";
import { enBloques, leerTodasLasPaginas, mapConLimite } from "@/lib/paginacion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Trazabilidad de esterilización (MKT-10): ciclos de autoclave, paquetes de
 * instrumental y su uso en pacientes. Todo con la sesión del usuario: la RLS
 * (ven todos menos contabilidad; registran owner/admin/dentist/assistant) y
 * los triggers de la migración 20261110200100 deciden. Los mensajes de los
 * triggers se muestran tal cual; los de permisos, con el genérico.
 */

const SIN_PERMISO = "No tienes permisos para registrar esterilización en esta clínica.";

export interface Ciclo {
  id: string;
  year: number;
  number: number;
  equipment: string;
  equipmentSerial: string | null;
  runAt: string;
  cycleType: TipoCiclo;
  temperatureC: number | null;
  pressureBar: number | null;
  exposureMinutes: number | null;
  chemicalIndicator: Indicador;
  chemicalIndicatorClass: string | null;
  biologicalIndicator: Indicador;
  biologicalLot: string | null;
  biologicalReadAt: string | null;
  result: ResultadoCiclo;
  failureReason: string | null;
  responsibleName: string;
  notes: string | null;
}

export interface Paquete extends PaqueteResumen {
  contents: string;
  shelfLifeDays: number;
  discardReason: string | null;
  createdAt: string;
}

const COLUMNAS_CICLO =
  "id, year, number, equipment, equipment_serial, run_at, cycle_type, temperature_c, pressure_bar, exposure_minutes, chemical_indicator, chemical_indicator_class, biological_indicator, biological_lot, biological_read_at, result, failure_reason, responsible_name, notes";
const COLUMNAS_PAQUETE =
  "id, cycle_id, code, contents, shelf_life_days, expires_on, status, used_at, used_patient_id, used_appointment_id, discard_reason, created_at";

const num = (v: number | string | null) => (v === null ? null : Number(v));

/** Ciclos del último año (y paquetes de esos ciclos), lo más nuevo primero. */
export const listarEsterilizacion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), dias: z.number().int().min(7).max(1100).optional() })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ciclos: Ciclo[]; paquetes: Paquete[]; truncado: boolean }> => {
      const { supabase } = context;
      const desde = new Date(Date.now() - (data.dias ?? 400) * 86_400_000).toISOString();
      const lectura = await leerTodasLasPaginas(
        (a, b) =>
          supabase
            .from("sterilization_cycles")
            .select(COLUMNAS_CICLO)
            .eq("clinic_id", data.clinicId)
            .gte("run_at", desde)
            .order("run_at", { ascending: false })
            .order("id", { ascending: true })
            .range(a, b),
        { tope: 5000 },
      );
      if (lectura.error) throw new Error(mensajeDb(lectura.error, "No pudimos cargar los ciclos."));
      const ciclos: Ciclo[] = lectura.filas.map((c) => ({
        id: c.id,
        year: c.year,
        number: c.number,
        equipment: c.equipment,
        equipmentSerial: c.equipment_serial,
        runAt: c.run_at,
        cycleType: c.cycle_type as TipoCiclo,
        temperatureC: num(c.temperature_c),
        pressureBar: num(c.pressure_bar),
        exposureMinutes: num(c.exposure_minutes),
        chemicalIndicator: c.chemical_indicator as Indicador,
        chemicalIndicatorClass: c.chemical_indicator_class,
        biologicalIndicator: c.biological_indicator as Indicador,
        biologicalLot: c.biological_lot,
        biologicalReadAt: c.biological_read_at,
        result: c.result as ResultadoCiclo,
        failureReason: c.failure_reason,
        responsibleName: c.responsible_name,
        notes: c.notes,
      }));

      const bloques = await mapConLimite(enBloques(ciclos.map((c) => c.id)), 4, (ids) =>
        supabase
          .from("sterilization_packages")
          .select(COLUMNAS_PAQUETE)
          .eq("clinic_id", data.clinicId)
          .in("cycle_id", ids)
          .order("number", { ascending: false }),
      );
      const errP = bloques.find((b) => b.error)?.error;
      if (errP) throw new Error(mensajeDb(errP, "No pudimos cargar los paquetes."));
      const filas = bloques.flatMap((b) => b.data ?? []);

      const pacienteIds = [
        ...new Set(filas.map((p) => p.used_patient_id).filter((v): v is string => !!v)),
      ];
      const citaIds = [
        ...new Set(filas.map((p) => p.used_appointment_id).filter((v): v is string => !!v)),
      ];
      const [bPac, bCitas] = await Promise.all([
        mapConLimite(enBloques(pacienteIds), 4, (ids) =>
          supabase.from("patients").select("id, full_name").in("id", ids),
        ),
        mapConLimite(enBloques(citaIds), 4, (ids) =>
          supabase.from("appointments").select("id, starts_at").in("id", ids),
        ),
      ]);
      const nombre = new Map(bPac.flatMap((b) => b.data ?? []).map((p) => [p.id, p.full_name]));
      const inicioCita = new Map(
        bCitas.flatMap((b) => b.data ?? []).map((c) => [c.id, c.starts_at]),
      );

      return {
        ciclos,
        truncado: lectura.truncado,
        paquetes: filas.map((p) => ({
          id: p.id,
          cycleId: p.cycle_id,
          code: p.code,
          contents: p.contents,
          shelfLifeDays: p.shelf_life_days,
          expiresOn: p.expires_on,
          status: p.status as EstadoPaquete,
          usedAt: p.used_at,
          usedPatientId: p.used_patient_id,
          usedPatientName: p.used_patient_id ? (nombre.get(p.used_patient_id) ?? "Paciente") : null,
          usedAppointmentId: p.used_appointment_id,
          usedAppointmentAt: p.used_appointment_id
            ? (inicioCita.get(p.used_appointment_id) ?? null)
            : null,
          discardReason: p.discard_reason,
          createdAt: p.created_at,
        })),
      };
    },
  );

const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));
const medida = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();

export const registrarCiclo = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        branchId: z.string().uuid().nullable().optional(),
        equipment: z.string().trim().min(2, "Indica el equipo.").max(120),
        equipmentSerial: opcional(80),
        runAt: z.string().datetime({ offset: true }),
        cycleType: z.enum(TIPOS_CICLO),
        temperatureC: medida(50, 200),
        pressureBar: medida(0, 10),
        exposureMinutes: medida(0, 600),
        chemicalIndicator: z.enum(INDICADORES),
        chemicalIndicatorClass: opcional(40),
        biologicalIndicator: z.enum(INDICADORES),
        biologicalLot: opcional(60),
        result: z.enum(["pendiente", "aprobado", "fallido"]),
        failureReason: opcional(500),
        responsibleName: z
          .string()
          .trim()
          .min(2, "Indica quién es responsable del ciclo.")
          .max(120),
        notes: opcional(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: fila, error } = await context.supabase
      .from("sterilization_cycles")
      .insert({
        clinic_id: data.clinicId,
        branch_id: data.branchId ?? null,
        equipment: data.equipment,
        equipment_serial: data.equipmentSerial,
        run_at: data.runAt,
        cycle_type: data.cycleType,
        temperature_c: data.temperatureC ?? null,
        pressure_bar: data.pressureBar ?? null,
        exposure_minutes: data.exposureMinutes ?? null,
        chemical_indicator: data.chemicalIndicator,
        chemical_indicator_class: data.chemicalIndicatorClass,
        biological_indicator: data.biologicalIndicator,
        biological_lot: data.biologicalLot,
        result: data.result,
        failure_reason: data.failureReason,
        responsible_name: data.responsibleName,
        notes: data.notes,
      })
      .select("id, number, year, result")
      .single();
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    return fila;
  });

/** Lectura posterior: indicador biológico, resultado y notas (los parámetros quedan fijos). */
export const actualizarCiclo = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        cycleId: z.string().uuid(),
        chemicalIndicator: z.enum(INDICADORES).optional(),
        biologicalIndicator: z.enum(INDICADORES).optional(),
        biologicalLot: opcional(60),
        result: z.enum(["pendiente", "aprobado", "fallido"]).optional(),
        failureReason: opcional(500),
        notes: opcional(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const cambios: Database["public"]["Tables"]["sterilization_cycles"]["Update"] = {};
    if (data.chemicalIndicator) cambios.chemical_indicator = data.chemicalIndicator;
    if (data.biologicalIndicator) cambios.biological_indicator = data.biologicalIndicator;
    if (data.biologicalLot !== null) cambios.biological_lot = data.biologicalLot;
    if (data.result) cambios.result = data.result;
    if (data.failureReason !== null) cambios.failure_reason = data.failureReason;
    if (data.notes !== null) cambios.notes = data.notes;
    const { data: filas, error } = await context.supabase
      .from("sterilization_cycles")
      .update(cambios)
      .eq("id", data.cycleId)
      .eq("clinic_id", data.clinicId)
      .select("id, result");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    if (!filas?.length) throw new Error(SIN_PERMISO);
    return filas[0];
  });

export const etiquetarPaquetes = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        cycleId: z.string().uuid(),
        contents: z.string().trim().min(2, "Indica qué lleva el paquete.").max(200),
        shelfLifeDays: z.number().int().min(1).max(730),
        cantidad: z.number().int().min(1).max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const filas = Array.from({ length: data.cantidad }, () => ({
      clinic_id: data.clinicId,
      cycle_id: data.cycleId,
      contents: data.contents,
      shelf_life_days: data.shelfLifeDays,
    }));
    const { data: creados, error } = await context.supabase
      .from("sterilization_packages")
      .insert(filas)
      .select("id, code");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    return creados ?? [];
  });

/** Citas del paciente alrededor de hoy (para ligar el paquete a la atención). */
export const citasParaUsoDePaquete = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const desde = new Date(Date.now() - 36 * 3_600_000).toISOString();
    const hasta = new Date(Date.now() + 36 * 3_600_000).toISOString();
    const [propias, inscrito] = await Promise.all([
      supabase
        .from("appointments")
        .select("id, starts_at, treatment_label, status")
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .gte("starts_at", desde)
        .lte("starts_at", hasta)
        .neq("status", "cancelada"),
      supabase
        .from("appointment_group_participants")
        .select("appointment_id")
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .is("withdrawn_at", null),
    ]);
    if (propias.error) throw new Error(mensajeDb(propias.error, "No pudimos cargar las citas."));
    const grupalesIds = (inscrito.data ?? []).map((g) => g.appointment_id);
    const grupales = grupalesIds.length
      ? await supabase
          .from("appointments")
          .select("id, starts_at, treatment_label, status")
          .in("id", grupalesIds)
          .gte("starts_at", desde)
          .lte("starts_at", hasta)
          .neq("status", "cancelada")
      : {
          data: [] as { id: string; starts_at: string; treatment_label: string; status: string }[],
        };
    const todas = new Map(
      [...(propias.data ?? []), ...(grupales.data ?? [])].map((c) => [c.id, c]),
    );
    return [...todas.values()]
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((c) => ({ id: c.id, startsAt: c.starts_at, tratamiento: c.treatment_label }));
  });

export const usarPaquete = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        codigo: z.string().trim().min(3, "Escribe o escanea el código del paquete.").max(40),
        patientId: z.string().uuid(),
        appointmentId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const codigo = normalizarCodigo(data.codigo);
    const { data: pkg, error: errBuscar } = await context.supabase
      .from("sterilization_packages")
      .select("id")
      .eq("clinic_id", data.clinicId)
      .eq("code", codigo)
      .maybeSingle();
    if (errBuscar) throw new Error(mensajeDb(errBuscar, "No pudimos buscar el paquete."));
    if (!pkg) throw new Error(`No encontramos el paquete ${codigo} en esta clínica.`);
    const { data: filas, error } = await context.supabase
      .from("sterilization_packages")
      .update({
        status: "usado",
        used_patient_id: data.patientId,
        used_appointment_id: data.appointmentId ?? null,
        used_at: new Date().toISOString(),
      })
      .eq("id", pkg.id)
      .eq("clinic_id", data.clinicId)
      .select("id, code");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    if (!filas?.length) throw new Error(SIN_PERMISO);
    return filas[0];
  });

export const darDeBajaPaquete = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        packageId: z.string().uuid(),
        estado: z.enum(["descartado", "retirado"]),
        motivo: z.string().trim().min(3, "Indica el motivo.").max(300),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: filas, error } = await context.supabase
      .from("sterilization_packages")
      .update({ status: data.estado, discard_reason: data.motivo })
      .eq("id", data.packageId)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    if (!filas?.length) throw new Error(SIN_PERMISO);
    return { ok: true };
  });
