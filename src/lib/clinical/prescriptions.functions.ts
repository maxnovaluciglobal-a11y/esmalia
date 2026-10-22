import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicRole } from "@/lib/access/clinic-guards.server";
import {
  alergiasDeLaFicha,
  emitirReceta,
  exigeRegistroSis,
  plantillasDeReceta,
  vademecumDeLaClinica,
  type PlantillaDeReceta,
} from "@/lib/clinical/emitir-receta.server";
import {
  leerItemsGuardados,
  RecetaMedicamentoEntradaSchema,
} from "@/lib/clinical/receta-estructurada";
import { MAX_MEDICAMENTOS, type RecetaEmitida } from "@/lib/clinical/recetas";
import { recetaAFhir } from "@/lib/clinical/receta-fhir";
import { GRUPOS_FARMACOLOGICOS, VIAS, type MedicamentoVademecum } from "@/lib/clinical/vademecum";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";
import { cargarDatosParaDocumento, registroParaDocumentos } from "@/lib/documentos/contexto.server";
import { CamposSchema } from "@/lib/documentos/esquemas";
import type { DatosParaDocumento } from "@/lib/documentos/variables";
import { isUndefinedTableError, mensajeDb } from "@/lib/db-errors";
import { idsDeLaFicha } from "@/lib/patients/fusion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

const BUCKET = "clinical-documents";
const BUCKET_FIRMAS = "professional-signatures";
const SIGNED_URL_TTL_SECONDS = 60 * 10;
/** Quien receta (regla 15: par en el servidor del gate de la tarjeta). */
const PRESCRIPTORES = ["owner", "admin", "dentist"] as const;
const SIN_PERMISO_RECETAR =
  "Solo un profesional que receta (dentista o administrador) puede hacerlo.";

/** Profesionales activos con lo que hace falta para consentimientos y recetas. */
export type ProfesionalClinico = {
  id: string;
  fullName: string;
  licenseNumber: string | null;
  userId: string | null;
};

export const listProfesionalesClinicos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ProfesionalClinico[]> => {
    const { data: rows, error } = await context.supabase
      .from("professionals")
      .select("id, full_name, license_number, user_id")
      .eq("clinic_id", data.clinicId)
      .eq("is_active", true)
      .order("full_name", { ascending: true });
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar los profesionales de la clínica."));
    return (rows ?? []).map((p) => ({
      id: p.id,
      fullName: p.full_name,
      licenseNumber: p.license_number?.trim() || null,
      userId: p.user_id,
    }));
  });

export type RecetaDeFicha = RecetaEmitida & {
  signatureUrl: string | null;
  /**
   * MKT-05: documento del motor con el que se imprime (folio, PDF, anulación).
   * null = receta del flujo anterior, con su propio PDF.
   */
  documento: { id: string; year: number; number: number } | null;
  patientDocument: string | null;
  professionalSis: string | null;
  allergyAlerts: string[];
  emitidaPorMi: boolean;
  deOtraFicha: boolean;
};

export type RecetasDelPaciente = {
  /** false = la migración 20261019190000 todavía no se aplicó. */
  disponible: boolean;
  recetas: RecetaDeFicha[];
};

const COLUMNAS =
  "id, patient_id, year, number, issued_at, issued_by, professional_name_snapshot, professional_license_snapshot, professional_specialty_snapshot, clinic_name_snapshot, clinic_legal_name_snapshot, clinic_tax_id_snapshot, clinic_address_snapshot, clinic_phone_snapshot, patient_name_snapshot, patient_birth_date_snapshot, items, instructions, signature_storage_path, content_sha256, voided_at, void_reason";
/** MKT-05 (20261025300100). Se piden aparte para no romper antes de aplicar la migración. */
const COLUMNAS_MKT05 =
  "id, issued_document_id, patient_document_id_snapshot, professional_sis_snapshot, allergy_alerts";

function alertasDesdeJson(valor: unknown): string[] {
  const r = z.array(z.string()).safeParse(valor);
  return r.success ? r.data : [];
}

