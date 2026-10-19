import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { SeccionFicha } from "@/lib/clinical/lecturas-ficha";

type ClienteRpc = Pick<SupabaseClient<Database>, "rpc">;
export type Reportar = (error: Error) => Promise<void> | void;

/** Un mismo fallo (p. ej. la migración todavía sin aplicar) se reporta como
 * mucho una vez cada 10 minutos por instancia: si no, cada ficha abierta
 * mandaría un evento a Sentry. */
const INTERVALO_REPORTE_MS = 10 * 60 * 1000;
const ultimoReporte = new Map<string, number>();

/** Solo para tests: olvida los reportes ya enviados. */
export function reiniciarReportesDeLectura() {
  ultimoReporte.clear();
}

async function reportarASentry(error: Error) {
  const { capturarErrorDelServidor } = await import("@/lib/sentry.server");
  await capturarErrorDelServidor(error, { ruta: "registrar_lectura_ficha" });
}

/**
 * Anota que el usuario de la sesión abrió una sección de la ficha de un
 * paciente. Lo escribe la base (`registrar_lectura_ficha`, SECURITY DEFINER):
 * estampa el actor con auth.uid(), valida que el paciente sea de la clínica y
 * deduplica (una fila por usuario + paciente + sección cada 15 minutos).
 *
 * Falla ABIERTA y nunca rechaza: si el registro no se puede escribir, la
 * ficha se muestra igual y el error va a Sentry. Por eso se puede lanzar al
 * principio del handler, en paralelo con la carga, y esperarlo al final:
 *
 *   const lectura = registrarLecturaDeFicha(supabase, { ... });
 *   // ...cargar la sección...
 *   await lectura;
 *   return resultado;
 *
 * Hay que esperarlo antes de responder: en Vercel la función se puede
 * congelar apenas devuelve, y una promesa pendiente se pierde.
 */
export async function registrarLecturaDeFicha(
  supabase: ClienteRpc,
  args: { clinicId: string; patientId: string; seccion: SeccionFicha },
  reportar: Reportar = reportarASentry,
): Promise<void> {
  let error: { code?: string; message: string } | null = null;
  try {
    const res = await supabase.rpc("registrar_lectura_ficha", {
      p_clinic_id: args.clinicId,
      p_patient_id: args.patientId,
      p_seccion: args.seccion,
    });
    error = res.error;
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }
  if (!error) return;

  // 42501 = la base dijo que el paciente no es de esa clínica (ficha borrada,
  // enlace viejo): la lectura tampoco devolvió datos, no hay nada que avisar.
  if (error.code === "42501") return;

  const clave = error.code ?? error.message;
  const ahora = Date.now();
  const anterior = ultimoReporte.get(clave);
  if (anterior !== undefined && ahora - anterior < INTERVALO_REPORTE_MS) return;
  ultimoReporte.set(clave, ahora);

  // Sin datos del paciente en el mensaje: solo la sección y el código.
  const fallo = new Error(
    `[SEG-02] No se pudo registrar la lectura de la ficha (${args.seccion}): ${error.code ?? "sin código"} ${error.message}`,
  );
  console.error(fallo.message);
  try {
    await reportar(fallo);
  } catch {
    // Reportar nunca puede romper la carga de la ficha.
  }
}
