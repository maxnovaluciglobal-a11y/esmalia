/**
 * Áreas de la clínica demo que SIEMPRE deben tener datos, con el mínimo de filas de cada una.
 *
 * La usan tres cosas (una sola fuente, para que no se desalineen):
 *  - `estadoActualDeLaDemo` (reseteo.server.ts): además de la fecha, comprueba que cada área
 *    tenga datos; si falta alguna, el primer visitante o el cron horario completan la siembra.
 *  - Los tests de base (`tests/demo-cobertura-db.test.ts`): conteos mínimos > 0 por área.
 *  - La auditoría de pantallas vacías (`auditoria-demo.mjs`) las nombra en su tabla.
 *
 * `filtros` acota la fila a la que cuenta: `hoy` = dentro del día de la clínica (así una demo
 * sembrada para ayer no cuenta como al día), `like`/`eq` sobre una columna, `noNulo`.
 */
export type FiltroDeArea =
  | { columna: string; op: "eq"; valor: string }
  | { columna: string; op: "like"; valor: string }
  | { columna: string; op: "noNulo" }
  | { columna: string; op: "hoy" };

export type AreaDeLaDemo = {
  clave: string;
  /** Qué pantalla la muestra, en palabras de quien usa la app. */
  etiqueta: string;
  tabla: string;
  minimo: number;
  filtros?: readonly FiltroDeArea[];
};

