import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { esSuscripcionViva } from "@/lib/checkout-suscripcion.server";
import { isUndefinedColumnError } from "@/lib/db-errors";

/**
 * Núcleo del webhook de Stripe (`/api/stripe/webhook`), separado de la ruta
 * para poder testearlo con dependencias falsas (auditoría 360, 18-oct-2026:
 * COD-02 y FN-01).
 *
 * Tres reglas que no se negocian:
 *
 * 1. **El modo del evento tiene que coincidir con el de la clave.** En prod
 *    llegaron eventos `livemode=false` (de la cuenta de pruebas) mezclados con
 *    los reales: un `checkout.session.completed` de prueba podía activar o
 *    cancelar la suscripción de una clínica real. Si no coinciden → se ignora
 *    (200, log y Sentry) sin procesar ni marcar.
 * 1b. **Estado actual, no el del evento.** Los eventos llegan repetidos y
 *    fuera de orden: se re-consulta la suscripción en Stripe y se guarda lo
 *    que diga ahora.
 * 2. **supabase-js nunca lanza**: devuelve `{ error }`. Cada lectura y
 *    escritura se revisa; si algo falla se reporta y se responde 500 SIN
 *    insertar en `stripe_events`, para que Stripe reintente. Antes el flujo
 *    seguía, marcaba el evento y respondía 200: un cobro podía quedar sin
 *    registrar sin que nadie se enterara.
 * 3. **Idempotencia por `event.id`**: si ya está en `stripe_events`, 200 sin
 *    reprocesar. Todo lo que hace cada caso es idempotente (upsert por
 *    clínica, update a un estado fijo), así que un reintento tras un 500 es
 *    seguro.
 */

export type AdminClient = SupabaseClient<Database>;

export interface StripeWebhookDeps {
  stripe: {
    webhooks: Pick<Stripe["webhooks"], "constructEvent">;
    subscriptions: Pick<Stripe["subscriptions"], "retrieve" | "list" | "cancel">;
    charges: Pick<Stripe["charges"], "retrieve">;
    /** Cobro → factura → suscripción (reembolso total y disputa perdida). */
    invoicePayments: Pick<Stripe["invoicePayments"], "list">;
  };
  admin: AdminClient;
  webhookSecret: string;
  /** `STRIPE_SECRET_KEY`: define si este deploy es live o test. */
  secretKey: string;
  reportarError: (err: unknown, contexto: { ruta: string; metodo?: string }) => Promise<void>;
  /** Correos. Ninguno lanza: un correo no puede hacer que Stripe reintente. */
  avisos: {
    suscripcionActiva: (clinicId: string, sub: Stripe.Subscription) => Promise<void>;
    pagoFallido: (clinicId: string, invoiceId: string, invoice: Stripe.Invoice) => Promise<void>;
    /** `trial_will_end`: correo a la clínica 3 días antes (idempotente por suscripción y fecha). */
    finDePrueba: (clinicId: string, sub: Stripe.Subscription) => Promise<void>;
    /** Aviso al equipo de Esmalia (`ESMALIA_STAFF_EMAILS`). `clave` = idempotencia. */
    staff: (aviso: AvisoStaff) => Promise<void>;
  };
  /** Telemetría del embudo. Nunca lanza. */
  medicion: {
    suscripcionActivada: (clinicId: string, sub: Stripe.Subscription) => Promise<void>;
  };
}

export interface AvisoStaff {
  asunto: string;
  lineas: string[];
  /** Clave de idempotencia del envío (el mismo hecho no avisa dos veces). */
  clave: string;
  clinicId: string | null;
}

const RUTA = "/api/stripe/webhook";

/** Error de escritura/lectura en la base: el evento NO se marca y Stripe reintenta. */
export class ErrorDeBaseEnWebhook extends Error {
  constructor(operacion: string, causa: { message?: string } | null) {
    super(`${operacion}: ${causa?.message ?? "error desconocido"}`);
    this.name = "ErrorDeBaseEnWebhook";
  }
}

/** `sk_live_…` o `rk_live_…` (clave restringida) ⇒ el deploy procesa eventos live. */
export function esClaveLive(secretKey: string): boolean {
  return secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
}

