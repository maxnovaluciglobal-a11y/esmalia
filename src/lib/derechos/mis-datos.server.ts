/**
 * Lectura de los datos del paciente para su descarga desde el portal
 * (SEG-09). Corre con el cliente de servicio (el portal no tiene sesión de
 * Supabase) y por eso CADA consulta filtra por la clínica y por las fichas
 * del paciente del token, nunca por un id que mande el navegador.
 * `armarMisDatos` vuelve a filtrar por paciente antes de armar el archivo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { estadoParaInscrito } from "@/lib/clinic-operations/citas-grupales";
import {
  citasPorIds,
  inscripcionesVigentesDe,
} from "@/lib/clinic-operations/inscripciones-grupales";
import type { FilasDelTitular } from "@/lib/derechos/mis-datos";
import { idsDeLaFicha } from "@/lib/patients/fusion";

type Cliente = SupabaseClient<Database>;

const TOPE = 2000;

function fallo(que: string): never {
  throw new Error(`No pudimos leer ${que}. Intenta de nuevo en unos minutos.`);
}

export async function leerFilasDelTitular(
  admin: Cliente,
  clinicId: string,
  patientId: string,
): Promise<{
  filas: FilasDelTitular;
  ids: string[];
  clinica: { nombre: string; zona: string };
}> {
  const ids = await idsDeLaFicha(admin, clinicId, patientId);

  const [
    paciente,
    clinica,
    anamnesis,
    notas,
    citas,
    presupuestos,
    planes,
    pagos,
    documentos,
    consentimientos,
    solicitudes,
  ] = await Promise.all([
    admin
      .from("patients")
      .select(
        "id, full_name, birth_date, email, phone, address, commune, sex, health_plan, health_plan_institution, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, document_id_enc, document_id, wa_opt_out_at, email_opt_out_at, created_at",
      )
      .eq("clinic_id", clinicId)
      .eq("id", patientId)
      .maybeSingle(),
    admin.from("clinics").select("name, timezone").eq("id", clinicId).maybeSingle(),
    admin
      .from("patient_medical_history")
      .select("patient_id, allergies, conditions, chronic_medications")
      .eq("clinic_id", clinicId)
      .in("patient_id", ids),
    admin
      .from("clinical_notes")
      .select("patient_ref, title, signed_at, created_at, signer_name, status")
      .eq("clinic_id", clinicId)
      .in("patient_ref", ids)
      .eq("status", "signed")
      .order("created_at", { ascending: false })
      .limit(TOPE),
    admin
      .from("appointments")
      .select("id, patient_id, starts_at, treatment_label, status")
      .eq("clinic_id", clinicId)
      .in("patient_id", ids)
      .order("starts_at", { ascending: false })
      .limit(TOPE),
    admin
      .from("quotes")
      .select("patient_id, number, created_at, status, total_cents, currency")
      .eq("clinic_id", clinicId)
      .in("patient_id", ids)
      .limit(TOPE),
    admin
      .from("treatment_plans")
      .select("patient_id, name, created_at, status, total_cents, currency")
      .eq("clinic_id", clinicId)
      .in("patient_id", ids)
      .limit(TOPE),
    admin
      .from("payments")
      .select(
        "patient_id, paid_at, amount_cents, currency, method, method_name_snapshot, reversed_at",
      )
      .eq("clinic_id", clinicId)
      .in("patient_id", ids)
      .limit(TOPE),
    admin
      .from("issued_documents")
      .select("patient_id, title, year, number, issued_at, professional_name_snapshot, voided_at")
      .eq("clinic_id", clinicId)
      .in("patient_id", ids)
      .limit(TOPE),
    admin
      .from("patient_consents")
      .select("patient_id, title_snapshot, signed_at, signed_by_name, revoked_at")
      .eq("clinic_id", clinicId)
      .in("patient_id", ids)
      .limit(TOPE),
    admin
      .from("data_subject_requests")
      .select("patient_id, kind, status, received_at, responded_at")
      .eq("clinic_id", clinicId)
      .in("patient_id", ids)
      .limit(TOPE),
  ]);

  if (paciente.error || !paciente.data) fallo("tus datos");
  if (clinica.error || !clinica.data) fallo("los datos de la clínica");
  if (anamnesis.error) fallo("tu resumen de salud");
  if (notas.error) fallo("tus atenciones");
  if (citas.error) fallo("tus citas");
  if (presupuestos.error) fallo("tus presupuestos");
  if (planes.error) fallo("tus planes de tratamiento");
  if (pagos.error) fallo("tus pagos");
  if (documentos.error) fallo("tus documentos");
  if (consentimientos.error) fallo("tus consentimientos");
  if (solicitudes.error) fallo("tus solicitudes");

  // Citas grupales (AGE-22): la cita de una grupal cuelga del titular; cada
  // inscrito la ve por su inscripción, con su propia asistencia.
  const inscripciones = await inscripcionesVigentesDe(admin, clinicId, ids);
  const idsGrupales = inscripciones.map((i) => i.appointment_id);
  const [citasGrupales, titulos] = await Promise.all([
    citasPorIds(
      idsGrupales,
      (tanda) =>
        admin
          .from("appointments")
          .select("id, starts_at, status")
          .eq("clinic_id", clinicId)
          .in("id", tanda),
      "No pudimos leer tus citas. Intenta de nuevo en unos minutos.",
    ),
    citasPorIds(
      idsGrupales,
      (tanda) =>
        admin
          .from("appointment_groups")
          .select("appointment_id, title")
          .eq("clinic_id", clinicId)
          .in("appointment_id", tanda),
      "No pudimos leer tus citas. Intenta de nuevo en unos minutos.",
    ),
  ]);
  const citaGrupal = new Map(citasGrupales.map((c) => [c.id, c]));
  const tituloDe = new Map(titulos.map((t) => [t.appointment_id, t.title]));
  const citasDelTitular = (citas.data ?? [])
    .filter((c) => !citaGrupal.has(c.id))
    .map((c) => ({
      patient_id: c.patient_id,
      starts_at: c.starts_at,
      treatment_label: c.treatment_label,
      status: c.status,
    }));
  const citasComoInscrito = inscripciones.flatMap((i) => {
    const cita = citaGrupal.get(i.appointment_id);
    if (!cita) return [];
    return [
      {
        patient_id: i.patient_id,
        starts_at: cita.starts_at,
        treatment_label: tituloDe.get(i.appointment_id) ?? "Cita grupal",
        status: estadoParaInscrito(cita.status, i.attendance),
      },
    ];
  });
  const todasLasCitas = [...citasDelTitular, ...citasComoInscrito].sort((a, b) =>
    b.starts_at.localeCompare(a.starts_at),
  );

  const p = paciente.data;
  return {
    ids,
    clinica: {
      nombre: clinica.data.name,
      zona: clinica.data.timezone || "America/Santiago",
    },
    filas: {
      paciente: {
        id: p.id,
        full_name: p.full_name,
        birth_date: p.birth_date,
        email: p.email,
        phone: p.phone,
        address: p.address,
        commune: p.commune,
        sex: p.sex,
        health_plan: p.health_plan,
        health_plan_institution: p.health_plan_institution,
        emergency_contact_name: p.emergency_contact_name,
        emergency_contact_phone: p.emergency_contact_phone,
        emergency_contact_relationship: p.emergency_contact_relationship,
        // Solo si está registrado: el valor no sale del servidor.
        tiene_documento: Boolean(p.document_id_enc || p.document_id),
        wa_opt_out_at: p.wa_opt_out_at,
        email_opt_out_at: p.email_opt_out_at,
        created_at: p.created_at,
      },
      anamnesis: anamnesis.data ?? [],
      notas: notas.data ?? [],
      citas: todasLasCitas,
      presupuestos: presupuestos.data ?? [],
      planes: planes.data ?? [],
      pagos: pagos.data ?? [],
      documentos: documentos.data ?? [],
      consentimientos: consentimientos.data ?? [],
      solicitudes: solicitudes.data ?? [],
    },
  };
}