export const AREAS_DE_LA_DEMO: readonly AreaDeLaDemo[] = [
  // Caja: lo que se rompió el 28-oct (cobrado hoy en $0).
  {
    clave: "caja-cobros-de-hoy",
    etiqueta: "Caja · cobrado hoy",
    tabla: "payments",
    minimo: 5,
    filtros: [{ columna: "paid_at", op: "hoy" }],
  },
  {
    clave: "caja-abierta",
    etiqueta: "Caja · turno abierto",
    tabla: "cash_registers",
    minimo: 1,
    filtros: [{ columna: "status", op: "eq", valor: "open" }],
  },
  {
    clave: "agenda-de-hoy",
    etiqueta: "Agenda · citas de hoy",
    tabla: "appointments",
    minimo: 3,
    filtros: [{ columna: "starts_at", op: "hoy" }],
  },
  // Configuración de la clínica.
  { clave: "sucursales", etiqueta: "Sucursales", tabla: "branches", minimo: 2 },
  {
    clave: "horarios-de-sucursal",
    etiqueta: "Sucursales · horarios",
    tabla: "branch_hours",
    minimo: 6,
  },
  {
    clave: "ajustes-de-agenda",
    etiqueta: "Configuración de la agenda",
    tabla: "clinic_agenda_settings",
    minimo: 1,
  },
  { clave: "boxes", etiqueta: "Boxes", tabla: "operatories", minimo: 2 },
  { clave: "profesionales", etiqueta: "Profesionales", tabla: "professionals", minimo: 3 },
  {
    clave: "horarios-de-profesional",
    etiqueta: "Profesionales · horarios",
    tabla: "professional_schedules",
    minimo: 6,
  },
  {
    clave: "comisiones-reglas",
    etiqueta: "Comisiones · reglas",
    tabla: "commission_rules",
    minimo: 2,
  },
  { clave: "aranceles", etiqueta: "Aranceles", tabla: "procedures", minimo: 5 },
  {
    clave: "paquetes",
    etiqueta: "Presupuestos · paquetes",
    tabla: "procedure_packages",
    minimo: 1,
  },
  {
    clave: "reajustes-de-aranceles",
    etiqueta: "Aranceles · historial de reajustes",
    tabla: "procedure_price_realignments",
    minimo: 1,
  },
  {
    clave: "medicamentos",
    etiqueta: "Recetas · medicamentos",
    tabla: "clinic_medications",
    minimo: 3,
  },
  { clave: "equipo", etiqueta: "Equipo", tabla: "clinic_members", minimo: 3 },
  {
    clave: "permisos-por-persona",
    etiqueta: "Permisos por persona",
    tabla: "clinic_member_permission_overrides",
    minimo: 1,
  },
  { clave: "suscripcion", etiqueta: "Suscripción", tabla: "subscriptions", minimo: 1 },
  // Finanzas y cobranza.
  { clave: "presupuestos", etiqueta: "Presupuestos", tabla: "quotes", minimo: 8 },
  { clave: "planes", etiqueta: "Planes de tratamiento", tabla: "treatment_plans", minimo: 3 },
  { clave: "cuentas-por-cobrar", etiqueta: "Cuentas por cobrar", tabla: "receivables", minimo: 5 },
  {
    clave: "cuotas",
    etiqueta: "Cuentas por cobrar · cuotas",
    tabla: "receivable_installments",
    minimo: 2,
  },
  { clave: "gastos", etiqueta: "Gastos", tabla: "expenses", minimo: 10 },
  { clave: "gastos-fijos", etiqueta: "Gastos fijos", tabla: "recurring_expenses", minimo: 1 },
  { clave: "membresias", etiqueta: "Membresías", tabla: "patient_memberships", minimo: 1 },
  { clave: "convenios", etiqueta: "Empresas con convenio", tabla: "partner_companies", minimo: 1 },
  {
    clave: "pagos-del-historial",
    etiqueta: "Informes · pagos de meses anteriores",
    tabla: "payments",
    minimo: 30,
  },
  // Ficha, clínica, comunicación y cumplimiento.
  { clave: "recetas", etiqueta: "Ficha · recetas", tabla: "prescriptions", minimo: 2 },
  {
    clave: "documentos-emitidos",
    etiqueta: "Ficha · documentos emitidos",
    tabla: "issued_documents",
    minimo: 1,
  },
  {
    clave: "plantillas-de-documentos",
    etiqueta: "Plantillas de documentos",
    tabla: "document_templates",
    minimo: 3,
  },
  {
    clave: "plantillas-de-mensajes",
    etiqueta: "Plantillas de mensajes",
    tabla: "message_templates",
    minimo: 3,
  },
  {
    clave: "consentimientos",
    etiqueta: "Ficha · consentimientos firmados",
    tabla: "patient_consents",
    minimo: 1,
  },
  {
    clave: "plantillas-de-consentimiento",
    etiqueta: "Consentimientos · plantillas",
    tabla: "consent_templates",
    minimo: 3,
  },
  {
    clave: "tutores",
    etiqueta: "Ficha · tutor de un menor",
    tabla: "patient_guardians",
    minimo: 1,
  },
  {
    clave: "signos-vitales",
    etiqueta: "Ficha · signos vitales",
    tabla: "patient_vital_signs",
    minimo: 4,
  },
  { clave: "examenes", etiqueta: "Ficha · exámenes", tabla: "patient_exams", minimo: 3 },
  {
    clave: "periodontograma",
    etiqueta: "Ficha · periodontograma",
    tabla: "periodontal_charts",
    minimo: 1,
  },
  { clave: "implantes", etiqueta: "Implantes", tabla: "patient_implants", minimo: 1 },
  { clave: "ortodoncia-casos", etiqueta: "Ortodoncia · casos", tabla: "ortho_cases", minimo: 1 },
  {
    clave: "ortodoncia-controles",
    etiqueta: "Ortodoncia · controles",
    tabla: "ortho_controls",
    minimo: 2,
  },
  { clave: "protocolos", etiqueta: "Protocolos clínicos", tabla: "clinical_protocols", minimo: 1 },
  { clave: "laboratorios", etiqueta: "Laboratorios", tabla: "labs", minimo: 1 },
  {
    clave: "ordenes-de-laboratorio",
    etiqueta: "Laboratorios · órdenes",
    tabla: "lab_orders",
    minimo: 1,
  },
  { clave: "inventario", etiqueta: "Inventario", tabla: "inventory_items", minimo: 3 },
  {
    clave: "esterilizacion",
    etiqueta: "Esterilización · ciclos",
    tabla: "sterilization_cycles",
    minimo: 1,
  },
  { clave: "dispositivos", etiqueta: "Dispositivos", tabla: "clinic_devices", minimo: 2 },
  {
    clave: "sala-de-espera",
    etiqueta: "Sala de espera · turnos de hoy",
    tabla: "waiting_room_turns",
    minimo: 1,
  },
  {
    clave: "seguimiento-tareas",
    etiqueta: "Seguimiento · tareas",
    tabla: "followup_tasks",
    minimo: 1,
  },
  {
    clave: "seguimiento-controles",
    etiqueta: "Seguimiento · controles",
    tabla: "patient_controls",
    minimo: 1,
  },
  { clave: "campanas", etiqueta: "Campañas", tabla: "outreach_campaigns", minimo: 1 },
  {
    clave: "informes-guardados",
    etiqueta: "Informes guardados",
    tabla: "saved_reports",
    minimo: 1,
  },
  { clave: "nps", etiqueta: "Encuestas NPS", tabla: "patient_nps_responses", minimo: 3 },
  {
    clave: "avisos-al-paciente",
    etiqueta: "Notificaciones a pacientes · ajustes",
    tabla: "patient_notification_settings",
    minimo: 1,
  },
  {
    clave: "avisos-enviados",
    etiqueta: "Notificaciones a pacientes · envíos",
    tabla: "patient_email_dispatches",
    minimo: 1,
  },
  {
    clave: "formularios-previos",
    etiqueta: "Formularios previos",
    tabla: "patient_intake_forms",
    minimo: 1,
  },
  {
    clave: "reserva-en-linea",
    etiqueta: "Reserva en línea",
    tabla: "online_booking_settings",
    minimo: 1,
  },
  {
    clave: "solicitudes-de-cita",
    etiqueta: "Solicitudes de cita del portal",
    tabla: "appointment_requests",
    minimo: 1,
  },
  { clave: "citas-grupales", etiqueta: "Citas grupales", tabla: "appointment_groups", minimo: 1 },
  { clave: "mensajes", etiqueta: "Mensajes", tabla: "messages", minimo: 3 },
  { clave: "notificaciones", etiqueta: "Notificaciones", tabla: "notifications", minimo: 1 },
  { clave: "etiquetas", etiqueta: "Pacientes · etiquetas", tabla: "patient_labels", minimo: 1 },
  { clave: "segmentos", etiqueta: "Pacientes · segmentos", tabla: "patient_segments", minimo: 1 },
  {
    clave: "derechos",
    etiqueta: "Derechos de los titulares",
    tabla: "data_subject_requests",
    minimo: 4,
  },
  {
    clave: "incidentes",
    etiqueta: "Incidentes de seguridad",
    tabla: "security_incidents",
    minimo: 1,
  },
  {
    clave: "importaciones",
    etiqueta: "Migración · importaciones",
    tabla: "import_batches",
    minimo: 1,
  },
  {
    clave: "accesos-a-fichas",
    etiqueta: "Cumplimiento · lecturas de fichas",
    tabla: "clinical_access_log",
    minimo: 5,
  },
  {
    clave: "modo-prueba-del-correo",
    etiqueta: "Correo · modo prueba",
    tabla: "email_sandbox_config",
    minimo: 1,
  },
  { clave: "convenios-de-seguros", etiqueta: "Convenios", tabla: "agreements", minimo: 1 },
  {
    clave: "planes-de-membresia",
    etiqueta: "Membresías · planes",
    tabla: "membership_plans",
    minimo: 1,
  },
  {
    clave: "liquidaciones",
    etiqueta: "Comisiones · liquidaciones",
    tabla: "commission_settlements",
    minimo: 1,
  },
  {
    clave: "plan-en-pausa",
    etiqueta: "Planes de tratamiento · en pausa",
    tabla: "treatment_plans",
    minimo: 1,
    filtros: [{ columna: "status", op: "eq", valor: "on_hold" }],
  },
  {
    clave: "dispositivo-vinculado",
    etiqueta: "Dispositivos · vinculados",
    tabla: "clinic_devices",
    minimo: 1,
    filtros: [{ columna: "paired_at", op: "noNulo" }],
  },
  {
    clave: "membresia-anulada",
    etiqueta: "Membresías · anuladas",
    tabla: "patient_memberships",
    minimo: 1,
    filtros: [{ columna: "status", op: "eq", valor: "cancelled" }],
  },
  {
    clave: "paquete-dado-de-baja",
    etiqueta: "Esterilización · bajas",
    tabla: "sterilization_packages",
    minimo: 1,
    filtros: [{ columna: "status", op: "eq", valor: "descartado" }],
  },
  {
    clave: "realizado-hoy",
    etiqueta: "Caja · prestaciones realizadas hoy",
    tabla: "treatment_items",
    minimo: 4,
    filtros: [
      { columna: "status", op: "eq", valor: "completed" },
      { columna: "completed_at", op: "hoy" },
    ],
  },
];
