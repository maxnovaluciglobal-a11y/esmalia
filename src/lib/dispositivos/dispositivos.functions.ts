import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { mensajeDb } from "@/lib/db-errors";
import {
  estadoDispositivo,
  formatearCodigoVinculacion,
  generarCodigoVinculacion,
  huellaDeCodigo,
  MODOS_PRIVACIDAD,
  TIPOS_DISPOSITIVO,
  type EstadoDispositivo,
  type ModoPrivacidad,
  type TipoDispositivo,
} from "@/lib/dispositivos/dispositivos";
import { requireEscritura, requireEscrituraPorFila } from "@/lib/solo-lectura.middleware";

/**
 * Ajustes → Dispositivos (AUT-06) y el botón "Llamar" de la agenda (AUT-04).
 *
 * Dispositivos: solo owner/admin (`settings:manage`). El gate de la UI tiene
 * su par acá y en la base (RLS de `clinic_devices` y las funciones
 * `dispositivo_*`, que vuelven a exigir `can_manage_clinic`). La lista nunca
 * trae las huellas: solo si el dispositivo está vinculado.
 */

const SIN_PERMISOS = "No tienes permisos para administrar los dispositivos.";

export interface DispositivoListado {
  id: string;
  tipo: TipoDispositivo;
  nombre: string;
  sucursalId: string;
  sucursal: string;
  boxId: string | null;
  box: string | null;
  privacidad: ModoPrivacidad;
  estado: EstadoDispositivo;
  codigoVenceEn: string | null;
  vinculadoEn: string | null;
  ultimoUso: string | null;
  revocadoEn: string | null;
  creadoEn: string;
}

export interface DatosDispositivos {
  dispositivos: DispositivoListado[];
  sucursales: { id: string; nombre: string }[];
  boxes: { id: string; nombre: string; sucursalId: string }[];
}

export const listarDispositivos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<DatosDispositivos> => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage", SIN_PERMISOS);
    const [devs, sucs, boxes] = await Promise.all([
      supabase
        .from("clinic_devices")
        .select(
          "id, kind, name, branch_id, operatory_id, privacy_mode, token_hash, pairing_expires_at, paired_at, last_used_at, revoked_at, created_at",
        )
        .eq("clinic_id", data.clinicId)
        .order("created_at", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("branches")
        .select("id, name")
        .eq("clinic_id", data.clinicId)
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("operatories")
        .select("id, name, branch_id")
        .eq("clinic_id", data.clinicId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
    ]);
    if (devs.error) throw new Error(mensajeDb(devs.error, "No pudimos cargar los dispositivos."));
    if (sucs.error) throw new Error(mensajeDb(sucs.error, "No pudimos cargar las sucursales."));
    if (boxes.error) throw new Error(mensajeDb(boxes.error, "No pudimos cargar los boxes."));

    const nombreSuc = new Map((sucs.data ?? []).map((s) => [s.id, s.name]));
    const nombreBox = new Map((boxes.data ?? []).map((b) => [b.id, b.name]));
    const ahora = new Date();
    return {
      dispositivos: (devs.data ?? []).map((d) => ({
        id: d.id,
        tipo: (TIPOS_DISPOSITIVO as readonly string[]).includes(d.kind)
          ? (d.kind as TipoDispositivo)
          : "totem",
        nombre: d.name,
        sucursalId: d.branch_id,
        sucursal: nombreSuc.get(d.branch_id) ?? "Sucursal",
        boxId: d.operatory_id,
        box: d.operatory_id ? (nombreBox.get(d.operatory_id) ?? "Box") : null,
        privacidad: (MODOS_PRIVACIDAD as readonly string[]).includes(d.privacy_mode)
          ? (d.privacy_mode as ModoPrivacidad)
          : "iniciales",
        estado: estadoDispositivo(
          {
            revocado: Boolean(d.revoked_at),
            vinculado: Boolean(d.token_hash),
            codigoVenceEn: d.pairing_expires_at,
          },
          ahora,
        ),
        codigoVenceEn: d.pairing_expires_at,
        vinculadoEn: d.token_hash ? d.paired_at : null,
        ultimoUso: d.last_used_at,
        revocadoEn: d.revoked_at,
        creadoEn: d.created_at,
      })),
      sucursales: (sucs.data ?? []).map((s) => ({ id: s.id, nombre: s.name })),
      boxes: (boxes.data ?? []).map((b) => ({ id: b.id, nombre: b.name, sucursalId: b.branch_id })),
    };
  });

