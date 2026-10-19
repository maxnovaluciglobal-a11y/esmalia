// src/lib/marketing/eventos-servidor.server.ts
//
// Eventos del embudo que escribe el servidor (tracking plan en
// src/lib/marketing/medicion.ts). Misma tabla que `/api/ev`
// (`marketing_events`, sin policies: sólo service_role) y la misma regla:
// sin IP, sin emails, sin ids de usuario ni de clínica en las propiedades.
//
// Nunca lanza: la telemetría no puede romper un alta, una cita ni un pago.
// Hasta que se aplique la migración 20261019000000 los nombres nuevos chocan
// con el CHECK y el insert falla en silencio (queda un warn en el log).

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { DEMO_EMAIL } from "@/lib/demo-cuenta";
import {
  esCorreoInterno,
  horasDesdeAlta,
  type EventoCuenta,
  type EventoServidor,
} from "@/lib/marketing/medicion";

type Props = Record<string, string | boolean>;

export async function registrarEventoServidor(
  name: EventoServidor | EventoCuenta,
  props: Props,
  sessionHash?: string | null,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("marketing_events").insert({
      name,
      props,
      session_hash: sessionHash ?? null,
    });
    if (error) console.warn(`[ev] ${name} no se guardó:`, error.message);
  } catch (err) {
    console.warn(`[ev] ${name} falló:`, err instanceof Error ? err.message : err);
  }
}

/** Datos del usuario que hacen falta para validar y marcar un evento. */
export async function datosDelUsuario(userId: string): Promise<{
  interno: boolean;
  createdAt: string | null;
  confirmadoAt: string | null;
  proveedor: string | null;
}> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const user = data?.user;
    return {
      interno: esCorreoInterno(user?.email, process.env.ESMALIA_STAFF_EMAILS, DEMO_EMAIL),
      createdAt: user?.created_at ?? null,
      confirmadoAt: user?.email_confirmed_at ?? null,
      proveedor: (user?.app_metadata?.provider as string | undefined) ?? null,
    };
  } catch {
    return { interno: false, createdAt: null, confirmadoAt: null, proveedor: null };
  }
}

/** `interno: true` sólo cuando lo es (props más cortas). */
export function conInterno(props: Props, interno: boolean): Props {
  return interno ? { ...props, interno: true } : props;
}

/**
 * `primera_cita_creada` (activación): se emite cuando la clínica pasa de 0 a
 * tener citas. `habiaCitasAntes` lo mide el caller ANTES de insertar cuando
 * puede (importación); si no lo pasa, se cuenta después: exactamente 1 cita
 * = era la primera.
 */
export async function registrarPrimeraCitaSiCorresponde(args: {
  supabase: SupabaseClient<Database>;
  clinicId: string;
  userId: string;
  origen: "manual" | "importacion";
  habiaCitasAntes?: boolean;
}): Promise<void> {
  try {
    const { supabase, clinicId } = args;
    if (args.habiaCitasAntes === undefined) {
      const { data: citas, error } = await supabase
        .from("appointments")
        .select("id")
        .eq("clinic_id", clinicId)
        .limit(2);
      if (error || (citas ?? []).length !== 1) return;
    } else if (args.habiaCitasAntes) {
      return;
    }

    const { data: clinica } = await supabase
      .from("clinics")
      .select("created_at, is_demo")
      .eq("id", clinicId)
      .maybeSingle();
    const usuario = await datosDelUsuario(args.userId);
    const interno = usuario.interno || Boolean(clinica?.is_demo);

    await registrarEventoServidor(
      "primera_cita_creada",
      conInterno(
        { origen: args.origen, ...horasDesdeAlta(clinica?.created_at, new Date()) },
        interno,
      ),
    );
  } catch (err) {
    console.warn("[ev] primera_cita_creada:", err instanceof Error ? err.message : err);
  }
}

/** ¿La clínica ya tenía alguna cita? Para la importación, antes de insertar. */
export async function clinicaTieneCitas(
  supabase: SupabaseClient<Database>,
  clinicId: string,
): Promise<boolean | undefined> {
  const { data, error } = await supabase
    .from("appointments")
    .select("id")
    .eq("clinic_id", clinicId)
    .limit(1);
  if (error) return undefined;
  return (data ?? []).length > 0;
}
