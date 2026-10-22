import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { HORA_INICIO, type Cita, type EstadoCita } from "@/lib/clinic-operations/clinic-data";
import { mensajeDb } from "@/lib/db-errors";
import { filaYaCreada } from "@/lib/idempotency";
import { fetchPatientBalances } from "@/lib/patients/patients.functions";
import { enBloques, leerTodasLasPaginas, mapConLimite } from "@/lib/paginacion";
import { requireFinanceViewRole } from "@/lib/finance/finance-reports.functions";
import type { Database } from "@/integrations/supabase/types";
import { requireEscritura, requireEscrituraPorFila } from "@/lib/solo-lectura.middleware";

const DEFAULT_TIMEZONE = "America/Santiago";

const DIA_SEMANA_CORTO: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
const DIA_SEMANA_LABEL: Record<number, string> = {
  0: "domingo",
  1: "lunes",
  2: "martes",
  3: "miércoles",
  4: "jueves",
  5: "viernes",
  6: "sábado",
};

/** Día de la semana (0=domingo…6=sábado, igual que Date.getDay()) según lo
 * percibe la timezone dada, no la del server — una cita a las 23:30 en
 * Santiago puede caer en otro día calendario en UTC. */
function diaSemanaLocal(date: Date, timeZone: string): number {
  const corto = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return DIA_SEMANA_CORTO[corto] ?? date.getUTCDay();
}

