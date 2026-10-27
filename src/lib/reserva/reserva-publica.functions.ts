import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { appOrigin } from "@/lib/app-origin.server";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import { ipYNavegador } from "@/lib/firma-distancia/firma.server";
import { generarCodigo, normalizarCodigo, sha256Hex } from "@/lib/firma-distancia/token";
import { sendEmail } from "@/lib/messaging/email.server";
import { toE164 } from "@/lib/messaging/telefonos";
import {
  horasDisponibles,
  horaSigueLibre,
  type DiaDisponible,
} from "@/lib/reserva/disponibilidad-reserva";
import { enlaceGestionCita, verificarTokenRecall } from "@/lib/reserva/enlace-cita.server";
import { partirHoraLocal } from "@/lib/reserva/hora-local";
import { correoCodigoDeReserva } from "@/lib/reserva/mensajes";
import {
  armarEntradaHoras,
  exigirLimiteDeReserva,
  leerContextoPublico,
  type ContextoPublico,
  type LecturaContexto,
} from "@/lib/reserva/reserva-db.server";
import {
  enmascararEmail,
  esSlugValido,
  mensajeDeReserva,
  normalizarEmail,
  rutDeReserva,
  SolicitudReservaSchema,
  textoCanonicoSolicitud,
  type MotivoReserva,
  type SolicitudReserva,
} from "@/lib/reserva/reserva";

/**
 * Reserva en línea (RES-01 a RES-04): server functions de la página pública
 * `/reservar/<slug>[/<profesional>]`. Sin login.
 *
 * El navegador nunca toca la base: estas funciones validan, aplican el
 * límite por IP en memoria (además del de la base), calculan las horas con
 * el motor de la agenda y llaman las funciones `reserva_en_linea_*` con el
 * rol de servicio. La cita se crea `tentativa`: la acepta el profesional.
 */

const SlugSchema = z.string().refine(esSlugValido, "Link inválido.");
const DIAS_POR_PAGINA = 14;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Contexto activo o null (apagada, inexistente o clínica en solo lectura). */
async function contextoActivo(slug: string): Promise<{
  lectura: LecturaContexto;
  contexto: ContextoPublico | null;
}> {
  const db = await admin();
  const lectura = await leerContextoPublico(db, slug);
  if (lectura.estado !== "activa") return { lectura, contexto: null };
  const { clinicaEnSoloLectura } = await import("@/lib/solo-lectura.server");
  if (await clinicaEnSoloLectura(db, lectura.contexto.clinicId)) {
    return { lectura: { estado: "apagada", clinica: lectura.contexto.clinica }, contexto: null };
  }
  return { lectura, contexto: lectura.contexto };
}

// ─── Abrir ────────────────────────────────────────────────────────────────

export type ReservaAbierta =
  | { estado: "no_existe" }
  | { estado: "apagada"; clinica: string | null }
  | {
      estado: "activa";
      slug: string;
      clinica: string;
      pais: string | null;
      nota: string | null;
      pideRut: boolean;
      sucursales: ContextoPublico["sucursales"];
      profesionales: { id: string; nombre: string; slug: string; sucursalId: string | null }[];
      motivos: MotivoReserva[];
      /** Si el link es de un profesional: su id (y no se ofrece elegir otro). */
      profesionalFijo: string | null;
      /** MKT-06: nombre precargado desde el recall. */
      nombrePrecargado: string | null;
    };

