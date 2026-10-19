/**
 * Consentimientos informados (CLI-12): lógica pura, sin red ni base.
 *
 * Las plantillas que siembra Esmalia (migración 20261019190000) son un
 * modelo: la interfaz lo dice hasta que alguien de la clínica las marca como
 * revisadas, y nunca promete validez legal.
 */

export type OrigenPlantilla = "clinic" | "esmalia_model";

export type EstadoPlantilla = "propia" | "modelo-sin-revisar" | "modelo-revisado";

export function estadoPlantilla(t: {
  source: OrigenPlantilla;
  reviewedAt: string | null;
}): EstadoPlantilla {
  if (t.source !== "esmalia_model") return "propia";
  return t.reviewedAt ? "modelo-revisado" : "modelo-sin-revisar";
}

export const ETIQUETA_ESTADO_PLANTILLA: Record<EstadoPlantilla, string> = {
  propia: "Propia",
  "modelo-sin-revisar": "Modelo para revisar",
  "modelo-revisado": "Modelo revisado",
};

export const AVISO_MODELO =
  "Texto modelo de Esmalia para que tu clínica lo revise y adapte con su equipo clínico y su asesor legal. No reemplaza esa revisión ni garantiza validez legal en tu país.";

/** Piezas FDI válidas: permanentes 11-48 y temporales 51-85. */
export function esPiezaFdi(n: number): boolean {
  if (!Number.isInteger(n)) return false;
  const cuadrante = Math.floor(n / 10);
  const pieza = n % 10;
  if (cuadrante >= 1 && cuadrante <= 4) return pieza >= 1 && pieza <= 8;
  if (cuadrante >= 5 && cuadrante <= 8) return pieza >= 1 && pieza <= 5;
  return false;
}

/**
 * "11, 21 36" → { piezas: [11, 21, 36], invalidas: [] }. Sin duplicados, en
 * el orden en que se escribieron.
 */
export function leerPiezas(texto: string): { piezas: number[]; invalidas: string[] } {
  const piezas: number[] = [];
  const invalidas: string[] = [];
  for (const token of texto.split(/[\s,;]+/).filter(Boolean)) {
    const n = /^\d{2}$/.test(token) ? Number(token) : NaN;
    if (!esPiezaFdi(n)) {
      invalidas.push(token);
      continue;
    }
    if (!piezas.includes(n)) piezas.push(n);
  }
  return { piezas, invalidas };
}

export type Firmante = "patient" | "guardian";

/**
 * Quién firma por defecto: el paciente, salvo que sea menor de 18 a la fecha.
 * El registro del tutor llega con otro PR (CLI-11); por ahora se anota el
 * nombre y el parentesco de quien firma.
 */
export function firmantePorDefecto(edad: number | null): Firmante {
  return edad !== null && edad < 18 ? "guardian" : "patient";
}

/**
 * Valida lo mínimo antes de mandar la firma. Devuelve el primer problema, o
 * null si se puede firmar. La base vuelve a exigir procedimiento e informante.
 */
export function problemaParaFirmar(c: {
  title: string;
  procedure: string;
  body: string;
  informedByProfessionalId: string;
  signedByName: string;
  signerKind: Firmante;
  signerRelationship: string;
  tieneFirma: boolean;
  piezasInvalidas: string[];
}): string | null {
  if (c.title.trim().length < 2) return "Escribe el título del consentimiento.";
  if (c.procedure.trim().length < 2) return "Indica el procedimiento.";
  if (c.body.trim().length < 10) return "El texto del consentimiento está incompleto.";
  if (!c.informedByProfessionalId) return "Elige el profesional que informó al paciente.";
  if (c.piezasInvalidas.length > 0)
    return `Revisa las piezas (notación FDI): ${c.piezasInvalidas.join(", ")}.`;
  if (c.signedByName.trim().length < 2) return "Escribe el nombre de quien firma.";
  if (c.signerKind === "guardian" && c.signerRelationship.trim().length < 2)
    return "Indica el parentesco o la representación de quien firma.";
  if (!c.tieneFirma) return "Falta la firma.";
  return null;
}