/** Hora local "HH:MM" del instante, en la timezone dada. */
function horaLocalHHMM(date: Date, timeZone: string): string {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const h = partes.find((p) => p.type === "hour")?.value ?? "00";
  const m = partes.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

type AppointmentRow = {
  id: string;
  patient_id: string;
  professional_id: string;
  branch_id: string;
  treatment_label: string;
  starts_at: string;
  ends_at: string;
  status: string;
  is_priority: boolean;
  patient_confirmed_at: string | null;
};

function fechaLocal(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function minutosDesdeInicio(iso: string, timeZone: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(partes.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(partes.find((p) => p.type === "minute")?.value ?? "0");
  return (h - HORA_INICIO) * 60 + m;
}

function mapAppointmentRow(row: AppointmentRow, pacienteNombre: string, timeZone: string): Cita {
  const duracion = Math.round(
    (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60_000,
  );
  return {
    id: row.id,
    pacienteId: row.patient_id,
    paciente: pacienteNombre,
    tratamiento: row.treatment_label || "Consulta",
    profesionalId: row.professional_id,
    sucursalId: row.branch_id,
    fecha: fechaLocal(row.starts_at, timeZone),
    inicio: minutosDesdeInicio(row.starts_at, timeZone),
    duracion,
    estado: row.status as EstadoCita,
    prioridad: row.is_priority || undefined,
    pacienteConfirmo: row.patient_confirmed_at ? true : undefined,
  };
}

const APPOINTMENT_COLUMNS =
  "id, patient_id, professional_id, branch_id, treatment_label, starts_at, ends_at, status, is_priority, patient_confirmed_at";

/**
 * Tope de fila del listado. El filtro de fecha lo sigue aplicando la UI (así
 * "Todas las fechas" sigue andando), así que esto es una red de seguridad,
 * no la estrategia de paginado real — con miles de citas/año, `truncated`
 * le avisa a la UI que hay más datos de los que se trajeron, en vez de
 * fallar en silencio como antes (ver auditoría de arquitectura 2026-08-15).
 *
 * Se lee de a páginas de 1000 con `.range()`: con un solo `.limit(10000)`
 * PostgREST devolvía 1000 filas (`max_rows`), la agenda perdía citas y
 * `truncated` nunca se encendía (auditoría de rendimiento, 20-oct-2026).
 */
const APPOINTMENTS_ROW_LIMIT = 10_000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convierte un rango de fechas calendario (opcional en cada punta) en los
 * límites UTC para filtrar `starts_at`, con 1 día de padding a cada lado.
 * Separado de `listAppointments` para poder testear el padding sin
 * necesitar Supabase real — es la parte con más riesgo de un off-by-one.
 */
export function appointmentDateRangeToUtcBounds(
  desde?: string,
  hasta?: string,
): { gte?: string; lt?: string } {
  const bounds: { gte?: string; lt?: string } = {};
  if (desde) {
    const desdeUtc = new Date(`${desde}T00:00:00Z`);
    desdeUtc.setUTCDate(desdeUtc.getUTCDate() - 1);
    bounds.gte = desdeUtc.toISOString();
  }
  if (hasta) {
    const hastaUtc = new Date(`${hasta}T00:00:00Z`);
    hastaUtc.setUTCDate(hastaUtc.getUTCDate() + 2);
    bounds.lt = hastaUtc.toISOString();
  }
  return bounds;
}

/**
 * Citas de la clínica (excluye canceladas).
 *
 * Auditoría de código 01-sep-2026: `desde`/`hasta` son OPCIONALES a
 * propósito — sin ellos el comportamiento es idéntico al de siempre (fetch
 * completo, mismo tope de `APPOINTMENTS_ROW_LIMIT`). agenda.tsx tiene un
 * modo "todas las fechas" que necesita de verdad el fetch sin acotar, así
 * que NO se le cambió el call site; solo dashboard.tsx (que siempre quiere
 * una ventana corta) pasa el filtro. El padding de 1 día a cada lado en UTC
 * es a propósito generoso (cubre cualquier offset real de timezone, hasta
 * ±14h): esto filtra ANTES de saber a qué sucursal pertenece cada fila, y
 * una clínica puede tener sucursales en timezones distintas — mejor traer
 * un puñado de filas de más que cortar mal el borde para alguna sucursal.
 */
export const listAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        desde: z.string().regex(ISO_DATE, "Formato de fecha inválido.").optional(),
        hasta: z.string().regex(ISO_DATE, "Formato de fecha inválido.").optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ items: Cita[]; truncated: boolean }> => {
    const { supabase } = context;

    const bounds = appointmentDateRangeToUtcBounds(data.desde, data.hasta);
    const consultaCitas = () => {
      let query = supabase
        .from("appointments")
        .select(APPOINTMENT_COLUMNS)
        .eq("clinic_id", data.clinicId)
        .neq("status", "cancelada");
      if (bounds.gte) query = query.gte("starts_at", bounds.gte);
      if (bounds.lt) query = query.lt("starts_at", bounds.lt);
      return query;
    };

    const {
      filas: rows,
      truncado: truncated,
      error,
    } = await leerTodasLasPaginas(
      (desde, hasta) =>
        consultaCitas()
          // Descendente a propósito: si el tope de fila corta la lista, que se
          // pierda historial viejo y no la agenda futura (ver auditoría
          // architecture-6). Los consumidores (agenda.tsx, dashboard.tsx)
          // vuelven a ordenar ascendente por fecha/hora antes de mostrar, así
          // que este orden crudo no les afecta. `id` desempata entre páginas.
          .order("starts_at", { ascending: false })
          .order("id", { ascending: true })
          .range(desde, hasta),
      { tope: APPOINTMENTS_ROW_LIMIT },
    );

    if (error) throw new Error(mensajeDb(error, "No pudimos cargar las citas de la clínica."));

    const appointments = rows as AppointmentRow[];
    const patientIds = [...new Set(appointments.map((a) => a.patient_id))];
    const branchIds = [...new Set(appointments.map((a) => a.branch_id))];

    // De a bloques: miles de ids en un solo `.in()` no entran en la URL.
    const [bloquesPacientes, { data: branches, error: branchError }] = await Promise.all([
      mapConLimite(enBloques(patientIds), 4, (ids) =>
        supabase.from("patients").select("id, full_name").in("id", ids),
      ),
      supabase
        .from("branches")
        .select("id, timezone")
        .in("id", branchIds.length ? branchIds : [""]),
    ]);
    const patError = bloquesPacientes.find((b) => b.error)?.error;
    const patients = bloquesPacientes.flatMap((b) => b.data ?? []);
    if (patError)
      throw new Error(mensajeDb(patError, "No pudimos cargar los datos de los pacientes."));
    if (branchError)
      throw new Error(mensajeDb(branchError, "No pudimos cargar los datos de las sucursales."));

    const nameByPatient = new Map(patients.map((p) => [p.id, p.full_name]));
    const tzByBranch = new Map((branches ?? []).map((b) => [b.id, b.timezone]));

    return {
      items: appointments.map((row) =>
        mapAppointmentRow(
          row,
          nameByPatient.get(row.patient_id) ?? "Paciente",
          tzByBranch.get(row.branch_id) || DEFAULT_TIMEZONE,
        ),
      ),
      truncated,
    };
  });

/**
 * Interpreta un wall-clock local "YYYY-MM-DDTHH:mm[:ss]" (formato del
 * <input type="datetime-local">) como ese mismo instante en la timezone
 * dada y devuelve el Date en UTC. Sin luxon: usa Intl.DateTimeFormat
 * para descubrir el offset UTC en esa fecha concreta (respeta DST).
 */
export function wallTimeInTzToUtc(localIso: string, timeZone: string): Date {
  const normalized = localIso.length === 16 ? localIso + ":00" : localIso;
  // Interpretar el string como si fuera UTC → medir cuánto se aleja al
  // renderizarlo en la timezone objetivo. El delta es el offset.
  const asUtc = new Date(normalized + "Z");
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(asUtc).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = asIfUtc - asUtc.getTime();
  return new Date(asUtc.getTime() - offsetMs);
}

/** Aviso de doble-booking devuelto al front — no bloquea, solo informa. */
export type Solapamiento = { treatmentLabel: string; startsAt: string; endsAt: string };

/**
 * Auditoría de código 01-sep-2026: createAppointment y updateAppointment
 * traían este bloque duplicado casi carácter por carácter (timezone de la
 * sucursal, bloqueo duro contra professional_schedules, aviso soft de
 * solapamiento). Único diff real entre las dos copias: updateAppointment
 * excluye la propia cita del choque de solapamiento (no puede "chocar
 * consigo misma" al reprogramarse) — de ahí `excludeAppointmentId`.
 */
/**
 * ¿La cita [inicio, fin] (en "HH:MM" de pared) entra entera en alguno de los
 * bloques del día? Bloques que se tocan (09–13 y 13–18) cuentan como uno.
 * Exportada para el test: es la regla de la colación.
 */
export function citaCabeEnBloques(
  inicio: string,
  fin: string,
  bloques: { inicio: string; fin: string }[],
): boolean {
  const ordenados = [...bloques].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const unidos: { inicio: string; fin: string }[] = [];
  for (const b of ordenados) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && b.inicio <= ultimo.fin) {
      if (b.fin > ultimo.fin) ultimo.fin = b.fin;
    } else unidos.push({ ...b });
  }
  return unidos.some((b) => inicio >= b.inicio && fin <= b.fin);
}

