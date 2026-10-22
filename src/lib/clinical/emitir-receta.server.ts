/**
 * Emisión de una receta con el motor de documentos (MKT-05), en el servidor.
 *
 *   emitirReceta(supabase, { clinicId, patientId, userId, items, ... })
 *
 * 1. Elige la plantilla de receta de la clínica (o la indicada) y la valida.
 * 2. Carga la ficha con la RLS del usuario: paciente (con su RUT), clínica,
 *    el profesional de quien emite, y las alergias de la anamnesis (también
 *    las de las fichas fusionadas en esta).
 * 3. Arma cada medicamento: lo escrito por el profesional + lo que se sabe
 *    del vademécum (principio activo, ATC, familia) + la posología
 *    interpretada para FHIR.
 * 4. Recalcula los avisos de alergia: si hay alguno, solo se emite si el
 *    profesional confirmó que los vio (y quedan guardados en la receta).
 * 5. Renderiza con el motor y llama a `emitir_receta`, que escribe el
 *    documento y la receta en una sola transacción. La base pone folio,
 *    fecha, quién, los datos copiados (RUT, registro SIS) y las huellas.
 *
 * Nunca confía en lo que calculó el navegador: la vista previa usa el mismo
 * motor con los mismos datos, pero lo que se guarda se arma acá.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { alertasDeAlergia, grupoDe } from "@/lib/clinical/recetas";
import {
  estructurarItem,
  type RecetaItemGuardado,
  type RecetaMedicamentoEntrada,
} from "@/lib/clinical/receta-estructurada";
import {
  esGrupoFarmacologico,
  esVia,
  medicamentoBase,
  PREFIJO_CLINICA,
  type MedicamentoVademecum,
} from "@/lib/clinical/vademecum";
import { cargarDatosParaDocumento } from "@/lib/documentos/contexto.server";
import { camposSinCompletar, cargarVersion } from "@/lib/documentos/emitir.server";
import {
  analizarPlantilla,
  bloqueDeFirma,
  bloquesAHtml,
  renderPlantilla,
} from "@/lib/documentos/motor";
import { construirContexto } from "@/lib/documentos/variables";
import { mensajeDb } from "@/lib/db-errors";
import { idsDeLaFicha } from "@/lib/patients/fusion";

type Cliente = SupabaseClient<Database>;

// ─── Datos de apoyo ─────────────────────────────────────────────────────────

/** Alergias de la anamnesis del paciente y de las fichas fusionadas en la suya. */
export async function alergiasDeLaFicha(
  supabase: Cliente,
  clinicId: string,
  patientId: string,
): Promise<string[]> {
  const fichas = await idsDeLaFicha(supabase, clinicId, patientId);
  const { data, error } = await supabase
    .from("patient_medical_history")
    .select("patient_id, allergies")
    .eq("clinic_id", clinicId)
    .in("patient_id", fichas);
  if (error) throw new Error(mensajeDb(error, "No pudimos cargar las alergias del paciente."));
  // La ficha propia primero, después las fusionadas.
  const filas = [...(data ?? [])].sort(
    (a, b) => Number(b.patient_id === patientId) - Number(a.patient_id === patientId),
  );
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const f of filas) {
    for (const a of f.allergies ?? []) {
      const t = a.trim();
      const clave = t.toLocaleLowerCase("es");
      if (t && !vistas.has(clave)) {
        vistas.add(clave);
        out.push(t);
      }
    }
  }
  return out;
}

type FilaMedicamento = Database["public"]["Tables"]["clinic_medications"]["Row"];

export function medicamentoDeLaClinica(f: FilaMedicamento): MedicamentoVademecum {
  return {
    codigo: `${PREFIJO_CLINICA}${f.id}`,
    origen: "clinica",
    principioActivo: f.active_ingredient,
    concentracion: f.concentration,
    forma: f.form,
    grupo: esGrupoFarmacologico(f.pharmacological_group) ? f.pharmacological_group : null,
    via: esVia(f.route) ? f.route : "oral",
    atc: f.atc_code,
    dosis: f.dose ?? "",
    frecuencia: f.frequency ?? "",
    duracion: f.duration ?? "",
    indicaciones: f.instructions,
  };
}

