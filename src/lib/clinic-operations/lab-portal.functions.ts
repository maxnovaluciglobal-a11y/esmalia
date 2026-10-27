import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { leerCookieConAnterior } from "@/lib/compat/nombres-anteriores";
import { assertNotDemoClinic, requireClinicRole } from "@/lib/access/clinic-guards.server";
import { appOrigin } from "@/lib/app-origin.server";
import { mensajeDb } from "@/lib/db-errors";
import {
  ROLES_EMITEN_LINK_LABORATORIO,
  ROLES_REVOCAN_LINK_LABORATORIO,
} from "@/lib/clinic-operations/lab-portal-roles";
import { LAB_ORDER_STATUSES, type LabOrderStatus } from "@/lib/finance/finance";
import {
  LAB_PORTAL_COOKIE_MAX_AGE_SECONDS,
  LAB_PORTAL_COOKIE_NAME,
  labTokenRevocado,
  signLabToken,
  verifyLabToken,
  type LabTokenClaims,
  type VerifiedLabToken,
} from "@/lib/clinic-operations/lab-portal-token.server";
import { requireEscritura } from "@/lib/solo-lectura.middleware";
import {
  detalleDesdeFila,
  hoyEnZona,
  type DetalleTecnico,
} from "@/lib/clinic-operations/lab-orden-detalle";

/**
 * Portal externo de laboratorio (gap de la auditoría comparativa vs.
 * SuperClini, 22-sep-2026): hasta ahora `lab_orders` era gestión INTERNA —
 * el staff registraba lo que sabía del laboratorio, pero el laboratorio no
 * tenía forma de entrar y actualizar su propia orden.
 *
 * Mismo patrón que el portal del paciente (Wave C): link firmado sin login,
 * cookie de sesión HttpOnly después de abrirlo una vez. Deliberadamente sin
 * audit log dedicado (a diferencia del portal de paciente) — acá no hay PHI
 * clínica, solo descripción del trabajo y piezas.
 */

// ─── Cara clínica: generar el link ──────────────────────────────────────

export const generateLabPortalLink = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        labId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    // Auditoría 10-oct-2026: antes bastaba con ser miembro (RLS de SELECT).
    await requireClinicRole(
      context.supabase,
      data.clinicId,
      context.userId,
      ROLES_EMITEN_LINK_LABORATORIO,
      "No tienes permisos para compartir el portal del laboratorio.",
    );
    await assertNotDemoClinic(context.supabase, data.clinicId);

    const { data: lab, error } = await context.supabase
      .from("labs")
      .select("id, is_active")
      .eq("clinic_id", data.clinicId)
      .eq("id", data.labId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos verificar el laboratorio."));
    if (!lab) throw new Error("Ese laboratorio no existe.");
    if (!lab.is_active) throw new Error("Ese laboratorio está desactivado.");

    const token = await signLabToken({ labId: data.labId, clinicId: data.clinicId });
    // Origen del servidor, no del cliente: el token viaja en el path.
    return { url: `${appOrigin()}/portal-laboratorio/${token}` };
  });

/**
 * Corta todos los links ya emitidos para un laboratorio (se filtró, cambió
 * el contacto, se dejó de trabajar con él). Un link generado después vuelve
 * a funcionar: su `iat` es posterior a `portal_revoked_at`.
 */
export const revokeLabPortalAccess = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), labId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireClinicRole(
      context.supabase,
      data.clinicId,
      context.userId,
      ROLES_REVOCAN_LINK_LABORATORIO,
      "No tienes permisos para revocar el portal del laboratorio.",
    );
    const { data: fila, error } = await context.supabase
      .from("labs")
      .update({ portal_revoked_at: new Date().toISOString() })
      .eq("clinic_id", data.clinicId)
      .eq("id", data.labId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos revocar el acceso al portal."));
    if (!fila) throw new Error("Ese laboratorio no existe.");
    return { ok: true };
  });

// ─── Cara del laboratorio: sesión + órdenes ──────────────────────────────

function readLabPortalCookie(): string | null {
  const req = getRequest();
  const cookieHeader = req?.headers.get("cookie") ?? "";
  return leerCookieConAnterior(cookieHeader, LAB_PORTAL_COOKIE_NAME);
}

const PORTAL_LAB_SIN_ACCESO =
  "Este enlace del portal ya no está activo. Pide un enlace nuevo a la clínica.";

/**
 * Firma válida no alcanza: el laboratorio tiene que seguir activo y la
 * clínica no tiene que haber revocado el portal después de emitir el token.
 * Se consulta en cada request (no solo al abrir el link), igual que
 * `isPortalTokenRevoked` del portal del paciente.
 */
async function assertLabPortalVigente(token: VerifiedLabToken): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const consulta = (columnas: string) =>
    supabaseAdmin
      .from("labs")
      .select(columnas)
      .eq("id", token.labId)
      .eq("clinic_id", token.clinicId)
      .maybeSingle();

  let { data, error } = await consulta("is_active, portal_revoked_at");
  // Ventana de deploy: si la migración 20261013000000 todavía no se aplicó,
  // la columna no existe. Se sigue validando `is_active` en vez de tirar
  // abajo el portal de todos los laboratorios.
  if (error && /portal_revoked_at/.test(error.message ?? "")) {
    ({ data, error } = await consulta("is_active"));
  }
  if (error) throw new Error(mensajeDb(error, "No pudimos verificar el acceso al portal."));
  const lab = data as unknown as { is_active: boolean; portal_revoked_at?: string | null } | null;
  if (labTokenRevocado(token, lab)) throw new Error(PORTAL_LAB_SIN_ACCESO);
}

