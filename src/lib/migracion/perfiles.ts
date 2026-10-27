// src/lib/migracion/perfiles.ts
//
// Perfiles de columnas de la migración asistida (EXP-07): qué encabezado de
// cada sistema de origen corresponde a cada campo de Esmalia. El mapeo que
// sale de acá es solo la propuesta inicial: en la vista previa se puede
// cambiar columna por columna.
//
// ⚠️ El perfil Dentalink es PROVISIONAL: está armado con los encabezados
// típicos de su export de pacientes y de citas, no con un export real. Hasta
// tener uno (pendiente de Walter), la pantalla lo dice y pide revisar el
// mapeo antes de importar.

import { normalizarHeaderCsv, type CsvFieldSpec } from "@/lib/csv/column-mapping";

export const TIPOS_DE_LOTE = ["pacientes", "citas"] as const;
export type TipoLote = (typeof TIPOS_DE_LOTE)[number];

export const PERFILES = ["dentalink", "generico"] as const;
export type PerfilId = (typeof PERFILES)[number];

export interface PerfilMigracion {
  id: PerfilId;
  nombre: string;
  /** true hasta validarlo con un export real del sistema. */
  provisional: boolean;
  descripcion: string;
}

export const PERFILES_DE_MIGRACION: Record<PerfilId, PerfilMigracion> = {
  dentalink: {
    id: "dentalink",
    nombre: "Dentalink",
    provisional: true,
    descripcion:
      "Encabezados típicos del export de Dentalink. Es provisional: todavía no lo comparamos con un export real, así que revisa el mapeo antes de importar.",
  },
  generico: {
    id: "generico",
    nombre: "Planilla genérica",
    provisional: false,
    descripcion:
      "Cualquier CSV o Excel con una fila de encabezados (por ejemplo, una planilla propia o el export de otro sistema).",
  },
};

/** "dentalink" → "Dentalink" (para el sello "Importado de…"). */
export function nombreDelOrigen(origen: string): string {
  return PERFILES_DE_MIGRACION[origen as PerfilId]?.nombre ?? origen;
}

export const ETIQUETA_TIPO_LOTE: Record<TipoLote, string> = {
  pacientes: "Pacientes",
  citas: "Citas",
};

/** Campos que entiende cada tipo de lote, con los alias genéricos. */
type CampoBase = Omit<CsvFieldSpec, "aliases"> & { generico: string[] };

const CAMPOS_PACIENTES: CampoBase[] = [
  {
    key: "nombre",
    label: "Nombre",
    required: true,
    generico: ["nombre", "nombres", "nombre_completo", "paciente", "name", "full_name"],
  },
  {
    key: "apellidos",
    label: "Apellidos",
    required: false,
    generico: ["apellidos", "apellido", "last_name"],
  },
  {
    key: "apellido_materno",
    label: "Apellido materno",
    required: false,
    generico: ["apellido_materno", "segundo_apellido"],
  },
  {
    key: "documento",
    label: "Documento (RUT, DNI…)",
    required: false,
    generico: ["documento", "rut", "dni", "run", "cedula", "documento_paciente", "identificacion"],
  },
  {
    key: "nacimiento",
    label: "Fecha de nacimiento",
    required: false,
    generico: [
      "fecha_nacimiento",
      "fecha_de_nacimiento",
      "nacimiento",
      "birth_date",
      "f._nacimiento",
    ],
  },
  {
    key: "telefono",
    label: "Teléfono",
    required: false,
    generico: ["telefono", "celular", "movil", "phone", "telefono_movil", "whatsapp"],
  },
  {
    key: "email",
    label: "Correo",
    required: false,
    generico: ["email", "correo", "mail", "e-mail"],
  },
  {
    key: "direccion",
    label: "Dirección",
    required: false,
    generico: ["direccion", "domicilio", "address"],
  },
  { key: "comuna", label: "Comuna", required: false, generico: ["comuna", "ciudad", "localidad"] },
  {
    key: "prevision",
    label: "Previsión",
    required: false,
    generico: ["prevision", "isapre", "seguro", "aseguradora"],
  },
  {
    key: "externo",
    label: "Id en el sistema anterior",
    required: false,
    generico: ["id", "id_paciente", "codigo", "ficha", "numero_ficha"],
  },
];

