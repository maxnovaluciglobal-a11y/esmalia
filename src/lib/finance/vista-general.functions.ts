import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { mensajeDb } from "@/lib/db-errors";
import { requireFinanceView } from "@/lib/finance/finance-reports.functions";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/finance/finance";
import {
  ETIQUETA_DOCUMENTO,
  TIPOS_DOCUMENTO,
  normalizarFolio,
  ordenarMovimientos,
  validarFolio,
  type FilaSucursal,
  type FilaVentaReal,
  type Movimiento,
  type TipoDocumento,
} from "@/lib/finance/vista-general";
import { diaISO } from "@/lib/formato-fecha";
import { enBloques, leerTodasLasPaginas } from "@/lib/paginacion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Vista general de finanzas (FIN-01), venta real (FIN-18), folios de boletas
 * emitidas afuera (FIN-15) y planilla del período para el contador (FIN-13).
 *
 * Todas las lecturas exigen `finance:view` con el mismo gate que Finanzas
 * (`requireFinanceView`: rol + suscripción, regla 15). Las sumas las hace
 * Postgres; la planilla se lee de a páginas para no cortarse en `max_rows`.
 * Anotar un folio exige `cash:manage` (quien cobra o lleva la caja).
 */

type Supabase = SupabaseClient<Database>;
const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Rango = z.object({ clinicId: z.string().uuid(), desde: DIA, hasta: DIA });

export interface PorCobrar {
  saldoPacientesCents: number;
  pacientesConSaldo: number;
  cuotasPendientesCents: number;
  cuotasPendientes: number;
}

export interface VistaGeneralFinanzas {
  currency: string;
  sucursales: FilaSucursal[];
  ventaReal: FilaVentaReal[];
  porCobrar: PorCobrar;
}

async function nombres(
  supabase: Supabase,
  tabla: "branches" | "professionals",
  clinicId: string,
  ids: string[],
): Promise<Map<string, { name: string; color: string | null }>> {
  const salida = new Map<string, { name: string; color: string | null }>();
  if (!ids.length) return salida;
  if (tabla === "branches") {
    const { data } = await supabase
      .from("branches")
      .select("id, name")
      .eq("clinic_id", clinicId)
      .in("id", ids);
    for (const b of data ?? []) salida.set(b.id, { name: b.name, color: null });
  } else {
    const { data } = await supabase
      .from("professionals")
      .select("id, full_name, color")
      .eq("clinic_id", clinicId)
      .in("id", ids);
    for (const p of data ?? []) salida.set(p.id, { name: p.full_name, color: p.color });
  }
  return salida;
}

export const getVistaGeneralFinanzas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Rango.parse(input))
  .handler(async ({ data, context }): Promise<VistaGeneralFinanzas> => {
    const { supabase, userId } = context;
    await requireFinanceView(supabase, data.clinicId, userId);
    const args = { p_clinic_id: data.clinicId, p_desde: data.desde, p_hasta: data.hasta };
    const [suc, venta, cobrar, clinica] = await Promise.all([
      supabase.rpc("finanzas_por_sucursal", args),
      supabase.rpc("finanzas_venta_real", args),
      supabase.rpc("finanzas_por_cobrar", { p_clinic_id: data.clinicId }),
      supabase.from("clinics").select("currency").eq("id", data.clinicId).maybeSingle(),
    ]);
    const error = suc.error ?? venta.error ?? cobrar.error;
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la vista general."));

    const filasSuc = suc.data ?? [];
    const filasVenta = venta.data ?? [];
    const [sucursales, profesionales] = await Promise.all([
      nombres(
        supabase,
        "branches",
        data.clinicId,
        filasSuc.map((f) => f.branch_id).filter((x): x is string => Boolean(x)),
      ),
      nombres(
        supabase,
        "professionals",
        data.clinicId,
        filasVenta.map((f) => f.professional_id).filter((x): x is string => Boolean(x)),
      ),
    ]);
    const pc = (cobrar.data ?? [])[0];
    return {
      currency: clinica.data?.currency ?? "CLP",
      sucursales: filasSuc.map((f) => ({
        branchId: f.branch_id,
        branchName: f.branch_id
          ? (sucursales.get(f.branch_id)?.name ?? "Sucursal")
          : "Sin sucursal",
        cobradoCents: Number(f.cobrado_cents),
        pagos: Number(f.pagos),
        cuotasCobradasCents: Number(f.cuotas_cobradas_cents),
        cuotasCobradas: Number(f.cuotas_cobradas),
        gastosCents: Number(f.gastos_cents),
        gastos: Number(f.gastos),
        realizadoCents: Number(f.realizado_cents),
      })),
      ventaReal: filasVenta.map((f) => ({
        professionalId: f.professional_id,
        professionalName: f.professional_id
          ? (profesionales.get(f.professional_id)?.name ?? "—")
          : "Sin profesional",
        color: f.professional_id ? (profesionales.get(f.professional_id)?.color ?? null) : null,
        presupuestadoCents: Number(f.presupuestado_cents),
        presupuestos: Number(f.presupuestos),
        realizadoCents: Number(f.realizado_cents),
        realizadoPacienteCents: Number(f.realizado_paciente_cents),
        realizadoItems: Number(f.realizado_items),
        cobradoCents: Number(f.cobrado_cents),
      })),
      porCobrar: {
        saldoPacientesCents: Number(pc?.saldo_pacientes_cents ?? 0),
        pacientesConSaldo: Number(pc?.pacientes_con_saldo ?? 0),
        cuotasPendientesCents: Number(pc?.cuotas_pendientes_cents ?? 0),
        cuotasPendientes: Number(pc?.cuotas_pendientes ?? 0),
      },
    };
  });