export const listPatientPrescriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<RecetasDelPaciente> => {
    // SEG-02: en paralelo con la carga; se espera antes de responder.
    const lectura = registrarLecturaDeFicha(context.supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "documentos",
    });
    // CLI-06: una receta emitida no se reescribe al fusionar fichas: se lee
    // también desde las fichas fusionadas en esta.
    const fichas = await idsDeLaFicha(context.supabase, data.clinicId, data.patientId);
    const { data: rows, error } = await context.supabase
      .from("prescriptions")
      .select(COLUMNAS)
      .eq("clinic_id", data.clinicId)
      .in("patient_id", fichas)
      .order("issued_at", { ascending: false });
    if (error && isUndefinedTableError(error)) {
      await lectura;
      return { disponible: false, recetas: [] };
    }
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las recetas del paciente."));

    // MKT-05: datos nuevos y folio del documento. Sin la migración, la
    // consulta falla y las recetas se muestran como antes.
    const ids = (rows ?? []).map((r) => r.id);
    const extra = new Map<
      string,
      {
        issued_document_id: string | null;
        patient_document_id_snapshot: string | null;
        professional_sis_snapshot: string | null;
        allergy_alerts: unknown;
      }
    >();
    const folios = new Map<string, { year: number; number: number }>();
    if (ids.length) {
      const { data: filasExtra } = await context.supabase
        .from("prescriptions")
        .select(COLUMNAS_MKT05)
        .in("id", ids);
      for (const f of filasExtra ?? []) extra.set(f.id, f);
      const docIds = [...extra.values()]
        .map((f) => f.issued_document_id)
        .filter((x): x is string => !!x);
      if (docIds.length) {
        const { data: docs } = await context.supabase
          .from("issued_documents")
          .select("id, year, number")
          .in("id", docIds);
        for (const d of docs ?? []) folios.set(d.id, { year: d.year, number: d.number });
      }
    }

    const recetas: RecetaDeFicha[] = [];
    for (const r of rows ?? []) {
      let signatureUrl: string | null = null;
      if (r.signature_storage_path) {
        const { data: signed } = await context.supabase.storage
          .from(BUCKET)
          .createSignedUrl(r.signature_storage_path, SIGNED_URL_TTL_SECONDS);
        signatureUrl = signed?.signedUrl ?? null;
      }
      const e = extra.get(r.id);
      const docId = e?.issued_document_id ?? null;
      const folio = docId ? folios.get(docId) : undefined;
      recetas.push({
        id: r.id,
        year: r.year,
        number: r.number,
        issuedAt: r.issued_at,
        professionalName: r.professional_name_snapshot,
        professionalLicense: r.professional_license_snapshot,
        professionalSpecialty: r.professional_specialty_snapshot,
        clinicName: r.clinic_name_snapshot,
        clinicLegalName: r.clinic_legal_name_snapshot,
        clinicTaxId: r.clinic_tax_id_snapshot,
        clinicAddress: r.clinic_address_snapshot,
        clinicPhone: r.clinic_phone_snapshot,
        patientName: r.patient_name_snapshot,
        patientBirthDate: r.patient_birth_date_snapshot,
        items: leerItemsGuardados(r.items),
        instructions: r.instructions,
        contentSha256: r.content_sha256,
        voidedAt: r.voided_at,
        voidReason: r.void_reason,
        signatureUrl,
        documento: docId && folio ? { id: docId, ...folio } : null,
        patientDocument: e?.patient_document_id_snapshot ?? null,
        professionalSis: e?.professional_sis_snapshot ?? null,
        allergyAlerts: alertasDesdeJson(e?.allergy_alerts),
        emitidaPorMi: r.issued_by === context.userId,
        deOtraFicha: r.patient_id !== data.patientId,
      });
    }
    await lectura;
    return { disponible: true, recetas };
  });

// ─── MKT-05: emitir con el motor de documentos ──────────────────────────────

export interface DatosParaReceta {
  /** Ficha, clínica y profesional para la vista previa (sin la receta). */
  datos: DatosParaDocumento;
  profesional: {
    id: string;
    nombre: string;
    /** Registro que se imprime: el SIS, o el general si falta. */
    registro: string | null;
    registroSis: string | null;
    tieneFirma: boolean;
    firmaUrl: string | null;
  } | null;
  /** Chile: la receta exige el registro de la Superintendencia de Salud. */
  exigeSis: boolean;
  alergias: string[];
  plantillas: PlantillaDeReceta[];
  vademecumClinica: MedicamentoVademecum[];
}

