/**
 * Datos de la ficha que agregó la Ola 1 · Frente Pacientes: previsión
 * (FIC-02), contacto de emergencia (FIC-03), origen del paciente (FIC-04) e
 * indicador de ficha completa (SEG-08). Lógica pura, compartida entre el
 * formulario y las server functions; se prueba en tests/datos-ficha.test.ts.
 *
 * Los CHECK de la base (migración 20261022100000) son el par de estas
 * reglas: valores de previsión, tramo solo en Fonasa y largos máximos.
 */
import { toE164 } from "@/lib/messaging/telefonos";
import { errorDeDocumento, type TipoDocumento } from "@/lib/patients/rut";

// ── Sexo (opcional) ────────────────────────────────────────────────────────
// Dato opcional de la ficha, para el corte demográfico de Informes. Nunca se
// pide como obligatorio ni cuenta para «ficha completa»; «prefiere no decir»
// es una respuesta (distinta de «sin registrar», que es no haber preguntado).

export const SEXOS = ["femenino", "masculino", "otro", "prefiere_no_decir"] as const;
export type Sexo = (typeof SEXOS)[number];

export const ETIQUETA_SEXO: Record<Sexo, string> = {
  femenino: "Femenino",
  masculino: "Masculino",
  otro: "Otro",
  prefiere_no_decir: "Prefiere no decir",
};

export function esSexo(valor: unknown): valor is Sexo {
  return typeof valor === "string" && (SEXOS as readonly string[]).includes(valor);
}

// ── FIC-02 Previsión ───────────────────────────────────────────────────────

export const PREVISIONES = [
  "fonasa",
  "isapre",
  "particular",
  "ffaa",
  "extranjero",
  "sin_prevision",
] as const;
export type Prevision = (typeof PREVISIONES)[number];

export const ETIQUETA_PREVISION: Record<Prevision, string> = {
  fonasa: "Fonasa",
  isapre: "Isapre",
  particular: "Particular",
  ffaa: "FF. AA. y de Orden",
  extranjero: "Extranjero",
  sin_prevision: "Sin previsión",
};

export const TRAMOS_FONASA = ["A", "B", "C", "D"] as const;
export type TramoFonasa = (typeof TRAMOS_FONASA)[number];

/** Instituciones de las Fuerzas Armadas y de Orden con previsión propia. */
export const INSTITUCIONES_FFAA = ["Capredena", "Dipreca"] as const;

export function esPrevision(valor: unknown): valor is Prevision {
  return typeof valor === "string" && (PREVISIONES as readonly string[]).includes(valor);
}

export interface DatosPrevision {
  plan: Prevision | null;
  tramo: TramoFonasa | null;
  institucion: string | null;
}

/**
 * Errores de la previsión. `obligatoria` = paciente nuevo de una clínica de
 * Chile (Decreto 41); las fichas viejas pueden quedar sin previsión y se
 * muestran como "Pendiente".
 */
export function errorDePrevision(p: DatosPrevision, obligatoria: boolean): string | null {
  if (!p.plan) return obligatoria ? "Elige la previsión del paciente." : null;
  if (p.plan === "fonasa" && !p.tramo) return "Elige el tramo de Fonasa.";
  if (p.plan !== "fonasa" && p.tramo) return "El tramo solo corresponde a Fonasa.";
  if (p.plan === "isapre" && !p.institucion?.trim()) return "Elige la isapre.";
  if (
    p.plan === "ffaa" &&
    !(INSTITUCIONES_FFAA as readonly string[]).includes(p.institucion?.trim() ?? "")
  ) {
    return "Elige Capredena o Dipreca.";
  }
  if ((p.institucion?.trim().length ?? 0) > 80) return "El nombre de la institución es muy largo.";
  return null;
}

/** "Fonasa B", "Isapre Colmena", "Pendiente". */
export function textoPrevision(p: DatosPrevision): string {
  if (!p.plan) return "Pendiente";
  const base = ETIQUETA_PREVISION[p.plan];
  if (p.plan === "fonasa" && p.tramo) return `${base} ${p.tramo}`;
  if ((p.plan === "isapre" || p.plan === "ffaa") && p.institucion) {
    return p.plan === "isapre" ? `${base} ${p.institucion}` : p.institucion;
  }
  return base;
}

