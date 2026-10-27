/**
 * Seguimiento de pacientes (Ola 8 · frente B): controles programados (FIC-13),
 * controles pendientes (REC-08), bandeja de tareas (CRM-02), casos detenidos
 * (CRM-06) y riesgo de abandono (CRM-07).
 *
 * Todo corre con el cliente del usuario: la RLS deja leer y escribir solo a
 * owner, admin, dentist y reception (`agenda:manage` en la app), y siempre de
 * su clínica. Las escrituras pasan por `requireEscritura` (cuenta en solo
 * lectura) y la demo las frena en la base (`block_demo_writes`).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { calcularOutreachPendiente } from "@/lib/messaging/messaging.functions";
import { leerTodasLasPaginas } from "@/lib/paginacion";
import { fetchPatientBalances } from "@/lib/patients/patients.functions";
import { lineaDeReserva } from "@/lib/reserva/mensajes";
import { requireEscritura } from "@/lib/solo-lectura.middleware";
import {
  armarControlesPendientes,
  DIAS_AVISO_CONTROL,
  sumarDias,
  sumarMeses,
  textoDeControl,
  type ControlPendiente,
  type EstadoControl,
} from "@/lib/seguimiento/controles";
import {
  casosDetenidos,
  DIAS_DETENIDO_POR_DEFECTO,
  pacientesConPlanDetenido,
  type CasoDetenido,
} from "@/lib/seguimiento/detenidos";
import { calcularRiesgo, compararPorRiesgo, type Riesgo } from "@/lib/seguimiento/riesgo";
import { primerNombreDe } from "@/lib/seguimiento/plantillas";
import {
  clinicaDeSeguimiento,
  generadorDeLinkDeReserva,
  leerDatosDePacientes,
  leerPlanesActivos,
  nombresDePacientes,
  pacientesConCitaFutura,
} from "@/lib/seguimiento/seguimiento.server";
import { TIPOS_DE_TAREA, type Tarea, type TipoDeTarea } from "@/lib/seguimiento/tareas";

const DiaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");

// ─── FIC-13 · Programar un control desde la ficha ────────────────────────────

export interface ControlDelPaciente {
  id: string;
  reason: string;
  dueOn: string;
  months: number | null;
  status: EstadoControl;
  createdAt: string;
}

export const listControlesDelPaciente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ControlDelPaciente[]> => {
    const { data: filas, error } = await context.supabase
      .from("patient_controls")
      .select("id, reason, due_on, months, status, created_at")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .order("due_on", { ascending: false })
      .limit(50);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los controles del paciente."));
    return (filas ?? []).map((f) => ({
      id: f.id,
      reason: f.reason,
      dueOn: f.due_on,
      months: f.months,
      status: f.status as EstadoControl,
      createdAt: f.created_at,
    }));
  });

export const programarControl = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        motivo: z.string().trim().min(2, "Escribe el motivo del control.").max(200),
        meses: z.number().int().min(1).max(60).nullable(),
        /** Fecha exacta; si no viene, hoy (de la clínica) + meses. */
        fecha: DiaISO.nullable(),
        /** Además, una tarea para recepción el día que vence. */
        crearTarea: z.boolean().default(false),
        asignarA: z.string().uuid().nullable().default(null),
      })
      .refine((v) => v.meses !== null || v.fecha !== null, {
        message: "Elige en cuántos meses o una fecha.",
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string; dueOn: string }> => {
    const { supabase, userId } = context;
    const clinica = await clinicaDeSeguimiento(supabase, data.clinicId);
    const dueOn = data.fecha ?? sumarMeses(clinica.hoy, data.meses ?? 6);
    if (dueOn < clinica.hoy) throw new Error("La fecha del control no puede estar en el pasado.");
    const { data: fila, error } = await supabase
      .from("patient_controls")
      .insert({
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        reason: data.motivo,
        due_on: dueOn,
        months: data.fecha ? null : data.meses,
        created_by: userId,
      })
      .select("id, due_on")
      .single();
    if (error) throw new Error(mensajeDb(error, "No pudimos programar el control."));

    if (data.crearTarea) {
      const { error: errTarea } = await supabase.from("followup_tasks").insert({
        clinic_id: data.clinicId,
        title: `Agendar control: ${data.motivo}`.slice(0, 160),
        kind: "control",
        patient_id: data.patientId,
        control_id: fila.id,
        assigned_to: data.asignarA,
        due_on: dueOn,
        created_by: userId,
      });
      if (errTarea) {
        throw new Error(
          mensajeDb(errTarea, "El control quedó programado, pero no pudimos crear la tarea."),
        );
      }
    }
    return { id: fila.id, dueOn: fila.due_on };
  });

