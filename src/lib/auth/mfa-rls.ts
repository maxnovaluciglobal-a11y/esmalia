// src/lib/auth/mfa-rls.ts
//
// SEG-01, segunda parte: el MFA de quien lo activó tiene que valer también
// contra PostgREST, no solo en la pantalla. La migración
// `20261019230000_rls_exige_aal2.sql` agrega una política RESTRICTIVE
// `mfa_exige_aal2` en cada tabla de esta lista: si la cuenta tiene un factor
// TOTP verificado, la sesión tiene que ser `aal2`; si no tiene ninguno, todo
// sigue igual (`aal1` alcanza).
//
// Este archivo es la fuente de la lista y del SQL que la migración repite.
// `tests/mfa-rls-tablas.test.ts` exige que:
// - cada tabla creada en `supabase/migrations/` esté clasificada acá, en una
//   de las dos listas (una tabla nueva sin clasificar deja el CI en rojo);
// - la migración contenga, para cada tabla protegida, exactamente el SQL que
//   genera `sqlPoliticaAal2`. Una tabla creada después de esa migración lleva
//   el mismo SQL (y su reversa comentada) en la migración que la crea.
//
// No lo importa la app: solo los tests (no entra en ningún bundle).

/** Nombre de la política RESTRICTIVE en cada tabla. */
export const POLITICA_AAL2 = "mfa_exige_aal2";

/** Función SECURITY DEFINER que decide si la sesión cumple. */
export const FUNCION_AAL2 = "public.sesion_cumple_mfa()";

/** Ruta de la migración que crea las políticas. */
export const MIGRACION_AAL2 = "20261019230000_rls_exige_aal2.sql";

/**
 * Tablas que exigen `aal2` a quien tiene MFA. Criterio: datos de salud,
 * cualquier fila que identifique a un paciente o lo que escribió, y
 * movimientos de dinero. Orden alfabético.
 */
