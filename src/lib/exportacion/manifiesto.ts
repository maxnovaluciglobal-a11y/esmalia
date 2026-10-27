/**
 * Manifiesto de la exportación (EXP-02, Ola 6).
 *
 * El ZIP de la exportación completa trae, además de los CSV, un
 * `manifiesto.json` (para otro sistema) y su versión legible en el LEEME.txt
 * (para una persona). Dicen qué es cada archivo, cuántas filas tiene, qué
 * significa cada columna (tipo y unidad) y la huella SHA-256 de cada archivo,
 * más una huella del conjunto. Con eso la clínica, un perito o el sistema al
 * que se migra pueden comprobar que el ZIP está completo y que nadie lo tocó
 * después de bajarlo.
 *
 * Todo es puro salvo `sha256Hex`, que usa Web Crypto (está igual en el
 * navegador y en Node 20+), así que se prueba sin red
 * (`tests/exportacion-manifiesto.test.ts`).
 */
import { strToU8 } from "fflate";

import type { TablaExportacion } from "@/lib/exportacion/exportacion-clinica";
import { TIPOS_COLUMNAS } from "@/lib/exportacion/tipos-columnas";

/**
 * Versión del formato de la exportación. Sube cuando cambia algo que un
 * sistema que la lee tendría que saber (archivos nuevos, columnas que se
 * renombran o dejan de salir). 1 = oct-2026 (sin manifiesto), 2 = con
 * manifiesto, huellas y las tablas de las olas 1-5.
 */
export const VERSION_FORMATO_EXPORTACION = "2";

/** Nombre del archivo de huellas, en el formato de `shasum -a 256 -c`. */
export const ARCHIVO_HUELLAS = "huellas-sha256.txt";
export const ARCHIVO_MANIFIESTO = "manifiesto.json";

export type TipoColumna =
  | "uuid"
  | "texto"
  | "opcion"
  | "entero"
  | "decimal"
  | "booleano"
  | "fecha"
  | "fecha_hora"
  | "fecha_hora_local"
  | "hora"
  | "json"
  | "lista";

const TIPO_LEGIBLE: Record<TipoColumna, string> = {
  uuid: "identificador (UUID)",
  texto: "texto",
  opcion: "texto de una lista fija de valores",
  entero: "número entero",
  decimal: "número decimal (punto como separador)",
  booleano: "true / false",
  fecha: "fecha AAAA-MM-DD",
  fecha_hora: "fecha y hora ISO 8601",
  fecha_hora_local: "fecha y hora AAAA-MM-DDTHH:MM:SS",
  hora: "hora HH:MM:SS",
  json: "JSON",
  lista: "lista en JSON",
};

export interface ColumnaManifiesto {
  nombre: string;
  tipo: TipoColumna;
  tipo_legible: string;
  unidad: string | null;
  descripcion: string;
}

// ── Significado de las columnas ────────────────────────────────────────────

/** A qué archivo apunta cada clave foránea frecuente. */
const REFERENCIAS: Record<string, string> = {
  patient_id: "pacientes.csv",
  referred_by_patient_id: "pacientes.csv",
  merged_into: "pacientes.csv",
  professional_id: "profesionales.csv",
  primary_professional_id: "profesionales.csv",
  informed_by_professional_id: "profesionales.csv",
  branch_id: "sucursales.csv",
  operatory_id: "boxes.csv",
  default_operatory_id: "boxes.csv",
  appointment_id: "citas.csv",
  scheduled_appointment_id: "citas.csv",
  appointment_type_id: "tipos-de-cita.csv",
  status_id: "estados-de-cita.csv",
  quote_id: "presupuestos.csv",
  quote_item_id: "presupuestos-items.csv",
  plan_id: "planes-de-tratamiento.csv",
  treatment_plan_id: "planes-de-tratamiento.csv",
  treatment_item_id: "planes-de-tratamiento-items.csv",
  procedure_id: "aranceles.csv",
  package_id: "arancel-paquetes.csv",
  specialty_id: "especialidades.csv",
  agreement_id: "convenios.csv",
  payment_method_id: "medios-de-pago.csv",
  payment_id: "pagos.csv",
  cash_register_id: "cajas.csv",
  receivable_id: "cuentas-por-cobrar.csv",
  note_id: "notas-clinicas.csv",
  addendum_of: "notas-clinicas.csv",
  guardian_id: "pacientes-tutores.csv",
  chart_id: "periodontograma.csv",
  odontogram_mark_id: "odontograma.csv",
  superseded_by: "odontograma.csv",
  template_id: "la plantilla correspondiente (consentimientos o documentos)",
  template_version_id: "documentos-plantillas-versiones.csv",
  current_version_id: "documentos-plantillas-versiones.csv",
  issued_document_id: "documentos-emitidos.csv",
  lab_id: "laboratorios.csv",
  item_id: "inventario.csv",
  warehouse_id: "bodegas.csv",
  movement_id: "inventario-movimientos.csv",
  ortho_case_id: "ortodoncia.csv",
  message_id: "mensajes.csv",
  response_message_id: "mensajes.csv",
  request_id: "el archivo de solicitudes correspondiente (firmas a distancia o del titular)",
  replaces_request_id: "firmas-a-distancia.csv",
  incident_id: "incidentes-de-seguridad.csv",
  user_id: "equipo.csv (user_id)",
};