const NombreSchema = z.string().trim().min(2, "Ponle un nombre (2 letras o más).").max(60);

export const crearDispositivo = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        sucursalId: z.string().uuid(),
        tipo: z.enum(TIPOS_DISPOSITIVO),
        nombre: NombreSchema,
        boxId: z.string().uuid().nullable(),
        privacidad: z.enum(MODOS_PRIVACIDAD),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage", SIN_PERMISOS);
    if (data.tipo === "box" && !data.boxId) throw new Error("Elige qué box muestra la pantalla.");
    const { data: id, error } = await supabase.rpc("dispositivo_crear", {
      p_clinic_id: data.clinicId,
      p_branch_id: data.sucursalId,
      p_kind: data.tipo,
      p_name: data.nombre,
      p_operatory_id: data.tipo === "box" ? data.boxId : null,
      p_privacy_mode: data.privacidad,
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos crear el dispositivo."));
    return { id: String(id) };
  });

/** El dispositivo es de la clínica que dice el pedido (RLS: owner/admin). */
async function exigirDispositivoDeLaClinica(
  supabase: Parameters<typeof requireClinicPermission>[0],
  clinicId: string,
  deviceId: string,
): Promise<void> {
  const { data } = await supabase
    .from("clinic_devices")
    .select("id")
    .eq("id", deviceId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (!data) throw new Error(SIN_PERMISOS);
}

export const editarDispositivo = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        deviceId: z.string().uuid(),
        nombre: NombreSchema,
        boxId: z.string().uuid().nullable(),
        privacidad: z.enum(MODOS_PRIVACIDAD),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage", SIN_PERMISOS);
    await exigirDispositivoDeLaClinica(supabase, data.clinicId, data.deviceId);
    const { error } = await supabase.rpc("dispositivo_editar", {
      p_device_id: data.deviceId,
      p_name: data.nombre,
      p_operatory_id: data.boxId,
      p_privacy_mode: data.privacidad,
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos guardar el dispositivo."));
    return { ok: true };
  });

/**
 * Código de un solo uso para vincular (10 minutos). Se muestra una vez: la
 * base guarda solo su huella. Emitir otro reemplaza al anterior.
 */
export const emitirCodigoDeVinculacion = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), deviceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage", SIN_PERMISOS);
    await exigirDispositivoDeLaClinica(supabase, data.clinicId, data.deviceId);
    const codigo = generarCodigoVinculacion();
    const { data: vence, error } = await supabase.rpc("dispositivo_emitir_codigo", {
      p_device_id: data.deviceId,
      p_code_hash: await huellaDeCodigo(codigo),
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos generar el código."));
    return { codigo: formatearCodigoVinculacion(codigo), venceEn: String(vence) };
  });

/** Revocar siempre se puede (también en solo lectura): es una acción de seguridad. */
export const revocarDispositivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), deviceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireClinicPermission(supabase, data.clinicId, userId, "settings:manage", SIN_PERMISOS);
    await exigirDispositivoDeLaClinica(supabase, data.clinicId, data.deviceId);
    const { error } = await supabase.rpc("dispositivo_revocar", { p_device_id: data.deviceId });
    if (error) throw new Error(mensajeDb(error, "No pudimos revocar el dispositivo."));
    return { ok: true };
  });

// ─── "Llamar" desde la agenda o el panel ──────────────────────────────────

export type ResultadoLlamarASala =
  { ok: true; turno: number | null; box: string | null } | { ok: false; motivo: string };

export const llamarASala = createServerFn({ method: "POST" })
  .middleware([requireEscrituraPorFila("appointments", "appointmentId")])
  .validator((input: unknown) => z.object({ appointmentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ResultadoLlamarASala> => {
    const { data: res, error } = await context.supabase.rpc("llamar_a_sala", {
      p_appointment_id: data.appointmentId,
    });
    if (error) throw new Error(mensajeDb(error, "No tienes permisos para llamar pacientes."));
    const j = (res ?? {}) as Record<string, unknown>;
    if (j.ok !== true) {
      return {
        ok: false,
        motivo:
          j.motivo === "no_en_sala"
            ? "Solo puedes llamar a un paciente que ya está en sala."
            : "No pudimos llamar a este paciente: la cita no es de hoy.",
      };
    }
    return {
      ok: true,
      turno: typeof j.turno === "number" ? j.turno : null,
      box: typeof j.box === "string" ? j.box : null,
    };
  });