export async function validarHorarioYSolapamiento(
  supabase: SupabaseClient<Database>,
  params: {
    clinicId: string;
    branchId: string;
    professionalId: string;
    /** Valor crudo del <input type="datetime-local">, wall-clock de la sucursal. */
    startsAtRaw: string;
    duracionMin: number;
    /** Al reprogramar, la cita no debe chocar consigo misma. */
    excludeAppointmentId?: string;
  },
): Promise<{ startsAt: Date; endsAt: Date; solapamiento?: Solapamiento }> {
  const { data: branch, error: branchErr } = await supabase
    .from("branches")
    .select("timezone")
    .eq("clinic_id", params.clinicId)
    .eq("id", params.branchId)
    .maybeSingle();
  if (branchErr) throw new Error(mensajeDb(branchErr, "No pudimos verificar la sucursal."));
  if (!branch) throw new Error("La sucursal no existe o no es tuya.");
  const timeZone = branch.timezone || DEFAULT_TIMEZONE;

  const startsAt = wallTimeInTzToUtc(params.startsAtRaw, timeZone);
  if (Number.isNaN(startsAt.getTime())) throw new Error("Fecha/hora de inicio inválida.");
  const endsAt = new Date(startsAt.getTime() + params.duracionMin * 60_000);

  // Bloqueo DURO (a diferencia del aviso soft de solapamiento de más abajo)
  // contra el horario declarado del profesional en /profesionales. Un
  // profesional SIN ninguna fila en professional_schedules no tiene
  // restricción declarada — no cambia nada para las clínicas que todavía no
  // cargaron horarios (compatibilidad hacia atrás total). Si SÍ tiene al
  // menos un día declarado, agendar fuera de eso es un error de operador
  // prevenible, no una decisión legítima de clínica como sí puede serlo un
  // doble-booking (cubrir un turno, urgencia).
  const { data: horarios, error: horariosErr } = await supabase
    .from("professional_schedules")
    .select("day_of_week, start_time, end_time")
    .eq("clinic_id", params.clinicId)
    .eq("professional_id", params.professionalId);
  if (horariosErr)
    throw new Error(mensajeDb(horariosErr, "No pudimos verificar el horario del profesional."));

  if (horarios && horarios.length > 0) {
    const dia = diaSemanaLocal(startsAt, timeZone);
    // Un día puede tener más de un bloque (mañana y tarde): entre los dos
    // está la colación. Antes se miraba solo el primero y una cita de la
    // tarde quedaba "fuera del horario" (arrastre de la agenda, PR 10).
    const bloquesDia = horarios
      .filter((h) => h.day_of_week === dia)
      .map((h) => ({ inicio: h.start_time.slice(0, 5), fin: h.end_time.slice(0, 5) }))
      .sort((a, b) => a.inicio.localeCompare(b.inicio));
    if (bloquesDia.length === 0) {
      throw new Error(`El profesional no atiende los ${DIA_SEMANA_LABEL[dia]}.`);
    }
    const horaInicio = horaLocalHHMM(startsAt, timeZone);
    const horaFin = horaLocalHHMM(endsAt, timeZone);
    if (!citaCabeEnBloques(horaInicio, horaFin, bloquesDia)) {
      throw new Error(
        `Fuera del horario del profesional los ${DIA_SEMANA_LABEL[dia]} ` +
          `(${bloquesDia.map((b) => `${b.inicio}–${b.fin}`).join(" y ")}).`,
      );
    }
  }

  // Aviso SOFT de doble-booking, no bloqueo duro (mismo criterio que Open
  // Dental): dos citas del mismo profesional cuyos rangos se cruzan. No
  // usamos operatory_id como unidad de colisión porque el box es opcional
  // (se elige desde la Ola 1, pero la mayoría de las citas no lo trae) —
  // professional_id es la unidad real hoy. Corre ANTES del insert para no tener que revertir nada.
  // Importa más ahora que la app es offline-first: dos recepcionistas
  // pueden estar cargando en paralelo sin verse.
  // `starts_at < endsAt AND ends_at > startsAt` es la condición estándar de
  // solapamiento de intervalos — la evalúa la propia query, no hace falta
  // traer candidatas y filtrar en JS.
  let choqueQuery = supabase
    .from("appointments")
    .select("treatment_label, starts_at, ends_at")
    .eq("clinic_id", params.clinicId)
    .eq("professional_id", params.professionalId)
    .neq("status", "cancelada")
    .lt("starts_at", endsAt.toISOString())
    .gt("ends_at", startsAt.toISOString());
  if (params.excludeAppointmentId) {
    choqueQuery = choqueQuery.neq("id", params.excludeAppointmentId);
  }
  const { data: choques, error: choquesErr } = await choqueQuery.limit(1);
  if (choquesErr)
    throw new Error(mensajeDb(choquesErr, "No pudimos verificar si hay otra cita en ese horario."));
  const choque = choques?.[0];
  const solapamiento: Solapamiento | undefined = choque
    ? {
        treatmentLabel: choque.treatment_label || "Consulta",
        startsAt: choque.starts_at,
        endsAt: choque.ends_at,
      }
    : undefined;

  return { startsAt, endsAt, solapamiento };
}

