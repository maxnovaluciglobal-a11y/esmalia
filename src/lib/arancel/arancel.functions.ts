import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { CATALOGO_CHILE, prepararImportacion } from "@/lib/arancel/catalogo-chile";
import {
  esSlugEspecialidad,
  SLUGS_ESPECIALIDAD,
  type Especialidad,
} from "@/lib/arancel/especialidades";
import {
  calcularRealineacion,
  errorDeParametros,
  MAX_PRESTACIONES_POR_REALINEACION,
  PORCENTAJE_MAX,
  PORCENTAJE_MIN,
  type ModoRealineacion,
} from "@/lib/arancel/realineacion";
import { isUndefinedColumnError, isUndefinedTableError, mensajeDb } from "@/lib/db-errors";
import { IDS_POR_BLOQUE, leerTodasLasPaginas } from "@/lib/paginacion";
import { requireEscritura } from "@/lib/solo-lectura.middleware";

/**
 * Arancel de la Ola 3: especialidades (ADM-02), catálogo chileno propio
 * (ADM-03) y realineación de precios en lote (ADM-04).
 *
 * Todo lo que escribe pasa por la RLS de `procedures` / `specialties`
 * (`can_manage_clinic`): el gate de la UI (`settings:manage` en /aranceles)
 * tiene su par en la base (regla 15).
 */

const SIN_PERMISOS =
  "No pudimos guardar. Revisa los datos y vuelve a intentarlo; si sigue igual, puede que tu rol no pueda editar el arancel.";

/** Código de Postgres/PostgREST cuando la función todavía no existe. */
function funcionInexistente(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42883" || error?.code === "PGRST202";
}

// ─── ESPECIALIDADES ──────────────────────────────────────────────────────

/**
 * Siembra idempotente de las especialidades estándar (`asegurar_especialidades`).
 * POST y sin el chequeo de solo lectura (ver `ESCRITURA_EXENTA`): crea una
 * lista estándar que la clínica no escribió, no datos del equipo. Si la base
 * todavía no tiene la función, no hace nada.
 */
export const asegurarEspecialidades = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ sembradas: number }> => {
    const { data: n, error } = await context.supabase.rpc("asegurar_especialidades", {
      p_clinic_id: data.clinicId,
    });
    if (error) {
      if (funcionInexistente(error)) return { sembradas: 0 };
      throw new Error(mensajeDb(error, "No pudimos preparar las especialidades de la clínica."));
    }
    return { sembradas: n ?? 0 };
  });

type FilaEspecialidad = {
  id: string;
  name: string;
  is_active: boolean;
  default_duration_min: number;
  slug?: string | null;
  position?: number;
};

/** Especialidades de la clínica para el arancel (todas, activas o no). */
export const listEspecialidades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Especialidad[]> => {
    const consultar = (columnas: string) =>
      context.supabase
        .from("specialties")
        .select(columnas)
        .eq("clinic_id", data.clinicId)
        .order("name", { ascending: true })
        .returns<FilaEspecialidad[]>();
    let { data: filas, error } = await consultar(
      "id, name, is_active, default_duration_min, slug, position",
    );
    if (isUndefinedColumnError(error))
      ({ data: filas, error } = await consultar("id, name, is_active, default_duration_min"));
    if (error)
      throw new Error(mensajeDb(error, "No pudimos cargar las especialidades de la clínica."));
    return (filas ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      slug: esSlugEspecialidad(f.slug) ? f.slug : null,
      isActive: f.is_active,
      position: f.position ?? 0,
      defaultDurationMin: f.default_duration_min,
    }));
  });

const NombreEspecialidad = z.string().trim().min(2, "Nombre muy corto.").max(80);
const DuracionEspecialidad = z.number().int().min(5).max(600);

export const crearEspecialidad = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        name: NombreEspecialidad,
        defaultDurationMin: DuracionEspecialidad.default(30),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: fila, error } = await context.supabase
      .from("specialties")
      .insert({
        clinic_id: data.clinicId,
        name: data.name,
        default_duration_min: data.defaultDurationMin,
        // Después de las doce estándar.
        position: SLUGS_ESPECIALIDAD.length,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("Ya existe una especialidad con ese nombre.");
      throw new Error(mensajeDb(error, SIN_PERMISOS));
    }
    return { id: fila.id };
  });

