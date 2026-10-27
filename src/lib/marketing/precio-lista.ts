// src/lib/marketing/precio-lista.ts
//
// Precio de lista de los planes, en USD y en centavos. Fuente única para la
// web (/precios, landing, recorrido, FAQ), la pantalla Suscripción y los
// textos que citan el monto. El cobro real sigue siendo el precio cargado en
// Stripe (STRIPE_PRICE_ID_*): si cambias un monto acá, cambia también el precio
// de Stripe. Decisión de Walter (27-oct-2026): US$19,99 Solo y US$49,99
// Clínica, en USD para todos los países; fundador = 50 % durante 12 meses
// (US$9,99 y US$24,99, cupón FUNDADOR50).
export const PRECIO_SOLO_CENTS = 1999;
export const PRECIO_CLINICA_CENTS = 4999;
export const PRECIO_FUNDADOR_SOLO_CENTS = 999;
export const PRECIO_FUNDADOR_CLINICA_CENTS = 2499;

/** 1999 → "US$19,99"; 2000 → "US$20". */
export function etiquetaUsd(cents: number): string {
  const entero = Math.floor(cents / 100);
  const resto = cents % 100;
  return resto === 0 ? `US$${entero}` : `US$${entero},${String(resto).padStart(2, "0")}`;
}
