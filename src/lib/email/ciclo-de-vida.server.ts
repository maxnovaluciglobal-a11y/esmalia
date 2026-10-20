/**
 * Orquestación de los correos de ciclo de vida: a quién, cuándo y con qué
 * datos. Server-only (usa el cliente de servicio).
 *
 * ⚠️ Los destinatarios salen SIEMPRE de `clinic_members` (dueños y
 * administradores). Ningún camino de este archivo lee emails de pacientes.
 *
 * Cada función atrapa sus errores y devuelve un resultado: se llaman desde el
 * alta de la clínica y desde el webhook de Stripe, y un correo nunca puede
 * tumbar ninguno de los dos.
 */
import { permissionsForRole, type ClinicRole } from "@/lib/access/access";
import { TRIAL_DAYS } from "@/lib/billing";
import {
  computeAccountsReceivableAging,
  computePanelDesempeno,
  computeQuoteConversion,
} from "@/lib/finance/finance-reports.compute";
import { tasaDeAusencia, type EstadoCita } from "@/lib/messaging/efectividad";
import { SITE_URL } from "@/lib/seo";

import {
  bajaDisponible,
  firmarTokenDeBaja,
  urlBajaUnClic,
  urlPaginaDeBaja,
} from "./baja-token.server";
import {
  TIMEZONE_POR_DEFECTO,
  avisoDeTrialQueCorresponde,
  claveFinDePruebaStripe,
  correspondeAvisoLlamada,
  contarPresupuestosSinSeguimiento,
  esLunesLocal,
  esVentanaDeCorreos,
  fechaLocal,
  semanaAnterior,
  semanaPrevia,
  semanaTuvoActividad,
  type DatosSemana,
  type Semana,
} from "./ciclo-de-vida";
import { sendClinicEmail, type ResultadoEnvio } from "./envio.server";
import {
  correoBienvenida,
  correoFinDePrueba,
  correoFinDePruebaStripe,
  correoLlamadaPendiente,
  correoPagoFallido,
  correoSemana,
  correoSuscripcionActiva,
} from "./plantillas";

type ClienteAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

