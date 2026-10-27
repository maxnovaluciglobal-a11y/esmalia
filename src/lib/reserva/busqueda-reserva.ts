/** `?embed=1` y `?r=<token del recall>`. */
export function validarBusquedaReserva(search: Record<string, unknown>): {
  embed?: boolean;
  r?: string;
} {
  const embed = search.embed === true || search.embed === 1 || search.embed === "1";
  const r = typeof search.r === "string" && search.r.length <= 400 ? search.r : undefined;
  return { ...(embed ? { embed: true } : {}), ...(r ? { r } : {}) };
}

export const META_RESERVA = [
  { name: "robots", content: "noindex, nofollow" },
  { name: "referrer", content: "no-referrer" },
];
