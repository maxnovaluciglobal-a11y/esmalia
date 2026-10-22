/**
 * PDF del presupuesto (Ola 4 · PLA-08 y PLA-11) en el servidor: carga el
 * presupuesto con la RLS del usuario, arma el contexto del motor (paciente,
 * clínica con sus datos tributarios, profesional a cargo y el grupo
 * `presupuesto.*`), renderiza la plantilla "Presupuesto" vigente de la clínica
 * y devuelve la hoja lista para `construirHojaPdf`. La misma hoja sirve para
 * la descarga (el navegador arma el PDF) y para el correo (el servidor arma
 * el PDF y lo adjunta): lo que se descarga es lo que se envía.
 *
 * El presupuesto no es un documento emitido: no lleva folio ni huella, y no
 * queda en `issued_documents`. Lo firma el profesional a cargo del
 * presupuesto (no quien descarga), con su nombre, especialidad y registro de
 * la Superintendencia de Salud, y la imagen de su firma si la registró.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { cargarDatosParaDocumento } from "@/lib/documentos/contexto.server";
import { bloqueDeFirma, renderPlantilla } from "@/lib/documentos/motor";
import type { HojaParaPdf } from "@/lib/documentos/pdf";
import {
  nombreDeArchivoPresupuesto,
  PLANTILLA_PRESUPUESTO,
  type DatosPresupuesto,
} from "@/lib/documentos/presupuesto";
import { construirContexto } from "@/lib/documentos/variables";
import { mensajeDb } from "@/lib/db-errors";
import { QUOTE_ITEM_COLUMNS, type QuoteItemRow } from "@/lib/finance/finance.functions";
import { fechaDocumento } from "@/lib/formato-fecha";

type Cliente = SupabaseClient<Database>;

const BUCKET_FIRMAS = "professional-signatures";
const TTL_URL_FIRMADA = 60 * 10;

export interface PresupuestoParaPdf {
  hoja: HojaParaPdf;
  nombreArchivo: string;
  patientId: string;
  numero: string;
  pacienteNombre: string;
  clinicaNombre: string;
  /** Firma del profesional a cargo (ruta y huella), para la firma a distancia (DOC-05). */
  firmaProfesional: { path: string; sha256: string } | null;
}

/** Texto vigente de la plantilla "Presupuesto" de la clínica (o el modelo de Esmalia). */
async function cuerpoDeLaPlantilla(supabase: Cliente, clinicId: string): Promise<string> {
  const { data: plantillas } = await supabase
    .from("document_templates")
    .select("id, seed_key, current_version_id, updated_at")
    .eq("clinic_id", clinicId)
    .eq("kind", "presupuesto")
    .eq("active", true)
    .not("current_version_id", "is", null)
    .order("updated_at", { ascending: false });
  // La sembrada por Esmalia (editada o no) manda; si la clínica la
  // desactivó y creó otra, la más reciente de las suyas.
  const elegida =
    (plantillas ?? []).find((p) => p.seed_key === "presupuesto") ?? (plantillas ?? [])[0];
  if (!elegida?.current_version_id) return PLANTILLA_PRESUPUESTO;
  const { data: version } = await supabase
    .from("document_template_versions")
    .select("body")
    .eq("id", elegida.current_version_id)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  return version?.body ?? PLANTILLA_PRESUPUESTO;
}