const CAMPOS_CITAS: CampoBase[] = [
  {
    key: "paciente_externo",
    label: "Id del paciente",
    required: false,
    generico: ["id_paciente", "codigo_paciente", "ficha"],
  },
  {
    key: "paciente_documento",
    label: "Documento del paciente",
    required: false,
    generico: ["documento_paciente", "rut_paciente", "documento", "rut", "dni"],
  },
  {
    key: "paciente_nombre",
    label: "Nombre del paciente",
    required: false,
    generico: ["paciente", "nombre_paciente", "nombre"],
  },
  {
    key: "fecha",
    label: "Fecha",
    required: true,
    generico: ["fecha", "fecha_cita", "dia", "date"],
  },
  {
    key: "hora",
    label: "Hora de inicio",
    required: false,
    generico: ["hora", "hora_inicio", "inicio", "hora_de_inicio"],
  },
  {
    key: "hora_fin",
    label: "Hora de término",
    required: false,
    generico: ["hora_fin", "hora_termino", "termino", "fin", "hora_de_termino"],
  },
  {
    key: "duracion",
    label: "Duración (minutos)",
    required: false,
    generico: ["duracion", "duracion_min", "minutos"],
  },
  {
    key: "profesional",
    label: "Profesional",
    required: false,
    generico: ["profesional", "dentista", "doctor", "doctora", "odontologo", "tratante"],
  },
  {
    key: "sucursal",
    label: "Sucursal",
    required: false,
    generico: ["sucursal", "sede", "clinica"],
  },
  {
    key: "estado",
    label: "Estado",
    required: false,
    generico: ["estado", "status", "estado_cita"],
  },
  {
    key: "motivo",
    label: "Motivo o tratamiento",
    required: false,
    generico: ["motivo", "tratamiento", "prestacion", "tipo", "tipo_de_cita"],
  },
  {
    key: "notas",
    label: "Notas",
    required: false,
    generico: ["notas", "comentario", "comentarios", "observaciones", "observacion"],
  },
  { key: "externo", label: "Id de la cita", required: false, generico: ["id_cita", "id"] },
];

/**
 * Encabezados típicos del export de Dentalink (normalizados con
 * `normalizarHeaderCsv`). PROVISIONAL: ver el comentario del archivo.
 */
const ALIAS_DENTALINK: Record<TipoLote, Record<string, string[]>> = {
  pacientes: {
    nombre: ["nombre", "nombres", "nombre_paciente"],
    apellidos: ["apellidos", "apellido_paterno", "apellido"],
    apellido_materno: ["apellido_materno"],
    documento: ["rut", "rut_paciente", "documento", "n°_documento", "numero_documento"],
    nacimiento: ["fecha_nacimiento", "fecha_de_nacimiento", "f._nacimiento"],
    telefono: ["celular", "telefono_celular", "telefono", "telefono_movil"],
    email: ["email", "e-mail", "correo", "correo_electronico"],
    direccion: ["direccion"],
    comuna: ["comuna", "ciudad"],
    prevision: ["prevision", "convenio", "isapre"],
    externo: ["id", "id_paciente", "n°_ficha", "numero_ficha", "ficha"],
  },
  citas: {
    paciente_externo: ["id_paciente", "n°_ficha", "ficha"],
    paciente_documento: ["rut", "rut_paciente"],
    paciente_nombre: ["paciente", "nombre_paciente", "nombre"],
    fecha: ["fecha", "fecha_cita"],
    hora: ["hora_inicio", "hora", "inicio"],
    hora_fin: ["hora_termino", "hora_fin", "termino"],
    duracion: ["duracion"],
    profesional: ["dentista", "profesional", "tratante"],
    sucursal: ["sucursal"],
    estado: ["estado", "estado_cita"],
    motivo: ["tratamiento", "motivo", "prestacion"],
    notas: ["comentario", "comentarios", "observaciones"],
    externo: ["id_cita", "id"],
  },
};

/** Campos del tipo de lote con los alias del perfil primero (y después los genéricos). */
export function camposDelPerfil(tipo: TipoLote, perfil: PerfilId): CsvFieldSpec[] {
  const base = tipo === "pacientes" ? CAMPOS_PACIENTES : CAMPOS_CITAS;
  return base.map(({ generico, ...campo }) => {
    const propios = perfil === "dentalink" ? (ALIAS_DENTALINK[tipo][campo.key] ?? []) : [];
    return { ...campo, aliases: [...new Set([...propios, ...generico])] };
  });
}

/**
 * Sugiere el perfil según los encabezados: Dentalink si al menos tres de sus
 * encabezados propios (que no están entre los genéricos) aparecen tal cual.
 */
export function sugerirPerfil(tipo: TipoLote, headers: string[]): PerfilId {
  const normalizados = new Set(headers.map(normalizarHeaderCsv));
  const base = tipo === "pacientes" ? CAMPOS_PACIENTES : CAMPOS_CITAS;
  const genericos = new Set(base.flatMap((c) => c.generico));
  const propios = Object.values(ALIAS_DENTALINK[tipo])
    .flat()
    .filter((a) => !genericos.has(a));
  const coinciden = propios.filter((a) => normalizados.has(a)).length;
  return coinciden >= 3 ? "dentalink" : "generico";
}
