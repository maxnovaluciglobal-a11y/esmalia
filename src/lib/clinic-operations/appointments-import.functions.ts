// src/lib/clinic-operations/appointments-import.functions.ts
//
// Importador CSV de citas FUTURAS (recomendación #4 del benchmark de
// onboarding, 25-sep-2026 — ver memoria esmalia_onboarding_benchmark_20260925).
// `importPatients` (patients.functions.ts) dejó las citas afuera a
// propósito: matchear profesional/sucursal desde texto libre de un CSV
// externo es mucho más riesgoso que insertar un paciente suelto, porque una
// resolución equivocada no es una fila vacía — es una cita real apuntando al
// profesional o al horario equivocado. Por eso esto NUNCA adivina: cualquier
// ambigüedad (nombre sin match exacto, dos profesionales con el mismo
// nombre) hace que la fila se salte con un motivo explícito, nunca que se
// asigne "el que más se parece".
//
// No importa historial: solo tiene sentido para citas que todavía no
// pasaron (agenda futura al migrar desde otro sistema).

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { mensajeDb } from "@/lib/db-errors";
import { validarHorarioYSolapamiento, type Solapamiento } from "./appointments.functions";
import type { Database } from "@/integrations/supabase/types";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

const IMPORT_APPT_CHUNK_SIZE = 50;
const DURACION_FALLBACK_MIN = 30;

const IMPORT_APPT_ROW_SCHEMA = z.object({
  documentoPaciente: z.string().trim().min(1),
  profesional: z.string().trim().optional(),
  sucursal: z.string().trim().optional(),
  // Se acepta "YYYY-MM-DD HH:mm" o "YYYY-MM-DDTHH:mm" — se normaliza acá,
  // nunca en el cliente, para que preview e import vean exactamente lo mismo.
  fechaHora: z.string().trim().min(1),
  tratamiento: z.string().trim().min(1).max(200),
  duracionMin: z.coerce.number().int().min(5).max(480).optional(),
});

export type ImportAppointmentRow = z.infer<typeof IMPORT_APPT_ROW_SCHEMA>;

export interface ImportAppointmentPreviewRow {
  row: number;
  documentoPaciente: string;
  pacienteNombre: string | null;
  profesionalNombre: string | null;
  sucursalNombre: string | null;
  fechaHora: string;
  tratamiento: string;
  action: "create" | "skip";
  /** Motivo del skip, o aviso soft de solapamiento si action = "create". */
  nota: string | null;
}

export interface ImportAppointmentsResult {
  created: number;
  skipped: number;
  skipReasons: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
  errors: { row: number; message: string }[];
}

type Branch = { id: string; name: string; timezone: string | null };
type Professional = { id: string; full_name: string; specialty_id: string | null };

/** Normaliza "YYYY-MM-DD HH:mm" → "YYYY-MM-DDTHH:mm". Cualquier otro formato
 *  (fecha sola, hora sola, texto libre) se rechaza en vez de adivinar. */
function normalizarFechaHora(raw: string): string | null {
  const candidata = raw.trim().replace(" ", "T");
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(candidata) ? candidata : null;
}

/** Único profesional activo → se asigna sin leer la columna (caso típico:
 *  dentista solo). Con varios, exact-match case-insensitive; cualquier otra
 *  cosa (sin nombre, sin match, match ambiguo) es un error explícito. */
function resolverProfesional(
  nombreCsv: string | undefined,
  profesionales: Professional[],
): { id: string; nombre: string } | { error: string } {
  if (profesionales.length === 1) {
    return { id: profesionales[0].id, nombre: profesionales[0].full_name };
  }
  if (!nombreCsv) {
    return { error: "Falta el nombre del profesional (la clínica tiene más de uno)." };
  }
  const buscado = nombreCsv.trim().toLowerCase();
  const candidatos = profesionales.filter((p) => p.full_name.trim().toLowerCase() === buscado);
  if (candidatos.length === 0) {
    return { error: `No encontramos un profesional llamado "${nombreCsv}".` };
  }
  if (candidatos.length > 1) {
    return { error: `Hay más de un profesional llamado "${nombreCsv}" — no podemos elegir.` };
  }
  return { id: candidatos[0].id, nombre: candidatos[0].full_name };
}