/**
 * Campos del formulario de cita de la Ola 1 (AGE-11, AGE-14, AGE-15). Son
 * opcionales: la cola sin conexión puede traer citas capturadas con una
 * versión anterior de la app, sin ellos. En la edición, ausente = no tocar.
 */
const camposOla1 = {
  /** Tipo de cita del catálogo de la clínica. El nombre lo copia la base (snapshot). */
  appointmentTypeId: z.string().uuid().nullish(),
  /** Box de la sucursal de la cita. */
  operatoryId: z.string().uuid().nullish(),
  /** Observaciones internas: solo las ve el equipo, nunca el paciente. */
  notas: z.string().trim().max(1000).nullish(),
};

/**
 * El box tiene que ser de la sucursal de la cita (y estar activo). La FK sola
 * no lo garantiza: aceptaría un box de otra sede o de otra clínica.
 */
async function validarBox(
  supabase: SupabaseClient<Database>,
  params: { clinicId: string; branchId: string; operatoryId: string },
): Promise<void> {
  const { data: box, error } = await supabase
    .from("operatories")
    .select("id")
    .eq("clinic_id", params.clinicId)
    .eq("branch_id", params.branchId)
    .eq("id", params.operatoryId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(mensajeDb(error, "No pudimos verificar el box."));
  if (!box) throw new Error("El box no es de la sucursal elegida.");
}

export const createAppointment = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        // Lo genera el cliente cuando la cita se capturó sin conexión, para
        // que reintentar la cola no cree la misma cita dos veces (ver el
        // manejo de 23505 más abajo). Online no se manda y lo pone la DB.
        id: z.string().uuid().optional(),
        clinicId: z.string().uuid(),
        branchId: z.string().uuid(),
        patientId: z.string().uuid(),
        professionalId: z.string().uuid(),
        tratamiento: z.string().trim().min(1, "Indica el tratamiento o motivo."),
        // Opcional: si el texto coincide con un procedimiento del catálogo de
        // Finanzas, el cliente manda su id acá. No reemplaza el texto libre
        // (sigue siendo válido "Control", "Urgencia", etc. sin catálogo).
        procedureId: z.string().uuid().optional(),
        // Valor crudo del <input type="datetime-local"> ("YYYY-MM-DDTHH:mm").
        // Se interpreta como wall-clock EN LA TIMEZONE DE LA SUCURSAL, no del
        // servidor. En Vercel el server corre en UTC — sin este fix las citas
        // creadas por recepción en Santiago quedaban corridas 3-4 hrs.
        startsAt: z.string().min(1, "Falta la fecha y hora de inicio."),
        duracionMin: z.number().int().min(5).max(480),
        prioridad: z.boolean().optional(),
        ...camposOla1,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string; solapamiento?: Solapamiento }> => {
    const { startsAt, endsAt, solapamiento } = await validarHorarioYSolapamiento(context.supabase, {
      clinicId: data.clinicId,
      branchId: data.branchId,
      professionalId: data.professionalId,
      startsAtRaw: data.startsAt,
      duracionMin: data.duracionMin,
    });
    if (data.operatoryId) {
      await validarBox(context.supabase, {
        clinicId: data.clinicId,
        branchId: data.branchId,
        operatoryId: data.operatoryId,
      });
    }

    const { data: inserted, error } = await context.supabase
      .from("appointments")
      .insert({
        ...(data.id ? { id: data.id } : {}),
        clinic_id: data.clinicId,
        branch_id: data.branchId,
        patient_id: data.patientId,
        professional_id: data.professionalId,
        treatment_label: data.tratamiento,
        procedure_id: data.procedureId ?? null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        is_priority: data.prioridad ?? false,
        appointment_type_id: data.appointmentTypeId ?? null,
        operatory_id: data.operatoryId ?? null,
        notes: data.notas || null,
      })
      .select("id")
      .single();

    if (error) {
      const yaEstaba = await filaYaCreada(
        context.supabase,
        "appointments",
        data.id,
        data.clinicId,
        error,
      );
      if (yaEstaba) return { id: yaEstaba };
      throw new Error("No pudimos crear la cita. " + error.message);
    }
    // Activación (docs/MEDICION.md): si es la primera cita de la clínica.
    // Nunca lanza.
    const { registrarPrimeraCitaSiCorresponde } =
      await import("@/lib/marketing/eventos-servidor.server");
    await registrarPrimeraCitaSiCorresponde({
      supabase: context.supabase,
      clinicId: data.clinicId,
      userId: context.userId,
      origen: "manual",
    });
    return { id: inserted.id, solapamiento };
  });