/** Vademécum propio de la clínica (solo los activos, salvo que se pidan todos). */
export async function vademecumDeLaClinica(
  supabase: Cliente,
  clinicId: string,
  opciones: { incluirInactivos?: boolean; ids?: string[] } = {},
): Promise<(MedicamentoVademecum & { activo: boolean; id: string })[]> {
  let consulta = supabase
    .from("clinic_medications")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("active_ingredient", { ascending: true });
  if (!opciones.incluirInactivos) consulta = consulta.eq("active", true);
  if (opciones.ids) {
    if (!opciones.ids.length) return [];
    consulta = consulta.in("id", opciones.ids);
  }
  const { data, error } = await consulta;
  if (error) throw new Error(mensajeDb(error, "No pudimos cargar el vademécum de la clínica."));
  return (data ?? []).map((f) => ({ ...medicamentoDeLaClinica(f), activo: f.active, id: f.id }));
}

export interface PlantillaDeReceta {
  id: string;
  title: string;
  /** La que sembró Esmalia (seed_key 'receta'). */
  base: boolean;
  version: { id: string; numero: number; body: string } | null;
}

/** Plantillas de receta activas de la clínica, la base primero. */
export async function plantillasDeReceta(
  supabase: Cliente,
  clinicId: string,
): Promise<PlantillaDeReceta[]> {
  const { data, error } = await supabase
    .from("document_templates")
    .select("id, title, seed_key, current_version_id")
    .eq("clinic_id", clinicId)
    .eq("kind", "receta")
    .eq("active", true)
    .order("title", { ascending: true });
  if (error) throw new Error(mensajeDb(error, "No pudimos cargar la plantilla de receta."));
  const ids = (data ?? []).map((t) => t.current_version_id).filter((x): x is string => !!x);
  const versiones = new Map<string, { id: string; version: number; body: string }>();
  if (ids.length) {
    const { data: vs, error: errV } = await supabase
      .from("document_template_versions")
      .select("id, version, body")
      .in("id", ids);
    if (errV) throw new Error(mensajeDb(errV, "No pudimos cargar la plantilla de receta."));
    for (const v of vs ?? []) versiones.set(v.id, v);
  }
  return (data ?? [])
    .map((t) => {
      const v = t.current_version_id ? versiones.get(t.current_version_id) : undefined;
      return {
        id: t.id,
        title: t.title,
        base: t.seed_key === "receta",
        version: v ? { id: v.id, numero: v.version, body: v.body } : null,
      };
    })
    .sort((a, b) => Number(b.base) - Number(a.base));
}

/** ¿La clínica exige el registro de la Superintendencia de Salud? (Chile.) */
export async function exigeRegistroSis(supabase: Cliente, clinicId: string): Promise<boolean> {
  const { data } = await supabase
    .from("clinics")
    .select("country")
    .eq("id", clinicId)
    .maybeSingle();
  return (data?.country ?? "CL").toUpperCase() === "CL";
}

// ─── Armado de la receta ────────────────────────────────────────────────────

/** Avisos de alergia de todos los medicamentos, sin repetir. */
export function avisosDeLaReceta(
  items: readonly Pick<RecetaItemGuardado, "medication" | "group">[],
  alergias: readonly string[],
): string[] {
  const avisos: string[] = [];
  for (const item of items) {
    for (const aviso of alertasDeAlergia(item.medication, alergias, item.group ?? null)) {
      const texto = `${item.medication.trim()}: ${aviso}`;
      if (!avisos.includes(texto)) avisos.push(texto);
    }
  }
  return avisos;
}

/** Medicamentos que se guardan, con el vademécum que corresponde a cada uno. */
export async function armarMedicamentos(
  supabase: Cliente,
  clinicId: string,
  entradas: readonly RecetaMedicamentoEntrada[],
): Promise<RecetaItemGuardado[]> {
  const idsClinica = entradas
    .map((e) => e.catalog ?? "")
    .filter((c) => c.startsWith(PREFIJO_CLINICA))
    .map((c) => c.slice(PREFIJO_CLINICA.length));
  const propios = new Map(
    (
      await vademecumDeLaClinica(supabase, clinicId, { ids: idsClinica, incluirInactivos: true })
    ).map((m) => [m.codigo, m]),
  );
  return entradas.map((e) => {
    const catalogo = e.catalog
      ? (medicamentoBase(e.catalog) ?? propios.get(e.catalog) ?? null)
      : null;
    return estructurarItem(e, catalogo, grupoDe);
  });
}

export interface RecetaEmitidaConDocumento {
  documentId: string;
  prescriptionId: string;
  year: number;
  number: number;
  contentSha256: string;
}

