import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { type Permission } from "@/lib/access/access";
import { permisosEfectivosEnClinica, rolEnClinica } from "@/lib/access/clinic-guards.server";
import { isUndefinedColumnError, mensajeDb } from "@/lib/db-errors";
import {
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type Quote,
  type QuoteStatus,
  type TreatmentPlanStatus,
} from "@/lib/finance/finance";
import { requireFinanceViewRole } from "@/lib/finance/finance-reports.functions";
import {
  QUOTE_COLUMNS,
  QUOTE_COLUMNS_LEGACY,
  QUOTE_ITEM_COLUMNS,
  QUOTE_ITEM_COLUMNS_SIN_PAQUETES,
  mapQuote,
  mapQuoteItem,
  type QuoteItemRow,
  type QuoteRow,
} from "@/lib/finance/finance.functions";
import { DIAS_VALIDEZ_POR_DEFECTO } from "@/lib/finance/estados-presupuesto";
import { ultimoContacto, type PresupuestoDeClinica } from "@/lib/finance/presupuestos";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/** Tope de filas: la pantalla es una lista de trabajo, no un archivo. */
export const LIMITE_PRESUPUESTOS = 500;

type Supa = SupabaseClient<Database>;

/** Pasa si el rol de la clínica tiene alguno de los permisos (par de `requireAnyPermission`). */
async function requireAlgunPermiso(
  supabase: Supa,
  clinicId: string,
  userId: string,
  permisos: readonly Permission[],
  mensaje = "No tienes permisos para ver este presupuesto.",
) {
  const tiene = await permisosEfectivosEnClinica(supabase, clinicId, userId);
  if (!permisos.some((p) => tiene.includes(p))) throw new Error(mensaje);
}

/**
 * Pasa a 'expired' los presupuestos de la clínica cuya validez ya pasó
 * (PLA-06). Es mantenimiento del sistema, no una edición del usuario: la
 * función de la base marca el evento sin actor. Si la base todavía no tiene
 * la función (antes de 20261024200100) no hace nada: la vista igual calcula
 * "vencido" desde `valid_until`.
 */
async function vencerPresupuestos(supabase: Supa, clinicId: string) {
  const { error } = await supabase.rpc("vencer_presupuestos", { p_clinic_id: clinicId });
  if (error) console.warn("[presupuestos] vencer_presupuestos falló", error.message);
}

type FilaLista = {
  id: string;
  number: string;
  status: string;
  currency: string;
  total_cents: number;
  created_at: string;
  sent_at: string | null;
  valid_until: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  patient_id: string;
  accepted_total_cents?: number | null;
  professional_id?: string | null;
  last_contact_at?: string | null;
  next_action?: string | null;
  next_action_on?: string | null;
};

const COLUMNAS_LISTA_LEGACY =
  "id, number, status, currency, total_cents, created_at, sent_at, valid_until, accepted_at, rejected_at, patient_id";
const COLUMNAS_LISTA =
  COLUMNAS_LISTA_LEGACY +
  ", accepted_total_cents, professional_id, last_contact_at, next_action, next_action_on";

/**
 * Presupuestos de toda la clínica, los más nuevos primero (UX-13 + UX-16).
 * Par en el servidor de `requirePermission("finance:view")` de
 * `/presupuestos` (regla 15): la RLS de `quotes` deja leer a cualquier
 * miembro, así que el rol se chequea acá. Solo rol, sin el gate de
 * suscripción de los informes: es la lista de trabajo para cobrar.
 */
