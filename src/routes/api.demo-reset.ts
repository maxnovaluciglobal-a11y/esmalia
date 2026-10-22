import { createFileRoute } from "@tanstack/react-router";
import { cronAutorizado } from "@/lib/cron-auth.server";
import { esCuentaDemo } from "@/lib/demo-cuenta";

/**
 * Reset periódico de la clínica demo pública. Disparado por Vercel Cron
 * (ver "crons" en vercel.json) o manualmente con el mismo secret.
 *
 * Corre `reset_demo_clinic()` (migración 20260815190000) via RPC con la
 * service_role key — esa función es SECURITY DEFINER así que sus propios
 * INSERT/UPDATE/DELETE pasan el trigger block_demo_writes sin problema.
 */
export const Route = createFileRoute("/api/demo-reset")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization");
        const secret = process.env.CRON_SECRET;
        if (!secret) {
          return new Response("CRON_SECRET no configurado", { status: 500 });
        }
        if (!cronAutorizado(auth, secret)) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.rpc("reset_demo_clinic");

        if (error) {
          console.error("[demo-reset] failure", error.message);
          return new Response(`reset error: ${error.message}`, { status: 500 });
        }

        // SEG-01: la demo es compartida; un factor MFA inscrito desde la
        // consola le pediría un código ajeno a todos los visitantes. La guarda
        // real es el trigger de la migración 20261019120000; esto limpia en
        // cada reset por si quedó alguno. Un error acá no tumba el reset.
        try {
          await borrarFactoresMfaDeLaDemo(supabaseAdmin);
        } catch (e) {
          console.error("[demo-reset] no se pudieron limpiar los factores MFA", e);
        }

        // La semilla crea los presupuestos "hoy", así que la demo nunca tenía
        // presupuestos sin respuesta que mostrar. Se fechan hacia atrás acá
        // (service role pasa block_demo_writes) en vez de reescribir la
        // función de reset en una migración. Un error no tumba el reset.
        try {
          await fecharPresupuestosDeLaDemo(supabaseAdmin);
        } catch (e) {
          console.error("[demo-reset] no se pudieron fechar los presupuestos", e);
        }

        // PLA-07 crea la cuenta por cobrar cuando un presupuesto PASA a
        // aceptado; la semilla los inserta ya aceptados, así que la demo
        // quedaba sin cuentas. Se crean acá con la misma regla de monto que
        // "Crear cuenta" de la ficha. Un error no tumba el reset.
        try {
          await crearCuentasDeLaDemo(supabaseAdmin);
        } catch (e) {
          console.error("[demo-reset] no se pudieron crear las cuentas por cobrar", e);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});

// Usuario dueño de la clínica demo (mismo id fijo que `reset_demo_clinic`).
const DEMO_USER_ID = "139dd209-8495-415c-b6cd-6bbc63367bad";

type SupabaseAdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

async function borrarFactoresMfaDeLaDemo(supabaseAdmin: SupabaseAdminClient) {
  // Se confirma el email antes de borrar: si el id fijo dejara de ser la
  // demo, no se le tocan los factores a nadie más.
  const { data: usuario } = await supabaseAdmin.auth.admin.getUserById(DEMO_USER_ID);
  if (!esCuentaDemo(usuario?.user?.email)) return;
  const { data } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: DEMO_USER_ID });
  for (const factor of data?.factors ?? []) {
    await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId: DEMO_USER_ID, id: factor.id });
  }
}

/** Benjamín (enviado hace 9 días) e Isidora (borrador de hace 12): los dos sin respuesta. */
const PRESUPUESTOS_DEMO_SIN_RESPUESTA = [
  { number: "DEMO-0003", dias: 9, enviado: true },
  { number: "DEMO-0004", dias: 12, enviado: false },
] as const;

async function fecharPresupuestosDeLaDemo(supabaseAdmin: SupabaseAdminClient) {
  const { data: clinica } = await supabaseAdmin
    .from("clinics")
    .select("id")
    .eq("is_demo", true)
    .limit(1)
    .maybeSingle();
  if (!clinica) return;
  for (const p of PRESUPUESTOS_DEMO_SIN_RESPUESTA) {
    const fecha = new Date(Date.now() - p.dias * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin
      .from("quotes")
      .update(p.enviado ? { created_at: fecha, sent_at: fecha } : { created_at: fecha })
      .eq("clinic_id", clinica.id)
      .eq("number", p.number);
    if (error) throw new Error(error.message);
  }
}

/** Una cuenta por cobrar por cada plan vigente de la demo; la primera, vencida. */
async function crearCuentasDeLaDemo(supabaseAdmin: SupabaseAdminClient) {
  const { data: clinica } = await supabaseAdmin
    .from("clinics")
    .select("id")
    .eq("is_demo", true)
    .limit(1)
    .maybeSingle();
  if (!clinica) return;

  const [{ data: planes, error: errPlanes }, { data: existentes, error: errCuentas }] =
    await Promise.all([
      supabaseAdmin
        .from("treatment_plans")
        .select("id, patient_id, name, status, created_at")
        .eq("clinic_id", clinica.id)
        .neq("status", "cancelled")
        .order("created_at"),
      supabaseAdmin
        .from("receivables")
        .select("treatment_plan_id")
        .eq("clinic_id", clinica.id)
        .not("treatment_plan_id", "is", null),
    ]);
  if (errPlanes) throw new Error(errPlanes.message);
  if (errCuentas) throw new Error(errCuentas.message);
  const conCuenta = new Set((existentes ?? []).map((c) => c.treatment_plan_id));
  const pendientes = (planes ?? []).filter((p) => !conCuenta.has(p.id));
  if (pendientes.length === 0) return;

  const { data: items, error: errItems } = await supabaseAdmin
    .from("treatment_items")
    .select("plan_id, price_cents, patient_cents")
    .eq("clinic_id", clinica.id)
    .in(
      "plan_id",
      pendientes.map((p) => p.id),
    );
  if (errItems) throw new Error(errItems.message);
  const montoPorPlan = new Map<string, number>();
  for (const it of items ?? []) {
    // `??`: con convenio, `patient_cents` = 0 es real (regla 12).
    const monto = it.patient_cents ?? it.price_cents;
    montoPorPlan.set(it.plan_id, (montoPorPlan.get(it.plan_id) ?? 0) + monto);
  }

  const dia = (offset: number) =>
    new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const filas = pendientes
    .filter((p) => (montoPorPlan.get(p.id) ?? 0) > 0)
    .map((p, i) => ({
      clinic_id: clinica.id,
      patient_id: p.patient_id,
      treatment_plan_id: p.id,
      description: p.name.slice(0, 200),
      amount_cents: montoPorPlan.get(p.id) ?? 0,
      issued_on: i === 0 ? dia(-40) : dia(-10),
      due_on: i === 0 ? dia(-10) : dia(20),
    }));
  if (filas.length === 0) return;
  const { error } = await supabaseAdmin.from("receivables").insert(filas);
  if (error) throw new Error(error.message);
}