/** Misma lógica que `resolverProfesional`, para sucursales. */
function resolverSucursal(
  nombreCsv: string | undefined,
  sucursales: Branch[],
): { id: string; nombre: string; timezone: string } | { error: string } {
  if (sucursales.length === 1) {
    return {
      id: sucursales[0].id,
      nombre: sucursales[0].name,
      timezone: sucursales[0].timezone || "America/Santiago",
    };
  }
  if (!nombreCsv) {
    return { error: "Falta el nombre de la sucursal (la clínica tiene más de una)." };
  }
  const buscado = nombreCsv.trim().toLowerCase();
  const candidatas = sucursales.filter((b) => b.name.trim().toLowerCase() === buscado);
  if (candidatas.length === 0) {
    return { error: `No encontramos una sucursal llamada "${nombreCsv}".` };
  }
  if (candidatas.length > 1) {
    return { error: `Hay más de una sucursal llamada "${nombreCsv}" — no podemos elegir.` };
  }
  return {
    id: candidatas[0].id,
    nombre: candidatas[0].name,
    timezone: candidatas[0].timezone || "America/Santiago",
  };
}

/** Contexto compartido entre preview e import — mismas queries, para que las
 *  dos pasadas resuelvan exactamente igual (nunca mostrar un preview que el
 *  import real no vaya a poder reproducir). */
async function cargarContexto(supabase: SupabaseClient<Database>, clinicId: string) {
  const [
    { data: branches, error: branchesErr },
    { data: professionals, error: profErr },
    { data: patients, error: patErr },
  ] = await Promise.all([
    supabase
      .from("branches")
      .select("id, name, timezone")
      .eq("clinic_id", clinicId)
      .eq("is_active", true),
    supabase
      .from("professionals")
      .select("id, full_name, specialty_id")
      .eq("clinic_id", clinicId)
      .eq("is_active", true),
    supabase.from("patients").select("id, document_id, full_name").eq("clinic_id", clinicId),
  ]);
  if (branchesErr) throw new Error(mensajeDb(branchesErr, "No pudimos cargar las sucursales."));
  if (profErr) throw new Error(mensajeDb(profErr, "No pudimos cargar los profesionales."));
  if (patErr) throw new Error(mensajeDb(patErr, "No pudimos cargar los pacientes."));

  const specialtyIds = [
    ...new Set(
      (professionals ?? []).map((p) => p.specialty_id).filter((v): v is string => Boolean(v)),
    ),
  ];
  const { data: specialties, error: specErr } = await supabase
    .from("specialties")
    .select("id, default_duration_min")
    .in("id", specialtyIds.length ? specialtyIds : [""]);
  if (specErr) throw new Error(mensajeDb(specErr, "No pudimos cargar las especialidades."));

  const duracionPorEspecialidad = new Map(
    (specialties ?? []).map((s) => [s.id, s.default_duration_min]),
  );
  const pacientePorDocumento = new Map(
    (patients ?? [])
      .filter((p) => p.document_id)
      .map((p) => [(p.document_id as string).trim().toLowerCase(), p]),
  );

  return {
    branches: branches ?? [],
    professionals: professionals ?? [],
    duracionPorEspecialidad,
    pacientePorDocumento,
  };
}

type Contexto = Awaited<ReturnType<typeof cargarContexto>>;

/** Resuelve una fila contra el contexto ya cargado. Comparte la clasificación
 *  entre preview (no escribe) e import (si escribe) — igual criterio que
 *  `previewImportPatients`/`importPatients`: no vale la pena factorizar el
 *  llamado a `validarHorarioYSolapamiento` (necesita I/O propio) en este
 *  helper puramente síncrono. */
