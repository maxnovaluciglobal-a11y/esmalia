// Estado de la verificación en dos pasos y el aviso pospuesto. Separados de
// `components/verificacion-dos-pasos.tsx` para que ese archivo exporte solo
// componentes (Fast Refresh).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getSupabase } from "@/integrations/supabase/lazy";
import { esCuentaDemo } from "@/lib/demo-cuenta";
import { factoresTotpVerificados, tieneFactorVerificado } from "@/lib/auth/mfa";

export const MFA_QUERY_KEY = ["mfa-estado"] as const;

type EstadoMfa = {
  tieneFactor: boolean;
  factorId: string | null;
  esDemo: boolean;
  /** `amr` del JWT: cuándo inició sesión (para exigir sesión reciente). */
  amr: readonly unknown[];
};

/** Lee el estado de la sesión local (sin red): si la cuenta tiene un factor
 *  verificado y cuál. `listFactors` también sale de la sesión guardada. */
async function leerEstadoMfa(): Promise<EstadoMfa> {
  const supabase = await getSupabase();
  const [{ data: sesion }, { data: niveles }, { data: factores }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  const verificado = factoresTotpVerificados(factores?.all ?? [])[0];
  return {
    tieneFactor: tieneFactorVerificado(niveles) || Boolean(verificado),
    factorId: verificado?.id ?? null,
    esDemo: esCuentaDemo(sesion.session?.user.email),
    amr: niveles?.currentAuthenticationMethods ?? [],
  };
}

export function useEstadoMfa() {
  return useQuery({ queryKey: MFA_QUERY_KEY, queryFn: leerEstadoMfa, staleTime: 60_000 });
}

const CLAVE_POSPUESTO = "esmalia:mfa-aviso-pospuesto-hasta";
const DIAS_POSPUESTO = 7;

function leerPospuesto(): boolean {
  try {
    const hasta = Number(window.localStorage.getItem(CLAVE_POSPUESTO) ?? 0);
    return Number.isFinite(hasta) && hasta > Date.now();
  } catch {
    return false;
  }
}

/** `[pospuesto, posponer]`: el owner puede pedir que se le recuerde en una
 *  semana. Vive en quien decide qué franja mostrar (`StatusStrip`) para que,
 *  pospuesto el aviso, aparezca la franja siguiente (el trial) y no un hueco. */
export function useAvisoMfaPospuesto(): [boolean, () => void] {
  const [pospuesto, setPospuesto] = useState(leerPospuesto);
  function posponer() {
    try {
      window.localStorage.setItem(
        CLAVE_POSPUESTO,
        String(Date.now() + DIAS_POSPUESTO * 24 * 60 * 60 * 1000),
      );
    } catch {
      // Sin almacenamiento: se oculta solo por esta visita.
    }
    setPospuesto(true);
  }
  return [pospuesto, posponer];
}