/**
 * Reprograma una cita existente (profesional, tratamiento, fecha/hora,
 * duración) sin pasar por cancelar+recrear. Antes la única forma de mover
 * una cita era cancelarla y agendar una nueva desde cero, perdiendo el
 * historial de mensajes/WhatsApp ligados al `appointmentId` original
 * (auditoría UX, 30-ago). Reusa las mismas validaciones de `createAppointment`
 * (horario declarado del profesional, aviso soft de solapamiento) contra el
 * nuevo horario propuesto.
 */
export const updateAppointment = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        appointmentId: z.string().uuid(),
        clinicId: z.string().uuid(),
        branchId: z.string().uuid(),
        professionalId: z.string().uuid(),
        tratamiento: z.string().trim().min(1, "Indica el tratamiento o motivo."),
        procedureId: z.string().uuid().optional(),
        startsAt: z.string().min(1, "Falta la fecha y hora de inicio."),
        duracionMin: z.number().int().min(5).max(480),
        ...camposOla1,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; solapamiento?: Solapamiento }> => {
    if (data.operatoryId) {
      await validarBox(context.supabase, {
        clinicId: data.clinicId,
        branchId: data.branchId,
        operatoryId: data.operatoryId,
      });
    }
    const { startsAt, endsAt, solapamiento } = await validarHorarioYSolapamiento(context.supabase, {
      clinicId: data.clinicId,
      branchId: data.branchId,
      professionalId: data.professionalId,
      startsAtRaw: data.startsAt,
      duracionMin: data.duracionMin,
      excludeAppointmentId: data.appointmentId,
    });

    const { error } = await context.supabase
      .from("appointments")
      .update({
        branch_id: data.branchId,
        professional_id: data.professionalId,
        treatment_label: data.tratamiento,
        procedure_id: data.procedureId ?? null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        // Ausente (cliente anterior) = no se toca. `null` = se quita.
        ...(data.appointmentTypeId !== undefined
          ? {
              appointment_type_id: data.appointmentTypeId,
              // Al quitar el tipo se quita también el nombre; con tipo, lo
              // pone el trigger `appointments_tipo_de_cita`.
              ...(data.appointmentTypeId === null ? { appointment_type_name: null } : {}),
            }
          : {}),
        ...(data.operatoryId !== undefined ? { operatory_id: data.operatoryId } : {}),
        ...(data.notas !== undefined ? { notes: data.notas || null } : {}),
      })
      .eq("id", data.appointmentId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para editar esta cita."));
    return { ok: true, solapamiento };
  });

