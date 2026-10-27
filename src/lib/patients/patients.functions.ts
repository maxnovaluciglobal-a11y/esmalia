import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  formatoFecha,
  type EstadoPaciente,
  type EventoClinico,
  type Paciente,
} from "@/lib/clinic-operations/clinic-data";
import { registrarLecturaDeFicha } from "@/lib/clinical/lecturas-ficha.server";
import { mensajeDb } from "@/lib/db-errors";
import { leerTodasLasPaginas } from "@/lib/paginacion";
import { vigilarCifradoDeDocumento } from "@/lib/patients/documento-cifrado.server";
import { validatePhoneNumber } from "@/lib/patients/phoneValidation";
import { toE164 } from "@/lib/messaging/telefonos";
import { FILTROS_DE_ARCHIVO } from "@/lib/patients/archivo";
import { CAMPOS_EDITABLES_DEL_PACIENTE, CAMPOS_FICHA_OLA1 } from "@/lib/patients/editar-paciente";
import { actualizarPaciente } from "@/lib/patients/editar-paciente.server";
import type { Database } from "@/integrations/supabase/types";
import { requireEscritura } from "@/lib/solo-lectura.middleware";
import {
  esPrevision,
  faltantesDeLaFicha,
  normalizarCodigoReferido,
  origenPorReferido,
  parcheDeFichaOla1,
  TRAMOS_FONASA,
  type TramoFonasa,
} from "@/lib/patients/datos-ficha";
import {
  idsConElMismoDocumento,
  MENSAJE_DOCUMENTO_DUPLICADO,
} from "@/lib/patients/indice-ciego.server";
import { esTipoDocumento, formatearRut } from "@/lib/patients/rut";
import { permissionsForRole, type ClinicRole } from "@/lib/access/access";

const DB_STATUS_TO_UI: Record<string, EstadoPaciente> = {
  active: "activo",
  new: "nuevo",
  inactive: "inactivo",
};
const UI_STATUS_TO_DB: Record<EstadoPaciente, "active" | "new" | "inactive"> = {
  activo: "active",
  nuevo: "new",
  inactivo: "inactive",
};

/**
 * País de la clínica (`clinics.country`) para leer los teléfonos de sus
 * pacientes. null si no se pudo leer: en ese caso el teléfono se guarda tal
 * cual lo escribieron (no se adivina el país).
 */
async function paisDeLaClinica(
  supabase: SupabaseClient<Database>,
  clinicId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("clinics")
    .select("country")
    .eq("id", clinicId)
    .maybeSingle();
  return data?.country ?? null;
}

/**
 * Teléfono tal como se guarda en `patients.phone` (BIL-11): en E.164
 * ("+56912345678") cuando se puede leer con el país de la clínica; si no,
 * el texto original, para no perder un dato que el staff cargó y que puede
 * corregir después (el envío por WhatsApp igual lo rechaza).
 */
function telefonoParaGuardar(
  raw: string | null | undefined,
  country: string | null,
): string | null {
  const limpio = (raw ?? "").trim();
  if (!limpio) return null;
  return toE164(limpio, country) ?? limpio;
}

function calcularEdad(birthDate: string): number {
  const hoy = new Date();
  const nacimiento = new Date(birthDate);
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const mesDiff = hoy.getMonth() - nacimiento.getMonth();
  if (mesDiff < 0 || (mesDiff === 0 && hoy.getDate() < nacimiento.getDate())) edad--;
  return edad;
}

type PatientRow = {
  agreement_id?: string | null;
  agreement_member_id?: string | null;
  archived_at?: string | null;
  id: string;
  full_name: string;
  document_id: string | null;
  birth_date: string | null;
  phone: string | null;
  phone_valid: boolean | null;
  email: string | null;
  branch_id: string | null;
  primary_professional_id: string | null;
  status: string;
  tags: string[] | null;
  avatar_url: string | null;
  balance_cents: number | null;
  no_show_risk: number | null;
  ai_summary: string | null;
  wa_opt_in: boolean;
  referral_code: string | null;
  // Ola 1 · Frente Pacientes (migración 20261022100000).
  document_type?: string | null;
  health_plan?: string | null;
  health_plan_tier?: string | null;
  health_plan_institution?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_relationship?: string | null;
  emergency_contact_phone?: string | null;
  acquisition_source?: string | null;
  acquisition_source_detail?: string | null;
  address?: string | null;
  commune?: string | null;
};