/** Todo lo que necesita el diálogo de receta, en una sola llamada. */
export const getDatosParaReceta = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<DatosParaReceta> => {
    const { supabase, userId } = context;
    const lectura = registrarLecturaDeFicha(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "documentos",
    });
    const [{ datos, profesional }, alergias, exigeSis, plantillas, vademecum] = await Promise.all([
      cargarDatosParaDocumento(supabase, {
        clinicId: data.clinicId,
        patientId: data.patientId,
        userId,
      }),
      alergiasDeLaFicha(supabase, data.clinicId, data.patientId),
      exigeRegistroSis(supabase, data.clinicId),
      plantillasDeReceta(supabase, data.clinicId),
      vademecumDeLaClinica(supabase, data.clinicId),
    ]);
    let firmaUrl: string | null = null;
    if (profesional?.firmaPath) {
      const { data: firmada } = await supabase.storage
        .from(BUCKET_FIRMAS)
        .createSignedUrl(profesional.firmaPath, SIGNED_URL_TTL_SECONDS);
      firmaUrl = firmada?.signedUrl ?? null;
    }
    await lectura;
    return {
      datos,
      profesional: profesional
        ? {
            id: profesional.id,
            nombre: profesional.nombre,
            registro: registroParaDocumentos(profesional),
            registroSis: profesional.registroSis,
            tieneFirma: Boolean(profesional.firmaPath),
            firmaUrl,
          }
        : null,
      exigeSis,
      alergias,
      plantillas,
      vademecumClinica: vademecum.map(({ activo: _a, id: _i, ...m }) => m),
    };
  });

/**
 * Emite una receta: documento del motor (folio, firma, huella) + receta
 * estructurada, en una sola transacción. Ver `emitir-receta.server.ts`.
 */
export const emitirRecetaDelPaciente = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        templateId: z.string().uuid().optional(),
        items: z
          .array(RecetaMedicamentoEntradaSchema)
          .min(1, "Agrega al menos un medicamento.")
          .max(MAX_MEDICAMENTOS, `Una receta admite hasta ${MAX_MEDICAMENTOS} medicamentos.`),
        indicaciones: z.string().trim().max(2000).optional().or(z.literal("")),
        campos: CamposSchema.optional(),
        alergiasConfirmadas: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicRole(supabase, data.clinicId, userId, PRESCRIPTORES, SIN_PERMISO_RECETAR);
    return emitirReceta(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      userId,
      templateId: data.templateId,
      items: data.items,
      indicaciones: data.indicaciones ?? "",
      campos: data.campos ?? {},
      alergiasConfirmadas: data.alergiasConfirmadas === true,
    });
  });

export const voidPrescription = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        prescriptionId: z.string().uuid(),
        reason: z.string().trim().min(3, "Escribe el motivo de la anulación.").max(300),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // MKT-05: si la receta tiene documento, la base lo anula también
    // (trigger recetas_anular_juntas), con el mismo motivo.
    const { data: filas, error } = await context.supabase
      .from("prescriptions")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: context.userId,
        void_reason: data.reason,
      })
      .eq("id", data.prescriptionId)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para anular esta receta."));
    if (!filas?.length) throw new Error("No tienes permisos para anular esta receta.");
    return { ok: true };
  });

/**
 * La receta como Bundle FHIR R4 (MedicationRequest por medicamento). Solo
 * se descarga: no hay integración con el Minsal todavía.
 */