export const abrirReserva = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        slug: SlugSchema,
        profesional: z.string().max(80).optional(),
        recall: z.string().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<ReservaAbierta> => {
    const { ip } = ipYNavegador();
    exigirLimiteDeReserva(ip);
    const { lectura, contexto } = await contextoActivo(data.slug);
    if (!contexto) {
      return lectura.estado === "apagada"
        ? { estado: "apagada", clinica: lectura.clinica }
        : { estado: "no_existe" };
    }
    let profesionalFijo: string | null = null;
    if (data.profesional) {
      const p = contexto.profesionales.find((x) => x.slug === data.profesional);
      if (!p) return { estado: "no_existe" };
      profesionalFijo = p.id;
    }
    let nombrePrecargado: string | null = null;
    if (data.recall) {
      const r = verificarTokenRecall(data.recall);
      if (r.ok && r.clinicId === contexto.clinicId) {
        const db = await admin();
        const { data: pac } = await db
          .from("patients")
          .select("full_name")
          .eq("id", r.patientId)
          .eq("clinic_id", contexto.clinicId)
          .is("archived_at", null)
          .maybeSingle();
        nombrePrecargado = pac?.full_name ?? null;
      }
    }
    return {
      estado: "activa",
      slug: data.slug,
      clinica: contexto.clinica,
      pais: contexto.pais,
      nota: contexto.nota,
      pideRut: (contexto.pais ?? "CL").toUpperCase() === "CL",
      sucursales: contexto.sucursales,
      profesionales: contexto.profesionales.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        slug: p.slug,
        sucursalId: p.sucursalId,
      })),
      motivos: contexto.motivos,
      profesionalFijo,
      nombrePrecargado,
    };
  });

// ─── Horas libres ─────────────────────────────────────────────────────────

const MotivoSchema = z.object({ tipo: z.enum(["procedimiento", "tipo"]), id: z.string().uuid() });

export interface HorasDeReserva {
  zona: string;
  dias: DiaDisponible[];
  /** Hay más días reservables después de esta página. */
  hayMas: boolean;
  siguienteDesde: string | null;
}

export const horasDeReserva = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        slug: SlugSchema,
        sucursalId: z.string().uuid(),
        motivo: MotivoSchema,
        profesionalId: z.string().uuid().nullable(),
        desde: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<HorasDeReserva> => {
    const { ip } = ipYNavegador();
    exigirLimiteDeReserva(ip);
    const { contexto } = await contextoActivo(data.slug);
    if (!contexto) throw new Error(mensajeDeReserva("apagada"));
    const sucursal = contexto.sucursales.find((s) => s.id === data.sucursalId);
    const motivo = contexto.motivos.find(
      (m) => m.tipo === data.motivo.tipo && m.id === data.motivo.id,
    );
    if (!sucursal || !motivo) throw new Error(mensajeDeReserva("invalida"));
    const candidatos = data.profesionalId
      ? contexto.profesionales.filter((p) => p.id === data.profesionalId)
      : contexto.profesionales;
    if (candidatos.length === 0) throw new Error(mensajeDeReserva("invalida"));

    const db = await admin();
    const entrada = await armarEntradaHoras(db, {
      clinicId: contexto.clinicId,
      sucursalId: sucursal.id,
      zona: sucursal.zona,
      profesionales: contexto.profesionales,
      profesionalIds: candidatos.map((p) => p.id),
      duracion: motivo.duracion,
      minNoticeHours: contexto.minNoticeHours,
      maxDaysAhead: contexto.maxDaysAhead,
      desde: data.desde,
      dias: DIAS_POR_PAGINA,
    });
    const dias = horasDisponibles(entrada);
    const ultimo = dias[dias.length - 1]?.fecha ?? null;
    const hayMas = Boolean(ultimo && ultimo < entrada.ultimoDia);
    return {
      zona: sucursal.zona,
      dias,
      hayMas,
      siguienteDesde: hayMas && ultimo ? siguienteDia(ultimo) : null,
    };
  });

