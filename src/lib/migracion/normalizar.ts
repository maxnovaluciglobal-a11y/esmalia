// src/lib/migracion/normalizar.ts
//
// Reglas puras de la migración asistida (EXP-05): cómo se lee cada valor de
// un archivo de otro sistema y qué fila es válida, tiene un error o está
// repetida dentro del mismo archivo. Corren igual en la vista previa y en la
// importación (el servidor las vuelve a correr: nunca confía en lo que
// calculó el navegador).

import { PREVISIONES, TRAMOS_FONASA, type Prevision } from "@/lib/patients/datos-ficha";
import { formatearRut, normalizarDocumento, rutEsValido } from "@/lib/patients/rut";

/** Máximo de filas por archivo (un lote). Más que eso: dividir el archivo. */
export const MAX_FILAS_POR_LOTE = 5000;

/**
 * Minúsculas, sin tildes y con un solo espacio. Par de
 * `public.normalizar_nombre_persona` (migración 20261027100100): los dos
 * tienen que dar lo mismo para que el duplicado por nombre se detecte igual
 * en la vista previa y en la base.
 */
export function normalizarNombrePersona(nombre: string | null | undefined): string | null {
  const limpio = (nombre ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return limpio || null;
}

function fechaValida(anio: number, mes: number, dia: number): string | null {
  if (anio < 1900 || anio > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return null;
  }
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Fecha de un export latinoamericano: "dd/mm/aaaa", "dd-mm-aaaa",
 * "dd.mm.aaaa", "aaaa-mm-dd" (con o sin hora detrás) o el número de serie
 * de Excel. Nunca "mm/dd": en LatAm el día va primero. Devuelve "aaaa-mm-dd"
 * o null.
 */
export function leerFecha(valor: string | null | undefined): string | null {
  const t = (valor ?? "").trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t);
  if (m) return fechaValida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/.exec(t);
  if (m) {
    let anio = Number(m[3]);
    if (m[3].length === 2) anio += anio > 30 ? 1900 : 2000;
    return fechaValida(anio, Number(m[2]), Number(m[1]));
  }
  // Número de serie de Excel (días desde 1899-12-30), por si la celda vino
  // como número.
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86_400_000);
    return fechaValida(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

/**
 * Hora "HH:mm", "H:mm", "HH:mm:ss", "9:30 AM", "1730" o fracción de día de
 * Excel (0.5 = 12:00). Devuelve "HH:mm" o null.
 */
export function leerHora(valor: string | null | undefined): string | null {
  const t = (valor ?? "").trim().toLowerCase();
  if (!t) return null;
  const am = /\s*(a\.?\s?m\.?|p\.?\s?m\.?)$/.exec(t);
  const sinSufijo = am ? t.slice(0, am.index).trim() : t;
  let h: number;
  let min: number;
  let m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(sinSufijo);
  if (m) {
    h = Number(m[1]);
    min = Number(m[2]);
  } else if ((m = /^(\d{1,2})(\d{2})$/.exec(sinSufijo))) {
    h = Number(m[1]);
    min = Number(m[2]);
  } else if (!am && /^0?\.\d+$/.test(sinSufijo)) {
    const total = Math.round(Number(sinSufijo) * 24 * 60);
    h = Math.floor(total / 60);
    min = total % 60;
  } else {
    return null;
  }
  if (am) {
    const pm = am[1].startsWith("p");
    if (h < 1 || h > 12) return null;
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Fecha con hora en la misma celda ("10/05/2026 09:30"): separa la hora. */
export function horaDeLaFecha(valor: string | null | undefined): string | null {
  const m = /[T ](\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s?m\.?)?)\s*$/i.exec((valor ?? "").trim());
  return m ? leerHora(m[1]) : null;
}

const ISAPRES = [
  "banmedica",
  "colmena",
  "consalud",
  "cruz blanca",
  "nueva masvida",
  "masvida",
  "vida tres",
  "esencial",
  "isalud",
  "fundacion",
];

export interface PrevisionLeida {
  prevision: Prevision;
  tramo: string | null;
  institucion: string | null;
}

/**
 * Previsión de salud (Chile) desde texto libre: "Fonasa B", "Isapre
 * Colmena", "Banmédica", "Particular", "Capredena"… null si no se reconoce
 * (se avisa y la ficha queda sin previsión).
 */
export function leerPrevision(valor: string | null | undefined): PrevisionLeida | null {
  const t = normalizarNombrePersona(valor);
  if (!t) return null;
  if (t.startsWith("fonasa")) {
    const tramo = /\b([abcd])$/.exec(t)?.[1]?.toUpperCase() ?? null;
    return {
      prevision: "fonasa",
      tramo: tramo && (TRAMOS_FONASA as readonly string[]).includes(tramo) ? tramo : null,
      institucion: null,
    };
  }
  if (t.includes("capredena")) return { prevision: "ffaa", tramo: null, institucion: "Capredena" };
  if (t.includes("dipreca")) return { prevision: "ffaa", tramo: null, institucion: "Dipreca" };
  const isapre = ISAPRES.find((i) => t.includes(i));
  if (t.startsWith("isapre") || isapre) {
    const resto = (valor ?? "").replace(/isapre/i, "").trim();
    return { prevision: "isapre", tramo: null, institucion: resto ? resto.slice(0, 80) : null };
  }
  if (t.startsWith("particular"))
    return { prevision: "particular", tramo: null, institucion: null };
  if (t.startsWith("sin prevision") || t === "ninguna") {
    return { prevision: "sin_prevision", tramo: null, institucion: null };
  }
  if (t.startsWith("extranjer")) return { prevision: "extranjero", tramo: null, institucion: null };
  if ((PREVISIONES as readonly string[]).includes(t)) {
    return { prevision: t as Prevision, tramo: null, institucion: null };
  }
  return null;
}

/** Estado de una cita del sistema anterior → estado de Esmalia. */
export function leerEstadoCita(
  valor: string | null | undefined,
): "tentativa" | "confirmada" | "ausente" | "finalizada" | "cancelada" {
  const t = normalizarNombrePersona(valor) ?? "";
  if (/anulad|cancelad|suspendid|eliminad/.test(t)) return "cancelada";
  if (/no asist|inasist|ausent|no se present|falt/.test(t)) return "ausente";
  if (/atendid|finalizad|realizad|completad|asisti/.test(t)) return "finalizada";
  if (/^confirmad|confirmo/.test(t)) return "confirmada";
  return "tentativa";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type EstadoFila = "valida" | "error" | "duplicada";

export interface FilaPaciente {
  fila: number;
  estado: EstadoFila;
  errores: string[];
  avisos: string[];
  nombre: string;
  documento: string | null;
  documentoTipo: "rut" | "dni" | "pasaporte" | "otro" | null;
  nacimiento: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  comuna: string | null;
  prevision: PrevisionLeida | null;
  externo: string | null;
  /** Fila en que ya aparecía esta persona, si se repite dentro del archivo. */
  repiteFila: number | null;
}

function recortar(v: string | null | undefined, max: number): string | null {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Lee las filas (ya mapeadas a los campos de `camposDelPerfil("pacientes")`)
 * y marca errores y repetidos dentro del archivo. Los duplicados contra las
 * fichas que ya existen los marca el servidor (migracion_buscar_pacientes).
 */
export function prepararPacientes(
  filas: Record<string, string>[],
  pais: string | null,
): FilaPaciente[] {
  const esChile = (pais ?? "").toUpperCase() === "CL";
  const porDocumento = new Map<string, number>();
  const porNombreYFecha = new Map<string, number>();
  const porExterno = new Map<string, number>();

  return filas.map((f, i) => {
    const fila = i + 1;
    const errores: string[] = [];
    const avisos: string[] = [];
    const nombre = [f.nombre, f.apellidos, f.apellido_materno]
      .map((p) => (p ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .slice(0, 200);
    if (!nombre) errores.push("Falta el nombre.");

    let documento = recortar(f.documento, 40);
    let documentoTipo: FilaPaciente["documentoTipo"] = null;
    if (documento) {
      if (rutEsValido(documento)) {
        documento = formatearRut(documento);
        documentoTipo = "rut";
      } else if (esChile && /^[0-9. -]+[0-9kK]$/.test(documento)) {
        avisos.push("El RUT no es válido: se guarda como otro documento.");
        documentoTipo = "otro";
      } else {
        documentoTipo = esChile ? "otro" : "dni";
      }
    }

    const nacimiento = leerFecha(f.nacimiento);
    if (f.nacimiento?.trim() && !nacimiento) {
      avisos.push("La fecha de nacimiento no se entiende: se importa sin ella.");
    }
    const hoy = new Date().toISOString().slice(0, 10);
    const nacimientoOk = nacimiento && nacimiento <= hoy ? nacimiento : null;
    if (nacimiento && !nacimientoOk)
      avisos.push("La fecha de nacimiento es futura: se importa sin ella.");

    let email = recortar(f.email, 200)?.toLowerCase() ?? null;
    if (email && !EMAIL_RE.test(email)) {
      avisos.push("El correo no es válido: se importa sin él.");
      email = null;
    }

    const prevision = leerPrevision(f.prevision);
    if (f.prevision?.trim() && !prevision) {
      avisos.push(`No reconocimos la previsión "${f.prevision.trim()}": la ficha queda sin ella.`);
    }

    const externo = recortar(f.externo, 80);
    let repiteFila: number | null = null;
    if (errores.length === 0) {
      const doc = normalizarDocumento(documento);
      const nombreNorm = normalizarNombrePersona(nombre);
      const claves: [Map<string, number>, string | null][] = [
        [porExterno, externo],
        [porDocumento, doc],
        [porNombreYFecha, nacimientoOk && nombreNorm ? `${nombreNorm}|${nacimientoOk}` : null],
      ];
      for (const [mapa, clave] of claves) {
        if (clave && mapa.has(clave)) repiteFila ??= mapa.get(clave) ?? null;
      }
      if (repiteFila === null) {
        for (const [mapa, clave] of claves) if (clave) mapa.set(clave, fila);
      }
    }

    return {
      fila,
      estado: errores.length > 0 ? "error" : repiteFila !== null ? "duplicada" : "valida",
      errores,
      avisos,
      nombre,
      documento,
      documentoTipo,
      nacimiento: nacimientoOk,
      telefono: recortar(f.telefono, 40),
      email,
      direccion: recortar(f.direccion, 200),
      comuna: recortar(f.comuna, 80),
      prevision,
      externo,
      repiteFila,
    };
  });
}

export interface FilaCita {
  fila: number;
  estado: EstadoFila;
  errores: string[];
  avisos: string[];
  pacienteExterno: string | null;
  pacienteDocumento: string | null;
  pacienteNombre: string | null;
  /** "aaaa-mm-ddTHH:mm" en la hora local de la sucursal. */
  inicioLocal: string | null;
  duracionMin: number;
  profesional: string | null;
  sucursal: string | null;
  estadoCita: ReturnType<typeof leerEstadoCita>;
  motivo: string;
  notas: string | null;
  externo: string | null;
  repiteFila: number | null;
}

const DURACION_POR_DEFECTO = 30;

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Igual que `prepararPacientes`, para un archivo de citas. */
export function prepararCitas(filas: Record<string, string>[]): FilaCita[] {
  const vistas = new Map<string, number>();
  return filas.map((f, i) => {
    const fila = i + 1;
    const errores: string[] = [];
    const avisos: string[] = [];

    const pacienteExterno = recortar(f.paciente_externo, 80);
    const pacienteDocumento = recortar(f.paciente_documento, 40);
    const pacienteNombre = recortar(f.paciente_nombre, 200);
    if (!pacienteExterno && !pacienteDocumento && !pacienteNombre) {
      errores.push("Falta el paciente (id, documento o nombre).");
    }

    const fecha = leerFecha(f.fecha);
    const hora = leerHora(f.hora) ?? horaDeLaFecha(f.fecha);
    if (!fecha) errores.push("La fecha no se entiende.");
    if (!hora) errores.push("Falta la hora de inicio o no se entiende.");

    let duracionMin = DURACION_POR_DEFECTO;
    const fin = leerHora(f.hora_fin);
    const dur = Number((f.duracion ?? "").replace(",", "."));
    if (hora && fin && minutos(fin) > minutos(hora)) {
      duracionMin = minutos(fin) - minutos(hora);
    } else if (Number.isFinite(dur) && dur >= 5 && dur <= 480) {
      duracionMin = Math.round(dur);
    } else if (f.hora_fin?.trim() || f.duracion?.trim()) {
      avisos.push(`No entendimos la duración: se usa ${DURACION_POR_DEFECTO} minutos.`);
    }

    const inicioLocal = fecha && hora ? `${fecha}T${hora}` : null;
    const profesional = recortar(f.profesional, 200);
    const externo = recortar(f.externo, 80);

    let repiteFila: number | null = null;
    if (errores.length === 0) {
      const clave =
        externo ??
        `${pacienteExterno ?? normalizarDocumento(pacienteDocumento) ?? normalizarNombrePersona(pacienteNombre)}|${inicioLocal}|${normalizarNombrePersona(profesional) ?? ""}`;
      repiteFila = vistas.get(clave) ?? null;
      if (repiteFila === null) vistas.set(clave, fila);
    }

    return {
      fila,
      estado: errores.length > 0 ? "error" : repiteFila !== null ? "duplicada" : "valida",
      errores,
      avisos,
      pacienteExterno,
      pacienteDocumento,
      pacienteNombre,
      inicioLocal,
      duracionMin,
      profesional,
      sucursal: recortar(f.sucursal, 200),
      estadoCita: leerEstadoCita(f.estado),
      motivo: recortar(f.motivo, 200) ?? "Cita importada",
      notas: recortar(f.notas, 2000),
      externo,
      repiteFila,
    };
  });
}

/**
 * La fila tal como venía del archivo, para guardarla como "dato de origen"
 * (EXP-06). Sin columnas vacías y con un tope de tamaño: la base rechaza
 * más de 8 KB.
 */
export function filaOriginal(cruda: Record<string, string>): Record<string, string> {
  const salida: Record<string, string> = {};
  let total = 0;
  for (const [k, v] of Object.entries(cruda)) {
    const clave = k.trim().slice(0, 80);
    const valor = (v ?? "").trim().slice(0, 500);
    if (!clave || !valor) continue;
    total += clave.length + valor.length;
    if (total > 6000) break;
    salida[clave] = valor;
  }
  return salida;
}

export type PoliticaDuplicados = "omitir" | "completar";

export interface FilaVistaPrevia {
  fila: number;
  estado: EstadoFila;
  /** Qué va a pasar con la fila al importar. */
  accion: "crear" | "completar" | "omitir" | "error";
  titulo: string;
  detalle: string | null;
  mensajes: string[];
  /** Ficha de Esmalia con la que coincide (duplicado o paciente de la cita). */
  pacienteId: string | null;
  via: string | null;
}

/** Cuántos registros toca la importación con esa política: la cifra que se confirma. */
export function afectadas(filas: FilaVistaPrevia[], politica: PoliticaDuplicados): number {
  return filas.filter(
    (f) =>
      f.estado === "valida" ||
      (politica === "completar" && f.estado === "duplicada" && f.pacienteId !== null),
  ).length;
}

const ETIQUETA_TABLA: Record<string, string> = {
  appointments: "citas",
  clinical_notes: "notas clínicas",
  messages: "mensajes",
  payments: "pagos",
  quotes: "presupuestos",
  treatment_plans: "planes de tratamiento",
  odontogram_marks: "marcas del odontograma",
  receivables: "cuentas por cobrar",
  lab_orders: "órdenes de laboratorio",
  issued_documents: "documentos emitidos",
  import_batch_changes: "datos completados por otro lote",
};

/** Texto para la persona a partir de una fila de `migracion_bloqueos_de_lote`. */
export function explicarBloqueo(b: { tabla: string; usada_por: string; cantidad: number }): string {
  const n = Number(b.cantidad);
  const deFichas = b.tabla === "patients";
  if (b.usada_por === "edicion") {
    if (deFichas)
      return n === 1
        ? "1 ficha se editó después de importarla."
        : `${n} fichas se editaron después de importarlas.`;
    return n === 1
      ? "1 cita se editó después de importarla."
      : `${n} citas se editaron después de importarlas.`;
  }
  if (b.usada_por === "fusion") {
    return n === 1 ? "1 ficha se fusionó con otra." : `${n} fichas se fusionaron con otra.`;
  }
  const que = ETIQUETA_TABLA[b.usada_por] ?? `registros (${b.usada_por})`;
  const sobre = deFichas ? "los pacientes" : "las citas";
  if (b.usada_por === "appointments" && deFichas) {
    return `Hay ${n} ${n === 1 ? "cita" : "citas"} de ${sobre} de este lote creadas después (en Esmalia o en otro lote de citas). Si son de un lote de citas, deshaz ese lote primero.`;
  }
  return `Hay ${n} ${que} sobre ${sobre} de este lote, registrados después de importarlos.`;
}