async function requireLabPortalSession(): Promise<LabTokenClaims> {
  const token = readLabPortalCookie();
  if (!token) throw new Error("Portal no autorizado.");
  let verificado: VerifiedLabToken;
  try {
    verificado = await verifyLabToken(token);
  } catch {
    throw new Error("Sesión del portal vencida. Pide un enlace nuevo a la clínica.");
  }
  await assertLabPortalVigente(verificado);
  return { labId: verificado.labId, clinicId: verificado.clinicId };
}

export const openLabPortalSession = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: z.string().min(20) }).parse(input))
  .handler(async ({ data }) => {
    const payload = await verifyLabToken(data.token);
    await assertLabPortalVigente(payload);
    const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
    setResponseHeader(
      "Set-Cookie",
      `${LAB_PORTAL_COOKIE_NAME}=${encodeURIComponent(data.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${LAB_PORTAL_COOKIE_MAX_AGE_SECONDS}${secureFlag}`,
    );
    return { ok: true, labId: payload.labId };
  });

export interface LabPortalOrder extends DetalleTecnico {
  id: string;
  patientName: string;
  description: string;
  toothNumbers: number[] | null;
  status: LabOrderStatus;
  sentOn: string;
  dueOn: string | null;
  receivedOn: string | null;
  notes: string | null;
  /** LAB-07: trabajo del catálogo con que se pidió (nombre de entonces). */
  catalogName: string | null;
  /** LAB-06: días de atraso según el hoy de la clínica; `null` = no atrasada. */
  diasAtraso: number | null;
}

/**
 * Órdenes del laboratorio autenticado — todas, no solo las pendientes: el
 * laboratorio también necesita ver su propio historial de entregadas.
 *
 * Ola 9: pasa por `portal_laboratorio_ordenes` (solo service_role), que
 * filtra por laboratorio y clínica en la base, no devuelve el costo y
 * calcula el atraso con `clinics.timezone`.
 */
export const getMyLabPortalOrders = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    labName: string;
    clinicName: string;
    hoy: string | null;
    orders: LabPortalOrder[];
  }> => {
    const { labId, clinicId } = await requireLabPortalSession();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: lab }, { data: clinic }, { data: rows, error }] = await Promise.all([
      supabaseAdmin.from("labs").select("name").eq("id", labId).maybeSingle(),
      supabaseAdmin.from("clinics").select("name").eq("id", clinicId).maybeSingle(),
      supabaseAdmin.rpc("portal_laboratorio_ordenes", { p_clinic_id: clinicId, p_lab_id: labId }),
    ]);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las órdenes."));

    return {
      labName: lab?.name ?? "Tu laboratorio",
      clinicName: clinic?.name ?? "la clínica",
      hoy: rows?.[0]?.hoy_clinica ?? null,
      orders: (rows ?? []).map((r) => ({
        id: r.id,
        patientName: r.patient_name ?? "Paciente",
        description: r.description,
        toothNumbers: r.tooth_numbers,
        status: r.status,
        sentOn: r.sent_on,
        dueOn: r.due_on,
        receivedOn: r.received_on,
        notes: r.notes,
        catalogName: r.catalog_name,
        diasAtraso: r.dias_atraso,
        ...detalleDesdeFila(r),
      })),
    };
  },
);

/**
 * El laboratorio solo puede mover su propia orden a `en_proceso` o
 * `recibido` — nunca a `enviado` (eso lo decide la clínica al crearla) ni a
 * `cancelado` (decisión de la clínica, no del taller). `reprocesar` tampoco:
 * es la clínica devolviendo el trabajo, no el laboratorio marcándolo.
 */
const ESTADOS_PERMITIDOS_AL_LABORATORIO: LabOrderStatus[] = ["en_proceso", "recibido"];

export const updateLabOrderStatusFromPortal = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        orderId: z.string().uuid(),
        status: z.enum(LAB_ORDER_STATUSES),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { labId, clinicId } = await requireLabPortalSession();
    if (!ESTADOS_PERMITIDOS_AL_LABORATORIO.includes(data.status)) {
      throw new Error("Ese cambio de estado lo hace la clínica, no el laboratorio.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error: fetchError } = await supabaseAdmin
      .from("lab_orders")
      .select("id, lab_id, clinic_id")
      .eq("id", data.orderId)
      .maybeSingle();
    if (fetchError) throw new Error(mensajeDb(fetchError, "No pudimos leer la orden."));
    if (!order || order.lab_id !== labId || order.clinic_id !== clinicId) {
      throw new Error("Esa orden no pertenece a tu laboratorio.");
    }
    // service_role no pasa por `block_demo_writes`: la demo se frena acá.
    const { data: clinica } = await supabaseAdmin
      .from("clinics")
      .select("is_demo, timezone")
      .eq("id", clinicId)
      .maybeSingle();
    if (!clinica || clinica.is_demo) throw new Error(PORTAL_LAB_SIN_ACCESO);

    const { error } = await supabaseAdmin
      .from("lab_orders")
      .update({
        status: data.status,
        // Día de la clínica (regla 7), no el del reloj UTC del servidor.
        received_on: data.status === "recibido" ? hoyEnZona(clinica.timezone) : null,
      })
      .eq("id", data.orderId);
    if (error) throw new Error(mensajeDb(error, "No pudimos actualizar el estado."));
    return { ok: true };
  });