type AppointmentSlim = { patient_id: string; starts_at: string; status: string };

function ultimaYProxima(appointments: AppointmentSlim[], patientId: string) {
  const ahora = Date.now();
  const propias = appointments.filter(
    (a) => a.patient_id === patientId && a.status !== "cancelada",
  );
  const pasadas = propias.filter((a) => new Date(a.starts_at).getTime() < ahora);
  const futuras = propias.filter((a) => new Date(a.starts_at).getTime() >= ahora);
  const ultima = pasadas.sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0] ?? null;
  const proxima = futuras.sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;
  return {
    ultimaVisita: ultima ? formatoFecha(ultima.starts_at.slice(0, 10)) : "Sin visitas",
    ultimaVisitaISO: ultima ? ultima.starts_at.slice(0, 10) : "",
    proximoControl: proxima ? formatoFecha(proxima.starts_at.slice(0, 10)) : null,
  };
}

function mapPatientRow(
  row: PatientRow,
  computed: { ultimaVisita: string; ultimaVisitaISO: string; proximoControl: string | null },
): Paciente {
  return {
    id: row.id,
    nombre: row.full_name,
    documento: row.document_id ?? "",
    edad: row.birth_date ? calcularEdad(row.birth_date) : 0,
    fechaNacimiento: row.birth_date ? row.birth_date.slice(0, 10) : null,
    telefono: row.phone ?? "",
    telefonoValido: row.phone_valid,
    email: row.email ?? "",
    sucursalId: row.branch_id ?? "",
    profesionalId: row.primary_professional_id ?? "",
    estado: DB_STATUS_TO_UI[row.status] ?? "nuevo",
    ultimaVisita: computed.ultimaVisita,
    ultimaVisitaISO: computed.ultimaVisitaISO,
    proximoControl: computed.proximoControl,
    saldo: row.balance_cents,
    riesgoAusencia: row.no_show_risk,
    etiquetas: row.tags ?? [],
    convenioId: row.agreement_id ?? null,
    convenioAfiliado: row.agreement_member_id ?? null,
    foto: row.avatar_url ?? undefined,
    resumenIA: row.ai_summary ?? "Aún no hay un resumen de Patty (IA) para este paciente.",
    timeline: [],
    waOptIn: row.wa_opt_in,
    referralCode: row.referral_code,
    archivadaEl: row.archived_at ?? null,
    documentoTipo: esTipoDocumento(row.document_type) ? row.document_type : null,
    prevision: esPrevision(row.health_plan) ? row.health_plan : null,
    previsionTramo: (TRAMOS_FONASA as readonly string[]).includes(row.health_plan_tier ?? "")
      ? (row.health_plan_tier as TramoFonasa)
      : null,
    previsionInstitucion: row.health_plan_institution ?? null,
    contactoEmergencia:
      row.emergency_contact_name || row.emergency_contact_phone
        ? {
            nombre: row.emergency_contact_name ?? "",
            relacion: row.emergency_contact_relationship ?? "",
            telefono: row.emergency_contact_phone ?? "",
          }
        : null,
    origen: row.acquisition_source ?? null,
    origenDetalle: row.acquisition_source_detail ?? null,
    direccion: row.address ?? null,
    comuna: row.commune ?? null,
  };
}

const PATIENT_COLUMNS =
  "id, full_name, document_id, birth_date, phone, phone_valid, email, branch_id, primary_professional_id, status, tags, avatar_url, balance_cents, no_show_risk, ai_summary, wa_opt_in, referral_code, agreement_id, agreement_member_id, archived_at, document_type, health_plan, health_plan_tier, health_plan_institution, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, acquisition_source, acquisition_source_detail, address, commune";