export const TABLAS_CON_AAL2: Readonly<Record<string, string>> = {
  appointment_requests: "pedidos de hora: paciente y motivo de consulta",
  appointments: "agenda: quién se atiende, cuándo y por qué",
  cash_registers: "caja: montos de apertura, cierre y diferencias",
  clinical_access_log: "quién abrió qué sección de qué ficha",
  clinical_note_audit: "bitácora de la historia clínica",
  clinical_note_entities: "entidades clínicas extraídas de las notas",
  clinical_note_reviews: "revisiones de notas clínicas",
  clinical_note_versions: "texto de cada versión de la nota clínica",
  clinical_notes: "historia clínica",
  commission_settlements: "liquidaciones de comisiones: producción y pagos",
  data_subject_request_events: "bitácora de las solicitudes de derechos de cada paciente",
  data_subject_requests: "solicitudes de derechos del paciente (Ley 21.719): quién pidió qué",
  expenses: "gastos de la clínica",
  followup_tasks: "tareas de seguimiento: a qué paciente llamar y por qué",
  import_batch_changes: "migración: datos de pacientes que completó un lote importado",
  import_batches: "migración: lotes importados desde otro sistema (archivo y conteos)",
  issued_documents: "documentos emitidos a un paciente: certificados, informes y reembolsos",
  lab_orders: "órdenes de laboratorio de un paciente",
  membership_charges: "cuotas de membresía de cada paciente: monto, estado y cobro",
  membership_plans: "planes de membresía de la clínica y su cuota",
  messages: "conversaciones con pacientes (WhatsApp, correo)",
  notifications: "avisos internos que nombran pacientes y notas",
  odontogram_marks: "odontograma",
  online_booking_settings: "reserva en línea: reglas y procedimientos reservables de la clínica",
  online_booking_verifications:
    "reserva en línea: huellas de códigos y contactos (solo service_role)",
  ortho_cases: "casos de ortodoncia y su presupuesto",
  ortho_controls: "controles de ortodoncia",
  ortho_stage_events: "etapas del tratamiento de ortodoncia de un paciente",
  outreach_campaign_recipients:
    "destinatarios de cada campaña: paciente, correo o teléfono y estado",
  partner_companies: "empresas con convenio: descuento y descuento por planilla",
  partner_company_patients: "pacientes afiliados a una empresa con convenio",
  patient_consents: "consentimientos informados",
  patient_controls: "controles programados de cada paciente y su motivo",
  patient_documents: "documentos clínicos (radiografías, informes)",
  patient_email_dispatches: "correos automáticos a cada paciente: a quién y por qué cita",
  patient_guardians: "tutor o representante legal del paciente menor",
  patient_guardians_audit: "cambios del tutor del paciente",
  patient_implant_controls: "controles de los implantes de un paciente (hallazgos, ISQ, estado)",
  patient_implants: "implantes de un paciente: pieza, marca, lote, fecha y estado",
  patient_intake_forms: "formulario antes de la cita: contacto y anamnesis que envió el paciente",
  patient_label_assignments: 'etiquetas de cada paciente (pueden decir "deudor" o "VIP")',
  patient_labels: "catálogo de etiquetas de pacientes de la clínica",
  patient_medical_history: "anamnesis",
  patient_medical_history_audit: "cambios de la anamnesis",
  patient_memberships: "pacientes inscritos en un plan de membresía y su cuota pactada",
  patient_nps_responses: "encuesta de satisfacción: nota y comentario de cada paciente",
  patient_referrals: "interconsultas: motivo clínico, especialista y su respuesta",
  patient_segments: "segmentos de pacientes: filtros con nombre (saldo, previsión, etiquetas)",
  patient_signature_events: "bitácora de la firma a distancia: IP y dispositivo del paciente",
  patient_signature_requests:
    "firma a distancia: documento firmado por el paciente, su RUT enmascarado y la evidencia",
  patient_vital_signs: "signos vitales",
  patients: "identidad, contacto y alertas clínicas del paciente",
  payment_receipts: "folios de boletas y facturas emitidas por cada pago",
  payments: "pagos de pacientes",
  periodontal_charts: "periodontograma",
  periodontal_measurements: "mediciones del periodontograma",
  portal_access_log: "accesos del paciente a su portal",
  prescriptions: "recetas: medicamentos indicados a un paciente",
  quote_events: "historial de cada presupuesto: estados, contactos y motivos de rechazo",
  quote_items: "ítems de presupuestos",
  quotes: "presupuestos",
  receivable_installments: "cuotas de las cuentas por cobrar de un paciente",
  receivables: "cuentas por cobrar de un paciente",
  recurring_expenses: "gastos fijos de la clínica: arriendo, sueldos y servicios",
  security_incident_updates: "seguimientos de incidentes que pueden describir datos de pacientes",
  security_incidents: "incidentes de seguridad: pueden describir datos de salud de pacientes",
  treatment_items: "ítems de planes de tratamiento (clínico y precio)",
  treatment_plans: "planes de tratamiento",
  waitlist_entries: "lista de espera: paciente y motivo",
  whatsapp_leads: "primer mensaje de un prospecto (puede contar síntomas)",
};

/**
 * Tablas que NO exigen `aal2`, con el motivo. La mayoría son estructura de
 * la clínica que la app necesita para armar la pantalla y el flujo de
 * `/auth/verificar` (membresía, perfil, sucursales), catálogos sin datos de
 * pacientes, o tablas de backend solo para `service_role`.
 */
