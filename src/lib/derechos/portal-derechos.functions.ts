/**
 * "Mis datos y mis derechos" en el portal del paciente (SEG-09, Ley 21.719).
 *
 * El portal no tiene sesión de Supabase: cada función valida la cookie del
 * link firmado (`requirePortalSession`) y trabaja con el cliente de servicio
 * filtrando SIEMPRE por la clínica y el paciente del token. Nada de lo que
 * manda el navegador elige paciente o clínica.
 *
 * - Acceso y portabilidad: la descarga se arma en el servidor (PDF, JSON o
 *   CSV) y queda registrada como una solicitud resuelta en el acto. Si no se
 *   puede registrar, no se entrega.
 * - Oposición a comunicaciones: la baja de WhatsApp (`wa_opt_out_at`) y de
 *   correos (`email_opt_out_at`) se aplica en el acto y queda registrada.
 * - Rectificación, supresión, bloqueo, oposición a otro uso y copia íntegra
 *   de la ficha: crean una solicitud para la clínica, que responde dentro
 *   del plazo. La ficha no cambia sola.
 *
 * Antiabuso: el mismo criterio que los pedidos de hora del portal (tope por
 * paciente cada 24 h, contado en la base).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  MAX_CAMBIOS_COMUNICACION_24H,
  MAX_DESCARGAS_PORTAL_24H,
  MAX_SOLICITUDES_PORTAL_24H,
  TIPOS_PEDIBLES_EN_PORTAL,
  estaCerrada,
  fechaCivilEn,
  superaTopeDiario,
  vencimientoVigente,
  type EstadoSolicitud,
  type TipoSolicitud,
} from "@/lib/derechos/derechos";
import {
  armarMisDatos,
  contenidoPdfMisDatos,
  misDatosACsv,
  misDatosAJson,
  nombreArchivoMisDatos,
  type FormatoMisDatos,
} from "@/lib/derechos/mis-datos";
import { leerFilasDelTitular } from "@/lib/derechos/mis-datos.server";
import { mensajeDb } from "@/lib/db-errors";
import { requirePortalSession } from "@/lib/patients/portal-sesion.server";

const DIA_MS = 24 * 60 * 60 * 1000;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function contarRecientes(
  clinicId: string,
  patientId: string,
  filtro: { channel: "portal" | "portal_automatico"; kinds?: TipoSolicitud[] },
): Promise<number> {
  const db = await admin();
  let q = db
    .from("data_subject_requests")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .eq("channel", filtro.channel)
    .gte("received_at", new Date(Date.now() - DIA_MS).toISOString());
  if (filtro.kinds) q = q.in("kind", filtro.kinds);
  const { count, error } = await q;
  if (error) throw new Error(mensajeDb(error, "No pudimos verificar tus solicitudes anteriores."));
  return count ?? 0;
}

export interface SolicitudDelPortal {
  id: string;
  kind: TipoSolicitud;
  status: EstadoSolicitud;
  channel: string;
  receivedAt: string;
  venceEl: string;
  response: string | null;
  respondedAt: string | null;
}

export interface MisDerechosPortal {
  clinica: { nombre: string; zona: string };
  comunicaciones: {
    whatsapp: { recibe: boolean; bajaEl: string | null; tieneTelefono: boolean };
    correo: { recibe: boolean; bajaEl: string | null; tieneCorreo: boolean };
  };
  solicitudes: SolicitudDelPortal[];
}

/** Estado de las comunicaciones y solicitudes del paciente del portal. */
export const getMisDerechosPortal = createServerFn({ method: "GET" }).handler(
  async (): Promise<MisDerechosPortal> => {
    const { patientId, clinicId } = await requirePortalSession();
    const db = await admin();
    const [paciente, clinica, solicitudes] = await Promise.all([
      db
        .from("patients")
        .select("phone, email, wa_opt_out_at, email_opt_out_at")
        .eq("clinic_id", clinicId)
        .eq("id", patientId)
        .maybeSingle(),
      db.from("clinics").select("name, timezone").eq("id", clinicId).maybeSingle(),
      db
        .from("data_subject_requests")
        .select(
          "id, kind, status, channel, received_at, due_date, extended_due_date, response, responded_at",
        )
        .eq("clinic_id", clinicId)
        .eq("patient_id", patientId)
        .order("received_at", { ascending: false })
        .limit(30),
    ]);
    if (paciente.error || !paciente.data) {
      throw new Error(mensajeDb(paciente.error, "No pudimos cargar tus datos."));
    }
    if (clinica.error || !clinica.data) {
      throw new Error(mensajeDb(clinica.error, "No pudimos cargar los datos de la clínica."));
    }
    if (solicitudes.error) {
      throw new Error(mensajeDb(solicitudes.error, "No pudimos cargar tus solicitudes."));
    }
    const p = paciente.data;
    return {
      clinica: { nombre: clinica.data.name, zona: clinica.data.timezone || "America/Santiago" },
      comunicaciones: {
        whatsapp: {
          recibe: !p.wa_opt_out_at,
          bajaEl: p.wa_opt_out_at,
          tieneTelefono: Boolean(p.phone),
        },
        correo: {
          recibe: !p.email_opt_out_at,
          bajaEl: p.email_opt_out_at,
          tieneCorreo: Boolean(p.email),
        },
      },
      solicitudes: (solicitudes.data ?? []).map((s) => {
        const status = s.status as EstadoSolicitud;
        const cerrada = estaCerrada(status);
        return {
          id: s.id,
          kind: s.kind as TipoSolicitud,
          status,
          channel: s.channel,
          receivedAt: s.received_at,
          venceEl: vencimientoVigente(s),
          response: cerrada ? s.response : null,
          respondedAt: cerrada ? s.responded_at : null,
        };
      }),
    };
  },
);