function siguienteDia(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ─── Validación común de una solicitud ────────────────────────────────────

interface SolicitudValidada {
  contexto: ContextoPublico;
  telefono: string;
  rut: string | null;
  email: string;
  zona: string;
  startsAt: Date;
  boxId: string | null;
  requestHash: string;
}

async function validarSolicitud(s: SolicitudReserva): Promise<SolicitudValidada> {
  const { contexto } = await contextoActivo(s.slug);
  if (!contexto) throw new Error(mensajeDeReserva("apagada"));
  const sucursal = contexto.sucursales.find((x) => x.id === s.sucursalId);
  const motivo = contexto.motivos.find((m) => m.tipo === s.motivo.tipo && m.id === s.motivo.id);
  const prof = contexto.profesionales.find((p) => p.id === s.profesionalId);
  const hora = partirHoraLocal(s.inicio);
  if (!sucursal || !motivo || !prof || !hora) throw new Error(mensajeDeReserva("invalida"));

  const telefono = toE164(s.telefono, contexto.pais);
  if (!telefono) throw new Error("Revisa tu teléfono: no pudimos leerlo.");
  const pideRut = (contexto.pais ?? "CL").toUpperCase() === "CL";
  const rut = pideRut ? rutDeReserva(s.rut) : null;
  if (rut === "invalido") {
    throw new Error("El RUT no es válido: revisa los números y el dígito verificador.");
  }

  const db = await admin();
  const entrada = await armarEntradaHoras(db, {
    clinicId: contexto.clinicId,
    sucursalId: sucursal.id,
    zona: sucursal.zona,
    profesionales: contexto.profesionales,
    profesionalIds: [prof.id],
    duracion: motivo.duracion,
    minNoticeHours: contexto.minNoticeHours,
    maxDaysAhead: contexto.maxDaysAhead,
    desde: hora.fecha,
    dias: 1,
  });
  const libre = horaSigueLibre(entrada, hora.fecha, hora.minutos, prof.id);
  if (!libre) throw new Error(mensajeDeReserva("ocupado"));

  const requestHash = await sha256Hex(textoCanonicoSolicitud(s, telefono, rut));
  return {
    contexto,
    telefono,
    rut,
    email: normalizarEmail(s.email),
    zona: sucursal.zona,
    startsAt: wallTimeInTzToUtc(s.inicio, sucursal.zona),
    boxId: libre.boxId,
    requestHash,
  };
}

// ─── Código por correo ────────────────────────────────────────────────────

export type CodigoDeReserva =
  | { ok: true; verificacionId: string; enviadoA: string; redirigido: boolean }
  | { ok: false; motivo: string; esperarSegundos: number | null };

export const pedirCodigoDeReserva = createServerFn({ method: "POST" })
  .validator((input: unknown) => SolicitudReservaSchema.parse(input))
  .handler(async ({ data }): Promise<CodigoDeReserva> => {
    const { ip } = ipYNavegador();
    exigirLimiteDeReserva(ip);
    // Trampa para bots: se responde como si nada para no enseñarles el filtro.
    if (data.sitioWeb.trim() !== "") {
      return {
        ok: true,
        verificacionId: crypto.randomUUID(),
        enviadoA: enmascararEmail(data.email),
        redirigido: false,
      };
    }
    const v = await validarSolicitud(data);
    const codigo = generarCodigo();
    const db = await admin();
    const { data: r, error } = await db.rpc("reserva_en_linea_preparar_codigo", {
      p_clinic_id: v.contexto.clinicId,
      p_request_hash: v.requestHash,
      p_code_hash: await sha256Hex(`${v.requestHash}:${codigo}`),
      p_email_hash: await sha256Hex(`${v.contexto.clinicId}:${v.email}`),
      p_phone_hash: await sha256Hex(`${v.contexto.clinicId}:${v.telefono}`),
      p_ip: ip ?? "",
    });
    if (error) throw new Error("No pudimos preparar el código. Vuelve a intentarlo.");
    const j = (r ?? {}) as Record<string, unknown>;
    if (j.ok !== true || typeof j.id !== "string") {
      const motivo = typeof j.motivo === "string" ? j.motivo : "invalida";
      const esperar = typeof j.esperar === "number" ? j.esperar : null;
      return {
        ok: false,
        motivo:
          motivo === "espera"
            ? `Ya te mandamos un código. Puedes pedir otro en ${esperar ?? 60} segundos.`
            : mensajeDeReserva(motivo),
        esperarSegundos: esperar,
      };
    }

    const correo = correoCodigoDeReserva({
      appUrl: appOrigin(),
      clinica: v.contexto.clinica,
      nombre: data.nombre,
      codigo,
    });
    const { loadEmailSandboxConfig } = await import("@/lib/messaging/messaging.functions");
    const envio = await sendEmail(
      { to: v.email, subject: correo.subject, html: correo.html, text: correo.text },
      await loadEmailSandboxConfig(db, v.contexto.clinicId),
    );
    if (!envio.ok && process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) {
      // Solo en desarrollo local sin correo configurado: el código sale en la
      // consola del servidor para poder probar el flujo completo.
      console.info(`[reserva-en-linea] (desarrollo) código para ${v.email}: ${codigo}`);
      return {
        ok: true,
        verificacionId: j.id,
        enviadoA: enmascararEmail(v.email),
        redirigido: true,
      };
    }
    if (!envio.ok) {
      console.error("[reserva-en-linea] no salió el correo del código:", envio.reason);
      return {
        ok: false,
        motivo:
          "No pudimos enviarte el código por correo. Revisa la dirección o intenta de nuevo en un minuto.",
        esperarSegundos: 60,
      };
    }
    return {
      ok: true,
      verificacionId: j.id,
      enviadoA: enmascararEmail(v.email),
      redirigido: envio.redirected,
    };
  });

// ─── Confirmar ────────────────────────────────────────────────────────────

export type ReservaConfirmada =
  | {
      ok: true;
      inicio: string;
      fin: string;
      zona: string;
      clinica: string;
      enlace: string;
    }
  | { ok: false; motivo: string; restantes: number | null };

export const confirmarReserva = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        solicitud: SolicitudReservaSchema,
        verificacionId: z.string().uuid(),
        codigo: z.string().max(12),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<ReservaConfirmada> => {
    const { ip } = ipYNavegador();
    exigirLimiteDeReserva(ip);
    const codigo = normalizarCodigo(data.codigo);
    if (!codigo) return { ok: false, motivo: "Escribe los 6 dígitos del código.", restantes: null };
    if (data.solicitud.sitioWeb.trim() !== "") {
      return { ok: false, motivo: mensajeDeReserva("codigo_incorrecto"), restantes: null };
    }
    const v = await validarSolicitud(data.solicitud);
    const s = data.solicitud;
    const db = await admin();
    const reserva: Json = {
      branch_id: s.sucursalId,
      professional_id: s.profesionalId,
      procedure_id: s.motivo.tipo === "procedimiento" ? s.motivo.id : null,
      appointment_type_id: s.motivo.tipo === "tipo" ? s.motivo.id : null,
      operatory_id: v.boxId,
      starts_at: v.startsAt.toISOString(),
      nombre: s.nombre.trim().replace(/\s+/g, " "),
      email: v.email,
      telefono: v.telefono,
      rut: v.rut,
      nota: s.nota.trim() || null,
    };
    const { data: r, error } = await db.rpc("reserva_en_linea_confirmar", {
      p_verification_id: data.verificacionId,
      p_request_hash: v.requestHash,
      p_code_hash: await sha256Hex(`${v.requestHash}:${codigo}`),
      p_reserva: reserva,
    });
    if (error) {
      console.error("[reserva-en-linea] confirmar:", error.message);
      throw new Error("No pudimos guardar tu reserva. Vuelve a intentarlo.");
    }
    const j = (r ?? {}) as Record<string, unknown>;
    if (j.ok !== true || typeof j.appointment_id !== "string") {
      return {
        ok: false,
        motivo: mensajeDeReserva(typeof j.motivo === "string" ? j.motivo : null),
        restantes: typeof j.restantes === "number" ? j.restantes : null,
      };
    }
    return {
      ok: true,
      inicio: String(j.starts_at),
      fin: String(j.ends_at),
      zona: v.zona,
      clinica: v.contexto.clinica,
      enlace: enlaceGestionCita({
        appointmentId: j.appointment_id,
        clinicId: v.contexto.clinicId,
      }),
    };
  });
