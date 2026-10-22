/**
 * MKT-01: aviso GES dental (Chile). Las Garantías Explícitas en Salud cubren
 * la salud oral integral de tres grupos: embarazadas, niños y niñas de 6 años
 * y personas de 60 años. Esmalia avisa para que la clínica oriente al
 * paciente; no tramita la garantía ni emite el formulario (eso queda para
 * una ola posterior: formulario y PDF de derivación).
 *
 * Lógica pura (tests/ges.test.ts). Solo aplica a clínicas de Chile.
 */

export const URL_GES_SALUD_BUCAL =
  "https://www.minsal.cl/garantias-explicitas-en-salud-salud-bucal/";

export type MotivoGes = "embarazo" | "seis_anios" | "sesenta_anios";

export const ETIQUETA_MOTIVO_GES: Record<MotivoGes, string> = {
  embarazo: "GES embarazada",
  seis_anios: "GES 6 años",
  sesenta_anios: "GES 60 años",
};

export const EXPLICACION_MOTIVO_GES: Record<MotivoGes, string> = {
  embarazo:
    "La salud oral integral de la embarazada está garantizada por el GES. Orienta a la paciente a pedir la atención en su consultorio o con su isapre.",
  seis_anios:
    "Niños y niñas de 6 años tienen garantizada la salud oral integral (examen, prevención y tratamiento) por el GES.",
  sesenta_anios:
    "Las personas de 60 años tienen garantizada la salud oral integral, incluida la prótesis removible si corresponde, por el GES.",
};

/** Edad cumplida en años a la fecha `hoy` (ambas YYYY-MM-DD), o null si no se puede calcular. */
export function edadCumplida(
  fechaNacimiento: string | null | undefined,
  hoy: string,
): number | null {
  if (!fechaNacimiento || !/^\d{4}-\d{2}-\d{2}/.test(fechaNacimiento)) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(hoy)) return null;
  const [an, mn, dn] = fechaNacimiento.slice(0, 10).split("-").map(Number);
  const [ah, mh, dh] = hoy.slice(0, 10).split("-").map(Number);
  let edad = ah - an;
  if (mh < mn || (mh === mn && dh < dn)) edad -= 1;
  return edad >= 0 ? edad : null;
}

export interface DatosGes {
  /** País de la clínica (ISO-2). El GES es chileno. */
  pais: string | null | undefined;
  fechaNacimiento: string | null | undefined;
  /** Hoy en la zona horaria de la clínica (YYYY-MM-DD). */
  hoy: string;
  /** true si la anamnesis dice embarazo; null/undefined si no se sabe. */
  embarazada?: boolean | null;
}

/** Motivos GES que aplican al paciente hoy (vacío si ninguno). */
export function motivosGes(d: DatosGes): MotivoGes[] {
  if ((d.pais ?? "").toUpperCase() !== "CL") return [];
  const motivos: MotivoGes[] = [];
  if (d.embarazada === true) motivos.push("embarazo");
  const edad = edadCumplida(d.fechaNacimiento, d.hoy);
  if (edad === 6) motivos.push("seis_anios");
  if (edad === 60) motivos.push("sesenta_anios");
  return motivos;
}

/**
 * Rango de fechas de nacimiento de quien tiene `edad` años cumplidos el día
 * `hoy`: [desde, hasta] inclusive. Para pedírselo a la base sin traer a
 * todos los pacientes. Ejemplo: 6 años al 2026-10-22 → nacidos entre
 * 2019-10-23 y 2020-10-22.
 */
export function rangoDeNacimientoParaEdad(
  edad: number,
  hoy: string,
): { desde: string; hasta: string } {
  const [a, m, d] = hoy.slice(0, 10).split("-").map(Number);
  const hasta = fechaISO(a - edad, m, d);
  const desdeBase = new Date(`${fechaISO(a - edad - 1, m, d)}T00:00:00Z`);
  desdeBase.setUTCDate(desdeBase.getUTCDate() + 1);
  return { desde: desdeBase.toISOString().slice(0, 10), hasta };
}

function fechaISO(anio: number, mes: number, dia: number): string {
  // 29 de febrero en un año no bisiesto → 28 de febrero.
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const d = Math.min(dia, ultimo);
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
