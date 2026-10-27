import { horaDeMinutos } from "@/components/agenda-hueco";
import type { Destino } from "@/components/agenda-movimiento";
import type { Cita, Profesional } from "@/lib/clinic-operations/clinic-data";
import { pacientesDeCita } from "@/lib/clinic-operations/citas-grupales";

/**
 * Choques de horario en la agenda (UX-04, Ola 0; box real desde la Ola 2).
 *
 * Lógica pura sobre las citas que ya cargó la agenda: no hay consulta nueva. Tres tipos de choque entre dos citas del mismo día
 * cuyos rangos se cruzan:
 *
 * - `paciente`: el mismo paciente en dos citas a la vez (con cualquier
 *   profesional). Es el más grave: el paciente no puede estar en dos sillones.
 * - `profesional`: el mismo profesional con dos citas a la vez. Es el mismo
 *   criterio que el aviso del servidor (`validarHorarioYSolapamiento`).
 * - `box`: dos profesionales distintos que usan el mismo box. El box es el
 *   de la cita (`Cita.boxId`, AGE-04) y, solo si la cita no tiene, el box
 *   por defecto de su profesional (`Profesional.boxId`, o su nombre en datos
 *   viejos sin id, dentro de la misma sucursal). "Sin box asignado" no
 *   cuenta como box.
 *
 * Nada de esto bloquea: igual que el servidor, avisa para que el equipo
 * decida. Las citas `ausente` no ocupan el horario (el paciente no vino).
 */

export type TipoConflicto = "paciente" | "profesional" | "box";

export interface Conflicto {
  tipo: TipoConflicto;
  /** La otra cita del choque. */
  cita: CitaConflicto;
}

export type CitaConflicto = Pick<
  Cita,
  | "id"
  | "pacienteId"
  | "paciente"
  | "profesionalId"
  | "sucursalId"
  | "fecha"
  | "inicio"
  | "duracion"
  | "estado"
  | "tratamiento"
> &
  Partial<Pick<Cita, "boxId" | "box" | "grupal">>;

export type ProfesionalConflicto = Pick<Profesional, "id" | "nombre" | "box" | "sucursalId"> &
  Partial<Pick<Profesional, "boxId">>;

/** Texto que devuelve el catálogo cuando el profesional no tiene box. */
export const SIN_BOX = "Sin box asignado";

/** El box real del profesional, o null si no tiene ("Sin box asignado"). */
export function boxDe(p: Pick<Profesional, "box"> | undefined): string | null {
  const box = p?.box?.trim();
  return box && box !== SIN_BOX ? box : null;
}

/** Las citas ausentes no ocupan el horario. */
export function ocupaHorario(c: Pick<Cita, "estado">): boolean {
  return c.estado !== "ausente";
}

function seCruzan(
  a: Pick<Cita, "inicio" | "duracion">,
  b: Pick<Cita, "inicio" | "duracion">,
): boolean {
  return a.inicio < b.inicio + b.duracion && a.inicio + a.duracion > b.inicio;
}

/**
 * Box efectivo de una cita: el suyo y, si no tiene, el por defecto de su
 * profesional. `id` es null solo con datos viejos que traen el nombre del
 * box del profesional pero no su id.
 */
export function boxEfectivo(
  cita: Partial<Pick<Cita, "boxId" | "box">>,
  profesional: (Pick<Profesional, "box"> & Partial<Pick<Profesional, "boxId">>) | undefined,
  nombreDeBox?: (id: string) => string | undefined,
): { id: string | null; nombre: string; propio: boolean } | null {
  if (cita.boxId) {
    return {
      id: cita.boxId,
      nombre: nombreDeBox?.(cita.boxId) ?? cita.box ?? "Box",
      propio: true,
    };
  }
  const nombre = boxDe(profesional);
  if (profesional?.boxId) {
    return {
      id: profesional.boxId,
      nombre: nombreDeBox?.(profesional.boxId) ?? nombre ?? "Box",
      propio: false,
    };
  }
  return nombre ? { id: null, nombre, propio: false } : null;
}

/** Nombre del box efectivo de la cita, para los avisos de choque. */
export function nombreBoxDe(
  cita: Partial<Pick<Cita, "boxId" | "box">>,
  profesional: (Pick<Profesional, "box"> & Partial<Pick<Profesional, "boxId">>) | undefined,
): string | null {
  return boxEfectivo(cita, profesional)?.nombre ?? null;
}

