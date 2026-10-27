/**
 * MKT-07 · Formulario antes de la cita: server functions.
 *
 * Página pública `/formulario/$token` (sin login; exentas del modo solo
 * lectura en `ESCRITURA_EXENTA`, validan el token en el servidor y llaman a
 * la base con el rol de servicio):
 *   abrirFormularioPrevio     estado, clínica, cita y datos de contacto
 *   enviarFormularioPrevio    guarda lo enviado, una vez (no toca la ficha)
 *
 * Staff (con sesión, RLS del usuario: solo roles clínicos leen formularios):
 *   listFormulariosPrevios    formularios respondidos de un paciente, con lo
 *                             que cambiaría en la ficha
 *   revisarFormularioPrevio   pasa a la ficha lo que el staff elige (contacto
 *                             y/o anamnesis) y lo marca aceptado, o lo
 *                             descarta
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { assertNotDemoClinic, requireClinicRole } from "@/lib/access/clinic-guards.server";
import { leerCuestionario, PREGUNTAS_RIESGO } from "@/lib/clinical/anamnesis";
import { mensajeDb } from "@/lib/db-errors";
import { huellaDeSecreto } from "@/lib/firma-distancia/token";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

import {
  cambiosDeContacto,
  EnvioFormularioSchema,
  fusionarAnamnesis,
  TokenSchema,
  type CambioDeContacto,
  type Contacto,
} from "./formulario";
import { exigirLimitePublico, objeto, texto } from "./publico.server";

// ─── Página pública ───────────────────────────────────────────────────────

export type EstadoFormulario =
  "abierto" | "respondido" | "vencido" | "cita_cancelada" | "invalido" | "enviado";

export interface FormularioAbierto {
  estado: EstadoFormulario;
  clinica: string | null;
  zona: string;
  nombre: string | null;
  cita: string | null;
  contacto: Contacto;
}

export const abrirFormularioPrevio = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: TokenSchema }).parse(input))
  .handler(async ({ data }): Promise<FormularioAbierto> => {
    exigirLimitePublico();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await supabaseAdmin.rpc("formulario_previo_abrir", {
      p_token_hash: await huellaDeSecreto(data.token),
    });
    if (error) throw new Error("No pudimos abrir el formulario. Vuelve a intentarlo.");
    const j = objeto(r);
    const c = objeto(j.contacto);
    return {
      estado: (texto(j.estado) ?? "invalido") as EstadoFormulario,
      clinica: texto(j.clinica),
      zona: texto(j.zona) ?? "America/Santiago",
      nombre: texto(j.nombre),
      cita: texto(j.cita),
      contacto: {
        email: texto(c.email),
        phone: texto(c.phone),
        address: texto(c.address),
        commune: texto(c.commune),
        emergency_contact_name: texto(c.emergency_contact_name),
        emergency_contact_phone: texto(c.emergency_contact_phone),
        emergency_contact_relationship: texto(c.emergency_contact_relationship),
      },
    };
  });

export const enviarFormularioPrevio = createServerFn({ method: "POST" })
  .validator((input: unknown) => EnvioFormularioSchema.parse(input))
  .handler(async ({ data }): Promise<{ estado: EstadoFormulario }> => {
    exigirLimitePublico();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await supabaseAdmin.rpc("formulario_previo_enviar", {
      p_token_hash: await huellaDeSecreto(data.token),
      p_contacto: data.contacto as Json,
      p_cuestionario: data.cuestionario as Json,
      p_alergias: data.alergias,
      p_medicacion: data.medicacion,
      p_comentario: data.comentario ?? "",
    });
    if (error) throw new Error("No pudimos guardar el formulario. Vuelve a intentarlo.");
    return { estado: (texto(objeto(r).estado) ?? "invalido") as EstadoFormulario };
  });

// ─── Staff ────────────────────────────────────────────────────────────────

const ROLES_CLINICOS = ["owner", "admin", "dentist", "assistant"] as const;

export interface RespuestaDelCuestionario {
  pregunta: string;
  respuesta: "Sí" | "No";
  detalle: string | null;
}

export interface FormularioPendiente {
  id: string;
  appointmentId: string | null;
  enviadoEl: string;
  respondidoEl: string;
  cambiosDeContacto: CambioDeContacto[];
  cuestionario: RespuestaDelCuestionario[];
  alergias: string[];
  medicacion: string[];
  comentario: string | null;
}

export const listFormulariosPrevios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<FormularioPendiente[]> => {
    const { supabase } = context;
    const { data: filas, error } = await supabase
      .from("patient_intake_forms")
      .select(
        "id, appointment_id, sent_at, submitted_at, submitted_contact, submitted_questionnaire, submitted_allergies, submitted_medications, submitted_comment",
      )
      .eq("clinic_id", data.clinicId)
      .eq("patient_id", data.patientId)
      .eq("status", "respondido")
      .order("submitted_at", { ascending: false })
      .limit(5);
    // Sin permiso (recepción, contabilidad) la RLS devuelve vacío: no hay nada que revisar.
    if (error || !filas?.length) return [];

    const { data: paciente } = await supabase
      .from("patients")
      .select(
        "email, phone, address, commune, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship",
      )
      .eq("clinic_id", data.clinicId)
      .eq("id", data.patientId)
      .maybeSingle();

    return filas.map((f) => {
      const c = leerCuestionario(f.submitted_questionnaire);
      return {
        id: f.id,
        appointmentId: f.appointment_id,
        enviadoEl: f.sent_at,
        respondidoEl: f.submitted_at ?? f.sent_at,
        cambiosDeContacto: cambiosDeContacto(paciente ?? {}, f.submitted_contact),
        cuestionario: PREGUNTAS_RIESGO.flatMap((p) => {
          const r = c[p.key];
          return r
            ? [
                {
                  pregunta: p.label,
                  respuesta: r.answer === "yes" ? ("Sí" as const) : ("No" as const),
                  detalle: r.detail ?? null,
                },
              ]
            : [];
        }),
        alergias: f.submitted_allergies ?? [],
        medicacion: f.submitted_medications ?? [],
        comentario: f.submitted_comment,
      };
    });
  });

export const revisarFormularioPrevio = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        formId: z.string().uuid(),
        resultado: z.enum(["aceptar", "descartar"]),
        aplicarContacto: z.boolean(),
        aplicarAnamnesis: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const SIN_PERMISO = "No tienes permisos para revisar este formulario.";
    await requireClinicRole(supabase, data.clinicId, userId, ROLES_CLINICOS, SIN_PERMISO);
    await assertNotDemoClinic(supabase, data.clinicId);

    const { data: form, error } = await supabase
      .from("patient_intake_forms")
      .select(
        "id, patient_id, status, submitted_contact, submitted_questionnaire, submitted_allergies, submitted_medications",
      )
      .eq("clinic_id", data.clinicId)
      .eq("id", data.formId)
      .maybeSingle();
    if (error || !form) throw new Error(mensajeDb(error, SIN_PERMISO));
    if (form.status !== "respondido") throw new Error("Este formulario ya fue revisado.");

    if (data.resultado === "aceptar") {
      if (data.aplicarContacto) {
        const { data: paciente } = await supabase
          .from("patients")
          .select(
            "email, phone, address, commune, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship",
          )
          .eq("clinic_id", data.clinicId)
          .eq("id", form.patient_id)
          .maybeSingle();
        const cambios = cambiosDeContacto(paciente ?? {}, form.submitted_contact);
        if (cambios.length > 0) {
          const update = Object.fromEntries(cambios.map((c) => [c.campo, c.despues]));
          const { error: errPaciente } = await supabase
            .from("patients")
            .update({ ...update, updated_by: userId })
            .eq("clinic_id", data.clinicId)
            .eq("id", form.patient_id);
          if (errPaciente) {
            throw new Error(mensajeDb(errPaciente, "No pudimos actualizar los datos de contacto."));
          }
        }
      }
      if (data.aplicarAnamnesis) {
        const { data: actual, error: errActual } = await supabase
          .from("patient_medical_history")
          .select("allergies, allergy_details, chronic_medications, risk_questionnaire")
          .eq("clinic_id", data.clinicId)
          .eq("patient_id", form.patient_id)
          .maybeSingle();
        if (errActual) throw new Error(mensajeDb(errActual, SIN_PERMISO));
        const fusion = fusionarAnamnesis(actual, {
          cuestionario: form.submitted_questionnaire,
          alergias: form.submitted_allergies,
          medicacion: form.submitted_medications,
        });
        const { error: errHistoria } = await supabase.from("patient_medical_history").upsert(
          {
            clinic_id: data.clinicId,
            patient_id: form.patient_id,
            allergies: fusion.allergies,
            allergy_details: fusion.allergy_details as unknown as Json,
            chronic_medications: fusion.chronic_medications,
            risk_questionnaire: fusion.risk_questionnaire as unknown as Json,
            updated_by: userId,
          },
          { onConflict: "patient_id" },
        );
        if (errHistoria) {
          throw new Error(
            mensajeDb(errHistoria, "No pudimos actualizar los antecedentes médicos."),
          );
        }
      }
    }

    const { error: errRevision } = await supabase.rpc("formulario_previo_revisar", {
      p_form_id: form.id,
      p_resultado: data.resultado === "aceptar" ? "aceptado" : "descartado",
    });
    if (errRevision) throw new Error(mensajeDb(errRevision, SIN_PERMISO));
    return { ok: true };
  });
