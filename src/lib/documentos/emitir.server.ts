/**
 * Emisión de un documento (DOC-01): la API del motor para el servidor. La
 * usan la ficha del paciente (`documentos.functions.ts`) y la usarán el PDF
 * del presupuesto y la receta.
 *
 *   emitirDocumento(supabase, { clinicId, patientId, userId, templateId, campos })
 *
 * 1. Lee la versión vigente de la plantilla (o la indicada).
 * 2. Valida el texto (variables desconocidas o mal escritas → no se emite).
 * 3. Carga los datos de la ficha con la RLS del usuario y completa los campos.
 * 4. Exige los campos obligatorios y que quien emite tenga ficha de
 *    profesional con registro.
 * 5. Renderiza (bloques + HTML canónico) con la firma del profesional.
 * 6. Inserta. La base pone correlativo, fecha, quién, los datos copiados del
 *    profesional, de la clínica y del paciente, la firma y la huella.
 *
 * Nunca confía en un render del cliente: la vista previa del navegador usa
 * el mismo motor con los mismos datos, pero lo que se guarda se arma acá.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { cargarDatosParaDocumento } from "@/lib/documentos/contexto.server";
import {
  analizarPlantilla,
  bloqueDeFirma,
  bloquesAHtml,
  renderPlantilla,
} from "@/lib/documentos/motor";
import { construirContexto, definicionCampo } from "@/lib/documentos/variables";
import { mensajeDb } from "@/lib/db-errors";

type Cliente = SupabaseClient<Database>;

export interface VersionDePlantilla {
  id: string;
  templateId: string;
  version: number;
  title: string;
  body: string;
}

/** Versión vigente de una plantilla (o una versión puntual por id). */
export async function cargarVersion(
  supabase: Cliente,
  args: { clinicId: string; templateId?: string; templateVersionId?: string },
): Promise<VersionDePlantilla> {
  let versionId = args.templateVersionId ?? null;
  if (!versionId) {
    if (!args.templateId) throw new Error("Elige una plantilla.");
    const { data: t, error } = await supabase
      .from("document_templates")
      .select("id, current_version_id, active")
      .eq("id", args.templateId)
      .eq("clinic_id", args.clinicId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la plantilla."));
    if (!t) throw new Error("No tienes permisos para usar esta plantilla.");
    if (!t.active)
      throw new Error("Esta plantilla está desactivada: actívala en Ajustes para usarla.");
    if (!t.current_version_id) throw new Error("La plantilla todavía no tiene texto.");
    versionId = t.current_version_id;
  }
  const { data: v, error } = await supabase
    .from("document_template_versions")
    .select("id, template_id, version, title, body")
    .eq("id", versionId)
    .eq("clinic_id", args.clinicId)
    .maybeSingle();
  if (error) throw new Error(mensajeDb(error, "No pudimos cargar la plantilla."));
  if (!v) throw new Error("No tienes permisos para usar esta plantilla.");
  return { id: v.id, templateId: v.template_id, version: v.version, title: v.title, body: v.body };
}

/** Campos obligatorios sin completar, con su etiqueta (para el mensaje de error). */
export function camposSinCompletar(
  campos: readonly string[],
  valores: Readonly<Record<string, string>>,
): string[] {
  return campos
    .filter((c) => !definicionCampo(c).opcional && !(valores[c] ?? "").trim())
    .map((c) => definicionCampo(c).etiqueta);
}

export interface DocumentoEmitido {
  id: string;
  year: number;
  number: number;
  contentSha256: string;
}

export async function emitirDocumento(
  supabase: Cliente,
  args: {
    clinicId: string;
    patientId: string;
    userId: string;
    templateId?: string;
    templateVersionId?: string;
    campos: Readonly<Record<string, string>>;
  },
): Promise<DocumentoEmitido> {
  const version = await cargarVersion(supabase, args);

  // El presupuesto (PLA-08) usa el motor pero nunca se emite (no es un
  // documento emitido): se descarga o se envía desde el presupuesto. La
  // receta sí pasa por acá, desde su tarjeta (MKT-05).
  const { data: plantilla } = await supabase
    .from("document_templates")
    .select("kind")
    .eq("id", version.templateId)
    .eq("clinic_id", args.clinicId)
    .maybeSingle();
  if (plantilla?.kind === "presupuesto") {
    throw new Error(
      "Esta plantilla es la del presupuesto: descárgalo o envíalo desde el presupuesto del paciente.",
    );
  }

  const analisis = analizarPlantilla(version.body);
  if (analisis.problemas.length) {
    throw new Error(
      `La plantilla tiene errores y no se puede emitir: ${analisis.problemas[0].mensaje}`,
    );
  }

  const faltan = camposSinCompletar(analisis.campos, args.campos);
  if (faltan.length) throw new Error(`Completa: ${faltan.join(", ")}.`);

  // Solo los campos que la plantilla usa (no se guarda lo que sobra).
  const campos: Record<string, string> = {};
  for (const c of analisis.campos) {
    const v = (args.campos[c] ?? "").trim();
    if (v) campos[c] = v;
  }

  const usaReembolso = analisis.variables.some((v) => v.startsWith("reembolso."));
  const { datos, profesional } = await cargarDatosParaDocumento(supabase, {
    clinicId: args.clinicId,
    patientId: args.patientId,
    userId: args.userId,
    periodo: usaReembolso
      ? { desde: campos.periodo_desde ?? "", hasta: campos.periodo_hasta ?? "" }
      : null,
  });
  if (!profesional) {
    throw new Error(
      "Para emitir documentos necesitas una ficha de profesional vinculada a tu usuario. Pídesela a un administrador en Profesionales.",
    );
  }
  if (!datos.profesional?.registroSis) {
    throw new Error(
      "Carga tu número de registro de la Superintendencia de Salud en Ajustes → Documentos → Mi firma antes de emitir.",
    );
  }
  if (usaReembolso && !datos.reembolso) {
    throw new Error(
      "Indica un período válido: la fecha de inicio no puede ser posterior a la de término.",
    );
  }

  const render = renderPlantilla(version.body, construirContexto({ ...datos, campos }), {
    firma: bloqueDeFirma(datos.profesional),
  });
  if (render.desconocidas.length) {
    throw new Error(
      `La plantilla usa variables que no conocemos: ${render.desconocidas.join(", ")}.`,
    );
  }

  const { data: fila, error } = await supabase
    .from("issued_documents")
    .insert({
      clinic_id: args.clinicId,
      patient_id: args.patientId,
      template_version_id: version.id,
      professional_id: profesional.id,
      fields: campos as Json,
      content_blocks: render.bloques as unknown as Json,
      content_html: bloquesAHtml(render.bloques),
      issued_by: args.userId,
    })
    .select("id, year, number, content_sha256")
    .single();
  if (error) throw new Error(mensajeDb(error, "No tienes permisos para emitir documentos."));
  return {
    id: fila.id,
    year: fila.year,
    number: fila.number,
    contentSha256: fila.content_sha256,
  };
}
