/**
 * FIC-14 · Interconsultas: server functions (RLS del usuario: solo roles
 * clínicos leen y escriben `patient_referrals`; las reglas del flujo las
 * valida el trigger `validar_interconsulta`).
 *
 *   listInterconsultas          las del paciente (y de las fichas fusionadas en él)
 *   crearInterconsulta          pedida, a nombre de quien la pide
 *   cambiarEstadoInterconsulta  enviada / respondida (con la respuesta) / cerrada / cancelada
 *   emitirDerivacion            documento con la plantilla "derivacion" del
 *                               motor de la Ola 4, enlazado a la interconsulta
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  alertasDeAnamnesis,
  conciliarAlergias,
  leerCuestionario,
  leerDetallesDeAlergias,
} from "@/lib/clinical/anamnesis";
import {
  cambioDeEstadoSchema,
  camposDeDerivacion,
  esEstadoInterconsulta,
  nuevaInterconsultaSchema,
  type Interconsulta,
  type UrgenciaInterconsulta,
} from "@/lib/clinical/interconsultas";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";
import { mensajeDb } from "@/lib/db-errors";
import { emitirDocumento } from "@/lib/documentos/emitir.server";
import { cargarFusiones, fichasAbsorbidas } from "@/lib/patients/fusion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

const SIN_PERMISO = "No tienes permisos para gestionar interconsultas.";

const COLUMNAS =
  "id, patient_id, specialty, destination, destination_contact, reason, request, urgency, status, requested_by, requested_at, sent_at, response, responded_at, closed_at, cancelled_at, cancel_reason, issued_document_id";

type Fila = {
  id: string;
  patient_id: string;
  specialty: string;
  destination: string | null;
  destination_contact: string | null;
  reason: string;
  request: string | null;
  urgency: string;
  status: string;
  requested_by: string | null;
  requested_at: string;
  sent_at: string | null;
  response: string | null;
  responded_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  issued_document_id: string | null;
};

export const listInterconsultas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<Interconsulta[]> => {
    const { supabase } = context;
    const lectura = registrarLecturaDeFicha(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "notas",
    });
    const fusiones = await cargarFusiones(supabase, data.clinicId);
    const ids = [data.patientId, ...fichasAbsorbidas(data.patientId, fusiones)];
    const { data: filas, error } = await supabase
      .from("patient_referrals")
      .select(COLUMNAS)
      .eq("clinic_id", data.clinicId)
      .in("patient_id", ids)
      .order("requested_at", { ascending: false })
      .limit(100);
    await lectura;
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las interconsultas."));
    const rows = (filas ?? []) as Fila[];

    const autores = [...new Set(rows.map((r) => r.requested_by).filter(Boolean))] as string[];
    const nombres = new Map<string, string | null>();
    if (autores.length) {
      const { data: perfiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", autores);
      for (const p of perfiles ?? []) nombres.set(p.id, p.full_name ?? p.email);
    }

    return rows.map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      specialty: r.specialty,
      destination: r.destination,
      destinationContact: r.destination_contact,
      reason: r.reason,
      request: r.request,
      urgency: (["normal", "preferente", "urgente"].includes(r.urgency)
        ? r.urgency
        : "normal") as UrgenciaInterconsulta,
      status: esEstadoInterconsulta(r.status) ? r.status : "pedida",
      requestedBy: r.requested_by,
      requestedByName: r.requested_by ? (nombres.get(r.requested_by) ?? null) : null,
      requestedAt: r.requested_at,
      sentAt: r.sent_at,
      response: r.response,
      respondedAt: r.responded_at,
      closedAt: r.closed_at,
      cancelledAt: r.cancelled_at,
      cancelReason: r.cancel_reason,
      issuedDocumentId: r.issued_document_id,
    }));
  });

export const crearInterconsulta = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), patientId: z.string().uuid() })
      .and(nuevaInterconsultaSchema)
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: fila, error } = await context.supabase
      .from("patient_referrals")
      .insert({
        clinic_id: data.clinicId,
        patient_id: data.patientId,
        specialty: data.specialty,
        destination: data.destination ?? null,
        destination_contact: data.destinationContact ?? null,
        reason: data.reason,
        request: data.request ?? null,
        urgency: data.urgency,
        requested_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !fila) throw new Error(mensajeDb(error, SIN_PERMISO));
    return { id: fila.id };
  });

export const cambiarEstadoInterconsulta = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), referralId: z.string().uuid() })
      .and(cambioDeEstadoSchema)
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const cambios =
      data.estado === "respondida"
        ? { status: data.estado, response: data.response }
        : data.estado === "cancelada"
          ? { status: data.estado, cancel_reason: data.cancelReason }
          : { status: data.estado };
    const { data: filas, error } = await context.supabase
      .from("patient_referrals")
      .update(cambios)
      .eq("id", data.referralId)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    if (!filas?.length) throw new Error(SIN_PERMISO);
    return { ok: true };
  });

/**
 * Emite el documento de derivación con la plantilla activa "derivacion" de
 * la clínica (Ola 4) y lo enlaza a la interconsulta. Los campos salen de la
 * interconsulta; los antecedentes, de las alertas de la anamnesis. El motor
 * hace sus propias validaciones (profesional vinculado, registro SIS, firma).
 */