export const resolverControl = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        controlId: z.string().uuid(),
        estado: z.enum(["pendiente", "agendado", "cumplido", "descartado"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: fila, error } = await context.supabase
      .from("patient_controls")
      .update({ status: data.estado })
      .eq("id", data.controlId)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos actualizar el control."));
    if (!fila) throw new Error("No tienes permisos para cambiar este control.");
    // Resuelto el control, su tarea abierta (si la hay) ya no hace falta.
    if (data.estado !== "pendiente") {
      await context.supabase
        .from("followup_tasks")
        .update({ status: data.estado === "descartado" ? "descartada" : "hecha" })
        .eq("clinic_id", data.clinicId)
        .eq("control_id", data.controlId)
        .eq("status", "pendiente");
    }
    return { ok: true };
  });

// ─── REC-08 · Controles pendientes ───────────────────────────────────────────

export interface ControlPendienteConMensaje extends ControlPendiente {
  /** Texto listo para WhatsApp (con el link de reserva si está encendida). */
  mensaje: string;
}

export const listControlesPendientes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ controles: ControlPendienteConMensaje[]; reservaEncendida: boolean }> => {
      const { supabase } = context;
      const clinica = await clinicaDeSeguimiento(supabase, data.clinicId);
      const limite = sumarDias(clinica.hoy, DIAS_AVISO_CONTROL);

      const [{ filas: manuales, error }, outreach, linkDe] = await Promise.all([
        leerTodasLasPaginas((desde, hasta) =>
          supabase
            .from("patient_controls")
            .select("id, patient_id, reason, due_on, months, created_at")
            .eq("clinic_id", data.clinicId)
            .eq("status", "pendiente")
            .lte("due_on", limite)
            .order("id", { ascending: true })
            .range(desde, hasta),
        ),
        // El recall automático, tal como lo calcula /recordatorios (misma
        // función: no puede divergir). Solo pacientes con WhatsApp aceptado.
        calcularOutreachPendiente(supabase, data.clinicId, Date.now()),
        generadorDeLinkDeReserva(supabase, data.clinicId),
      ]);
      if (error) throw new Error(mensajeDb(error, "No pudimos cargar los controles programados."));

      const pacientes = await nombresDePacientes(
        supabase,
        data.clinicId,
        manuales.map((m) => m.patient_id),
      );
      const automaticos = outreach
        .filter((o) => o.kind === "hygiene_recall")
        .map((o) => ({
          patientId: o.patientId,
          patientName: o.patientName,
          patientPhone: o.patientPhone,
          mesesSinVisita: o.monthsSinceLastVisit ?? null,
        }));
      const ids = [...manuales.map((m) => m.patient_id), ...automaticos.map((a) => a.patientId)];
      const conCita = await pacientesConCitaFutura(supabase, data.clinicId, ids);

      const controles = armarControlesPendientes({
        manuales: manuales
          .filter((m) => pacientes.has(m.patient_id) && !pacientes.get(m.patient_id)!.archivado)
          .map((m) => ({
            id: m.id,
            patientId: m.patient_id,
            patientName: pacientes.get(m.patient_id)!.nombre,
            patientPhone: pacientes.get(m.patient_id)!.telefono,
            reason: m.reason,
            dueOn: m.due_on,
            months: m.months,
            createdAt: m.created_at,
          })),
        automaticos,
        conCitaFutura: conCita,
        hoy: clinica.hoy,
      });

      return {
        reservaEncendida: linkDe !== null,
        controles: controles.map((c) => {
          const texto = textoDeControl({
            primerNombre: primerNombreDe(c.patientName) || null,
            clinica: clinica.nombre,
            motivo: c.motivo,
            origen: c.origen,
          });
          const link = linkDe ? lineaDeReserva(linkDe(c.patientId)) : null;
          return { ...c, mensaje: link ? `${texto}\n\n${link}` : texto };
        }),
      };
    },
  );