/** Lo que se guarda: sin tramo fuera de Fonasa y sin institución donde no aplica. */
export function previsionParaGuardar(p: DatosPrevision): DatosPrevision {
  if (!p.plan) return { plan: null, tramo: null, institucion: null };
  return {
    plan: p.plan,
    tramo: p.plan === "fonasa" ? p.tramo : null,
    institucion:
      p.plan === "isapre" || p.plan === "ffaa" ? (p.institucion?.trim() ?? null) || null : null,
  };
}

// ── FIC-03 Contacto de emergencia ──────────────────────────────────────────

export interface ContactoEmergencia {
  nombre: string;
  relacion: string;
  telefono: string;
}

export type CampoContacto = keyof ContactoEmergencia;

/**
 * Errores del contacto de emergencia. Es opcional, pero si se empieza hay
 * que completarlo: un nombre sin teléfono no sirve en una emergencia. El
 * teléfono tiene que poder leerse con el país de la clínica (o venir con +código).
 */
export function erroresDeContactoEmergencia(
  c: ContactoEmergencia,
  pais: string | null | undefined,
): Partial<Record<CampoContacto, string>> {
  const errores: Partial<Record<CampoContacto, string>> = {};
  const nombre = c.nombre.trim();
  const relacion = c.relacion.trim();
  const telefono = c.telefono.trim();
  if (!nombre && !relacion && !telefono) return errores;
  if (!nombre) errores.nombre = "Escribe el nombre del contacto.";
  else if (nombre.length > 120) errores.nombre = "El nombre es demasiado largo.";
  if (relacion.length > 60) errores.relacion = "La relación es demasiado larga.";
  if (!telefono) errores.telefono = "Escribe el teléfono del contacto.";
  else if (telefono.length > 40 || !toE164(telefono, pais ?? null)) {
    errores.telefono = "No reconocemos este teléfono. Escríbelo con el código de país (+56…).";
  }
  return errores;
}

/** El teléfono del contacto como se guarda: E.164 si se puede leer. */
export function telefonoDeContactoParaGuardar(
  telefono: string,
  pais: string | null | undefined,
): string | null {
  const t = telefono.trim();
  if (!t) return null;
  return toE164(t, pais ?? null) ?? t;
}

// ── FIC-04 Origen del paciente ─────────────────────────────────────────────

/** Una sola lista para toda la app (la misma que siembra la migración). */
export const ORIGENES_POR_DEFECTO = [
  "Instagram",
  "Google",
  "Recomendación",
  "Convenio",
  "Pasaba por aquí",
  "Otro",
] as const;

export const ORIGEN_RECOMENDACION = "Recomendación";
export const ORIGEN_OTRO = "Otro";

export const ISAPRES_POR_DEFECTO = [
  "Banmédica",
  "Colmena",
  "Consalud",
  "Cruz Blanca",
  "Nueva Masvida",
  "Vida Tres",
  "Esencial",
] as const;

export function errorDeOrigen(origen: string, detalle: string): string | null {
  if (origen.trim() === ORIGEN_OTRO && !detalle.trim()) return "Cuéntanos de dónde llegó.";
  if (detalle.trim().length > 200) return "El detalle es demasiado largo.";
  return null;
}

/**
 * Si el paciente llegó con un código de referido, el origen se fija solo:
 * "Recomendación" y, como detalle, quién lo recomendó.
 */
export function origenPorReferido(referente: { nombre: string } | null): {
  origen: string;
  detalle: string;
} | null {
  if (!referente) return null;
  return { origen: ORIGEN_RECOMENDACION, detalle: `Referido por ${referente.nombre}` };
}

