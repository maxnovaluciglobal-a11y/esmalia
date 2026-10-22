/**
 * Catálogo de variables del motor de documentos (DOC-01) y armado del
 * contexto a partir de los datos de la ficha. Lógica pura: la usan el editor
 * (lista de variables insertables y aviso de inválidas), la vista previa en
 * el navegador y la emisión en el servidor, con el mismo resultado.
 *
 * Variables en español, agrupadas por de dónde sale el dato:
 *   {{paciente.*}}     ficha del paciente
 *   {{clinica.*}}      datos de la clínica y datos tributarios (FIN-16)
 *   {{profesional.*}}  quien emite y firma
 *   {{fecha}}          hoy en la zona horaria de la clínica
 *   {{campo.*}}        lo que se completa al emitir (motivo, días de reposo…)
 *   {{reembolso.*}}    prestaciones y pagos de un período (MKT-04)
 *   {{receta.*}}       medicamentos, alergias e indicaciones (MKT-05, receta.ts)
 *
 * Los frentes siguientes (presupuesto, receta) suman su propio grupo acá
 * (`presupuesto.*`, `receta.*`) y su función de contexto, sin tocar el motor.
 */
import { formatMoney } from "@/lib/finance/finance";
import { fecha as fechaCorta, fechaDocumento } from "@/lib/formato-fecha";
import { textoPrevision, type DatosPrevision } from "@/lib/patients/datos-ficha";
import { ETIQUETA_TIPO_DOCUMENTO, esTipoDocumento, formatearRut } from "@/lib/patients/rut";
import type { TablaDeContexto } from "@/lib/documentos/tipos";
// MKT-05 · receta
import {
  contextoDeReceta,
  RECETA_DE_EJEMPLO,
  VARIABLES_RECETA,
  type DatosReceta,
} from "@/lib/documentos/receta";

export type GrupoVariable =
  | "paciente"
  | "clinica"
  | "profesional"
  | "documento"
  | "campo"
  | "reembolso"
  // MKT-05 · receta
  | "receta";

export const ETIQUETA_GRUPO: Record<GrupoVariable, string> = {
  paciente: "Paciente",
  clinica: "Clínica",
  profesional: "Profesional",
  documento: "Documento",
  campo: "Se completa al emitir",
  reembolso: "Reembolso",
  // MKT-05 · receta
  receta: "Receta",
};

export interface DefinicionVariable {
  clave: string;
  grupo: GrupoVariable;
  etiqueta: string;
  /** Valor de ejemplo para la vista previa del editor. */
  ejemplo: string;
  /** Variable de bloque: va sola en su línea y se imprime como tabla. */
  bloque?: boolean;
}

export type TipoCampo = "texto" | "texto_largo" | "numero" | "fecha";

export interface DefinicionCampo {
  /** Sin el prefijo: "motivo" para `{{campo.motivo}}`. */
  nombre: string;
  etiqueta: string;
  tipo: TipoCampo;
  /** Opcional: se puede emitir sin completarlo (se imprime "—"). */
  opcional?: boolean;
  ejemplo: string;
}