/** Verbo en pasado de las columnas `<verbo>_by` / `<verbo>_at`. */
const VERBOS: Record<string, string> = {
  created: "creó",
  updated: "modificó por última vez",
  archived: "archivó",
  voided: "anuló",
  reversed: "reversó",
  signed: "firmó",
  reviewed: "revisó",
  confirmed: "confirmó",
  closed: "cerró",
  opened: "abrió",
  cancelled: "canceló",
  revoked: "revocó",
  completed: "completó",
  recorded: "registró",
  counted: "contó",
  handled: "gestionó",
  responded: "respondió",
  extended: "prorrogó",
  registered: "registró",
  issued: "emitió",
  uploaded: "subió",
  changed: "cambió",
  sent: "envió",
  accepted: "aceptó",
  rejected: "rechazó",
  merged: "fusionó",
  arrived: "marcó la llegada",
  started: "inició",
  delivered: "entregó",
  connected: "conectó",
  paid: "pagó",
  read: "leyó",
  measured: "midió",
  detected: "detectó",
  received: "recibió",
  superseded: "reemplazó",
  locked: "bloqueó",
  accessed: "accedió",
};

/** `<verbo>_at` que no llevan "se": "Cuándo ocurrió", no "Cuándo se ocurrió". */
const INTRANSITIVOS: Record<string, string> = {
  occurred: "ocurrió",
  expired: "venció",
};

