/**
 * Exportación completa de los datos de una clínica (hallazgos CS-04 y CON-01,
 * auditoría 360 del 18-oct-2026).
 *
 * Los Términos, el DPA, la FAQ y la home prometen "te llevas tus datos". Este
 * módulo es la parte pura de esa promesa: qué tablas salen, con qué columnas,
 * cómo se arma cada CSV, el LEEME.txt y el ZIP. No toca la red ni la base, así
 * que se prueba entero sin conexión (`tests/exportacion-clinica.test.ts`).
 *
 * Las columnas van en una lista explícita, nunca `select("*")`: una columna
 * nueva y sensible (un hash, un valor cifrado, un token) no tiene que salir
 * en un archivo que la clínica guarda en su computador sin que alguien lo
 * decida. Por eso `patients.document_id_enc` y `document_id_hash` no están:
 * el documento ya sale en claro en `document_id`, y el cifrado no le sirve a
 * nadie fuera de Esmalia.
 */
import { strToU8, zipSync, type Zippable } from "fflate";

import type { ClinicRole } from "@/lib/access/access";
import { construirCsv, type ColumnaCsv } from "@/lib/csv-export";
import {
  leemeDeColumnas,
  leemeDeHuellas,
  VERSION_FORMATO_EXPORTACION,
  type Manifiesto,
} from "@/lib/exportacion/manifiesto";

/** Solo quien administra la clínica puede sacar todos sus datos. */
export const ROLES_EXPORTACION = ["owner", "admin"] as const satisfies readonly ClinicRole[];

export function puedeExportarClinica(rol: ClinicRole | null | undefined): boolean {
  return !!rol && (ROLES_EXPORTACION as readonly string[]).includes(rol);
}

/**
 * Exportación de UNA ficha (derecho de acceso del paciente, CON-01): además
 * de owner/admin, el dentista, que es quien suele entregarle la copia al
 * paciente. Asistente, recepción y contabilidad no.
 */
export const ROLES_EXPORTACION_PACIENTE = [
  "owner",
  "admin",
  "dentist",
] as const satisfies readonly ClinicRole[];

export function puedeExportarPaciente(rol: ClinicRole | null | undefined): boolean {
  return !!rol && (ROLES_EXPORTACION_PACIENTE as readonly string[]).includes(rol);
}

/** Filas por llamada al servidor. Con 1000 un paciente con 10 años de citas entra en una. */
export const FILAS_POR_PAGINA = 1000;

/**
 * Tope para meter los archivos de Storage (radiografías, fotos, firmas) dentro
 * del ZIP. El ZIP se arma en el navegador: por encima de esto la pestaña puede
 * quedarse sin memoria en un computador modesto. Si se pasa, el CSV de
 * documentos igual sale completo y el LEEME explica cómo pedir los archivos.
 */
export const MAX_BYTES_ARCHIVOS = 300 * 1024 * 1024;

export interface TablaExportacion {
  /** Identificador estable que viaja entre cliente y servidor. */
  clave: string;
  /** Tabla de la base. */
  tabla: string;
  /** Nombre del archivo dentro del ZIP. */
  archivo: string;
  /** Qué es, en palabras de la clínica (va al LEEME.txt). */
  descripcion: string;
  /** Columnas exportadas, en orden. */
  columnas: readonly string[];
  /** Orden estable para paginar sin saltar ni repetir filas. */
  orden: readonly string[];
  /**
   * Columna que filtra por clínica. Casi siempre `clinic_id`; la propia
   * tabla `clinics` se filtra por `id`.
   */
  columnaClinica?: "clinic_id" | "id";
  /**
   * Columnas de la tabla que NO salen, con el motivo (va al manifiesto y al
   * LEEME). `clinic_id` no se lista: se omite en todas porque tiene un solo
   * valor, el de la clínica que exporta. `tests/exportacion-cobertura.test.ts`
   * falla si la base tiene una columna que no está ni en `columnas` ni acá.
   */
  omitidas?: Readonly<Record<string, string>>;
  /**
   * Cómo se filtra por paciente en la exportación de una ficha. Sin este
   * campo la tabla es de la clínica (sucursales, gastos, inventario…) y no
   * sale en la exportación de un paciente.
   */
  paciente?: FiltroPaciente;
  /**
   * Datos de dinero del paciente (presupuestos, pagos). En la exportación de
   * una ficha solo salen si quien exporta tiene `finance:view` (regla 15:
   * el dentista no ve finanzas en la app, tampoco por esta vía).
   */
  finanzas?: true;
}

/**
 * - `patient_id` / `patient_ref`: la columna apunta al paciente (las notas
 *   usan `patient_ref`, el id como texto).
 * - `id`: la propia tabla de pacientes.
 * - `padre`: la tabla cuelga de otra (versiones de una nota, ítems de un
 *   presupuesto): se filtra por los ids de las filas del padre.
 */
export type FiltroPaciente =
  { por: "patient_id" | "patient_ref" | "id" } | { por: "padre"; padre: string; columna: string };