/**
 * Tope de fila del listado — red de seguridad, no la estrategia de paginado
 * real (el filtro de "última visita" es un campo calculado vía RPC, no una
 * columna directa, así que paginar server-side de verdad implicaría mover
 * ese filtro a la RPC también; con el volumen actual no se justifica).
 * `truncated` le avisa a la UI que hay más pacientes de los que se trajeron,
 * en vez de fallar en silencio (ver auditoría de arquitectura 2026-08-15).
 *
 * Se lee de a páginas de 1000 con `.range()`: una sola consulta con
 * `.limit(5000)` volvía con 1000 filas (el `max_rows` de PostgREST) y
 * `truncated` nunca se encendía (auditoría de rendimiento, 20-oct-2026).
 */
const PATIENTS_ROW_LIMIT = 5_000;

/** Listado de pacientes de la clínica. RLS: solo clínicas donde el usuario es miembro.
 *
 * Antes traía TODAS las citas de la clínica (limit 5000) para calcular en JS
 * la última/próxima por paciente. O(P×A) en memoria + silencioso cap con
 * volumen real. Ahora usa la RPC `list_patients_with_last_and_next_appointment`
 * que hace el cálculo en Postgres con índice `appointments_clinic_patient_idx`
 * y devuelve solo 1 fila por paciente.
 */
export const listPatients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        /** LEG-08: las fichas archivadas no aparecen salvo que se pidan. */
        archivo: z.enum(FILTROS_DE_ARCHIVO).default("activas"),
        /**
         * UX-15: saldo real por paciente (RPC `patient_balances`) para el
         * listado de /pacientes. Solo lo pide esa pantalla (las demás no lo
         * usan y no pagan la consulta) y solo se calcula para quien tiene
         * `finance:view`: a los demás el saldo les llega `null`.
         */
        conSaldos: z.boolean().default(false),
        /**
         * SEG-08: qué le falta a cada ficha (filtro "Fichas incompletas").
         * La anamnesis solo cuenta para quien ve la historia clínica.
         */
        conCompletitud: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ items: Paciente[]; truncated: boolean }> => {
    const { supabase, userId } = context;

    // Una consulta nueva por página: los builders de supabase-js acumulan
    // parámetros si se reusan.
    const consultaPacientes = () => {
      const consulta = supabase
        .from("patients")
        .select(PATIENT_COLUMNS)
        .eq("clinic_id", data.clinicId);
      if (data.archivo === "activas") return consulta.is("archived_at", null);
      if (data.archivo === "archivadas") return consulta.not("archived_at", "is", null);
      return consulta;
    };

    // Orden estable entre páginas: dos pacientes pueden llamarse igual.
    const [{ filas: rows, truncado: truncated, error }, { filas: apptRows, error: apptError }] =
      await Promise.all([
        leerTodasLasPaginas(
          (desde, hasta) =>
            consultaPacientes()
              .order("full_name", { ascending: true })
              .order("id", { ascending: true })
              .range(desde, hasta),
          { tope: PATIENTS_ROW_LIMIT },
        ),
        // Una fila por paciente de la clínica: también pasa de 1000.
        leerTodasLasPaginas((desde, hasta) =>
          supabase
            .rpc("list_patients_with_last_and_next_appointment", { p_clinic_id: data.clinicId })
            .order("patient_id", { ascending: true })
            .range(desde, hasta),
        ),
      ]);

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la lista de pacientes."));
    if (apptError)
      throw new Error(
        mensajeDb(apptError, "No pudimos cargar la información de citas de los pacientes."),
      );

    type ApptSummary = {
      patient_id: string;
      last_appointment_at: string | null;
      next_appointment_at: string | null;
    };
    const summaryByPatient = new Map<string, ApptSummary>(
      apptRows.map((r) => [(r as ApptSummary).patient_id, r as ApptSummary]),
    );

    // `patients.balance_cents` quedó del esquema original y no se mantiene:
    // el saldo real sale de `fetchPatientBalances`, como en la ficha.
    let saldos: Map<string, { billedCents: number; paidCents: number }> | null = null;
    let permisos: readonly string[] = [];
    if (data.conSaldos || data.conCompletitud) {
      const { data: membership } = await supabase
        .from("clinic_members")
        .select("role")
        .eq("clinic_id", data.clinicId)
        .eq("user_id", userId)
        .maybeSingle();
      permisos = membership?.role ? permissionsForRole(membership.role as ClinicRole) : [];
    }
    if (data.conSaldos && permisos.includes("finance:view")) {
      saldos = await fetchPatientBalances(supabase, data.clinicId);
    }

    // SEG-08: con anamnesis = tiene fila en patient_medical_history. Solo
    // para quien ve la historia clínica (la RLS igual no le daría filas a
    // los demás, y "falta anamnesis" sería falso).
    let conAnamnesis: Set<string> | null = null;
    let pais: string | null = null;
    if (data.conCompletitud) {
      pais = await paisDeLaClinica(supabase, data.clinicId);
      if (permisos.includes("clinical:view")) {
        const { filas, error: mhError } = await leerTodasLasPaginas((desde, hasta) =>
          supabase
            .from("patient_medical_history")
            .select("patient_id")
            .eq("clinic_id", data.clinicId)
            .order("patient_id", { ascending: true })
            .range(desde, hasta),
        );
        if (!mhError) conAnamnesis = new Set(filas.map((f) => f.patient_id));
      }
    }

    const items = rows.map((row) => {
      const s = summaryByPatient.get(row.id);
      if (data.conSaldos) {
        const saldo = saldos?.get(row.id);
        // Regla 11: sin movimientos es `null`, no "$0".
        (row as PatientRow).balance_cents =
          saldo && (saldo.billedCents !== 0 || saldo.paidCents !== 0)
            ? saldo.billedCents - saldo.paidCents
            : null;
      }
      const paciente = mapPatientRow(row as PatientRow, {
        ultimaVisita: s?.last_appointment_at
          ? formatoFecha(s.last_appointment_at.slice(0, 10))
          : "Sin visitas",
        ultimaVisitaISO: s?.last_appointment_at ? s.last_appointment_at.slice(0, 10) : "",
        proximoControl: s?.next_appointment_at
          ? formatoFecha(s.next_appointment_at.slice(0, 10))
          : null,
      });
      if (data.conCompletitud) {
        paciente.faltantes = faltantesDeLaFicha(
          {
            prevision: paciente.prevision ?? null,
            documento: paciente.documento,
            fechaNacimiento: paciente.fechaNacimiento ?? null,
            direccion: paciente.direccion ?? null,
            comuna: paciente.comuna ?? null,
            tieneAnamnesis: conAnamnesis ? conAnamnesis.has(paciente.id) : null,
          },
          (pais ?? "").toUpperCase() === "CL",
        );
      }
      return paciente;
    });
    return { items, truncated };
  });