/** Significado de las columnas cuyo nombre solo no alcanza. */
const DESCRIPCIONES: Record<string, string> = {
  id: "Identificador único de la fila. Otras tablas lo usan para apuntar a esta.",
  created_at: "Cuándo se creó la fila.",
  updated_at: "Cuándo se modificó por última vez.",
  created_by: "Usuario que la creó (user_id de equipo.csv).",
  updated_by: "Usuario que la modificó por última vez (user_id de equipo.csv).",
  actor_id: "Usuario que hizo la acción (user_id de equipo.csv). Vacío = el sistema.",
  patient_ref: "Identificador del paciente como texto (id de pacientes.csv).",
  currency: "Moneda de los montos de la fila (código ISO 4217, ej. CLP).",
  status: "Estado de la fila (valor interno en inglés).",
  kind: "Tipo o clase de registro (valor interno en inglés).",
  notes: "Notas en texto libre.",
  note: "Nota en texto libre.",
  name: "Nombre.",
  full_name: "Nombre completo.",
  title: "Título.",
  description: "Descripción.",
  is_active: "Si está activo (true) o dado de baja (false).",
  active: "Si está activo (true) o dado de baja (false).",
  position: "Orden en que se muestra en la app.",
  phone: "Teléfono.",
  email: "Correo electrónico.",
  address: "Dirección.",
  reason: "Motivo.",
  tooth_number: "Pieza dental (numeración FDI).",
  tooth_numbers: "Piezas dentales (numeración FDI), en JSON.",
  tooth: "Pieza dental (numeración FDI).",
  surface: "Superficie dental (O, M, D, V, L/P).",
  quantity: "Cantidad.",
  number: "Número correlativo visible (presupuesto, receta, documento, cuota).",
  version: "Número de versión (1 = la primera).",
  year: "Año del correlativo.",
  document_id: "Número de documento de identidad (RUT, CURP, DNI…).",
  document_type: "Tipo de documento de identidad.",
  birth_date: "Fecha de nacimiento.",
  timezone: "Zona horaria IANA (ej. America/Santiago).",
  color: "Color en la app (hexadecimal).",
  content: "Contenido completo en texto.",
  content_html: "Contenido tal como se mostró al firmar (HTML).",
  content_blocks: "Contenido estructurado por bloques (JSON).",
  summary: "Resumen.",
  body: "Texto del mensaje o plantilla.",
  channel: "Canal (WhatsApp, correo, presencial, portal…).",
  source: "Origen del registro.",
  method: "Medio de pago (valor interno).",
  role: "Rol en la clínica (owner, admin, dentist, assistant, reception, accounting).",
  day_of_week: "Día de la semana.",
  ip_hint: "Origen aproximado de la conexión (IP truncada).",
  user_agent: "Navegador y sistema desde el que se hizo.",
  signed_ip: "IP desde la que se firmó.",
  signed_user_agent: "Navegador desde el que se firmó.",
  accepted_ip: "IP desde la que se aceptó.",
  accepted_user_agent: "Navegador desde el que se aceptó.",
  tags: "Etiquetas, en JSON.",
  allergies: "Alergias, en JSON.",
  conditions: "Enfermedades o condiciones, en JSON.",
  chronic_medications: "Medicación habitual, en JSON.",
  data_categories: "Categorías de datos afectadas, en JSON.",
  detalle: "Detalle de la exportación (tablas, lista, filtros, filas), en JSON.",
  formato:
    "Tipo de exportación: zip_csv = completa, paciente_zip = una ficha, lista_csv = una lista en CSV.",
  canonical: "Estado base al que corresponde (scheduled, confirmed, completed, no_show…).",
  slug: "Identificador corto en texto.",
  seed_key: "Plantilla de fábrica de Esmalia de la que salió (vacío = creada por la clínica).",
  legacy_key: "Identificador en el sistema anterior, si se importó.",
  external_id: "Identificador en el sistema anterior o externo.",
  starts_at: "Inicio.",
  ends_at: "Término.",
  starts_local: "Inicio, en hora local de la clínica.",
  ends_local: "Término, en hora local de la clínica.",
  opens_at: "Hora de apertura.",
  closes_at: "Hora de cierre.",
  start_time: "Hora de inicio.",
  end_time: "Hora de término.",
  valid_until: "Válido hasta (inclusive).",
  due_on: "Fecha de vencimiento.",
  due_date: "Fecha de vencimiento del plazo legal.",
  issued_on: "Fecha de emisión.",
  wa_opt_in: "Si el paciente aceptó recibir mensajes por WhatsApp.",
  phone_valid: "Si el teléfono tiene un formato válido.",
  difference: "Diferencia entre lo contado y lo teórico.",
  percent: "Porcentaje del ajuste.",
  items: "Detalle de cada elemento, en JSON.",
  sheet: "Datos del documento a firmar, en JSON.",
  snapshot: "Datos tal como estaban en ese momento, en JSON.",
  risk_questionnaire: "Cuestionario de riesgo médico, en JSON.",
  allergy_details: "Alergias con su severidad, en JSON.",
  allergy_alerts: "Alertas de alergia mostradas al emitir la receta, en JSON.",
  closing_denominations: "Conteo del cierre por billete y moneda, en JSON.",
  fields: "Campos de la plantilla, en JSON.",
  signer_role: "Quién firmó: el paciente o su tutor.",
  signer_rut_masked: "RUT de quien firmó, enmascarado.",
  code_recipient_masked: "A quién se envió el código de un solo uso, enmascarado.",
  ai_generated: "Si lo sugirió la IA (true) o lo escribió una persona (false).",
  ai_assisted: "Si la versión se escribió con ayuda de IA.",
  confirmed: "Si un profesional lo confirmó.",
  confidence: "Confianza de la sugerencia de IA (0 a 1).",
  is_primary: "Si es el principal.",
  is_priority: "Si es prioritaria.",
  is_favorite: "Si está marcada como favorita.",
  is_mai: "Si es una prestación MAI (Fonasa).",
  attended: "Si el paciente asistió.",
  accepted: "Si el paciente aceptó este ítem del presupuesto.",
  repeat_weekly: "Si se repite cada semana.",
  allow_overbooking: "Si la agenda permite sobrecupos.",
  requires_patient_signature: "Si el documento lleva firma del paciente.",
  user_id: "Usuario de Esmalia.",
  merged_into: "Ficha en la que se fusionó esta (id de pacientes.csv).",
  superseded_by: "Marca que reemplazó a esta (id de odontograma.csv).",
  addendum_of: "Nota que corrige esta adenda (id de notas-clinicas.csv).",
};