// ─── Pagos del período con su folio (FIN-15) y planilla (FIN-13) ───────────

type FilaPago = {
  id: string;
  paid_at: string;
  amount_cents: number;
  currency: string;
  method: string;
  method_name_snapshot: string | null;
  patient_id: string;
  payment_group_id: string | null;
};

type FilaFolio = {
  id: string;
  payment_id: string;
  doc_type: string;
  folio: string;
  issued_on: string;
  issuer: string;
};

async function zonaDeLaClinica(supabase: Supabase, clinicId: string): Promise<string> {
  const { data } = await supabase
    .from("clinics")
    .select("timezone")
    .eq("id", clinicId)
    .maybeSingle();
  return data?.timezone || "America/Santiago";
}

/**
 * Límites UTC amplios (un día de holgura a cada lado) para traer los pagos del
 * rango; después se filtra exacto por el día contable en la zona de la clínica.
 */
function limitesUtc(desde: string, hasta: string): { ini: string; fin: string } {
  const ini = new Date(`${desde}T00:00:00Z`).getTime() - 86_400_000;
  const fin = new Date(`${hasta}T23:59:59Z`).getTime() + 86_400_000;
  return { ini: new Date(ini).toISOString(), fin: new Date(fin).toISOString() };
}

async function leerPagos(
  supabase: Supabase,
  clinicId: string,
  desde: string,
  hasta: string,
  zona: string,
): Promise<(FilaPago & { dia: string })[]> {
  const { ini, fin } = limitesUtc(desde, hasta);
  const { filas, error } = await leerTodasLasPaginas<FilaPago>((a, b) =>
    supabase
      .from("payments")
      .select(
        "id, paid_at, amount_cents, currency, method, method_name_snapshot, patient_id, payment_group_id",
      )
      .eq("clinic_id", clinicId)
      .is("reversed_at", null)
      .gte("paid_at", ini)
      .lte("paid_at", fin)
      .order("id")
      .range(a, b),
  );
  if (error) throw new Error(mensajeDb(error, "No pudimos cargar los pagos del período."));
  return filas
    .map((p) => ({ ...p, dia: diaISO(p.paid_at, zona) ?? p.paid_at.slice(0, 10) }))
    .filter((p) => p.dia >= desde && p.dia <= hasta);
}

async function leerFolios(
  supabase: Supabase,
  clinicId: string,
  idsPagos: string[],
): Promise<Map<string, FilaFolio>> {
  const salida = new Map<string, FilaFolio>();
  for (const bloque of enBloques(idsPagos)) {
    const { data, error } = await supabase
      .from("payment_receipts")
      .select("id, payment_id, doc_type, folio, issued_on, issuer")
      .eq("clinic_id", clinicId)
      .in("payment_id", bloque);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los folios."));
    for (const f of data ?? []) salida.set(f.payment_id, f);
  }
  return salida;
}

async function nombresPacientes(
  supabase: Supabase,
  clinicId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  for (const bloque of enBloques([...new Set(ids)])) {
    const { data } = await supabase
      .from("patients")
      .select("id, full_name")
      .eq("clinic_id", clinicId)
      .in("id", bloque);
    for (const p of data ?? []) salida.set(p.id, p.full_name);
  }
  return salida;
}

