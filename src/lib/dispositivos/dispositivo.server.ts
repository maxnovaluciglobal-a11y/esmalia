import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  esModoPrivacidad,
  esTipoDispositivo,
  type ModoPrivacidad,
  type TipoDispositivo,
} from "@/lib/dispositivos/dispositivos";
import { esTokenValido, huellaDeSecreto } from "@/lib/firma-distancia/token";
import { checkRateLimit } from "@/lib/rate-limit.server";

/**
 * Sesión de dispositivo (AUT-06) del lado del servidor.
 *
 * El navegador del dispositivo manda su token en el cuerpo de cada llamada.
 * Acá se calcula la huella, se aplica el límite por dispositivo y se resuelve
 * QUÉ dispositivo es (tipo, clínica, sucursal) con el rol de servicio. Cada
 * función de dispositivo recibe solo ese id: la base la acota a su clínica,
 * su sucursal y su tipo. El token no es un JWT de Supabase: no abre nada de
 * la app autenticada ni de PostgREST.
 */

type Db = SupabaseClient<Database>;

export const MENSAJE_DISPOSITIVO_INVALIDO =
  "Este dispositivo ya no está vinculado. Pide un código nuevo en Ajustes → Dispositivos.";

export class DispositivoInvalido extends Error {
  constructor() {
    super(MENSAJE_DISPOSITIVO_INVALIDO);
    this.name = "DispositivoInvalido";
  }
}

export interface Dispositivo {
  id: string;
  clinicId: string;
  branchId: string;
  tipo: TipoDispositivo;
  nombre: string;
  operatoryId: string | null;
  box: string | null;
  privacidad: ModoPrivacidad;
  clinica: string;
  sucursal: string;
  zona: string;
  pais: string | null;
  moneda: string | null;
}

export async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type Obj = Record<string, unknown>;
const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Fila de `dispositivo_por_token` → Dispositivo, o null si no sirve. */
export function dispositivoDesdeFila(v: unknown): Dispositivo | null {
  if (!v || typeof v !== "object") return null;
  const j = v as Obj;
  const id = texto(j.id);
  const clinicId = texto(j.clinic_id);
  const branchId = texto(j.branch_id);
  if (!id || !clinicId || !branchId || !esTipoDispositivo(j.kind)) return null;
  return {
    id,
    clinicId,
    branchId,
    tipo: j.kind,
    nombre: texto(j.nombre) ?? "Dispositivo",
    operatoryId: texto(j.operatory_id),
    box: texto(j.box),
    privacidad: esModoPrivacidad(j.privacidad) ? j.privacidad : "iniciales",
    clinica: texto(j.clinica) ?? "Clínica",
    sucursal: texto(j.sucursal) ?? "Sucursal",
    zona: texto(j.zona) ?? "America/Santiago",
    pais: texto(j.pais),
    moneda: texto(j.moneda),
  };
}

/** Límite por dispositivo (además de los de la base): 120 llamadas por minuto. */
function exigirLimiteDeDispositivo(huella: string): void {
  const r = checkRateLimit(huella.slice(0, 32), {
    scope: "dispositivo",
    windowMs: 60_000,
    max: 120,
  });
  if (r.limited) {
    throw new Error(`Demasiadas solicitudes seguidas. Espera ${r.retryAfterSeconds} segundos.`);
  }
}

/**
 * Resuelve el dispositivo del token y exige su tipo. Lanza
 * `DispositivoInvalido` si el token no existe, está revocado o es de otro
 * tipo (una TV no puede usar las funciones del tótem).
 */
export async function exigirDispositivo(
  token: unknown,
  tipo: TipoDispositivo | null,
): Promise<{ db: Db; dispositivo: Dispositivo }> {
  if (!esTokenValido(token)) throw new DispositivoInvalido();
  const huella = await huellaDeSecreto(token);
  exigirLimiteDeDispositivo(huella);
  const db = await admin();
  const { data, error } = await db.rpc("dispositivo_por_token", { p_token_hash: huella });
  if (error) throw new Error("No pudimos verificar el dispositivo. Vuelve a intentarlo.");
  const dispositivo = dispositivoDesdeFila(data);
  if (!dispositivo || (tipo && dispositivo.tipo !== tipo)) throw new DispositivoInvalido();
  return { db, dispositivo };
}