/**
 * Clave de box. Con id, el id (es único en toda la clínica); sin id (datos
 * viejos), el nombre dentro de la sucursal: el mismo nombre en otra sucursal
 * es otro box.
 */
function claveBox(cita: CitaConflicto, porId: Map<string, ProfesionalConflicto>): string | null {
  const p = porId.get(cita.profesionalId);
  const box = boxEfectivo(cita, p);
  if (!box) return null;
  if (box.id) return `id:${box.id}`;
  return `${cita.sucursalId || p?.sucursalId || ""}::${box.nombre.toLowerCase()}`;
}

/** Tipos de choque entre dos citas que ya se sabe que se cruzan, de más a menos grave. */
function tiposEntre(
  a: CitaConflicto,
  b: CitaConflicto,
  porId: Map<string, ProfesionalConflicto>,
): TipoConflicto[] {
  const tipos: TipoConflicto[] = [];
  // AGE-22: en una cita grupal cuentan todos sus inscritos.
  const deB = new Set(pacientesDeCita(b));
  if (pacientesDeCita(a).some((id) => id && deB.has(id))) tipos.push("paciente");
  if (a.profesionalId === b.profesionalId) tipos.push("profesional");
  else {
    const ka = claveBox(a, porId);
    if (ka && ka === claveBox(b, porId)) tipos.push("box");
  }
  return tipos;
}

const ORDEN: Record<TipoConflicto, number> = { paciente: 0, profesional: 1, box: 2 };

function ordenar(lista: Conflicto[]): Conflicto[] {
  return lista.sort(
    (x, y) =>
      ORDEN[x.tipo] - ORDEN[y.tipo] ||
      x.cita.inicio - y.cita.inicio ||
      x.cita.id.localeCompare(y.cita.id),
  );
}

/**
 * Choques de todas las citas, por id de cita. Una cita sin choques no
 * aparece en el mapa. Agrupa por día y barre ordenado por inicio: solo
 * compara cada cita con las que todavía siguen abiertas.
 */
export function detectarConflictos(
  citas: readonly CitaConflicto[],
  profesionales: readonly ProfesionalConflicto[],
): Map<string, Conflicto[]> {
  const porId = new Map(profesionales.map((p) => [p.id, p]));
  const porDia = new Map<string, CitaConflicto[]>();
  for (const c of citas) {
    if (!ocupaHorario(c) || c.duracion <= 0) continue;
    const lista = porDia.get(c.fecha);
    if (lista) lista.push(c);
    else porDia.set(c.fecha, [c]);
  }

  const resultado = new Map<string, Conflicto[]>();
  const agregar = (id: string, conflicto: Conflicto) => {
    const lista = resultado.get(id);
    if (lista) lista.push(conflicto);
    else resultado.set(id, [conflicto]);
  };

  for (const delDia of porDia.values()) {
    const ordenadas = [...delDia].sort((a, b) => a.inicio - b.inicio || a.id.localeCompare(b.id));
    const abiertas: CitaConflicto[] = [];
    for (const c of ordenadas) {
      // Saca las que ya terminaron antes de que empiece esta.
      for (let i = abiertas.length - 1; i >= 0; i--) {
        if (abiertas[i].inicio + abiertas[i].duracion <= c.inicio) abiertas.splice(i, 1);
      }
      for (const o of abiertas) {
        if (o.id === c.id || !seCruzan(o, c)) continue;
        for (const tipo of tiposEntre(o, c, porId)) {
          agregar(c.id, { tipo, cita: o });
          agregar(o.id, { tipo, cita: c });
        }
      }
      abiertas.push(c);
    }
  }
  for (const lista of resultado.values()) ordenar(lista);
  return resultado;
}

/** Lo que se está por agendar (Nueva cita, Editar, Agendar solicitud). */
export interface CitaCandidata {
  /** Al editar: la propia cita no choca consigo misma. */
  id?: string;
  pacienteId: string;
  profesionalId: string;
  sucursalId?: string;
  fecha: string;
  inicio: number;
  duracion: number;
  /** Box elegido en el formulario (vacío = el del profesional). */
  boxId?: string | null;
  /** AGE-22: al mover una cita grupal, sus inscritos. */
  grupal?: Cita["grupal"];
}

/**
 * Choques de una cita que todavía no existe contra las cargadas. Sirve para
 * avisar en el formulario ANTES de guardar.
 */