// ─── CRM-02 · Bandeja de tareas ──────────────────────────────────────────────

export const listTareas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        /** Además de las pendientes, las cerradas de los últimos N días. */
        cerradasDias: z.number().int().min(0).max(90).default(7),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<Tarea[]> => {
    const { supabase } = context;
    const desde = new Date(Date.now() - data.cerradasDias * 86_400_000).toISOString();
    const columnas =
      "id, title, notes, kind, patient_id, quote_id, control_id, assigned_to, due_on, status, postponed_count, completed_at, created_at";
    const [pendientes, cerradas] = await Promise.all([
      leerTodasLasPaginas((d, h) =>
        supabase
          .from("followup_tasks")
          .select(columnas)
          .eq("clinic_id", data.clinicId)
          .eq("status", "pendiente")
          .order("id", { ascending: true })
          .range(d, h),
      ),
      supabase
        .from("followup_tasks")
        .select(columnas)
        .eq("clinic_id", data.clinicId)
        .neq("status", "pendiente")
        .gte("completed_at", desde)
        .order("completed_at", { ascending: false })
        .limit(200),
    ]);
    if (pendientes.error) {
      throw new Error(mensajeDb(pendientes.error, "No pudimos cargar las tareas."));
    }
    if (cerradas.error) throw new Error(mensajeDb(cerradas.error, "No pudimos cargar las tareas."));
    const filas = [...pendientes.filas, ...(cerradas.data ?? [])];

    const pacientes = await nombresDePacientes(
      supabase,
      data.clinicId,
      filas.map((f) => f.patient_id).filter((x): x is string => Boolean(x)),
    );
    const usuarios = [...new Set(filas.map((f) => f.assigned_to).filter(Boolean))] as string[];
    const { data: perfiles } = usuarios.length
      ? await supabase.from("profiles").select("id, full_name, email").in("id", usuarios)
      : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
    const nombreDe = new Map((perfiles ?? []).map((p) => [p.id, p.full_name || p.email || null]));

    return filas.map((f) => ({
      id: f.id,
      title: f.title,
      notes: f.notes,
      kind: f.kind as TipoDeTarea,
      patientId: f.patient_id,
      patientName: f.patient_id ? (pacientes.get(f.patient_id)?.nombre ?? null) : null,
      patientPhone: f.patient_id ? (pacientes.get(f.patient_id)?.telefono ?? null) : null,
      quoteId: f.quote_id,
      controlId: f.control_id,
      assignedTo: f.assigned_to,
      assignedName: f.assigned_to ? (nombreDe.get(f.assigned_to) ?? null) : null,
      dueOn: f.due_on,
      status: f.status as Tarea["status"],
      postponedCount: f.postponed_count,
      completedAt: f.completed_at,
      createdAt: f.created_at,
    }));
  });

export const crearTarea = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        titulo: z.string().trim().min(2, "Escribe qué hay que hacer.").max(160),
        notas: z.string().trim().max(1000).nullable().default(null),
        tipo: z.enum(TIPOS_DE_TAREA),
        patientId: z.string().uuid().nullable().default(null),
        quoteId: z.string().uuid().nullable().default(null),
        controlId: z.string().uuid().nullable().default(null),
        asignarA: z.string().uuid().nullable().default(null),
        fecha: DiaISO,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string; yaExistia: boolean }> => {
    const { supabase, userId } = context;
    const { data: fila, error } = await supabase
      .from("followup_tasks")
      .insert({
        clinic_id: data.clinicId,
        title: data.titulo,
        notes: data.notas || null,
        kind: data.tipo,
        patient_id: data.patientId,
        quote_id: data.quoteId,
        control_id: data.controlId,
        assigned_to: data.asignarA,
        due_on: data.fecha,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) {
      // Ya hay una tarea abierta para ese presupuesto o control (índice único).
      if (error.code === "23505") {
        const col = data.quoteId ? "quote_id" : "control_id";
        const valor = data.quoteId ?? data.controlId;
        const { data: existente } = await supabase
          .from("followup_tasks")
          .select("id")
          .eq("clinic_id", data.clinicId)
          .eq(col, valor as string)
          .eq("status", "pendiente")
          .maybeSingle();
        if (existente) return { id: existente.id, yaExistia: true };
      }
      throw new Error(mensajeDb(error, "No pudimos crear la tarea."));
    }
    return { id: fila.id, yaExistia: false };
  });

