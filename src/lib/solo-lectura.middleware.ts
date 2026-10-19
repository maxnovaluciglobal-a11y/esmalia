/**
 * Middlewares de escritura: el chequeo central del modo solo lectura.
 *
 * Convención (la verifica `tests/solo-lectura-cobertura.test.ts`): toda
 * server function POST usa UNO de estos en lugar de `requireSupabaseAuth`
 * (ya lo incluyen), o figura en `ESCRITURA_EXENTA` con su motivo. Las GET no
 * escriben datos de la clínica (el test también lo vigila).
 *
 * - `requireEscritura`: la función recibe `clinicId` en su input.
 * - `requireEscrituraPorFila(tabla, campo)`: recibe el id de una fila y no la
 *   clínica; se lee `clinic_id` de esa fila.
 * - `requireEscrituraDeNotaClinica`: notas clínicas, con la excepción de
 *   urgencia (cita en curso).
 *
 * El middleware corre ANTES del validador de la función (TanStack Start
 * pone el validador de la función al final de la cadena), así que lee el
 * input crudo. No es un problema: el handler usa los mismos valores ya
 * validados, y si el input no trae lo necesario se rechaza (falla cerrada).
 */
import { createMiddleware } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  clinicaDeLaFila,
  exigirEscritura,
  exigirEscrituraDeNotaClinica,
  MENSAJE_SIN_CLINICA,
  uuidDe,
  type TablaConClinica,
} from "@/lib/solo-lectura.server";

function campo(data: unknown, nombre: string): unknown {
  return data && typeof data === "object" ? (data as Record<string, unknown>)[nombre] : undefined;
}

export const requireEscritura = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, data, context }) => {
    const clinicId = uuidDe(campo(data, "clinicId"));
    if (!clinicId) throw new Error(MENSAJE_SIN_CLINICA);
    await exigirEscritura(context.supabase, clinicId);
    return next();
  });

export function requireEscrituraPorFila(tabla: TablaConClinica, campoId: string) {
  return createMiddleware({ type: "function" })
    .middleware([requireSupabaseAuth])
    .server(async ({ next, data, context }) => {
      const id = uuidDe(campo(data, campoId));
      if (!id) throw new Error(MENSAJE_SIN_CLINICA);
      const clinicId = await clinicaDeLaFila(context.supabase, tabla, id);
      // Si la fila no es visible para este usuario, el handler tampoco la va
      // a poder tocar (misma RLS): no hay escritura que frenar.
      if (clinicId) await exigirEscritura(context.supabase, clinicId);
      return next();
    });
}

export const requireEscrituraDeNotaClinica = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, data, context }) => {
    await exigirEscrituraDeNotaClinica(context.supabase, {
      clinicId: campo(data, "clinicId"),
      patientRef: campo(data, "patientRef"),
      noteId: campo(data, "noteId"),
    });
    return next();
  });