/** Columnas con la misma forma en todas partes, por sufijo o prefijo. */
function descripcionPorForma(columna: string): string | null {
  if (REFERENCIAS[columna]) return `Apunta a ${REFERENCIAS[columna]}.`;
  const by = /^(.+)_by$/.exec(columna);
  if (by && VERBOS[by[1]]) return `Usuario que lo ${VERBOS[by[1]]} (user_id de equipo.csv).`;
  const at = /^(.+)_at$/.exec(columna);
  if (at && INTRANSITIVOS[at[1]]) return `Cuándo ${INTRANSITIVOS[at[1]]}.`;
  if (at && VERBOS[at[1]]) return `Cuándo se ${VERBOS[at[1]]}.`;
  if (/_snapshot$/.test(columna))
    return "Copia del dato tal como estaba al momento del registro (no cambia si después se edita el original).";
  if (/_sha256$|_hash$|fingerprint$/.test(columna))
    return "Huella SHA-256 (hexadecimal) para verificar que el contenido no cambió.";
  if (/_path$/.test(columna))
    return "Ruta del archivo en el almacenamiento de Esmalia; si entró en el ZIP, está en archivos/.";
  if (/_cents$/.test(columna)) return "Monto.";
  if (/_id$/.test(columna)) return "Identificador de un registro relacionado.";
  if (/^is_|^has_|^allows?_/.test(columna)) return "Sí (true) o no (false).";
  return null;
}

/** Unidad de medida de la columna, o null si no tiene. */
export function unidadDeColumna(columna: string, tipo: TipoColumna): string | null {
  if (/_cents$/.test(columna))
    return "unidad mínima de la moneda de la columna currency: en CLP, COP o PYG es el monto tal cual; en USD, MXN, PEN o ARS divide por 100";
  if (/_bps$/.test(columna)) return "puntos base (100 = 1 %)";
  if (/_pct$|^percent$/.test(columna)) return "porcentaje (10 = 10 %)";
  if (/_mmhg$/.test(columna)) return "mmHg";
  if (/_bpm$/.test(columna)) return "latidos por minuto";
  if (/_mm$/.test(columna)) return "milímetros";
  if (columna === "temperature_c") return "grados Celsius";
  if (/_min$|_minutes$/.test(columna)) return "minutos";
  if (columna === "size_bytes") return "bytes";
  if (columna === "day_of_week") return "0 = domingo … 6 = sábado";
  if (tipo === "fecha_hora") return "UTC (la Z o +00:00 al final)";
  if (tipo === "fecha_hora_local" || tipo === "hora") return "hora local de la clínica, sin zona";
  if (tipo === "fecha") return "fecha civil, sin zona";
  return null;
}

export function describirColumna(columna: string): string {
  return (
    DESCRIPCIONES[columna] ??
    descripcionPorForma(columna) ??
    `Dato ${columna.replace(/_/g, " ")} (nombre técnico de la columna en Esmalia).`
  );
}

/** Tipo, unidad y significado de cada columna exportada de una tabla. */
export function columnasDelManifiesto(tabla: TablaExportacion): ColumnaManifiesto[] {
  const tipos = TIPOS_COLUMNAS[tabla.tabla] ?? {};
  return tabla.columnas.map((nombre) => {
    const tipo = tipos[nombre] ?? "texto";
    return {
      nombre,
      tipo,
      tipo_legible: TIPO_LEGIBLE[tipo],
      unidad: unidadDeColumna(nombre, tipo),
      descripcion: describirColumna(nombre),
    };
  });
}

// ── Huellas ────────────────────────────────────────────────────────────────