const MIME: Record<FormatoMisDatos, string> = {
  pdf: "application/pdf",
  json: "application/json",
  csv: "text/csv;charset=utf-8",
};

const DESCRIPCION_FORMATO: Record<FormatoMisDatos, string> = {
  pdf: "PDF legible",
  json: "JSON (formato estructurado, para llevarlos a otro sistema)",
  csv: "CSV (planilla)",
};

/**
 * Descarga de los propios datos (acceso: PDF; portabilidad: JSON o CSV).
 * Se arma en el servidor y queda registrada antes de entregarse.
 */
export const descargarMisDatosPortal = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ formato: z.enum(["pdf", "json", "csv"]) }).parse(input))
  .handler(async ({ data }): Promise<{ nombreArchivo: string; mime: string; base64: string }> => {
    const { patientId, clinicId } = await requirePortalSession();
    const recientes = await contarRecientes(clinicId, patientId, {
      channel: "portal_automatico",
      kinds: ["acceso", "portabilidad"],
    });
    if (superaTopeDiario(recientes, MAX_DESCARGAS_PORTAL_24H)) {
      throw new Error(
        "Ya descargaste tus datos varias veces hoy. Vuelve a intentarlo mañana o usa el archivo que ya bajaste.",
      );
    }

    const db = await admin();
    const leido = await leerFilasDelTitular(db, clinicId, patientId);
    const ahora = new Date();
    const datos = armarMisDatos(leido.filas, leido.ids, {
      clinicaNombre: leido.clinica.nombre,
      zonaHoraria: leido.clinica.zona,
      generadoEn: ahora,
    });

    let bytes: Uint8Array;
    if (data.formato === "pdf") {
      const { generarPdfFicha } = await import("@/lib/exportacion/ficha-pdf");
      bytes = await generarPdfFicha(contenidoPdfMisDatos(datos));
    } else {
      const texto = data.formato === "json" ? misDatosAJson(datos) : misDatosACsv(datos);
      bytes = new TextEncoder().encode(texto);
    }

    // Sin registro no hay entrega: es la evidencia de que se atendió el
    // derecho (quién, cuándo y en qué formato).
    const { error } = await db.from("data_subject_requests").insert({
      clinic_id: clinicId,
      patient_id: patientId,
      kind: data.formato === "pdf" ? "acceso" : "portabilidad",
      channel: "portal_automatico",
      detail: `Descarga de sus datos en ${DESCRIPCION_FORMATO[data.formato]}.`,
      response: `Entrega automática desde el portal: el paciente descargó una copia de sus datos en ${DESCRIPCION_FORMATO[data.formato]}.`,
    });
    if (error) {
      console.error("[derechos] no se pudo registrar la descarga", error.message);
      throw new Error(
        "No pudimos registrar tu descarga, así que no la entregamos. Intenta de nuevo en unos minutos.",
      );
    }

    return {
      nombreArchivo: nombreArchivoMisDatos(data.formato, fechaCivilEn(ahora, leido.clinica.zona)),
      mime: MIME[data.formato],
      base64: Buffer.from(bytes).toString("base64"),
    };
  });