export const getRecetaFhir = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), prescriptionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: r, error } = await supabase
      .from("prescriptions")
      .select("*")
      .eq("id", data.prescriptionId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la receta."));
    if (!r) throw new Error("No tienes permisos para ver esta receta.");
    const lectura = registrarLecturaDeFicha(supabase, {
      clinicId: data.clinicId,
      patientId: r.patient_id,
      seccion: "documentos",
    });
    let folio = { year: r.year, number: r.number };
    if (r.issued_document_id) {
      const { data: d } = await supabase
        .from("issued_documents")
        .select("year, number")
        .eq("id", r.issued_document_id)
        .maybeSingle();
      if (d) folio = d;
    }
    await lectura;
    const folioTexto = `${folio.year}-${String(folio.number).padStart(4, "0")}`;
    const bundle = recetaAFhir({
      id: r.id,
      folio: folioTexto,
      issuedAt: r.issued_at,
      voidedAt: r.voided_at,
      voidReason: r.void_reason,
      paciente: {
        id: r.patient_id,
        nombre: r.patient_name_snapshot,
        tipoDocumento: r.patient_document_type_snapshot,
        documento: r.patient_document_id_snapshot,
        fechaNacimiento: r.patient_birth_date_snapshot,
      },
      profesional: {
        id: r.professional_id,
        nombre: r.professional_name_snapshot,
        registroSis: r.professional_sis_snapshot,
        registroProfesional: r.professional_license_snapshot,
      },
      items: leerItemsGuardados(r.items),
      indicacionesGenerales: r.instructions,
    });
    // Como texto: el cliente lo descarga tal cual (receta-<folio>.fhir.json).
    return { nombre: `receta-${folioTexto}.fhir.json`, json: JSON.stringify(bundle, null, 2) };
  });

// ─── MKT-05: vademécum de la clínica ────────────────────────────────────────

export type MedicamentoDeLaClinica = MedicamentoVademecum & { id: string; activo: boolean };

export const listVademecumClinica = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<MedicamentoDeLaClinica[]> => {
    try {
      return await vademecumDeLaClinica(context.supabase, data.clinicId, {
        incluirInactivos: true,
      });
    } catch (e) {
      // Antes de aplicar la migración 20261025300000 no hay vademécum propio.
      if (e instanceof Error && /clinic_medications/.test(e.message)) return [];
      throw e;
    }
  });

const texto = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

const MedicamentoClinicaSchema = z.object({
  clinicId: z.string().uuid(),
  /** Sin id = nuevo. */
  id: z.string().uuid().optional(),
  principioActivo: z.string().trim().min(2, "Escribe el principio activo.").max(120),
  concentracion: texto(60),
  forma: texto(60),
  grupo: z.enum(GRUPOS_FARMACOLOGICOS).nullable().optional(),
  via: z.enum(VIAS),
  atc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][0-9]{2}[A-Z]{0,2}[0-9]{0,2}$/, "El código ATC tiene la forma J01CA04.")
    .optional()
    .or(z.literal("")),
  dosis: texto(120),
  frecuencia: texto(120),
  duracion: texto(120),
  indicaciones: texto(500),
});

const vacioANull = (v: string | undefined) => (v?.trim() ? v.trim() : null);

export const guardarMedicamentoClinica = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => MedicamentoClinicaSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicRole(supabase, data.clinicId, userId, PRESCRIPTORES, SIN_PERMISO_RECETAR);
    const fila = {
      active_ingredient: data.principioActivo,
      concentration: vacioANull(data.concentracion),
      form: vacioANull(data.forma),
      pharmacological_group: data.grupo ?? null,
      route: data.via,
      atc_code: vacioANull(data.atc),
      dose: vacioANull(data.dosis),
      frequency: vacioANull(data.frecuencia),
      duration: vacioANull(data.duracion),
      instructions: vacioANull(data.indicaciones),
    };
    if (data.id) {
      const { data: filas, error } = await supabase
        .from("clinic_medications")
        .update(fila)
        .eq("id", data.id)
        .eq("clinic_id", data.clinicId)
        .select("id");
      if (error) throw new Error(mensajeDb(error, "No tienes permisos para editar el vademécum."));
      if (!filas?.length) throw new Error("No tienes permisos para editar el vademécum.");
      return { id: data.id };
    }
    const { data: nueva, error } = await supabase
      .from("clinic_medications")
      .insert({ ...fila, clinic_id: data.clinicId })
      .select("id")
      .single();
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para editar el vademécum."));
    return { id: nueva.id };
  });

export const setMedicamentoClinicaActivo = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), id: z.string().uuid(), activo: z.boolean() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicRole(supabase, data.clinicId, userId, PRESCRIPTORES, SIN_PERMISO_RECETAR);
    const { data: filas, error } = await supabase
      .from("clinic_medications")
      .update({ active: data.activo })
      .eq("id", data.id)
      .eq("clinic_id", data.clinicId)
      .select("id");
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para editar el vademécum."));
    if (!filas?.length) throw new Error("No tienes permisos para editar el vademécum.");
    return { ok: true as const };
  });
