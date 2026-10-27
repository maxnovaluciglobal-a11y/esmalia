import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { Permission } from "@/lib/access/access";
import { permisosEnClinica } from "@/lib/access/clinic-guards.server";
import { fetchPublicHolidays } from "@/lib/clinic-operations/holidays";
import { mensajeDb } from "@/lib/db-errors";
import { throwIfTrialBlocksInformes } from "@/lib/finance/finance-reports.functions";
import {
  CORTES,
  DEF_METRICAS,
  METRICAS,
  corteAdmitido,
  etiquetaClave,
  metricasVisibles,
  rangoDeComparacion,
  type FilaEmbudo,
  type FilaEquipo,
  type FilaMetrica,
  type Metrica,
  type Nombres,
  type ResultadoCalor,
} from "@/lib/reportes/informes";

/**
 * Informes "por pregunta" (Ola 11 · frente A, INF-02 a INF-10).
 *
 * Par en el servidor de la pantalla (regla 15): cada lectura vuelve a exigir
 * el permiso efectivo de la métrica (rol + ajustes por persona, EQU-01) y el
 * mismo bloqueo de suscripción que el resto de los informes. Los montos
 * exigen `finance:view`; la base lo repite (42501) y la RLS de cada tabla
 * decide qué filas cuentan (funciones SECURITY INVOKER).
 */

type Supabase = SupabaseClient<Database>;
const DIA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Base = z
  .object({
    clinicId: z.string().uuid(),
    desde: DIA,
    hasta: DIA,
    sucursal: z.string().uuid().nullable().optional(),
    profesional: z.string().uuid().nullable().optional(),
  })
  .refine((d) => d.desde <= d.hasta, { message: "El período no es válido." });

export const SIN_PERMISOS_INFORME = "No tienes permisos para ver este informe.";

interface Acceso {
  permisos: Permission[];
  finanzas: boolean;
}

async function exigirAcceso(
  supabase: Supabase,
  clinicId: string,
  userId: string,
  necesarios: readonly Permission[],
): Promise<Acceso> {
  const acceso = await permisosEnClinica(supabase, clinicId, userId);
  if (!acceso || !necesarios.every((p) => acceso.permisos.includes(p))) {
    throw new Error(SIN_PERMISOS_INFORME);
  }
  await throwIfTrialBlocksInformes(supabase, clinicId);
  return { permisos: acceso.permisos, finanzas: acceso.permisos.includes("finance:view") };
}

async function nombresDeLaClinica(supabase: Supabase, clinicId: string): Promise<Nombres> {
  const [pro, box, suc] = await Promise.all([
    supabase.from("professionals").select("id, full_name").eq("clinic_id", clinicId),
    supabase.from("operatories").select("id, name").eq("clinic_id", clinicId),
    supabase.from("branches").select("id, name").eq("clinic_id", clinicId),
  ]);
  return {
    profesionales: Object.fromEntries((pro.data ?? []).map((p) => [p.id, p.full_name])),
    boxes: Object.fromEntries((box.data ?? []).map((b) => [b.id, b.name])),
    sucursales: Object.fromEntries((suc.data ?? []).map((b) => [b.id, b.name])),
  };
}

async function moneda(supabase: Supabase, clinicId: string): Promise<string> {
  const { data } = await supabase
    .from("clinics")
    .select("currency")
    .eq("id", clinicId)
    .maybeSingle();
  return data?.currency ?? "CLP";
}

async function leerMetrica(
  supabase: Supabase,
  args: {
    clinicId: string;
    metrica: Metrica;
    desde: string;
    hasta: string;
    corte?: string;
    corte2?: string;
    sucursal?: string | null;
    profesional?: string | null;
  },
): Promise<FilaMetrica[]> {
  const { data, error } = await supabase.rpc("informe_metrica", {
    p_clinic_id: args.clinicId,
    p_metrica: args.metrica,
    p_desde: args.desde,
    p_hasta: args.hasta,
    p_corte: args.corte ?? "total",
    p_corte2: args.corte2 ?? "total",
    p_branch_id: args.sucursal ?? null,
    p_professional_id: args.profesional ?? null,
  });
  if (error) throw new Error(mensajeDb(error, "No pudimos calcular el informe."));
  return (data ?? []).map((f) => ({
    clave: f.clave,
    clave2: f.clave2,
    valor: Number(f.valor),
    n: Number(f.n),
    pacientes: Number(f.pacientes),
  }));
}

