import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mensajeDb } from "@/lib/db-errors";
import { contadoresDesdeFila, type ContadoresDeCitas } from "@/lib/patients/contadores-citas";

/**
 * Contadores de citas de la ficha (FIC-12). Un solo RPC agregado en
 * Postgres (`patient_appointment_counters`, SECURITY INVOKER): la RLS de
 * `appointments` decide qué cuenta, igual que la agenda. No lleva montos, así
 * que no necesita `requireFinanceView`.
 */
export const getContadoresDeCitas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ContadoresDeCitas> => {
    const { data: filas, error } = await context.supabase.rpc("patient_appointment_counters", {
      p_clinic_id: data.clinicId,
      p_patient_id: data.patientId,
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos contar las citas del paciente."));
    return contadoresDesdeFila(filas?.[0]);
  });