/** "abc123" → "ABC123": los códigos de referido son de 6 caracteres en mayúscula. */
export function normalizarCodigoReferido(codigo: string): string {
  return codigo.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

// ── Validación del alta (PAC-11) ───────────────────────────────────────────

export interface DatosNuevoPaciente {
  nombre: string;
  documentoTipo: TipoDocumento;
  documento: string;
  fechaNacimiento: string;
  prevision: DatosPrevision;
  contacto: ContactoEmergencia;
  origen: string;
  origenDetalle: string;
}

export type CampoNuevoPaciente =
  | "nombre"
  | "documento"
  | "fechaNacimiento"
  | "prevision"
  | "contactoNombre"
  | "contactoRelacion"
  | "contactoTelefono"
  | "origen";

/**
 * Errores del formulario "Nuevo paciente". `esChile` hace obligatoria la
 * previsión (Decreto 41). Mismas reglas que valida `createPatient`.
 */
export function validarNuevoPaciente(
  d: DatosNuevoPaciente,
  opciones: { esChile: boolean; pais: string | null | undefined },
): Partial<Record<CampoNuevoPaciente, string>> {
  const errores: Partial<Record<CampoNuevoPaciente, string>> = {};
  const nombre = d.nombre.trim();
  if (!nombre) errores.nombre = "El nombre es obligatorio.";
  else if (nombre.length > 200) errores.nombre = "El nombre es demasiado largo.";
  const doc = errorDeDocumento(d.documento, d.documentoTipo);
  if (doc) errores.documento = doc;
  if (!d.fechaNacimiento) errores.fechaNacimiento = "La fecha de nacimiento es obligatoria.";
  const prev = errorDePrevision(d.prevision, opciones.esChile);
  if (prev) errores.prevision = prev;
  const contacto = erroresDeContactoEmergencia(d.contacto, opciones.pais);
  if (contacto.nombre) errores.contactoNombre = contacto.nombre;
  if (contacto.relacion) errores.contactoRelacion = contacto.relacion;
  if (contacto.telefono) errores.contactoTelefono = contacto.telefono;
  const origen = errorDeOrigen(d.origen, d.origenDetalle);
  if (origen) errores.origen = origen;
  return errores;
}

// ── SEG-08 Ficha completa (Decreto 41) ─────────────────────────────────────

export type FaltanteFicha =
  "prevision" | "documento" | "fechaNacimiento" | "direccion" | "anamnesis";

export const ETIQUETA_FALTANTE: Record<FaltanteFicha, string> = {
  prevision: "Previsión",
  documento: "RUT o documento",
  fechaNacimiento: "Fecha de nacimiento",
  direccion: "Dirección y comuna",
  anamnesis: "Anamnesis",
};

export interface DatosCompletitud {
  prevision: Prevision | null;
  documento: string | null;
  fechaNacimiento: string | null;
  direccion: string | null;
  comuna: string | null;
  /** true/false si se sabe; null si el rol no ve la historia clínica (no cuenta). */
  tieneAnamnesis: boolean | null;
}

/**
 * Qué le falta a la ficha. En Chile el Decreto 41 (reglamento de la ficha
 * clínica) pide identificar al paciente con RUT, fecha de nacimiento,
 * domicilio y previsión; fuera de Chile no se exigen previsión ni domicilio.
 * La anamnesis solo cuenta cuando se sabe (los roles sin acceso clínico no
 * la ven y no se les acusa un faltante que no pueden comprobar).
 */
export function faltantesDeLaFicha(d: DatosCompletitud, esChile: boolean): FaltanteFicha[] {
  const faltan: FaltanteFicha[] = [];
  if (esChile && !d.prevision) faltan.push("prevision");
  if (!d.documento?.trim()) faltan.push("documento");
  if (!d.fechaNacimiento) faltan.push("fechaNacimiento");
  if (esChile && (!d.direccion?.trim() || !d.comuna?.trim())) faltan.push("direccion");
  if (d.tieneAnamnesis === false) faltan.push("anamnesis");
  return faltan;
}

// ── PAC-11 Última salida elegida ───────────────────────────────────────────

export type SalidaAlta = "agendar" | "ficha";
export const CLAVE_SALIDA_ALTA = "esmalia:alta-paciente:salida";

/** La última salida que eligió esta persona en este navegador ("ficha" si no hay). */
export function leerSalidaAlta(almacen: Pick<Storage, "getItem"> | null | undefined): SalidaAlta {
  try {
    return almacen?.getItem(CLAVE_SALIDA_ALTA) === "agendar" ? "agendar" : "ficha";
  } catch {
    return "ficha";
  }
}

export function guardarSalidaAlta(
  almacen: Pick<Storage, "setItem"> | null | undefined,
  salida: SalidaAlta,
): void {
  try {
    almacen?.setItem(CLAVE_SALIDA_ALTA, salida);
  } catch {
    // Navegación privada o almacenamiento bloqueado: solo se pierde la preferencia.
  }
}

// ── Formulario: estado de los campos (todo texto, como los inputs) ─────────

export interface EstadoCamposFicha {
  documentoTipo: TipoDocumento;
  documento: string;
  plan: Prevision | "";
  tramo: TramoFonasa | "";
  institucion: string;
  contactoNombre: string;
  contactoRelacion: string;
  contactoTelefono: string;
  origen: string;
  origenDetalle: string;
  direccion: string;
  comuna: string;
  sexo: Sexo | "";
}

export function estadoCamposVacio(documentoTipo: TipoDocumento): EstadoCamposFicha {
  return {
    documentoTipo,
    documento: "",
    plan: "",
    tramo: "",
    institucion: "",
    contactoNombre: "",
    contactoRelacion: "",
    contactoTelefono: "",
    origen: "",
    origenDetalle: "",
    direccion: "",
    comuna: "",
    sexo: "",
  };
}

/** Los campos de una ficha existente (null → vacío). */
export function estadoCamposDe(
  p: {
    documento?: string | null;
    documentoTipo?: TipoDocumento | null;
    prevision?: Prevision | null;
    previsionTramo?: TramoFonasa | null;
    previsionInstitucion?: string | null;
    contactoEmergencia?: ContactoEmergencia | null;
    origen?: string | null;
    origenDetalle?: string | null;
    direccion?: string | null;
    comuna?: string | null;
    sexo?: Sexo | null;
  },
  tipoPorDefecto: TipoDocumento,
): EstadoCamposFicha {
  return {
    documentoTipo: p.documentoTipo ?? tipoPorDefecto,
    documento: p.documento ?? "",
    plan: p.prevision ?? "",
    tramo: p.previsionTramo ?? "",
    institucion: p.previsionInstitucion ?? "",
    contactoNombre: p.contactoEmergencia?.nombre ?? "",
    contactoRelacion: p.contactoEmergencia?.relacion ?? "",
    contactoTelefono: p.contactoEmergencia?.telefono ?? "",
    origen: p.origen ?? "",
    origenDetalle: p.origenDetalle ?? "",
    direccion: p.direccion ?? "",
    comuna: p.comuna ?? "",
    sexo: p.sexo ?? "",
  };
}

export function previsionDeEstado(e: EstadoCamposFicha): DatosPrevision {
  return {
    plan: e.plan || null,
    tramo: e.tramo || null,
    institucion: e.institucion.trim() || null,
  };
}

export function contactoDeEstado(e: EstadoCamposFicha): ContactoEmergencia {
  return { nombre: e.contactoNombre, relacion: e.contactoRelacion, telefono: e.contactoTelefono };
}

/**
 * Lo que cambió entre dos estados, por grupo (previsión, contacto y origen
 * viajan enteros). Para el diálogo "Editar datos": solo manda lo tocado.
 * El documento va aparte (lo maneja `cambiosDeDatosBasicos`), salvo su tipo.
 */
export function cambiosDeFicha(
  antes: EstadoCamposFicha,
  despues: EstadoCamposFicha,
): EntradaFichaOla1 {
  const c: EntradaFichaOla1 = {};
  const t = (s: string) => s.trim();
  if (despues.documentoTipo !== antes.documentoTipo) c.documentoTipo = despues.documentoTipo;
  if (
    despues.plan !== antes.plan ||
    despues.tramo !== antes.tramo ||
    t(despues.institucion) !== t(antes.institucion)
  ) {
    c.prevision = previsionDeEstado(despues);
  }
  if (
    t(despues.contactoNombre) !== t(antes.contactoNombre) ||
    t(despues.contactoRelacion) !== t(antes.contactoRelacion) ||
    t(despues.contactoTelefono) !== t(antes.contactoTelefono)
  ) {
    c.contactoEmergencia = contactoDeEstado(despues);
  }
  if (
    t(despues.origen) !== t(antes.origen) ||
    t(despues.origenDetalle) !== t(antes.origenDetalle)
  ) {
    c.origen = { fuente: despues.origen, detalle: despues.origenDetalle };
  }
  if (t(despues.direccion) !== t(antes.direccion)) c.direccion = despues.direccion;
  if (t(despues.comuna) !== t(antes.comuna)) c.comuna = despues.comuna;
  if (despues.sexo !== antes.sexo) c.sexo = despues.sexo || null;
  return c;
}

export type CampoFicha =
  "documento" | "prevision" | "contactoNombre" | "contactoRelacion" | "contactoTelefono" | "origen";

/** Errores de los campos de la ficha. `previsionObligatoria` = alta en Chile. */
export function erroresDeCamposFicha(
  e: EstadoCamposFicha,
  opciones: { previsionObligatoria: boolean; pais: string | null | undefined },
): Partial<Record<CampoFicha, string>> {
  const errores: Partial<Record<CampoFicha, string>> = {};
  const doc = errorDeDocumento(e.documento, e.documentoTipo);
  if (doc) errores.documento = doc;
  const prev = errorDePrevision(previsionDeEstado(e), opciones.previsionObligatoria);
  if (prev) errores.prevision = prev;
  const contacto = erroresDeContactoEmergencia(contactoDeEstado(e), opciones.pais);
  if (contacto.nombre) errores.contactoNombre = contacto.nombre;
  if (contacto.relacion) errores.contactoRelacion = contacto.relacion;
  if (contacto.telefono) errores.contactoTelefono = contacto.telefono;
  const origen = errorDeOrigen(e.origen, e.origenDetalle);
  if (origen) errores.origen = origen;
  return errores;
}

// ── Servidor: de lo que manda el formulario a las columnas ─────────────────

export interface EntradaFichaOla1 {
  documentoTipo?: TipoDocumento;
  prevision?: DatosPrevision;
  contactoEmergencia?: ContactoEmergencia;
  origen?: { fuente: string; detalle: string };
  direccion?: string;
  comuna?: string;
  /** `null` borra el dato (vuelve a «sin registrar»). */
  sexo?: Sexo | null;
}

/** Columnas de `patients` que escribe la Ola 1 (todas nullable). */
export interface ParcheFichaOla1 {
  document_type?: TipoDocumento | null;
  health_plan?: Prevision | null;
  health_plan_tier?: TramoFonasa | null;
  health_plan_institution?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_relationship?: string | null;
  emergency_contact_phone?: string | null;
  acquisition_source?: string | null;
  acquisition_source_detail?: string | null;
  address?: string | null;
  commune?: string | null;
  sex?: Sexo | null;
}

/**
 * Valida en el servidor lo que mandó el formulario (mismas reglas que el
 * cliente) y arma el parche de columnas. `esAlta` + Chile hace obligatoria
 * la previsión. `documentoFinal` / `tipoFinal` son los que quedan en la
 * ficha después de guardar (los nuevos o, si no cambian, los actuales):
 * un RUT inválido no se guarda nunca (el CHECK patients_rut_valido es la
 * última barrera).
 */
export function parcheDeFichaOla1(
  e: EntradaFichaOla1,
  ctx: {
    pais: string | null | undefined;
    esAlta: boolean;
    documentoFinal: string | null | undefined;
    tipoFinal: TipoDocumento | null | undefined;
  },
): { parche: ParcheFichaOla1; error: string | null } {
  const parche: ParcheFichaOla1 = {};
  const esChile = (ctx.pais ?? "").toUpperCase() === "CL";

  const errorDoc = errorDeDocumento(ctx.documentoFinal ?? "", ctx.tipoFinal);
  if (errorDoc) return { parche, error: errorDoc };
  if (e.documentoTipo !== undefined) parche.document_type = e.documentoTipo;

  if (e.prevision !== undefined || (ctx.esAlta && esChile)) {
    const p = e.prevision ?? { plan: null, tramo: null, institucion: null };
    const error = errorDePrevision(p, ctx.esAlta && esChile);
    if (error) return { parche, error };
    const g = previsionParaGuardar(p);
    parche.health_plan = g.plan;
    parche.health_plan_tier = g.tramo;
    parche.health_plan_institution = g.institucion;
  }

  if (e.contactoEmergencia !== undefined) {
    const c = e.contactoEmergencia;
    const errores = erroresDeContactoEmergencia(c, ctx.pais);
    const primero = errores.nombre ?? errores.relacion ?? errores.telefono;
    if (primero) return { parche, error: primero };
    parche.emergency_contact_name = c.nombre.trim() || null;
    parche.emergency_contact_relationship = c.relacion.trim() || null;
    parche.emergency_contact_phone = telefonoDeContactoParaGuardar(c.telefono, ctx.pais);
  }

  if (e.origen !== undefined) {
    const error = errorDeOrigen(e.origen.fuente, e.origen.detalle);
    if (error) return { parche, error };
    parche.acquisition_source = e.origen.fuente.trim() || null;
    parche.acquisition_source_detail = e.origen.detalle.trim() || null;
  }

  if (e.direccion !== undefined) parche.address = e.direccion.trim() || null;
  if (e.comuna !== undefined) parche.commune = e.comuna.trim() || null;
  if (e.sexo !== undefined) {
    if (e.sexo !== null && !esSexo(e.sexo)) return { parche, error: "Elige una opción de sexo válida." };
    parche.sex = e.sexo;
  }

  return { parche, error: null };
}
