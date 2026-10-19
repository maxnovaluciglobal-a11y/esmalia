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
import { vigilarCifradoDeDocumento } from "@/lib/patients/documento-cifrado.server";
import { validatePhoneNumber } from "@/lib/patients/phoneValidation";
import { toE164 } from "@/lib/messaging/telefonos";
import { FILTROS_DE_ARCHIVO } from "@/lib/patients/archivo";
import type { Database } from "@/integrations/supabase/types";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

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
  };
}

const PATIENT_COLUMNS =
  "id, full_name, document_id, birth_date, phone, phone_valid, email, branch_id, primary_professional_id, status, tags, avatar_url, balance_cents, no_show_risk, ai_summary, wa_opt_in, referral_code, agreement_id, agreement_member_id, archived_at";

/**
 * Tope de fila del listado — red de seguridad, no la estrategia de paginado
 * real (el filtro de "última visita" es un campo calculado vía RPC, no una
 * columna directa, así que paginar server-side de verdad implicaría mover
 * ese filtro a la RPC también; con el volumen actual no se justifica).
 * `truncated` le avisa a la UI que hay más pacientes de los que se trajeron,
 * en vez de fallar en silencio (ver auditoría de arquitectura 2026-08-15).
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ items: Paciente[]; truncated: boolean }> => {
    const { supabase } = context;

    let consulta = supabase.from("patients").select(PATIENT_COLUMNS).eq("clinic_id", data.clinicId);
    if (data.archivo === "activas") consulta = consulta.is("archived_at", null);
    else if (data.archivo === "archivadas") consulta = consulta.not("archived_at", "is", null);

    const [{ data: rows, error }, { data: apptRows, error: apptError }] = await Promise.all([
      consulta.order("full_name", { ascending: true }).limit(PATIENTS_ROW_LIMIT),
      supabase.rpc("list_patients_with_last_and_next_appointment", {
        p_clinic_id: data.clinicId,
      }),
    ]);

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar la lista de pacientes."));
    if (apptError)
      throw new Error(
        mensajeDb(apptError, "No pudimos cargar la información de citas de los pacientes."),
      );
    const truncated = (rows ?? []).length >= PATIENTS_ROW_LIMIT;

    type ApptSummary = {
      patient_id: string;
      last_appointment_at: string | null;
      next_appointment_at: string | null;
    };
    const summaryByPatient = new Map<string, ApptSummary>(
      (apptRows ?? []).map((r) => [(r as ApptSummary).patient_id, r as ApptSummary]),
    );

    const items = (rows ?? []).map((row) => {
      const s = summaryByPatient.get(row.id);
      return mapPatientRow(row as PatientRow, {
        ultimaVisita: s?.last_appointment_at
          ? formatoFecha(s.last_appointment_at.slice(0, 10))
          : "Sin visitas",
        ultimaVisitaISO: s?.last_appointment_at ? s.last_appointment_at.slice(0, 10) : "",
        proximoControl: s?.next_appointment_at
          ? formatoFecha(s.next_appointment_at.slice(0, 10))
          : null,
      });
    });
    return { items, truncated };
  });

/**
 * Auditoría de código 01-sep-2026: esta regla (total facturado en
 * treatment_items —lo que le toca al paciente cuando hay convenio—,
 * excluyendo planes cancelled, menos total pagado en
 * payments) estaba reimplementada por separado acá y en
 * `listPendingOutreach` (messaging.functions.ts) — confirmado que hoy
 * coinciden exactamente (mismos filtros) antes de unificar, no había bug
 * activo, pero cualquier cambio futuro a la regla tenía que acordarse de
 * tocar los dos lugares. Sin `patientId` trae la clínica entera agrupada
 * por paciente (para el aviso de payment_due); con `patientId` la acota a
 * uno solo.
 */