/** Variables de datos (todo menos `campo.*`). Orden = orden en el editor. */
export const VARIABLES: readonly DefinicionVariable[] = [
  { clave: "paciente.nombre", grupo: "paciente", etiqueta: "Nombre", ejemplo: "Ana Pérez Soto" },
  {
    clave: "paciente.rut",
    grupo: "paciente",
    etiqueta: "RUT o documento",
    ejemplo: "12.345.678-5",
  },
  {
    clave: "paciente.tipo_documento",
    grupo: "paciente",
    etiqueta: "Tipo de documento",
    ejemplo: "RUT",
  },
  {
    clave: "paciente.fecha_nacimiento",
    grupo: "paciente",
    etiqueta: "Fecha de nacimiento",
    ejemplo: "4 de marzo de 1990",
  },
  { clave: "paciente.edad", grupo: "paciente", etiqueta: "Edad", ejemplo: "36 años" },
  { clave: "paciente.prevision", grupo: "paciente", etiqueta: "Previsión", ejemplo: "Fonasa B" },
  {
    clave: "paciente.direccion",
    grupo: "paciente",
    etiqueta: "Dirección",
    ejemplo: "Av. Grecia 1234",
  },
  { clave: "paciente.comuna", grupo: "paciente", etiqueta: "Comuna", ejemplo: "Ñuñoa" },
  {
    clave: "paciente.telefono",
    grupo: "paciente",
    etiqueta: "Teléfono",
    ejemplo: "+56 9 1234 5678",
  },
  {
    clave: "paciente.email",
    grupo: "paciente",
    etiqueta: "Correo",
    ejemplo: "ana.perez@correo.cl",
  },
  {
    clave: "clinica.nombre",
    grupo: "clinica",
    etiqueta: "Nombre de la clínica",
    ejemplo: "Clínica Dental Sonrisa",
  },
  {
    clave: "clinica.razon_social",
    grupo: "clinica",
    etiqueta: "Razón social",
    ejemplo: "Sonrisa Dental SpA",
  },
  {
    clave: "clinica.rut",
    grupo: "clinica",
    etiqueta: "RUT de la empresa",
    ejemplo: "76.123.456-0",
  },
  {
    clave: "clinica.giro",
    grupo: "clinica",
    etiqueta: "Giro",
    ejemplo: "Servicios odontológicos",
  },
  {
    clave: "clinica.direccion_tributaria",
    grupo: "clinica",
    etiqueta: "Dirección tributaria",
    ejemplo: "Av. Providencia 1234, Providencia",
  },
  {
    clave: "clinica.direccion",
    grupo: "clinica",
    etiqueta: "Dirección de la sucursal",
    ejemplo: "Av. Providencia 1234, Santiago",
  },
  {
    clave: "clinica.telefono",
    grupo: "clinica",
    etiqueta: "Teléfono",
    ejemplo: "+56 2 2345 6789",
  },
  {
    clave: "clinica.tipo_boleta",
    grupo: "clinica",
    etiqueta: "Tipo de boleta",
    ejemplo: "Boleta exenta",
  },
  {
    clave: "profesional.nombre",
    grupo: "profesional",
    etiqueta: "Nombre",
    ejemplo: "Dra. Carolina Rodríguez",
  },
  {
    clave: "profesional.registro_sis",
    grupo: "profesional",
    etiqueta: "Registro Superintendencia de Salud",
    ejemplo: "123456",
  },
  {
    clave: "profesional.especialidad",
    grupo: "profesional",
    etiqueta: "Especialidad",
    ejemplo: "Endodoncia",
  },
  {
    clave: "fecha",
    grupo: "documento",
    etiqueta: "Fecha de emisión",
    ejemplo: "22 de octubre de 2026",
  },
  {
    clave: "fecha_corta",
    grupo: "documento",
    etiqueta: "Fecha de emisión (corta)",
    ejemplo: "22 oct 2026",
  },
  {
    clave: "reembolso.prestaciones",
    grupo: "reembolso",
    etiqueta: "Tabla de prestaciones del período",
    ejemplo: "(tabla)",
    bloque: true,
  },
  {
    clave: "reembolso.total_pagado",
    grupo: "reembolso",
    etiqueta: "Total pagado en el período",
    ejemplo: "$85.000",
  },
  {
    clave: "reembolso.periodo",
    grupo: "reembolso",
    etiqueta: "Período",
    ejemplo: "1 de septiembre de 2026 al 30 de septiembre de 2026",
  },
  // MKT-05 · receta
  ...VARIABLES_RECETA,
];

/**
 * Campos conocidos: se piden al emitir con su etiqueta y tipo. Una plantilla
 * puede usar además campos propios (`{{campo.numero_de_ficha_isapre}}`): se
 * piden como texto, con la etiqueta armada desde el nombre.
 */