function resolverFila(
  row: ImportAppointmentRow,
  ctx: Contexto,
): { ok: true; datos: ResolucionOk } | { ok: false; motivo: string } {
  const doc = row.documentoPaciente.trim().toLowerCase();
  const paciente = ctx.pacientePorDocumento.get(doc);
  if (!paciente) {
    return {
      ok: false,
      motivo: `No encontramos un paciente con documento "${row.documentoPaciente}".`,
    };
  }

  const profesional = resolverProfesional(row.profesional, ctx.professionals);
  if ("error" in profesional) return { ok: false, motivo: profesional.error };

  const sucursal = resolverSucursal(row.sucursal, ctx.branches);
  if ("error" in sucursal) return { ok: false, motivo: sucursal.error };

  const fechaHora = normalizarFechaHora(row.fechaHora);
  if (!fechaHora) {
    return {
      ok: false,
      motivo: `Fecha/hora "${row.fechaHora}" no tiene el formato AAAA-MM-DD HH:mm.`,
    };
  }

  const profesionalRow = ctx.professionals.find((p) => p.id === profesional.id);
  const duracionMin =
    row.duracionMin ??
    (profesionalRow?.specialty_id
      ? (ctx.duracionPorEspecialidad.get(profesionalRow.specialty_id) ?? DURACION_FALLBACK_MIN)
      : DURACION_FALLBACK_MIN);

  return {
    ok: true,
    datos: {
      patientId: paciente.id,
      pacienteNombre: paciente.full_name,
      branchId: sucursal.id,
      sucursalNombre: sucursal.nombre,
      professionalId: profesional.id,
      profesionalNombre: profesional.nombre,
      fechaHora,
      duracionMin,
      tratamiento: row.tratamiento,
    },
  };
}

interface ResolucionOk {
  patientId: string;
  pacienteNombre: string;
  branchId: string;
  sucursalNombre: string;
  professionalId: string;
  profesionalNombre: string;
  fechaHora: string;
  duracionMin: number;
  tratamiento: string;
}

const importAppointmentsInput = z.object({
  clinicId: z.string().uuid(),
  rows: z.array(IMPORT_APPT_ROW_SCHEMA).min(1).max(1000),
});

/** Vista previa — no escribe nada. Muestra qué se va a crear, qué se va a
 *  saltear y por qué, y el aviso soft de solapamiento cuando corresponde
 *  (mismo criterio no-bloqueante que `createAppointment` manual). */
export const previewImportAppointments = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => importAppointmentsInput.parse(input))
  .handler(async ({ data, context }): Promise<ImportAppointmentPreviewRow[]> => {
    const ctx = await cargarContexto(context.supabase, data.clinicId);

    const resultado: ImportAppointmentPreviewRow[] = [];
    for (let i = 0; i < data.rows.length; i++) {
      const row = data.rows[i];
      const resuelta = resolverFila(row, ctx);
      if (!resuelta.ok) {
        resultado.push({
          row: i + 1,
          documentoPaciente: row.documentoPaciente,
          pacienteNombre: null,
          profesionalNombre: null,
          sucursalNombre: null,
          fechaHora: row.fechaHora,
          tratamiento: row.tratamiento,
          action: "skip",
          nota: resuelta.motivo,
        });
        continue;
      }

      const d = resuelta.datos;
      let nota: string | null = null;
      try {
        const { solapamiento } = await validarHorarioYSolapamiento(context.supabase, {
          clinicId: data.clinicId,
          branchId: d.branchId,
          professionalId: d.professionalId,
          startsAtRaw: d.fechaHora,
          duracionMin: d.duracionMin,
        });
        if (solapamiento) {
          nota = `Choca con otra cita de ${d.profesionalNombre} a las ${solapamiento.startsAt}.`;
        }
      } catch (e) {
        // Fuera del horario declarado del profesional u otro rechazo duro:
        // en preview es solo información, la fila se muestra como "se va a
        // saltear" para que el resultado real del import no sorprenda.
        resultado.push({
          row: i + 1,
          documentoPaciente: row.documentoPaciente,
          pacienteNombre: d.pacienteNombre,
          profesionalNombre: d.profesionalNombre,
          sucursalNombre: d.sucursalNombre,
          fechaHora: row.fechaHora,
          tratamiento: row.tratamiento,
          action: "skip",
          nota: e instanceof Error ? e.message : "No pasó la validación de horario.",
        });
        continue;
      }

      resultado.push({
        row: i + 1,
        documentoPaciente: row.documentoPaciente,
        pacienteNombre: d.pacienteNombre,
        profesionalNombre: d.profesionalNombre,
        sucursalNombre: d.sucursalNombre,
        fechaHora: row.fechaHora,
        tratamiento: row.tratamiento,
        action: "create",
        nota,
      });
    }
    return resultado;
  });

