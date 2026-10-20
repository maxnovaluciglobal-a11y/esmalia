// src/lib/admin/salud-clinica.ts
//
// Salud de una clínica piloto para `/admin/clinicas` (auditoría 360, CS-09):
// con 3 a 5 pilotos cada señal cuenta, y sin un registro sistemático no hay
// cómo saber a quién escribirle antes de que se vaya. Puro (sin red ni base)
// para poder testearlo.
//
// Semáforo (definición de la auditoría):
//   verde    ≥ 10 citas creadas en 7 días y ≥ 2 usuarios que entraron en 7 días
//   amarillo 1-9 citas, o un solo usuario activo
//   rojo     0 citas en 7 días, o el dueño sin entrar hace 5 días o más
// Una clínica con menos de 3 días de alta no se califica ("nueva"): no se le
// muestra un rojo a quien todavía no tuvo tiempo de empezar (regla 11: no
// fabricar un valor cuando no hay dato).

export type Semaforo = "verde" | "amarillo" | "rojo" | "nueva";

export type InsumosSalud = {
  createdAt: string;
  citasUltimos7Dias: number;
  /** Miembros que iniciaron sesión en los últimos 7 días. */
  usuariosActivos7Dias: number;
  /** Último inicio de sesión de un dueño; `null` si nunca entró. */
  ultimoLoginDueno: string | null;
};

export const DIAS_CLINICA_NUEVA = 3;
export const DIAS_SIN_ENTRAR_ROJO = 5;
export const CITAS_VERDE = 10;
export const USUARIOS_VERDE = 2;
export const HORAS_LLAMADA_PENDIENTE = 24;

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

export function semaforoDeSalud(i: InsumosSalud, ahora: Date = new Date()): Semaforo {
  const edad = ahora.getTime() - new Date(i.createdAt).getTime();
  if (edad < DIAS_CLINICA_NUEVA * DIA_MS) return "nueva";

  const sinEntrar =
    i.ultimoLoginDueno === null ||
    ahora.getTime() - new Date(i.ultimoLoginDueno).getTime() >= DIAS_SIN_ENTRAR_ROJO * DIA_MS;
  if (i.citasUltimos7Dias === 0 || sinEntrar) return "rojo";
  if (i.citasUltimos7Dias >= CITAS_VERDE && i.usuariosActivos7Dias >= USUARIOS_VERDE)
    return "verde";
  return "amarillo";
}

/**
 * Horas desde el alta cuando la clínica sigue sin llamada de puesta en marcha
 * y ya pasó el plazo de 24 h (el contacto humano de la primera semana es lo
 * que más mueve la activación). `null` si no hay nada que avisar: ya tuvo la
 * llamada, ya se suscribió, o todavía no pasó el plazo.
 */
export function horasConLlamadaPendiente(
  d: { createdAt: string; onboardingCallAt: string | null; suscrita: boolean },
  ahora: Date = new Date(),
): number | null {
  if (d.onboardingCallAt || d.suscrita) return null;
  const horas = Math.floor((ahora.getTime() - new Date(d.createdAt).getTime()) / HORA_MS);
  return horas >= HORAS_LLAMADA_PENDIENTE ? horas : null;
}

/** "hace 3 h", "hace 2 d": la antigüedad de una fecha para mostrar en la fila. */
export function hace(iso: string | null, ahora: Date = new Date()): string {
  if (!iso) return "nunca";
  const ms = Math.max(0, ahora.getTime() - new Date(iso).getTime());
  if (ms < HORA_MS) return "hace menos de 1 h";
  if (ms < DIA_MS) return `hace ${Math.floor(ms / HORA_MS)} h`;
  return `hace ${Math.floor(ms / DIA_MS)} d`;
}