export const CAMPOS: readonly DefinicionCampo[] = [
  {
    nombre: "fecha_atencion",
    etiqueta: "Fecha de la atención",
    tipo: "fecha",
    ejemplo: "2026-10-22",
  },
  { nombre: "motivo", etiqueta: "Motivo", tipo: "texto_largo", ejemplo: "Control y destartraje" },
  {
    nombre: "diagnostico",
    etiqueta: "Diagnóstico",
    tipo: "texto_largo",
    ejemplo: "Pericoronaritis de la pieza 38",
  },
  { nombre: "dias_reposo", etiqueta: "Días de reposo", tipo: "numero", ejemplo: "2" },
  { nombre: "reposo_desde", etiqueta: "Reposo desde", tipo: "fecha", ejemplo: "2026-10-22" },
  { nombre: "reposo_hasta", etiqueta: "Reposo hasta", tipo: "fecha", ejemplo: "2026-10-23" },
  { nombre: "derivado_a", etiqueta: "Derivado a", tipo: "texto", ejemplo: "Cirugía maxilofacial" },
  {
    nombre: "antecedentes",
    etiqueta: "Antecedentes relevantes",
    tipo: "texto_largo",
    ejemplo: "Hipertensión controlada",
  },
  {
    nombre: "solicitud",
    etiqueta: "Lo que se solicita",
    tipo: "texto_largo",
    ejemplo: "Evaluación y exodoncia de la pieza 38",
  },
  { nombre: "fecha_alta", etiqueta: "Fecha del alta", tipo: "fecha", ejemplo: "2026-10-22" },
  {
    nombre: "tratamiento_realizado",
    etiqueta: "Tratamiento realizado",
    tipo: "texto_largo",
    ejemplo: "Endodoncia y corona de la pieza 46",
  },
  {
    nombre: "indicaciones",
    etiqueta: "Indicaciones",
    tipo: "texto_largo",
    opcional: true,
    ejemplo: "Control en 6 meses",
  },
  {
    nombre: "hallazgos",
    etiqueta: "Hallazgos clínicos",
    tipo: "texto_largo",
    ejemplo: "Caries profunda en 46",
  },
  {
    nombre: "plan_tratamiento",
    etiqueta: "Plan de tratamiento",
    tipo: "texto_largo",
    ejemplo: "Endodoncia y corona",
  },
  {
    nombre: "observaciones",
    etiqueta: "Observaciones",
    tipo: "texto_largo",
    opcional: true,
    ejemplo: "Sin observaciones",
  },
  {
    nombre: "procedimiento",
    etiqueta: "Procedimiento",
    tipo: "texto",
    ejemplo: "Destartraje y pulido",
  },
  { nombre: "aseguradora", etiqueta: "Aseguradora", tipo: "texto", ejemplo: "Seguros Vida Sur" },
  {
    nombre: "numero_poliza",
    etiqueta: "N.º de póliza",
    tipo: "texto",
    opcional: true,
    ejemplo: "POL-12345",
  },
  { nombre: "periodo_desde", etiqueta: "Período desde", tipo: "fecha", ejemplo: "2026-09-01" },
  { nombre: "periodo_hasta", etiqueta: "Período hasta", tipo: "fecha", ejemplo: "2026-09-30" },
];

export const PREFIJO_CAMPO = "campo.";

const POR_CLAVE = new Map(VARIABLES.map((v) => [v.clave, v]));
const CAMPO_POR_NOMBRE = new Map(CAMPOS.map((c) => [c.nombre, c]));

/** Nombre de campo propio válido: minúsculas, dígitos y guion bajo, empieza con letra. */
const NOMBRE_CAMPO = /^[a-z][a-z0-9_]{0,39}$/;

export function definicionVariable(clave: string): DefinicionVariable | undefined {
  return POR_CLAVE.get(clave);
}

export function esVariableDeBloque(clave: string): boolean {
  return POR_CLAVE.get(clave)?.bloque === true;
}

/** `campo.motivo` → "motivo"; null si no es un campo o el nombre no es válido. */
export function nombreDeCampo(clave: string): string | null {
  if (!clave.startsWith(PREFIJO_CAMPO)) return null;
  const nombre = clave.slice(PREFIJO_CAMPO.length);
  return NOMBRE_CAMPO.test(nombre) ? nombre : null;
}

/** ¿El motor sabe resolver esta variable? */
export function esVariableConocida(clave: string): boolean {
  return POR_CLAVE.has(clave) || nombreDeCampo(clave) !== null;
}

