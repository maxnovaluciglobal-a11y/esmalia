/**
 * Bono Fonasa / isapre con copago (MKT-03, Ola 3).
 *
 * Registro manual, sin integración con IMED: la recepción anota el bono que
 * trae el paciente y Esmalia calcula cuánto paga él (el copago).
 *
 * - Fonasa MLE (Modalidad Libre Elección) o isapre: el bono cubre un monto;
 *   copago = precio de la prestación − monto del bono.
 * - PAD dental de Fonasa (Pago Asociado a Diagnóstico): el paquete tiene un
 *   precio fijo y un copago fijo; lo que cubre el bono es la diferencia.
 *
 * Todo en cents (regla 6). La moneda la fija la base (regla 14).
 */

export const TIPOS_DE_BONO = ["fonasa_mle", "fonasa_pad", "isapre"] as const;
export type TipoDeBono = (typeof TIPOS_DE_BONO)[number];

export const TIPO_DE_BONO_LABEL: Record<TipoDeBono, string> = {
  fonasa_mle: "Bono Fonasa (libre elección)",
  fonasa_pad: "PAD dental Fonasa",
  isapre: "Bono isapre",
};

/** Nombre que queda como medio de pago de la parte del bono. */
export const MEDIO_DEL_BONO: Record<TipoDeBono, string> = {
  fonasa_mle: "Bono Fonasa",
  fonasa_pad: "PAD Fonasa",
  isapre: "Bono isapre",
};

export const TRAMOS_FONASA = ["A", "B", "C", "D"] as const;
export type TramoFonasa = (typeof TRAMOS_FONASA)[number];

export type EntradaBono =
  | {
      tipo: "fonasa_mle" | "isapre";
      /** Precio de la prestación que se cobra. */
      precioCents: number | null;
      /** Monto que cubre el bono. */
      bonoCents: number | null;
    }
  | {
      tipo: "fonasa_pad";
      /** Precio fijo del paquete PAD. */
      precioCents: number | null;
      /** Copago fijo del paquete para el tramo del paciente. */
      copagoCents: number | null;
    };

export type ResultadoBono =
  | { ok: true; precioCents: number; bonoCents: number; copagoCents: number }
  | { ok: false; motivo: string };

function entero(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

/** Desglose del cobro: cuánto cubre el bono y cuánto paga el paciente. */
export function calcularCopago(e: EntradaBono): ResultadoBono {
  if (!entero(e.precioCents) || e.precioCents <= 0)
    return { ok: false, motivo: "Ingresa el precio de la prestación." };

  if (e.tipo === "fonasa_pad") {
    if (!entero(e.copagoCents) || e.copagoCents < 0)
      return { ok: false, motivo: "Ingresa el copago fijo del PAD." };
    if (e.copagoCents >= e.precioCents)
      return { ok: false, motivo: "El copago del PAD tiene que ser menor que su precio." };
    return {
      ok: true,
      precioCents: e.precioCents,
      bonoCents: e.precioCents - e.copagoCents,
      copagoCents: e.copagoCents,
    };
  }

  if (!entero(e.bonoCents) || e.bonoCents <= 0)
    return { ok: false, motivo: "Ingresa el monto que cubre el bono." };
  if (e.bonoCents > e.precioCents)
    return { ok: false, motivo: "El bono no puede cubrir más que el precio de la prestación." };
  return {
    ok: true,
    precioCents: e.precioCents,
    bonoCents: e.bonoCents,
    copagoCents: e.precioCents - e.bonoCents,
  };
}

/**
 * Un bono de Fonasa en libre elección o un PAD no corresponde al tramo A
 * (que se atiende en la red pública, Modalidad de Atención Institucional).
 * Es un aviso, no un bloqueo: el registro es manual y la recepción sabe lo
 * que tiene en la mano.
 */
export function avisoDeTramo(tipo: TipoDeBono, tramo: TramoFonasa | null): string | null {
  if (tipo !== "isapre" && tramo === "A")
    return "El tramo A de Fonasa se atiende en la red pública: revisa que el bono corresponda.";
  return null;
}

/** Tipo de bono que se propone según la previsión de la ficha. */
export function tipoSugerido(prevision: string | null | undefined): TipoDeBono {
  return prevision === "isapre" ? "isapre" : "fonasa_mle";
}

/** Filas de `payments` que genera el cobro: la del bono y, si hay copago, la del paciente. */
export function partesDelCobro(r: Extract<ResultadoBono, { ok: true }>): {
  rol: "bono" | "copago";
  montoCents: number;
}[] {
  const partes: { rol: "bono" | "copago"; montoCents: number }[] = [
    { rol: "bono", montoCents: r.bonoCents },
  ];
  if (r.copagoCents > 0) partes.push({ rol: "copago", montoCents: r.copagoCents });
  return partes;
}
