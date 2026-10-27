/**
 * Piezas puras del formulario de cita (Ola 1 · frente cita, AGE-11 a AGE-17).
 *
 * Las usan los tres diálogos de la agenda (Nueva cita, Editar cita y Agendar
 * solicitud). Viven acá y no en los componentes para poder probarlas sin
 * navegador: `tests/cita-formulario.test.ts`.
 */

/** Duraciones que se eligen con un toque (AGE-13). "Otra" abre el campo libre. */
export const DURACIONES_PRESET = [15, 30, 45, 60, 90, 120] as const;

export const DURACION_POR_DEFECTO = 30;

/** Topes del servidor (`createAppointment`): 5 a 480 minutos. */
export const DURACION_MIN = 5;
export const DURACION_MAX = 480;

export function esDuracionPreset(minutos: number): boolean {
  return (DURACIONES_PRESET as readonly number[]).includes(minutos);
}

/** Campos del formulario que pueden faltar, en el orden en que aparecen. */
export type CampoCita = "paciente" | "sucursal" | "profesional" | "tratamiento" | "inicio";

export const ETIQUETA_CAMPO: Record<CampoCita, string> = {
  paciente: "paciente",
  sucursal: "sucursal",
  profesional: "profesional",
  tratamiento: "tratamiento",
  inicio: "fecha y hora",
};

/**
 * Qué falta para poder guardar, en el orden del formulario (AGE-16). El
 * diálogo de edición no pide paciente (ya está fijo) y "Agendar solicitud"
 * tampoco pide tratamiento (viene del motivo que escribió el paciente): por
 * eso cada campo es opcional; solo se revisa el que llega.
 */
export function camposFaltantes(valores: Partial<Record<CampoCita, string>>): CampoCita[] {
  const orden: CampoCita[] = ["paciente", "sucursal", "profesional", "tratamiento", "inicio"];
  return orden.filter((campo) => campo in valores && !(valores[campo] ?? "").trim());
}

/** "Falta completar: paciente y fecha y hora." — null si no falta nada. */
export function textoFaltaCompletar(faltan: readonly CampoCita[]): string | null {
  if (faltan.length === 0) return null;
  const nombres = faltan.map((c) => ETIQUETA_CAMPO[c]);
  const lista =
    nombres.length === 1
      ? nombres[0]
      : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  return `Falta completar: ${lista}.`;
}

/**
 * Duración que corresponde después de elegir un procedimiento (AGE-09 parcial,
 * AGE-12). La del arancel manda solo mientras nadie tocó la duración a mano:
 * si quien agenda la cambió, se respeta (AGE-13).
 */
export function duracionAlElegirProcedimiento({
  actual,
  delProcedimiento,
  editadaAMano,
}: {
  actual: number;
  delProcedimiento: number | null | undefined;
  editadaAMano: boolean;
}): number {
  if (editadaAMano) return actual;
  if (delProcedimiento == null || !Number.isFinite(delProcedimiento)) return actual;
  if (delProcedimiento < DURACION_MIN || delProcedimiento > DURACION_MAX) return actual;
  return delProcedimiento;
}

/** Procedimiento del arancel tal como lo necesita la elección de frecuentes. */
export type ProcedimientoCatalogo = {
  id: string;
  name: string;
  durationMin: number | null;
  isActive?: boolean;
};

export const FRECUENTES_MIN = 8;
export const FRECUENTES_MAX = 12;

/**
 * Los botones de procedimientos frecuentes (AGE-12): primero los favoritos
 * del arancel (en el orden del arancel), después los más agendados en los
 * últimos 90 días, sin repetir y solo los activos. Tope de 12. Si con eso no
 * se llega a 8, se completa con los primeros del arancel, así una clínica
 * nueva (sin historial ni favoritos) también ve botones.
 */
export function elegirProcedimientosFrecuentes({
  catalogo,
  favoritos,
  usos,
  maximo = FRECUENTES_MAX,
  minimo = FRECUENTES_MIN,
}: {
  catalogo: readonly ProcedimientoCatalogo[];
  /** Ids marcados con estrella en el arancel. */
  favoritos: readonly string[];
  /** Conteo de citas por procedimiento, ya ordenado de más a menos. */
  usos: readonly { procedureId: string; usos: number }[];
  maximo?: number;
  minimo?: number;
}): ProcedimientoCatalogo[] {
  const activos = catalogo.filter((p) => p.isActive !== false);
  const porId = new Map(activos.map((p) => [p.id, p]));
  const elegidos: ProcedimientoCatalogo[] = [];
  const vistos = new Set<string>();
  const sumar = (id: string) => {
    if (elegidos.length >= maximo || vistos.has(id)) return;
    const p = porId.get(id);
    if (!p) return;
    vistos.add(id);
    elegidos.push(p);
  };

  const favoritosSet = new Set(favoritos);
  for (const p of activos) if (favoritosSet.has(p.id)) sumar(p.id);
  const ordenUsos = [...usos].sort((a, b) => b.usos - a.usos);
  for (const u of ordenUsos) if (u.usos > 0) sumar(u.procedureId);
  // Relleno con el arancel solo hasta el mínimo: si no, una clínica nueva
  // vería 12 botones elegidos por orden alfabético y no por uso.
  for (const p of activos) {
    if (elegidos.length >= minimo) break;
    sumar(p.id);
  }
  return elegidos;
}