export const actualizarTarea = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        tareaId: z.string().uuid(),
        cambio: z.discriminatedUnion("accion", [
          z.object({ accion: z.literal("completar") }),
          z.object({ accion: z.literal("descartar") }),
          z.object({ accion: z.literal("reabrir") }),
          z.object({ accion: z.literal("posponer"), fecha: DiaISO }),
          z.object({ accion: z.literal("asignar"), userId: z.string().uuid().nullable() }),
        ]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const c = data.cambio;
    const update =
      c.accion === "completar"
        ? { status: "hecha" }
        : c.accion === "descartar"
          ? { status: "descartada" }
          : c.accion === "reabrir"
            ? { status: "pendiente" }
            : c.accion === "posponer"
              ? { due_on: c.fecha }
              : { assigned_to: c.userId };
    let consulta = context.supabase
      .from("followup_tasks")
      .update(update)
      .eq("id", data.tareaId)
      .eq("clinic_id", data.clinicId);
    if (c.accion === "posponer") consulta = consulta.eq("status", "pendiente");
    const { data: fila, error } = await consulta.select("id").maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos actualizar la tarea."));
    if (!fila)
      throw new Error("La tarea ya no está pendiente o no tienes permisos para cambiarla.");
    return { ok: true };
  });

// ─── CRM-06 · Casos detenidos ────────────────────────────────────────────────

export const listCasosDetenidos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        dias: z.number().int().min(7).max(365).default(DIAS_DETENIDO_POR_DEFECTO),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CasoDetenido[]> => {
    const planes = await leerPlanesActivos(context.supabase, data.clinicId);
    return casosDetenidos(planes, data.dias, Date.now());
  });

// ─── CRM-07 · Riesgo de abandono ─────────────────────────────────────────────

export interface PacienteEnRiesgo {
  patientId: string;
  nombre: string;
  telefono: string | null;
  ultimaVisita: string | null;
  tieneCitaFutura: boolean;
  riesgo: Riesgo;
}

export const listRiesgoDeAbandono = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ pacientes: PacienteEnRiesgo[]; sinDatos: number; saldoConocido: boolean }> => {
      const { supabase } = context;
      const ahora = Date.now();
      const [datos, planes, saldos] = await Promise.all([
        leerDatosDePacientes(supabase, data.clinicId),
        leerPlanesActivos(supabase, data.clinicId),
        // El saldo es un factor más: si no se puede leer, no suma (regla 11).
        fetchPatientBalances(supabase, data.clinicId).catch(() => null),
      ]);
      const detenidos = pacientesConPlanDetenido(
        casosDetenidos(planes, DIAS_DETENIDO_POR_DEFECTO, ahora),
      );
      const evaluados = datos.map((d) => {
        const saldo = saldos
          ? (() => {
              const s = saldos.get(d.patientId);
              return s ? s.billedCents - s.paidCents : 0;
            })()
          : null;
        return {
          patientId: d.patientId,
          nombre: d.nombre,
          telefono: d.telefono,
          ultimaVisita: d.ultimaVisita,
          tieneCitaFutura: d.tieneCitaFutura,
          riesgo: calcularRiesgo(
            {
              ultimaVisita: d.ultimaVisita,
              visitas: d.visitas,
              tieneCitaFutura: d.tieneCitaFutura,
              inasistencias12m: d.inasistencias12m,
              cancelaciones12m: d.cancelaciones12m,
              presupuestosRechazados12m: d.presupuestosRechazados12m,
              saldoCents: saldo,
              planDetenido: detenidos.has(d.patientId),
            },
            ahora,
          ),
        };
      });
      const conDatos = evaluados.filter((e) => e.riesgo.puntaje !== null);
      conDatos.sort(compararPorRiesgo);
      return {
        // Los de riesgo bajo sin factores no aportan a la lista de acción.
        pacientes: conDatos.filter((e) => (e.riesgo.puntaje ?? 0) > 0).slice(0, 300),
        sinDatos: evaluados.length - conDatos.length,
        saldoConocido: saldos !== null,
      };
    },
  );