// ─── Opciones de la pantalla ─────────────────────────────────────────────

export interface OpcionesInformes {
  currency: string;
  metricas: Metrica[];
  finanzas: boolean;
  agenda: boolean;
  pacientes: boolean;
  sucursales: { id: string; nombre: string }[];
  profesionales: { id: string; nombre: string }[];
}

export const getOpcionesInformes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<OpcionesInformes> => {
    const { supabase, userId } = context;
    const acceso = await exigirAcceso(supabase, data.clinicId, userId, ["dashboard:view"]);
    const [currency, suc, pro] = await Promise.all([
      moneda(supabase, data.clinicId),
      supabase.from("branches").select("id, name").eq("clinic_id", data.clinicId).order("name"),
      supabase
        .from("professionals")
        .select("id, full_name, is_active")
        .eq("clinic_id", data.clinicId)
        .order("full_name"),
    ]);
    return {
      currency,
      metricas: metricasVisibles(acceso.permisos),
      finanzas: acceso.finanzas,
      agenda: acceso.permisos.includes("agenda:view"),
      pacientes: acceso.permisos.includes("patients:view"),
      sucursales: (suc.data ?? []).map((b) => ({ id: b.id, nombre: b.name })),
      profesionales: (pro.data ?? [])
        .filter((p) => p.is_active)
        .map((p) => ({ id: p.id, nombre: p.full_name })),
    };
  });

// ─── INF-02 / INF-04 / INF-08: una métrica por cortes, con comparación ───

const PedidoMetrica = z
  .object({
    clinicId: z.string().uuid(),
    desde: DIA,
    hasta: DIA,
    sucursal: z.string().uuid().nullable().optional(),
    profesional: z.string().uuid().nullable().optional(),
    metrica: z.enum(METRICAS),
    corte: z.enum(CORTES).default("total"),
    corte2: z.enum(CORTES).default("total"),
    comparar: z.enum(["anterior", "anio"]).nullable().optional(),
  })
  .refine((d) => d.desde <= d.hasta, { message: "El período no es válido." })
  .refine((d) => corteAdmitido(d.metrica, d.corte) && corteAdmitido(d.metrica, d.corte2), {
    message: "Ese corte no aplica a esta métrica.",
  });

export interface FilaConEtiqueta extends FilaMetrica {
  etiqueta: string;
  etiqueta2: string;
}

export interface ResultadoMetrica {
  currency: string;
  filas: FilaConEtiqueta[];
  anterior: { desde: string; hasta: string; filas: FilaConEtiqueta[] } | null;
  nombres: Nombres;
}

export const getInformeMetrica = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => PedidoMetrica.parse(input))
  .handler(async ({ data, context }): Promise<ResultadoMetrica> => {
    const { supabase, userId } = context;
    await exigirAcceso(supabase, data.clinicId, userId, [DEF_METRICAS[data.metrica].permiso]);
    const comparacion = data.comparar ? rangoDeComparacion(data, data.comparar) : null;
    const [actual, previo, nombres, currency] = await Promise.all([
      leerMetrica(supabase, data),
      comparacion
        ? leerMetrica(supabase, { ...data, ...comparacion })
        : Promise.resolve<FilaMetrica[]>([]),
      nombresDeLaClinica(supabase, data.clinicId),
      moneda(supabase, data.clinicId),
    ]);
    const etiquetar = (f: FilaMetrica): FilaConEtiqueta => ({
      ...f,
      etiqueta: etiquetaClave(data.corte, f.clave, nombres),
      etiqueta2: etiquetaClave(data.corte2, f.clave2, nombres),
    });
    return {
      currency,
      filas: actual.map(etiquetar),
      anterior: comparacion ? { ...comparacion, filas: previo.map(etiquetar) } : null,
      nombres,
    };
  });

// ─── INF-03: el detalle de una cifra ─────────────────────────────────────