export async function fetchPatientBalances(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  patientId?: string,
): Promise<Map<string, { billedCents: number; paidCents: number }>> {
  let billedQuery = supabase
    .from("treatment_items")
    // `patient_cents` viene del reparto con el convenio (Tanda B): cuando hay
    // convenio, lo que el paciente debe NO es el precio de la línea. Se traen
    // las dos y abajo se prefiere `patient_cents` cuando no es NULL.
    .select("price_cents, patient_cents, treatment_plans!inner(patient_id, clinic_id, status)")
    .eq("clinic_id", clinicId)
    .neq("treatment_plans.status", "cancelled");
  let paidQuery = supabase
    .from("payments")
    .select("patient_id, amount_cents")
    .eq("clinic_id", clinicId)
    // Un pago reversado no pagó nada: si se sumara, el saldo del paciente
    // quedaría más bajo de lo real (o hasta a favor) por un cobro deshecho.
    .is("reversed_at", null);
  if (patientId) {
    billedQuery = billedQuery.eq("treatment_plans.patient_id", patientId);
    paidQuery = paidQuery.eq("patient_id", patientId);
  }

  const [{ data: billedRows, error: billedErr }, { data: paidRows, error: paidErr }] =
    await Promise.all([billedQuery, paidQuery]);
  if (billedErr)
    throw new Error(mensajeDb(billedErr, "No pudimos calcular el saldo del paciente."));
  if (paidErr) throw new Error(mensajeDb(paidErr, "No pudimos calcular el saldo del paciente."));

  const byPatient = new Map<string, { billedCents: number; paidCents: number }>();
  for (const r of billedRows ?? []) {
    const pid = (r as unknown as { treatment_plans: { patient_id: string } }).treatment_plans
      .patient_id;
    const cur = byPatient.get(pid) ?? { billedCents: 0, paidCents: 0 };
    const fila = r as { price_cents: number; patient_cents: number | null };
    // `?? price_cents` y no `|| price_cents`: un `patient_cents` de 0 es un
    // valor real (el convenio cubre el 100 %) y tiene que quedar en cero, no
    // caer al precio de lista y hacerle deber al paciente algo que no debe.
    cur.billedCents += fila.patient_cents ?? fila.price_cents ?? 0;
    byPatient.set(pid, cur);
  }
  for (const r of paidRows ?? []) {
    const cur = byPatient.get(r.patient_id) ?? { billedCents: 0, paidCents: 0 };
    cur.paidCents += r.amount_cents ?? 0;
    byPatient.set(r.patient_id, cur);
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase } = context;

    const telefono = telefonoParaGuardar(
      data.telefono,
      await paisDeLaClinica(supabase, data.clinicId),
    );
    const phoneValid = await validatePhoneNumber(telefono);

    const { data: inserted, error } = await supabase
      .from("patients")
      .insert({
        clinic_id: data.clinicId,
        full_name: data.nombre,
        document_id: data.documento || null,
        birth_date: data.fechaNacimiento,
        phone: telefono,
        phone_valid: phoneValid,
        email: data.email || null,
        branch_id: data.sucursalId ?? null,
        primary_professional_id: data.profesionalId ?? null,
        tags: data.etiquetas,
        status: UI_STATUS_TO_DB[data.estado],
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

const IMPORT_CHUNK_SIZE = 100;

export interface ImportPatientsResult {
  created: number;
  skipped: number;
  warnings: { row: number; nombre: string; message: string }[];
  errors: { chunkFrom: number; chunkTo: number; message: string }[];
}

const IMPORT_ROW_SCHEMA = z.object({
  nombre: z.string().trim().min(1).max(200),
  documento: z.string().trim().optional(),
  fechaNacimiento: z.string().trim().optional(),
  telefono: z.string().trim().optional(),
  email: z.string().trim().optional(),
});

export interface ImportPreviewRow {
  row: number;
  nombre: string;
  documento: string | null;
  /** `create` = fila nueva. `skip_duplicate` = ya existe (en la DB o repetida
   * en el mismo archivo) y el importador real la va a saltar igual. */
  action: "create" | "skip_duplicate";
  warning: string | null;
}

/**
 * Vista previa de la importación (regla de la casa: mostrar antes de que se
 * confirme, no confirmar y esperar que salga bien). Corre EXACTAMENTE la
 * misma clasificación que `importPatients` — mismo chequeo de duplicados
 * contra la DB y dentro del archivo, misma validación de fecha de
 * nacimiento — pero no escribe nada. Gap de la auditoría comparativa vs.
 * SuperClini (22-sep-2026): antes de esto, la única forma de saber qué iba a
 * pasar con un CSV era importarlo y mirar el resultado.
 *
 * Deliberadamente NO se factorizó la clasificación en un helper compartido
 * con `importPatients`: son ~15 líneas casi idénticas, y separar la lectura
 * (esta función) de la escritura (esa) dijo más sobre el riesgo real —tocar
 * el importador que ya está en producción para extraer un helper compartido—
 * que ahorrar la duplicación.
 */
export const previewImportPatients = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        rows: z.array(IMPORT_ROW_SCHEMA).min(1).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ImportPreviewRow[]> => {
    const { supabase } = context;

    const documentos = [
      ...new Set(data.rows.map((r) => r.documento?.trim()).filter((d): d is string => Boolean(d))),
    ];
    const { data: existentes, error: exError } = await supabase
      .from("patients")
      .select("document_id")
      .eq("clinic_id", data.clinicId)
      .in("document_id", documentos.length ? documentos : [""]);
    if (exError)
      throw new Error(
        mensajeDb(exError, "No pudimos verificar los pacientes existentes antes de importar."),
      );
    const yaExisten = new Set((existentes ?? []).map((e) => e.document_id));
    const vistosEnEsteLote = new Set<string>();

    return data.rows.map((r, i) => {
      const doc = r.documento?.trim() || null;
      if (doc && (yaExisten.has(doc) || vistosEnEsteLote.has(doc))) {
        return {
          row: i + 1,
          nombre: r.nombre,
          documento: doc,
          action: "skip_duplicate",
          warning: null,
        };
      }
      if (doc) vistosEnEsteLote.add(doc);

      let warning: string | null = null;
      if (r.fechaNacimiento) {
        const d = new Date(r.fechaNacimiento);
        const valida = !Number.isNaN(d.getTime()) && d <= new Date() && d >= new Date("1900-01-01");
        if (!valida) warning = "Fecha de nacimiento inválida — se va a importar sin ella.";
      }

      return { row: i + 1, nombre: r.nombre, documento: doc, action: "create", warning };
    });
  });

/**
 * Importador CSV de pacientes — palanca de adquisición para migrar desde
 * Excel/Dentalink sin cargar a mano. El CSV se parsea en el cliente
 * (papaparse); acá solo se validan y se insertan las filas ya parseadas.
 *
 * A diferencia de createPatient, fechaNacimiento es OPCIONAL: los export
 * de otros sistemas casi nunca la tienen completa para el 100% de los
 * pacientes, y birth_date ya es nullable en el schema — exigirla acá
 * tiraría filas válidas por una razón que no es de seguridad ni de datos
 * críticos (calcularEdad ya maneja null).
 *
 * Solo importa pacientes — citas queda deliberadamente fuera de esta
 * pasada: matchear profesional/sucursal/fecha desde un CSV externo sin
 * ningún control de formato es un problema bastante más grande y con
 * mucho más riesgo de dejar datos mal cargados.
 */
export const importPatients = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        rows: z
          .array(
            z.object({
              nombre: z.string().trim().min(1).max(200),
              documento: z.string().trim().optional(),
              fechaNacimiento: z.string().trim().optional(),
              telefono: z.string().trim().optional(),
              email: z.string().trim().optional(),
            }),
          )
          .min(1)
          .max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ImportPatientsResult> => {
    const { supabase, userId } = context;

    const documentos = [
      ...new Set(data.rows.map((r) => r.documento?.trim()).filter((d): d is string => Boolean(d))),
    ];
    const { data: existentes, error: exError } = await supabase
      .from("patients")
      .select("document_id")
      .eq("clinic_id", data.clinicId)
      .in("document_id", documentos.length ? documentos : [""]);
    if (exError)
      throw new Error(
        mensajeDb(exError, "No pudimos verificar los pacientes existentes antes de importar."),
      );
    const yaExisten = new Set((existentes ?? []).map((e) => e.document_id));

    const pais = await paisDeLaClinica(supabase, data.clinicId);
    const warnings: ImportPatientsResult["warnings"] = [];
    let skipped = 0;
    const vistosEnEsteLote = new Set<string>();

    const paraInsertar = data.rows.flatMap((r, i) => {
      const doc = r.documento?.trim() || null;
      // Duplicado contra la DB o repetido dos veces en el mismo CSV.
      if (doc && (yaExisten.has(doc) || vistosEnEsteLote.has(doc))) {
        skipped += 1;
        return [];
      }
      if (doc) vistosEnEsteLote.add(doc);

      let birthDate: string | null = null;
      if (r.fechaNacimiento) {
        const d = new Date(r.fechaNacimiento);
        const valida = !Number.isNaN(d.getTime()) && d <= new Date() && d >= new Date("1900-01-01");
        if (valida) {
          birthDate = r.fechaNacimiento.slice(0, 10);
        } else {
          warnings.push({
            row: i + 1,
            nombre: r.nombre,
            message: "Fecha de nacimiento inválida — se importó sin ella.",
          });
        }
      }

      return [
        {
          clinic_id: data.clinicId,
          full_name: r.nombre,
          document_id: doc,
          birth_date: birthDate,
          phone: telefonoParaGuardar(r.telefono, pais),
          email: r.email || null,
          status: "new" as const,
          created_by: userId,
        },
      ];
    });

    let created = 0;
    const errors: ImportPatientsResult["errors"] = [];
    for (let i = 0; i < paraInsertar.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = paraInsertar.slice(i, i + IMPORT_CHUNK_SIZE);
      const { data: insertedRows, error: insError } = await supabase
        .from("patients")
        .insert(chunk)
        .select("id, document_id");
      if (insError) {
        errors.push({
          chunkFrom: i + 1,
          chunkTo: i + chunk.length,
          message: insError.message,
        });
      } else {
        created += chunk.length;
        // SEG-03: mismo criterio que createPatient — el trigger cifra cada
        // fila al insertarla; acá se verifica el lote entero en una sola
        // consulta (antes eran hasta 100 RPC por chunk) y se avisa a Sentry
        // si alguna quedó en claro.
        const conDocumento = (insertedRows ?? []).filter((r) => r.document_id).map((r) => r.id);
        await vigilarCifradoDeDocumento(supabase, conDocumento, "importacion");
      }
    }

    return { created, skipped, warnings, errors };
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

export const updatePatient = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientId: z.string().uuid(),
        nombre: z.string().trim().min(1).max(200).optional(),
        documento: z.string().trim().optional(),
        telefono: z.string().trim().optional(),
        email: z.string().trim().email().optional().or(z.literal("")),
        sucursalId: z.string().uuid().optional(),
        profesionalId: z.string().uuid().optional(),
        etiquetas: z.array(z.string()).optional(),
        estado: z.enum(["activo", "nuevo", "inactivo"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { clinicId, patientId, ...rest } = data;

    // Solo re-valida contra Numverify si el teléfono realmente cambió — no
    // gastar cuota de nuevo en cada edición que no toca ese campo.
    let phoneValid: boolean | null | undefined;
    let nextPhone: string | null = null;
    if (rest.telefono !== undefined) {
      const [{ data: current }, pais] = await Promise.all([
        supabase.from("patients").select("phone, phone_valid").eq("id", patientId).single(),
        paisDeLaClinica(supabase, clinicId),
      ]);
      nextPhone = telefonoParaGuardar(rest.telefono, pais);
      phoneValid =
        current && nextPhone === current.phone
          ? current.phone_valid
          : await validatePhoneNumber(nextPhone);
    }

    const patch = {
      ...(rest.nombre !== undefined && { full_name: rest.nombre }),
      ...(rest.documento !== undefined && { document_id: rest.documento || null }),
      ...(rest.telefono !== undefined && { phone: nextPhone, phone_valid: phoneValid }),
      ...(rest.email !== undefined && { email: rest.email || null }),
      ...(rest.sucursalId !== undefined && { branch_id: rest.sucursalId }),
      ...(rest.profesionalId !== undefined && { primary_professional_id: rest.profesionalId }),
      ...(rest.etiquetas !== undefined && { tags: rest.etiquetas }),
      ...(rest.estado !== undefined && { status: UI_STATUS_TO_DB[rest.estado] }),
    };

    const { error } = await writePatientFields(supabase, clinicId, patientId, patch);
    if (error) throw new Error("No tienes permisos para editar este paciente.");

    // SEG-03: el trigger recifra (o limpia) el documento cuando cambia;
    // acá solo se verifica, ver createPatient.
    if (rest.documento !== undefined) {
      await vigilarCifradoDeDocumento(supabase, [patientId], "edicion");
    }

    return { ok: true };
  });

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
