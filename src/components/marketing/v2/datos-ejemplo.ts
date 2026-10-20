// Datos de ejemplo de la landing A+ (/v2). Todo es ficticio y la UI lo dice
// ("Ejemplo", "pacientes ficticios"): no lee Supabase ni el portal.
//
// La fecha es fija (lunes 19 de octubre de 2026) a propósito: calcular "hoy"
// en el render daría un día distinto en el servidor (UTC) y en el navegador,
// y rompería la hidratación (regla 7 del CLAUDE.md).

export type EstadoEjemplo = "done" | "chair" | "ok" | "pend" | "miss" | "gap";

/** Una cita (o un hueco) en la línea de un sillón: [inicio, fin, nombre, detalle, estado]. */
export type CitaEjemplo = readonly [string, string, string, string, EstadoEjemplo];

export type SillonEjemplo = {
  sillon: string;
  profesional: string;
  citas: readonly CitaEjemplo[];
};

/** Monto que se pierde por cada hueco de 45 min (CLP, ejemplo). */
export const VALOR_HUECO_CLP = 45_000;

export const DIA_EJEMPLO = {
  etiqueta: "lunes 19 de octubre",
  corto: "Lunes 19",
  ahora: "11:40",
  inicio: 8,
  fin: 19,
  colacion: ["13:00", "14:00"] as const,
} as const;

export const SILLONES_HOY: readonly SillonEjemplo[] = [
  {
    sillon: "Sillón 1",
    profesional: "Dra. Paz Rojas",
    citas: [
      ["08:30", "09:30", "R. Fernández", "Control", "done"],
      ["09:30", "10:45", "M. Soto", "Endodoncia 36", "done"],
      ["10:45", "12:00", "C. Muñoz", "Corona 26 · en sillón", "chair"],
      ["12:00", "12:45", "Hueco · 45 min", "~$45.000", "gap"],
      ["14:00", "15:00", "P. Lagos", "Evaluación", "ok"],
      ["15:00", "16:30", "V. Reyes", "Implante 46", "ok"],
      ["16:30", "17:15", "F. Castro", "Control · por confirmar", "pend"],
      ["17:30", "18:30", "D. Ortiz", "Blanqueamiento", "ok"],
    ],
  },
  {
    sillon: "Sillón 2",
    profesional: "Dr. Tomás Vidal",
    citas: [
      ["09:00", "09:30", "A. Rojas", "Control ortodoncia", "done"],
      ["09:30", "10:00", "B. Vera", "No asistió", "miss"],
      ["10:00", "11:00", "N. Silva", "Brackets", "done"],
      ["11:30", "12:15", "I. Torres", "Control · en sillón", "chair"],
      ["12:15", "13:00", "K. Díaz", "Control", "ok"],
      ["15:00", "16:00", "S. Morales", "Evaluación", "ok"],
      ["16:00", "17:30", "E. Navarro", "Brackets · por confirmar", "pend"],
      ["17:30", "18:15", "J. Araya", "Control", "ok"],
    ],
  },
  {
    sillon: "Sillón 3",
    profesional: "Dra. Camila Fuentes",
    citas: [
      ["09:00", "10:00", "T. Paredes", "Sellantes", "done"],
      ["10:30", "11:30", "G. Bravo", "Obturación 85", "done"],
      ["11:30", "12:30", "M. Henríquez", "Control · en sillón", "chair"],
      ["14:30", "15:30", "A. Contreras", "Flúor", "ok"],
      ["15:30", "16:15", "Hueco · 45 min", "~$45.000", "gap"],
      ["16:15", "17:00", "L. Gómez", "Control · por confirmar", "pend"],
    ],
  },
];

export function minutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

export function hora(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Cifras del día salidas de los mismos datos que se dibujan (así cuadran). */
export function resumenDelDia(sillones: readonly SillonEjemplo[], ahora: string) {
  const todas = sillones.flatMap((s) => s.citas);
  const citas = todas.filter((c) => c[4] !== "gap");
  const huecos = todas.filter((c) => c[4] === "gap").length;
  const proxima = sillones
    .flatMap((s) => s.citas.filter((c) => c[4] !== "gap"))
    .filter((c) => minutos(c[0]) > minutos(ahora))
    .sort((a, b) => minutos(a[0]) - minutos(b[0]))[0];
  return {
    citas: citas.length,
    confirmadas: citas.filter((c) => c[4] === "ok" || c[4] === "chair" || c[4] === "done").length,
    porConfirmar: citas.filter((c) => c[4] === "pend").length,
    ausentes: citas.filter((c) => c[4] === "miss").length,
    huecos,
    porLlenarClp: huecos * VALOR_HUECO_CLP,
    proxima,
  };
}

/** "$90.000". A mano y no con Intl: así el servidor y el navegador dan
 *  exactamente el mismo texto (hidratación). */
export function formatoClp(monto: number): string {
  return `$${String(Math.round(monto)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}
