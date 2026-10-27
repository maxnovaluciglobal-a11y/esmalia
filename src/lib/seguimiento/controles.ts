/**
 * FIC-13 y REC-08 · Controles (Ola 8). Lógica pura:
 *  - la fecha de un control "en N meses" a partir de hoy (día de la clínica);
 *  - la lista de controles pendientes, que junta los programados a mano desde
 *    la ficha con el recall automático que ya calcula /recordatorios
 *    (`hygiene_recall`), sin repetir pacientes y con lo vencido arriba.
 */

export type EstadoControl = "pendiente" | "agendado" | "cumplido" | "descartado";

export const ETIQUETA_ESTADO_CONTROL: Record<EstadoControl, string> = {
  pendiente: "Pendiente",
  agendado: "Agendado",
  cumplido: "Cumplido",
  descartado: "Descartado",
};

/** Meses que se ofrecen en el diálogo de la ficha. */
export const MESES_DE_CONTROL = [1, 3, 6, 12] as const;

/** Días antes del vencimiento en que un control ya aparece "por vencer". */
export const DIAS_AVISO_CONTROL = 30;

const ISO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` + N meses, con el día ajustado al último del mes si no existe (31-ene + 1 = 28/29-feb). */
export function sumarMeses(diaISO: string, meses: number): string {
  const m = ISO_DIA.exec(diaISO);
  if (!m) throw new Error(`Fecha inválida: ${diaISO}`);
  const anio = Number(m[1]);
  const mes = Number(m[2]) - 1 + Math.trunc(meses);
  const dia = Number(m[3]);
  const anioFinal = anio + Math.floor(mes / 12);
  const mesFinal = ((mes % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(anioFinal, mesFinal + 1, 0)).getUTCDate();
  const d = Math.min(dia, ultimoDia);
  return `${anioFinal}-${String(mesFinal + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** `YYYY-MM-DD` + N días. */
export function sumarDias(diaISO: string, dias: number): string {
  const m = ISO_DIA.exec(diaISO);
  if (!m) throw new Error(`Fecha inválida: ${diaISO}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Días entre dos fechas `YYYY-MM-DD` (b − a). */
export function diasEntre(a: string, b: string): number {
  const ma = ISO_DIA.exec(a);
  const mb = ISO_DIA.exec(b);
  if (!ma || !mb) return 0;
  const ta = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
  const tb = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
  return Math.round((tb - ta) / 86_400_000);
}

export type Vencimiento = "vencido" | "por_vencer" | "mas_adelante";

export function vencimientoDe(
  dueOn: string,
  hoy: string,
  diasAviso = DIAS_AVISO_CONTROL,
): Vencimiento {
  const dias = diasEntre(hoy, dueOn);
  if (dias < 0) return "vencido";
  if (dias <= diasAviso) return "por_vencer";
  return "mas_adelante";
}

export interface ControlManual {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  reason: string;
  dueOn: string;
  months: number | null;
  createdAt: string;
}

export interface RecallAutomatico {
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  mesesSinVisita: number | null;
}

export interface ControlPendiente {
  /** Clave estable para la lista. */
  clave: string;
  origen: "manual" | "automatico";
  controlId: string | null;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  motivo: string;
  /** Fecha del control programado; null en el recall automático. */
  venceEl: string | null;
  vencimiento: Vencimiento;
  /** Días de atraso (positivo) o que faltan (negativo); null en el automático. */
  diasDeAtraso: number | null;
  /** El paciente ya tiene una cita futura (no hace falta escribirle). */
  tieneCita: boolean;
}

/**
 * Lista de REC-08. Los manuales entran si vencieron o vencen dentro de
 * `diasAviso`; el recall automático ya llega filtrado (vencido por definición:
 * 6 meses sin visita, sin cita futura). Si un paciente tiene control manual,
 * no se repite como automático: el manual dice el motivo real.
 */
export function armarControlesPendientes(args: {
  manuales: readonly ControlManual[];
  automaticos: readonly RecallAutomatico[];
  conCitaFutura: ReadonlySet<string>;
  hoy: string;
  diasAviso?: number;
}): ControlPendiente[] {
  const diasAviso = args.diasAviso ?? DIAS_AVISO_CONTROL;
  const lista: ControlPendiente[] = [];
  const conManual = new Set<string>();

  for (const c of args.manuales) {
    const vencimiento = vencimientoDe(c.dueOn, args.hoy, diasAviso);
    if (vencimiento === "mas_adelante") continue;
    conManual.add(c.patientId);
    lista.push({
      clave: `manual:${c.id}`,
      origen: "manual",
      controlId: c.id,
      patientId: c.patientId,
      patientName: c.patientName,
      patientPhone: c.patientPhone,
      motivo: c.reason,
      venceEl: c.dueOn,
      vencimiento,
      diasDeAtraso: diasEntre(c.dueOn, args.hoy),
      tieneCita: args.conCitaFutura.has(c.patientId),
    });
  }

  for (const a of args.automaticos) {
    if (conManual.has(a.patientId)) continue;
    lista.push({
      clave: `auto:${a.patientId}`,
      origen: "automatico",
      controlId: null,
      patientId: a.patientId,
      patientName: a.patientName,
      patientPhone: a.patientPhone,
      motivo:
        a.mesesSinVisita !== null
          ? `Control periódico: ${a.mesesSinVisita} meses sin visita`
          : "Control periódico",
      venceEl: null,
      vencimiento: "vencido",
      diasDeAtraso: null,
      tieneCita: args.conCitaFutura.has(a.patientId),
    });
  }

  const peso = (c: ControlPendiente) =>
    (c.tieneCita ? 2 : 0) + (c.vencimiento === "vencido" ? 0 : 1);
  return lista.sort((a, b) => {
    const pa = peso(a);
    const pb = peso(b);
    if (pa !== pb) return pa - pb;
    // Más atrasado primero; el automático (sin fecha) después de los manuales vencidos.
    const da = a.diasDeAtraso ?? -1;
    const db = b.diasDeAtraso ?? -1;
    if (da !== db) return db - da;
    return a.patientName.localeCompare(b.patientName, "es");
  });
}

/** Mensaje de WhatsApp para un control (el link de reserva lo agrega el servidor). */
export function textoDeControl(args: {
  primerNombre: string | null;
  clinica: string;
  motivo: string;
  origen: "manual" | "automatico";
}): string {
  const saludo = args.primerNombre ? `Hola, ${args.primerNombre}` : "Hola";
  const cuerpo =
    args.origen === "manual"
      ? `te escribimos de ${args.clinica} para recordarte tu control: ${args.motivo.replace(/[.\s]+$/, "")}.`
      : `te escribimos de ${args.clinica}: ya es momento de tu control periódico.`;
  return `${saludo}, ${cuerpo} ¿Te acomoda agendar una hora?`;
}