function nombreMedio(p: { method: string; method_name_snapshot: string | null }): string {
  return p.method_name_snapshot ?? PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method;
}

export interface PagoConFolio {
  id: string;
  dia: string;
  paidAt: string;
  amountCents: number;
  currency: string;
  medio: string;
  patientId: string;
  patientName: string;
  paymentGroupId: string | null;
  folio: {
    id: string;
    docType: TipoDocumento;
    folio: string;
    issuedOn: string;
    issuer: string;
  } | null;
}

export const listPagosConFolio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Rango.parse(input))
  .handler(async ({ data, context }): Promise<PagoConFolio[]> => {
    const { supabase, userId } = context;
    await requireFinanceView(supabase, data.clinicId, userId);
    const zona = await zonaDeLaClinica(supabase, data.clinicId);
    const pagos = await leerPagos(supabase, data.clinicId, data.desde, data.hasta, zona);
    const [folios, pacientes] = await Promise.all([
      leerFolios(
        supabase,
        data.clinicId,
        pagos.map((p) => p.id),
      ),
      nombresPacientes(
        supabase,
        data.clinicId,
        pagos.map((p) => p.patient_id),
      ),
    ]);
    return pagos
      .map((p) => {
        const f = folios.get(p.id);
        return {
          id: p.id,
          dia: p.dia,
          paidAt: p.paid_at,
          amountCents: p.amount_cents,
          currency: p.currency,
          medio: nombreMedio(p),
          patientId: p.patient_id,
          patientName: pacientes.get(p.patient_id) ?? "—",
          paymentGroupId: p.payment_group_id,
          folio: f
            ? {
                id: f.id,
                docType: f.doc_type as TipoDocumento,
                folio: f.folio,
                issuedOn: f.issued_on,
                issuer: f.issuer,
              }
            : null,
        };
      })
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  });

/**
 * Anota (o corrige) el folio de la boleta emitida afuera. Con `aplicarAlGrupo`
 * se anota en todas las filas del mismo cobro con varios medios.
 */
export const guardarFolio = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        paymentId: z.string().uuid(),
        docType: z.enum(TIPOS_DOCUMENTO),
        folio: z.string().max(60),
        issuedOn: DIA,
        issuer: z.string().trim().min(1).max(60),
        aplicarAlGrupo: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ anotados: number }> => {
    const { supabase, userId } = context;
    await requireClinicPermission(
      supabase,
      data.clinicId,
      userId,
      "cash:manage",
      "No tienes permisos para anotar folios.",
    );
    const errores = validarFolio(data);
    if (errores.length) throw new Error(errores[0]);
    const { data: pago } = await supabase
      .from("payments")
      .select("id, payment_group_id")
      .eq("id", data.paymentId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (!pago) throw new Error("No encontramos ese pago.");
    let ids = [pago.id];
    if (data.aplicarAlGrupo && pago.payment_group_id) {
      const { data: grupo } = await supabase
        .from("payments")
        .select("id")
        .eq("clinic_id", data.clinicId)
        .eq("payment_group_id", pago.payment_group_id)
        .is("reversed_at", null);
      ids = (grupo ?? []).map((g) => g.id);
    }
    const filas = ids.map((id) => ({
      clinic_id: data.clinicId,
      payment_id: id,
      doc_type: data.docType,
      folio: normalizarFolio(data.folio),
      issued_on: data.issuedOn,
      issuer: data.issuer,
      created_by: userId,
    }));
    const { error } = await supabase
      .from("payment_receipts")
      .upsert(filas, { onConflict: "payment_id" });
    if (error) throw new Error(mensajeDb(error, "No pudimos guardar el folio."));
    return { anotados: filas.length };
  });

export const borrarFolio = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), paymentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(
      supabase,
      data.clinicId,
      userId,
      "cash:manage",
      "No tienes permisos para anotar folios.",
    );
    const { error } = await supabase
      .from("payment_receipts")
      .delete()
      .eq("clinic_id", data.clinicId)
      .eq("payment_id", data.paymentId);
    if (error) throw new Error(mensajeDb(error, "No pudimos quitar el folio."));
    return { ok: true };
  });

/**
 * Planilla del período para el contador (FIN-13): pagos de pacientes (con su
 * folio), cuotas de membresía cobradas y gastos, en un solo libro.
 */