/**
 * Saldo por paciente: total facturado en treatment_items (lo que le toca al
 * paciente cuando hay convenio, `patient_cents ?? price_cents`), excluyendo
 * planes cancelled, y total pagado en payments no reversados. Es la única
 * fuente del saldo: la ficha, la agenda, la morosidad y el aviso de
 * payment_due la usan (auditoría de código 01-sep-2026: estaba duplicada).
 *
 * La suma la hace Postgres (RPC `patient_balances`, SECURITY INVOKER, así que
 * la RLS de cada tabla se aplica igual). Antes se traían las filas crudas y
 * se sumaban acá, sin orden ni límite: PostgREST corta en `max_rows` (1000),
 * así que con volumen real el saldo salía mal en silencio y el outreach de
 * "saldo" podía escribirle a quien ya pagó (auditoría de rendimiento,
 * 20-oct-2026). El resultado es una fila por paciente, que también se lee de
 * a páginas por si la clínica tiene más de 1000 pacientes con movimiento.
 *
 * Sin `patientIds` trae la clínica entera; con ellos, solo esos pacientes.
 */
export async function fetchPatientBalances(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  patientIds?: string | readonly string[],
): Promise<Map<string, { billedCents: number; paidCents: number }>> {
  const ids =
    patientIds === undefined
      ? undefined
      : typeof patientIds === "string"
        ? [patientIds]
        : [...patientIds];
  const byPatient = new Map<string, { billedCents: number; paidCents: number }>();
  if (ids && ids.length === 0) return byPatient;

  const { filas, error } = await leerTodasLasPaginas((desde, hasta) =>
    supabase
      .rpc(
        "patient_balances",
        ids ? { p_clinic_id: clinicId, p_patient_ids: ids } : { p_clinic_id: clinicId },
      )
      .order("patient_id", { ascending: true })
      .range(desde, hasta),
  );
  if (error) throw new Error(mensajeDb(error, "No pudimos calcular el saldo del paciente."));

  for (const r of filas) {
    byPatient.set(r.patient_id, {
      billedCents: Number(r.billed_cents ?? 0),
      paidCents: Number(r.paid_cents ?? 0),
    });
  }
  return byPatient;
}