/** Import real. Corre la MISMA resolución que el preview — una fila que el
 *  preview marcó "create" se crea; ninguna fila nueva puede aparecer
 *  bloqueada acá que no lo estuviera ya en preview, salvo que algo haya
 *  cambiado en la base entre las dos llamadas (otra cita creada en el medio),
 *  que es exactamente para lo que existe el aviso soft de solapamiento. */
export const importAppointments = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => importAppointmentsInput.parse(input))
  .handler(async ({ data, context }): Promise<ImportAppointmentsResult> => {
    const ctx = await cargarContexto(context.supabase, data.clinicId);

    const skipReasons: ImportAppointmentsResult["skipReasons"] = [];
    const warnings: ImportAppointmentsResult["warnings"] = [];
    const errors: ImportAppointmentsResult["errors"] = [];
    const paraCrear: { row: number; datos: ResolucionOk; startsAt: Date; endsAt: Date }[] = [];

    for (let i = 0; i < data.rows.length; i++) {
      const row = data.rows[i];
      const resuelta = resolverFila(row, ctx);
      if (!resuelta.ok) {
        skipReasons.push({ row: i + 1, message: resuelta.motivo });
        continue;
      }
      const d = resuelta.datos;
      try {
        const { startsAt, endsAt, solapamiento } = await validarHorarioYSolapamiento(
          context.supabase,
          {
            clinicId: data.clinicId,
            branchId: d.branchId,
            professionalId: d.professionalId,
            startsAtRaw: d.fechaHora,
            duracionMin: d.duracionMin,
          },
        );
        if (solapamiento) {
          warnings.push({
            row: i + 1,
            message: `Se creó igual — choca con otra cita de ${d.profesionalNombre}.`,
          });
        }
        paraCrear.push({ row: i + 1, datos: d, startsAt, endsAt });
      } catch (e) {
        skipReasons.push({
          row: i + 1,
          message: e instanceof Error ? e.message : "No pasó la validación de horario.",
        });
      }
    }

    // Activación (docs/MEDICION.md): ¿la clínica ya tenía citas antes de
    // importar? Se mide antes de insertar.
    const eventos = await import("@/lib/marketing/eventos-servidor.server");
    const habiaCitasAntes =
      paraCrear.length > 0
        ? await eventos.clinicaTieneCitas(context.supabase, data.clinicId)
        : true;

    let created = 0;
    for (let i = 0; i < paraCrear.length; i += IMPORT_APPT_CHUNK_SIZE) {
      const chunk = paraCrear.slice(i, i + IMPORT_APPT_CHUNK_SIZE);
      const { error: insError } = await context.supabase.from("appointments").insert(
        chunk.map((c) => ({
          clinic_id: data.clinicId,
          branch_id: c.datos.branchId,
          patient_id: c.datos.patientId,
          professional_id: c.datos.professionalId,
          treatment_label: c.datos.tratamiento,
          starts_at: c.startsAt.toISOString(),
          ends_at: c.endsAt.toISOString(),
        })),
      );
      if (insError) {
        errors.push({
          row: chunk[0].row,
          message: `Filas ${chunk[0].row}-${chunk[chunk.length - 1].row}: ${insError.message}`,
        });
      } else {
        created += chunk.length;
      }
    }

    if (created > 0 && habiaCitasAntes === false) {
      await eventos.registrarPrimeraCitaSiCorresponde({
        supabase: context.supabase,
        clinicId: data.clinicId,
        userId: context.userId,
        origen: "importacion",
        habiaCitasAntes: false,
      });
    }

    return {
      created,
      skipped: skipReasons.length,
      skipReasons,
      warnings,
      errors,
    };
  });

export type { Solapamiento };