export const listMovimientosDelPeriodo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Rango.parse(input))
  .handler(async ({ data, context }): Promise<Movimiento[]> => {
    const { supabase, userId } = context;
    await requireFinanceView(supabase, data.clinicId, userId);
    const zona = await zonaDeLaClinica(supabase, data.clinicId);
    const { ini, fin } = limitesUtc(data.desde, data.hasta);

    const pagos = await leerPagos(supabase, data.clinicId, data.desde, data.hasta, zona);

    const { filas: cuotasCrudas, error: errCuotas } = await leerTodasLasPaginas<{
      id: string;
      paid_at: string | null;
      amount_cents: number;
      currency: string;
      patient_id: string;
      method_name_snapshot: string | null;
      period_start: string;
    }>((a, b) =>
      supabase
        .from("membership_charges")
        .select(
          "id, paid_at, amount_cents, currency, patient_id, method_name_snapshot, period_start",
        )
        .eq("clinic_id", data.clinicId)
        .eq("status", "paid")
        .gte("paid_at", ini)
        .lte("paid_at", fin)
        .order("id")
        .range(a, b),
    );
    if (errCuotas) throw new Error(mensajeDb(errCuotas, "No pudimos cargar las cuotas cobradas."));
    const cuotas = cuotasCrudas
      .map((c) => ({ ...c, dia: diaISO(c.paid_at, zona) ?? "" }))
      .filter((c) => c.dia >= data.desde && c.dia <= data.hasta);

    const { filas: gastos, error: errGastos } = await leerTodasLasPaginas<{
      id: string;
      incurred_on: string;
      category: string;
      description: string;
      supplier: string | null;
      amount_cents: number;
      currency: string;
      method_name_snapshot: string | null;
      branch_id: string | null;
    }>((a, b) =>
      supabase
        .from("expenses")
        .select(
          "id, incurred_on, category, description, supplier, amount_cents, currency, method_name_snapshot, branch_id",
        )
        .eq("clinic_id", data.clinicId)
        .gte("incurred_on", data.desde)
        .lte("incurred_on", data.hasta)
        .order("id")
        .range(a, b),
    );
    if (errGastos) throw new Error(mensajeDb(errGastos, "No pudimos cargar los gastos."));

    const [folios, pacientes, sucursales] = await Promise.all([
      leerFolios(
        supabase,
        data.clinicId,
        pagos.map((p) => p.id),
      ),
      nombresPacientes(supabase, data.clinicId, [
        ...pagos.map((p) => p.patient_id),
        ...cuotas.map((c) => c.patient_id),
      ]),
      supabase.from("branches").select("id, name").eq("clinic_id", data.clinicId),
    ]);
    const sucursal = new Map((sucursales.data ?? []).map((b) => [b.id, b.name]));

    const movimientos: Movimiento[] = [
      ...pagos.map((p): Movimiento => {
        const f = folios.get(p.id);
        return {
          id: p.id,
          tipo: "ingreso",
          fecha: p.dia,
          detalle: "Pago de tratamiento",
          paciente: pacientes.get(p.patient_id) ?? null,
          medio: nombreMedio(p),
          sucursal: null,
          montoCents: p.amount_cents,
          currency: p.currency,
          documento: f ? ETIQUETA_DOCUMENTO[f.doc_type as TipoDocumento] : null,
          folio: f?.folio ?? null,
        };
      }),
      ...cuotas.map((c): Movimiento => ({
        id: c.id,
        tipo: "cuota",
        fecha: c.dia,
        detalle: "Cuota de membresía",
        paciente: pacientes.get(c.patient_id) ?? null,
        medio: c.method_name_snapshot,
        sucursal: null,
        montoCents: c.amount_cents,
        currency: c.currency,
        documento: null,
        folio: null,
      })),
      ...gastos.map((g): Movimiento => ({
        id: g.id,
        tipo: "gasto",
        fecha: g.incurred_on,
        detalle: `${g.category} · ${g.description}${g.supplier ? ` (${g.supplier})` : ""}`,
        paciente: null,
        medio: g.method_name_snapshot,
        sucursal: g.branch_id ? (sucursal.get(g.branch_id) ?? null) : null,
        montoCents: g.amount_cents,
        currency: g.currency,
        documento: null,
        folio: null,
      })),
    ];
    return ordenarMovimientos(movimientos);
  });
