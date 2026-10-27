/**
 * Trazabilidad de esterilización (MKT-10, Ola 14): lógica pura.
 *
 * Ciclos de autoclave con sus indicadores y paquetes de instrumental con
 * vencimiento del estéril y el paciente en que se usaron. La base repite
 * cada regla (migración 20261110200100); esto es lo que la pantalla usa para
 * avisar y resumir, probado en `tests/esterilizacion.test.ts`.
 */
import type { ClinicRole } from "@/lib/access/access";
import { numero } from "@/lib/formato-fecha";

export const TIPOS_CICLO = [
  "envuelto",
  "sin_envolver",
  "prion",
  "bowie_dick",
  "helix",
  "prueba_vacio",
  "otro",
] as const;
export type TipoCiclo = (typeof TIPOS_CICLO)[number];

export const ETIQUETA_TIPO: Record<TipoCiclo, string> = {
  envuelto: "Instrumental envuelto",
  sin_envolver: "Instrumental sin envolver",
  prion: "Ciclo priónico",
  bowie_dick: "Prueba Bowie-Dick",
  helix: "Prueba Helix",
  prueba_vacio: "Prueba de vacío",
  otro: "Otro",
};

/** Las pruebas del equipo no llevan paquetes de instrumental. */
export function esPruebaDeEquipo(tipo: string): boolean {
  return tipo === "bowie_dick" || tipo === "helix" || tipo === "prueba_vacio";
}

export const INDICADORES = ["pendiente", "aprobado", "fallido", "no_aplica"] as const;
export type Indicador = (typeof INDICADORES)[number];

export const ETIQUETA_INDICADOR: Record<Indicador, string> = {
  pendiente: "Pendiente",
  aprobado: "Viró bien",
  fallido: "Falló",
  no_aplica: "No aplica",
};

export const ETIQUETA_INDICADOR_BIOLOGICO: Record<Indicador, string> = {
  pendiente: "En incubación",
  aprobado: "Negativo (bien)",
  fallido: "Positivo (falló)",
  no_aplica: "No se usó",
};

export type ResultadoCiclo = "pendiente" | "aprobado" | "fallido";

export const ETIQUETA_RESULTADO: Record<ResultadoCiclo, string> = {
  pendiente: "Pendiente",
  aprobado: "Aprobado",
  fallido: "Fallido",
};

export type EstadoPaquete = "disponible" | "usado" | "descartado" | "retirado";
export type EstadoVisible = EstadoPaquete | "por_vencer" | "vencido";

export const ETIQUETA_ESTADO_PAQUETE: Record<EstadoVisible, string> = {
  disponible: "Disponible",
  por_vencer: "Por vencer",
  vencido: "Vencido",
  usado: "Usado",
  descartado: "Descartado",
  retirado: "Retirado",
};

/** Vida útil del estéril que se ofrece al etiquetar (días). */
export const VIDA_UTIL_OPCIONES = [7, 15, 30, 90, 180] as const;
export const VIDA_UTIL_POR_DEFECTO = 30;
/** Un paquete "por vencer" vence en esta cantidad de días o menos. */
export const DIAS_POR_VENCER = 7;

/** Quién registra ciclos y paquetes (la RLS dice lo mismo). */
export const ROLES_REGISTRAN_ESTERILIZACION: readonly ClinicRole[] = [
  "owner",
  "admin",
  "dentist",
  "assistant",
];

export function puedeRegistrarEsterilizacion(rol: ClinicRole | null | undefined): boolean {
  return Boolean(rol && ROLES_REGISTRAN_ESTERILIZACION.includes(rol));
}