/** Ficha de un paciente, con timeline construido desde citas reales. */
export const getPatient = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<Paciente | null> => {
    const { supabase } = context;
    // SEG-02: en paralelo con la carga; se espera antes de responder.
    const lectura = registrarLecturaDeFicha(supabase, {
      clinicId: data.clinicId,
      patientId: data.patientId,
      seccion: "datos",
    });

    // Auditoría de código 01-sep-2026: patients/appointments/billing no
    // dependen entre sí (todas filtran solo por clinicId/patientId de la
    // request) — antes iban en 4 round-trips secuenciales a Supabase
    // (Vercel EE.UU. ↔ Supabase São Paulo, no es gratis: ver el comentario
    // de _clinic/route.tsx sobre el mismo cruce). Solo `professionals`
    // depende de verdad de un resultado previo (qué profesionales aparecen
    // en `appts`), así que ese sigue siendo un segundo paso obligado.
    // Trade-off aceptado: si el paciente no existe, este batch igual gasta
    // las queries de appointments/billing — ruta rara (solo bookmark viejo o
    // paciente borrado), y esta es la pantalla más visitada del repo
    // (`/pacientes/:id`, "el hub" según CLAUDE.md) para el caso común.
    const [{ data: row, error }, { data: appts, error: apptError }, balances] = await Promise.all([
      supabase
        .from("patients")
        .select(PATIENT_COLUMNS)
        .eq("clinic_id", data.clinicId)
        .eq("id", data.patientId)
        .maybeSingle(),
      supabase
        .from("appointments")
        .select("patient_id, professional_id, treatment_label, starts_at, status")
        .eq("clinic_id", data.clinicId)
        .eq("patient_id", data.patientId)
        .order("starts_at", { ascending: false })
        .limit(50),
      // Sobrescribe row.balance_cents (se dejó nullable en Fase 1 y ahora se
      // ignora — la fuente de verdad es la agregación de fetchPatientBalances).
      fetchPatientBalances(supabase, data.clinicId, data.patientId),
    ]);

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la ficha del paciente."));
    if (!row) return null;
    if (apptError)
      throw new Error(
        mensajeDb(apptError, "No pudimos cargar el historial de citas del paciente."),
      );

    const appointments = (appts ?? []) as (AppointmentSlim & {
      professional_id: string;
      treatment_label: string;
    })[];

    const professionalIds = [...new Set(appointments.map((a) => a.professional_id))];
    const { data: professionals, error: profError } = await supabase
      .from("professionals")
      .select("id, full_name")
      .in("id", professionalIds.length ? professionalIds : [""]);
    if (profError)
      throw new Error(mensajeDb(profError, "No pudimos cargar los datos de los profesionales."));
    const nameByProfessional = new Map((professionals ?? []).map((p) => [p.id, p.full_name]));

    const ahora = Date.now();
    const timeline: EventoClinico[] = appointments
      .filter((a) => new Date(a.starts_at).getTime() < ahora)
      .slice(0, 8)
      .map((a, i) => ({
        fecha: a.starts_at.slice(0, 10),
        instante: a.starts_at,
        titulo: a.treatment_label || "Consulta",
        detalle: [nameByProfessional.get(a.professional_id), a.status].filter(Boolean).join(" · "),
        tipo: "consulta" as const,
        actual: i === 0,
      }));

    const { billedCents: totalBilled = 0, paidCents: totalPaid = 0 } =
      balances.get(data.patientId) ?? {};
    const balance = totalBilled - totalPaid;

    await lectura;
    return {
      ...mapPatientRow(row as PatientRow, ultimaYProxima(appointments, data.patientId)),
      // null cuando no hay actividad financiera (nada facturado, nada pagado);
      // número (positivo = paciente debe, negativo = a favor) cuando hay algo
      saldo: totalBilled === 0 && totalPaid === 0 ? null : balance,
      timeline,
    };
  });

