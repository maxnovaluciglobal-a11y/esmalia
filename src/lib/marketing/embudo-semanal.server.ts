// src/lib/marketing/embudo-semanal.server.ts
//
// Lecturas y envío del reporte semanal del embudo. Las reglas y el correo están
// en `embudo-semanal.ts`. Lee con service role y solo saca conteos.
import { Resend } from "resend";

import { DEMO_EMAIL } from "@/lib/demo-cuenta";
import { SITE_URL } from "@/lib/seo";

import { esCorreoInterno } from "./medicion";
import {
  ESTADOS_DE_CITA_GESTIONADA,
  REPORTE_PARA,
  armarReporte,
  calcularMetricas,
  leadsPorOrigen,
  rangoDeLaSemana,
  semanaAnterior,
  type DatosDelReporte,
  type EventoDeMedicion,
  type EventoDeStripe,
  type LeadDelReporte,
  type RangoSemanal,
} from "./embudo-semanal";

type ClienteAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

const TAM_PAGINA = 1000;

/** Trae todas las filas: PostgREST corta cada respuesta en 1000. */
async function todasLasFilas<T>(
  pagina: (
    desde: number,
    hasta: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += TAM_PAGINA) {
    const { data, error } = await pagina(desde, desde + TAM_PAGINA - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if ((data?.length ?? 0) < TAM_PAGINA) return filas;
  }
}

async function correosDeUsuarios(admin: ClienteAdmin): Promise<Map<string, string>> {
  const correos = new Map<string, string>();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: TAM_PAGINA });
    if (error) throw new Error(error.message);
    for (const u of data.users) if (u.email) correos.set(u.id, u.email);
    if (data.users.length < TAM_PAGINA) return correos;
  }
}

async function clinicasConCitaGestionada(
  admin: ClienteAdmin,
  clinicas: string[],
  rango: RangoSemanal,
): Promise<number> {
  if (clinicas.length === 0) return 0;
  const citas = await todasLasFilas<{ clinic_id: string }>((desde, hasta) =>
    admin
      .from("appointments")
      .select("clinic_id")
      .in("clinic_id", clinicas)
      .in("status", ESTADOS_DE_CITA_GESTIONADA)
      .gte("starts_at", rango.desde)
      .lt("starts_at", rango.hasta)
      .order("id")
      .range(desde, hasta),
  );
  return new Set(citas.map((c) => c.clinic_id)).size;
}

export async function leerDatosDelReporte(
  admin: ClienteAdmin,
  semana: string,
  staffEmails: string | undefined = process.env.ESMALIA_STAFF_EMAILS,
): Promise<DatosDelReporte> {
  const anterior = semanaAnterior(semana);
  const rangoActual = rangoDeLaSemana(semana);
  const rangoAnterior = rangoDeLaSemana(anterior);
  const desde = rangoAnterior.desde;
  const hasta = rangoActual.hasta;
  const esInterno = (email: string | undefined) => esCorreoInterno(email, staffEmails, DEMO_EMAIL);

  const [correos, clinicas, suscripciones, eventos, stripe, leads] = await Promise.all([
    correosDeUsuarios(admin),
    todasLasFilas<{ id: string; is_demo: boolean; created_by: string | null }>((d, h) =>
      admin.from("clinics").select("id, is_demo, created_by").order("id").range(d, h),
    ),
    todasLasFilas<{ clinic_id: string }>((d, h) =>
      admin
        .from("subscriptions")
        .select("clinic_id")
        .in("status", ["trialing", "active"])
        .order("clinic_id")
        .range(d, h),
    ),
    todasLasFilas<EventoDeMedicion>((d, h) =>
      admin
        .from("marketing_events")
        .select("name, session_hash, props, created_at")
        .in("name", ["page_view", "registro_completado", "suscripcion_activada"])
        .gte("created_at", desde)
        .lt("created_at", hasta)
        .order("id")
        .range(d, h),
    ),
    todasLasFilas<EventoDeStripe>((d, h) =>
      admin
        .from("stripe_events")
        .select("type, clinic_id, raw, received_at")
        .in("type", [
          "customer.subscription.created",
          "customer.subscription.updated",
          "customer.subscription.deleted",
        ])
        .gte("received_at", desde)
        .lt("received_at", hasta)
        .order("id")
        .range(d, h),
    ),
    todasLasFilas<LeadDelReporte>((d, h) =>
      admin
        .from("marketing_leads")
        .select("source, email, consent_at, created_at")
        .gte("created_at", desde)
        .lt("created_at", hasta)
        .order("id")
        .range(d, h),
    ),
  ]);

  const clinicasInternas = new Set(
    clinicas
      .filter((c) => c.is_demo || esInterno(c.created_by ? correos.get(c.created_by) : undefined))
      .map((c) => c.id),
  );
  const clinicasReales = [
    ...new Set(suscripciones.map((s) => s.clinic_id).filter((id) => !clinicasInternas.has(id))),
  ];
  const [activasActual, activasAnterior] = await Promise.all([
    clinicasConCitaGestionada(admin, clinicasReales, rangoActual),
    clinicasConCitaGestionada(admin, clinicasReales, rangoAnterior),
  ]);

  const base = { eventos, stripe, clinicasInternas };
  return {
    semana,
    actual: calcularMetricas({ ...base, clinicasActivas: activasActual }, rangoActual),
    anterior: calcularMetricas({ ...base, clinicasActivas: activasAnterior }, rangoAnterior),
    leads: leadsPorOrigen(leads, rangoActual, esInterno),
    leadsAnterior: leadsPorOrigen(leads, rangoAnterior, esInterno),
  };
}

export type ResultadoDelEnvio = "enviado" | "duplicado";

/**
 * Manda el reporte. El envío semanal lleva una clave por semana y Resend la
 * recuerda 24 h: los dos disparos y los reintentos del lunes no duplican. La
 * vista previa no la lleva, para poder repetirse sin consumir la de la semana.
 */
export async function enviarReporte(
  datos: DatosDelReporte,
  opciones: { vistaPrevia: boolean },
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResultadoDelEnvio> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("falta RESEND_API_KEY o EMAIL_FROM");

  const correo = armarReporte(datos, { appUrl: SITE_URL, vistaPrevia: opciones.vistaPrevia });
  const { error } = await new Resend(apiKey).emails.send(
    { from, to: REPORTE_PARA, subject: correo.subject, html: correo.html, text: correo.text },
    opciones.vistaPrevia ? undefined : { idempotencyKey: `embudo-semanal/${datos.semana}` },
  );
  if (!error) return "enviado";
  // Otro disparo ya mandó esta semana (mismo reporte o con otra cifra).
  if (error.name.includes("idempotent")) return "duplicado";
  throw new Error(error.message);
}