/** Estados en los que una cita todavía se puede mover de hora o de profesional. */
const ESTADOS_REPROGRAMABLES = new Set(["tentativa", "confirmada"]);

/**
 * Reprograma una cita desde el arrastre de la agenda (o "Mover a…"): solo
 * cambia la hora y, si cambió de carril, el profesional. La duración, el
 * tratamiento y el paciente no viajan: se leen de la fila.
 *
 * Pasa por `requireEscritura` (modo solo lectura, #85) y por las mismas
 * validaciones que Nueva cita y el diálogo de edición
 * (`validarHorarioYSolapamiento`). Es también lo que reproduce la cola sin
 * conexión (kind `reprogramar-cita`) con el payload tal cual se capturó: si
 * al sincronizar el horario ya no es válido, falla con el mensaje del
 * horario y la cola lo deja en "fallido" para que alguien lo mire.
 */
export const moveAppointment = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        appointmentId: z.string().uuid(),
        clinicId: z.string().uuid(),
        professionalId: z.string().uuid(),
        startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Fecha/hora inválida."),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; solapamiento?: Solapamiento }> => {
    const { supabase } = context;
    const { data: cita, error: citaErr } = await supabase
      .from("appointments")
      .select("id, branch_id, starts_at, ends_at, status")
      .eq("clinic_id", data.clinicId)
      .eq("id", data.appointmentId)
      .maybeSingle();
    if (citaErr) throw new Error(mensajeDb(citaErr, "No pudimos leer la cita."));
    if (!cita) throw new Error("La cita no existe o no es tuya.");
    if (!ESTADOS_REPROGRAMABLES.has(cita.status)) {
      throw new Error("Solo se mueven citas por confirmar o confirmadas.");
    }

    const { data: profesional, error: profErr } = await supabase
      .from("professionals")
      .select("id, branch_id")
      .eq("clinic_id", data.clinicId)
      .eq("id", data.professionalId)
      .eq("is_active", true)
      .maybeSingle();
    if (profErr) throw new Error(mensajeDb(profErr, "No pudimos verificar el profesional."));
    if (!profesional) throw new Error("El profesional no existe o no está activo.");

    // Si el profesional destino tiene sucursal, la cita pasa a esa sucursal
    // (cambio de carril entre sucursales); si no, se queda donde estaba.
    const branchId = profesional.branch_id ?? cita.branch_id;
    const duracionMin = Math.round(
      (new Date(cita.ends_at).getTime() - new Date(cita.starts_at).getTime()) / 60_000,
    );

    const { startsAt, endsAt, solapamiento } = await validarHorarioYSolapamiento(supabase, {
      clinicId: data.clinicId,
      branchId,
      professionalId: data.professionalId,
      startsAtRaw: data.startsAt,
      duracionMin,
      excludeAppointmentId: data.appointmentId,
    });

    const { error } = await supabase
      .from("appointments")
      .update({
        branch_id: branchId,
        professional_id: data.professionalId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      })
      .eq("id", data.appointmentId)
      .eq("clinic_id", data.clinicId);
    if (error) throw new Error("No tienes permisos para mover esta cita.");
    return { ok: true, solapamiento };
  });

