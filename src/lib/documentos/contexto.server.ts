/**
 * Carga, con la RLS del usuario, los datos que el motor necesita para armar
 * un documento de un paciente: ficha, clínica (con sus datos tributarios),
 * el profesional de quien emite y, si la plantilla lo pide, las prestaciones
 * y pagos de un período (MKT-04).
 *
 * Lo usan la vista previa (`getDatosParaEmitir`) y la emisión
 * (`emitirDocumento`): las dos ven exactamente los mismos datos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { armarReembolso, periodoValido } from "@/lib/documentos/reembolso";
import { TIPOS_BOLETA, type DatosParaDocumento, type TipoBoleta } from "@/lib/documentos/variables";
import { mensajeDb } from "@/lib/db-errors";
import { esPrevision, TRAMOS_FONASA, type TramoFonasa } from "@/lib/patients/datos-ficha";
import { idsDeLaFicha } from "@/lib/patients/fusion";

type Cliente = SupabaseClient<Database>;

/** Profesional vinculado al usuario en la clínica (quien emite y firma). */
export interface ProfesionalQueEmite {
  id: string;
  nombre: string;
  registroSis: string | null;
  /** Registro o colegiatura general (fallback del SIS en documentos). */
  registroGeneral: string | null;
  especialidad: string | null;
  branchId: string | null;
  firmaPath: string | null;
  firmaSha256: string | null;
}

export async function profesionalDelUsuario(
  supabase: Cliente,
  clinicId: string,
  userId: string,
): Promise<ProfesionalQueEmite | null> {
  const { data, error } = await supabase
    .from("professionals")
    .select(
      "id, full_name, license_number, sis_registry_number, specialty_id, branch_id, signature_storage_path, signature_sha256",
    )
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(mensajeDb(error, "No pudimos cargar tu ficha de profesional."));
  if (!data) return null;
  let especialidad: string | null = null;
  if (data.specialty_id) {
    const { data: esp } = await supabase
      .from("specialties")
      .select("name")
      .eq("id", data.specialty_id)
      .maybeSingle();
    especialidad = esp?.name ?? null;
  }
  return {
    id: data.id,
    nombre: data.full_name,
    registroSis: data.sis_registry_number?.trim() || null,
    registroGeneral: data.license_number?.trim() || null,
    especialidad,
    branchId: data.branch_id,
    firmaPath: data.signature_storage_path,
    firmaSha256: data.signature_sha256,
  };
}

/** Registro que se imprime: el de la Superintendencia de Salud, o el general si falta. */
export function registroParaDocumentos(
  p: Pick<ProfesionalQueEmite, "registroSis" | "registroGeneral">,
) {
  return p.registroSis ?? p.registroGeneral;
}

function tramoFonasa(v: string | null): TramoFonasa | null {
  return v && (TRAMOS_FONASA as readonly string[]).includes(v) ? (v as TramoFonasa) : null;
}

function tipoBoleta(v: string | null): TipoBoleta | null {
  return v && (TIPOS_BOLETA as readonly string[]).includes(v) ? (v as TipoBoleta) : null;
}

/**
 * Todo lo que el motor necesita, sin los campos que se completan al emitir
 * (`campos` vacío: lo llena quien llama). `periodo` solo se usa si viene
 * completo y válido.
 */