export const TABLAS_SIN_AAL2: Readonly<Record<string, string>> = {
  agenda_exceptions: "bloqueos y aperturas de la agenda: horarios del equipo, sin pacientes",
  agreement_coverage: "catálogo de coberturas de convenios",
  agreements: "catálogo de convenios",
  appointment_statuses: "catálogo de estados de cita",
  appointment_types: "catálogo de tipos de cita",
  branch_hours: "horario de atención de las sucursales",
  branches: "estructura de la clínica",
  clinic_agenda_settings: "configuración de la agenda",
  clinic_counters: "correlativos (sin datos)",
  clinic_data_exports: "bitácora de exportaciones: no guarda los datos exportados",
  clinic_medications: "vademécum propio de la clínica: medicamentos y posología, sin pacientes",
  clinic_members: "membresía: la app la lee antes y durante la verificación",
  clinical_protocols: "protocolos clínicos de la clínica (pasos e indicaciones), sin pacientes",
  clinic_patient_options: "listas editables de la ficha (isapres, origen): sin datos de pacientes",
  clinics: "estructura de la clínica",
  commission_rules: "configuración de porcentajes, no movimientos",
  consent_templates: "plantillas sin datos de pacientes",
  document_template_versions:
    "versiones del texto de las plantillas de documentos, sin datos de pacientes",
  document_templates: "plantillas de documentos sin datos de pacientes",
  email_sandbox_config: "configuración de envío",
  inventory_counts: "inventario",
  inventory_items: "catálogo de inventario",
  inventory_movements: "inventario",
  inventory_stock: "inventario",
  lab_catalog_items: "catálogo de trabajos y precios de costo de cada laboratorio, sin pacientes",
  labs: "catálogo de laboratorios",
  lifecycle_emails: "backend: solo service_role (sin políticas)",
  marketing_events: "backend: solo service_role (sin políticas)",
  marketing_leads: "backend: solo service_role (sin políticas)",
  message_templates: "plantillas sin datos de pacientes",
  mfa_email_codes: "backend: códigos del segundo paso por correo (solo el hash), sin políticas",
  mfa_email_events: "backend: bitácora del segundo paso por correo, sin políticas",
  mfa_email_settings: "backend: quién usa el correo como segundo paso, sin políticas",
  mfa_email_verifications:
    "backend: sesiones que pasaron el código por correo, sin políticas (las lee sesion_cumple_mfa)",
  notification_preferences: "preferencias propias del usuario",
  odontogram_condition_catalog: "catálogo de condiciones del odontograma",
  operatories: "estructura de la clínica",
  outreach_campaigns:
    "campañas: nombre, texto y filtro del grupo, sin datos de pacientes (los destinatarios van aparte)",
  outreach_templates: "plantillas de mensajes de la clínica, sin datos de pacientes",
  patient_document_bidx:
    "backend: índice ciego del documento, sin políticas (solo funciones SECURITY DEFINER)",
  patient_notification_settings: "configuración de los correos automáticos, sin datos de pacientes",
  payment_methods: "catálogo de medios de pago",
  procedure_package_items: "catálogo: prestaciones de cada paquete",
  procedure_packages: "catálogo de paquetes de prestaciones y su precio",
  procedure_price_realignments:
    "historial de realineaciones de precios de lista (sin datos de pacientes)",
  procedure_supplies: "catálogo de insumos por prestación",
  procedures: "catálogo de prestaciones y precios de lista",
  professional_schedules: "horarios del equipo",
  professionals: "equipo de la clínica",
  profiles: "perfil del usuario: la app lo lee antes de la verificación",
  specialties: "catálogo de especialidades",
  stripe_events: "backend: solo service_role (sin políticas)",
  subscriptions: "suscripción de la clínica a Esmalia: la app la lee para el estado de cuenta",
  trial_extensions: "backend: solo service_role (sin políticas)",
  warehouses: "estructura de inventario",
  whatsapp_accounts: "configuración del canal",
  whatsapp_credentials: "backend: solo service_role (sin políticas)",
};

/** Tablas protegidas, en orden alfabético. */
export function tablasConAal2(): string[] {
  return Object.keys(TABLAS_CON_AAL2).sort();
}

/** SQL idempotente que crea la política en una tabla. La migración lo
 *  contiene tal cual para cada tabla de `TABLAS_CON_AAL2`. */
export function sqlPoliticaAal2(tabla: string): string {
  if (!/^[a-z0-9_]+$/.test(tabla)) throw new Error(`Nombre de tabla inválido: ${tabla}`);
  return [
    `drop policy if exists ${POLITICA_AAL2} on public.${tabla};`,
    `create policy ${POLITICA_AAL2} on public.${tabla}`,
    `  as restrictive`,
    `  for all`,
    `  to authenticated`,
    `  using ((select ${FUNCION_AAL2}))`,
    `  with check ((select ${FUNCION_AAL2}));`,
  ].join("\n");
}

/** SQL de la reversa para una tabla (va en el PR y al pie de la migración). */
export function sqlReversaAal2(tabla: string): string {
  if (!/^[a-z0-9_]+$/.test(tabla)) throw new Error(`Nombre de tabla inválido: ${tabla}`);
  return `drop policy if exists ${POLITICA_AAL2} on public.${tabla};`;
}