/** Fecha "AAAA-MM-DD" de un instante en la zona de la clínica. */
export function fechaEnZona(iso: string, zona: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Vencimiento del estéril: día del ciclo (hora de la clínica) + vida útil. Igual que la base. */
export function fechaDeVencimiento(runAtIso: string, vidaUtilDias: number, zona: string): string {
  return sumarDias(fechaEnZona(runAtIso, zona), vidaUtilDias);
}

/** Días que faltan para el vencimiento (0 = vence hoy; negativo = vencido). */
export function diasParaVencer(venceEl: string, hoy: string): number {
  return Math.round(
    (Date.parse(`${venceEl}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000,
  );
}

/** Estado que se muestra: un disponible puede estar por vencer o vencido. */
export function estadoVisible(
  p: { status: EstadoPaquete; expiresOn: string },
  hoy: string,
): EstadoVisible {
  if (p.status !== "disponible") return p.status;
  const dias = diasParaVencer(p.expiresOn, hoy);
  if (dias < 0) return "vencido";
  if (dias <= DIAS_POR_VENCER) return "por_vencer";
  return "disponible";
}

/** ¿Se puede usar? Mismo criterio que la base, con el motivo escrito. */
export function motivoParaNoUsar(
  p: { status: EstadoPaquete; expiresOn: string },
  resultadoCiclo: ResultadoCiclo,
  hoy: string,
): string | null {
  if (p.status === "usado") return "Este paquete ya se usó.";
  if (p.status !== "disponible") return "Este paquete está dado de baja.";
  if (resultadoCiclo === "fallido") return "El ciclo de este paquete falló.";
  if (resultadoCiclo !== "aprobado") return "El ciclo de este paquete todavía no está aprobado.";
  if (diasParaVencer(p.expiresOn, hoy) < 0) return "El estéril venció: reprocesa el paquete.";
  return null;
}

/**
 * Resultado que corresponde a los indicadores: fallido si alguno falló;
 * aprobado si el químico viró (o no aplica) y el biológico no falló;
 * pendiente si falta leer el químico.
 */
export function resultadoSegunIndicadores(
  quimico: Indicador,
  biologico: Indicador,
): ResultadoCiclo {
  if (quimico === "fallido" || biologico === "fallido") return "fallido";
  if (quimico === "aprobado" || quimico === "no_aplica") return "aprobado";
  return "pendiente";
}

/** "N.º 12 · 2026" */
export function numeroDeCiclo(c: { number: number; year: number }): string {
  return `N.º ${c.number} · ${c.year}`;
}

/** Parámetros en una línea: "134 °C · 2,1 bar · 5,5 min". */
export function parametrosDeCiclo(c: {
  temperatureC: number | null;
  pressureBar: number | null;
  exposureMinutes: number | null;
}): string {
  const n = (v: number) => numero(v, { maximumFractionDigits: 2 });
  return [
    c.temperatureC !== null ? `${n(c.temperatureC)} °C` : null,
    c.pressureBar !== null ? `${n(c.pressureBar)} bar` : null,
    c.exposureMinutes !== null ? `${n(c.exposureMinutes)} min` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export interface PaqueteResumen {
  id: string;
  cycleId: string;
  code: string;
  status: EstadoPaquete;
  expiresOn: string;
  usedPatientId: string | null;
  usedPatientName: string | null;
  usedAt: string | null;
  usedAppointmentId: string | null;
  usedAppointmentAt: string | null;
}

export interface PacienteRastreado {
  pacienteId: string;
  paciente: string;
  paquetes: { code: string; usadoEn: string; citaEn: string | null }[];
}

/** Pacientes en que se usó instrumental de un ciclo (para avisar si falló). */
export function rastreoDeCiclo(
  cycleId: string,
  paquetes: readonly PaqueteResumen[],
): PacienteRastreado[] {
  const porPaciente = new Map<string, PacienteRastreado>();
  for (const p of paquetes) {
    if (p.cycleId !== cycleId || p.status !== "usado" || !p.usedPatientId || !p.usedAt) continue;
    const r = porPaciente.get(p.usedPatientId) ?? {
      pacienteId: p.usedPatientId,
      paciente: p.usedPatientName ?? "Paciente",
      paquetes: [],
    };
    r.paquetes.push({ code: p.code, usadoEn: p.usedAt, citaEn: p.usedAppointmentAt });
    porPaciente.set(p.usedPatientId, r);
  }
  return [...porPaciente.values()].sort((a, b) => a.paciente.localeCompare(b.paciente, "es"));
}

export interface ResumenEsterilizacion {
  disponibles: number;
  porVencer: number;
  vencidos: number;
  ciclosPeriodo: { aprobados: number; pendientes: number; fallidos: number };
  /** Ciclos fallidos con instrumental ya usado en pacientes: hay que avisar. */
  fallidosConUso: string[];
}

export function resumenEsterilizacion(
  ciclos: readonly { id: string; result: ResultadoCiclo; runAt: string }[],
  paquetes: readonly PaqueteResumen[],
  hoy: string,
  zona: string,
  diasPeriodo = 30,
): ResumenEsterilizacion {
  const r: ResumenEsterilizacion = {
    disponibles: 0,
    porVencer: 0,
    vencidos: 0,
    ciclosPeriodo: { aprobados: 0, pendientes: 0, fallidos: 0 },
    fallidosConUso: [],
  };
  for (const p of paquetes) {
    const e = estadoVisible(p, hoy);
    if (e === "disponible") r.disponibles++;
    else if (e === "por_vencer") {
      r.disponibles++;
      r.porVencer++;
    } else if (e === "vencido") r.vencidos++;
  }
  const desde = sumarDias(hoy, -diasPeriodo);
  const usados = new Set(paquetes.filter((p) => p.status === "usado").map((p) => p.cycleId));
  for (const c of ciclos) {
    if (c.result === "fallido" && usados.has(c.id)) r.fallidosConUso.push(c.id);
    if (fechaEnZona(c.runAt, zona) < desde) continue;
    if (c.result === "aprobado") r.ciclosPeriodo.aprobados++;
    else if (c.result === "fallido") r.ciclosPeriodo.fallidos++;
    else r.ciclosPeriodo.pendientes++;
  }
  return r;
}

/** El código escrito o escaneado ("e2026-12" → "E2026-00012"). */
export function normalizarCodigo(texto: string): string {
  const t = texto.trim().toUpperCase().replace(/\s+/g, "");
  const m = /^E?(\d{4})-?(\d{1,7})$/.exec(t);
  if (!m) return t;
  return `E${m[1]}-${m[2].padStart(5, "0")}`;
}