export const setAppointmentStatus = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("appointments", "appointmentId")])
  .validator((input: unknown) =>
    z
      .object({
        appointmentId: z.string().uuid(),
        estado: z.enum([
          "tentativa",
          "confirmada",
          "en-sala",
          "ausente",
          "finalizada",
          "cancelada",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("appointments")
      .update({ status: data.estado })
      .eq("id", data.appointmentId);
    if (error) throw new Error("No tienes permisos para actualizar esta cita.");
    return { ok: true };
  });

/**
 * Anota (o desanota) que el PACIENTE avisó que viene.
 *
 * Es el camino manual del mismo eje que escribe el webhook de WhatsApp: el
 * paciente llamó por teléfono, o lo dijo en el mostrador. Existe porque sin
 * él la columna solo se llena con Meta conectado, y recepción ya tiene la
 * información — lo que le faltaba era dónde anotarla.
 *
 * NO toca `status` ni `confirmed_at`: aceptar la cita sigue siendo del
 * profesional. Cualquier rol de agenda puede anotar el aviso (lo permite la
 * policy de UPDATE existente), justamente porque no es una confirmación.
 */
export const setPatientConfirmation = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("appointments", "appointmentId")])
  .validator((input: unknown) =>
    z
      .object({
        appointmentId: z.string().uuid(),
        confirmado: z.boolean(),
        via: z.enum(["telefono", "presencial", "portal", "whatsapp"]).default("telefono"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("appointments")
      .update(
        data.confirmado
          ? { patient_confirmed_at: new Date().toISOString(), patient_confirmed_via: data.via }
          : { patient_confirmed_at: null, patient_confirmed_via: null },
      )
      .eq("id", data.appointmentId);
    if (error) throw new Error("No pudimos anotar el aviso del paciente.");
    return { ok: true };
  });

/**
 * Situación financiera de un conjunto de pacientes, para mostrarla en la fila
 * de cada cita de la agenda (G-3).
 *
 * Es el dato que recepción más usa en el mostrador: si el paciente que está
 * llegando debe plata, hay que cobrarle antes de que entre al box. Dentalink
 * lo muestra por fila y es probablemente el detalle más útil de su agenda.
 *
 * Una sola agregación por lote para toda la lista, no una consulta por fila:
 * reusa `fetchPatientBalances`, el mismo helper que alimenta el saldo de la
 * ficha y el aviso de `payment_due`, así que los tres números no pueden
 * divergir (ver el comentario de "saldo fantasma" en finance-section.tsx).
 *
 * Un paciente sin plan de tratamiento no aparece en el mapa y la UI lo muestra
 * como "sin datos", no como saldo cero — no es lo mismo no deber nada que no
 * tener nada facturado todavía.
 */
export const getAppointmentPatientBalances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        patientIds: z.array(z.string().uuid()).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<Record<string, number>> => {
    // El gate de `finance:view` en agenda.tsx es de interfaz, no un control:
    // el JWT vive en localStorage y cualquier miembro puede llamar este
    // endpoint directo. Sin este chequeo, una recepcionista obtiene el saldo
    // exacto de todos los pacientes de la clínica en un request.
    // Mismo helper y mismo motivo que `getFinanceSummary` (auditoría 04-sep).
    //
    // Task 11, fix round 1 (ruling del reviewer, Important #3): a propósito
    // NO pasa por `requireFinanceView` (que sí incluye el trial). Esto es
    // agenda operativa del día a día, no un "informe" — mostrar el saldo de
    // un paciente que debe plata como si no tuviera nada facturado, justo en
    // la columna "Abierto siempre" del mostrador, es peor que dejarlo visible
    // durante el trial vencido. Solo el chequeo de rol (`requireFinanceViewRole`),
    // sin importar el estado de la suscripción.
    await requireFinanceViewRole(context.supabase, data.clinicId, context.userId);

    if (!data.patientIds.length) return {};

    // Solo los pacientes pedidos (las citas que se ven), no la clínica entera.
    const balances = await fetchPatientBalances(context.supabase, data.clinicId, [
      ...new Set(data.patientIds),
    ]);
    const out: Record<string, number> = {};
    for (const [patientId, { billedCents, paidCents }] of balances) {
      out[patientId] = billedCents - paidCents;
    }
    return out;
  });