// ---------------------------------------------------------------------------
// RPC SECURITY DEFINER
// ---------------------------------------------------------------------------
//
// Las funciones SECURITY DEFINER saltean RLS, y por lo tanto también la
// política de arriba. Las que lee o escribe datos de pacientes y se pueden
// llamar por /rest/v1/rpc reciben un guard al inicio del cuerpo. La migración
// las redefine con `create or replace` copiando la ÚLTIMA definición de cada
// una en `supabase/migrations/` (anterior a `MIGRACION_AAL2`) más el guard; el
// test vuelve a extraer esa definición y exige que coincida, así que si otra
// migración redefine una de estas funciones, el CI avisa que hay que copiarla
// de nuevo.

/** RPC que reciben el guard, con el motivo. Orden alfabético. */
export const RPC_CON_GUARDIA_AAL2: Readonly<Record<string, string>> = {
  get_patient_document_id: "devuelve el documento de identidad descifrado",
  list_patients_with_last_and_next_appointment: "lista los pacientes con su última y próxima cita",
  merge_patients: "fusiona dos fichas (mueve historia clínica, pagos y citas)",
  registrar_evento_de_nota: "escribe en la bitácora de la historia clínica",
  registrar_exportacion_de_clinica: "habilita la exportación completa de la clínica",
  registrar_lectura_ficha: "confirma si un paciente existe y anota la lectura de su ficha",
  set_patient_document_id: "escribe el documento de identidad de un paciente",
};

/** Líneas que se insertan después del primer `BEGIN` del cuerpo. */
export const GUARDIA_AAL2_PLPGSQL = [
  "  -- SEG-01: quien activó MFA necesita una sesión aal2 (ver docs/MFA.md).",
  `  IF NOT ${FUNCION_AAL2} THEN`,
  "    RAISE EXCEPTION 'Se requiere verificación en dos pasos.' USING ERRCODE = '42501';",
  "  END IF;",
].join("\n");

/**
 * Devuelve el texto completo de la ÚLTIMA definición `create [or replace]
 * function public.<nombre>(` dentro de `sql` (de `create` hasta el `;` que
 * sigue al cierre del cuerpo con dólares), o `null` si no hay ninguna.
 */
export function ultimaDefinicionDeFuncion(sql: string, nombre: string): string | null {
  if (!/^[a-z0-9_]+$/.test(nombre)) throw new Error(`Nombre de función inválido: ${nombre}`);
  const inicio = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?"?${nombre}"?\\s*\\(`,
    "gi",
  );
  const coincidencias = [...sql.matchAll(inicio)];
  const ultima = coincidencias.at(-1);
  if (ultima?.index === undefined) return null;
  const resto = sql.slice(ultima.index);
  const apertura = /\bas\s+(\$[a-z_]*\$)/i.exec(resto);
  if (!apertura) return null;
  const etiqueta = apertura[1];
  const cierre = resto.indexOf(etiqueta, apertura.index + apertura[0].length);
  if (cierre < 0) return null;
  const fin = resto.indexOf(";", cierre + etiqueta.length);
  return fin < 0 ? null : resto.slice(0, fin + 1);
}

/** Inserta `GUARDIA_AAL2_PLPGSQL` después del primer `BEGIN` del cuerpo. */
export function conGuardiaAal2(definicion: string): string {
  const apertura = /\bas\s+(\$[a-z_]*\$)/i.exec(definicion);
  if (!apertura) throw new Error("Definición sin cuerpo entre dólares");
  if (!/language\s+plpgsql/i.test(definicion)) throw new Error("El guard solo sirve en plpgsql");
  const desde = apertura.index + apertura[0].length;
  const begin = /^\s*begin\s*$/im.exec(definicion.slice(desde));
  if (!begin) throw new Error("Cuerpo sin BEGIN en una línea propia");
  const corte = desde + begin.index + begin[0].length;
  return `${definicion.slice(0, corte)}\n${GUARDIA_AAL2_PLPGSQL}${definicion.slice(corte)}`;
}
