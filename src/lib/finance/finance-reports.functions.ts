import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tienePermisoEnClinica } from "@/lib/access/permisos-en-clinica";
import { informesBloqueados } from "@/lib/billing";
import { mapSubscription, SUBSCRIPTION_SELECT } from "@/lib/billing.functions";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountsReceivableAgingRow } from "@/lib/finance/finance";
import {
  computeAccountsReceivableAging,
  computeFinanceSummary,
  computePanelDesempeno,
  computeQuoteConversion,
  type FinanceSummary,
  type PanelDesempeno,
  type QuoteConversionReport,
} from "@/lib/finance/finance-reports.compute";

/** Mismo mensaje para el rechazo por rol y por trial vencido — regla de la
 * casa: "Error 'No tienes permisos' genérico cuando error viene de policy,
 * no filtrar el motivo". Si acá dijera algo distinto para cada caso, un
 * cliente (o alguien mirando la Network tab) podría deducir el estado de
 * facturación de la clínica a partir del texto del error. */
const SIN_PERMISOS_FINANZAS = "No tienes permisos para ver los reportes financieros.";

/**
 * security-review 01-sep: `treatment_items_select_members`/`payments_select_finance_roles`
 * dejan leer a cualquier miembro de la clínica (incluida `reception`, que no
 * tiene `finance:view`) — RLS por sí sola no alcanza acá. Mismo criterio que
 * ya usa `getCommissionReport` para el mismo tipo de gap. A diferencia de
 * comisiones (que sí tiene sentido acotar a "lo propio"), un reporte de caja
 * no tiene una versión "propia" con sentido para un rol sin `finance:view` —
 * la respuesta correcta es negar, no degradar en silencio.
 *
 * Solo el chequeo de ROL — sin trial. Existe separada de `requireFinanceView`
 * para `getAppointmentPatientBalances` (Task 11, fix round 1): ese endpoint
 * exige el mismo rol `finance:view` pero es operación diaria de agenda, no un
 * "informe", así que el trial vencido NO tiene que bloquearlo (ver ruling del
 * reviewer — Important #3: mostrar saldo `undefined` ahí se confunde con "sin
 * plan de tratamiento" y esconde una deuda real en el mostrador).
 */
export async function requireFinanceViewRole(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
) {
  // Rol + ajustes por persona (EQU-01): un `finance:view` quitado o dado se
  // respeta acá, que es el par en el servidor de todas las pantallas de dinero.
  if (!(await tienePermisoEnClinica(supabase, clinicId, userId, "finance:view"))) {
    throw new Error(SIN_PERMISOS_FINANZAS);
  }
}

/**
 * Gate compartido de trial vencido para cualquier server function que sirve
 * un "informe" (Task 11, fix round 1). Lanza el MISMO mensaje genérico que el
 * chequeo de rol — nunca uno distinto que delate el motivo ("trial vencido")
 * a quien mire la Network tab.
 *
 * Regla 15 de la casa — el JWT vive en localStorage — así que el gate de UI
 * (TrialDesbloqueo) por sí solo no protege nada: cualquiera con el JWT en la
 * mano puede llamar la server function directo, saltándose la pantalla.
 *
 * Extraída de `requireFinanceView` para poder aplicarse también a funciones
 * cuyo control de acceso NO es "requiere finance:view" (`listExpenses`,
 * `listPaymentMethods`, `listAgreements`, `listLabOrders`,
 * `listInventoryItems` — ver Important #2 de la revisión): esas cinco siguen
 * su propio chequeo de rol/RLS tal cual estaba, y solo se les agrega esta
 * capa encima, sin tocar a quién le permiten llamarlas.
 *
 * Auditoría 360 (BIL-01): el gate es `informesBloqueados`, que además del
 * trial vencido cubre la gracia de cobro fallido agotada, cancelada o impaga.
 * Usa el mismo mapeo y la misma selección que `getMySubscription`.
 */