export async function armarPresupuestoParaPdf(
  supabase: Cliente,
  args: { clinicId: string; quoteId: string; userId: string },
): Promise<PresupuestoParaPdf> {
  const { data: q, error } = await supabase
    .from("quotes")
    .select(
      "id, number, status, currency, subtotal_cents, discount_cents, commercial_discount_pct, total_cents, agreement_name_snapshot, coverage_total_cents, notes, valid_until, created_at, patient_id, professional_id",
    )
    .eq("id", args.quoteId)
    .eq("clinic_id", args.clinicId)
    .maybeSingle();
  if (error) throw new Error(mensajeDb(error, "No pudimos cargar el presupuesto."));
  if (!q) throw new Error("No encontramos ese presupuesto.");

  const { data: filas, error: errItems } = await supabase
    .from("quote_items")
    .select(QUOTE_ITEM_COLUMNS)
    .eq("clinic_id", args.clinicId)
    .eq("quote_id", args.quoteId)
    .order("phase_position", { ascending: true })
    .order("position", { ascending: true });
  if (errItems) throw new Error(mensajeDb(errItems, "No pudimos cargar las prestaciones."));
  const items = (filas ?? []) as unknown as QuoteItemRow[];

  const [{ datos, profesional }, cuerpo] = await Promise.all([
    cargarDatosParaDocumento(supabase, {
      clinicId: args.clinicId,
      patientId: q.patient_id,
      userId: args.userId,
      profesionalId: q.professional_id ?? null,
    }),
    cuerpoDeLaPlantilla(supabase, args.clinicId),
  ]);

  const presupuesto: DatosPresupuesto = {
    numero: q.number,
    creadoEn: q.created_at,
    validoHasta: q.valid_until,
    profesional: profesional?.nombre ?? null,
    moneda: q.currency,
    lineas: items.map((it) => ({
      seccion: it.phase_label?.trim() || null,
      nombre: it.name_snapshot,
      pieza: it.tooth_number,
      cantidad: it.quantity,
      precioUnitarioCents: it.unit_price_cents,
      descuentoCents: it.discount_cents,
      descuentoPct: it.discount_pct,
      aceptada: it.accepted ?? null,
    })),
    subtotalCents: q.subtotal_cents,
    descuentoCents: q.discount_cents,
    descuentoPct: q.commercial_discount_pct,
    totalCents: q.total_cents,
    convenio: q.agreement_name_snapshot,
    coberturaCents: q.coverage_total_cents,
    notas: q.notes,
  };

  const render = renderPlantilla(cuerpo, construirContexto({ ...datos, presupuesto }), {
    firma: datos.profesional ? bloqueDeFirma(datos.profesional) : null,
  });

  // La imagen de la firma del profesional a cargo. El bucket solo lo leen los
  // roles clínicos; recepción también descarga y envía presupuestos, así que
  // la URL (10 min, de ESA ruta y nada más) la firma el rol de servicio
  // después de que la RLS del usuario ya dejó leer el presupuesto.
  let signatureUrl: string | null = null;
  if (profesional?.firmaPath) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: firmada } = await supabaseAdmin.storage
      .from(BUCKET_FIRMAS)
      .createSignedUrl(profesional.firmaPath, TTL_URL_FIRMADA);
    signatureUrl = firmada?.signedUrl ?? null;
  }

  const c = datos.clinica;
  const fiscal = [c.razonSocial, c.rut ? `RUT ${c.rut}` : null].filter(Boolean).join(" · ");
  const tributaria = [
    c.giro ? `Giro: ${c.giro}` : null,
    [c.direccionTributaria, c.comunaTributaria].filter(Boolean).join(", ") || null,
  ]
    .filter(Boolean)
    .join(" · ");
  const contacto = [c.direccion, c.telefono].filter(Boolean).join(" · ");
  const referencia = [
    `Presupuesto ${q.number}`,
    fechaDocumento(q.created_at, datos.zona),
    q.valid_until ? `Válido hasta el ${fechaDocumento(q.valid_until, datos.zona)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const aviso =
    q.status === "rejected"
      ? { titulo: "PRESUPUESTO RECHAZADO", detalle: null }
      : q.status === "expired"
        ? { titulo: "PRESUPUESTO VENCIDO", detalle: "Pide a la clínica uno actualizado." }
        : null;

  return {
    hoja: {
      clinicName: c.nombre,
      lineasEncabezado: [fiscal, tributaria, contacto].filter(Boolean),
      referencia,
      aviso,
      bloques: render.bloques,
      signatureUrl,
      pie: `Presupuesto ${q.number} · ${c.nombre}`,
    },
    nombreArchivo: nombreDeArchivoPresupuesto(q.number),
    patientId: q.patient_id,
    numero: q.number,
    pacienteNombre: datos.paciente.nombre,
    clinicaNombre: c.nombre,
    firmaProfesional:
      profesional?.firmaPath && profesional.firmaSha256
        ? { path: profesional.firmaPath, sha256: profesional.firmaSha256 }
        : null,
  };
}
