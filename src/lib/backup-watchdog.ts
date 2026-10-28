/**
 * Vigía del backup diario (P1 de la transferencia, 28-oct-2026).
 *
 * El workflow `backup.yml` ya abre un Issue si UN run falla, pero no avisa si
 * el backup no corre o llega muy tarde: GitHub Actions dispara el cron de las
 * 07:15 UTC entre 5 y 7 h tarde (12:01-14:19 UTC en las 8 corridas programadas
 * del 20 al 27-oct, API pública de GitHub) y desactiva los workflows
 * programados tras 60 días sin actividad en el repo. Sin esta vigilancia, un
 * backup roto o ausente se descubre el día que hace falta restaurar.
 *
 * Esta pieza es PURA (sin red ni reloj propio) para poder testearla: decide
 * si el backup está al día a partir de las corridas que le pasan.
 */

/**
 * Horas sin un backup exitoso a partir de las cuales se avisa. NO es 25 h: el
 * cron llega entre 5 y 7 h tarde y con retraso variable, así que entre dos
 * corridas programadas seguidas pasaron hasta 25,7 h sin que nada estuviera mal
 * (12:35 UTC del 25-oct → 14:18 UTC del 26-oct; API pública de GitHub). Con
 * 25 h habría falsas alarmas. 32 h deja 6 h de margen sobre el peor caso
 * observado y sigue significando «se saltó al menos un ciclo entero».
 */
export const MAX_HORAS_SIN_BACKUP = 32;

/** Cada cuántas horas UTC se repite el correo mientras siga el problema (sin estado). */
export const REPETIR_AVISO_CADA_HORAS = 6;

export type CorridaDeBackup = {
  /** `success`, `failure`, `cancelled`… o null si sigue en curso. */
  conclusion: string | null;
  /** `completed`, `in_progress`, `queued`… */
  status: string;
  /** ISO 8601: cuándo terminó (o su última actualización). */
  updated_at: string;
  html_url?: string;
};

export type EstadoDelBackup =
  | { estado: "ok"; horasDesdeElUltimoExito: number; ultimoExito: string }
  | {
      estado: "atrasado";
      /** null si no hay ninguna corrida exitosa entre las que se miraron. */
      horasDesdeElUltimoExito: number | null;
      ultimoExito: string | null;
      /** El último run terminado, si falló, para decir por qué sigue atrasado. */
      ultimaFalla: CorridaDeBackup | null;
      /** Hay un run en curso ahora mismo (puede estar por terminar). */
      enCurso: boolean;
    };

/**
 * `corridas`: las más recientes del workflow `backup.yml`, en cualquier orden.
 * Un run en curso no cuenta como éxito: hasta que termina no hay backup nuevo.
 */
export function evaluarFrescuraDelBackup(
  corridas: readonly CorridaDeBackup[],
  ahora: Date,
  maxHoras: number = MAX_HORAS_SIN_BACKUP,
): EstadoDelBackup {
  const t = (c: CorridaDeBackup) => Date.parse(c.updated_at);
  const validas = corridas.filter((c) => Number.isFinite(t(c)));
  const exitos = validas
    .filter((c) => c.status === "completed" && c.conclusion === "success")
    .sort((a, b) => t(b) - t(a));
  const fallas = validas
    .filter((c) => c.status === "completed" && c.conclusion !== "success")
    .sort((a, b) => t(b) - t(a));
  const enCurso = validas.some((c) => c.status !== "completed");

  const ultimo = exitos[0];
  const horas = ultimo ? (ahora.getTime() - t(ultimo)) / 3_600_000 : null;
  if (ultimo && horas !== null && horas <= maxHoras) {
    return { estado: "ok", horasDesdeElUltimoExito: horas, ultimoExito: ultimo.updated_at };
  }

  // La falla solo se menciona si es más nueva que el último éxito.
  const falla = fallas[0];
  const fallaVigente = falla && (!ultimo || t(falla) > t(ultimo)) ? falla : null;
  return {
    estado: "atrasado",
    horasDesdeElUltimoExito: horas,
    ultimoExito: ultimo ? ultimo.updated_at : null,
    ultimaFalla: fallaVigente,
    enCurso,
  };
}

/**
 * ¿Toca mandar el correo en esta corrida horaria? Sin estado en la base: el
 * vigía corre cada hora y, mientras el problema siga, escribe solo en las
 * horas UTC múltiplo de `cada` (4 veces al día con 6), no 24.
 */
export function tocaAvisar(ahora: Date, cada: number = REPETIR_AVISO_CADA_HORAS): boolean {
  return ahora.getUTCHours() % cada === 0;
}

const fmtHoras = (h: number | null) =>
  h === null ? "sin ningún backup exitoso reciente" : `${Math.floor(h)} h`;

/** Asunto y cuerpo del aviso. Texto plano y HTML mínimo; nada sensible. */
export function armarAviso(
  estado: Extract<EstadoDelBackup, { estado: "atrasado" }>,
  repo: string,
): { asunto: string; texto: string; html: string } {
  const lineas = [
    `El backup diario de Esmalia no tiene una corrida exitosa desde hace ${fmtHoras(estado.horasDesdeElUltimoExito)} (límite: ${MAX_HORAS_SIN_BACKUP} h).`,
    estado.ultimoExito
      ? `Último backup exitoso: ${estado.ultimoExito}.`
      : "No se encontró ningún backup exitoso entre las últimas corridas.",
    estado.ultimaFalla
      ? `Hubo una corrida fallida más reciente: ${estado.ultimaFalla.html_url ?? estado.ultimaFalla.updated_at}.`
      : "No hay una corrida fallida más reciente: simplemente no corrió o no terminó.",
    estado.enCurso ? "Hay una corrida en curso ahora mismo: puede resolverse sola en minutos." : "",
    `Qué hacer: abrir https://github.com/${repo}/actions/workflows/backup.yml y, si no hay una corrida reciente, lanzar «Run workflow». Guía: docs/BACKUPS.md → «Si el backup no corre».`,
  ].filter(Boolean);
  const asunto = "🔴 Esmalia: el backup diario está atrasado";
  return {
    asunto,
    texto: lineas.join("\n"),
    html: lineas.map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join(""),
  };
}