export const actualizarEspecialidad = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        specialtyId: z.string().uuid(),
        name: NombreEspecialidad,
        isActive: z.boolean(),
        defaultDurationMin: DuracionEspecialidad,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("specialties")
      .update({
        name: data.name,
        is_active: data.isActive,
        default_duration_min: data.defaultDurationMin,
      })
      .eq("id", data.specialtyId)
      .eq("clinic_id", data.clinicId);
    if (error) {
      if (error.code === "23505") throw new Error("Ya existe una especialidad con ese nombre.");
      throw new Error(mensajeDb(error, SIN_PERMISOS));
    }
    return { ok: true };
  });

// ─── CATÁLOGO CHILENO (ADM-03) ───────────────────────────────────────────

const CLAVES_CATALOGO = CATALOGO_CHILE.map((i) => i.key) as [string, ...string[]];

/**
 * Copia ítems del catálogo semilla al arancel de la clínica. El cliente
 * solo manda claves: nombre, especialidad, duración y rango salen de la copia
 * del catálogo que tiene el servidor. La moneda se lee de la clínica (el
 * rango está en CLP y solo se copia en CLP); la de la fila la fija el trigger
 * `moneda_desde_la_clinica` (regla 14).
 */
export const importarDelCatalogo = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        claves: z.array(z.enum(CLAVES_CATALOGO)).min(1).max(CATALOGO_CHILE.length),
        precioInicial: z.enum(["cero", "piso"]).default("cero"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ creadas: number; saltadas: string[] }> => {
    const { supabase } = context;

    const { data: clinica, error: clinicaErr } = await supabase
      .from("clinics")
      .select("currency")
      .eq("id", data.clinicId)
      .maybeSingle();
    if (clinicaErr || !clinica)
      throw new Error(mensajeDb(clinicaErr, "No pudimos leer la moneda de la clínica."));

    const { filas: existentes, error: readErr } = await leerTodasLasPaginas((desde, hasta) =>
      supabase
        .from("procedures")
        .select("id, name, catalog_key")
        .eq("clinic_id", data.clinicId)
        .order("id", { ascending: true })
        .range(desde, hasta),
    );
    if (readErr) throw new Error(mensajeDb(readErr, "No pudimos leer el arancel de la clínica."));

    const { data: especialidades, error: espErr } = await supabase
      .from("specialties")
      .select("id, slug")
      .eq("clinic_id", data.clinicId)
      .not("slug", "is", null);
    if (espErr) throw new Error(mensajeDb(espErr, "No pudimos leer las especialidades."));
    const idPorSlug = new Map((especialidades ?? []).map((e) => [e.slug as string, e.id]));

    const { filas, saltadas } = prepararImportacion(
      data.claves,
      (existentes ?? []).map((e) => ({ name: e.name, catalogKey: e.catalog_key })),
      clinica.currency,
      data.precioInicial,
    );
    if (!filas.length) return { creadas: 0, saltadas };

    const { error } = await supabase.from("procedures").insert(
      filas.map((f) => ({
        clinic_id: data.clinicId,
        name: f.name,
        category: null,
        specialty_id: idPorSlug.get(f.specialtySlug) ?? null,
        duration_min: f.durationMin,
        fonasa_code: f.fonasaCode,
        is_mai: f.isMai,
        default_price_cents: f.defaultPriceCents,
        suggested_min_cents: f.suggestedMinCents,
        suggested_max_cents: f.suggestedMaxCents,
        catalog_key: f.catalogKey,
      })),
    );
    if (error) throw new Error(mensajeDb(error, SIN_PERMISOS));
    return { creadas: filas.length, saltadas };
  });

// ─── REALINEAR PRECIOS (ADM-04) ──────────────────────────────────────────

const ParametrosSchema = z.object({
  modo: z.enum(["percent", "amount"]),
  porcentaje: z.number().min(PORCENTAJE_MIN).max(PORCENTAJE_MAX).nullish(),
  montoCents: z.number().int().nullish(),
  redondeoCents: z.number().int().positive().nullish(),
});

