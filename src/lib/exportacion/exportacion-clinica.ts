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

export const TABLAS_EXPORTACION: readonly TablaExportacion[] = [
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
    ],
    orden: ["id"],
  },
  {
    clave: "pacientes",
    tabla: "patients",
    archivo: "pacientes.csv",
    descripcion:
      "Pacientes: datos de identificación y contacto, estado, convenio, consentimiento de WhatsApp, fusiones de fichas (merged_into) y fichas archivadas (archived_at).",
    columnas: [
      "id",
      "full_name",
      "document_id",
      "birth_date",
      "phone",
      "phone_valid",
      "email",
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
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "id" },
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
      "arrived_at",
      "started_at",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "notas",
    tabla: "clinical_notes",
    archivo: "notas-clinicas.csv",
    descripcion:
      "Notas clínicas en su versión vigente: título, contenido, resumen, estado, revisión y firma (nombre y registro del profesional tal como quedaron al firmar). addendum_of = la nota que corrige esta adenda. patient_ref identifica al paciente.",
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
      "Pagos recibidos: monto, medio de pago, plan o prestación asociada, caja y reversas (reversed_at).",
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
      "notes",
      "reversed_at",
      "reversed_by",
      "reversal_reason",
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
    finanzas: true,
  },
  {
    clave: "cajas",
    tabla: "cash_registers",
    archivo: "cajas.csv",
    descripcion:
      "Aperturas y cierres de caja con montos esperados, declarados y diferencias del arqueo. El esperado es apertura + cobros en efectivo del turno (desde el 20-oct-2026; antes sumaba todos los medios de pago). closing_denominations trae el conteo por billete y moneda (JSON) cuando se contó así.",
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
      "created_at",
      "updated_at",
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
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
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
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
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
    ],
    orden: ["id"],
    paciente: { por: "patient_id" },
  },
  {
    clave: "aranceles",
    tabla: "procedures",
    archivo: "aranceles.csv",
    descripcion:
      "Arancel de prestaciones de la clínica: código, nombre, categoría, precio de lista, precio de referencia, costo de laboratorio y duración.",
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
      "created_by",
      "created_at",
      "updated_at",
    ],
    orden: ["id"],
  },
  {
    clave: "convenios",
    tabla: "agreements",
    archivo: "convenios.csv",
    descripcion: "Convenios (aseguradoras, empresas, previsiones) con su contacto.",
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
    columnas: ["professional_id", "kind", "percent_bps", "fixed_cents", "updated_by", "updated_at"],
    orden: ["professional_id"],
  },
  {
    clave: "comisiones_liquidaciones",
    tabla: "commission_settlements",
    archivo: "comisiones-liquidaciones.csv",
    descripcion:
      "Liquidaciones de comisiones cerradas: período, producción, prestaciones, regla aplicada, comisión y pago.",
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
