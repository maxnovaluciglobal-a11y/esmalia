/**
 * Conversión de USD a monedas locales LATAM para mostrar como referencia
 * junto al precio en dólares. PURAMENTE DECORATIVO / INFORMATIVO.
 *
 * Esto NO es dinero real de la app (no tiene nada que ver con `finance.ts`,
 * `formatMoney`, ni con montos cobrados por Stripe). El cobro real es por
 * uno de los dos precios de lista definidos en `src/lib/stripe.server.ts`
 * ("solo" US$29/mes, "clínica" US$69/mes, ambos con trial de 14 días) —
 * este archivo no debe tocarse ni usarse para calcular nada que afecte un cobro.
 *
 * Tipos de cambio APROXIMADOS, cargados a mano el 2026-08-22 (cotización
 * spot USD/CLP, USD/MXN, USD/COP consultada ese día). Fluctúan a diario —
 * esto es solo para que el usuario tenga una idea de magnitud, no una
 * cotización exacta. Sería sobre-ingeniería conectar una API de tipo de
 * cambio en vivo para un dato secundario como este. Actualizar de tanto en
 * tanto (cada 2-3 meses está bien) editando los valores de abajo.
 */
const USD_TO_LOCAL_APPROX = {
  CLP: 920,
  MXN: 17,
  COP: 3080,
} as const;

/** Redondea a un número "lindo" para reforzar que es una cifra aproximada. */
function roundApprox(value: number): number {
  if (value >= 100_000) return Math.round(value / 1000) * 1000;
  if (value >= 1_000) return Math.round(value / 100) * 100;
  return Math.round(value / 10) * 10;
}

function formatLocal(value: number): string {
  return new Intl.NumberFormat("es-CL").format(value);
}

/**
 * Devuelve un string tipo "≈ $45.200 CLP · $830 MXN · $150.900 COP" para
 * un precio en USD. Pensado para ir como texto secundario/chico al lado
 * del precio real en USD, nunca reemplazándolo.
 */
export function approxLocalPricesLabel(usd: number): string {
  const clp = roundApprox(usd * USD_TO_LOCAL_APPROX.CLP);
  const mxn = roundApprox(usd * USD_TO_LOCAL_APPROX.MXN);
  const cop = roundApprox(usd * USD_TO_LOCAL_APPROX.COP);
  return `≈ $${formatLocal(clp)} CLP · $${formatLocal(mxn)} MXN · $${formatLocal(cop)} COP`;
}

/** Monedas del selector de precios de la landing. COP se sumó el 07-oct-2026
 *  (Colombia estaba en la lista de países pero no en el selector). ARS no:
 *  Argentina ve USD, ver `monedaPorPais` en marketing/pais-visitante.ts. */
export type MonedaPrecio = "CLP" | "PEN" | "MXN" | "COP" | "USD";
export const MONEDAS_PRECIO: readonly MonedaPrecio[] = ["CLP", "PEN", "MXN", "COP", "USD"];

/** PEN se sumó el 06-oct-2026 para el selector de la landing (aprox. 3,7). */
const USD_TO_PEN_APPROX = 3.7;

/**
 * Precio mensual mostrado en la moneda elegida. Mismo carácter decorativo
 * que `approxLocalPricesLabel`: el cobro real sigue siendo en USD.
 */
export function precioEnMoneda(usd: number, moneda: MonedaPrecio): string {
  if (moneda === "USD") return `US$${usd}`;
  const tasa =
    moneda === "PEN"
      ? USD_TO_PEN_APPROX
      : USD_TO_LOCAL_APPROX[moneda as keyof typeof USD_TO_LOCAL_APPROX];
  const valor = roundApprox(usd * tasa);
  return moneda === "PEN" ? `S/ ${formatLocal(valor)}` : `$${formatLocal(valor)}`;
}