/**
 * Aplica una realineación. El cliente manda qué prestaciones eligió y el
 * precio que vio en la vista previa; el servidor recalcula el nuevo precio
 * con la misma función que la vista previa (así el registro dice exactamente
 * la regla aplicada) y la base rechaza todo si algún precio ya cambió.
 */
export const realinearPrecios = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        parametros: ParametrosSchema,
        alcance: z.string().trim().min(1).max(200),
        prestaciones: z
          .array(
            z.object({
              id: z.string().uuid(),
              name: z.string().max(300),
              priceCents: z.number().int().min(0),
            }),
          )
          .min(1)
          .max(MAX_PRESTACIONES_POR_REALINEACION),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string; cambiadas: number }> => {
    const parametros = data.parametros;
    const motivo = errorDeParametros(parametros);
    if (motivo) throw new Error(motivo);

    const cambios = calcularRealineacion(data.prestaciones, parametros);
    if (!cambios.length) throw new Error("Con esos valores ningún precio cambia.");

    const modo: ModoRealineacion = parametros.modo;
    const { data: id, error } = await context.supabase.rpc("realinear_precios", {
      p_clinic_id: data.clinicId,
      p_mode: modo,
      p_percent: modo === "percent" ? (parametros.porcentaje ?? 0) : null,
      p_amount_cents: modo === "amount" ? (parametros.montoCents ?? 0) : null,
      p_rounding_cents: parametros.redondeoCents ?? null,
      p_scope_label: data.alcance,
      p_cambios: cambios.map((c) => ({
        procedure_id: c.procedureId,
        old_cents: c.oldCents,
        new_cents: c.newCents,
      })) as unknown as Json,
    });
    if (error) {
      if (funcionInexistente(error))
        throw new Error("La realineación todavía no está disponible en esta base.");
      throw new Error(mensajeDb(error, SIN_PERMISOS));
    }
    return { id: id as string, cambiadas: cambios.length };
  });

export interface Realineacion {
  id: string;
  createdAt: string;
  autor: string | null;
  modo: ModoRealineacion;
  porcentaje: number | null;
  montoCents: number | null;
  redondeoCents: number | null;
  alcance: string;
  cantidad: number;
  currency: string;
  items: { procedureId: string; name: string; oldCents: number; newCents: number }[];
}

type ItemGuardado = { procedure_id: string; name: string; old_cents: number; new_cents: number };

/** Últimas realineaciones de la clínica, con quién las hizo. */
export const listRealineaciones = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<Realineacion[]> => {
    const { supabase } = context;
    const { data: filas, error } = await supabase
      .from("procedure_price_realignments")
      .select(
        "id, created_at, created_by, mode, percent, amount_cents, rounding_cents, scope_label, affected_count, currency, items",
      )
      .eq("clinic_id", data.clinicId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (isUndefinedTableError(error)) return [];
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar el historial de precios."));

    const autores = [...new Set((filas ?? []).map((f) => f.created_by))];
    const nombres = new Map<string, string | null>();
    for (let i = 0; i < autores.length; i += IDS_POR_BLOQUE) {
      const { data: perfiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", autores.slice(i, i + IDS_POR_BLOQUE));
      for (const p of perfiles ?? []) nombres.set(p.id, p.full_name ?? p.email ?? null);
    }

    return (filas ?? []).map((f) => ({
      id: f.id,
      createdAt: f.created_at,
      autor: nombres.get(f.created_by) ?? null,
      modo: f.mode as ModoRealineacion,
      porcentaje: f.percent === null ? null : Number(f.percent),
      montoCents: f.amount_cents,
      redondeoCents: f.rounding_cents,
      alcance: f.scope_label,
      cantidad: f.affected_count,
      currency: f.currency,
      items: (Array.isArray(f.items) ? (f.items as unknown as ItemGuardado[]) : []).map((it) => ({
        procedureId: it.procedure_id,
        name: it.name,
        oldCents: Number(it.old_cents),
        newCents: Number(it.new_cents),
      })),
    }));
  });
