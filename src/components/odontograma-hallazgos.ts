import type {
  MarkConservation,
  MarkStatus,
  OdontogramMark,
  ToothCondition,
} from "@/lib/clinical/odontogram";

export interface HallazgoDePieza {
  condition: ToothCondition;
  status: MarkStatus;
  conservation: MarkConservation | null;
}

export interface PiezaConHallazgos {
  tooth: number;
  /**
   * Condiciones vigentes distintas de "sano", en orden de aparición. Una
   * misma condición aparece una vez por estado: "obturación" existente y
   * "obturación" por realizar son dos cosas distintas para el resumen.
   */
  condiciones: HallazgoDePieza[];
}

/**
 * Piezas con algo registrado para el resumen de la ficha: solo marcas
 * vigentes (las reemplazadas tienen `supersededAt`) y sin "sano", que no es
 * un hallazgo. Ordenadas por número FDI.
 */
export function piezasConHallazgos(marks: OdontogramMark[]): PiezaConHallazgos[] {
  const porPieza = new Map<number, HallazgoDePieza[]>();
  for (const m of marks) {
    if (m.supersededAt || m.condition === "sano") continue;
    const condiciones = porPieza.get(m.toothNumber) ?? [];
    const repetida = condiciones.find((c) => c.condition === m.condition && c.status === m.status);
    if (!repetida) {
      condiciones.push({ condition: m.condition, status: m.status, conservation: m.conservation });
    } else if (m.conservation === "malo") {
      // Con una cara en mal estado, el resumen avisa el mal estado.
      repetida.conservation = "malo";
    }
    porPieza.set(m.toothNumber, condiciones);
  }
  return [...porPieza.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tooth, condiciones]) => ({ tooth, condiciones }));
}