/** SHA-256 en hexadecimal (Web Crypto: navegador y Node 20+). */
export async function sha256Hex(datos: Uint8Array | string): Promise<string> {
  const bytes = typeof datos === "string" ? strToU8(datos) : datos;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface HuellaArchivo {
  ruta: string;
  bytes: number;
  sha256: string;
}

/**
 * Texto de `huellas-sha256.txt`: una línea `<sha256>  <ruta>` por archivo,
 * ordenadas por ruta. Es el formato que entiende `shasum -a 256 -c` (macOS,
 * Linux) y `sha256sum -c`, así que cualquiera verifica el ZIP sin Esmalia.
 * La huella del conjunto es el SHA-256 de este texto.
 */
export function textoHuellas(huellas: readonly HuellaArchivo[]): string {
  return [...huellas]
    .sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0))
    .map((h) => `${h.sha256}  ${h.ruta}\n`)
    .join("");
}

/** Huella de cada archivo (textos en UTF-8 tal como van al ZIP). */
export async function huellasDeArchivos(
  textos: Record<string, string>,
  binarios: Record<string, Uint8Array> = {},
): Promise<HuellaArchivo[]> {
  const salida: HuellaArchivo[] = [];
  for (const [ruta, texto] of Object.entries(textos)) {
    const bytes = strToU8(texto);
    salida.push({ ruta, bytes: bytes.length, sha256: await sha256Hex(bytes) });
  }
  for (const [ruta, bytes] of Object.entries(binarios)) {
    salida.push({ ruta, bytes: bytes.length, sha256: await sha256Hex(bytes) });
  }
  return salida;
}

// ── Manifiesto ─────────────────────────────────────────────────────────────

export interface DatosManifiesto {
  clinica: { id: string; nombre: string };
  /** Instante de generación (ISO 8601 UTC). */
  generadoEnUtc: string;
  /** Mismo instante, legible en la hora de la clínica. */
  generadoEnLocal: string;
  zonaHoraria: string;
  generadoPor: { nombre: string; userId?: string | null };
  /** Id del registro en `clinic_data_exports`. */
  exportId: string | null;
  /** Exportación de una ficha: el paciente. */
  paciente?: { id: string; nombre: string } | null;
  tablas: readonly TablaExportacion[];
  conteos: Record<string, number>;
  huellas: readonly HuellaArchivo[];
  tablasExcluidas: Readonly<Record<string, string>>;
}

export interface Manifiesto {
  formato: "esmalia-exportacion";
  version_formato: string;
  tipo: "clinica_completa" | "ficha_paciente";
  clinica: { id: string; nombre: string };
  paciente: { id: string; nombre: string } | null;
  generado_en: string;
  generado_en_local: string;
  zona_horaria: string;
  generado_por: { nombre: string; user_id: string | null };
  registro_exportacion_id: string | null;
  convenciones: Record<string, string>;
  archivos: Array<{
    ruta: string;
    tipo: "tabla_csv" | "ficha_pdf" | "adjunto" | "otro";
    tabla: string | null;
    descripcion: string | null;
    filas: number | null;
    bytes: number;
    sha256: string;
    columnas?: ColumnaManifiesto[];
    columnas_omitidas?: Array<{ nombre: string; motivo: string }>;
  }>;
  tablas_excluidas: Array<{ tabla: string; motivo: string }>;
  huella_del_conjunto: { algoritmo: "SHA-256"; archivo: string; metodo: string; valor: string };
}

export const CONVENCIONES_EXPORTACION: Record<string, string> = {
  codificacion: "UTF-8 con BOM",
  separador: "; (punto y coma)",
  fin_de_linea: "CRLF",
  fechas_y_horas:
    "ISO 8601 en UTC; las columnas de tipo fecha_hora_local y hora van en hora local de la clínica, sin zona",
  montos:
    "columnas *_cents en la unidad mínima de la moneda de la columna currency (CLP, COP, PYG: monto tal cual; USD, MXN, PEN, ARS: dividir por 100)",
  listas_y_objetos: "JSON",
  celdas_vacias: "sin dato",
  formulas:
    "una celda que empieza con apóstrofo (') lo lleva para que Excel no la ejecute como fórmula",
  columna_clinic_id: "omitida en todos los archivos: tiene un solo valor, el id de la clínica",
};

function tipoArchivo(ruta: string): Manifiesto["archivos"][number]["tipo"] {
  if (ruta.startsWith("pacientes/") && ruta.endsWith(".pdf")) return "ficha_pdf";
  if (ruta.startsWith("archivos/")) return "adjunto";
  if (ruta.endsWith(".csv")) return "tabla_csv";
  return "otro";
}