export const emitirDerivacion = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), referralId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ documentId: string }> => {
    const { supabase, userId } = context;
    const { data: fila, error } = await supabase
      .from("patient_referrals")
      .select(
        "id, patient_id, specialty, destination, reason, request, urgency, status, issued_document_id",
      )
      .eq("id", data.referralId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, SIN_PERMISO));
    if (!fila) throw new Error(SIN_PERMISO);
    if (fila.status === "cancelada")
      throw new Error("La interconsulta está cancelada: no se emite su derivación.");
    if (fila.issued_document_id)
      throw new Error("Esta interconsulta ya tiene su documento de derivación.");

    const { data: plantillas, error: errorPlantilla } = await supabase
      .from("document_templates")
      .select("id")
      .eq("clinic_id", data.clinicId)
      .eq("kind", "derivacion")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1);
    if (errorPlantilla) throw new Error(mensajeDb(errorPlantilla, SIN_PERMISO));
    const plantilla = plantillas?.[0];
    if (!plantilla)
      throw new Error(
        "La clínica no tiene una plantilla de derivación activa. Actívala en Ajustes → Plantillas de documentos.",
      );

    const { data: historia } = await supabase
      .from("patient_medical_history")
      .select("allergies, allergy_details, risk_questionnaire")
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", fila.patient_id)
      .maybeSingle();
    const alertas = historia
      ? alertasDeAnamnesis({
          alergias: conciliarAlergias(
            historia.allergies ?? [],
            leerDetallesDeAlergias(historia.allergy_details),
          ),
          cuestionario: leerCuestionario(historia.risk_questionnaire),
        }).map((a) => a.texto)
      : [];

    const documento = await emitirDocumento(supabase, {
      clinicId: data.clinicId,
      patientId: fila.patient_id,
      userId,
      templateId: plantilla.id,
      campos: camposDeDerivacion(
        {
          specialty: fila.specialty,
          destination: fila.destination,
          reason: fila.reason,
          request: fila.request,
          urgency: (["normal", "preferente", "urgente"].includes(fila.urgency)
            ? fila.urgency
            : "normal") as UrgenciaInterconsulta,
        },
        alertas,
      ),
    });

    const { error: errorEnlace } = await supabase
      .from("patient_referrals")
      .update({ issued_document_id: documento.id })
      .eq("id", fila.id)
      .eq("clinic_id", data.clinicId);
    if (errorEnlace)
      throw new Error(
        mensajeDb(
          errorEnlace,
          "Emitimos el documento, pero no pudimos enlazarlo a la interconsulta. Lo encuentras en Documentos.",
        ),
      );
    return { documentId: documento.id };
  });