/** Pedido a la clínica (rectificación, supresión, bloqueo, oposición o copia íntegra). */
export const solicitarDerechoPortal = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        tipo: z.enum(TIPOS_PEDIBLES_EN_PORTAL),
        detalle: z.string().trim().max(2000).default(""),
      })
      .refine((v) => v.tipo === "acceso" || v.detalle.length >= 5, {
        message: "Cuéntanos qué necesitas (al menos 5 caracteres).",
        path: ["detalle"],
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ id: string; venceEl: string }> => {
    const { patientId, clinicId } = await requirePortalSession();
    const recientes = await contarRecientes(clinicId, patientId, { channel: "portal" });
    if (superaTopeDiario(recientes, MAX_SOLICITUDES_PORTAL_24H)) {
      throw new Error(
        "Ya enviaste varias solicitudes hoy. La clínica las va a responder; evita duplicarlas.",
      );
    }
    const db = await admin();
    const { data: fila, error } = await db
      .from("data_subject_requests")
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        kind: data.tipo,
        channel: "portal",
        detail: data.detalle || null,
      })
      .select("id, due_date")
      .single();
    if (error || !fila) {
      console.error("[derechos] no se pudo registrar la solicitud", error?.message);
      throw new Error("No pudimos registrar tu solicitud. Intenta de nuevo en unos minutos.");
    }
    return { id: fila.id, venceEl: fila.due_date };
  });

const TEXTO_BAJA: Record<"whatsapp" | "correo", string> = {
  whatsapp:
    "El paciente se dio de baja de los mensajes de WhatsApp desde el portal. La clínica ya no puede enviarle mensajes por ese canal.",
  correo:
    "El paciente se dio de baja de los correos de la clínica desde el portal. La clínica ya no le envía correos (salvo la respuesta a una solicitud sobre sus datos).",
};

/** Baja (oposición) o vuelta a recibir mensajes por WhatsApp o correo. */
export const cambiarComunicacionPortal = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ canal: z.enum(["whatsapp", "correo"]), recibir: z.boolean() }).parse(input),
  )
  .handler(async ({ data }): Promise<{ recibe: boolean }> => {
    const { patientId, clinicId } = await requirePortalSession();
    const db = await admin();
    const columna = data.canal === "whatsapp" ? "wa_opt_out_at" : "email_opt_out_at";

    if (data.recibir) {
      // Volver a recibir lo pide el propio paciente (baja-whatsapp.ts: "si
      // quiere volver a recibirlos, tiene que pedirlo él").
      const { error } = await db
        .from("patients")
        .update(data.canal === "whatsapp" ? { wa_opt_out_at: null } : { email_opt_out_at: null })
        .eq("clinic_id", clinicId)
        .eq("id", patientId);
      if (error) throw new Error("No pudimos guardar tu preferencia. Intenta de nuevo.");
      return { recibe: true };
    }

    const recientes = await contarRecientes(clinicId, patientId, {
      channel: "portal_automatico",
      kinds: ["oposicion"],
    });
    if (superaTopeDiario(recientes, MAX_CAMBIOS_COMUNICACION_24H)) {
      throw new Error("Ya cambiaste tus preferencias varias veces hoy. Intenta de nuevo mañana.");
    }

    // Solo la primera baja fija la fecha (igual que el enlace de baja del correo).
    const { data: cambiadas, error } = await db
      .from("patients")
      .update(
        data.canal === "whatsapp"
          ? { wa_opt_out_at: new Date().toISOString() }
          : { email_opt_out_at: new Date().toISOString() },
      )
      .eq("clinic_id", clinicId)
      .eq("id", patientId)
      .is(columna, null)
      .select("id");
    if (error) throw new Error("No pudimos guardar tu preferencia. Intenta de nuevo.");

    if ((cambiadas ?? []).length > 0) {
      const { error: errRegistro } = await db.from("data_subject_requests").insert({
        clinic_id: clinicId,
        patient_id: patientId,
        kind: "oposicion",
        channel: "portal_automatico",
        detail:
          data.canal === "whatsapp"
            ? "No quiere recibir mensajes de WhatsApp de la clínica."
            : "No quiere recibir correos de la clínica.",
        response: TEXTO_BAJA[data.canal],
      });
      // La baja ya se aplicó, que es lo que importa al paciente: el registro
      // faltante se avisa en el log, no se deshace la baja.
      if (errRegistro) console.error("[derechos] baja aplicada sin registro", errRegistro.message);
    }
    return { recibe: false };
  });