export async function emitirReceta(
  supabase: Cliente,
  args: {
    clinicId: string;
    patientId: string;
    userId: string;
    templateId?: string;
    items: readonly RecetaMedicamentoEntrada[];
    indicaciones: string;
    campos: Readonly<Record<string, string>>;
    /** El profesional vio los avisos de alergia y emite igual. */
    alergiasConfirmadas: boolean;
  },
): Promise<RecetaEmitidaConDocumento> {
  // 1. Plantilla.
  let templateId = args.templateId;
  if (templateId) {
    const { data: t } = await supabase
      .from("document_templates")
      .select("kind")
      .eq("id", templateId)
      .eq("clinic_id", args.clinicId)
      .maybeSingle();
    if (t?.kind !== "receta") throw new Error("Elige una plantilla de receta.");
  } else {
    const [primera] = await plantillasDeReceta(supabase, args.clinicId);
    if (!primera) {
      throw new Error(
        "Tu clínica no tiene una plantilla de receta activa. Actívala en Ajustes → Plantillas de documentos.",
      );
    }
    templateId = primera.id;
  }
  const version = await cargarVersion(supabase, { clinicId: args.clinicId, templateId });
  const analisis = analizarPlantilla(version.body);
  if (analisis.problemas.length) {
    throw new Error(
      `La plantilla de receta tiene errores y no se puede emitir: ${analisis.problemas[0].mensaje}`,
    );
  }
  const faltan = camposSinCompletar(analisis.campos, args.campos);
  if (faltan.length) throw new Error(`Completa: ${faltan.join(", ")}.`);
  const campos: Record<string, string> = {};
  for (const c of analisis.campos) {
    const v = (args.campos[c] ?? "").trim();
    if (v) campos[c] = v;
  }

  // 2. Ficha, profesional y alergias.
  const [{ datos, profesional }, alergias, conSis] = await Promise.all([
    cargarDatosParaDocumento(supabase, {
      clinicId: args.clinicId,
      patientId: args.patientId,
      userId: args.userId,
    }),
    alergiasDeLaFicha(supabase, args.clinicId, args.patientId),
    exigeRegistroSis(supabase, args.clinicId),
  ]);
  if (!profesional) {
    throw new Error(
      "Para emitir recetas necesitas una ficha de profesional vinculada a tu usuario. Pídesela a un administrador en Profesionales.",
    );
  }
  if (conSis && !profesional.registroSis) {
    throw new Error(
      "Carga tu número de registro de la Superintendencia de Salud en Preferencias → Mi firma antes de emitir recetas.",
    );
  }
  if (!datos.profesional?.registroSis) {
    throw new Error("Carga tu número de registro profesional antes de emitir recetas.");
  }

  // 3. Medicamentos.
  const items = await armarMedicamentos(supabase, args.clinicId, args.items);

  // 4. Alergias.
  const avisos = avisosDeLaReceta(items, alergias);
  if (avisos.length && !args.alergiasConfirmadas) {
    throw new Error(
      "Hay medicamentos que chocan con alergias anotadas en la ficha. Revísalos y confirma antes de emitir.",
    );
  }

  // 5. Render y emisión.
  const indicaciones = args.indicaciones.trim();
  const render = renderPlantilla(
    version.body,
    construirContexto({
      ...datos,
      campos,
      receta: { items, indicacionesGenerales: indicaciones || null, alergias },
    }),
    { firma: bloqueDeFirma(datos.profesional) },
  );
  if (render.desconocidas.length) {
    throw new Error(
      `La plantilla usa variables que no conocemos: ${render.desconocidas.join(", ")}.`,
    );
  }

  const { data, error } = await supabase.rpc("emitir_receta", {
    p_clinic_id: args.clinicId,
    p_patient_id: args.patientId,
    p_professional_id: profesional.id,
    p_template_version_id: version.id,
    p_fields: campos as Json,
    p_content_blocks: render.bloques as unknown as Json,
    p_content_html: bloquesAHtml(render.bloques),
    p_items: items as unknown as Json,
    p_instructions: indicaciones,
    p_allergy_alerts: (avisos.length ? avisos : null) as Json,
  });
  if (error) throw new Error(mensajeDb(error, "No tienes permisos para emitir recetas."));
  const r = data as {
    document_id: string;
    prescription_id: string;
    year: number;
    number: number;
    content_sha256: string;
  };
  return {
    documentId: r.document_id,
    prescriptionId: r.prescription_id,
    year: r.year,
    number: r.number,
    contentSha256: r.content_sha256,
  };
}