export const createPatient = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        nombre: z
          .string()
          .trim()
          .min(1, "El nombre es obligatorio.")
          .max(200, "El nombre es demasiado largo."),
        documento: z.string().trim().optional(),
        fechaNacimiento: z
          .string()
          .min(1, "La fecha de nacimiento es obligatoria.")
          .refine((s) => /^\d{4}-\d{2}-\d{2}/.test(s), "Formato de fecha inválido.")
          .refine((s) => {
            const d = new Date(s);
            const today = new Date();
            return d <= today;
          }, "La fecha de nacimiento no puede ser futura.")
          .refine((s) => {
            const d = new Date(s);
            return d >= new Date("1900-01-01");
          }, "Fecha de nacimiento fuera de rango."),
        telefono: z.string().trim().optional(),
        email: z.string().trim().email("Email inválido.").optional().or(z.literal("")),
        sucursalId: z.string().uuid().optional(),
        profesionalId: z.string().uuid().optional(),
        etiquetas: z.array(z.string()).default([]),
        estado: z.enum(["activo", "nuevo", "inactivo"]).default("nuevo"),
        /** Código de referido de otro paciente (FIC-04): fija el origen solo. */
        codigoReferido: z.string().trim().max(20).optional(),
        /** El alta ya avisó que hay otra ficha con el mismo documento y se confirmó. */
        permitirDuplicado: z.boolean().default(false),
      })
      .merge(CAMPOS_FICHA_OLA1)
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase } = context;
    const pais = await paisDeLaClinica(supabase, data.clinicId);

    // FIC-01: el RUT se valida también acá (regla 15) y se guarda con formato.
    const tipo = data.documentoTipo ?? null;
    const documento =
      data.documento && tipo === "rut" ? formatearRut(data.documento) : data.documento || null;

    // FIC-04: el código de referido decide el origen.
    let referidoPor: { id: string; nombre: string } | null = null;
    if (data.codigoReferido) {
      const codigo = normalizarCodigoReferido(data.codigoReferido);
      const { data: ref, error: refError } = await supabase
        .from("patients")
        .select("id, full_name")
        .eq("clinic_id", data.clinicId)
        .eq("referral_code", codigo)
        .maybeSingle();
      if (refError)
        throw new Error(mensajeDb(refError, "No pudimos revisar el código de referido."));
      if (!ref) throw new Error("No encontramos ese código de referido en la clínica.");
      referidoPor = { id: ref.id, nombre: ref.full_name };
    }
    const origenReferido = origenPorReferido(referidoPor);

    const { parche, error: errorFicha } = parcheDeFichaOla1(
      {
        documentoTipo: data.documentoTipo,
        prevision: data.prevision,
        contactoEmergencia: data.contactoEmergencia,
        origen: origenReferido
          ? { fuente: origenReferido.origen, detalle: origenReferido.detalle }
          : data.origen,
        direccion: data.direccion,
        comuna: data.comuna,
      },
      { pais, esAlta: true, documentoFinal: documento, tipoFinal: tipo },
    );
    if (errorFicha) throw new Error(errorFicha);

    // PAC-03: otra ficha con el mismo documento. El formulario ya lo avisó
    // y ofreció abrirla o fusionar; acá se exige la confirmación. Es un
    // aviso, no una regla de la base: si la búsqueda falla, no bloquea.
    if (documento && !data.permitirDuplicado) {
      const iguales = await idsConElMismoDocumento(supabase, data.clinicId, documento);
      if (iguales.length > 0) throw new Error(MENSAJE_DOCUMENTO_DUPLICADO);
    }

    const telefono = telefonoParaGuardar(data.telefono, pais);
    const phoneValid = await validatePhoneNumber(telefono);

    const { data: inserted, error } = await supabase
      .from("patients")
      .insert({
        clinic_id: data.clinicId,
        full_name: data.nombre,
        document_id: documento,
        birth_date: data.fechaNacimiento,
        phone: telefono,
        phone_valid: phoneValid,
        email: data.email || null,
        branch_id: data.sucursalId ?? null,
        primary_professional_id: data.profesionalId ?? null,
        tags: data.etiquetas,
        status: UI_STATUS_TO_DB[data.estado],
        referred_by_patient_id: referidoPor?.id ?? null,
        ...parche,
      })
      .select("id")
      .single();

    if (error) throw new Error("No pudimos crear el paciente. " + error.message);

    // SEG-03: el documento lo cifra la base al insertar (trigger
    // patients_cifrar_documento, migración 20261019160100). Acá solo se
    // verifica que haya quedado cifrado y, si no, se avisa a Sentry. No
    // bloquea el alta. document_id en claro sigue siendo la fuente de verdad
    // hasta el corte de la Fase 1b (docs/SECURITY6_CIFRADO_PLAN.md).
    if (data.documento) {
      await vigilarCifradoDeDocumento(supabase, [inserted.id], "alta");
    }

    return { id: inserted.id };
  });