async function adminClient(): Promise<ClienteAdmin> {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

/** Tope de correos por corrida del cron, para no pasarse del tiempo de la función. */
export const TOPE_CORREOS_POR_CORRIDA = 150;

const ROLES_CUENTA: ClinicRole[] = ["owner"];
const ROLES_REPORTE: ClinicRole[] = ["owner", "admin"];

function log(msg: string, extra?: unknown) {
  console.warn(`[lifecycle-email] ${msg}`, extra ?? "");
}

/**
 * Espera a una promesa como mucho `ms`. En una función serverless lo que
 * queda corriendo después de responder puede congelarse, así que el
 * "dispara y olvida" del alta y del webhook espera un rato acotado en vez
 * de soltar la promesa al aire. Con el interruptor apagado vuelve al instante.
 */
export async function conTope<T>(promesa: Promise<T>, ms = 6000): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([promesa, limite]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Destinatarios ───────────────────────────────────────────────────────

export interface Destinatario {
  userId: string;
  email: string;
  nombre: string | null;
  role: ClinicRole;
}

async function emailDeUsuario(
  admin: ClienteAdmin,
  userId: string,
): Promise<{ email: string | null; nombre: string | null }> {
  const { data: perfil } = await admin
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (perfil?.email) return { email: perfil.email, nombre: perfil.full_name };
  const { data } = await admin.auth.admin.getUserById(userId);
  return { email: data.user?.email ?? null, nombre: perfil?.full_name ?? null };
}

async function destinatarios(
  admin: ClienteAdmin,
  clinicId: string,
  roles: ClinicRole[],
  exigeFinanzas = false,
): Promise<Destinatario[]> {
  const { data: miembros, error } = await admin
    .from("clinic_members")
    .select("user_id, role")
    .eq("clinic_id", clinicId)
    .in("role", roles);
  if (error) {
    log("no se pudieron leer los miembros", error.message);
    return [];
  }
  const vistos = new Set<string>();
  const out: Destinatario[] = [];
  for (const m of miembros ?? []) {
    const role = m.role as ClinicRole;
    // Mismo criterio que `requireFinanceView`: sin `finance:view`, sin plata.
    if (exigeFinanzas && !permissionsForRole(role).includes("finance:view")) continue;
    const { email, nombre } = await emailDeUsuario(admin, m.user_id);
    const clave = email?.trim().toLowerCase();
    if (!clave || vistos.has(clave)) continue;
    vistos.add(clave);
    out.push({ userId: m.user_id, email: clave, nombre, role });
  }
  return out;
}

interface ClinicaBasica {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  is_demo: boolean;
}

async function clinica(admin: ClienteAdmin, clinicId: string): Promise<ClinicaBasica | null> {
  const { data } = await admin
    .from("clinics")
    .select("id, name, timezone, currency, is_demo")
    .eq("id", clinicId)
    .maybeSingle();
  return data ?? null;
}

// ─── a. Bienvenida ───────────────────────────────────────────────────────

/** Tras `completeClinicSetup`. Solo a quien creó la clínica. */
export async function enviarBienvenida(input: {
  clinicId: string;
  userId: string;
}): Promise<ResultadoEnvio> {
  try {
    if (process.env.LIFECYCLE_EMAILS_ENABLED !== "true") return { status: "disabled" };
    const admin = await adminClient();
    const c = await clinica(admin, input.clinicId);
    if (!c) return { status: "skipped", reason: "clínica no encontrada" };
    const [{ email, nombre }, { data: sub }] = await Promise.all([
      emailDeUsuario(admin, input.userId),
      admin.from("subscriptions").select("trial_end").eq("clinic_id", c.id).maybeSingle(),
    ]);
    if (!email) return { status: "skipped", reason: "usuario sin email" };
    const tz = c.timezone || TIMEZONE_POR_DEFECTO;
    const correo = correoBienvenida({
      appUrl: SITE_URL,
      clinicName: c.name,
      nombre,
      finDePrueba: sub?.trial_end ? fechaLocal(new Date(sub.trial_end), tz) : null,
      diasDePrueba: TRIAL_DAYS,
    });
    return await sendClinicEmail(
      {
        clinicId: c.id,
        kind: "welcome",
        periodKey: "once",
        to: email,
        userId: input.userId,
        ...correo,
      },
      admin,
    );
  } catch (err) {
    log("bienvenida", err instanceof Error ? err.message : err);
    return { status: "error", reason: "bienvenida" };
  }
}

// ─── c. Suscripción activa ───────────────────────────────────────────────

function nombreDelPlan(priceId: string | null): string {
  if (priceId && priceId === process.env.STRIPE_PRICE_ID_SOLO_MONTHLY) return "Solo";
  if (priceId && priceId === process.env.STRIPE_PRICE_ID_CLINIC_MONTHLY) return "Clínica";
  return "Esmalia";
}

/** Una vez por suscripción de Stripe (clave: su id). Solo a los dueños. */
export async function enviarSuscripcionActiva(input: {
  clinicId: string;
  subscriptionId: string;
  priceId: string | null;
  montoCents: number | null;
  currency: string | null;
  intervalo: "mes" | "año" | null;
  proximoCobroIso: string | null;
}): Promise<ResultadoEnvio[]> {
  try {
    if (process.env.LIFECYCLE_EMAILS_ENABLED !== "true") return [{ status: "disabled" }];
    const admin = await adminClient();
    const c = await clinica(admin, input.clinicId);
    if (!c || c.is_demo) return [];
    const tz = c.timezone || TIMEZONE_POR_DEFECTO;
    const resultados: ResultadoEnvio[] = [];
    for (const d of await destinatarios(admin, c.id, ROLES_CUENTA)) {
      const correo = correoSuscripcionActiva({
        appUrl: SITE_URL,
        clinicName: c.name,
        nombre: d.nombre,
        plan: nombreDelPlan(input.priceId),
        montoCents: input.montoCents,
        currency: input.currency,
        intervalo: input.intervalo,
        proximoCobro: input.proximoCobroIso
          ? fechaLocal(new Date(input.proximoCobroIso), tz)
          : null,
      });
      resultados.push(
        await sendClinicEmail(
          {
            clinicId: c.id,
            kind: "subscription_active",
            periodKey: input.subscriptionId,
            to: d.email,
            userId: d.userId,
            ...correo,
          },
          admin,
        ),
      );
    }
    return resultados;
  } catch (err) {
    log("suscripción activa", err instanceof Error ? err.message : err);
    return [{ status: "error", reason: "suscripción activa" }];
  }
}

// ─── b2. Fin de la prueba de Stripe (trial_will_end) ─────────────────────

/**
 * Desde el webhook (`customer.subscription.trial_will_end`). Solo a los
 * dueños, una vez por suscripción y fecha de fin: reusa el kind `trial_t3`
 * (es el mismo aviso, "quedan 3 días") con una clave que no choca con la del
 * trial de la base, que nunca se manda si hay suscripción de Stripe.
 */
export async function enviarFinDePruebaStripe(input: {
  clinicId: string;
  subscriptionId: string;
  trialEndIso: string;
  tieneMedioDePago: boolean;
  priceId: string | null;
  montoCents: number | null;
  currency: string | null;
}): Promise<ResultadoEnvio[]> {
  try {
    if (process.env.LIFECYCLE_EMAILS_ENABLED !== "true") return [{ status: "disabled" }];
    const admin = await adminClient();
    const c = await clinica(admin, input.clinicId);
    if (!c || c.is_demo) return [];
    const tz = c.timezone || TIMEZONE_POR_DEFECTO;
    const finDePrueba = fechaLocal(new Date(input.trialEndIso), tz);
    const resultados: ResultadoEnvio[] = [];
    for (const d of await destinatarios(admin, c.id, ROLES_CUENTA)) {
      const correo = correoFinDePruebaStripe({
        appUrl: SITE_URL,
        clinicName: c.name,
        nombre: d.nombre,
        finDePrueba,
        tieneMedioDePago: input.tieneMedioDePago,
        plan: nombreDelPlan(input.priceId),
        montoCents: input.montoCents,
        currency: input.currency,
      });
      resultados.push(
        await sendClinicEmail(
          {
            clinicId: c.id,
            kind: "trial_t3",
            periodKey: claveFinDePruebaStripe(input.subscriptionId, input.trialEndIso),
            to: d.email,
            userId: d.userId,
            ...correo,
          },
          admin,
        ),
      );
    }
    return resultados;
  } catch (err) {
    log("fin de prueba (Stripe)", err instanceof Error ? err.message : err);
    return [{ status: "error", reason: "fin de prueba (Stripe)" }];
  }
}

// ─── d. Pago fallido ─────────────────────────────────────────────────────

/** Una vez por factura de Stripe (clave: su id). Solo a los dueños. */
export async function enviarPagoFallido(input: {
  clinicId: string;
  invoiceId: string;
  montoCents: number | null;
  currency: string | null;
  proximoIntentoIso: string | null;
}): Promise<ResultadoEnvio[]> {
  try {
    if (process.env.LIFECYCLE_EMAILS_ENABLED !== "true") return [{ status: "disabled" }];
    const admin = await adminClient();
    const c = await clinica(admin, input.clinicId);
    if (!c || c.is_demo) return [];
    const tz = c.timezone || TIMEZONE_POR_DEFECTO;
    const resultados: ResultadoEnvio[] = [];
    for (const d of await destinatarios(admin, c.id, ROLES_CUENTA)) {
      const correo = correoPagoFallido({
        appUrl: SITE_URL,
        clinicName: c.name,
        nombre: d.nombre,
        montoCents: input.montoCents,
        currency: input.currency,
        proximoIntento: input.proximoIntentoIso
          ? fechaLocal(new Date(input.proximoIntentoIso), tz)
          : null,
      });
      resultados.push(
        await sendClinicEmail(
          {
            clinicId: c.id,
            kind: "payment_failed",
            periodKey: input.invoiceId,
            to: d.email,
            userId: d.userId,
            ...correo,
          },
          admin,
        ),
      );
    }
    return resultados;
  } catch (err) {
    log("pago fallido", err instanceof Error ? err.message : err);
    return [{ status: "error", reason: "pago fallido" }];
  }
}

// ─── Cron: a2. llamada pendiente, b. fin de prueba y e. reporte semanal ──

export interface ResumenCorrida {
  habilitado: boolean;
  clinicasRevisadas: number;
  enviados: number;
  omitidos: number;
  errores: number;
  topeAlcanzado: boolean;
}

function contar(resumen: ResumenCorrida, r: ResultadoEnvio) {
  if (r.status === "sent") resumen.enviados += 1;
  else if (r.status === "error") resumen.errores += 1;
  else if (r.status !== "disabled") resumen.omitidos += 1;
}

/**
 * Corre lo que toca en este momento. Pensado para un disparo por hora
 * (GitHub Actions, que no es fiable: ver `esVentanaDeCorreos`): cada
 * clínica actúa solo en su ventana local de 8:00 a 20:59 y la tabla de
 * idempotencia evita repetir dentro de la ventana.
 */
export async function correrCorreosProgramados(
  admin: ClienteAdmin,
  ahora: Date,
  topeClinicas: number,
): Promise<ResumenCorrida> {
  const resumen: ResumenCorrida = {
    habilitado: true,
    clinicasRevisadas: 0,
    enviados: 0,
    omitidos: 0,
    errores: 0,
    topeAlcanzado: false,
  };
  const { data: clinicas, error } = await admin
    .from("clinics")
    .select("id, name, timezone, currency, is_demo, created_at, onboarding_call_at")
    .eq("is_demo", false)
    .limit(topeClinicas);
  if (error) throw new Error(`no se pudieron listar las clínicas: ${error.message}`);

  for (const c of clinicas ?? []) {
    if (resumen.enviados + resumen.errores >= TOPE_CORREOS_POR_CORRIDA) {
      resumen.topeAlcanzado = true;
      break;
    }
    const tz = c.timezone || TIMEZONE_POR_DEFECTO;
    if (!esVentanaDeCorreos(ahora, tz)) continue;
    resumen.clinicasRevisadas += 1;
    try {
      for (const r of await avisoDeLlamadaPendiente(admin, c, ahora)) contar(resumen, r);
      for (const r of await avisoDeFinDePrueba(admin, c, ahora)) contar(resumen, r);
      if (esLunesLocal(ahora, tz)) {
        for (const r of await reporteSemanal(admin, c, ahora)) contar(resumen, r);
      }
    } catch (err) {
      resumen.errores += 1;
      log(`clínica ${c.id}`, err instanceof Error ? err.message : err);
    }
  }
  return resumen;
}

/**
 * Una vez por destinatario (`period_key = 'once'`), a dueños y
 * administradores, cuando `correspondeAvisoLlamada` lo dice: 24 h desde el
 * alta, en prueba, sin llamada y con menos de `DIAS_MAX_AVISO_LLAMADA` días.
 */
async function avisoDeLlamadaPendiente(
  admin: ClienteAdmin,
  c: ClinicaBasica & { created_at: string; onboarding_call_at: string | null },
  ahora: Date,
): Promise<ResultadoEnvio[]> {
  // Filtro barato antes de consultar nada: sin llamada y dentro del plazo
  // (el estado de la suscripción se mira después).
  const candidata = correspondeAvisoLlamada(
    {
      createdAt: c.created_at,
      onboardingCallAt: c.onboarding_call_at,
      subscriptionStatus: "trialing",
      isDemo: c.is_demo,
    },
    ahora,
  );
  if (!candidata) return [];

  const { data: sub } = await admin
    .from("subscriptions")
    .select("status")
    .eq("clinic_id", c.id)
    .maybeSingle();
  const corresponde = correspondeAvisoLlamada(
    {
      createdAt: c.created_at,
      onboardingCallAt: c.onboarding_call_at,
      subscriptionStatus: sub?.status ?? null,
      isDemo: c.is_demo,
    },
    ahora,
  );
  if (!corresponde) return [];

  const lista = await destinatarios(admin, c.id, ROLES_REPORTE);
  if (lista.length === 0) return [];

  // Las corridas siguientes de la semana no reintentan a quien ya lo recibió
  // (el UNIQUE igual lo impediría, pero así no suma "omitidos" cada hora).
  const { data: yaSalieron } = await admin
    .from("lifecycle_emails")
    .select("recipient")
    .eq("clinic_id", c.id)
    .eq("kind", "onboarding_call_pending")
    .eq("period_key", "once")
    .in("status", ["sent", "pending", "skipped"]);
  const listos = new Set((yaSalieron ?? []).map((f) => f.recipient));

  const resultados: ResultadoEnvio[] = [];
  for (const d of lista) {
    if (listos.has(d.email)) continue;
    const correo = correoLlamadaPendiente({
      appUrl: SITE_URL,
      clinicName: c.name,
      nombre: d.nombre,
    });
    resultados.push(
      await sendClinicEmail(
        {
          clinicId: c.id,
          kind: "onboarding_call_pending",
          periodKey: "once",
          to: d.email,
          userId: d.userId,
          ...correo,
        },
        admin,
      ),
    );
  }
  return resultados;
}

async function avisoDeFinDePrueba(
  admin: ClienteAdmin,
  c: ClinicaBasica,
  ahora: Date,
): Promise<ResultadoEnvio[]> {
  const tz = c.timezone || TIMEZONE_POR_DEFECTO;
  const { data: sub } = await admin
    .from("subscriptions")
    .select("status, trial_end, stripe_subscription_id")
    .eq("clinic_id", c.id)
    .maybeSingle();
  if (!sub) return [];
  const aviso = avisoDeTrialQueCorresponde(
    {
      status: sub.status,
      trialEnd: sub.trial_end,
      stripeSubscriptionId: sub.stripe_subscription_id,
    },
    ahora,
    tz,
  );
  if (!aviso) return [];

  const [citas, pacientes] = await Promise.all([
    admin
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", c.id)
      .neq("status", "cancelada"),
    admin.from("patients").select("id", { count: "exact", head: true }).eq("clinic_id", c.id),
  ]);

  const resultados: ResultadoEnvio[] = [];
  for (const d of await destinatarios(admin, c.id, ROLES_CUENTA)) {
    const correo = correoFinDePrueba({
      appUrl: SITE_URL,
      clinicName: c.name,
      nombre: d.nombre,
      cuando: aviso.kind === "trial_t3" ? "t3" : "t0",
      finDePrueba: aviso.fechaFin,
      citasAgendadas: citas.count ?? 0,
      pacientesCargados: pacientes.count ?? 0,
    });
    resultados.push(
      await sendClinicEmail(
        {
          clinicId: c.id,
          kind: aviso.kind,
          periodKey: aviso.fechaFin,
          to: d.email,
          userId: d.userId,
          ...correo,
        },
        admin,
      ),
    );
  }
  return resultados;
}

async function reporteSemanal(
  admin: ClienteAdmin,
  c: ClinicaBasica,
  ahora: Date,
): Promise<ResultadoEnvio[]> {
  const tz = c.timezone || TIMEZONE_POR_DEFECTO;
  const semana = semanaAnterior(ahora, tz);

  if (!bajaDisponible()) {
    log("sin EMAIL_UNSUBSCRIBE_SECRET: el reporte semanal no se envía");
    return [{ status: "skipped", reason: "sin secreto de baja" }];
  }

  const lista = await destinatarios(admin, c.id, ROLES_REPORTE, true);
  if (lista.length === 0) return [];

  // Si ya salió para todos esta semana, las corridas siguientes de la
  // ventana no recalculan nada (la idempotencia por destinatario igual
  // impediría repetir, pero el cálculo cuesta varias consultas).
  const { data: yaSalieron } = await admin
    .from("lifecycle_emails")
    .select("recipient")
    .eq("clinic_id", c.id)
    .eq("kind", "weekly_report")
    .eq("period_key", semana.desde)
    .in("status", ["sent", "pending", "skipped"]);
  const listos = new Set((yaSalieron ?? []).map((f) => f.recipient));
  if (lista.every((d) => listos.has(d.email))) return [];

  const datos = await datosDeLaSemana(admin, c, semana, ahora);
  if (!semanaTuvoActividad(datos)) return [];

  const resultados: ResultadoEnvio[] = [];
  for (const d of lista) {
    const token = await firmarTokenDeBaja(d.userId, "reporte_semanal");
    const correo = correoSemana({
      appUrl: SITE_URL,
      datos,
      bajaUrl: urlPaginaDeBaja(SITE_URL, token),
    });
    resultados.push(
      await sendClinicEmail(
        {
          clinicId: c.id,
          kind: "weekly_report",
          periodKey: semana.desde,
          to: d.email,
          userId: d.userId,
          unsubscribeUrl: urlBajaUnClic(SITE_URL, token),
          ...correo,
        },
        admin,
      ),
    );
  }
  return resultados;
}

/**
 * Junta los números de la semana con las MISMAS funciones que usan Reportes,
 * Finanzas y Morosidad (`finance-reports.compute.ts`) y la de ausencias de
 * Efectividad. El rango se pasa como fechas YYYY-MM-DD, igual que lo hace la
 * pantalla, así que los números coinciden con lo que se ve eligiendo esa
 * misma semana.
 */
export async function datosDeLaSemana(
  admin: ClienteAdmin,
  c: ClinicaBasica,
  semana: Semana,
  ahora: Date,
): Promise<DatosSemana> {
  const previa = semanaPrevia(semana);
  const [
    panel,
    panelPrevio,
    presupuestos,
    morosidad,
    pagosAlgunaVez,
    citasEstados,
    enviados,
    seguimientos,
    conWhatsApp,
  ] = await Promise.all([
    computePanelDesempeno(admin, c.id, semana.desde, semana.hasta),
    computePanelDesempeno(admin, c.id, previa.desde, previa.hasta),
    computeQuoteConversion(admin, c.id, semana.desde, semana.hasta),
    computeAccountsReceivableAging(admin, c.id, ahora.getTime()),
    admin
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", c.id)
      .is("reversed_at", null),
    admin
      .from("appointments")
      .select("status, starts_at")
      .eq("clinic_id", c.id)
      .gte("starts_at", `${previa.desde}T00:00:00.000Z`)
      .lte("starts_at", `${semana.hasta}T23:59:59.999Z`),
    admin
      .from("quotes")
      .select("id, patient_id, sent_at")
      .eq("clinic_id", c.id)
      .eq("status", "sent")
      .not("sent_at", "is", null),
    admin
      .from("messages")
      .select("quote_id, created_at")
      .eq("clinic_id", c.id)
      .eq("template_kind", "quote_follow_up")
      .not("quote_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(3000),
    admin
      .from("patients")
      .select("id")
      .eq("clinic_id", c.id)
      .eq("wa_opt_in", true)
      .is("wa_opt_out_at", null),
  ]);

  // Ausencias: misma función que /efectividad, separando las dos semanas.
  const inicioSemana = Date.parse(`${semana.desde}T00:00:00.000Z`);
  const estados = (citasEstados.data ?? []) as { status: string; starts_at: string }[];
  const medir = (filas: typeof estados) =>
    tasaDeAusencia(
      filas.map((f) => ({
        status: f.status as EstadoCita,
        tuvoRecordatorio: false,
        avisoElPaciente: false,
      })),
    ).numerador;
  const ausencias = medir(estados.filter((f) => Date.parse(f.starts_at) >= inicioSemana));
  const ausenciasPrevias = medir(estados.filter((f) => Date.parse(f.starts_at) < inicioSemana));

  // Seguimientos: el último por presupuesto (vienen ordenados desc).
  const ultimos = new Map<string, string>();
  for (const m of seguimientos.data ?? []) {
    if (m.quote_id && !ultimos.has(m.quote_id)) ultimos.set(m.quote_id, m.created_at);
  }
  // Mismo filtro que la cola de /recordatorios: solo pacientes con WhatsApp
  // habilitado aparecen ahí para recibir el seguimiento.
  const habilitados = new Set((conWhatsApp.data ?? []).map((p) => p.id));
  const sinSeguimiento = contarPresupuestosSinSeguimiento(
    (enviados.data ?? [])
      .filter((q) => habilitados.has(q.patient_id))
      .map((q) => ({ id: q.id, sentAt: q.sent_at })),
    ultimos,
    ahora,
  );

  const deudas90 = morosidad.filter((f) => f.bucket === "90+");
  const huboPagos = (pagosAlgunaVez.count ?? 0) > 0;

  return {
    clinicName: c.name,
    currency: c.currency,
    semana,
    cobradoCents: huboPagos ? panel.recaudacionCents : null,
    cobradoPrevioCents: huboPagos ? panelPrevio.recaudacionCents : null,
    citasAgendadas: panel.citasAgendadas,
    citasAtendidas: panel.citasAtendidas,
    tasaAsistencia: panel.tasaAsistencia,
    ausencias,
    ausenciasPrevias,
    pacientesNuevos: panel.pacientesNuevos,
    presupuestosCreados: presupuestos.created,
    presupuestosAceptados: presupuestos.accepted,
    conversion: presupuestos.conversionRate,
    morosidad90Cents: deudas90.reduce((s, f) => s + f.balanceCents, 0),
    morosidad90Pacientes: deudas90.length,
    presupuestosSinSeguimiento: sinSeguimiento,
  };
}
