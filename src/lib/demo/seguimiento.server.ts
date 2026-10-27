import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { DEMO_CLINIC_ID } from "@/lib/demo/ola9.server";
import { describirSegmento, FILTRO_VACIO, type SegmentoCampana } from "@/lib/seguimiento/campanas";
import { PLANTILLAS_SUGERIDAS } from "@/lib/seguimiento/plantillas";

/**
 * Paso de `/api/demo-reset` con los datos de ejemplo de Seguimiento (Ola 8 ·
 * frente B): dos controles programados (uno vencido y otro por vencer),
 * tareas del equipo (vencida, de hoy y próxima, una de seguimiento de
 * presupuesto), dos plantillas de mensajes y una campaña en borrador.
 *
 * La campaña queda en borrador a propósito: confirmar una campaña exige a una
 * persona (la base lo frena con el rol de servicio) y la demo es de solo
 * lectura. Idempotente: si ya hay plantillas en la demo, no siembra nada. No
 * lanza: un error se registra y el reset sigue.
 */

type Admin = SupabaseClient<Database>;

/** Usuario dueño de la clínica demo (`reset_demo_clinic`). */
const DEMO_USER_ID = "139dd209-8495-415c-b6cd-6bbc63367bad";

function dia(zona: string, offset: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offset * 86_400_000));
}

export const SEGMENTO_DEMO: SegmentoCampana = {
  tipo: "filtro",
  filtro: { ...FILTRO_VACIO, sinVisitaDesdeMeses: 6, sinCitaFutura: true },
};

export async function sembrarSeguimientoDeLaDemo(admin: Admin): Promise<void> {
  try {
    const { data: clinica } = await admin
      .from("clinics")
      .select("id, timezone")
      .eq("id", DEMO_CLINIC_ID)
      .eq("is_demo", true)
      .maybeSingle();
    if (!clinica) return;
    const clinicId = clinica.id;
    const zona = clinica.timezone || "America/Santiago";

    const { count } = await admin
      .from("outreach_templates")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", clinicId);
    if ((count ?? 0) > 0) return;

    const [{ data: pacientes }, { data: presupuesto }] = await Promise.all([
      admin
        .from("patients")
        .select("id, full_name")
        .eq("clinic_id", clinicId)
        .is("archived_at", null)
        .order("full_name")
        .limit(6),
      admin
        .from("quotes")
        .select("id, patient_id, number")
        .eq("clinic_id", clinicId)
        .eq("status", "sent")
        .limit(1)
        .maybeSingle(),
    ]);
    const lista = pacientes ?? [];
    if (lista.length < 3) return;

    const { data: controles, error: errControles } = await admin
      .from("patient_controls")
      .insert([
        {
          clinic_id: clinicId,
          patient_id: lista[0].id,
          reason: "Control de la endodoncia de la pieza 36",
          due_on: dia(zona, -10),
          months: 3,
          created_by: DEMO_USER_ID,
        },
        {
          clinic_id: clinicId,
          patient_id: lista[1].id,
          reason: "Revisión del blanqueamiento",
          due_on: dia(zona, 15),
          months: 1,
          created_by: DEMO_USER_ID,
        },
      ])
      .select("id, patient_id");
    if (errControles) throw new Error(errControles.message);

    const tareas: Database["public"]["Tables"]["followup_tasks"]["Insert"][] = [
      {
        clinic_id: clinicId,
        title: `Llamar a ${lista[2].full_name} para retomar el tratamiento`,
        kind: "llamada",
        patient_id: lista[2].id,
        assigned_to: DEMO_USER_ID,
        due_on: dia(zona, -2),
        created_by: DEMO_USER_ID,
      },
      {
        clinic_id: clinicId,
        title: "Agendar control: endodoncia de la pieza 36",
        kind: "control",
        patient_id: lista[0].id,
        control_id: controles?.[0]?.id ?? null,
        assigned_to: DEMO_USER_ID,
        due_on: dia(zona, 0),
        created_by: DEMO_USER_ID,
      },
      {
        clinic_id: clinicId,
        title: "Confirmar con el laboratorio la entrega de la corona",
        kind: "otra",
        assigned_to: null,
        due_on: dia(zona, 3),
        created_by: DEMO_USER_ID,
      },
    ];
    if (presupuesto) {
      tareas.push({
        clinic_id: clinicId,
        title: `Seguimiento del presupuesto ${presupuesto.number}`,
        kind: "presupuesto",
        patient_id: presupuesto.patient_id,
        quote_id: presupuesto.id,
        assigned_to: DEMO_USER_ID,
        due_on: dia(zona, 0),
        created_by: DEMO_USER_ID,
      });
    }
    const { error: errTareas } = await admin.from("followup_tasks").insert(tareas);
    if (errTareas) throw new Error(errTareas.message);

    const { data: plantillas, error: errPlantillas } = await admin
      .from("outreach_templates")
      .insert(
        PLANTILLAS_SUGERIDAS.slice(0, 2).map((p) => ({
          clinic_id: clinicId,
          name: p.nombre,
          channel: p.canal,
          subject: p.asunto,
          body: p.cuerpo,
          created_by: DEMO_USER_ID,
        })),
      )
      .select("id, channel, subject, body");
    if (errPlantillas) throw new Error(errPlantillas.message);

    const correo = (plantillas ?? []).find((p) => p.channel === "correo");
    if (correo) {
      const { error: errCampana } = await admin.from("outreach_campaigns").insert({
        clinic_id: clinicId,
        name: "Control anual de pacientes sin visita",
        channel: "correo",
        template_id: correo.id,
        subject: correo.subject,
        body: correo.body,
        segment:
          SEGMENTO_DEMO as unknown as Database["public"]["Tables"]["outreach_campaigns"]["Insert"]["segment"],
        segment_label: describirSegmento(SEGMENTO_DEMO),
        created_by: DEMO_USER_ID,
      });
      if (errCampana) throw new Error(errCampana.message);
    }
  } catch (e) {
    console.error("[demo-reset] no se pudo sembrar Seguimiento", e);
  }
}