type SupabaseCtx = SupabaseClient<Database>;
type PatientPatch = Database["public"]["Tables"]["patients"]["Update"];

/**
 * Une los dos escritores de campos generales de `patients` que editaban la
 * misma fila por separado (progresivo #3, plan Carlos 05-sep-2026):
 * `updatePatient` acá y `setPatientAgreement` en clinic-finance.functions.ts.
 * Fuerza `clinicId` en el `.eq()` como cinturón de seguridad en las dos
 * rutas (RLS ya cubre, pero defensa en profundidad — mismo criterio que el
 * resto del repo).
 *
 * No cubre los `.update()` de un solo campo que ya tenían su propio dueño
 * narrow (opt-in de WhatsApp en messaging.functions.ts, revocación de
 * portal en portal.functions.ts, opt-out por webhook en
 * api.whatsapp-webhook.ts vía supabaseAdmin) — consolidarlos exigiría
 * generalizar esto para service_role además de JWT de usuario, y no es lo
 * que este ítem del plan pedía resolver.
 */
export async function writePatientFields(
  supabase: SupabaseCtx,
  clinicId: string,
  patientId: string,
  patch: PatientPatch,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase
    .from("patients")
    .update(patch)
    .eq("id", patientId)
    .eq("clinic_id", clinicId);
  return { error };
}

/**
 * Editar los datos básicos de una ficha (diálogo "Editar datos"). La lógica
 * vive en `actualizarPaciente` (editar-paciente.server.ts): permiso
 * `patients:manage`, ficha de esta clínica, teléfono en E.164 y verificación
 * de que el UPDATE realmente escribió.
 */
export const updatePatient = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({ clinicId: z.string().uuid(), patientId: z.string().uuid() })
      .merge(CAMPOS_EDITABLES_DEL_PACIENTE)
      .parse(input),
  )
  .handler(({ data, context }): Promise<{ ok: true }> =>
    actualizarPaciente(context.supabase, context.userId, data),
  );

/**
 * Archiva o restaura una ficha (LEG-08 / CLI-05). Reemplaza al borrado: la
 * historia clínica se conserva por ley y la ficha solo sale de los listados.
 * Quién puede (owner/admin), la fecha y el actor los resuelve la base en el
 * trigger `patients_controlar_archivo`; acá solo se pide el cambio.
 */
export const setPatientArchived = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        archivar: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: fila, error } = await context.supabase
      .from("patients")
      .update({ archived_at: data.archivar ? new Date().toISOString() : null })
      .eq("id", data.patientId)
      .eq("clinic_id", data.clinicId)
      .select("id")
      .maybeSingle();
    if (error)
      throw new Error(
        mensajeDb(
          error,
          data.archivar
            ? "No tienes permisos para archivar esta ficha."
            : "No tienes permisos para restaurar esta ficha.",
        ),
      );
    if (!fila) throw new Error("No tienes permisos para cambiar el archivo de esta ficha.");
    return { ok: true };
  });
