// src/lib/marketing/notify-alta.server.ts
//
// Envía el aviso interno de alta de clínica (CS-10). Mismo criterio que
// `notify-lead.server.ts`: destinatario = equipo de Esmalia, no un paciente,
// así que no pasa por el gate de sandbox de `email.server.ts`; best-effort,
// no lanza NUNCA y el alta no espera más de lo que le dé `conTope`.
import { Resend } from "resend";

import { DEMO_EMAIL } from "@/lib/demo-cuenta";
import { armarAvisoAlta } from "@/lib/marketing/aviso-alta";
import { destinatariosStaff } from "@/lib/marketing/notify-lead.server";
import { esCorreoInterno } from "@/lib/marketing/medicion";
import { SITE_URL } from "@/lib/seo";

export async function notificarAltaDeClinica(datos: {
  userId: string;
  clinicName: string;
  countryCode: string;
  profesionales: number;
}): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    const staff = destinatariosStaff();
    if (!apiKey || !from || staff.length === 0) {
      console.warn("[alta] Sin notificar: falta RESEND_API_KEY, EMAIL_FROM o destinatarios.");
      return;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.auth.admin.getUserById(datos.userId);
    const userEmail = data?.user?.email ?? null;

    const aviso = armarAvisoAlta(
      {
        clinicName: datos.clinicName,
        countryCode: datos.countryCode,
        userEmail,
        profesionales: datos.profesionales,
        interno: esCorreoInterno(userEmail, process.env.ESMALIA_STAFF_EMAILS, DEMO_EMAIL),
      },
      SITE_URL,
    );

    const { error } = await new Resend(apiKey).emails.send({
      from,
      to: staff,
      subject: aviso.asunto,
      html: aviso.html,
      text: aviso.texto,
    });
    if (error) console.error("[alta] fallo al notificar por email:", error.message);
  } catch (err) {
    console.error(
      "[alta] excepción notificando el alta (no bloquea):",
      err instanceof Error ? err.message : err,
    );
  }
}
