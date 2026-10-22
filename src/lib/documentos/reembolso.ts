/**
 * Formulario de reembolso para seguro complementario (MKT-04): de las
 * prestaciones y los pagos de la ficha, las filas del período. Lógica pura;
 * la carga de datos está en `contexto.server.ts`.
 *
 * Qué entra:
 * - Prestaciones: ítems de los planes del paciente marcados como realizados
 *   (`completed`) con fecha de realización dentro del período, en el día de
 *   la clínica.
 * - Monto pagado de cada prestación: los pagos imputados a ese ítem, sin los
 *   reversados. Si no hay ninguno imputado, "—" (no se reparte un pago "al
 *   plan" entre ítems: sería inventar el monto).
 * - Total pagado en el período: todos los pagos del paciente con fecha dentro
 *   del período, sin los reversados (incluye los pagos "al plan").
 */
import { diaISO } from "@/lib/formato-fecha";
import type { FilaReembolso } from "@/lib/documentos/variables";

export interface PrestacionRealizada {
  id: string;
  /** Instante en que se marcó realizada. */
  completadaEn: string | null;
  nombre: string;
  pieza: number | null;
  codigoFonasa: string | null;
}

export interface PagoDelPaciente {
  treatmentItemId: string | null;
  montoCents: number;
  pagadoEn: string;
  reversado: boolean;
}

const FECHA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

export function periodoValido(desde: string | null | undefined, hasta: string | null | undefined) {
  return Boolean(
    desde && hasta && FECHA_CIVIL.test(desde) && FECHA_CIVIL.test(hasta) && desde <= hasta,
  );
}

export function armarReembolso(args: {
  prestaciones: readonly PrestacionRealizada[];
  pagos: readonly PagoDelPaciente[];
  desde: string;
  hasta: string;
  zona: string;
}): { filas: FilaReembolso[]; totalPagadoCents: number } {
  const { desde, hasta, zona } = args;
  const dentro = (instante: string | null) => {
    const dia = diaISO(instante, zona);
    return dia !== null && dia >= desde && dia <= hasta;
  };

  const pagadoPorItem = new Map<string, number>();
  let total = 0;
  for (const p of args.pagos) {
    if (p.reversado) continue;
    if (p.treatmentItemId) {
      pagadoPorItem.set(
        p.treatmentItemId,
        (pagadoPorItem.get(p.treatmentItemId) ?? 0) + p.montoCents,
      );
    }
    if (dentro(p.pagadoEn)) total += p.montoCents;
  }

  const filas: FilaReembolso[] = args.prestaciones
    .filter((x) => dentro(x.completadaEn))
    .map((x) => ({
      fecha: diaISO(x.completadaEn, zona) ?? desde,
      prestacion: x.nombre.trim(),
      pieza: x.pieza,
      codigoFonasa: x.codigoFonasa?.trim() || null,
      pagadoCents: pagadoPorItem.has(x.id) ? (pagadoPorItem.get(x.id) ?? 0) : null,
    }))
    .sort(
      (a, b) => a.fecha.localeCompare(b.fecha) || a.prestacion.localeCompare(b.prestacion, "es"),
    );

  return { filas, totalPagadoCents: total };
}