export function conflictosDeCandidata(
  candidata: CitaCandidata,
  citas: readonly CitaConflicto[],
  profesionales: readonly ProfesionalConflicto[],
): Conflicto[] {
  if (!candidata.fecha || !(candidata.duracion > 0) || !Number.isFinite(candidata.inicio))
    return [];
  const porId = new Map(profesionales.map((p) => [p.id, p]));
  const nueva: CitaConflicto = {
    id: candidata.id ?? "__candidata__",
    pacienteId: candidata.pacienteId,
    paciente: "",
    profesionalId: candidata.profesionalId,
    sucursalId: candidata.sucursalId ?? porId.get(candidata.profesionalId)?.sucursalId ?? "",
    fecha: candidata.fecha,
    inicio: candidata.inicio,
    duracion: candidata.duracion,
    estado: "tentativa",
    tratamiento: "",
    boxId: candidata.boxId || null,
    grupal: candidata.grupal,
  };
  const lista: Conflicto[] = [];
  for (const c of citas) {
    if (c.id === nueva.id || c.fecha !== nueva.fecha || !ocupaHorario(c)) continue;
    if (!seCruzan(c, nueva)) continue;
    for (const tipo of tiposEntre(nueva, c, porId)) lista.push({ tipo, cita: c });
  }
  return ordenar(lista);
}

/**
 * Choques que deja un movimiento (arrastre, Alt + flechas o "Mover a…",
 * AGE-02): mismo paciente o mismo box en el destino. El mismo profesional no
 * entra acá porque `validarDestino` ya no deja soltar encima de otra cita
 * suya. Si la cita cambia de sucursal, su box se suelta (lo hace también la
 * base, trigger `appointments_box_de_la_cita`) y cuenta el del profesional.
 */
export function choquesDelMovimiento(
  cita: CitaConflicto & Pick<Cita, "duracion">,
  destino: Destino,
  citas: readonly CitaConflicto[],
  profesionales: readonly ProfesionalConflicto[],
): Conflicto[] {
  const profesional = profesionales.find((p) => p.id === destino.profesionalId);
  const sucursalId = profesional?.sucursalId || cita.sucursalId;
  return conflictosDeCandidata(
    {
      id: cita.id,
      pacienteId: cita.pacienteId,
      grupal: cita.grupal,
      profesionalId: destino.profesionalId,
      sucursalId,
      fecha: destino.fecha,
      inicio: destino.inicio,
      duracion: cita.duracion,
      boxId: sucursalId === cita.sucursalId ? (cita.boxId ?? null) : null,
    },
    citas,
    profesionales,
  ).filter((x) => x.tipo !== "profesional");
}

/** Tipos distintos, en orden de gravedad. */
export function tiposDe(conflictos: readonly Conflicto[] | undefined): TipoConflicto[] {
  if (!conflictos?.length) return [];
  return [...new Set(conflictos.map((c) => c.tipo))].sort((a, b) => ORDEN[a] - ORDEN[b]);
}

export const ETIQUETA_TIPO: Record<TipoConflicto, string> = {
  paciente: "Mismo paciente",
  profesional: "Mismo profesional",
  box: "Mismo box",
};

/** "11:00–11:30" */
export function rangoDe(c: Pick<Cita, "inicio" | "duracion">): string {
  return `${horaDeMinutos(c.inicio)}–${horaDeMinutos(c.inicio + c.duracion)}`;
}

/**
 * Una línea por choque, para el aviso del formulario y para lectores de
 * pantalla: "Mismo paciente: Benjamín Castro con Dra. Rojas, 11:00–12:30".
 */
export function describirConflicto(
  conflicto: Conflicto,
  nombreProfesional: (id: string) => string,
  box?: string | null,
): string {
  const { tipo, cita } = conflicto;
  const con = nombreProfesional(cita.profesionalId);
  const quien = cita.paciente ? `${cita.paciente} con ${con}` : con;
  const donde = tipo === "box" && box ? ` (${box})` : "";
  return `${ETIQUETA_TIPO[tipo]}${donde}: ${quien}, ${rangoDe(cita)}`;
}

/** Resumen corto para el `aria-label` del bloque: "Choque de horario: mismo paciente y mismo box". */
export function resumenConflictos(conflictos: readonly Conflicto[] | undefined): string {
  const tipos = tiposDe(conflictos);
  if (tipos.length === 0) return "";
  const partes = tipos.map((t) => ETIQUETA_TIPO[t].toLowerCase());
  const lista =
    partes.length === 1
      ? partes[0]
      : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
  return `Choque de horario: ${lista}`;
}
