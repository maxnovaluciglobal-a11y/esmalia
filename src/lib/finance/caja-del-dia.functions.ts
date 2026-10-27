import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { permissionsForRole, type ClinicRole } from "@/lib/access/access";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import { mensajeDb } from "@/lib/db-errors";
import {
  armarResumen,
  type CitaDelDia,
  type ItemCobrado,
  type PagoDelDia,
  type ProfesionalDelDia,
  type ReglasDelDia,
  type ResumenCajaDelDia,
} from "@/lib/finance/caja-del-dia";
import { cargarPeriodo } from "@/lib/finance/commissions.functions";
import { enBloques, leerTodasLasPaginas } from "@/lib/paginacion";
import { fetchPatientBalances } from "@/lib/patients/patients.functions";

const SIN_PERMISOS_CAJA = "No tienes permisos para operar la caja.";

/** "2026-10-26" → "2026-10-27" (aritmética de calendario, sin husos). */
function diaSiguiente(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Resumen de la caja del día de la clínica: cobrado por hora y por medio,
 * movimientos, atendidas sin cobro y comisiones (A+, pase de fidelidad).
 *
 * Permisos (regla 15, el par en el servidor del `cash:manage` de la ruta):
 * - Sin `cash:manage` ni `finance:view` (asistente, dentista) no hay nada:
 *   `payments` excluye al asistente y la caja no es del profesional.
 * - Saldos de pacientes y comisiones de todos los profesionales solo con
 *   `finance:view` (recepción opera la caja pero no ve reportes financieros,
 *   mismo criterio que `getAppointmentPatientBalances` y `getCommissionReport`).
 *   Las comisiones del día se calculan con el mismo motor que el reporte y el
 *   cierre (`cargarPeriodo` + `liquidar`): "rige desde", base cobrado o
 *   realizado y la regla propia de cada prestación.
 *
 * El día es el de la clínica (`clinics.timezone`, regla 7). Todas las
 * lecturas van de a páginas: PostgREST corta en 1000 filas sin avisar.
 */
export const getCajaDelDia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        /** Caja abierta (para "abierta por" y la sucursal), si hay. */
        cashRegisterId: z.string().uuid().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ResumenCajaDelDia> => {
    const { supabase, userId } = context;

    const [{ data: membership }, { data: clinic, error: clinicError }] = await Promise.all([
      supabase
        .from("clinic_members")
        .select("role")
        .eq("clinic_id", data.clinicId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("clinics").select("timezone").eq("id", data.clinicId).maybeSingle(),
    ]);
    const permisos = membership?.role ? permissionsForRole(membership.role as ClinicRole) : [];
    const veFinanzas = permisos.includes("finance:view");
    if (!veFinanzas && !permisos.includes("cash:manage")) throw new Error(SIN_PERMISOS_CAJA);
    if (clinicError) throw new Error(mensajeDb(clinicError, "No pudimos leer la clínica."));

    const timeZone = clinic?.timezone || "America/Santiago";
    const fecha = hoyISO(timeZone);
    const desde = wallTimeInTzToUtc(`${fecha}T00:00:00`, timeZone).toISOString();
    const hasta = wallTimeInTzToUtc(`${diaSiguiente(fecha)}T00:00:00`, timeZone).toISOString();

    const [pagosRes, citasRes, prosRes, registerRes, branchesRes] = await Promise.all([
      leerTodasLasPaginas((a, b) =>
        supabase
          .from("payments")
          .select(
            "id, amount_cents, method, method_name_snapshot, paid_at, patient_id, treatment_item_id, receivable_id, payment_group_id, notes, membership_charge_id",
          )
          .eq("clinic_id", data.clinicId)
          .is("reversed_at", null)
          .gte("paid_at", desde)
          .lt("paid_at", hasta)
          .order("paid_at", { ascending: true })
          .order("id", { ascending: true })
          .range(a, b),
      ),
      leerTodasLasPaginas((a, b) =>
        supabase
          .from("appointments")
          .select("id, patient_id, professional_id, starts_at, status, treatment_label")
          .eq("clinic_id", data.clinicId)
          .neq("status", "cancelada")
          .gte("starts_at", desde)
          .lt("starts_at", hasta)
          .order("starts_at", { ascending: true })
          .order("id", { ascending: true })
          .range(a, b),
      ),
      supabase.from("professionals").select("id, full_name, color").eq("clinic_id", data.clinicId),
      data.cashRegisterId
        ? supabase
            .from("cash_registers")
            .select("opened_by, branch_id")
            .eq("id", data.cashRegisterId)
            .eq("clinic_id", data.clinicId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("branches")
        .select("id, name")
        .eq("clinic_id", data.clinicId)
        .eq("is_active", true),
    ]);
    if (pagosRes.error)
      throw new Error(mensajeDb(pagosRes.error, "No pudimos cargar los cobros de hoy."));
    if (citasRes.error)
      throw new Error(mensajeDb(citasRes.error, "No pudimos cargar las citas de hoy."));
    if (prosRes.error)
      throw new Error(mensajeDb(prosRes.error, "No pudimos cargar los profesionales."));

    const pagos: PagoDelDia[] = pagosRes.filas.map((p) => ({
      id: p.id,
      amountCents: p.amount_cents,
      method: p.method,
      methodName: p.method_name_snapshot,
      paidAt: p.paid_at,
      patientId: p.patient_id,
      treatmentItemId: p.treatment_item_id,
      receivableId: p.receivable_id,
      paymentGroupId: p.payment_group_id,
      notes: p.notes,
      membershipChargeId: p.membership_charge_id,
    }));
    const citas: CitaDelDia[] = citasRes.filas.map((c) => ({
      id: c.id,
      patientId: c.patient_id,
      professionalId: c.professional_id,
      startsAt: c.starts_at,
      status: c.status,
      treatmentLabel: c.treatment_label,
    }));
    const profesionales: ProfesionalDelDia[] = (prosRes.data ?? []).map((p) => ({
      id: p.id,
      nombre: p.full_name,
      color: p.color,
    }));

    // Nombres de pacientes y prestaciones cobradas: en bloques de ids (la URL
    // de un `.in()` con cientos de uuids pasa el largo máximo del gateway).
    const idsPacientes = [...new Set([...pagos, ...citas].map((x) => x.patientId))];
    const idsItems = [
      ...new Set(pagos.map((p) => p.treatmentItemId).filter((id): id is string => !!id)),
    ];
    const [bloquesPacientes, bloquesItems] = await Promise.all([
      Promise.all(
        enBloques(idsPacientes).map((ids) =>
          supabase
            .from("patients")
            .select("id, full_name")
            .eq("clinic_id", data.clinicId)
            .in("id", ids),
        ),
      ),
      Promise.all(
        enBloques(idsItems).map((ids) =>
          supabase
            .from("treatment_items")
            .select("id, name_snapshot, professional_id, tooth_number")
            .eq("clinic_id", data.clinicId)
            .in("id", ids),
        ),
      ),
    ]);
    const pacientes = new Map<string, string>();
    for (const r of bloquesPacientes) {
      if (r.error) throw new Error(mensajeDb(r.error, "No pudimos cargar los pacientes de hoy."));
      for (const p of r.data ?? []) pacientes.set(p.id, p.full_name);
    }
    const items = new Map<string, ItemCobrado>();
    for (const r of bloquesItems) {
      // Sin la prestación el cobro igual se muestra (concepto de la cita o
      // "Abono"): no vale la pena tumbar la caja por el nombre de un ítem.
      for (const it of r.data ?? []) {
        items.set(it.id, {
          name: it.name_snapshot,
          professionalId: it.professional_id,
          toothNumber: it.tooth_number,
        });
      }
    }

    let saldos: Map<string, number> | null = null;
    let comisiones: ReglasDelDia | null = null;
    let truncado = false;
    if (veFinanzas) {
      const atendidos = [
        ...new Set(citas.filter((c) => c.status === "finalizada").map((c) => c.patientId)),
      ];
      const [balances, periodo] = await Promise.all([
        fetchPatientBalances(supabase, data.clinicId, atendidos),
        cargarPeriodo(supabase, data.clinicId, fecha, fecha),
      ]);
      saldos = new Map([...balances].map(([id, b]) => [id, b.billedCents - b.paidCents]));
      comisiones = {
        fecha,
        currency: periodo.currency,
        versiones: periodo.versiones,
        realizados: periodo.realizados,
        cobrados: periodo.cobrados,
        sinAtribuirCents: periodo.sinAtribuirCents,
      };
      truncado = periodo.truncado;
    }

    // "Abierta por": el nombre de quien abrió. Si la policy de `profiles` no
    // deja leerlo, la pantalla dice solo la hora (no es un error de la caja).
    let abiertaPor: string | null = null;
    const register = registerRes.data;
    if (register?.opened_by) {
      const { data: perfil } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", register.opened_by)
        .maybeSingle();
      abiertaPor = perfil?.full_name?.trim().split(/\s+/)[0] || null;
    }
    const sucursales = branchesRes.data ?? [];
    const sucursal =
      (register?.branch_id && sucursales.find((b) => b.id === register.branch_id)?.name) ||
      (sucursales.length === 1 ? sucursales[0].name : null);

    return armarResumen({
      fecha,
      timeZone,
      pagos,
      citas,
      pacientes,
      items,
      profesionales,
      saldos,
      comisiones,
      abiertaPor,
      sucursal,
      truncado: truncado || pagosRes.truncado || citasRes.truncado,
    });
  });
