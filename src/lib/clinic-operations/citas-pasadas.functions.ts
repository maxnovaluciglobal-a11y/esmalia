import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";
import {
  agruparCambiosPorEstado,
  ESTADOS_ABIERTOS,
  ESTADOS_DE_CIERRE,
  MAX_CIERRE_POR_TANDA,
  type EstadoAbierto,
  type EstadoDeCierre,
} from "@/lib/clinic-operations/citas-pasadas";
import { mensajeDb } from "@/lib/db-errors";
import { enBloques } from "@/lib/paginacion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Citas pasadas sin cerrar (PAN-05, Ola 2): las que ya terminaron y siguen en
 * "Sin respuesta", "Confirmada" o "En sala".
 *
 * Permiso: `agenda:manage` (owner, admin, dentist, reception), el mismo que
 * cambiar el estado de una cita desde la agenda. Es el par en el servidor
 * del aviso de Hoy y Agenda (regla 15); la policy de UPDATE de
 * `appointments` además lo hace cumplir en la base.
 */
const SIN_PERMISO = "No tienes permisos para cerrar citas en esta clínica.";

export interface CitaPasadaSinCerrar {
  id: string;
  pacienteId: string;
  paciente: string;
  profesional: string | null;
  tratamiento: string;
  /** ISO (instante). La UI lo muestra en el huso de la clínica. */
  inicio: string;
  fin: string;
  estado: EstadoAbierto;
}

export interface CitasPasadasSinCerrar {
  /** Total real (count en la base), aunque la lista venga recortada. */
  total: number;
  citas: CitaPasadaSinCerrar[];
}

export const listCitasPasadasSinCerrar = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        /** Solo el número (para el aviso): no trae filas ni nombres. */
        soloTotal: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CitasPasadasSinCerrar> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "agenda:manage", SIN_PERMISO);
    const ahora = new Date().toISOString();

    const consulta = supabase
      .from("appointments")
      .select("id, patient_id, professional_id, treatment_label, starts_at, ends_at, status", {
        count: "exact",
        head: data.soloTotal,
      })
      .eq("clinic_id", data.clinicId)
      .in("status", [...ESTADOS_ABIERTOS])
      .lt("ends_at", ahora);
    const {
      data: filas,
      count,
      error,
    } = data.soloTotal
      ? await consulta
      : await consulta
          // Las más viejas primero: son las que más ensucian los números.
          .order("starts_at", { ascending: true })
          .range(0, MAX_CIERRE_POR_TANDA - 1);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las citas pasadas."));
    const total = count ?? filas?.length ?? 0;
    if (data.soloTotal || !filas || filas.length === 0) return { total, citas: [] };

    // Nombres en dos lecturas aparte + Map (sin embedded select, CLAUDE.md).
    const idsPacientes = [...new Set(filas.map((f) => f.patient_id))];
    const idsProfesionales = [...new Set(filas.map((f) => f.professional_id).filter(Boolean))];
    const nombresPacientes = new Map<string, string>();
    for (const bloque of enBloques(idsPacientes)) {
      const { data: pacientes, error: e } = await supabase
        .from("patients")
        .select("id, full_name")
        .eq("clinic_id", data.clinicId)
        .in("id", bloque);
      if (e) throw new Error(mensajeDb(e, "No pudimos cargar las citas pasadas."));
      for (const p of pacientes ?? []) nombresPacientes.set(p.id, p.full_name);
    }
    const nombresProfesionales = new Map<string, string>();
    for (const bloque of enBloques(idsProfesionales)) {
      const { data: profesionales, error: e } = await supabase
        .from("professionals")
        .select("id, full_name")
        .eq("clinic_id", data.clinicId)
        .in("id", bloque);
      if (e) throw new Error(mensajeDb(e, "No pudimos cargar las citas pasadas."));
      for (const p of profesionales ?? []) nombresProfesionales.set(p.id, p.full_name);
    }

    return {
      total,
      citas: filas.map((f) => ({
        id: f.id,
        pacienteId: f.patient_id,
        paciente: nombresPacientes.get(f.patient_id) ?? "Paciente",
        profesional: nombresProfesionales.get(f.professional_id) ?? null,
        tratamiento: f.treatment_label || "Consulta",
        inicio: f.starts_at,
        fin: f.ends_at,
        estado: f.status as EstadoAbierto,
      })),
    };
  });

export interface ResultadoDeCierre {
  /** Cuántas se cerraron con cada estado. */
  porEstado: Partial<Record<EstadoDeCierre, number>>;
  /** Pedidas que no se tocaron: otra persona ya las cerró o no son pasadas. */
  omitidas: number;
}

/**
 * Cierra una o varias citas pasadas. Cada UPDATE vuelve a exigir, en la
 * misma sentencia, que la cita sea de la clínica, siga abierta y ya haya
 * terminado: si alguien la cerró mientras tanto (o la reprogramó al futuro),
 * no se pisa. Nunca pasa a "confirmada", así que la regla de confirmación del
 * profesional no entra en juego.
 */
export const cerrarCitasPasadas = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        cambios: z
          .array(
            z.object({
              appointmentId: z.string().uuid(),
              estado: z.enum(ESTADOS_DE_CIERRE),
            }),
          )
          .min(1)
          .max(MAX_CIERRE_POR_TANDA),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ResultadoDeCierre> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "agenda:manage", SIN_PERMISO);
    const ahora = new Date().toISOString();
    const grupos = agruparCambiosPorEstado(data.cambios);
    const pedidas = [...grupos.values()].reduce((s, ids) => s + ids.length, 0);

    // AGE-22: una cita grupal no se marca "ausente" entera (la asistencia es
    // por paciente y la base lo rechaza). Se saca del bloque para que no tumbe
    // a las demás; queda como omitida y se pasa lista desde su cajón.
    const ausentes = grupos.get("ausente");
    if (ausentes?.length) {
      const grupales = new Set<string>();
      for (const bloque of enBloques(ausentes)) {
        const { data: filas } = await supabase
          .from("appointment_groups")
          .select("appointment_id")
          .eq("clinic_id", data.clinicId)
          .in("appointment_id", bloque);
        for (const f of filas ?? []) grupales.add(f.appointment_id);
      }
      if (grupales.size) {
        grupos.set(
          "ausente",
          ausentes.filter((id) => !grupales.has(id)),
        );
      }
    }

    const porEstado: Partial<Record<EstadoDeCierre, number>> = {};
    let cerradas = 0;
    for (const [estado, ids] of grupos) {
      for (const bloque of enBloques(ids)) {
        const { data: filas, error } = await supabase
          .from("appointments")
          .update({ status: estado })
          .eq("clinic_id", data.clinicId)
          .in("id", bloque)
          .in("status", [...ESTADOS_ABIERTOS])
          .lt("ends_at", ahora)
          .select("id");
        if (error) throw new Error(SIN_PERMISO);
        const n = filas?.length ?? 0;
        porEstado[estado] = (porEstado[estado] ?? 0) + n;
        cerradas += n;
      }
    }
    return { porEstado, omitidas: pedidas - cerradas };
  });