const TABLAS_EXPORTACION_BASE: readonly TablaExportacion[] = [
  {
    clave: "sucursales",
    tabla: "branches",
    archivo: "sucursales.csv",
    descripcion: "Sucursales de la clínica con dirección, contacto, horario y zona horaria.",
    columnas: [
      "id",
      "name",
      "address",
      "city",
      "phone",
      "email",
      "opens_at",
      "closes_at",
      "timezone",
      "is_active",
      "created_at",
      "updated_at",
      "google_review_url",
    ],
    orden: ["id"],
  },
  {
    clave: "profesionales",
    tabla: "professionals",
    archivo: "profesionales.csv",
    descripcion:
      "Profesionales: nombre, registro o matrícula, contacto, sucursal y si está activo.",
    columnas: [
      "id",
      "full_name",
      "license_number",
      "email",
      "phone",
      "specialty_id",
      "branch_id",
      "user_id",
      "is_active",
      "created_at",
      "updated_at",
      "color",
      "default_operatory_id",
      "sis_registry_number",
      "signature_storage_path",
      "signature_sha256",
      "signature_updated_at",
      "attends_patients",
    ],
    orden: ["id"],
  },
  {
    clave: "pacientes",
    tabla: "patients",
    archivo: "pacientes.csv",
    descripcion:
      "Pacientes: datos de identificación y contacto, tipo de documento, previsión (health_plan, tramo e institución), contacto de emergencia, domicilio, sexo (sex, opcional), origen del paciente, estado, convenio, consentimiento de WhatsApp, fusiones de fichas (merged_into) y fichas archivadas (archived_at, con su motivo en archive_reason).",
    columnas: [
      "id",
      "full_name",
      "document_type",
      "document_id",
      "birth_date",
      "phone",
      "phone_valid",
      "email",
      "address",
      "commune",
      "sex",
      "health_plan",
      "health_plan_tier",
      "health_plan_institution",
      "emergency_contact_name",
      "emergency_contact_relationship",
      "emergency_contact_phone",
      "acquisition_source",
      "acquisition_source_detail",
      "referred_by_patient_id",
      "status",
      "tags",
      "branch_id",
      "primary_professional_id",
      "agreement_id",
      "agreement_member_id",
      "referral_code",
      "wa_opt_in",
      "wa_opt_in_at",
      "wa_opt_out_at",
      "merged_into",
      "merged_at",
      "archived_at",
      "archived_by",
      "archive_reason",
      "created_at",
      "updated_at",
      "avatar_url",
      "portal_revoked_at",
      "email_opt_out_at",
      "created_by",
      "updated_by",
      "import_batch_id",
      "imported_at",
      "import_source",
      "import_external_id",
      "import_original",
    ],
    orden: ["id"],
    paciente: { por: "id" },
    omitidas: {
      document_id_enc: "Copia cifrada del documento: el documento ya sale en claro en document_id.",
      document_id_hash:
        "Huella para buscar por documento sin descifrarlo: no sirve fuera de Esmalia.",
      balance_cents:
        "Campo antiguo que ya no se mantiene: el saldo real se calcula con presupuestos, planes y pagos.",
      no_show_risk: "Estimación calculada por Esmalia, no un dato registrado por la clínica.",
      ai_summary: "Resumen generado por IA a partir de las notas: las notas salen completas.",
      ai_summary_updated_at: "Fecha del resumen generado por IA (omitido).",
    },
  },
  {
    clave: "anamnesis",
    tabla: "patient_medical_history",
    archivo: "pacientes-anamnesis.csv",
    descripcion:
      "Anamnesis (antecedentes médicos) de cada paciente: alergias (con severidad en allergy_details), enfermedades, medicación actual, cuestionario de riesgo (risk_questionnaire, en JSON) y notas. Se cruza con pacientes.csv por patient_id.",
    columnas: [
      "id",
      "patient_id",
      "allergies",
      "conditions",
      "chronic_medications",
      "notes",
      "updated_at",
      "updated_by",
      "allergy_details",
      "risk_questionnaire",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "signos_vitales",
    tabla: "patient_vital_signs",
    archivo: "pacientes-signos-vitales.csv",
    descripcion:
      "Signos vitales por atención: presión arterial (mmHg), pulso (lpm) y temperatura (°C), con la cita en que se tomaron.",
    columnas: [
      "id",
      "patient_id",
      "appointment_id",
      "measured_at",
      "systolic_mmhg",
      "diastolic_mmhg",
      "heart_rate_bpm",
      "temperature_c",
      "notes",
      "recorded_by",
      "created_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "tutores",
    tabla: "patient_guardians",
    archivo: "pacientes-tutores.csv",
    descripcion:
      "Tutores o representantes legales de pacientes menores: nombre, documento, parentesco, contacto y si es el principal. Los archivados tienen archived_at.",
    columnas: [
      "id",
      "patient_id",
      "full_name",
      "document_id",
      "relationship",
      "relationship_detail",
      "phone",
      "email",
      "is_primary",
      "archived_at",
      "created_by",
      "created_at",
      "updated_at",
      "archived_by",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "citas",
    tabla: "appointments",
    archivo: "citas.csv",
    descripcion:
      "Citas de la agenda con paciente, profesional, sucursal, box, horario (UTC), estado, llegada y confirmaciones.",
    columnas: [
      "id",
      "patient_id",
      "professional_id",
      "branch_id",
      "operatory_id",
      "procedure_id",
      "treatment_label",
      "starts_at",
      "ends_at",
      "status",
      "status_id",
      "is_priority",
      "notes",
      "confirmed_at",
      "confirmed_by",
      "patient_confirmed_at",
      "patient_confirmed_via",
      "patient_cancelled_at",
      "booking_source",
      "arrived_at",
      "started_at",
      "created_at",
      "updated_at",
      "appointment_type_id",
      "appointment_type_name",
      "operatory_name",
      "created_by",
      "updated_by",
      "import_batch_id",
      "imported_at",
      "import_source",
      "import_external_id",
      "import_original",
      "reminders_muted",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "notas",
    tabla: "clinical_notes",
    archivo: "notas-clinicas.csv",
    descripcion:
      "Notas clínicas en su versión vigente: título, contenido, resumen, estado, revisión y firma (nombre y registro del profesional tal como quedaron al firmar). addendum_of = la nota que corrige esta adenda. patient_ref identifica al paciente. restricted = evolución restringida (solo la ven su autor y la administración), con quién y cuándo la restringió.",
    columnas: [
      "id",
      "patient_ref",
      "patient_name",
      "title",
      "content",
      "summary",
      "status",
      "addendum_of",
      "signed_at",
      "signed_by",
      "signer_name",
      "signer_license",
      "review_status",
      "review_requested_at",
      "reviewed_at",
      "reviewer_id",
      "created_by",
      "created_at",
      "updated_at",
      "updated_by",
      "review_requested_by",
      "signed_content_hash",
      "restricted",
      "restricted_at",
      "restricted_by",
    ],
    orden: ["id"],
    paciente: { por: "patient_ref" },
  },
  {
    clave: "notas_versiones",
    tabla: "clinical_note_versions",
    archivo: "notas-clinicas-versiones.csv",
    descripcion:
      "Todas las versiones de cada nota clínica (historial completo, ninguna se sobrescribe). Se cruza con notas-clinicas.csv por note_id.",
    columnas: [
      "id",
      "note_id",
      "version",
      "title",
      "content",
      "summary",
      "author_id",
      "origin",
      "origin_version",
      "ai_assisted",
      "ai_action",
      "created_at",
    ],
    orden: ["note_id", "version"],
    paciente: { por: "padre", padre: "notas", columna: "note_id" },
  },
  {
    clave: "odontograma",
    tabla: "odontogram_marks",
    archivo: "odontograma.csv",
    descripcion:
      "Odontograma con su historial: cada marca por diente y superficie (una pieza puede tener varias). status: existente o planificado (por realizar); conservation: bueno o malo en tratamientos existentes, vacío = sin especificar. superseded_at vacío = marca vigente; con fecha = marca reemplazada (historial).",
    columnas: [
      "id",
      "patient_id",
      "tooth_number",
      "surface",
      "condition",
      "status",
      "conservation",
      "material",
      "notes",
      "recorded_at",
      "recorded_by",
      "superseded_at",
      "superseded_by",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "periodontograma",
    tabla: "periodontal_charts",
    archivo: "periodontograma.csv",
    descripcion: "Periodontogramas registrados por paciente (uno por evaluación).",
    columnas: ["id", "patient_id", "notes", "recorded_at", "recorded_by"],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "periodontograma_mediciones",
    tabla: "periodontal_measurements",
    archivo: "periodontograma-mediciones.csv",
    descripcion:
      "Mediciones de cada periodontograma por diente y punto: profundidad de bolsa, recesión, sangrado, movilidad y furca. Se cruza por chart_id.",
    columnas: [
      "id",
      "chart_id",
      "tooth_number",
      "point",
      "pocket_depth_mm",
      "recession_mm",
      "bleeding",
      "mobility",
      "furcation",
      "created_at",
    ],
    orden: ["id"],
    paciente: { por: "padre", padre: "periodontograma", columna: "chart_id" },
  },
  {
    clave: "presupuestos",
    tabla: "quotes",
    archivo: "presupuestos.csv",
    descripcion:
      "Presupuestos con número, estado, totales, descuentos, convenio y evidencia de aceptación.",
    columnas: [
      "id",
      "number",
      "patient_id",
      "status",
      "currency",
      "subtotal_cents",
      "discount_cents",
      "commercial_discount_pct",
      "coverage_total_cents",
      "total_cents",
      "agreement_id",
      "agreement_name_snapshot",
      "valid_until",
      "sent_at",
      "accepted_at",
      "accepted_by_name",
      "accepted_signature_path",
      "rejected_at",
      "notes",
      "created_by",
      "created_at",
      "updated_at",
      "professional_id",
      "accepted_total_cents",
      "accepted_ip",
      "accepted_user_agent",
      "rejection_reason",
      "expired_at",
      "last_contact_at",
      "last_contact_note",
      "next_action",
      "next_action_on",
      "affiliation_discount_source",
      "affiliation_discount_name_snapshot",
      "affiliation_discount_rule_snapshot",
      "affiliation_discount_percent",
      "affiliation_discount_amount_cents",
      "partner_company_id",
      "membership_plan_id",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
    finanzas: true,
  },
  {
    clave: "presupuestos_items",
    tabla: "quote_items",
    archivo: "presupuestos-items.csv",
    descripcion:
      "Ítems de cada presupuesto (prestación, diente, cantidad, precios). Se cruza por quote_id.",
    columnas: [
      "id",
      "quote_id",
      "position",
      "phase_label",
      "phase_position",
      "procedure_id",
      "name_snapshot",
      "tooth_number",
      "surface",
      "quantity",
      "unit_price_cents",
      "discount_cents",
      "discount_pct",
      "coverage_cents",
      "patient_cents",
      "total_cents",
      "notes",
      "created_at",
      "odontogram_mark_id",
      "accepted",
      "package_id",
      "package_name_snapshot",
    ],
    orden: ["id"],
    paciente: { por: "padre", padre: "presupuestos", columna: "quote_id" },
    finanzas: true,
  },
  {
    clave: "planes",
    tabla: "treatment_plans",
    archivo: "planes-de-tratamiento.csv",
    descripcion: "Planes de tratamiento por paciente, con el presupuesto de origen y su estado.",
    columnas: [
      "id",
      "patient_id",
      "quote_id",
      "name",
      "status",
      "currency",
      "total_cents",
      "notes",
      "started_at",
      "completed_at",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "planes_items",
    tabla: "treatment_items",
    archivo: "planes-de-tratamiento-items.csv",
    descripcion:
      "Prestaciones de cada plan: diente, profesional, precio, estado y cita agendada. Se cruza por plan_id.",
    columnas: [
      "id",
      "plan_id",
      "quote_item_id",
      "position",
      "phase_label",
      "phase_position",
      "procedure_id",
      "name_snapshot",
      "tooth_number",
      "surface",
      "professional_id",
      "status",
      "price_cents",
      "coverage_cents",
      "patient_cents",
      "scheduled_appointment_id",
      "completed_at",
      "completed_by",
      "notes",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "padre", padre: "planes", columna: "plan_id" },
  },
  {
    clave: "pagos",
    tabla: "payments",
    archivo: "pagos.csv",
    descripcion:
      "Pagos recibidos: monto, medio de pago, plan o prestación asociada, caja, reversas (reversed_at), desglose de bonos Fonasa/isapre con copago (coverage_*) y la cuota de membresía que cobran (membership_charge_id).",
    columnas: [
      "id",
      "patient_id",
      "paid_at",
      "currency",
      "amount_cents",
      "net_cents",
      "method",
      "method_name_snapshot",
      "payment_method_id",
      "reference",
      "treatment_plan_id",
      "treatment_item_id",
      "cash_register_id",
      "receivable_id",
      "payment_group_id",
      "notes",
      "reversed_at",
      "reversed_by",
      "reversal_reason",
      "coverage_group_id",
      "coverage_kind",
      "coverage_role",
      "voucher_number",
      "coverage_insurer",
      "coverage_tier",
      "coverage_price_cents",
      "voucher_cents",
      "membership_charge_id",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
    finanzas: true,
  },
  {
    clave: "cuentas_por_cobrar",
    tabla: "receivables",
    archivo: "cuentas-por-cobrar.csv",
    descripcion:
      "Cuentas por cobrar de cada paciente: monto, presupuesto o plan de origen, emisión, vencimiento y anulación. Lo pagado sale de pagos.csv (receivable_id, o el plan de la cuenta).",
    columnas: [
      "id",
      "patient_id",
      "quote_id",
      "treatment_plan_id",
      "description",
      "currency",
      "amount_cents",
      "issued_on",
      "due_on",
      "voided_at",
      "voided_by",
      "void_reason",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
    finanzas: true,
  },
  {
    clave: "cuotas",
    tabla: "receivable_installments",
    archivo: "cuotas.csv",
    descripcion: "Cuotas de cada cuenta por cobrar: número, vencimiento y monto.",
    columnas: ["id", "receivable_id", "number", "due_on", "amount_cents", "created_at"],
    orden: ["id"],
    paciente: { por: "padre", padre: "cuentas_por_cobrar", columna: "receivable_id" },
    finanzas: true,
  },
  {
    clave: "cajas",
    tabla: "cash_registers",
    archivo: "cajas.csv",
    descripcion:
      "Aperturas y cierres de caja con montos esperados, declarados y diferencias del arqueo. El esperado es apertura + cobros en efectivo del turno (desde el 20-oct-2026; antes sumaba todos los medios de pago) + traspasos recibidos − traspasos, retiros y depósitos (desde la Ola 10). closing_denominations trae el conteo por billete y moneda (JSON) cuando se contó así. operator_id es la persona dueña de la caja (vacío = caja general, la de antes de las cajas por persona).",
    columnas: [
      "id",
      "branch_id",
      "status",
      "currency",
      "opened_at",
      "opened_by",
      "opening_amount_cents",
      "opening_notes",
      "closed_at",
      "closed_by",
      "expected_closing_cents",
      "declared_closing_cents",
      "difference_cents",
      "closing_notes",
      "closing_denominations",
      "operator_id",
      "operator_name_snapshot",
      "cash_collected_cents",
      "movements_in_cents",
      "movements_out_cents",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "cajas_movimientos",
    tabla: "cash_movements",
    archivo: "cajas-movimientos.csv",
    descripcion:
      "Traspasos de efectivo entre cajas, retiros y depósitos al banco (Ola 10): caja de origen y de destino, monto, motivo, comprobante y quién lo hizo. Ajustan el esperado del arqueo de cada caja.",
    columnas: [
      "id",
      "kind",
      "from_register_id",
      "to_register_id",
      "amount_cents",
      "currency",
      "reason",
      "reference",
      "created_by",
      "created_at",
    ],
    orden: ["id"],
  },
  {
    clave: "consentimientos",
    tabla: "patient_consents",
    archivo: "consentimientos.csv",
    descripcion:
      "Consentimientos firmados: texto tal como se firmó, quién firmó y en qué calidad (paciente o tutor, con su documento y parentesco), cuándo y revocaciones. La imagen de la firma va en archivos/ cuando entra en el ZIP.",
    columnas: [
      "id",
      "patient_id",
      "template_id",
      "title_snapshot",
      "procedure_snapshot",
      "tooth_numbers",
      "treatment_item_id",
      "body_snapshot",
      "risks_snapshot",
      "alternatives_snapshot",
      "informed_by_professional_id",
      "informed_by_name_snapshot",
      "informed_by_license_snapshot",
      "signed_by_name",
      "signer_role",
      "guardian_id",
      "signer_document_snapshot",
      "signer_relationship_snapshot",
      "signed_at",
      "signature_storage_path",
      "signature_sha256",
      "content_sha256",
      "recorded_by",
      "revoked_at",
      "revoked_by",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "consentimientos_plantillas",
    tabla: "consent_templates",
    archivo: "consentimientos-plantillas.csv",
    descripcion:
      "Plantillas de consentimiento de la clínica. source = esmalia_model son los modelos que sembró Esmalia; reviewed_at dice si la clínica los revisó.",
    columnas: [
      "id",
      "title",
      "procedure",
      "body",
      "risks",
      "alternatives",
      "active",
      "source",
      "reviewed_at",
      "reviewed_by",
      "created_by",
      "created_at",
      "updated_at",
      "seed_key",
    ],
    orden: ["id"],
  },
  {
    clave: "recetas",
    tabla: "prescriptions",
    archivo: "recetas.csv",
    descripcion:
      "Recetas emitidas: correlativo, profesional y registro, datos de la clínica y del paciente al emitir, medicamentos (JSON), indicaciones y anulaciones.",
    columnas: [
      "id",
      "patient_id",
      "year",
      "number",
      "issued_at",
      "issued_by",
      "professional_id",
      "professional_name_snapshot",
      "professional_license_snapshot",
      "professional_specialty_snapshot",
      "clinic_name_snapshot",
      "clinic_legal_name_snapshot",
      "clinic_tax_id_snapshot",
      "clinic_address_snapshot",
      "clinic_phone_snapshot",
      "patient_name_snapshot",
      "patient_birth_date_snapshot",
      "items",
      "instructions",
      "signature_storage_path",
      "signature_sha256",
      "content_sha256",
      "voided_at",
      "voided_by",
      "void_reason",
      "issued_document_id",
      "patient_document_type_snapshot",
      "patient_document_id_snapshot",
      "professional_sis_snapshot",
      "allergy_alerts",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "documentos_emitidos",
    tabla: "issued_documents",
    archivo: "documentos_emitidos.csv",
    descripcion:
      "Certificados, informes y demás documentos emitidos desde la ficha: correlativo, plantilla y versión, quien firmó y su registro, datos de la clínica y del paciente al emitir, contenido (HTML), huella sha256 y anulaciones.",
    columnas: [
      "id",
      "patient_id",
      "year",
      "number",
      "kind",
      "title",
      "template_id",
      "template_version_id",
      "issued_at",
      "issued_by",
      "professional_id",
      "professional_name_snapshot",
      "professional_registry_snapshot",
      "professional_specialty_snapshot",
      "clinic_name_snapshot",
      "clinic_legal_name_snapshot",
      "clinic_tax_id_snapshot",
      "clinic_address_snapshot",
      "clinic_phone_snapshot",
      "patient_name_snapshot",
      "fields",
      "content_html",
      "signature_storage_path",
      "signature_sha256",
      "content_sha256",
      "voided_at",
      "voided_by",
      "void_reason",
      "content_blocks",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "documentos_plantillas",
    tabla: "document_templates",
    archivo: "documentos_plantillas.csv",
    descripcion: "Plantillas de documentos de la clínica (la vigente apunta a su versión).",
    columnas: [
      "id",
      "kind",
      "title",
      "description",
      "current_version_id",
      "active",
      "source",
      "created_by",
      "created_at",
      "updated_at",
      "seed_key",
      "requires_patient_signature",
    ],
    orden: ["id"],
  },
  {
    clave: "documentos_plantillas_versiones",
    tabla: "document_template_versions",
    archivo: "documentos_plantillas_versiones.csv",
    descripcion:
      "Cada versión del texto de las plantillas de documentos (no se editan: se agregan).",
    columnas: ["id", "template_id", "version", "title", "body", "created_by", "created_at"],
    orden: ["id"],
  },
  {
    clave: "documentos",
    tabla: "patient_documents",
    archivo: "documentos.csv",
    descripcion:
      "Documentos del paciente (radiografías, fotos y otros): metadatos y ruta. El archivo va en archivos/ cuando entra en el ZIP.",
    columnas: [
      "id",
      "patient_id",
      "kind",
      "filename",
      "mime_type",
      "size_bytes",
      "storage_path",
      "notes",
      "uploaded_by",
      "created_at",
      "archived_at",
      "archived_by",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "examenes",
    tabla: "patient_exams",
    archivo: "examenes.csv",
    descripcion:
      "Exámenes del paciente por tipo (radiografías, CBCT, escaneos intraorales, fotos clínicas y documentos): fecha, piezas, profesional, nota y ruta del archivo. Los archivos de exámenes NO van en el ZIP: un CBCT o un escaneo pesa hasta 200 MB y el ZIP se arma en el navegador con un tope total; si entraran, dejarían afuera también las radiografías y las firmas. Se descargan uno por uno desde la ficha, o los pides a soporte y te los entregamos completos.",
    columnas: [
      "id",
      "patient_id",
      "kind",
      "taken_on",
      "teeth",
      "professional_id",
      "professional_name",
      "notes",
      "photo_session_id",
      "filename",
      "mime_type",
      "size_bytes",
      "storage_path",
      "thumb_path",
      "status",
      "uploaded_by",
      "created_at",
      "confirmed_at",
      "updated_at",
      "archived_at",
      "archived_by",
      "archive_reason",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "sesiones_de_fotos",
    tabla: "clinical_photo_sessions",
    archivo: "sesiones_de_fotos.csv",
    descripcion:
      "Sesiones de fotos clínicas (antes, durante, después o control): fecha, motivo y plan de tratamiento. Las fotos de cada sesión están en examenes.csv (photo_session_id).",
    columnas: [
      "id",
      "patient_id",
      "session_date",
      "reason",
      "stage",
      "treatment_plan_id",
      "notes",
      "created_by",
      "created_at",
      "updated_at",
      "archived_at",
      "archived_by",
      "archive_reason",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "citas_grupales",
    tabla: "appointment_groups",
    archivo: "citas-grupales.csv",
    descripcion:
      "Citas grupales (charlas, controles escolares, ortodoncia grupal): nombre de la actividad y cupo. appointment_id es la cita en citas.csv (profesional, box y horario una sola vez).",
    columnas: ["appointment_id", "title", "capacity", "created_by", "created_at", "updated_at"],
    orden: ["appointment_id"],
  },
  {
    clave: "citas_grupales_participantes",
    tabla: "appointment_group_participants",
    archivo: "citas-grupales-participantes.csv",
    descripcion:
      "Pacientes inscritos en cada cita grupal, con su asistencia individual (pendiente, asistio, ausente), cuándo avisaron que venían (patient_confirmed_at) y, si se retiraron, cuándo y por qué.",
    columnas: [
      "id",
      "appointment_id",
      "patient_id",
      "attendance",
      "attendance_marked_at",
      "attendance_marked_by",
      "enrolled_at",
      "enrolled_by",
      "withdrawn_at",
      "withdrawn_by",
      "withdraw_reason",
      "patient_confirmed_at",
      "patient_confirmed_via",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "esterilizacion_ciclos",
    tabla: "sterilization_cycles",
    archivo: "esterilizacion-ciclos.csv",
    descripcion:
      "Ciclos de autoclave: equipo, fecha y hora (UTC), número de ciclo por año, tipo, temperatura (°C), presión (bar), tiempo de exposición (min), indicadores químico y biológico, resultado y responsable.",
    columnas: [
      "id",
      "branch_id",
      "year",
      "number",
      "equipment",
      "equipment_serial",
      "run_at",
      "cycle_type",
      "temperature_c",
      "pressure_bar",
      "exposure_minutes",
      "chemical_indicator",
      "chemical_indicator_class",
      "biological_indicator",
      "biological_lot",
      "biological_read_at",
      "result",
      "result_at",
      "failure_reason",
      "responsible_name",
      "notes",
      "recorded_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "esterilizacion_paquetes",
    tabla: "sterilization_packages",
    archivo: "esterilizacion-paquetes.csv",
    descripcion:
      "Paquetes de instrumental de cada ciclo: código de la etiqueta, contenido, vencimiento del estéril, estado y, si se usó, en qué paciente y cita (trazabilidad).",
    columnas: [
      "id",
      "cycle_id",
      "year",
      "number",
      "code",
      "contents",
      "shelf_life_days",
      "expires_on",
      "status",
      "used_at",
      "used_by",
      "used_patient_id",
      "used_appointment_id",
      "discarded_at",
      "discarded_by",
      "discard_reason",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "laboratorios",
    tabla: "labs",
    archivo: "laboratorios.csv",
    descripcion: "Laboratorios dentales con los que trabaja la clínica.",
    columnas: [
      "id",
      "name",
      "contact_name",
      "contact_email",
      "contact_phone",
      "notes",
      "is_active",
      "created_at",
      "updated_at",
      "created_by",
      "portal_revoked_at",
    ],
    orden: ["id"],
  },
  {
    clave: "laboratorios_ordenes",
    tabla: "lab_orders",
    archivo: "laboratorios-ordenes.csv",
    descripcion: "Órdenes de laboratorio por paciente: trabajo, dientes, fechas, costo y estado.",
    columnas: [
      "id",
      "patient_id",
      "lab_id",
      "lab_name_snapshot",
      "professional_id",
      "treatment_item_id",
      "description",
      "tooth_numbers",
      "status",
      "sent_on",
      "due_on",
      "received_on",
      "currency",
      "cost_cents",
      "notes",
      "catalog_item_id",
      "catalog_name_snapshot",
      "shade_guide",
      "shade",
      "material",
      "margin_type",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "laboratorios_catalogo",
    tabla: "lab_catalog_items",
    archivo: "laboratorios-catalogo.csv",
    descripcion:
      "Catálogo de trabajos de cada laboratorio: nombre, precio de costo, plazo típico en días y material. Se cruza con laboratorios.csv por lab_id.",
    columnas: [
      "id",
      "lab_id",
      "name",
      "currency",
      "cost_cents",
      "typical_days",
      "material",
      "notes",
      "is_active",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "bodegas",
    tabla: "warehouses",
    archivo: "inventario-bodegas.csv",
    descripcion: "Bodegas de inventario por sucursal.",
    columnas: ["id", "name", "branch_id", "position", "is_active", "created_at", "updated_at"],
    orden: ["id"],
  },
  {
    clave: "inventario",
    tabla: "inventory_items",
    archivo: "inventario-insumos.csv",
    descripcion: "Insumos del inventario: unidad, costo, stock mínimo y stock total.",
    columnas: [
      "id",
      "name",
      "unit",
      "consumption_type",
      "yield_pct",
      "cost_cents",
      "sale_price_cents",
      "current_stock",
      "min_stock",
      "branch_id",
      "is_active",
      "notes",
      "created_by",
      "created_at",
    ],
    orden: ["id"],
  },
  {
    clave: "inventario_stock",
    tabla: "inventory_stock",
    archivo: "inventario-stock-por-bodega.csv",
    descripcion: "Stock actual de cada insumo en cada bodega.",
    columnas: ["item_id", "warehouse_id", "current_stock", "updated_at"],
    orden: ["item_id", "warehouse_id"],
  },
  {
    clave: "inventario_movimientos",
    tabla: "inventory_movements",
    archivo: "inventario-movimientos.csv",
    descripcion:
      "Movimientos de inventario (entradas, salidas, ajustes y consumo por prestación) con lote y vencimiento.",
    columnas: [
      "id",
      "item_id",
      "warehouse_id",
      "kind",
      "quantity",
      "unit_cost_cents",
      "lot_number",
      "expiration_date",
      "reason",
      "treatment_item_id",
      "recorded_by",
      "recorded_at",
    ],
    orden: ["id"],
  },
  {
    clave: "ortodoncia",
    tabla: "ortho_cases",
    archivo: "ortodoncia-casos.csv",
    descripcion:
      "Casos de ortodoncia por paciente: tipo (brackets o alineadores), estado, inicio, término estimado, cuota mensual y plan asociado.",
    columnas: [
      "id",
      "patient_id",
      "professional_id",
      "treatment_plan_id",
      "kind",
      "status",
      "started_on",
      "expected_end_on",
      "currency",
      "monthly_fee_cents",
      "notes",
      "appliance_system",
      "aligner_current",
      "aligner_total",
      "aligner_change_days",
      "aligner_changed_on",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "ortodoncia_controles",
    tabla: "ortho_controls",
    archivo: "ortodoncia-controles.csv",
    descripcion:
      "Controles de cada caso de ortodoncia: fecha, si asistió y el pago asociado. Se cruza con ortodoncia-casos.csv por ortho_case_id.",
    columnas: [
      "id",
      "ortho_case_id",
      "control_date",
      "attended",
      "payment_id",
      "notes",
      "created_by",
      "created_at",
    ],
    orden: ["id"],
    paciente: { por: "padre", padre: "ortodoncia", columna: "ortho_case_id" },
  },
  {
    clave: "ortodoncia_etapas",
    tabla: "ortho_stage_events",
    archivo: "ortodoncia-etapas.csv",
    descripcion:
      "Historial de etapas de cada caso de ortodoncia (alineación, nivelación, cierre de espacios, finalización, contención) con la fecha en que empezó cada una. Se cruza con ortodoncia-casos.csv por ortho_case_id.",
    columnas: ["id", "ortho_case_id", "stage", "started_on", "notes", "created_by", "created_at"],
    orden: ["id"],
    paciente: { por: "padre", padre: "ortodoncia", columna: "ortho_case_id" },
  },
  {
    clave: "mensajes",
    tabla: "messages",
    archivo: "mensajes.csv",
    descripcion:
      "Mensajes con pacientes (WhatsApp, correo y otros canales): dirección (enviado o recibido), texto, destinatario, estado de entrega y la cita o presupuesto relacionados.",
    columnas: [
      "id",
      "patient_id",
      "channel",
      "direction",
      "template_kind",
      "template_id",
      "recipient",
      "body",
      "status",
      "error",
      "appointment_id",
      "quote_id",
      "external_id",
      "sent_by",
      "sent_at",
      "delivered_at",
      "read_at",
      "created_at",
      "issued_document_id",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "aranceles",
    tabla: "procedures",
    archivo: "aranceles.csv",
    descripcion:
      "Arancel de prestaciones de la clínica: código, nombre, categoría, especialidad, precio de lista, precio de referencia, costo de laboratorio, duración, código Fonasa, marca MAI y rango de referencia.",
    columnas: [
      "id",
      "code",
      "name",
      "category",
      "currency",
      "default_price_cents",
      "reference_price_cents",
      "lab_cost_cents",
      "duration_min",
      "allows_discount",
      "position",
      "is_active",
      "specialty_id",
      "fonasa_code",
      "is_mai",
      "suggested_min_cents",
      "suggested_max_cents",
      "catalog_key",
      "created_by",
      "created_at",
      "updated_at",
      "is_favorite",
    ],
    orden: ["id"],
  },
  {
    clave: "convenios",
    tabla: "agreements",
    archivo: "convenios.csv",
    descripcion: "Seguros y coberturas (Fonasa, isapres, aseguradoras) con su contacto.",
    columnas: [
      "id",
      "name",
      "kind",
      "contact_name",
      "contact_email",
      "contact_phone",
      "notes",
      "is_active",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "convenios_coberturas",
    tabla: "agreement_coverage",
    archivo: "convenios-coberturas.csv",
    descripcion:
      "Cobertura de cada convenio por prestación: porcentaje o monto fijo. Se cruza con convenios.csv por agreement_id y con aranceles.csv por procedure_id.",
    columnas: [
      "id",
      "agreement_id",
      "procedure_id",
      "coverage_pct",
      "coverage_fixed_cents",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "medios_de_pago",
    tabla: "payment_methods",
    archivo: "medios-de-pago.csv",
    descripcion:
      "Medios de pago configurados, con su porcentaje de retención. Se cruza con pagos.csv y gastos.csv por payment_method_id.",
    columnas: [
      "id",
      "name",
      "kind",
      "legacy_key",
      "retention_pct",
      "allows_refund",
      "position",
      "is_active",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "gastos",
    tabla: "expenses",
    archivo: "gastos.csv",
    descripcion:
      "Gastos de la clínica: fecha, categoría, proveedor, monto, medio de pago y sucursal.",
    columnas: [
      "id",
      "incurred_on",
      "category",
      "description",
      "supplier",
      "currency",
      "amount_cents",
      "payment_method_id",
      "method_name_snapshot",
      "branch_id",
      "notes",
      "recurring_expense_id",
      "recurring_period",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "comisiones_reglas",
    tabla: "commission_rules",
    archivo: "comisiones-reglas.csv",
    descripcion:
      "Regla de comisión vigente de cada profesional: tipo, porcentaje (percent_bps, en centésimas de punto: 3000 = 30 %) o monto fijo.",
    columnas: [
      "professional_id",
      "kind",
      "percent_bps",
      "fixed_cents",
      "base",
      "updated_by",
      "updated_at",
    ],
    orden: ["professional_id"],
  },
  {
    clave: "comisiones_liquidaciones",
    tabla: "commission_settlements",
    archivo: "comisiones-liquidaciones.csv",
    descripcion:
      "Liquidaciones de comisiones cerradas: período, producción, prestaciones, regla aplicada, comisión y pago. Desde la Ola 10 guardan también la base (realizado o cobrado), lo cobrado y el detalle línea por línea (JSON), congelados al cerrar.",
    columnas: [
      "id",
      "professional_id",
      "period_from",
      "period_to",
      "procedure_count",
      "production_cents",
      "rule_kind",
      "rule_percent_bps",
      "rule_fixed_cents",
      "commission_cents",
      "closed_at",
      "closed_by",
      "paid_at",
      "paid_by",
      "email_notified_at",
      "email_error",
      "base",
      "cobrado_cents",
      "rule_effective_from",
      "detail",
    ],
    orden: ["id"],
  },
  {
    clave: "comisiones_reglas_historial",
    tabla: "commission_rule_versions",
    archivo: "comisiones-reglas-historial.csv",
    descripcion:
      "Historial de reglas de comisión con su fecha de vigencia (rige desde): regla general o por prestación, tipo, porcentaje (percent_bps: 3000 = 30 %) o monto fijo, y si se calcula sobre lo realizado o lo cobrado.",
    columnas: [
      "id",
      "professional_id",
      "scope",
      "procedure_id",
      "procedure_name_snapshot",
      "kind",
      "percent_bps",
      "fixed_cents",
      "base",
      "effective_from",
      "note",
      "created_by",
      "created_at",
    ],
    orden: ["id"],
  },
  {
    clave: "anamnesis_historial",
    tabla: "patient_medical_history_audit",
    archivo: "auditoria-anamnesis.csv",
    descripcion:
      "Historial de la anamnesis: cada cambio guarda cómo quedó (alergias, enfermedades, medicación, cuestionario y notas), quién lo hizo y cuándo.",
    columnas: [
      "id",
      "patient_id",
      "change_kind",
      "allergies",
      "allergy_details",
      "conditions",
      "chronic_medications",
      "risk_questionnaire",
      "notes",
      "changed_by",
      "recorded_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "tutores_historial",
    tabla: "patient_guardians_audit",
    archivo: "auditoria-tutores.csv",
    descripcion:
      "Historial de tutores o representantes: alta, cambios y archivo, con los datos de cada momento (snapshot, en JSON), quién y cuándo.",
    columnas: [
      "id",
      "patient_id",
      "guardian_id",
      "change_kind",
      "snapshot",
      "changed_by",
      "recorded_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "notas_auditoria",
    tabla: "clinical_note_audit",
    archivo: "auditoria-notas-clinicas.csv",
    descripcion:
      "Registro de auditoría de las notas clínicas: creación, ediciones, firma, reapertura, adendas, revisiones y uso de IA, con quién y cuándo. actor_id vacío = lo hizo el sistema.",
    columnas: ["id", "note_id", "patient_ref", "action", "detail", "actor_id", "created_at"],
    orden: ["id"],
    paciente: { por: "patient_ref" },
  },
  {
    clave: "notas_revisiones",
    tabla: "clinical_note_reviews",
    archivo: "notas-clinicas-revisiones.csv",
    descripcion:
      "Revisiones de notas clínicas: pedido, aprobación o cambios solicitados, con la versión revisada y el comentario.",
    columnas: [
      "id",
      "note_id",
      "note_version",
      "patient_ref",
      "action",
      "comment",
      "actor_id",
      "reviewer_id",
      "created_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_ref" },
  },
  {
    clave: "lecturas_ficha",
    tabla: "clinical_access_log",
    archivo: "auditoria-lecturas-de-ficha.csv",
    descripcion:
      "Quién del equipo abrió la ficha de cada paciente, qué sección (datos, notas, odontograma, periodontograma, anamnesis, documentos) y cuándo. Una fila por persona, paciente y sección cada 15 minutos.",
    columnas: ["id", "patient_id", "actor_id", "section", "accessed_at"],
    orden: ["id"],
  },
];

/**
 * Tablas de datos de la clínica que salen en la exportación completa, pero
 * que no estaban en la primera versión (formato 1, oct-2026): las olas 1 a 5
 * del plan de producto (agenda, arancel, planes, documentos, firma a
 * distancia, derechos de los titulares y brechas). Van aparte solo para que
 * el diff se lea; el ZIP las trata igual que al resto.
 */
const TABLAS_OLAS_1_A_5: readonly TablaExportacion[] = [
  {
    clave: "clinica",
    tabla: "clinics",
    archivo: "clinica.csv",
    descripcion:
      "Datos de la clínica: nombre, razón social, RUT o identificador tributario, país, moneda, zona horaria, giro y domicilio tributario.",
    columnas: [
      "id",
      "name",
      "legal_name",
      "tax_id",
      "country",
      "currency",
      "timezone",
      "business_activity",
      "tax_address",
      "tax_commune",
      "tax_receipt_kind",
      "quote_validity_days",
      "logo_url",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    columnaClinica: "id",
    omitidas: {
      is_demo: "Marca interna de la clínica de demostración de Esmalia.",
      onboarding_completed: "Estado de la puesta en marcha dentro de Esmalia.",
      onboarding_call_at: "Llamada de puesta en marcha con Esmalia, no es un dato de la clínica.",
      setup_guide_dismissed_at:
        "Si se ocultó el avance de la puesta en marcha dentro de Esmalia, no es un dato de la clínica.",
      setup_guide_dismissed_by: "Quién ocultó el avance de la puesta en marcha dentro de Esmalia.",
    },
  },
  {
    clave: "equipo",
    tabla: "clinic_members",
    archivo: "equipo.csv",
    descripcion:
      "Personas con acceso a la clínica: usuario, rol, profesión, y nombre y registro con que firman documentos.",
    columnas: [
      "id",
      "user_id",
      "role",
      "profession",
      "signature_name",
      "license_number",
      "created_at",
    ],
    orden: ["id"],
  },
  {
    clave: "permisos_por_persona",
    tabla: "clinic_member_permission_overrides",
    archivo: "permisos-por-persona.csv",
    descripcion:
      "Permisos dados (grant) o quitados (revoke) a cada integrante además de su rol, con su motivo.",
    columnas: [
      "id",
      "member_id",
      "permission",
      "effect",
      "reason",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "especialidades",
    tabla: "specialties",
    archivo: "especialidades.csv",
    descripcion:
      "Especialidades del arancel y de los profesionales, con su color y duración por defecto (minutos).",
    columnas: [
      "id",
      "name",
      "slug",
      "color",
      "default_duration_min",
      "position",
      "is_active",
      "created_at",
    ],
    orden: ["id"],
  },
  {
    clave: "boxes",
    tabla: "operatories",
    archivo: "boxes.csv",
    descripcion: "Boxes o sillones de atención de cada sucursal.",
    columnas: ["id", "branch_id", "name", "position", "is_active", "created_at"],
    orden: ["id"],
  },
  {
    clave: "horarios_sucursal",
    tabla: "branch_hours",
    archivo: "horarios-sucursales.csv",
    descripcion:
      "Horario de atención de cada sucursal por día de la semana (0 = domingo … 6 = sábado), en hora local de la clínica.",
    columnas: ["id", "branch_id", "day_of_week", "opens_at", "closes_at", "created_at"],
    orden: ["id"],
  },
  {
    clave: "horarios_profesional",
    tabla: "professional_schedules",
    archivo: "horarios-profesionales.csv",
    descripcion:
      "Horario de cada profesional por día de la semana (0 = domingo … 6 = sábado) y sucursal, en hora local de la clínica.",
    columnas: [
      "id",
      "professional_id",
      "branch_id",
      "day_of_week",
      "start_time",
      "end_time",
      "created_at",
    ],
    orden: ["id"],
  },
  {
    clave: "agenda_configuracion",
    tabla: "clinic_agenda_settings",
    archivo: "agenda-configuracion.csv",
    descripcion:
      "Configuración de la agenda: tamaño del bloque y duración por defecto (minutos) y si se permiten sobrecupos.",
    columnas: [
      "slot_minutes",
      "default_duration_min",
      "allow_overbooking",
      "updated_by",
      "created_at",
      "updated_at",
    ],
    orden: ["clinic_id"],
  },
  {
    clave: "agenda_bloqueos",
    tabla: "agenda_exceptions",
    archivo: "agenda-bloqueos.csv",
    descripcion:
      "Bloqueos y excepciones de la agenda (vacaciones, feriados, reuniones) por profesional, sucursal o box. starts_local y ends_local van en hora local de la clínica, sin zona.",
    columnas: [
      "id",
      "kind",
      "professional_id",
      "branch_id",
      "operatory_id",
      "reason",
      "note",
      "starts_local",
      "ends_local",
      "repeat_weekly",
      "repeat_until",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "tipos_de_cita",
    tabla: "appointment_types",
    archivo: "tipos-de-cita.csv",
    descripcion: "Tipos de cita que usa la agenda (control, urgencia, primera consulta…).",
    columnas: ["id", "name", "position", "is_active", "created_at", "updated_at"],
    orden: ["id"],
  },
  {
    clave: "estados_de_cita",
    tabla: "appointment_statuses",
    archivo: "estados-de-cita.csv",
    descripcion:
      "Estados de cita propios de la clínica y a qué estado base corresponde cada uno (canonical).",
    columnas: [
      "id",
      "label",
      "canonical",
      "color",
      "position",
      "is_active",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "solicitudes_de_hora",
    tabla: "appointment_requests",
    archivo: "solicitudes-de-hora.csv",
    descripcion:
      "Solicitudes de hora de los pacientes (portal u otro canal): fecha preferida, motivo, prioridad, estado y la cita que se agendó.",
    columnas: [
      "id",
      "patient_id",
      "preferred_date",
      "reason",
      "priority",
      "source",
      "status",
      "scheduled_appointment_id",
      "handled_by",
      "handled_at",
      "clinic_notes",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "lista_de_espera",
    tabla: "waitlist_entries",
    archivo: "lista-de-espera.csv",
    descripcion: "Pacientes en lista de espera, con el motivo, desde cuándo esperan y su estado.",
    columnas: [
      "id",
      "branch_id",
      "patient_id",
      "full_name",
      "reason",
      "wait_since",
      "status",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "opciones_de_paciente",
    tabla: "clinic_patient_options",
    archivo: "opciones-de-paciente.csv",
    descripcion:
      "Listas propias de la clínica para la ficha del paciente (origen, etiquetas y similares).",
    columnas: ["id", "kind", "label", "position", "active", "created_by", "created_at"],
    orden: ["id"],
  },
  {
    clave: "paquetes",
    tabla: "procedure_packages",
    archivo: "arancel-paquetes.csv",
    descripcion: "Paquetes de prestaciones del arancel con su precio y moneda.",
    columnas: [
      "id",
      "name",
      "description",
      "price_cents",
      "currency",
      "position",
      "is_active",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "paquetes_items",
    tabla: "procedure_package_items",
    archivo: "arancel-paquetes-items.csv",
    descripcion: "Prestaciones de cada paquete y su cantidad. Se cruza por package_id.",
    columnas: [
      "id",
      "package_id",
      "procedure_id",
      "name_snapshot",
      "quantity",
      "position",
      "created_at",
    ],
    orden: ["id"],
  },
  {
    clave: "realineaciones",
    tabla: "procedure_price_realignments",
    archivo: "arancel-realineaciones.csv",
    descripcion:
      "Ajustes masivos de precios del arancel: modo (porcentaje o monto), redondeo, alcance, cuántas prestaciones cambiaron y el detalle de cada una (items, en JSON).",
    columnas: [
      "id",
      "currency",
      "mode",
      "percent",
      "amount_cents",
      "rounding_cents",
      "scope_label",
      "affected_count",
      "items",
      "created_by",
      "created_at",
    ],
    orden: ["id"],
  },
  {
    clave: "insumos_por_prestacion",
    tabla: "procedure_supplies",
    archivo: "arancel-insumos.csv",
    descripcion:
      "Insumos de inventario que consume cada prestación y en qué cantidad. Se cruza con aranceles.csv e inventario.csv.",
    columnas: ["id", "procedure_id", "item_id", "quantity", "created_by", "created_at"],
    orden: ["id"],
  },
  {
    clave: "presupuestos_eventos",
    tabla: "quote_events",
    archivo: "presupuestos-eventos.csv",
    descripcion:
      "Historial de cada presupuesto: envío, cambios de estado, prórrogas de vigencia y seguimientos, con quién y cuándo.",
    columnas: [
      "id",
      "quote_id",
      "kind",
      "from_status",
      "to_status",
      "valid_until",
      "note",
      "message_id",
      "actor_id",
      "created_at",
    ],
    orden: ["id"],
    paciente: { por: "padre", padre: "presupuestos", columna: "quote_id" },
    finanzas: true,
  },
  {
    clave: "medicamentos",
    tabla: "clinic_medications",
    archivo: "medicamentos.csv",
    descripcion:
      "Vademécum propio de la clínica para las recetas: principio activo, concentración, forma, vía, código ATC y posología habitual.",
    columnas: [
      "id",
      "active_ingredient",
      "concentration",
      "form",
      "pharmacological_group",
      "route",
      "atc_code",
      "dose",
      "frequency",
      "duration",
      "instructions",
      "active",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "notas_entidades",
    tabla: "clinical_note_entities",
    archivo: "notas-clinicas-entidades.csv",
    descripcion:
      "Datos estructurados extraídos de las notas clínicas (diagnósticos, procedimientos, medicamentos, alergias), con su código, diente y si el profesional los confirmó. ai_generated = sugerido por IA.",
    columnas: [
      "id",
      "note_id",
      "patient_ref",
      "kind",
      "term",
      "code",
      "tooth",
      "quantity",
      "dosage",
      "severity",
      "status",
      "notes",
      "confidence",
      "ai_generated",
      "confirmed",
      "confirmed_by",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_ref" },
  },
  {
    clave: "plantillas_de_mensaje",
    tabla: "message_templates",
    archivo: "plantillas-de-mensaje.csv",
    descripcion:
      "Plantillas de mensajes (WhatsApp, correo) con su texto y, si se aprobaron en Meta, su nombre y estado allí.",
    columnas: [
      "id",
      "kind",
      "name",
      "channel",
      "subject",
      "body",
      "is_active",
      "meta_template_name",
      "meta_language",
      "meta_status",
      "meta_category",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "contactos_whatsapp",
    tabla: "whatsapp_leads",
    archivo: "contactos-whatsapp.csv",
    descripcion:
      "Personas que escribieron por WhatsApp sin ser pacientes todavía: teléfono, nombre, primer mensaje y estado.",
    columnas: [
      "id",
      "phone",
      "name",
      "first_message",
      "status",
      "referred_by_patient_id",
      "auto_replied_at",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "inventario_conteos",
    tabla: "inventory_counts",
    archivo: "inventario-conteos.csv",
    descripcion:
      "Conteos físicos de inventario: cantidad teórica, contada y diferencia por insumo y bodega.",
    columnas: [
      "id",
      "item_id",
      "warehouse_id",
      "theoretical_quantity",
      "counted_quantity",
      "difference",
      "notes",
      "movement_id",
      "counted_by",
      "counted_at",
    ],
    orden: ["id"],
  },
  {
    clave: "firmas_a_distancia",
    tabla: "patient_signature_requests",
    archivo: "firmas-a-distancia.csv",
    descripcion:
      "Solicitudes de firma a distancia (consentimientos, documentos y presupuestos): qué se firmó (content_html), quién, cuándo, con qué verificación y las huellas SHA-256 del documento, la firma y la evidencia.",
    columnas: [
      "id",
      "patient_id",
      "kind",
      "issued_document_id",
      "quote_id",
      "replaces_request_id",
      "title",
      "sheet",
      "content_blocks",
      "content_html",
      "professional_signature_path",
      "professional_signature_sha256",
      "document_sha256",
      "quote_fingerprint",
      "signer_role",
      "guardian_id",
      "signer_expected_name",
      "link_channel",
      "code_channel",
      "code_recipient_masked",
      "status",
      "expires_at",
      "created_by",
      "created_at",
      "opened_at",
      "cancelled_at",
      "cancelled_by",
      "cancel_reason",
      "rut_attempts",
      "rut_verified_at",
      "code_sent_at",
      "codes_sent",
      "code_attempts",
      "locked_until",
      "signer_rut_masked",
      "signed_at",
      "signer_name",
      "accepted_text",
      "signed_ip",
      "signed_user_agent",
      "signature_storage_path",
      "signature_sha256",
      "clinic_timezone",
      "signed_at_local",
      "evidence_sha256",
      "signed_copy_path",
      "signed_copy_sha256",
      "signed_copy_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
    omitidas: {
      token_hash: "Huella del enlace de firma: es una credencial, no un dato.",
      session_hash: "Huella de la sesión de firma: es una credencial, no un dato.",
      session_expires_at: "Vencimiento de la sesión de firma: dato técnico de la credencial.",
      code_hash: "Huella del código de un solo uso: es una credencial, no un dato.",
      code_expires_at: "Vencimiento del código de un solo uso: dato técnico de la credencial.",
      signer_rut_sha256:
        "Huella del RUT de quien firmó: con pocos dígitos se puede revertir; el RUT enmascarado sale en signer_rut_masked.",
    },
  },
  {
    clave: "firmas_a_distancia_eventos",
    tabla: "patient_signature_events",
    archivo: "firmas-a-distancia-eventos.csv",
    descripcion:
      "Bitácora de cada firma a distancia: envío, apertura, verificación, firma o cancelación, con el origen aproximado y el navegador.",
    columnas: ["id", "request_id", "kind", "actor_id", "ip_hint", "user_agent", "created_at"],
    orden: ["id"],
    paciente: { por: "padre", padre: "firmas_a_distancia", columna: "request_id" },
  },
  {
    clave: "portal_accesos",
    tabla: "portal_access_log",
    archivo: "portal-accesos.csv",
    descripcion:
      "Accesos de los pacientes al portal: qué hicieron, cuándo, y el origen aproximado y el navegador.",
    columnas: ["id", "patient_id", "event", "ip_hint", "user_agent", "created_at"],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "solicitudes_titular",
    tabla: "data_subject_requests",
    archivo: "solicitudes-del-titular.csv",
    descripcion:
      "Solicitudes de los pacientes sobre sus datos personales (acceso, rectificación, supresión, oposición, portabilidad, bloqueo): canal, plazo legal, prórroga y respuesta.",
    columnas: [
      "id",
      "patient_id",
      "kind",
      "channel",
      "detail",
      "status",
      "received_at",
      "due_date",
      "extended_due_date",
      "extension_reason",
      "extended_at",
      "extended_by",
      "response",
      "responded_at",
      "responded_by",
      "response_message_id",
      "registered_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "solicitudes_titular_eventos",
    tabla: "data_subject_request_events",
    archivo: "solicitudes-del-titular-eventos.csv",
    descripcion: "Historial de cada solicitud del titular: quién hizo qué y cuándo.",
    columnas: ["id", "request_id", "event", "actor_id", "note", "created_at"],
    orden: ["id"],
    paciente: { por: "padre", padre: "solicitudes_titular", columna: "request_id" },
  },
  {
    clave: "incidentes",
    tabla: "security_incidents",
    archivo: "incidentes-de-seguridad.csv",
    descripcion:
      "Registro de incidentes de seguridad (brechas de datos): detección, categorías de datos afectadas, titulares estimados, evaluación del riesgo, medidas y decisión de notificar.",
    columnas: [
      "id",
      "detected_at",
      "occurred_at",
      "title",
      "description",
      "data_categories",
      "affected_subjects_estimate",
      "risk_level",
      "risk_assessment",
      "measures",
      "notify_agency",
      "notify_subjects",
      "notification_reason",
      "responsible_name",
      "status",
      "created_by",
      "created_at",
    ],
    orden: ["id"],
  },
  {
    clave: "incidentes_seguimientos",
    tabla: "security_incident_updates",
    archivo: "incidentes-de-seguridad-seguimientos.csv",
    descripcion:
      "Seguimientos de cada incidente: cambios de estado o de riesgo, medidas nuevas y notificaciones hechas. Se cruza por incident_id.",
    columnas: [
      "id",
      "incident_id",
      "note",
      "status",
      "risk_level",
      "risk_assessment",
      "measures",
      "affected_subjects_estimate",
      "data_categories",
      "notify_agency",
      "notify_subjects",
      "notification_reason",
      "agency_notified_at",
      "subjects_notified_at",
      "created_by",
      "created_at",
    ],
    orden: ["id"],
  },
  {
    clave: "lotes_importados",
    tabla: "import_batches",
    archivo: "lotes-importados.csv",
    descripcion:
      "Lotes de la migración desde otro sistema: tipo (pacientes o citas), perfil de columnas, archivo, estado (importado o deshecho), quién y cuándo, y conteos. Las fichas y citas importadas lo referencian en import_batch_id.",
    columnas: [
      "id",
      "kind",
      "source",
      "file_name",
      "status",
      "rows_total",
      "rows_created",
      "rows_updated",
      "rows_skipped",
      "rows_failed",
      "duplicate_policy",
      "include_in_reminders",
      "reminders_enabled_at",
      "created_by",
      "created_at",
      "completed_at",
      "reverted_at",
      "reverted_by",
    ],
    orden: ["id"],
  },
  {
    clave: "lotes_importados_cambios",
    tabla: "import_batch_changes",
    archivo: "lotes-importados-campos-completados.csv",
    descripcion:
      "Campos vacíos de fichas que ya existían y que completó un lote de pacientes (campos = valores escritos). Se cruza por batch_id y patient_id.",
    columnas: ["id", "batch_id", "patient_id", "campos", "created_at"],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "exportaciones",
    tabla: "clinic_data_exports",
    archivo: "registro-de-exportaciones.csv",
    descripcion:
      "Registro de exportaciones de datos de la clínica (completa, por ficha y de listas en CSV): quién, cuándo y qué. Incluye la exportación de este ZIP.",
    columnas: ["id", "actor_id", "formato", "patient_id", "detalle", "created_at"],
    orden: ["id"],
  },
  {
    clave: "notificaciones_a_pacientes",
    tabla: "patient_notification_settings",
    archivo: "notificaciones-a-pacientes.csv",
    descripcion:
      "Correos automáticos que la clínica le manda a sus pacientes (Ola 7): confirmación, recordatorio y sus horas, formulario antes de la cita, encuesta de satisfacción y link de reseña de Google.",
    columnas: [
      "confirmation_enabled",
      "confirmation_enabled_at",
      "reminder_enabled",
      "reminder_hours",
      "intake_form_mode",
      "nps_enabled",
      "nps_enabled_at",
      "nps_hours_after",
      "google_review_url",
      "created_at",
      "updated_at",
      "updated_by",
    ],
    orden: ["clinic_id"],
  },
  {
    clave: "correos_automaticos_a_pacientes",
    tabla: "patient_email_dispatches",
    archivo: "correos-automaticos-a-pacientes.csv",
    descripcion:
      "Cada correo automático a un paciente o su tutor (confirmación, recordatorio, encuesta): cita, a quién, estado (enviado, omitido o con error) y el motivo.",
    columnas: [
      "id",
      "patient_id",
      "appointment_id",
      "kind",
      "slot",
      "status",
      "recipient_role",
      "recipient",
      "redirected_to",
      "reason",
      "attempts",
      "provider_id",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "formularios_antes_de_la_cita",
    tabla: "patient_intake_forms",
    archivo: "formularios-antes-de-la-cita.csv",
    descripcion:
      "Formularios que el paciente completó antes de la cita (datos de contacto, cuestionario de salud, alergias y medicación) y si el equipo los aceptó o descartó.",
    columnas: [
      "id",
      "patient_id",
      "appointment_id",
      "expires_at",
      "status",
      "sent_at",
      "opened_at",
      "submitted_at",
      "submitted_contact",
      "submitted_questionnaire",
      "submitted_allergies",
      "submitted_medications",
      "submitted_comment",
      "reviewed_at",
      "reviewed_by",
      "created_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
    omitidas: {
      token_hash: "Huella del enlace del formulario: es una credencial, no un dato.",
    },
  },
  {
    clave: "encuestas_de_satisfaccion",
    tabla: "patient_nps_responses",
    archivo: "encuestas-de-satisfaccion.csv",
    descripcion:
      "Encuestas de satisfacción después de la cita: nota de 0 a 10, comentario, cuándo se respondió y si se mostró el pedido de reseña en Google.",
    columnas: [
      "id",
      "patient_id",
      "appointment_id",
      "professional_id",
      "expires_at",
      "sent_at",
      "opened_at",
      "score",
      "comment",
      "responded_at",
      "review_link_shown",
      "created_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
    omitidas: {
      token_hash: "Huella del enlace de la encuesta: es una credencial, no un dato.",
    },
  },
  {
    clave: "reserva_en_linea",
    tabla: "online_booking_settings",
    archivo: "reserva-en-linea.csv",
    descripcion:
      "Reglas de la reserva en línea de la clínica: encendida, dirección del link (slug), anticipación mínima en horas, días hacia adelante, procedimientos y tipos de cita reservables y nota de bienvenida.",
    columnas: [
      "enabled",
      "slug",
      "min_notice_hours",
      "max_days_ahead",
      "bookable_procedure_ids",
      "bookable_appointment_type_ids",
      "welcome_note",
      "updated_by",
      "created_at",
      "updated_at",
    ],
    orden: ["clinic_id"],
  },
  {
    clave: "protocolos_clinicos",
    tabla: "clinical_protocols",
    archivo: "protocolos-clinicos.csv",
    descripcion:
      "Protocolos clínicos de la clínica: nombre, procedimiento, pasos (lista JSON), indicaciones y si está activo. Al aplicarse, su texto queda dentro de la nota clínica.",
    columnas: [
      "id",
      "name",
      "procedure_label",
      "steps",
      "indications",
      "active",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "interconsultas",
    tabla: "patient_referrals",
    archivo: "interconsultas.csv",
    descripcion:
      "Interconsultas y derivaciones: especialidad, destino, motivo, lo que se solicita, urgencia, estado (pedida, enviada, respondida, cerrada, cancelada), la respuesta del especialista y el documento de derivación emitido (issued_document_id).",
    columnas: [
      "id",
      "patient_id",
      "specialty",
      "destination",
      "destination_contact",
      "reason",
      "request",
      "urgency",
      "status",
      "requested_by",
      "requested_at",
      "sent_at",
      "response",
      "responded_at",
      "response_recorded_by",
      "closed_at",
      "cancelled_at",
      "cancel_reason",
      "issued_document_id",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "implantes",
    tabla: "patient_implants",
    archivo: "implantes.csv",
    descripcion:
      "Implantes de cada paciente: pieza (numeración FDI), marca, modelo, diámetro y largo en mm, lote y referencia del fabricante, fecha de colocación, profesional (nombre tal como estaba al registrar), estado y fecha de retiro.",
    columnas: [
      "id",
      "patient_id",
      "tooth",
      "brand",
      "model",
      "diameter_mm",
      "length_mm",
      "lot",
      "reference",
      "placed_on",
      "professional_id",
      "professional_name",
      "status",
      "removed_on",
      "notes",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "implantes_controles",
    tabla: "patient_implant_controls",
    archivo: "implantes-controles.csv",
    descripcion:
      "Controles de cada implante: fecha, hallazgo, ISQ (estabilidad, 1 a 99) y estado resultante. Se cruza con implantes.csv por implant_id.",
    columnas: [
      "id",
      "patient_id",
      "implant_id",
      "controlled_on",
      "finding",
      "isq",
      "status_after",
      "recorded_by",
      "created_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  // Ola 8 · frente B · seguimiento de pacientes (FIC-13, CRM-02 a CRM-04).
  {
    clave: "controles_programados",
    tabla: "patient_controls",
    archivo: "controles-programados.csv",
    descripcion:
      "Controles programados a mano desde la ficha: motivo, fecha en que vence, meses, estado (pendiente, agendado, cumplido, descartado) y cita con la que se resolvió.",
    columnas: [
      "id",
      "patient_id",
      "reason",
      "due_on",
      "months",
      "status",
      "appointment_id",
      "resolved_at",
      "resolved_by",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "tareas_seguimiento",
    tabla: "followup_tasks",
    archivo: "tareas-de-seguimiento.csv",
    descripcion:
      "Tareas de seguimiento del equipo: título, notas, tipo (llamada, presupuesto, control, mensaje u otra), paciente, presupuesto o control relacionado, persona asignada, fecha, estado y cuántas veces se pospuso.",
    columnas: [
      "id",
      "title",
      "notes",
      "kind",
      "patient_id",
      "quote_id",
      "control_id",
      "assigned_to",
      "due_on",
      "status",
      "postponed_count",
      "completed_at",
      "completed_by",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "plantillas_mensajes",
    tabla: "outreach_templates",
    archivo: "plantillas-de-mensajes.csv",
    descripcion:
      "Plantillas de mensajes de la clínica por correo o WhatsApp: nombre, asunto, texto con variables y si está activa.",
    columnas: [
      "id",
      "name",
      "channel",
      "subject",
      "body",
      "active",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "etiquetas",
    tabla: "patient_labels",
    archivo: "etiquetas.csv",
    descripcion:
      "Catálogo de etiquetas de pacientes de la clínica: nombre y color (ocre, azul, verde, ambar, rojo, violeta o gris).",
    columnas: ["id", "name", "color", "created_by", "created_at", "updated_at"],
    orden: ["id"],
  },
  {
    clave: "pacientes_etiquetas",
    tabla: "patient_label_assignments",
    archivo: "pacientes-etiquetas.csv",
    descripcion:
      "Etiquetas de cada paciente: una fila por paciente y etiqueta. Se cruza con pacientes.csv por patient_id y con etiquetas.csv por label_id.",
    columnas: ["patient_id", "label_id", "created_by", "created_at"],
    orden: ["patient_id", "label_id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "segmentos",
    tabla: "patient_segments",
    archivo: "segmentos.csv",
    descripcion:
      "Segmentos de pacientes guardados: nombre, descripción y los filtros que lo definen (en JSON). No guardan la lista de pacientes: se calcula al usarlos.",
    columnas: [
      "id",
      "name",
      "description",
      "filters",
      "created_by",
      "updated_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "campanas",
    tabla: "outreach_campaigns",
    archivo: "campanas.csv",
    descripcion:
      "Campañas a grupos de pacientes: nombre, canal (correo o WhatsApp asistido), texto enviado, grupo de pacientes (filtro y descripción), estado, cantidad de destinatarios y fechas de confirmación, término o cancelación.",
    columnas: [
      "id",
      "name",
      "channel",
      "template_id",
      "subject",
      "body",
      "segment",
      "segment_label",
      "status",
      "recipients_count",
      "confirmed_at",
      "confirmed_by",
      "finished_at",
      "cancelled_at",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "campanas_destinatarios",
    tabla: "outreach_campaign_recipients",
    archivo: "campanas-destinatarios.csv",
    descripcion:
      "Destinatarios de cada campaña (uno por paciente): correo o teléfono usado, si se le escribió al paciente o a su tutor, estado (pendiente, enviado, fallido, omitido o abierto en WhatsApp), motivo y mensaje registrado. Se cruza con campanas.csv por campaign_id.",
    columnas: [
      "id",
      "campaign_id",
      "patient_id",
      "channel",
      "destination",
      "recipient_for",
      "status",
      "reason",
      "message_id",
      "processed_at",
      "processed_by",
      "created_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  // Ola 10 · frente A · finanzas (FIN-09, FIN-11, FIN-12, FIN-15).
  {
    clave: "gastos_fijos",
    tabla: "recurring_expenses",
    archivo: "gastos-fijos.csv",
    descripcion:
      "Gastos fijos que se repiten cada mes (arriendo, sueldos, servicios): categoría, descripción, proveedor, monto de referencia, día del mes, desde y hasta qué mes, sucursal y si está activo. Los gastos de cada mes confirmados están en gastos.csv (recurring_expense_id).",
    columnas: [
      "id",
      "category",
      "description",
      "supplier",
      "currency",
      "amount_cents",
      "payment_method_id",
      "day_of_month",
      "starts_on",
      "ends_on",
      "branch_id",
      "active",
      "notes",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "empresas_convenio",
    tabla: "partner_companies",
    archivo: "empresas-con-convenio.csv",
    descripcion:
      "Empresas con convenio: nombre, RUT, contacto, tipo de descuento (porcentaje, monto o ninguno), descuento, si hay descuento por planilla y si está activa.",
    columnas: [
      "id",
      "name",
      "tax_id",
      "contact_name",
      "contact_email",
      "contact_phone",
      "discount_kind",
      "discount_percent",
      "currency",
      "discount_cents",
      "payroll_deduction",
      "notes",
      "active",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "empresas_convenio_afiliados",
    tabla: "partner_company_patients",
    archivo: "empresas-con-convenio-afiliados.csv",
    descripcion:
      "Pacientes afiliados a cada empresa con convenio (una empresa por paciente), con el código de trabajador y desde cuándo. Se cruza con empresas-con-convenio.csv por company_id.",
    columnas: [
      "id",
      "company_id",
      "patient_id",
      "employee_code",
      "since",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "membresias_planes",
    tabla: "membership_plans",
    archivo: "membresias-planes.csv",
    descripcion:
      "Planes de membresía de la clínica: nombre, descripción, beneficios, cuota, cada cuánto se cobra, descuento en tratamientos y si está activo.",
    columnas: [
      "id",
      "name",
      "description",
      "benefits",
      "currency",
      "fee_cents",
      "billing_period",
      "treatment_discount_percent",
      "active",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "membresias_inscritos",
    tabla: "patient_memberships",
    archivo: "membresias-inscritos.csv",
    descripcion:
      "Pacientes inscritos en un plan de membresía: plan y cuota pactada al inscribir, cada cuánto se cobra, desde y hasta cuándo, estado (activa, pausada o cancelada) y quién la canceló.",
    columnas: [
      "id",
      "patient_id",
      "plan_id",
      "plan_name_snapshot",
      "currency",
      "fee_cents",
      "billing_period",
      "starts_on",
      "ends_on",
      "status",
      "cancelled_at",
      "cancelled_by",
      "notes",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
    finanzas: true,
  },
  {
    clave: "membresias_cuotas",
    tabla: "membership_charges",
    archivo: "membresias-cuotas.csv",
    descripcion:
      "Cuotas de membresía por período: paciente, período, monto, estado (pendiente, cobrada o anulada), cuándo y con qué medio se cobró, referencia y motivo de anulación. Se cruza con membresias-inscritos.csv por membership_id.",
    columnas: [
      "id",
      "membership_id",
      "patient_id",
      "period_start",
      "period_end",
      "currency",
      "amount_cents",
      "status",
      "paid_at",
      "paid_by",
      "payment_method_id",
      "method_name_snapshot",
      "reference",
      "voided_at",
      "voided_by",
      "void_reason",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
    finanzas: true,
  },
  {
    clave: "folios_boletas",
    tabla: "payment_receipts",
    archivo: "folios-de-boletas.csv",
    descripcion:
      "Folios de boletas y facturas emitidas fuera de Esmalia (SII u otro sistema) para cada pago: tipo de documento, folio, fecha de emisión y emisor. Se cruza con pagos.csv por payment_id.",
    columnas: [
      "id",
      "payment_id",
      "doc_type",
      "folio",
      "issued_on",
      "issuer",
      "notes",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
];

/**
 * Tablas con `clinic_id` que NO salen en la exportación, y por qué. Nada de
 * esto es un dato que la clínica haya registrado sobre sus pacientes o su
 * operación: son credenciales, huellas, contadores internos o la relación
 * comercial con Esmalia. `tests/exportacion-cobertura.test.ts` falla si se
 * crea una tabla con `clinic_id` que no esté ni en `TABLAS_EXPORTACION` ni
 * acá: así, una tabla nueva obliga a decidir.
 */
export const TABLAS_EXCLUIDAS_EXPORTACION: Readonly<Record<string, string>> = {
  clinic_devices:
    "Tablets y pantallas vinculadas a la clínica (tótem, sala de espera, box): guardan la huella de su token de acceso, que nunca sale de Esmalia, y se vuelven a vincular en otro sistema.",
  clinic_counters:
    "Contadores internos de los correlativos; los números ya salen en cada presupuesto, receta o documento.",
  email_sandbox_config: "Configuración técnica del envío de correos de prueba de Esmalia.",
  feedback_reports:
    "Problemas y sugerencias que el equipo le mandó a Esmalia desde la app; son mensajes para Esmalia, la clínica no los lee y pueden traer capturas de pantalla.",
  lifecycle_emails: "Correos que Esmalia le manda al equipo de la clínica (bienvenida, avisos).",
  online_booking_verifications:
    "Códigos de verificación de la reserva en línea (solo su huella) y conteos antiabuso; duran 10 minutos y no son datos clínicos.",
  notifications:
    "Avisos internos de la app para cada usuario; cada persona ve solo los suyos y no son datos de la clínica.",
  patient_document_bidx:
    "Huella del documento de cada paciente para buscar sin descifrar; el documento sale en pacientes.csv.",
  saved_reports:
    "Informes guardados del constructor (qué métrica, corte y período mirar): son preferencias de cada persona, no guardan cifras ni datos de pacientes y se recalculan al abrirlos.",
  stripe_events: "Eventos del cobro de la suscripción a Esmalia (Stripe).",
  subscriptions: "Suscripción de la clínica a Esmalia; se consulta en el portal de facturación.",
  totem_identifications:
    "Intentos de identificación en el tótem (solo huellas) y sesiones de 3 minutos; son conteos antiabuso, no datos clínicos.",
  trial_extensions: "Extensiones del período de prueba que otorga el equipo de Esmalia.",
  waiting_room_turns:
    "Número de turno y llamados del día en la sala de espera; la llegada del paciente sale en citas.csv (arrived_at).",
  whatsapp_accounts:
    "Conexión técnica con la API de WhatsApp de Meta; se rehace al conectar otro sistema.",
  whatsapp_credentials: "Credenciales cifradas de WhatsApp: nunca salen de Esmalia.",
};

export const TABLAS_EXPORTACION: readonly TablaExportacion[] = [
  ...TABLAS_EXPORTACION_BASE,
  ...TABLAS_OLAS_1_A_5,
];

export const CLAVES_EXPORTACION = TABLAS_EXPORTACION.map((t) => t.clave) as [string, ...string[]];

export function tablaPorClave(clave: string): TablaExportacion | undefined {
  return TABLAS_EXPORTACION.find((t) => t.clave === clave);
}

/** Tablas que salen en la exportación de una ficha. */
export function tablasExportacionPaciente(incluirFinanzas: boolean): TablaExportacion[] {
  return TABLAS_EXPORTACION.filter((t) => t.paciente && (incluirFinanzas || !t.finanzas));
}

export const CLAVES_EXPORTACION_PACIENTE = tablasExportacionPaciente(true).map((t) => t.clave) as [
  string,
  ...string[],
];

/** Valor tal como lo devuelve PostgREST (JSON): serializable de punta a punta. */
export type ValorExportacion =
  string | number | boolean | null | ValorExportacion[] | { [clave: string]: ValorExportacion };

export type FilaExportacion = Record<string, ValorExportacion>;

/**
 * Convierte un valor de la base en el texto de la celda. Listas y objetos
 * (alergias, etiquetas, dientes de una orden) salen como JSON: es lo único
 * que otro sistema puede volver a leer sin adivinar el separador.
 */
export function valorCelda(valor: unknown): string | number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return valor;
  if (typeof valor === "string") return valor;
  if (typeof valor === "boolean") return valor ? "true" : "false";
  return JSON.stringify(valor);
}

/** Arma el CSV de una tabla con sus columnas fijas, aunque no tenga filas. */
export function csvDeTabla(tabla: TablaExportacion, filas: readonly FilaExportacion[]): string {
  const columnas: ColumnaCsv<FilaExportacion>[] = tabla.columnas.map((c) => ({
    header: c,
    value: (fila) => valorCelda(fila[c]),
  }));
  return construirCsv([...filas], columnas);
}

/**
 * El BOM UTF-8 al principio es lo que hace que Excel en Windows lea bien las
 * tildes y la ñ (mismo motivo que `descargarCsv`).
 */
export function conBom(texto: string): string {
  return `\ufeff${texto}`;
}

/** Archivo de Storage a incluir en el ZIP. */
export interface ArchivoStorage {
  /** Ruta en el bucket `clinical-documents` (empieza con el id de la clínica). */
  ruta: string;
  /** Ruta dentro del ZIP. */
  destino: string;
  bytes: number;
}

function limpiarNombre(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._]+/, "");
  return (limpio || "archivo").slice(-100);
}

/**
 * Lista de archivos de Storage referenciados por las filas exportadas:
 * documentos del paciente, firmas de consentimientos y firmas de aceptación
 * de presupuestos. Cada uno queda en `archivos/<tipo>/<patient_id>/...` para
 * que en el explorador de archivos se encuentre por paciente.
 *
 * Solo entran rutas de la propia clínica: la base ya lo garantiza, pero el
 * prefijo se verifica igual porque el servidor firma lo que el cliente pide.
 */
export function archivosDeStorage(
  clinicId: string,
  datos: {
    documentos?: readonly FilaExportacion[];
    consentimientos?: readonly FilaExportacion[];
    presupuestos?: readonly FilaExportacion[];
    recetas?: readonly FilaExportacion[];
  },
): ArchivoStorage[] {
  const prefijo = `${clinicId}/`;
  const salida: ArchivoStorage[] = [];
  const vistas = new Set<string>();
  const agregar = (ruta: unknown, destino: string, bytes: number) => {
    if (typeof ruta !== "string" || !ruta.startsWith(prefijo) || ruta.includes("..")) return;
    if (vistas.has(ruta)) return;
    vistas.add(ruta);
    salida.push({ ruta, destino, bytes });
  };

  for (const d of datos.documentos ?? []) {
    const nombre = limpiarNombre(String(d.filename ?? "archivo"));
    agregar(
      d.storage_path,
      `archivos/documentos/${String(d.patient_id)}/${String(d.id)}-${nombre}`,
      typeof d.size_bytes === "number" ? d.size_bytes : 0,
    );
  }
  for (const c of datos.consentimientos ?? []) {
    agregar(
      c.signature_storage_path,
      `archivos/firmas-consentimientos/${String(c.patient_id)}/${String(c.id)}.png`,
      // Una firma pesa unos pocos KB; se estima para el tope sin pedir el tamaño.
      20 * 1024,
    );
  }
  for (const q of datos.presupuestos ?? []) {
    agregar(
      q.accepted_signature_path,
      `archivos/firmas-presupuestos/${String(q.patient_id)}/${String(q.id)}.png`,
      20 * 1024,
    );
  }
  for (const r of datos.recetas ?? []) {
    agregar(
      r.signature_storage_path,
      `archivos/firmas-recetas/${String(r.patient_id)}/${String(r.id)}.png`,
      20 * 1024,
    );
  }
  return salida;
}

export interface ResumenExportacion {
  clinicaNombre: string;
  /** Fecha y hora legibles de la generación. */
  generadoEn: string;
  generadoPor: string;
  /** Filas por clave de tabla. */
  conteos: Record<string, number>;
  /** Archivos de Storage que quedaron dentro del ZIP. */
  archivosIncluidos: number;
  /** Archivos que no se pudieron descargar o no entraron por tamaño. */
  archivosOmitidos: number;
  /** Motivo de la omisión, si la hubo. */
  motivoOmision?: string;
  /** Tablas incluidas (por defecto, todas las de la clínica). */
  tablas?: readonly TablaExportacion[];
  /** Fichas en PDF generadas en `pacientes/`. */
  fichasPdf?: number;
  /** Fichas en PDF que no se pudieron generar. */
  fichasPdfOmitidas?: number;
  /** Exportación de una sola ficha: nombre del paciente. */
  paciente?: string;
  /** Exportación de una ficha sin presupuestos ni pagos (quien exportó no ve finanzas). */
  sinFinanzas?: boolean;
  /** Manifiesto con las huellas (EXP-02): agrega la sección de verificación. */
  manifiesto?: Manifiesto;
}

/** Texto del LEEME.txt que acompaña al ZIP. */
export function construirLeeme(r: ResumenExportacion): string {
  const tablas = r.tablas ?? TABLAS_EXPORTACION;
  const lineas: string[] = r.paciente
    ? [
        `EXPORTACIÓN DE LA FICHA DE ${r.paciente} - ${r.clinicaNombre}`,
        "",
        `Generada: ${r.generadoEn}`,
        `Por: ${r.generadoPor}`,
        "Origen: Esmalia (https://esmalia.com)",
        "",
        "Este archivo contiene la ficha completa del paciente guardada en Esmalia:",
        "un PDF legible en la carpeta pacientes/ y los mismos datos en planillas",
        "CSV que se abren con Excel, Google Sheets o LibreOffice. Son datos de",
        "salud: entrégalo solo al paciente o a su representante legal y no lo",
        "envíes por correo sin cifrar.",
        "",
      ]
    : [
        `EXPORTACIÓN COMPLETA DE DATOS - ${r.clinicaNombre}`,
        "",
        `Generada: ${r.generadoEn}`,
        `Por: ${r.generadoPor}`,
        "Origen: Esmalia (https://esmalia.com)",
        `Formato de exportación: versión ${VERSION_FORMATO_EXPORTACION}`,
        "",
        "Este archivo contiene todos los datos de tu clínica guardados en Esmalia,",
        "en planillas CSV que se abren con Excel, Google Sheets o LibreOffice,",
        "y una ficha en PDF por paciente en la carpeta pacientes/.",
        "Contiene datos de salud de tus pacientes: guárdalo en un lugar seguro y",
        "no lo envíes por correo sin cifrar.",
        "",
      ];
  lineas.push(
    "FICHAS EN PDF (carpeta pacientes/)",
    "- Un PDF por paciente, <id>-<nombre>.pdf: datos, anamnesis y alertas,",
    "  tutores, odontograma (marcas vigentes con su estado), periodontograma",
    "  resumido, notas clínicas con sus adendas y firma, consentimientos,",
    "  recetas, presupuestos y pagos.",
    `- Generadas: ${r.fichasPdf ?? 0}.${
      r.fichasPdfOmitidas
        ? ` No se pudieron generar: ${r.fichasPdfOmitidas} (sus datos están en los CSV).`
        : ""
    }`,
    "- Una ficha fusionada en otra no tiene PDF propio: sus notas, documentos y",
    "  consentimientos aparecen en el PDF de la ficha que quedó.",
    ...(r.sinFinanzas
      ? [
          "- Sin presupuestos ni pagos: los exporta el propietario o un",
          "  administrador de la clínica.",
        ]
      : []),
    "",
    "CÓMO LEER LOS ARCHIVOS",
    "- Codificación UTF-8 con BOM y separador punto y coma (;), el formato que",
    "  espera Excel en español.",
    "- Cada fila tiene un identificador (id). Las columnas que terminan en _id",
    "  apuntan al id de otro archivo: patient_id a pacientes.csv,",
    "  professional_id a profesionales.csv, branch_id a sucursales.csv, etc.",
    "- Las notas clínicas usan patient_ref para identificar al paciente.",
    "- Fechas y horas en formato ISO 8601 y en UTC (la Z o +00:00 al final).",
    "  Las fechas sin hora (birth_date, valid_until) no tienen zona.",
    "- Montos en la unidad mínima de la moneda (columnas *_cents): en USD o MXN",
    "  divide por 100; en monedas sin decimales (CLP, COP, PYG) el número ya es",
    "  el monto. La moneda está en la columna currency.",
    "- Listas (alergias, etiquetas, dientes) van en formato JSON.",
    "- Celdas vacías = sin dato. Una celda que empieza con un apóstrofo (') lo",
    "  lleva para que Excel no la ejecute como fórmula.",
    "",
    "ARCHIVOS",
  );

  for (const t of tablas) {
    const n = r.conteos[t.clave] ?? 0;
    lineas.push(`- ${t.archivo} (${n} ${n === 1 ? "fila" : "filas"})`);
    lineas.push(`  ${t.descripcion}`);
    if (r.manifiesto) {
      lineas.push("  Columnas:", ...leemeDeColumnas(t));
    }
  }

  if (r.manifiesto && r.manifiesto.tablas_excluidas.length) {
    lineas.push(
      "",
      "LO QUE NO SALE EN ESTA EXPORTACIÓN, Y POR QUÉ",
      "- La columna clinic_id: tiene un solo valor, el id de tu clínica (está en clinica.csv).",
      ...r.manifiesto.tablas_excluidas.map((e) => `- ${e.tabla}: ${e.motivo}`),
    );
  }

  lineas.push("");
  lineas.push("ARCHIVOS ADJUNTOS (carpeta archivos/)");
  lineas.push(
    "- documentos/<patient_id>/: radiografías, fotos y otros documentos del paciente.",
    "- firmas-consentimientos/<patient_id>/: imagen de la firma de cada consentimiento.",
    "- firmas-presupuestos/<patient_id>/: firma de aceptación de cada presupuesto.",
    "- firmas-recetas/<patient_id>/: firma del profesional en cada receta.",
    `Incluidos en este ZIP: ${r.archivosIncluidos}.`,
  );
  if (r.archivosOmitidos > 0) {
    lineas.push(
      `No incluidos: ${r.archivosOmitidos}${r.motivoOmision ? ` (${r.motivoOmision})` : ""}.`,
      "Sus datos siguen en documentos.csv y consentimientos.csv. Para recibirlos,",
      "escribe a soporte@esmalia.com desde el correo del dueño de la clínica.",
    );
  }

  if (r.manifiesto) lineas.push("", ...leemeDeHuellas(r.manifiesto));

  lineas.push(
    "",
    "Esta exportación quedó registrada en el historial de la clínica, con la",
    "fecha y la persona que la pidió.",
    "",
  );
  return lineas.join("\r\n");
}

function slug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `esmalia-<clinica>-AAAA-MM-DD.zip` */
export function nombreZip(clinicaNombre: string, hoy: string): string {
  return `esmalia-${slug(clinicaNombre) || "clinica"}-${hoy}.zip`;
}

/** `esmalia-ficha-<paciente>-AAAA-MM-DD.zip` */
export function nombreZipPaciente(pacienteNombre: string, hoy: string): string {
  return `esmalia-ficha-${slug(pacienteNombre).slice(0, 60) || "paciente"}-${hoy}.zip`;
}

/** `pacientes/<id>-<nombre>.pdf` dentro del ZIP. */
export function rutaPdfPaciente(pacienteId: string, nombre: string): string {
  return `pacientes/${pacienteId}-${slug(nombre).slice(0, 60) || "paciente"}.pdf`;
}

/**
 * Arma el ZIP en memoria. Los CSV se comprimen (texto repetitivo, bajan a un
 * 10-20 %); los adjuntos se guardan sin comprimir porque JPG, PNG y PDF ya
 * vienen comprimidos y recomprimirlos solo gasta CPU.
 */
export function armarZip(
  textos: Record<string, string>,
  binarios: Record<string, Uint8Array> = {},
): Uint8Array {
  const entradas: Zippable = {};
  for (const [ruta, contenido] of Object.entries(textos)) {
    entradas[ruta] = [strToU8(contenido), { level: 6 }];
  }
  for (const [ruta, bytes] of Object.entries(binarios)) {
    entradas[ruta] = [bytes, { level: 0 }];
  }
  return zipSync(entradas);
}
