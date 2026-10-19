// src/lib/phoneValidation.ts
// Valida teléfonos contra Numverify — confirma que el número tiene forma
// real (país, operador), no que el paciente sea contactable de verdad.
// Informativo únicamente: nunca bloquea alta ni edición de un paciente, la
// cobertura de Numverify para operadores regionales chicos de LatAm no es
// perfecta y un falso negativo bloqueando una ficha real sería peor que no
// validar nada.
//
// A diferencia de holidays.ts (cache en memoria, TTL corto, dato público),
// acá el resultado se guarda directo en patients.phone_valid — el propio
// registro del paciente ES el cache, no hace falta uno separado. Solo se
// vuelve a llamar a Numverify cuando el teléfono realmente cambia (ver
// patients.functions.ts).
//
// Server-only: NUMVERIFY_API_KEY no tiene prefijo VITE_, nunca llega al
// cliente (ver DEPLOY-VERCEL.md, sección "cliente vs servidor").

const NUMVERIFY_URL = "https://apilayer.net/api/validate";

/**
 * Saca la clave y el teléfono de cualquier texto antes de loguearlo (por si
 * un error trae la URL completa).
 */
function sinSecretos(texto: string, apiKey: string): string {
  return texto
    .split(apiKey)
    .join("[redactado]")
    .split(encodeURIComponent(apiKey))
    .join("[redactado]")
    .replace(/access_key=[^&\s]+/g, "access_key=[redactado]")
    .replace(/number=[^&\s]+/g, "number=[redactado]");
}

/**
 * true/false si Numverify pudo validar la forma del número, null si no se
 * pudo determinar (sin key, timeout, error, o el campo vino vacío). Nunca
 * lanza — un fallo acá nunca debe romper el alta/edición de un paciente.
 *
 * Solo HTTPS (auditoría 360, OPS-03 / LEG-02): antes iba por HTTP y el
 * teléfono del paciente y la clave viajaban en claro. La página pública de
 * Numverify (numverify.com/product, consultada el 19-oct-2026) lista
 * "256-bit HTTPS Encryption" en todos los planes, incluido el gratis. Si
 * apilayer igual rechazara HTTPS para esta cuenta (`https_access_restricted`),
 * se devuelve null: nunca se vuelve a HTTP.
 */
export async function validatePhoneNumber(
  phone: string | null | undefined,
): Promise<boolean | null> {
  const trimmed = (phone ?? "").trim();
  if (!trimmed) return null;

  const apiKey = process.env.NUMVERIFY_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `${NUMVERIFY_URL}?access_key=${encodeURIComponent(apiKey)}&number=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const json = (await res.json()) as {
      valid?: unknown;
      error?: { code?: number; type?: string; info?: string };
    };

    if (!res.ok || json.error || typeof json.valid !== "boolean") {
      if (json.error) {
        // Solo el tipo y el código: nunca la clave ni el número del paciente.
        console.error(
          "[phoneValidation] Numverify error:",
          sinSecretos(`${json.error.type ?? "desconocido"} (${json.error.code ?? "?"})`, apiKey),
        );
      }
      return null;
    }
    return json.valid;
  } catch (err) {
    console.error(
      "[phoneValidation] fetch error:",
      sinSecretos(err instanceof Error ? err.message : String(err), apiKey),
    );
    return null;
  }
}