export async function throwIfTrialBlocksInformes(
  supabase: SupabaseClient<Database>,
  clinicId: string,
) {
  const { data: subRow } = await supabase
    .from("subscriptions")
    .select(SUBSCRIPTION_SELECT)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (!subRow) return;
  if (informesBloqueados(mapSubscription(subRow))) throw new Error(SIN_PERMISOS_FINANZAS);
}

/** Rol + trial. Lo que usan los tres reportes de esta misma factura
 * (`getFinanceSummary`, `getQuoteConversionReport`, `getPanelDesempeno`). */
export async function requireFinanceView(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userId: string,
) {
  await requireFinanceViewRole(supabase, clinicId, userId);
  await throwIfTrialBlocksInformes(supabase, clinicId);
}

export type {
  FinanceSummary,
  PanelDesempeno,
  PanelMes,
  QuoteConversionReport,
} from "@/lib/finance/finance-reports.compute";

/**
 * Caja + producción del período. Dos fuentes distintas a propósito:
 *  - "cobrado" viene de `payments` (plata que realmente entró).
 *  - "producción por profesional" viene de `treatment_items` completados,
 *    no de payments — payments no tiene professional_id, y un pago no
 *    siempre corresponde 1:1 a un ítem. Es el mismo indicador que usa el
 *    rubro (Dentalink, etc.) para "cuánto trabajo entregó cada doctor/a",
 *    no necesariamente lo que ya se cobró.
 *
 * Mismo criterio de fecha que compliance.functions.ts::getComplianceLog:
 * desde/hasta son YYYY-MM-DD, se interpretan como límites UTC del día, sin
 * ajustar a la timezone de la sucursal (simplificación ya usada en el resto
 * del proyecto para filtros de rango de fecha).
 */
export const getFinanceSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<FinanceSummary> => {
    const { supabase, userId } = context;
    await requireFinanceView(supabase, data.clinicId, userId);
    return computeFinanceSummary(supabase, data.clinicId, data.desde, data.hasta);
  });

/**
 * Conversión de presupuestos del período (reporte ampliado, Tier 3-L). Mira
 * quotes por created_at en el rango y clasifica por estado actual. La tasa de
 * conversión es sobre los que ya se resolvieron (aceptado vs rechazado), no
 * sobre el total — un presupuesto todavía "sent" no cuenta como perdido.
 * Mismo criterio de fecha UTC que getFinanceSummary.
 */
export const getQuoteConversionReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<QuoteConversionReport> => {
    await requireFinanceView(context.supabase, data.clinicId, context.userId);
    return computeQuoteConversion(context.supabase, data.clinicId, data.desde, data.hasta);
  });

// ─── PANEL DE DESEMPEÑO (Tanda D · G-7) ──────────────────────────────────

/**
 * Panel de desempeño de la clínica (G-7).
 *
 * Cada indicador que no se puede calcular con datos reales devuelve `null` y
 * la UI muestra "Sin datos", en vez de un cero que se lee como un resultado
 * malísimo. Es la regla 11 aplicada al lugar donde más tienta romperla: un
 * dashboard vacío se ve mal, pero un dashboard que miente se ve peor.
 */
export const getPanelDesempeno = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PanelDesempeno> => {
    const { supabase, userId } = context;
    await requireFinanceView(supabase, data.clinicId, userId);
    return computePanelDesempeno(supabase, data.clinicId, data.desde, data.hasta);
  });

/**
 * Morosidad: pacientes con saldo pendiente, agrupados por antigüedad de la
 * deuda. Gap identificado en la auditoría comparativa vs. SuperClini
 * (22-sep-2026) — hasta ahora Esmalia mostraba el saldo por paciente en su
 * ficha pero no había una vista consolidada de "a quién llamar hoy".
 *
 * Reusa `fetchPatientBalances` (misma cuenta que ya usa la ficha del
 * paciente: `patient_cents ?? price_cents` de items en planes no
 * cancelados, menos pagos vigentes) para no tener dos fórmulas de saldo que
 * puedan divergir.
 */
export const getAccountsReceivableAging = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<AccountsReceivableAgingRow[]> => {
    const { supabase, userId } = context;
    await requireFinanceView(supabase, data.clinicId, userId);
    return computeAccountsReceivableAging(supabase, data.clinicId);
  });