/** Roles de la clínica que atienden pacientes en el sillón. */
const ROLES_QUE_ATIENDEN = new Set(["owner", "admin", "dentist"]);

/**
 * ¿Este profesional atiende pacientes? (AGE-17 + EQU-04). La marca explícita
 * "Atiende pacientes" de la ficha del profesional (`attends_patients`)
 * manda. Sin marca (null), se deduce del rol de la persona en el equipo: un
 * profesional sin usuario vinculado es alguien que la clínica cargó para
 * agendarle (atiende); uno vinculado a una cuenta de recepción, contabilidad
 * o asistente no aparece en el selector de la cita ni en la reserva en
 * línea. Par en la base: `reserva_en_linea_atiende`.
 */
export function atiendePacientes(
  rolDelUsuario: string | null | undefined,
  marca?: boolean | null,
): boolean {
  if (marca === true || marca === false) return marca;
  if (!rolDelUsuario) return true;
  return ROLES_QUE_ATIENDEN.has(rolDelUsuario);
}

/**
 * Profesionales del selector: los que atienden y, en la sucursal elegida. Al
 * editar, el profesional que ya tiene la cita se mantiene en la lista aunque
 * no cumpla, para no vaciar el selector.
 *
 * AGE-23: un profesional atiende en una sucursal si es la de su ficha o si su
 * horario semanal tiene algún bloque en ella (`sucursalesDeProfesional`).
 */
export function profesionalesDelSelector<
  P extends { id: string; sucursalId: string; atiende?: boolean },
>(
  profesionales: readonly P[],
  sucursalId: string,
  actualId?: string,
  sucursalesDeProfesional?: Readonly<Record<string, readonly string[]>>,
): P[] {
  return profesionales.filter(
    (p) =>
      p.id === actualId ||
      (p.atiende !== false &&
        (!sucursalId ||
          p.sucursalId === sucursalId ||
          Boolean(sucursalesDeProfesional?.[p.id]?.includes(sucursalId)))),
  );
}

/**
 * Lleva el foco al primer campo que falta. `ids` dice qué elemento enfocar por
 * campo (el combobox del paciente es un botón; el resto, inputs o selects).
 */
export function enfocarPrimerFaltante(
  faltan: readonly CampoCita[],
  ids: Partial<Record<CampoCita, string>>,
  doc: Pick<Document, "getElementById"> = document,
): boolean {
  for (const campo of faltan) {
    const id = ids[campo];
    const el = id ? doc.getElementById(id) : null;
    if (el) {
      el.focus();
      el.scrollIntoView?.({ block: "nearest" });
      return true;
    }
  }
  return false;
}

/**
 * Box que queda en el formulario al cambiar de profesional (AGE-04).
 *
 * Se precarga el box por defecto del profesional nuevo, salvo que alguien
 * haya elegido otro box a mano: eso se respeta. "A mano" = el box actual no
 * está vacío y no es el box por defecto del profesional anterior (que lo
 * había puesto este mismo formulario). El box por defecto solo vale si es
 * un box activo de la sucursal elegida; si no, queda "Sin box".
 */
export function boxAlCambiarProfesional({
  boxActual,
  anterior,
  nuevo,
  boxes,
  sucursalId,
}: {
  /** "" = sin box. */
  boxActual: string;
  anterior: { boxId?: string | null } | undefined;
  nuevo: { boxId?: string | null } | undefined;
  /** Boxes activos de la clínica. */
  boxes: readonly { id: string; sucursalId: string }[];
  sucursalId: string;
}): string {
  const elegidoAMano = boxActual !== "" && boxActual !== (anterior?.boxId ?? null);
  if (elegidoAMano) return boxActual;
  const porDefecto = nuevo?.boxId;
  if (porDefecto && boxes.some((b) => b.id === porDefecto && b.sucursalId === sucursalId)) {
    return porDefecto;
  }
  return "";
}
