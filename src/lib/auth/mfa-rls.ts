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
//   genera `sqlPoliticaAal2`.
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
  clinical_note_audit: "bitácora de la historia clínica",
  clinical_note_entities: "entidades clínicas extraídas de las notas",
  clinical_note_reviews: "revisiones de notas clínicas",
  clinical_note_versions: "texto de cada versión de la nota clínica",
  clinical_notes: "historia clínica",
  commission_settlements: "liquidaciones de comisiones: producción y pagos",
  expenses: "gastos de la clínica",
  lab_orders: "órdenes de laboratorio de un paciente",
  messages: "conversaciones con pacientes (WhatsApp, correo)",
  notifications: "avisos internos que nombran pacientes y notas",
  odontogram_marks: "odontograma",
  ortho_cases: "casos de ortodoncia y su presupuesto",
  ortho_controls: "controles de ortodoncia",
  patient_consents: "consentimientos informados",
  patient_documents: "documentos clínicos (radiografías, informes)",
  patient_medical_history: "anamnesis",
  patient_medical_history_audit: "cambios de la anamnesis",
  patients: "identidad, contacto y alertas clínicas del paciente",
  payments: "pagos de pacientes",
  periodontal_charts: "periodontograma",
  periodontal_measurements: "mediciones del periodontograma",
  portal_access_log: "accesos del paciente a su portal",
  quote_items: "ítems de presupuestos",
  quotes: "presupuestos",
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
  agreement_coverage: "catálogo de coberturas de convenios",
  agreements: "catálogo de convenios",
  appointment_statuses: "catálogo de estados de cita",
  branches: "estructura de la clínica",
  clinic_counters: "correlativos (sin datos)",
  clinic_data_exports: "bitácora de exportaciones: no guarda los datos exportados",
  clinic_members: "membresía: la app la lee antes y durante la verificación",
  clinics: "estructura de la clínica",
  commission_rules: "configuración de porcentajes, no movimientos",
  consent_templates: "plantillas sin datos de pacientes",
  email_sandbox_config: "configuración de envío",
  inventory_counts: "inventario",
  inventory_items: "catálogo de inventario",
  inventory_movements: "inventario",
  inventory_stock: "inventario",
  labs: "catálogo de laboratorios",
  lifecycle_emails: "backend: solo service_role (sin políticas)",
  marketing_events: "backend: solo service_role (sin políticas)",
  marketing_leads: "backend: solo service_role (sin políticas)",
  message_templates: "plantillas sin datos de pacientes",
  notification_preferences: "preferencias propias del usuario",
  operatories: "estructura de la clínica",
  payment_methods: "catálogo de medios de pago",
  procedure_supplies: "catálogo de insumos por prestación",
  procedures: "catálogo de prestaciones y precios de lista",
  professional_schedules: "horarios del equipo",
  professionals: "equipo de la clínica",
  profiles: "perfil del usuario: la app lo lee antes de la verificación",
  specialties: "catálogo de especialidades",
  stripe_events: "backend: solo service_role (sin políticas)",
  subscriptions: "suscripción de la clínica a Esmalia: la app la lee para el estado de cuenta",
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