export async function cargarDatosParaDocumento(
  supabase: Cliente,
  args: {
    clinicId: string;
    patientId: string;
    userId: string;
    periodo?: { desde: string; hasta: string } | null;
  },
): Promise<{ datos: DatosParaDocumento; profesional: ProfesionalQueEmite | null }> {
  const [clinica, paciente, profesional] = await Promise.all([
    supabase
      .from("clinics")
      .select(
        "name, legal_name, tax_id, business_activity, tax_address, tax_commune, tax_receipt_kind, timezone, currency",
      )
      .eq("id", args.clinicId)
      .maybeSingle(),
    supabase
      .from("patients")
      .select(
        "full_name, document_type, document_id, birth_date, health_plan, health_plan_tier, health_plan_institution, address, commune, phone, email",
      )
      .eq("id", args.patientId)
      .eq("clinic_id", args.clinicId)
      .maybeSingle(),
    profesionalDelUsuario(supabase, args.clinicId, args.userId),
  ]);
  if (clinica.error || !clinica.data) {
    throw new Error(mensajeDb(clinica.error, "No pudimos cargar los datos de la clínica."));
  }
  if (paciente.error || !paciente.data) {
    throw new Error(mensajeDb(paciente.error, "No tienes permisos para ver este paciente."));
  }

  // Dirección y teléfono: la sucursal del profesional, o la primera activa
  // (el mismo criterio que la base usa para el encabezado del documento).
  const { data: sucursales } = await supabase
    .from("branches")
    .select("id, address, city, phone, is_active, created_at")
    .eq("clinic_id", args.clinicId)
    .order("created_at", { ascending: true });
  const sucursal =
    (sucursales ?? []).find((b) => b.id === profesional?.branchId) ??
    (sucursales ?? []).find((b) => b.is_active) ??
    (sucursales ?? [])[0];

  const c = clinica.data;
  const p = paciente.data;
  const zona = c.timezone || "America/Santiago";
  const datos: DatosParaDocumento = {
    zona,
    ahora: new Date().toISOString(),
    moneda: c.currency,
    paciente: {
      nombre: p.full_name,
      tipoDocumento: p.document_type,
      documento: p.document_id,
      fechaNacimiento: p.birth_date,
      prevision: {
        plan: esPrevision(p.health_plan) ? p.health_plan : null,
        tramo: tramoFonasa(p.health_plan_tier),
        institucion: p.health_plan_institution,
      },
      direccion: p.address,
      comuna: p.commune,
      telefono: p.phone,
      email: p.email,
    },
    clinica: {
      nombre: c.name,
      razonSocial: c.legal_name,
      rut: c.tax_id,
      giro: c.business_activity,
      direccionTributaria: c.tax_address,
      comunaTributaria: c.tax_commune,
      direccion:
        [sucursal?.address?.trim(), sucursal?.city?.trim()].filter(Boolean).join(", ") || null,
      telefono: sucursal?.phone?.trim() || null,
      tipoBoleta: tipoBoleta(c.tax_receipt_kind),
    },
    profesional: profesional
      ? {
          nombre: profesional.nombre,
          registroSis: registroParaDocumentos(profesional),
          especialidad: profesional.especialidad,
        }
      : null,
    campos: {},
  };

  if (args.periodo && periodoValido(args.periodo.desde, args.periodo.hasta)) {
    datos.reembolso = await cargarReembolso(supabase, {
      clinicId: args.clinicId,
      patientId: args.patientId,
      desde: args.periodo.desde,
      hasta: args.periodo.hasta,
      zona,
    });
  }

  return { datos, profesional };
}

/** Prestaciones realizadas y pagos del paciente (y de las fichas fusionadas en la suya). */
async function cargarReembolso(
  supabase: Cliente,
  args: { clinicId: string; patientId: string; desde: string; hasta: string; zona: string },
) {
  const fichas = await idsDeLaFicha(supabase, args.clinicId, args.patientId);
  const { data: planes, error: errPlanes } = await supabase
    .from("treatment_plans")
    .select("id")
    .eq("clinic_id", args.clinicId)
    .in("patient_id", fichas);
  if (errPlanes) throw new Error(mensajeDb(errPlanes, "No pudimos cargar los tratamientos."));
  const planIds = (planes ?? []).map((x) => x.id);

  const [items, pagos] = await Promise.all([
    planIds.length
      ? supabase
          .from("treatment_items")
          .select("id, name_snapshot, tooth_number, procedure_id, completed_at")
          .eq("clinic_id", args.clinicId)
          .in("plan_id", planIds)
          .eq("status", "completed")
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("payments")
      .select("treatment_item_id, amount_cents, paid_at, reversed_at")
      .eq("clinic_id", args.clinicId)
      .in("patient_id", fichas),
  ]);
  if (items.error) throw new Error(mensajeDb(items.error, "No pudimos cargar las prestaciones."));
  if (pagos.error)
    throw new Error(mensajeDb(pagos.error, "No tienes permisos para ver los pagos."));

  const procIds = [
    ...new Set((items.data ?? []).map((i) => i.procedure_id).filter((x): x is string => !!x)),
  ];
  const codigos = new Map<string, string | null>();
  if (procIds.length) {
    const { data: procs } = await supabase
      .from("procedures")
      .select("id, fonasa_code")
      .in("id", procIds);
    for (const pr of procs ?? []) codigos.set(pr.id, pr.fonasa_code);
  }

  return armarReembolso({
    prestaciones: (items.data ?? []).map((i) => ({
      id: i.id,
      completadaEn: i.completed_at,
      nombre: i.name_snapshot,
      pieza: i.tooth_number,
      codigoFonasa: i.procedure_id ? (codigos.get(i.procedure_id) ?? null) : null,
    })),
    pagos: (pagos.data ?? []).map((x) => ({
      treatmentItemId: x.treatment_item_id,
      montoCents: x.amount_cents,
      pagadoEn: x.paid_at,
      reversado: x.reversed_at !== null,
    })),
    desde: args.desde,
    hasta: args.hasta,
    zona: args.zona,
  });
}
