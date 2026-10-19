/**
 * Guardia global de vitest: ningún test corre contra la base de producción.
 *
 * Hasta oct-2026 el CI corría la suite contra el Supabase real y dejó ~1.579
 * perfiles basura (hallazgos COD-07 / FN-02, auditoría 360 del 18-oct-2026).
 * Ahora la suite usa una base efímera (`scripts/test-db/start.sh`); si alguna
 * variable de conexión apunta al proyecto de producción o a un pooler de
 * Supabase, la corrida se aborta antes de ejecutar un solo test.
 */

/** Ref del proyecto de producción de Esmalia. */
const REF_PRODUCCION = "hvfkygoguxvpmwslrccb";

/** Variables que los tests (o el código que importan) usan para conectarse. */
export const VARIABLES_DE_CONEXION = [
  "SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "PGHOST",
  "PGHOSTADDR",
  "PGUSER",
  "DATABASE_URL",
] as const;

const PATRONES_PROHIBIDOS = [REF_PRODUCCION, "pooler.supabase.com"];

/** Devuelve las variables que apuntan a producción (vacío si la corrida es segura). */
export function variablesHaciaProduccion(
  env: Record<string, string | undefined>,
): { variable: string; patron: string }[] {
  const hallazgos: { variable: string; patron: string }[] = [];
  for (const variable of VARIABLES_DE_CONEXION) {
    const valor = env[variable]?.toLowerCase();
    if (!valor) continue;
    const patron = PATRONES_PROHIBIDOS.find((p) => valor.includes(p));
    if (patron) hallazgos.push({ variable, patron });
  }
  return hallazgos;
}

export default function guardProduccion() {
  const hallazgos = variablesHaciaProduccion(process.env);
  if (hallazgos.length === 0) return;
  const detalle = hallazgos.map((h) => `  - ${h.variable} contiene "${h.patron}"`).join("\n");
  throw new Error(
    `\n\nTests abortados: la conexión apunta a la base de PRODUCCIÓN.\n${detalle}\n\n` +
      `La suite corre solo contra la base local efímera:\n` +
      `  bash scripts/test-db/start.sh\n` +
      `  set -a; source .env.test; set +a; npm test\n` +
      `Ver docs/TESTS.md.\n`,
  );
}
