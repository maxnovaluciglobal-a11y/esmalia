/**
 * Contadores de citas de la ficha (FIC-12, Ola 2). Lógica pura: la fila
 * viene de la RPC `patient_appointment_counters` (agregada en Postgres, con
 * la RLS de quien llama).
 */

export interface ContadoresDeCitas {
  atendidas: number;
  inasistencias: number;
  anuladas: number;
  proximas: number;
  /** Ya terminaron y siguen sin cerrar (PAN-05). */
  sinCerrar: number;
  /** % de inasistencia sobre las citas con desenlace (atendidas + inasistencias).
   * `null` sin ninguna: regla 11, no un 0 % que se lee como "nunca falta". */
  pctInasistencia: number | null;
  ultimaVisita: string | null;
  proximaCita: string | null;
}

export interface FilaContadores {
  attended: number | null;
  no_show: number | null;
  cancelled: number | null;
  upcoming: number | null;
  past_open: number | null;
  last_visit_at: string | null;
  next_at: string | null;
}

/** % entero de inasistencia, o null si todavía no hay citas con desenlace. */
export function porcentajeInasistencia(atendidas: number, inasistencias: number): number | null {
  const base = atendidas + inasistencias;
  if (base <= 0) return null;
  return Math.round((inasistencias / base) * 100);
}

export function contadoresDesdeFila(fila: FilaContadores | null | undefined): ContadoresDeCitas {
  const atendidas = fila?.attended ?? 0;
  const inasistencias = fila?.no_show ?? 0;
  return {
    atendidas,
    inasistencias,
    anuladas: fila?.cancelled ?? 0,
    proximas: fila?.upcoming ?? 0,
    sinCerrar: fila?.past_open ?? 0,
    pctInasistencia: porcentajeInasistencia(atendidas, inasistencias),
    ultimaVisita: fila?.last_visit_at ?? null,
    proximaCita: fila?.next_at ?? null,
  };
}

/** Nota bajo "Inasistencias": "12 % de sus citas" o "Sin datos". */
export function notaInasistencia(c: Pick<ContadoresDeCitas, "pctInasistencia">): string {
  return c.pctInasistencia === null ? "Sin datos" : `${c.pctInasistencia} % de sus citas`;
}
