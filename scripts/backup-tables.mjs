// Lista de tablas que respalda scripts/backup-data.mjs.
//
// Vive en su propio módulo, y no dentro de backup-data.mjs, porque
// tests/backup-tables-sync.test.ts la importa para compararla contra las
// migraciones: importar el script entero dispararía su `main()` y con eso un
// backup real contra producción.
//
// No hace falta mantenerla a mano contra el schema: ese test falla en CI
// nombrando la tabla que falte. Sí hace falta ordenarla alfabéticamente,
// para que el diff de agregar una tabla sea de una línea.
export const TABLES = [
  "agreement_coverage",
  "agreements",
  "appointment_requests",
  "appointment_statuses",
  "appointments",
  "branches",
  "cash_registers",
  "clinic_counters",
  "clinic_data_exports",
  "clinic_members",
  "clinical_access_log",
  "clinical_note_audit",
  "clinical_note_entities",
  "clinical_note_reviews",
  "clinical_note_versions",
  "clinical_notes",
  "clinics",
  "commission_rules",
  "commission_settlements",
  "consent_templates",
  "email_sandbox_config",
  "expenses",
  "inventory_counts",
  "inventory_items",
  "inventory_movements",
  "inventory_stock",
  "lab_orders",
  "labs",
  "lifecycle_emails",
  "marketing_events",
  "marketing_leads",
  "message_templates",
  "messages",
  "notification_preferences",
  "notifications",
  "odontogram_marks",
  "operatories",
  "ortho_cases",
  "ortho_controls",
  "patient_consents",
  "patient_documents",
  "patient_guardians",
  "patient_guardians_audit",
  "patient_medical_history",
  "patient_medical_history_audit",
  "patient_vital_signs",
  "patients",
  "payment_methods",
  "payments",
  "periodontal_charts",
  "periodontal_measurements",
  "portal_access_log",
  "procedure_supplies",
  "procedures",
  "professional_schedules",
  "professionals",
  "profiles",
  "quote_items",
  "quotes",
  "specialties",
  "stripe_events",
  "subscriptions",
  "treatment_items",
  "treatment_plans",
  "waitlist_entries",
  "warehouses",
  "whatsapp_accounts",
  "whatsapp_credentials",
  "whatsapp_leads",
];

// Escotilla explícita: tablas que existen en el schema y que a propósito NO
// se respaldan. Cada entrada necesita el motivo escrito al lado — si no hay
// motivo que escribir, la tabla va en TABLES.
//
// Está vacía a propósito: hoy se respaldan las 57 tablas del schema.
export const EXCLUDED_TABLES = [];
