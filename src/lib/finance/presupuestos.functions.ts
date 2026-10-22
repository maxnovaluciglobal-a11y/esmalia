import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import type { QuoteStatus } from "@/lib/finance/finance";
import { requireFinanceViewRole } from "@/lib/finance/finance-reports.functions";
import type { PresupuestoDeClinica } from "@/lib/finance/presupuestos";

/** Tope de filas: la pantalla es una lista de trabajo, no un archivo. */
export const LIMITE_PRESUPUESTOS = 500;

/**
 * Presupuestos de toda la clínica, los más nuevos primero (solo lectura).
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
    }): Promise<{ presupuestos: PresupuestoDeClinica[]; truncado: boolean }> => {
      const { supabase, userId } = context;
      await requireFinanceViewRole(supabase, data.clinicId, userId);

      const { data: filas, error } = await supabase
        .from("quotes")
        .select(
          "id, number, status, currency, total_cents, created_at, sent_at, valid_until, accepted_at, rejected_at, patient_id",
        )
        .eq("clinic_id", data.clinicId)
        .order("created_at", { ascending: false })
        .limit(LIMITE_PRESUPUESTOS);
      if (error) throw new Error(mensajeDb(error, "No pudimos cargar los presupuestos."));

      const quotes = filas ?? [];
      const patientIds = [...new Set(quotes.map((q) => q.patient_id))];
      const { data: pacientes, error: errPacientes } = patientIds.length
        ? await supabase
            .from("patients")
            .select("id, full_name")
            .eq("clinic_id", data.clinicId)
            .in("id", patientIds)
        : { data: [] as { id: string; full_name: string }[], error: null };
      if (errPacientes)
        throw new Error(mensajeDb(errPacientes, "No pudimos cargar los pacientes."));
      const nombres = new Map((pacientes ?? []).map((p) => [p.id, p.full_name]));

      return {
        presupuestos: quotes.map((q) => ({
          id: q.id,
          number: q.number,
          status: q.status as QuoteStatus,
          currency: q.currency,
          totalCents: q.total_cents,
          createdAt: q.created_at,
          sentAt: q.sent_at,
          validUntil: q.valid_until,
          acceptedAt: q.accepted_at,
          rejectedAt: q.rejected_at,
          patientId: q.patient_id,
          patientName: nombres.get(q.patient_id) ?? null,
        })),
        truncado: quotes.length >= LIMITE_PRESUPUESTOS,
      };
    },
  );
