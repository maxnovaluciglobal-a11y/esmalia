import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rolEnClinica } from "@/lib/access/clinic-guards.server";
import { ROLES_AFILIACION } from "@/lib/finance/empresas-convenio";
import type { CandidatoDescuento } from "@/lib/finance/descuento-afiliacion";
import { cargarDescuentosDeAfiliacion } from "@/lib/finance/descuento-afiliacion.server";

/**
 * Descuentos de afiliación que el paciente tiene hoy (empresa con convenio y
 * membresía activa), para proponerlos al crear o editar su presupuesto
 * (cierre · ítem 2). Los lee el equipo que ve afiliaciones (mismo público que
 * la RLS: owner, admin, dentist, reception, accounting); el asistente recibe una
 * lista vacía, no un error, porque presupuestar no depende de esto.
 */
export interface DescuentosDeAfiliacion {
  /** `false` = el rol no ve afiliaciones: el diálogo no toca el origen del descuento. */
  visible: boolean;
  candidatos: CandidatoDescuento[];
}

export const getDescuentosDeAfiliacion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<DescuentosDeAfiliacion> => {
    const { supabase, userId } = context;
    const rol = await rolEnClinica(supabase, data.clinicId, userId);
    const visible = rol !== null && ROLES_AFILIACION.includes(rol);
    return {
      visible,
      candidatos: await cargarDescuentosDeAfiliacion(supabase, data.clinicId, data.patientId, rol),
    };
  });