export interface FilaDetalle {
  id: string;
  momento: string | null;
  fecha: string;
  pacienteId: string | null;
  paciente: string;
  profesional: string;
  box: string | null;
  sucursal: string | null;
  estado: string | null;
  valor: number;
}

export interface ResultadoDetalle {
  currency: string;
  total: number;
  filas: FilaDetalle[];
}

export const LIMITE_DETALLE = 500;

export const getInformeDetalle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        desde: DIA,
        hasta: DIA,
        sucursal: z.string().uuid().nullable().optional(),
        profesional: z.string().uuid().nullable().optional(),
        metrica: z.enum(METRICAS),
        corte: z.enum(CORTES).default("total"),
        clave: z.string().max(80).nullable(),
        corte2: z.enum(CORTES).default("total"),
        clave2: z.string().max(80).nullable().default("total"),
      })
      .refine((d) => corteAdmitido(d.metrica, d.corte) && corteAdmitido(d.metrica, d.corte2))
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ResultadoDetalle> => {
    const { supabase, userId } = context;
    await exigirAcceso(supabase, data.clinicId, userId, [DEF_METRICAS[data.metrica].permiso]);
    const { data: filas, error } = await supabase.rpc("informe_detalle", {
      p_clinic_id: data.clinicId,
      p_metrica: data.metrica,
      p_desde: data.desde,
      p_hasta: data.hasta,
      p_corte: data.corte,
      p_clave: data.clave,
      p_corte2: data.corte2,
      p_clave2: data.clave2,
      p_branch_id: data.sucursal ?? null,
      p_professional_id: data.profesional ?? null,
      p_limite: LIMITE_DETALLE,
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos abrir el detalle."));
    const lista = filas ?? [];
    const ids = [...new Set(lista.map((f) => f.patient_id).filter((x): x is string => !!x))];
    const [nombres, currency, pacientes] = await Promise.all([
      nombresDeLaClinica(supabase, data.clinicId),
      moneda(supabase, data.clinicId),
      ids.length
        ? supabase
            .from("patients")
            .select("id, full_name")
            .eq("clinic_id", data.clinicId)
            .in("id", ids)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    ]);
    const nombrePaciente = new Map((pacientes.data ?? []).map((p) => [p.id, p.full_name]));
    return {
      currency,
      total: Number(lista[0]?.total ?? 0),
      filas: lista.map((f) => ({
        id: f.ref_id,
        momento: f.momento,
        fecha: f.fecha,
        pacienteId: f.patient_id,
        paciente: f.patient_id ? (nombrePaciente.get(f.patient_id) ?? "Paciente") : "Sin paciente",
        profesional: f.professional_id
          ? (nombres.profesionales[f.professional_id] ?? "Profesional")
          : "Sin profesional",
        box: f.operatory_id ? (nombres.boxes[f.operatory_id] ?? "Box") : null,
        sucursal: f.branch_id ? (nombres.sucursales[f.branch_id] ?? "Sucursal") : null,
        estado: f.estado,
        valor: Number(f.valor),
      })),
    };
  });

// ─── INF-05: mapa de calor de la agenda ──────────────────────────────────

export const getMapaDeCalor = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Base.parse(input))
  .handler(async ({ data, context }): Promise<ResultadoCalor> => {
    const { supabase, userId } = context;
    await exigirAcceso(supabase, data.clinicId, userId, ["agenda:view"]);
    const { feriados, leidos } = await feriadosDelPeriodo(
      supabase,
      data.clinicId,
      data.desde,
      data.hasta,
    );
    const { data: filas, error } = await supabase.rpc("informe_ocupacion_neta", {
      p_clinic_id: data.clinicId,
      p_desde: data.desde,
      p_hasta: data.hasta,
      p_branch_id: data.sucursal ?? null,
      p_professional_id: data.profesional ?? null,
      p_feriados: feriados,
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos calcular la ocupación."));
    return {
      feriadosDescontados: leidos,
      feriados,
      filas: (filas ?? []).map((f) => ({
        diaSemana: f.dia_semana,
        hora: f.hora,
        citas: Number(f.citas),
        minutosOcupados: Number(f.minutos_ocupados),
        minutosDisponibles: Number(f.minutos_disponibles),
        dias: Number(f.dias),
        minutosBloqueados: Number(f.minutos_bloqueados),
        minutosFeriado: Number(f.minutos_feriado),
      })),
    };
  });

/**
 * Feriados públicos del país de la clínica dentro del período. Vienen de un
 * servicio externo (Nager.Date, el mismo que marca el selector de fecha de la
 * agenda): si no responde, el mapa descuenta bloqueos pero no feriados y lo
 * dice (`leidos: false`), en vez de fallar o inventar.
 */
async function feriadosDelPeriodo(
  supabase: Supabase,
  clinicId: string,
  desde: string,
  hasta: string,
): Promise<{ feriados: string[]; leidos: boolean }> {
  const { data: clinica } = await supabase
    .from("clinics")
    .select("country")
    .eq("id", clinicId)
    .maybeSingle();
  const pais = (clinica?.country ?? "").trim().toUpperCase();
  if (pais.length !== 2) return { feriados: [], leidos: false };
  const anios: number[] = [];
  for (let a = Number(desde.slice(0, 4)); a <= Number(hasta.slice(0, 4)); a++) anios.push(a);
  try {
    const porAnio = await Promise.all(anios.map((a) => fetchPublicHolidays(pais, a)));
    const fechas = porAnio
      .flat()
      .map((h) => h.date)
      .filter((f) => f >= desde && f <= hasta);
    return { feriados: [...new Set(fechas)].sort(), leidos: true };
  } catch (e) {
    console.error("[informes] no se pudieron leer los feriados", e);
    return { feriados: [], leidos: false };
  }
}

// ─── INF-06: uso por box ─────────────────────────────────────────────────

export interface FilaBox {
  operatoryId: string | null;
  nombre: string;
  sucursal: string;
  citas: number;
  atenciones: number;
  minutosOcupados: number;
  minutosAbiertos: number | null;
}

export const getUsoBox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Base.parse(input))
  .handler(async ({ data, context }): Promise<FilaBox[]> => {
    const { supabase, userId } = context;
    await exigirAcceso(supabase, data.clinicId, userId, ["agenda:view"]);
    const [res, nombres] = await Promise.all([
      supabase.rpc("informe_uso_box", {
        p_clinic_id: data.clinicId,
        p_desde: data.desde,
        p_hasta: data.hasta,
        p_branch_id: data.sucursal ?? null,
      }),
      nombresDeLaClinica(supabase, data.clinicId),
    ]);
    if (res.error)
      throw new Error(mensajeDb(res.error, "No pudimos calcular el uso de los boxes."));
    return (res.data ?? []).map((f) => ({
      operatoryId: f.operatory_id,
      nombre: etiquetaClave("box", f.operatory_id, nombres),
      sucursal: f.branch_id ? (nombres.sucursales[f.branch_id] ?? "Sucursal") : "",
      citas: Number(f.citas),
      atenciones: Number(f.atenciones),
      minutosOcupados: Number(f.minutos_ocupados),
      minutosAbiertos: f.minutos_abiertos === null ? null : Number(f.minutos_abiertos),
    }));
  });

// ─── INF-07: embudo ──────────────────────────────────────────────────────

export const getEmbudo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Base.parse(input))
  .handler(async ({ data, context }): Promise<FilaEmbudo[]> => {
    const { supabase, userId } = context;
    await exigirAcceso(supabase, data.clinicId, userId, ["patients:view", "agenda:view"]);
    const { data: filas, error } = await supabase.rpc("informe_embudo", {
      p_clinic_id: data.clinicId,
      p_desde: data.desde,
      p_hasta: data.hasta,
      p_branch_id: data.sucursal ?? null,
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos calcular el embudo."));
    return (filas ?? []).map((f) => ({
      canal: f.canal,
      contactos: Number(f.contactos),
      conCita: Number(f.con_cita),
      atendidos: Number(f.atendidos),
      conPresupuesto: Number(f.con_presupuesto),
      aceptados: Number(f.aceptados),
      pagados: f.pagados === null ? null : Number(f.pagados),
    }));
  });

// ─── INF-09: equipo ──────────────────────────────────────────────────────

export const getInformeEquipo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Base.parse(input))
  .handler(async ({ data, context }): Promise<FilaEquipo[]> => {
    const { supabase, userId } = context;
    const acceso = await exigirAcceso(supabase, data.clinicId, userId, ["agenda:view"]);
    const pedir = (metrica: Metrica) =>
      leerMetrica(supabase, { ...data, metrica, corte: "profesional" });
    const [citas, atenciones, ausencias, cancelaciones, horas, produccion, nombres] =
      await Promise.all([
        pedir("citas"),
        pedir("atenciones"),
        pedir("ausencias"),
        pedir("cancelaciones"),
        pedir("horas_agendadas"),
        acceso.finanzas ? pedir("produccion") : Promise.resolve<FilaMetrica[] | null>(null),
        nombresDeLaClinica(supabase, data.clinicId),
      ]);
    const claves = new Set<string | null>();
    for (const lista of [citas, atenciones, ausencias, cancelaciones, produccion ?? []]) {
      for (const f of lista) claves.add(f.clave);
    }
    const de = (lista: FilaMetrica[], clave: string | null) => lista.find((f) => f.clave === clave);
    return [...claves].map((clave) => ({
      professionalId: clave,
      nombre: etiquetaClave("profesional", clave, nombres),
      citas: de(citas, clave)?.valor ?? 0,
      atenciones: de(atenciones, clave)?.valor ?? 0,
      ausencias: de(ausencias, clave)?.valor ?? 0,
      cancelaciones: de(cancelaciones, clave)?.valor ?? 0,
      minutos: de(horas, clave)?.valor ?? 0,
      pacientesAtendidos: de(atenciones, clave)?.pacientes ?? 0,
      produccionCents: produccion ? (de(produccion, clave)?.valor ?? 0) : null,
    }));
  });

// ─── INF-10: red de sucursales ───────────────────────────────────────────

export interface FilaRed {
  branchId: string | null;
  nombre: string;
  citas: number;
  atenciones: number;
  ausencias: number;
  pacientesNuevos: number;
  minutos: number;
  produccionCents: number | null;
  cobradoCents: number | null;
}

export const getInformeRed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Base.parse(input))
  .handler(async ({ data, context }): Promise<FilaRed[]> => {
    const { supabase, userId } = context;
    const acceso = await exigirAcceso(supabase, data.clinicId, userId, [
      "agenda:view",
      "patients:view",
    ]);
    const rango = { clinicId: data.clinicId, desde: data.desde, hasta: data.hasta };
    const pedir = (metrica: Metrica) =>
      leerMetrica(supabase, { ...rango, metrica, corte: "sucursal" });
    const sinDinero = Promise.resolve<FilaMetrica[] | null>(null);
    const [citas, atenciones, ausencias, nuevos, horas, produccion, cobrado, nombres] =
      await Promise.all([
        pedir("citas"),
        pedir("atenciones"),
        pedir("ausencias"),
        pedir("pacientes_nuevos"),
        pedir("horas_agendadas"),
        acceso.finanzas ? pedir("produccion") : sinDinero,
        acceso.finanzas ? pedir("cobrado") : sinDinero,
        nombresDeLaClinica(supabase, data.clinicId),
      ]);
    const claves = new Set<string | null>(Object.keys(nombres.sucursales));
    for (const lista of [citas, atenciones, ausencias, nuevos, produccion ?? [], cobrado ?? []]) {
      for (const f of lista) claves.add(f.clave);
    }
    const de = (lista: FilaMetrica[], clave: string | null) =>
      lista.find((f) => f.clave === clave)?.valor ?? 0;
    return [...claves].map((clave) => ({
      branchId: clave,
      nombre: etiquetaClave("sucursal", clave, nombres),
      citas: de(citas, clave),
      atenciones: de(atenciones, clave),
      ausencias: de(ausencias, clave),
      pacientesNuevos: de(nuevos, clave),
      minutos: de(horas, clave),
      produccionCents: produccion ? de(produccion, clave) : null,
      cobradoCents: cobrado ? de(cobrado, clave) : null,
    }));
  });
