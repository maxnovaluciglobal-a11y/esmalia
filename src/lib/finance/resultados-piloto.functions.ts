import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicRole } from "@/lib/access/clinic-guards.server";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { mensajeDb } from "@/lib/db-errors";
import { requireFinanceView } from "@/lib/finance/finance-reports.functions";
import {
  rangoDelPiloto,
  resultadosDesdeFila,
  type ResultadosDelPiloto,
} from "@/lib/finance/resultados-piloto";
import { diaISO } from "@/lib/formato-fecha";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SIN_PERMISO = "No tienes permisos para ver los resultados del piloto.";

/**
 * Resultados del piloto (INF-14). Solo owner/admin: es la conversación de
 * cierre con la dueña de la clínica, no un reporte del día a día. Par en el
 * servidor del `beforeLoad` de la ruta (regla 15).
 *
 * Los montos (presupuestos y cobrado) pasan además por `requireFinanceView`
 * (rol + suscripción que permite informes). Si no pasa, el resto del reporte
 * se muestra igual y los montos vuelven en `null`: la pantalla lo explica en
 * vez de esconder también la asistencia y los pacientes nuevos.
 *
 * El rango por defecto va desde el día en que se creó la clínica hasta hoy,
 * los dos en el huso de la clínica (regla 7).
 */
export const getResultadosDelPiloto = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        desde: z.string().regex(ISO).nullish(),
        hasta: z.string().regex(ISO).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ResultadosDelPiloto & { inicio: string }> => {
    const { supabase, userId } = context;
    await requireClinicRole(supabase, data.clinicId, userId, ["owner", "admin"], SIN_PERMISO);

    const { data: clinica, error: errorClinica } = await supabase
      .from("clinics")
      .select("created_at, timezone, currency")
      .eq("id", data.clinicId)
      .maybeSingle();
    if (errorClinica || !clinica) throw new Error(SIN_PERMISO);
    const tz = clinica.timezone || "America/Santiago";
    const hoy = hoyISO(tz);
    const inicio = diaISO(clinica.created_at, tz) ?? hoy;
    const { desde, hasta } = rangoDelPiloto({
      creadaEl: inicio,
      hoy,
      desde: data.desde,
      hasta: data.hasta,
    });

    let montosVisibles = true;
    try {
      await requireFinanceView(supabase, data.clinicId, userId);
    } catch {
      montosVisibles = false;
    }

    const { data: filas, error } = await supabase.rpc("pilot_results", {
      p_clinic_id: data.clinicId,
      p_desde: desde,
      p_hasta: hasta,
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos calcular los resultados del piloto."));

    return {
      inicio,
      ...resultadosDesdeFila(filas?.[0], {
        desde,
        hasta,
        currency: clinica.currency,
        montosVisibles,
      }),
    };
  });