export async function construirManifiesto(d: DatosManifiesto): Promise<Manifiesto> {
  const porArchivo = new Map(d.tablas.map((t) => [t.archivo, t]));
  const huellasTxt = textoHuellas(d.huellas);
  const archivos = [...d.huellas]
    .sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0))
    .map((h) => {
      const t = porArchivo.get(h.ruta);
      return {
        ruta: h.ruta,
        tipo: tipoArchivo(h.ruta),
        tabla: t?.tabla ?? null,
        descripcion: t?.descripcion ?? null,
        filas: t ? (d.conteos[t.clave] ?? 0) : null,
        bytes: h.bytes,
        sha256: h.sha256,
        ...(t
          ? {
              columnas: columnasDelManifiesto(t),
              columnas_omitidas: Object.entries(t.omitidas ?? {}).map(([nombre, motivo]) => ({
                nombre,
                motivo,
              })),
            }
          : {}),
      };
    });

  return {
    formato: "esmalia-exportacion",
    version_formato: VERSION_FORMATO_EXPORTACION,
    tipo: d.paciente ? "ficha_paciente" : "clinica_completa",
    clinica: d.clinica,
    paciente: d.paciente ?? null,
    generado_en: d.generadoEnUtc,
    generado_en_local: d.generadoEnLocal,
    zona_horaria: d.zonaHoraria,
    generado_por: { nombre: d.generadoPor.nombre, user_id: d.generadoPor.userId ?? null },
    registro_exportacion_id: d.exportId,
    convenciones: CONVENCIONES_EXPORTACION,
    archivos,
    tablas_excluidas: d.paciente
      ? []
      : Object.entries(d.tablasExcluidas).map(([tabla, motivo]) => ({ tabla, motivo })),
    huella_del_conjunto: {
      algoritmo: "SHA-256",
      archivo: ARCHIVO_HUELLAS,
      metodo: `SHA-256 del archivo ${ARCHIVO_HUELLAS} (una línea "<sha256>  <ruta>" por archivo, ordenadas por ruta). Cubre todos los archivos del ZIP salvo ${ARCHIVO_HUELLAS}, ${ARCHIVO_MANIFIESTO} y LEEME.txt.`,
      valor: await sha256Hex(huellasTxt),
    },
  };
}

/**
 * Sección del LEEME.txt que explica el manifiesto y cómo verificar las
 * huellas. Va al final, para que quien abra el LEEME lea primero qué hay.
 */
export function leemeDeHuellas(m: Manifiesto): string[] {
  return [
    "MANIFIESTO Y HUELLAS (verificar que el ZIP está completo)",
    `- ${ARCHIVO_MANIFIESTO}: lo mismo que este LEEME en formato JSON, para otro sistema:`,
    "  cada archivo con su tabla, filas, columnas (tipo, unidad y significado),",
    "  tamaño y huella SHA-256. Formato de exportación versión " + m.version_formato + ".",
    `- ${ARCHIVO_HUELLAS}: la huella SHA-256 de cada archivo. Para comprobar que`,
    "  ningún archivo cambió ni falta, descomprime el ZIP y, en esa carpeta, corre",
    `  en macOS o Linux: shasum -a 256 -c ${ARCHIVO_HUELLAS}`,
    `  (en Windows PowerShell: Get-FileHash -Algorithm SHA256 <archivo>).`,
    `- Huella del conjunto (SHA-256 de ${ARCHIVO_HUELLAS}):`,
    `  ${m.huella_del_conjunto.valor}`,
    "  Si la anotas aparte, te sirve para probar más adelante que esta",
    "  exportación es la misma que se generó hoy.",
  ];
}

/** Bloque del LEEME con las columnas de una tabla (tipo, unidad, significado). */
export function leemeDeColumnas(tabla: TablaExportacion): string[] {
  const lineas = columnasDelManifiesto(tabla).map((c) => {
    const unidad = c.unidad ? `; ${c.unidad}` : "";
    return `    · ${c.nombre} (${c.tipo_legible}${unidad}): ${c.descripcion}`;
  });
  for (const [nombre, motivo] of Object.entries(tabla.omitidas ?? {})) {
    lineas.push(`    · No sale ${nombre}: ${motivo}`);
  }
  return lineas;
}
