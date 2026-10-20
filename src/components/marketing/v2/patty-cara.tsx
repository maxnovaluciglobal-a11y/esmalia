import { PattyCara as PattyCaraCompartida, type PattyCaraProps } from "@/components/patty-cara";

/**
 * Patty como personaje en la landing A+: la cara compartida
 * (`src/components/patty-cara.tsx`) con el estilo de `landing-v2.css`
 * (`.lv-patty-cara`), que se mantiene autocontenido.
 */
export function PattyCara(props: Omit<PattyCaraProps, "estilo">) {
  return <PattyCaraCompartida {...props} estilo="landing" />;
}