export const listPresupuestosDeClinica = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      presupuestos: PresupuestoDeClinica[];
      truncado: boolean;
      profesionales: { id: string; nombre: string }[];
    }> => {
      const { supabase, userId } = context;
      await requireFinanceViewRole(supabase, data.clinicId, userId);
      await vencerPresupuestos(supabase, data.clinicId);

      const leer = (columnas: string) =>
        supabase
          .from("quotes")
          .select(columnas)
          .eq("clinic_id", data.clinicId)
          .order("created_at", { ascending: false })
          .limit(LIMITE_PRESUPUESTOS);
      let { data: filas, error } = await leer(COLUMNAS_LISTA);
      if (error && isUndefinedColumnError(error)) {
        ({ data: filas, error } = await leer(COLUMNAS_LISTA_LEGACY));
      }
      if (error) throw new Error(mensajeDb(error, "No pudimos cargar los presupuestos."));

      const quotes = (filas ?? []) as unknown as FilaLista[];
      const patientIds = [...new Set(quotes.map((q) => q.patient_id))];

      const [pacientesRes, profesionalesRes, planesRes, mensajesRes] = await Promise.all([
        patientIds.length
          ? supabase
              .from("patients")
              .select("id, full_name")
              .eq("clinic_id", data.clinicId)
              .in("id", patientIds)
          : Promise.resolve({ data: [] as { id: string; full_name: string }[], error: null }),
        supabase
          .from("professionals")
          .select("id, full_name, is_active")
          .eq("clinic_id", data.clinicId)
          .order("full_name", { ascending: true }),
        supabase
          .from("treatment_plans")
          .select("quote_id, status")
          .eq("clinic_id", data.clinicId)
          .not("quote_id", "is", null),
        // El último mensaje de cada presupuesto (WhatsApp o correo con
        // quote_id) cuenta como contacto aunque nadie lo registre a mano.
        supabase
          .from("messages")
          .select("quote_id, created_at")
          .eq("clinic_id", data.clinicId)
          .not("quote_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);
      if (pacientesRes.error)
        throw new Error(mensajeDb(pacientesRes.error, "No pudimos cargar los pacientes."));

      const nombres = new Map((pacientesRes.data ?? []).map((p) => [p.id, p.full_name]));
      const profesionales = profesionalesRes.data ?? [];
      const nombreProfesional = new Map(profesionales.map((p) => [p.id, p.full_name]));
      const planPorQuote = new Map(
        (planesRes.data ?? []).map((p) => [p.quote_id as string, p.status as TreatmentPlanStatus]),
      );
      const ultimoMensaje = new Map<string, string>();
      for (const m of mensajesRes.data ?? []) {
        if (m.quote_id && !ultimoMensaje.has(m.quote_id))
          ultimoMensaje.set(m.quote_id, m.created_at);
      }

      return {
        presupuestos: quotes.map((q) => ({
          id: q.id,
          number: q.number,
          status: q.status as QuoteStatus,
          currency: q.currency,
          totalCents: q.total_cents,
          acceptedTotalCents: q.accepted_total_cents ?? null,
          createdAt: q.created_at,
          sentAt: q.sent_at,
          validUntil: q.valid_until,
          acceptedAt: q.accepted_at,
          rejectedAt: q.rejected_at,
          patientId: q.patient_id,
          patientName: nombres.get(q.patient_id) ?? null,
          professionalId: q.professional_id ?? null,
          professionalName: q.professional_id
            ? (nombreProfesional.get(q.professional_id) ?? null)
            : null,
          planStatus: planPorQuote.get(q.id) ?? null,
          ultimoContactoAt: ultimoContacto(q.last_contact_at, ultimoMensaje.get(q.id)),
          proximaAccion: q.next_action ?? null,
          proximaAccionOn: q.next_action_on ?? null,
        })),
        truncado: quotes.length >= LIMITE_PRESUPUESTOS,
        profesionales: profesionales
          .filter((p) => p.is_active)
          .map((p) => ({ id: p.id, nombre: p.full_name })),
      };
    },
  );

// ─── Detalle del plan (PLA-03) ──────────────────────────────────────────────

export type EventoDePresupuesto = {
  id: string;
  kind: "creado" | "estado" | "contacto" | "validez" | "envio";
  fromStatus: QuoteStatus | null;
  toStatus: QuoteStatus | null;
  validUntil: string | null;
  note: string | null;
  /** `null` = el sistema, o no se sabe (historial reconstruido). */
  actorName: string | null;
  sistema: boolean;
  createdAt: string;
};

export type PagoDelPlan = {
  id: string;
  amountCents: number;
  currency: string;
  metodo: string;
  reference: string | null;
  paidAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
};

export type MensajeDelPresupuesto = {
  id: string;
  channel: string;
  status: string;
  createdAt: string;
};

export type DetallePresupuesto = {
  quote: Quote;
  clinicId: string;
  patientId: string;
  patientName: string | null;
  professionalName: string | null;
  plan: {
    id: string;
    status: TreatmentPlanStatus;
    totalCents: number;
    lineas: number;
    lineasRealizadas: number;
  } | null;
  pagos: PagoDelPlan[];
  /** Pagado vigente (sin reversados) contra el plan. */
  pagadoCents: number;
  eventos: EventoDePresupuesto[];
  firmaUrl: string | null;
  mensajes: MensajeDelPresupuesto[];
  seguimiento: {
    lastContactAt: string | null;
    lastContactNote: string | null;
    nextAction: string | null;
    nextActionOn: string | null;
    ultimoMensajeAt: string | null;
  };
};

type FilaDetalle = QuoteRow & {
  patient_id: string;
  accepted_signature_path?: string | null;
  accepted_ip?: unknown;
  last_contact_at?: string | null;
  last_contact_note?: string | null;
  next_action?: string | null;
  next_action_on?: string | null;
};

/**
 * Detalle de un presupuesto / plan con todo lo que muestran sus pestañas:
 * prestaciones (líneas por sección), pagos y abonos del plan que creó la
 * aceptación, documentos (firma y envíos) e historial. Mismo público que
 * crea y edita presupuestos en la ficha (`patients:manage`) más el de
 * finanzas (`finance:view`): par de `requireAnyPermission` de la ruta.
 */
export const getDetallePresupuesto = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), quoteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<DetallePresupuesto> => {
    const { supabase, userId } = context;
    await requireAlgunPermiso(supabase, data.clinicId, userId, ["finance:view", "patients:manage"]);
    await vencerPresupuestos(supabase, data.clinicId);

    const extra =
      ", patient_id, accepted_signature_path, last_contact_at, last_contact_note, next_action, next_action_on";
    const leer = (columnas: string) =>
      supabase
        .from("quotes")
        .select(columnas)
        .eq("id", data.quoteId)
        .eq("clinic_id", data.clinicId)
        .maybeSingle();
    let { data: fila, error } = await leer(QUOTE_COLUMNS + extra);
    if (error && isUndefinedColumnError(error)) {
      ({ data: fila, error } = await leer(
        QUOTE_COLUMNS_LEGACY + ", patient_id, accepted_signature_path",
      ));
    }
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el presupuesto."));
    if (!fila) throw new Error("No encontramos ese presupuesto.");
    const q = fila as unknown as FilaDetalle;

    const leerItems = (columnas: string) =>
      supabase
        .from("quote_items")
        .select(columnas)
        .eq("clinic_id", data.clinicId)
        .eq("quote_id", data.quoteId)
        .order("phase_position", { ascending: true })
        .order("position", { ascending: true });
    let { data: itemRows, error: itemsErr } = await leerItems(QUOTE_ITEM_COLUMNS);
    if (itemsErr && isUndefinedColumnError(itemsErr)) {
      ({ data: itemRows, error: itemsErr } = await leerItems(QUOTE_ITEM_COLUMNS_SIN_PAQUETES));
    }
    if (itemsErr) throw new Error(mensajeDb(itemsErr, "No pudimos cargar las prestaciones."));
    const quote = mapQuote(q, ((itemRows ?? []) as unknown as QuoteItemRow[]).map(mapQuoteItem));

    const [pacienteRes, planRes, eventosRes, mensajesRes] = await Promise.all([
      supabase
        .from("patients")
        .select("full_name")
        .eq("id", q.patient_id)
        .eq("clinic_id", data.clinicId)
        .maybeSingle(),
      supabase
        .from("treatment_plans")
        .select("id, status, total_cents")
        .eq("clinic_id", data.clinicId)
        .eq("quote_id", data.quoteId)
        .maybeSingle(),
      supabase
        .from("quote_events")
        .select("id, kind, from_status, to_status, valid_until, note, actor_id, created_at")
        .eq("clinic_id", data.clinicId)
        .eq("quote_id", data.quoteId)
        .order("created_at", { ascending: false }),
      supabase
        .from("messages")
        .select("id, channel, status, created_at")
        .eq("clinic_id", data.clinicId)
        .eq("quote_id", data.quoteId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const professionalName = quote.professionalId
      ? ((
          await supabase
            .from("professionals")
            .select("full_name")
            .eq("id", quote.professionalId)
            .eq("clinic_id", data.clinicId)
            .maybeSingle()
        ).data?.full_name ?? null)
      : null;

    // Plan, líneas realizadas y pagos contra el plan.
    let plan: DetallePresupuesto["plan"] = null;
    let pagos: PagoDelPlan[] = [];
    if (planRes.data) {
      const [lineasRes, pagosRes] = await Promise.all([
        supabase
          .from("treatment_items")
          .select("status")
          .eq("clinic_id", data.clinicId)
          .eq("plan_id", planRes.data.id),
        supabase
          .from("payments")
          .select(
            "id, amount_cents, currency, method, reference, paid_at, reversed_at, reversal_reason",
          )
          .eq("clinic_id", data.clinicId)
          .eq("treatment_plan_id", planRes.data.id)
          .order("paid_at", { ascending: false }),
      ]);
      const lineas = lineasRes.data ?? [];
      plan = {
        id: planRes.data.id,
        status: planRes.data.status as TreatmentPlanStatus,
        totalCents: planRes.data.total_cents,
        lineas: lineas.length,
        lineasRealizadas: lineas.filter((l) => l.status === "completed").length,
      };
      // Sin permiso de ver pagos (RLS) la lista llega vacía: no es un error.
      pagos = (pagosRes.data ?? []).map((p) => ({
        id: p.id,
        amountCents: p.amount_cents,
        currency: p.currency,
        metodo: PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method,
        reference: p.reference,
        paidAt: p.paid_at,
        reversedAt: p.reversed_at,
        reversalReason: p.reversal_reason,
      }));
    }

    // Nombres de quien hizo cada cambio (perfiles de miembros de la clínica).
    const eventos = eventosRes.data ?? [];
    const actores = [...new Set(eventos.map((e) => e.actor_id).filter((a): a is string => !!a))];
    const { data: perfiles } = actores.length
      ? await supabase.from("profiles").select("id, full_name, email").in("id", actores)
      : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
    const nombreActor = new Map(
      (perfiles ?? []).map((p) => [p.id, p.full_name || p.email || "Miembro del equipo"]),
    );

    // Firma: link firmado de 10 minutos al bucket privado.
    let firmaUrl: string | null = null;
    if (q.accepted_signature_path) {
      const { data: firmada } = await supabase.storage
        .from("clinical-documents")
        .createSignedUrl(q.accepted_signature_path, 600);
      firmaUrl = firmada?.signedUrl ?? null;
    }

    const mensajes = (mensajesRes.data ?? []).map((m) => ({
      id: m.id,
      channel: m.channel as string,
      status: m.status as string,
      createdAt: m.created_at,
    }));

    return {
      quote,
      clinicId: data.clinicId,
      patientId: q.patient_id,
      patientName: pacienteRes.data?.full_name ?? null,
      professionalName,
      plan,
      pagos,
      pagadoCents: pagos.filter((p) => !p.reversedAt).reduce((s, p) => s + p.amountCents, 0),
      eventos: eventos.map((e) => ({
        id: e.id,
        kind: e.kind as EventoDePresupuesto["kind"],
        fromStatus: (e.from_status as QuoteStatus | null) ?? null,
        toStatus: (e.to_status as QuoteStatus | null) ?? null,
        validUntil: e.valid_until,
        note: e.note,
        actorName: e.actor_id ? (nombreActor.get(e.actor_id) ?? "Miembro del equipo") : null,
        sistema: e.actor_id === null,
        createdAt: e.created_at,
      })),
      firmaUrl,
      mensajes,
      seguimiento: {
        lastContactAt: q.last_contact_at ?? null,
        lastContactNote: q.last_contact_note ?? null,
        nextAction: q.next_action ?? null,
        nextActionOn: q.next_action_on ?? null,
        ultimoMensajeAt: mensajes[0]?.createdAt ?? null,
      },
    };
  });

// ─── Seguimiento (UX-16) ────────────────────────────────────────────────────

/**
 * Registra un contacto con el paciente por este presupuesto y/o fija la
 * próxima acción y el profesional a cargo. El historial lo escribe la base.
 * Mismo público que escribe presupuestos (RLS de `quotes`: owner, admin,
 * dentist, reception = `patients:manage`).
 */
export const actualizarSeguimiento = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        quoteId: z.string().uuid(),
        /** true = hubo contacto ahora (llamada, mensaje, visita). */
        contactado: z.boolean().default(false),
        nota: z.string().trim().max(500).optional(),
        proximaAccion: z.string().trim().max(200).nullish(),
        proximaAccionOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.")
          .nullish(),
        /** `undefined` = no se toca; `null` = sin asignar. */
        professionalId: z.string().uuid().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await requireAlgunPermiso(
      supabase,
      data.clinicId,
      userId,
      ["patients:manage"],
      "No tienes permisos para hacer seguimiento de presupuestos.",
    );

    const patch = {
      ...(data.contactado && {
        last_contact_at: new Date().toISOString(),
        last_contact_note: data.nota || null,
      }),
      ...(data.proximaAccion !== undefined && { next_action: data.proximaAccion || null }),
      ...(data.proximaAccionOn !== undefined && { next_action_on: data.proximaAccionOn || null }),
      ...(data.professionalId !== undefined && { professional_id: data.professionalId }),
    };
    if (!Object.keys(patch).length) return { ok: true };

    const { error } = await supabase
      .from("quotes")
      .update(patch)
      .eq("id", data.quoteId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos guardar el seguimiento."));
    return { ok: true };
  });

// ─── Validez por defecto (PLA-06) ───────────────────────────────────────────

export const getConfiguracionPresupuestos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ diasValidez: number }> => {
    const { data: clinica, error } = await context.supabase
      .from("clinics")
      .select("quote_validity_days")
      .eq("id", data.clinicId)
      .maybeSingle();
    // Sin la columna (antes de 20261024200100) o sin fila: el default.
    if (error || !clinica) return { diasValidez: DIAS_VALIDEZ_POR_DEFECTO };
    return { diasValidez: clinica.quote_validity_days ?? DIAS_VALIDEZ_POR_DEFECTO };
  });

/** Cambia los días de validez por defecto. Par de `settings:manage` en la UI. */
export const guardarValidezPorDefecto = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        dias: z.number().int().min(1, "Mínimo 1 día.").max(365, "Máximo 365 días."),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await requireAlgunPermiso(
      supabase,
      data.clinicId,
      userId,
      ["settings:manage"],
      "No tienes permisos para cambiar la configuración de la clínica.",
    );
    const { error } = await supabase
      .from("clinics")
      .update({ quote_validity_days: data.dias })
      .eq("id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No pudimos guardar la validez por defecto."));
    return { ok: true };
  });

/**
 * Profesionales activos para asignar a un presupuesto (editor de la ficha,
 * seguimiento). Liviana a propósito: solo id y nombre, que cualquier miembro
 * puede leer por RLS.
 */
export const listProfesionalesDePresupuesto = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ id: string; nombre: string }[]> => {
    const { data: filas, error } = await context.supabase
      .from("professionals")
      .select("id, full_name")
      .eq("clinic_id", data.clinicId)
      .eq("is_active", true)
      .order("full_name", { ascending: true });
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los profesionales."));
    return (filas ?? []).map((p) => ({ id: p.id, nombre: p.full_name }));
  });