/** "numero_de_ficha" → "Numero de ficha" (campos propios de una plantilla). */
function etiquetaDesdeNombre(nombre: string): string {
  const texto = nombre.replace(/_/g, " ").trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Definición de un campo (conocido o propio). */
export function definicionCampo(nombre: string): DefinicionCampo & { propio: boolean } {
  const conocido = CAMPO_POR_NOMBRE.get(nombre);
  if (conocido) return { ...conocido, propio: false };
  return {
    nombre,
    etiqueta: etiquetaDesdeNombre(nombre),
    tipo: "texto",
    ejemplo: "…",
    propio: true,
  };
}

// ─── Contexto desde los datos de la ficha ────────────────────────────────────

export interface FilaReembolso {
  /** Día civil de la prestación (YYYY-MM-DD). */
  fecha: string;
  prestacion: string;
  pieza: number | null;
  codigoFonasa: string | null;
  /** Lo pagado por esta prestación (pagos imputados a ella, sin reversados). null = sin pagos imputados. */
  pagadoCents: number | null;
}

export interface DatosParaDocumento {
  /** Zona horaria IANA de la clínica. */
  zona: string;
  /** Instante de emisión (ISO). */
  ahora: string;
  moneda: string;
  paciente: {
    nombre: string;
    tipoDocumento: string | null;
    documento: string | null;
    fechaNacimiento: string | null;
    prevision: DatosPrevision;
    direccion: string | null;
    comuna: string | null;
    telefono: string | null;
    email: string | null;
  };
  clinica: {
    nombre: string;
    razonSocial: string | null;
    rut: string | null;
    giro: string | null;
    direccionTributaria: string | null;
    comunaTributaria: string | null;
    direccion: string | null;
    telefono: string | null;
    tipoBoleta: TipoBoleta | null;
  };
  profesional: {
    nombre: string;
    registroSis: string | null;
    especialidad: string | null;
  } | null;
  /** Solo si la plantilla usa `{{reembolso.*}}` y hay período. */
  reembolso?: {
    filas: FilaReembolso[];
    totalPagadoCents: number;
  };
  // MKT-05 · receta: solo al emitir una receta (tarjeta Recetas de la ficha).
  receta?: DatosReceta;
  /** Lo completado al emitir: nombre del campo → texto (fechas como YYYY-MM-DD). */
  campos: Readonly<Record<string, string>>;
}

export const TIPOS_BOLETA = ["exenta", "afecta"] as const;
export type TipoBoleta = (typeof TIPOS_BOLETA)[number];
export const ETIQUETA_TIPO_BOLETA: Record<TipoBoleta, string> = {
  exenta: "Boleta exenta",
  afecta: "Boleta afecta",
};

const FECHA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/** Años cumplidos a la fecha `hoy` (YYYY-MM-DD); null sin fecha válida. */
export function edadEnAnios(nacimiento: string | null, hoy: string): number | null {
  if (!nacimiento || !FECHA_CIVIL.test(nacimiento) || !FECHA_CIVIL.test(hoy)) return null;
  const [an, mn, dn] = nacimiento.split("-").map(Number);
  const [ah, mh, dh] = hoy.split("-").map(Number);
  let edad = ah - an;
  if (mh < mn || (mh === mn && dh < dn)) edad -= 1;
  return edad >= 0 && edad < 150 ? edad : null;
}

function limpio(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

/** Texto de un campo según su tipo: las fechas van largas, el resto tal cual. */
export function textoDeCampo(
  nombre: string,
  valor: string | null | undefined,
  zona: string,
): string | null {
  const v = limpio(valor);
  if (!v) return null;
  const def = definicionCampo(nombre);
  if (def.tipo === "fecha" && FECHA_CIVIL.test(v)) return fechaDocumento(v, zona);
  return v;
}

/** Día civil (YYYY-MM-DD) del instante en la zona dada. */
function diaCivil(iso: string, zona: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Tabla de prestaciones del formulario de reembolso (MKT-04). */
export function tablaDeReembolso(
  filas: readonly FilaReembolso[],
  totalPagadoCents: number,
  moneda: string,
  zona: string,
): TablaDeContexto {
  return {
    tipo: "tabla",
    columnas: [
      { titulo: "Fecha", alineacion: "izquierda" },
      { titulo: "Prestación", alineacion: "izquierda" },
      { titulo: "Código Fonasa", alineacion: "izquierda" },
      { titulo: "Monto pagado", alineacion: "derecha" },
    ],
    filas: filas.map((f) => [
      fechaCorta(f.fecha, zona),
      f.pieza ? `${f.prestacion} (pieza ${f.pieza})` : f.prestacion,
      f.codigoFonasa ?? "—",
      f.pagadoCents === null ? "—" : formatMoney(f.pagadoCents, moneda),
    ]),
    pie: ["", "", "Total pagado en el período", formatMoney(totalPagadoCents, moneda)],
    vacia: "No hay prestaciones realizadas en el período.",
  };
}

/** Arma el contexto del motor (texto por variable) desde los datos de la ficha. */
export function construirContexto(datos: DatosParaDocumento): {
  valores: Record<string, string | null>;
  tablas: Record<string, TablaDeContexto>;
} {
  const { paciente, clinica, profesional, zona } = datos;
  const hoy = diaCivil(datos.ahora, zona);
  const edad = edadEnAnios(paciente.fechaNacimiento, hoy);
  const tipoDoc = esTipoDocumento(paciente.tipoDocumento)
    ? ETIQUETA_TIPO_DOCUMENTO[paciente.tipoDocumento]
    : limpio(paciente.documento)
      ? "Documento"
      : null;
  const documento = limpio(paciente.documento);

  const direccionTributaria =
    [limpio(clinica.direccionTributaria), limpio(clinica.comunaTributaria)]
      .filter(Boolean)
      .join(", ") || null;

  const valores: Record<string, string | null> = {
    "paciente.nombre": limpio(paciente.nombre),
    "paciente.rut":
      documento && paciente.tipoDocumento === "rut" ? formatearRut(documento) : documento,
    "paciente.tipo_documento": tipoDoc,
    "paciente.fecha_nacimiento": paciente.fechaNacimiento
      ? fechaDocumento(paciente.fechaNacimiento, zona)
      : null,
    "paciente.edad": edad === null ? null : `${edad} ${edad === 1 ? "año" : "años"}`,
    "paciente.prevision": paciente.prevision.plan ? textoPrevision(paciente.prevision) : null,
    "paciente.direccion": limpio(paciente.direccion),
    "paciente.comuna": limpio(paciente.comuna),
    "paciente.telefono": limpio(paciente.telefono),
    "paciente.email": limpio(paciente.email),
    "clinica.nombre": limpio(clinica.nombre),
    "clinica.razon_social": limpio(clinica.razonSocial),
    "clinica.rut": clinica.rut ? formatearRut(clinica.rut) : null,
    "clinica.giro": limpio(clinica.giro),
    "clinica.direccion_tributaria": direccionTributaria,
    "clinica.direccion": limpio(clinica.direccion),
    "clinica.telefono": limpio(clinica.telefono),
    "clinica.tipo_boleta": clinica.tipoBoleta ? ETIQUETA_TIPO_BOLETA[clinica.tipoBoleta] : null,
    "profesional.nombre": limpio(profesional?.nombre),
    "profesional.registro_sis": limpio(profesional?.registroSis),
    "profesional.especialidad": limpio(profesional?.especialidad),
    fecha: fechaDocumento(datos.ahora, zona),
    fecha_corta: fechaCorta(datos.ahora, zona),
  };

  for (const [nombre, valor] of Object.entries(datos.campos)) {
    if (!NOMBRE_CAMPO.test(nombre)) continue;
    valores[`${PREFIJO_CAMPO}${nombre}`] = textoDeCampo(nombre, valor, zona);
  }

  const tablas: Record<string, TablaDeContexto> = {};
  if (datos.reembolso) {
    tablas["reembolso.prestaciones"] = tablaDeReembolso(
      datos.reembolso.filas,
      datos.reembolso.totalPagadoCents,
      datos.moneda,
      zona,
    );
    valores["reembolso.total_pagado"] = formatMoney(datos.reembolso.totalPagadoCents, datos.moneda);
  }
  const desde = datos.campos.periodo_desde;
  const hasta = datos.campos.periodo_hasta;
  if (desde && hasta && FECHA_CIVIL.test(desde) && FECHA_CIVIL.test(hasta)) {
    valores["reembolso.periodo"] =
      `${fechaDocumento(desde, zona)} al ${fechaDocumento(hasta, zona)}`;
  }
  // MKT-05 · receta
  if (datos.receta) {
    const receta = contextoDeReceta(datos.receta);
    Object.assign(valores, receta.valores);
    Object.assign(tablas, receta.tablas);
  }
  return { valores, tablas };
}

/** Contexto de ejemplo para la vista previa del editor (sin datos reales). */
export function contextoDeEjemplo(): {
  valores: Record<string, string | null>;
  tablas: Record<string, TablaDeContexto>;
} {
  const valores: Record<string, string | null> = {};
  for (const v of VARIABLES) if (!v.bloque) valores[v.clave] = v.ejemplo;
  for (const c of CAMPOS) {
    valores[`${PREFIJO_CAMPO}${c.nombre}`] = textoDeCampo(c.nombre, c.ejemplo, "America/Santiago");
  }
  // MKT-05 · receta
  const receta = contextoDeReceta(RECETA_DE_EJEMPLO);
  Object.assign(valores, receta.valores);
  return {
    valores,
    tablas: {
      ...receta.tablas,
      "reembolso.prestaciones": tablaDeReembolso(
        [
          {
            fecha: "2026-09-08",
            prestacion: "Destartraje y pulido",
            pieza: null,
            codigoFonasa: "2701004",
            pagadoCents: 35000,
          },
          {
            fecha: "2026-09-15",
            prestacion: "Obturación de resina compuesta",
            pieza: 46,
            codigoFonasa: null,
            pagadoCents: 50000,
          },
        ],
        85000,
        "CLP",
        "America/Santiago",
      ),
    },
  };
}