// Auditoría de código 01-sep-2026: con apiVersion "2026-07-29.dahlia" (ver
// stripe.server.ts) Stripe ya no manda `current_period_end` en el objeto
// Subscription top-level — se movió a cada subscription item. Un solo item
// por sub (modelo v1, sin per-seat/add-ons).
export function extractCurrentPeriodEndIso(sub: Stripe.Subscription): string | null {
  const ts = sub.items.data[0]?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

async function upsertSubscription(admin: AdminClient, clinicId: string, sub: Stripe.Subscription) {
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const { error } = await admin.from("subscriptions").upsert(
    {
      clinic_id: clinicId,
      stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      status: sub.status,
      trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      current_period_end: extractCurrentPeriodEndIso(sub),
      cancel_at_period_end: sub.cancel_at_period_end,
    },
    { onConflict: "clinic_id" },
  );
  if (error) throw new ErrorDeBaseEnWebhook("upsert subscriptions", error);
}

async function clinicaPorCustomer(admin: AdminClient, customerId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("clinic_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw new ErrorDeBaseEnWebhook("buscar clínica por customer", error);
  return data?.clinic_id ?? null;
}

async function filaPorCustomer(
  admin: AdminClient,
  customerId: string,
): Promise<{ clinic_id: string; stripe_subscription_id: string | null } | null> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("clinic_id, stripe_subscription_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw new ErrorDeBaseEnWebhook("buscar suscripción por customer", error);
  return data ?? null;
}

/** id de la suscripción de una factura (API dahlia: `parent.subscription_details`). */
function suscripcionDeLaFactura(invoice: Stripe.Invoice): string | null {
  const ref = invoice.parent?.subscription_details?.subscription ?? null;
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

/**
 * ¿Hay con qué cobrar al terminar el trial? Tarjeta de la suscripción o, si
 * no tiene, la predeterminada del customer.
 */
export function tieneMedioDePago(
  sub: Pick<Stripe.Subscription, "default_payment_method" | "default_source">,
  customer?: { invoice_settings?: { default_payment_method?: unknown } | null } | null,
): boolean {
  if (sub.default_payment_method || sub.default_source) return true;
  return Boolean(customer?.invoice_settings?.default_payment_method);
}

/**
 * Otras suscripciones vivas de la clínica, además de `nueva` (BIL-03). Si la
 * nueva no está viva, no hay duplicado que avisar.
 */
export function otrasSuscripcionesVivas(
  nueva: { id: string; status: string },
  otras: ReadonlyArray<{ id: string; status: string }>,
): Array<{ id: string; status: string }> {
  if (!esSuscripcionViva(nueva.status)) return [];
  const vistas = new Set<string>();
  return otras.filter((o) => {
    if (o.id === nueva.id || vistas.has(o.id) || !esSuscripcionViva(o.status)) return false;
    vistas.add(o.id);
    return true;
  });
}

function idDelCustomer(c: string | { id: string } | null | undefined): string | null {
  if (!c) return null;
  return typeof c === "string" ? c : c.id;
}

/**
 * BIL-03: si la clínica queda con dos suscripciones vivas (dos checkouts, un
 * webhook perdido), avisa al staff. NO cancela nada: cuál se queda y si hay
 * que reembolsar lo decide una persona. Se llama ANTES del upsert, que pisa
 * `stripe_subscription_id` con la nueva. Es un aviso: si Stripe o la base
 * fallan acá, se reporta y el webhook sigue.
 */
async function avisarSiHayOtraSuscripcionViva(
  deps: StripeWebhookDeps,
  clinicId: string,
  nueva: Stripe.Subscription,
): Promise<void> {
  try {
    if (!esSuscripcionViva(nueva.status)) return;
    const { data: fila, error } = await deps.admin
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (error) throw new ErrorDeBaseEnWebhook("leer suscripción local", error);

    const otras: Array<{ id: string; status: string }> = [];
    const customerId = idDelCustomer(nueva.customer);
    if (customerId) {
      const lista = await deps.stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      for (const s of lista.data) otras.push({ id: s.id, status: s.status });
    }
    const local = fila?.stripe_subscription_id ?? null;
    if (local && local !== nueva.id && !otras.some((o) => o.id === local)) {
      // Webhook perdido: la anterior puede estar en otro customer.
      const anterior = await deps.stripe.subscriptions.retrieve(local);
      otras.push({ id: anterior.id, status: anterior.status });
    }

    const vivas = otrasSuscripcionesVivas(nueva, otras);
    if (vivas.length === 0) return;
    const ids = [nueva.id, ...vivas.map((v) => v.id)].sort();
    await deps.avisos.staff({
      asunto: "Clínica con dos suscripciones vivas en Stripe",
      clinicId,
      clave: `suscripcion-duplicada-${clinicId}-${ids.join("-")}`,
      lineas: [
        `Suscripción nueva: ${nueva.id} (${nueva.status}).`,
        ...vivas.map((v) => `Otra suscripción viva: ${v.id} (${v.status}).`),
        "Puede haber un doble cobro. No se canceló nada automáticamente: revisa en Stripe cuál se queda y si corresponde reembolsar.",
        "Esmalia guarda solo la nueva en la fila de la clínica.",
      ],
    });
  } catch (err) {
    await deps.reportarError(err, { ruta: `${RUTA} suscripcion-duplicada`, metodo: "POST" });
  }
}

/** La medición nunca debe poder cortar el webhook. */
async function medirActivacion(
  deps: StripeWebhookDeps,
  clinicId: string,
  sub: Stripe.Subscription,
) {
  if (sub.status !== "active" && sub.status !== "trialing") return;
  try {
    await deps.medicion.suscripcionActivada(clinicId, sub);
  } catch (err) {
    console.warn("[stripe webhook] medición", err instanceof Error ? err.message : err);
  }
}

/**
 * Marca (o desmarca) la disputa en la fila de la clínica. Si la migración
 * 20261019210000 todavía no está aplicada, la columna no existe: se reporta y
 * se sigue, porque el aviso al staff es lo que importa y un 500 haría que
 * Stripe reintentara durante días sin que la columna aparezca.
 */
async function escribirMarcaDeDisputa(
  deps: StripeWebhookDeps,
  clinicId: string,
  cambios: { disputed_at: string | null; dispute_id: string | null },
  soloSiDisputa?: string,
) {
  let q = deps.admin.from("subscriptions").update(cambios).eq("clinic_id", clinicId);
  if (soloSiDisputa) q = q.eq("dispute_id", soloSiDisputa);
  const { error } = await q;
  if (!error) return;
  if (isUndefinedColumnError(error)) {
    await deps.reportarError(
      new Error(
        `Marca de disputa sin columna (migración 20261019210000 pendiente): ${error.message}`,
      ),
      { ruta: `${RUTA} disputa`, metodo: "POST" },
    );
    return;
  }
  throw new ErrorDeBaseEnWebhook("marcar disputa en subscriptions", error);
}

/** Estados de los que una suscripción ya no vuelve: no hay nada que cancelar. */
const ESTADOS_TERMINALES: ReadonlySet<string> = new Set(["canceled", "incomplete_expired"]);

export type HechoDeCancelacion = {
  motivo: "reembolso-total" | "disputa-perdida";
  /** id del cobro (reembolso) o de la disputa: deriva la clave de idempotencia. */
  referencia: string;
};

/**
 * Suscripción a la que pertenece un cobro: payment_intent → factura (API
 * InvoicePayments, porque con la versión dahlia ni el Charge ni el
 * PaymentIntent traen la factura) → `parent.subscription_details`. `null` si
 * el cobro no salió de una factura de suscripción.
 */
async function suscripcionDelCobro(
  deps: StripeWebhookDeps,
  charge: Pick<Stripe.Charge, "payment_intent">,
): Promise<string | null> {
  const pi = charge.payment_intent;
  const piId = typeof pi === "string" ? pi : (pi?.id ?? null);
  if (!piId) return null;
  try {
    const pagos = await deps.stripe.invoicePayments.list({
      payment: { type: "payment_intent", payment_intent: piId },
      expand: ["data.invoice"],
      limit: 1,
    });
    const factura = pagos.data[0]?.invoice;
    if (!factura || typeof factura === "string" || factura.deleted) return null;
    return suscripcionDeLaFactura(factura);
  } catch (err) {
    // Sin permiso en la clave restringida o Stripe caído en esta lectura: se
    // usa la suscripción de la fila y el aviso al staff pide confirmarla. Un
    // 500 acá haría que Stripe reintentara días sin que nada cambie.
    await deps.reportarError(err, { ruta: `${RUTA} suscripcion-del-cobro`, metodo: "POST" });
    return null;
  }
}

/**
 * Reembolso total o disputa perdida (BIL-02): cancela la suscripción EN STRIPE,
 * no solo en la base. Antes se escribía `canceled` en la fila local, Stripe
 * seguía cobrando el mes siguiente y el próximo `subscription.updated` volvía
 * a pisar la fila con `active`.
 *
 * Idempotente por tres lados: (1) si la suscripción ya está en un estado
 * terminal no se llama a `cancel`; (2) la llamada lleva una clave de
 * idempotencia derivada del hecho (motivo + id del cobro o de la disputa), así
 * que un reintento tras un 500 o dos entregas concurrentes reciben la misma
 * respuesta; (3) el aviso al staff deduplica por la misma clave.
 *
 * Cancela de inmediato y sin prorrateo: el dinero ya se devolvió (o lo
 * devolvió el banco), no hay crédito que generar. La fila local se actualiza
 * con lo que devuelve Stripe, y solo si es la suscripción de la fila: si el
 * cobro era de otra (una duplicada de BIL-03), la fila no se toca. Si Stripe
 * o la base fallan, lanza: el webhook responde 500 y Stripe reintenta.
 *
 * El acceso no cambia de regla: `canceled` pausa los informes y nunca
 * bloquea agenda, pacientes ni ficha (`accesoPorSuscripcion`).
 */
export async function cancelarSuscripcionEnStripe(
  deps: StripeWebhookDeps,
  fila: { clinic_id: string; stripe_subscription_id: string | null },
  subId: string,
  hecho: HechoDeCancelacion,
): Promise<{ cancelada: boolean; estadoPrevio: string }> {
  const esLaDeLaFila = fila.stripe_subscription_id === subId;
  const actual = await deps.stripe.subscriptions.retrieve(subId);
  if (ESTADOS_TERMINALES.has(actual.status)) {
    if (esLaDeLaFila) await upsertSubscription(deps.admin, fila.clinic_id, actual);
    return { cancelada: false, estadoPrevio: actual.status };
  }
  const cancelada = await deps.stripe.subscriptions.cancel(
    subId,
    {
      invoice_now: false,
      prorate: false,
      cancellation_details: { comment: `Esmalia: ${hecho.motivo} (${hecho.referencia}).` },
    },
    { idempotencyKey: `cancelar-${hecho.motivo}-${hecho.referencia}` },
  );
  if (esLaDeLaFila) await upsertSubscription(deps.admin, fila.clinic_id, cancelada);
  return { cancelada: true, estadoPrevio: actual.status };
}

/**
 * Cancela en Stripe la suscripción de un cobro reembolsado o perdido en
 * disputa y avisa al staff en todos los casos (también cuando no hubo nada
 * que cancelar, para revisar a mano). Devuelve la clínica, o null.
 */
async function cancelarPorCobro(
  deps: StripeWebhookDeps,
  customerId: string,
  charge: Pick<Stripe.Charge, "payment_intent">,
  hecho: HechoDeCancelacion,
  contexto: string[],
): Promise<string | null> {
  const fila = await filaPorCustomer(deps.admin, customerId);
  const titulo = hecho.motivo === "reembolso-total" ? "Reembolso total" : "Disputa perdida";
  // La del cobro manda; la de la fila es el respaldo (cobro sin factura o
  // con la factura ya borrada).
  const delCobro = await suscripcionDelCobro(deps, charge);
  const subId = delCobro ?? fila?.stripe_subscription_id ?? null;

  let asunto: string;
  const lineas = [...contexto];
  if (fila && subId) {
    const r = await cancelarSuscripcionEnStripe(deps, fila, subId, hecho);
    if (r.cancelada) {
      asunto = `${titulo}: suscripción cancelada en Stripe`;
      lineas.push(
        `Se canceló la suscripción ${subId} en Stripe (estaba ${r.estadoPrevio}), de inmediato y sin prorrateo.`,
        "La clínica conserva agenda, pacientes y ficha; los informes quedan pausados.",
      );
    } else {
      asunto = `${titulo}: la suscripción ya estaba cancelada`;
      lineas.push(
        `La suscripción ${subId} ya estaba ${r.estadoPrevio}: no hubo que cancelar nada.`,
      );
    }
    if (!delCobro) {
      lineas.push(
        "No se pudo leer la suscripción desde la factura del cobro: se usó la de la fila de la clínica. Confirmar en Stripe que era esa.",
      );
    } else if (fila.stripe_subscription_id && fila.stripe_subscription_id !== subId) {
      lineas.push(
        `Ojo: la fila de la clínica apunta a otra suscripción (${fila.stripe_subscription_id}), que sigue viva y no se tocó.`,
      );
    }
  } else {
    asunto = `${titulo}: revisar a mano`;
    lineas.push(
      fila
        ? "La clínica no tiene suscripción de Stripe asociada: no se canceló nada."
        : "No se encontró la clínica de este customer: no se canceló nada.",
    );
  }

  await deps.avisos.staff({
    asunto,
    clinicId: fila?.clinic_id ?? null,
    clave: `cancelar-${hecho.motivo}-${hecho.referencia}`,
    lineas,
  });
  return fila?.clinic_id ?? null;
}

/** Fecha `YYYY-MM-DD` (UTC) de un timestamp de Stripe, para el aviso al staff. */
function fechaDeStripe(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "sin dato";
}

/** Aplica el evento. Devuelve la clínica afectada (para `stripe_events`). */
async function aplicarEvento(event: Stripe.Event, deps: StripeWebhookDeps): Promise<string | null> {
  const { admin, stripe, avisos } = deps;
  let clinicId: string | null = null;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      clinicId =
        (session.metadata?.clinic_id as string | undefined) ?? session.client_reference_id ?? null;
      if (clinicId && session.subscription) {
        const subId =
          typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        const sub = await stripe.subscriptions.retrieve(subId);
        await avisarSiHayOtraSuscripcionViva(deps, clinicId, sub);
        await upsertSubscription(admin, clinicId, sub);
        // Con trial, el checkout deja la suscripción en `trialing`: el
        // correo sale cuando pase a `active` (subscription.updated).
        if (sub.status === "active") await avisos.suscripcionActiva(clinicId, sub);
        // Medición: una vez por suscripción (dedupe con la vuelta del checkout).
        await medirActivacion(deps, clinicId, sub);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const delEvento = event.data.object as Stripe.Subscription;
      clinicId = (delEvento.metadata?.clinic_id as string | undefined) ?? null;
      if (!clinicId && typeof delEvento.customer === "string") {
        clinicId = await clinicaPorCustomer(admin, delEvento.customer);
      }
      if (clinicId) {
        // Fuera de orden: los eventos pueden llegar tarde o repetidos (un
        // `updated` viejo después de uno nuevo). Se guarda el estado ACTUAL
        // de Stripe, nunca la foto que trae el evento.
        const sub = await stripe.subscriptions.retrieve(delEvento.id);
        const esAlta = event.type === "customer.subscription.created";
        if (esAlta) await avisarSiHayOtraSuscripcionViva(deps, clinicId, sub);
        await upsertSubscription(admin, clinicId, sub);
        // Solo en el alta: medir en cada `updated` contaría como "activada"
        // una suscripción vieja la primera vez que se renueve.
        if (esAlta) await medirActivacion(deps, clinicId, sub);
        const previo = (event.data as { previous_attributes?: Partial<Stripe.Subscription> })
          .previous_attributes?.status;
        const recienActiva =
          sub.status === "active" &&
          delEvento.status === "active" &&
          (event.type === "customer.subscription.created" ||
            (event.type === "customer.subscription.updated" &&
              previo !== undefined &&
              previo !== "active"));
        if (recienActiva) await avisos.suscripcionActiva(clinicId, sub);
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (customerId) {
        const fila = await filaPorCustomer(admin, customerId);
        clinicId = fila?.clinic_id ?? null;
        const subId = suscripcionDeLaFactura(invoice) ?? fila?.stripe_subscription_id ?? null;
        if (clinicId && subId) {
          // Antes se escribía `past_due` fijo: un reintento tardío de este
          // evento, llegado después de que el cliente pagó, lo volvía a
          // marcar moroso (y reiniciaba `past_due_since`). Se guarda el
          // estado actual de Stripe; el trigger conserva `past_due_since`
          // mientras siga en past_due.
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscription(admin, clinicId, sub);
          // Correo "No pudimos cobrar": solo si sigue impaga. Nunca lanza.
          if (invoice.id && (sub.status === "past_due" || sub.status === "unpaid")) {
            await avisos.pagoFallido(clinicId, invoice.id, invoice);
          }
        }
      }
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      // `refunded` es true solo cuando el charge quedó reembolsado por
      // completo — un reembolso parcial no toca la suscripción.
      if (charge.refunded) {
        const customerId = idDelCustomer(charge.customer);
        if (customerId) {
          clinicId = await cancelarPorCobro(
            deps,
            customerId,
            charge,
            { motivo: "reembolso-total", referencia: charge.id },
            [
              `Cobro ${charge.id} reembolsado por completo (customer ${customerId}).`,
              `Monto: ${charge.amount_refunded} en unidad mínima de ${charge.currency.toUpperCase()}.`,
            ],
          );
        }
      }
      break;
    }
    case "customer.subscription.trial_will_end": {
      // Stripe lo manda 3 días antes de que termine el trial de una
      // suscripción suya (el trial de la base sin checkout lo cubre el cron
      // de correos). Se re-consulta: si ya no está en trial (pagó antes,
      // canceló), no hay nada que avisar.
      const delEvento = event.data.object as Stripe.Subscription;
      clinicId = (delEvento.metadata?.clinic_id as string | undefined) ?? null;
      const customerId = idDelCustomer(delEvento.customer);
      if (!clinicId && customerId) clinicId = await clinicaPorCustomer(admin, customerId);
      if (clinicId) {
        const sub = await stripe.subscriptions.retrieve(delEvento.id);
        await upsertSubscription(admin, clinicId, sub);
        if (sub.status === "trialing" && sub.trial_end) await avisos.finDePrueba(clinicId, sub);
      }
      break;
    }
    case "charge.dispute.created": {
      // BIL-01 (4) y BIL-02: antes se escribía `canceled` en la fila, que no
      // cancelaba nada en Stripe, pausaba los informes y el siguiente
      // `subscription.updated` volvía a pisar. Ahora: marca para revisión
      // manual + aviso al staff con la fecha límite de evidencia. El acceso
      // de la clínica no cambia (ni la ficha ni nada).
      //
      // DECISIÓN PENDIENTE (Walter): NO se pausa el cobro mientras la
      // disputa está abierta. BIL-02 recomienda `pause_collection`, pero
      // pausar es una decisión comercial (¿se le sigue cobrando a quien
      // disputa?), y una suscripción pausada no se reanuda sola. Hoy: la
      // marca + el aviso, y si la disputa se pierde, `dispute.closed` cancela
      // la suscripción en Stripe. Ver docs/STRIPE_SETUP.md.
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
      const disputedCharge = await stripe.charges.retrieve(chargeId);
      const customerId = idDelCustomer(disputedCharge.customer);
      if (customerId) clinicId = await clinicaPorCustomer(admin, customerId);
      if (clinicId) {
        await escribirMarcaDeDisputa(deps, clinicId, {
          disputed_at: new Date(event.created * 1000).toISOString(),
          dispute_id: dispute.id,
        });
      }
      await avisos.staff({
        asunto: "Disputa abierta en Stripe",
        clinicId,
        clave: `disputa-abierta-${dispute.id}`,
        lineas: [
          `Disputa ${dispute.id} sobre el cobro ${chargeId}${customerId ? ` (customer ${customerId})` : ""}.`,
          `Monto: ${dispute.amount} en unidad mínima de ${dispute.currency.toUpperCase()}. Motivo: ${dispute.reason}.`,
          `Fecha límite para mandar evidencia: ${fechaDeStripe(dispute.evidence_details?.due_by)}.`,
          clinicId
            ? "La suscripción quedó marcada para revisión. El acceso de la clínica no se tocó."
            : "No se encontró la clínica de este customer: revisar a mano.",
          `https://dashboard.stripe.com/${event.livemode ? "" : "test/"}disputes/${dispute.id}`,
        ],
      });
      break;
    }
    case "charge.dispute.closed": {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
      const disputedCharge = await stripe.charges.retrieve(chargeId);
      const customerId = idDelCustomer(disputedCharge.customer);
      if (customerId) clinicId = await clinicaPorCustomer(admin, customerId);
      if (clinicId) {
        // Solo si la marca es de ESTA disputa (podría haber una más nueva).
        await escribirMarcaDeDisputa(
          deps,
          clinicId,
          { disputed_at: null, dispute_id: null },
          dispute.id,
        );
      }
      if (dispute.status === "lost" && customerId) {
        // Disputa perdida (BIL-02): el banco devolvió el dinero. Se cancela la
        // suscripción en Stripe para que no vuelva a cobrar; el aviso al
        // staff sale aparte (clave propia) además del de cierre.
        await cancelarPorCobro(
          deps,
          customerId,
          disputedCharge,
          { motivo: "disputa-perdida", referencia: dispute.id },
          [`Disputa ${dispute.id} sobre el cobro ${chargeId} cerrada como perdida.`],
        );
      }
      await avisos.staff({
        asunto: `Disputa cerrada en Stripe (${dispute.status})`,
        clinicId,
        clave: `disputa-cerrada-${dispute.id}`,
        lineas: [
          `Disputa ${dispute.id} sobre el cobro ${chargeId}: ${dispute.status}.`,
          "Se quitó la marca de revisión de la suscripción.",
          `https://dashboard.stripe.com/${event.livemode ? "" : "test/"}disputes/${dispute.id}`,
        ],
      });
      break;
    }
    default:
      // Registramos y salimos — no procesamos eventos que no configuramos.
      break;
  }
  return clinicId;
}

/** Código de Postgres para unique_violation. */
const UNIQUE_VIOLATION = "23505";

export async function procesarWebhookStripe(
  input: { rawBody: string; signature: string | null },
  deps: StripeWebhookDeps,
): Promise<Response> {
  if (!input.signature) return new Response("missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = deps.stripe.webhooks.constructEvent(input.rawBody, input.signature, deps.webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid signature";
    return new Response(`webhook error: ${msg}`, { status: 400 });
  }

  // FN-01: un evento de modo prueba nunca toca datos de un deploy live (ni al revés).
  const deployLive = esClaveLive(deps.secretKey);
  if (event.livemode !== deployLive) {
    const detalle = JSON.stringify({
      id: event.id,
      type: event.type,
      eventoLive: event.livemode,
      deployLive,
    });
    console.warn("[stripe webhook] evento ignorado por modo", detalle);
    await deps.reportarError(new Error(`Stripe webhook: evento de otro modo ignorado ${detalle}`), {
      ruta: `${RUTA} livemode`,
      metodo: "POST",
    });
    // 200 y no 400: es un error de configuración (clave y endpoint en modos
    // distintos), no algo que un reintento arregle. Con 4xx Stripe reintenta
    // durante días y puede desactivar el endpoint. Se ignora sin tocar la base.
    return new Response("ignored (livemode mismatch)", { status: 200 });
  }

  const { admin } = deps;
  try {
    // Idempotencia
    const { data: exists, error: dupError } = await admin
      .from("stripe_events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle();
    if (dupError) throw new ErrorDeBaseEnWebhook("leer stripe_events", dupError);
    if (exists) return new Response("ok (dup)", { status: 200 });

    const clinicId = await aplicarEvento(event, deps);

    // Marcar procesado. Recién acá: si algo de arriba falló, no se llega.
    const { error: markError } = await admin.from("stripe_events").insert({
      id: event.id,
      type: event.type,
      clinic_id: clinicId,
      raw: event as unknown as Json,
    });
    // Otra entrega concurrente del mismo evento ganó la carrera: ya está
    // procesado (y lo que hicimos es idempotente), así que es un éxito.
    if (markError && markError.code !== UNIQUE_VIOLATION) {
      throw new ErrorDeBaseEnWebhook("insertar stripe_events", markError);
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stripe webhook] failure", event.type, event.id, msg);
    await deps.reportarError(err, { ruta: `${RUTA} ${event.type}`, metodo: "POST" });
    // Sin insertar en stripe_events → Stripe reintenta.
    return new Response("processing error", { status: 500 });
  }
}
