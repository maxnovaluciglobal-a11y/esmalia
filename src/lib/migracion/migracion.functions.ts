// src/lib/migracion/migracion.functions.ts
//
// Migración asistida por lotes (EXP-05, EXP-06, EXP-07, REC-06): vista
// previa, importación, reversa y recordatorios de un lote. Solo owner/admin
// (`settings:manage`), igual que la pantalla /migracion, y la base lo vuelve
// a exigir (can_manage_clinic + MFA) en cada función SQL.
//
// El navegador lee el archivo y aplica el mapeo de columnas; el servidor
// recibe las filas ya mapeadas y la fila original, y vuelve a correr TODA la
// clasificación (`prepararPacientes` / `prepararCitas` + duplicados contra
// la base). La importación exige la cifra que la persona confirmó: si no
// coincide con lo que el servidor calcula, no escribe nada.

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { requireClinicPermission } from "@/lib/access/clinic-guards.server";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import { mensajeDb } from "@/lib/db-errors";
import { toE164 } from "@/lib/messaging/telefonos";
import { vigilarCifradoDeDocumento } from "@/lib/patients/documento-cifrado.server";
import { requireEscritura } from "@/lib/solo-lectura.middleware";
import {
  afectadas,
  explicarBloqueo,
  cerrarSiYaPaso,
  filaOriginal,
  MAX_FILAS_POR_LOTE,
  normalizarNombrePersona,
  prepararCitas,
  prepararPacientes,
  type EstadoFila,
  type FilaCita,
  type FilaPaciente,
  type FilaVistaPrevia,
  type PoliticaDuplicados,
} from "./normalizar";
import { PERFILES, TIPOS_DE_LOTE, type PerfilId, type TipoLote } from "./perfiles";

type Supa = SupabaseClient<Database>;

const SIN_PERMISOS = "Solo el propietario o un administrador pueden migrar datos de otro sistema.";
const TAMANO_BLOQUE = 250;
const ZONA_POR_DEFECTO = "America/Santiago";

const filaSchema = z.record(z.string().max(200), z.string().max(4000));

const entradaSchema = z.object({
  clinicId: z.string().uuid(),
  tipo: z.enum(TIPOS_DE_LOTE),
  perfil: z.enum(PERFILES),
  /** Filas ya mapeadas a los campos del perfil (`aplicarMapeo`). */
  filas: z.array(filaSchema).min(1).max(MAX_FILAS_POR_LOTE),
  /** La fila tal como venía en el archivo, misma posición que `filas`. */
  originales: z.array(filaSchema).max(MAX_FILAS_POR_LOTE),
  /** Citas: nombre del profesional en el archivo → id en Esmalia. */
  profesionales: z.record(z.string().max(200), z.string().uuid()).default({}),
  /** Citas: sucursal a usar cuando el archivo no la dice (o no coincide). */
  sucursalId: z.string().uuid().nullable().default(null),
});

type Entrada = z.infer<typeof entradaSchema>;

export interface VistaPrevia {
  tipo: TipoLote;
  filas: FilaVistaPrevia[];
  resumen: { validas: number; errores: number; duplicadas: number };
  /** Citas: nombres de profesional del archivo que no tienen par en Esmalia. */
  profesionalesSinPar: string[];
  /** Citas: catálogos para el mapeo editable. */
  profesionales: { id: string; nombre: string }[];
  sucursales: { id: string; nombre: string }[];
  /** Citas futuras (las que pedirían recordatorio). */
  citasFuturas: number;
}

async function exigirGestion(supa: Supa, clinicId: string, userId: string) {
  await requireClinicPermission(supa, clinicId, userId, "settings:manage", SIN_PERMISOS);
}

async function datosDeLaClinica(supa: Supa, clinicId: string) {
  const { data, error } = await supa
    .from("clinics")
    .select("country, timezone")
    .eq("id", clinicId)
    .maybeSingle();
  if (error) throw new Error(mensajeDb(error, "No pudimos leer los datos de la clínica."));
  return { pais: data?.country ?? null, zona: data?.timezone || ZONA_POR_DEFECTO };
}

type Coincidencia = { patientId: string; via: string };

const ORDEN_VIA = ["externo", "documento", "nombre_nacimiento", "nombre"];

/** Fichas que ya existen y coinciden con cada referencia (de a 1000). */
async function buscarFichas(
  supa: Supa,
  clinicId: string,
  perfil: PerfilId,
  refs: {
    i: number;
    externo?: string | null;
    documento?: string | null;
    nombre?: string | null;
    nacimiento?: string | null;
  }[],
  porNombre: boolean,
): Promise<Map<number, Coincidencia[]>> {
  const salida = new Map<number, Coincidencia[]>();
  for (let desde = 0; desde < refs.length; desde += 1000) {
    const tanda = refs.slice(desde, desde + 1000);
    if (tanda.length === 0) continue;
    const { data, error } = await supa.rpc("migracion_buscar_pacientes", {
      p_clinic_id: clinicId,
      p_refs: tanda as unknown as Json,
      p_fuente: perfil,
      p_por_nombre: porNombre,
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos revisar las fichas que ya existen."));
    for (const r of data ?? []) {
      // Una ficha puede coincidir por varias vías: se queda la más fuerte.
      const lista = salida.get(r.i) ?? [];
      const previa = lista.findIndex((c) => c.patientId === r.patient_id);
      if (previa === -1) lista.push({ patientId: r.patient_id, via: r.via });
      else if (ORDEN_VIA.indexOf(r.via) < ORDEN_VIA.indexOf(lista[previa].via)) {
        lista[previa] = { patientId: r.patient_id, via: r.via };
      }
      salida.set(r.i, lista);
    }
  }
  return salida;
}

const ETIQUETA_VIA: Record<string, string> = {
  externo: "mismo id del sistema anterior",
  documento: "mismo documento",
  nombre_nacimiento: "mismo nombre y fecha de nacimiento",
  nombre: "mismo nombre",
};

function mejorCoincidencia(lista: Coincidencia[] | undefined): Coincidencia | null {
  if (!lista?.length) return null;
  return [...lista].sort((a, b) => ORDEN_VIA.indexOf(a.via) - ORDEN_VIA.indexOf(b.via))[0];
}

// ─── Pacientes ─────────────────────────────────────────────────────────────

interface PlanPacientes {
  vista: VistaPrevia;
  preparadas: FilaPaciente[];
  coincidencias: Map<number, Coincidencia | null>;
}

async function planificarPacientes(supa: Supa, e: Entrada): Promise<PlanPacientes> {
  const { pais } = await datosDeLaClinica(supa, e.clinicId);
  const preparadas = prepararPacientes(e.filas, pais);
  const refs = preparadas
    .filter((p) => p.estado === "valida")
    .map((p) => ({
      i: p.fila,
      externo: p.externo,
      documento: p.documento,
      nombre: p.nombre,
      nacimiento: p.nacimiento,
    }));
  const encontradas = await buscarFichas(supa, e.clinicId, e.perfil, refs, false);
  const coincidencias = new Map<number, Coincidencia | null>();

  const filas: FilaVistaPrevia[] = preparadas.map((p) => {
    const c = p.estado === "valida" ? mejorCoincidencia(encontradas.get(p.fila)) : null;
    coincidencias.set(p.fila, c);
    const mensajes = [...p.errores, ...p.avisos];
    let estado = p.estado;
    if (p.repiteFila !== null) mensajes.unshift(`Repite la fila ${p.repiteFila} del archivo.`);
    if (c) {
      estado = "duplicada";
      mensajes.unshift(`Ya existe en Esmalia (${ETIQUETA_VIA[c.via] ?? c.via}).`);
    }
    return {
      fila: p.fila,
      estado,
      accion: estado === "error" ? "error" : estado === "duplicada" ? "omitir" : "crear",
      titulo: p.nombre || "(sin nombre)",
      detalle: [p.documento, p.nacimiento].filter(Boolean).join(" · ") || null,
      mensajes,
      pacienteId: c?.patientId ?? null,
      via: c?.via ?? null,
    };
  });

  return {
    vista: {
      tipo: "pacientes",
      filas,
      resumen: contar(filas),
      profesionalesSinPar: [],
      profesionales: [],
      sucursales: [],
      citasFuturas: 0,
    },
    preparadas,
    coincidencias,
  };
}

function contar(filas: FilaVistaPrevia[]) {
  return {
    validas: filas.filter((f) => f.estado === "valida").length,
    errores: filas.filter((f) => f.estado === "error").length,
    duplicadas: filas.filter((f) => f.estado === "duplicada").length,
  };
}

function filaParaLaBase(
  p: FilaPaciente,
  original: Record<string, string> | undefined,
  pais: string | null,
): Record<string, unknown> {
  const telefono = p.telefono ? (toE164(p.telefono, pais) ?? p.telefono) : null;
  return {
    fila: p.fila,
    nombre: p.nombre,
    documento: p.documento,
    documento_tipo: p.documentoTipo,
    nacimiento: p.nacimiento,
    telefono,
    email: p.email,
    direccion: p.direccion,
    comuna: p.comuna,
    prevision: p.prevision?.prevision ?? null,
    tramo: p.prevision?.tramo ?? null,
    institucion: p.prevision?.institucion ?? null,
    externo: p.externo,
    original: original ? filaOriginal(original) : null,
  };
}

// ─── Citas ─────────────────────────────────────────────────────────────────

interface PlanCitas {
  vista: VistaPrevia;
  paraLaBase: Map<number, Record<string, unknown>>;
}

async function planificarCitas(supa: Supa, e: Entrada): Promise<PlanCitas> {
  const { zona } = await datosDeLaClinica(supa, e.clinicId);
  const [{ data: profs, error: errProf }, { data: sucs, error: errSuc }] = await Promise.all([
    supa
      .from("professionals")
      .select("id, full_name, is_active")
      .eq("clinic_id", e.clinicId)
      .order("full_name"),
    supa
      .from("branches")
      .select("id, name, timezone, is_active")
      .eq("clinic_id", e.clinicId)
      .order("name"),
  ]);
  if (errProf) throw new Error(mensajeDb(errProf, "No pudimos leer los profesionales."));
  if (errSuc) throw new Error(mensajeDb(errSuc, "No pudimos leer las sucursales."));
  const profesionales = (profs ?? []).map((p) => ({ id: p.id, nombre: p.full_name }));
  const sucursales = (sucs ?? []).map((b) => ({
    id: b.id,
    nombre: b.name,
    zona: b.timezone || zona,
    activa: b.is_active,
  }));

  const preparadas = prepararCitas(e.filas);

  // Profesional: el mapeo editable manda; si no, el mismo nombre normalizado;
  // si la clínica tiene uno solo, ese.
  const porNombre = new Map<string, string[]>();
  for (const p of profesionales) {
    const k = normalizarNombrePersona(p.nombre);
    if (k) porNombre.set(k, [...(porNombre.get(k) ?? []), p.id]);
  }
  const mapeo = new Map(
    Object.entries(e.profesionales).filter(([, id]) => profesionales.some((p) => p.id === id)),
  );
  const sinPar = new Set<string>();
  function profesionalDe(nombre: string | null): string | null {
    if (nombre && mapeo.has(nombre)) return mapeo.get(nombre) ?? null;
    const k = normalizarNombrePersona(nombre);
    const candidatos = k ? (porNombre.get(k) ?? []) : [];
    if (candidatos.length === 1) return candidatos[0];
    if (profesionales.length === 1) return profesionales[0].id;
    if (nombre) sinPar.add(nombre);
    return null;
  }

  const sucursalElegida = sucursales.find((s) => s.id === e.sucursalId) ?? null;
  const unicaSucursal =
    sucursales.filter((s) => s.activa).length === 1
      ? (sucursales.find((s) => s.activa) ?? null)
      : null;
  function sucursalDe(nombre: string | null) {
    const k = normalizarNombrePersona(nombre);
    const porNombreSuc = k ? sucursales.filter((s) => normalizarNombrePersona(s.nombre) === k) : [];
    if (porNombreSuc.length === 1) return porNombreSuc[0];
    return sucursalElegida ?? unicaSucursal;
  }

  // Paciente de cada cita: id del sistema anterior (pacientes importados con
  // el mismo perfil), documento o nombre exacto.
  const refs = preparadas
    .filter((c) => c.estado === "valida")
    .map((c) => ({
      i: c.fila,
      externo: c.pacienteExterno,
      documento: c.pacienteDocumento,
      nombre: c.pacienteNombre,
    }));
  const encontradas = await buscarFichas(supa, e.clinicId, e.perfil, refs, true);

  const ahora = Date.now();
  let citasFuturas = 0;
  const paraLaBase = new Map<number, Record<string, unknown>>();

  const filas: FilaVistaPrevia[] = preparadas.map((c: FilaCita) => {
    const mensajes = [...c.errores, ...c.avisos];
    let estado: EstadoFila = c.estado;
    if (c.repiteFila !== null) mensajes.unshift(`Repite la fila ${c.repiteFila} del archivo.`);

    let pacienteId: string | null = null;
    let via: string | null = null;
    if (estado === "valida") {
      const lista = encontradas.get(c.fila) ?? [];
      const mejor = mejorCoincidencia(lista);
      const empatadas = mejor ? lista.filter((x) => x.via === mejor.via) : [];
      if (!mejor) {
        estado = "error";
        mensajes.push(
          "No encontramos al paciente en Esmalia: importa primero el archivo de pacientes.",
        );
      } else if (empatadas.length > 1) {
        estado = "error";
        mensajes.push(
          `Hay ${empatadas.length} fichas que coinciden (${ETIQUETA_VIA[mejor.via]}): no elegimos una al azar.`,
        );
      } else {
        pacienteId = mejor.patientId;
        via = mejor.via;
      }
    }

    const professionalId = estado === "valida" ? profesionalDe(c.profesional) : null;
    if (estado === "valida" && !professionalId) {
      estado = "error";
      mensajes.push(
        c.profesional
          ? `El profesional "${c.profesional}" no está en Esmalia: elígelo en el mapeo de profesionales.`
          : "Falta el profesional (la clínica tiene más de uno).",
      );
    }
    const sucursal = estado === "valida" ? sucursalDe(c.sucursal) : null;
    if (estado === "valida" && !sucursal) {
      estado = "error";
      mensajes.push("Falta la sucursal: elige una sucursal por defecto.");
    }

    let inicioIso: string | null = null;
    if (estado === "valida" && c.inicioLocal && sucursal) {
      const inicio = wallTimeInTzToUtc(c.inicioLocal, sucursal.zona);
      inicioIso = inicio.toISOString();
      const finIso = new Date(inicio.getTime() + c.duracionMin * 60_000).toISOString();
      if (inicio.getTime() > ahora && c.estadoCita !== "cancelada") citasFuturas += 1;
      // Ya empezó: queda como historial de solo lectura, así que no puede
      // entrar abierta (aparecería en "citas pasadas sin cerrar" sin poder
      // cerrarse). La base aplica la misma regla al insertar.
      const estadoCita = cerrarSiYaPaso(c.estadoCita, inicio.getTime() <= ahora);
      if (estadoCita !== c.estadoCita) {
        mensajes.push("Ya pasó y no traía un estado cerrado: se importa como atendida.");
      }
      paraLaBase.set(c.fila, {
        fila: c.fila,
        patient_id: pacienteId,
        professional_id: professionalId,
        branch_id: sucursal.id,
        inicio: inicioIso,
        fin: finIso,
        estado: estadoCita,
        motivo: c.motivo,
        notas: c.notas,
        externo: c.externo,
        original: e.originales[c.fila - 1] ? filaOriginal(e.originales[c.fila - 1]) : null,
      });
    }

    return {
      fila: c.fila,
      estado,
      accion: estado === "error" ? "error" : estado === "duplicada" ? "omitir" : "crear",
      titulo: c.pacienteNombre ?? c.pacienteDocumento ?? c.pacienteExterno ?? "(sin paciente)",
      detalle:
        [c.inicioLocal?.replace("T", " "), c.profesional, c.motivo].filter(Boolean).join(" · ") ||
        null,
      mensajes,
      pacienteId,
      via,
    };
  });

  return {
    vista: {
      tipo: "citas",
      filas,
      resumen: contar(filas),
      profesionalesSinPar: [...sinPar].sort(),
      profesionales,
      sucursales: sucursales.map((s) => ({ id: s.id, nombre: s.nombre })),
      citasFuturas,
    },
    paraLaBase,
  };
}

// ─── Server functions ──────────────────────────────────────────────────────

export const vistaPreviaMigracion = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) => entradaSchema.parse(input))
  .handler(async ({ data, context }): Promise<VistaPrevia> => {
    await exigirGestion(context.supabase, data.clinicId, context.userId);
    return data.tipo === "pacientes"
      ? (await planificarPacientes(context.supabase, data)).vista
      : (await planificarCitas(context.supabase, data)).vista;
  });

export interface ResultadoImportacion {
  loteId: string;
  creados: number;
  actualizados: number;
  omitidos: number;
  fallidos: number;
  errores: { fila: number; mensaje: string }[];
}

type ResultadoFila = { fila: number; accion: string; id: string | null; mensaje: string | null };

export const importarLoteMigracion = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    entradaSchema
      .extend({
        nombreArchivo: z.string().trim().max(200).nullable().default(null),
        politicaDuplicados: z.enum(["omitir", "completar"]).default("omitir"),
        incluirEnRecordatorios: z.boolean().default(false),
        /** La cifra que la persona confirmó en pantalla. */
        confirmacion: z.number().int().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ResultadoImportacion> => {
    const { supabase, userId } = context;
    await exigirGestion(supabase, data.clinicId, userId);

    // Se vuelve a calcular todo: lo que se escribe es lo que ve el servidor.
    let filasBase: Record<string, unknown>[];
    let total: number;
    if (data.tipo === "pacientes") {
      const plan = await planificarPacientes(supabase, data);
      const { pais } = await datosDeLaClinica(supabase, data.clinicId);
      total = afectadas(plan.vista.filas, data.politicaDuplicados);
      filasBase = plan.preparadas.flatMap((p) => {
        const c = plan.coincidencias.get(p.fila) ?? null;
        const base = filaParaLaBase(p, data.originales[p.fila - 1], pais);
        if (p.estado === "valida" && !c) return [base];
        if (p.estado === "valida" && c && data.politicaDuplicados === "completar") {
          return [{ ...base, accion: "completar", patient_id: c.patientId }];
        }
        return [];
      });
    } else {
      const plan = await planificarCitas(supabase, data);
      total = plan.vista.resumen.validas;
      filasBase = plan.vista.filas
        .filter((f) => f.estado === "valida")
        .map((f) => plan.paraLaBase.get(f.fila))
        .filter((f): f is Record<string, unknown> => Boolean(f));
    }

    if (total !== data.confirmacion || filasBase.length !== total) {
      throw new Error(
        `La vista previa cambió (ahora son ${total} registros, confirmaste ${data.confirmacion}). Vuelve a revisarla antes de importar.`,
      );
    }

    const { data: lote, error: errLote } = await supabase
      .from("import_batches")
      .insert({
        clinic_id: data.clinicId,
        kind: data.tipo,
        source: data.perfil,
        file_name: data.nombreArchivo,
        rows_total: data.filas.length,
        duplicate_policy: data.tipo === "pacientes" ? data.politicaDuplicados : null,
        include_in_reminders: data.tipo === "citas" && data.incluirEnRecordatorios,
        created_by: userId,
      })
      .select("id")
      .single();
    if (errLote) throw new Error(mensajeDb(errLote, "No pudimos abrir el lote de importación."));

    const resultado: ResultadoImportacion = {
      loteId: lote.id,
      creados: 0,
      actualizados: 0,
      omitidos: 0,
      fallidos: 0,
      errores: [],
    };
    const creadosConDocumento: string[] = [];

    for (let i = 0; i < filasBase.length; i += TAMANO_BLOQUE) {
      const bloque = filasBase.slice(i, i + TAMANO_BLOQUE);
      const { data: res, error } = await supabase.rpc("migracion_importar_bloque", {
        p_batch_id: lote.id,
        p_filas: bloque as unknown as Json,
      });
      if (error) {
        // El bloque entero falló (no una fila): se cuenta como fallido y se
        // sigue con el resto; lo ya escrito queda en el lote y se puede deshacer.
        resultado.fallidos += bloque.length;
        resultado.errores.push({
          fila: Number(bloque[0].fila),
          mensaje: mensajeDb(error, "No pudimos escribir este bloque."),
        });
        continue;
      }
      for (const r of (res as unknown as ResultadoFila[]) ?? []) {
        if (r.accion === "creado") {
          resultado.creados += 1;
          if (data.tipo === "pacientes" && r.id) creadosConDocumento.push(r.id);
        } else if (r.accion === "actualizado") resultado.actualizados += 1;
        else if (r.accion === "omitido") resultado.omitidos += 1;
        else {
          resultado.fallidos += 1;
          if (resultado.errores.length < 200) {
            resultado.errores.push({ fila: r.fila, mensaje: r.mensaje ?? "Error desconocido." });
          }
        }
      }
    }

    const { error: errCierre } = await supabase
      .from("import_batches")
      .update({ status: "completado", completed_at: new Date().toISOString() })
      .eq("id", lote.id)
      .eq("clinic_id", data.clinicId);
    if (errCierre) throw new Error(mensajeDb(errCierre, "No pudimos cerrar el lote."));

    // SEG-03: mismo criterio que el alta de pacientes: el trigger cifra el
    // documento; acá solo se verifica y se avisa a Sentry si quedó en claro.
    if (creadosConDocumento.length > 0) {
      for (let i = 0; i < creadosConDocumento.length; i += 200) {
        await vigilarCifradoDeDocumento(
          supabase,
          creadosConDocumento.slice(i, i + 200),
          "importacion",
        );
      }
    }

    return resultado;
  });

export interface LoteDeMigracion {
  id: string;
  tipo: TipoLote;
  perfil: string;
  archivo: string | null;
  estado: "en_curso" | "completado" | "deshecho";
  creadoPor: string | null;
  creadoEn: string;
  deshechoEn: string | null;
  deshechoPor: string | null;
  total: number;
  creados: number;
  actualizados: number;
  omitidos: number;
  fallidos: number;
  politica: string | null;
  enRecordatorios: boolean;
}

export const listarLotesDeMigracion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ clinicId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<LoteDeMigracion[]> => {
    const { supabase, userId } = context;
    await exigirGestion(supabase, data.clinicId, userId);
    const { data: lotes, error } = await supabase
      .from("import_batches")
      .select(
        "id, kind, source, file_name, status, created_by, created_at, reverted_at, reverted_by, rows_total, rows_created, rows_updated, rows_skipped, rows_failed, duplicate_policy, include_in_reminders",
      )
      .eq("clinic_id", data.clinicId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(mensajeDb(error, "No pudimos cargar los lotes de importación."));

    const ids = [
      ...new Set(
        (lotes ?? [])
          .flatMap((l) => [l.created_by, l.reverted_by])
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    const nombres = new Map<string, string>();
    if (ids.length > 0) {
      const { data: perfiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      for (const p of perfiles ?? []) nombres.set(p.id, p.full_name || p.email || "");
    }

    return (lotes ?? []).map((l) => ({
      id: l.id,
      tipo: l.kind as TipoLote,
      perfil: l.source,
      archivo: l.file_name,
      estado: l.status as LoteDeMigracion["estado"],
      creadoPor: nombres.get(l.created_by) ?? null,
      creadoEn: l.created_at,
      deshechoEn: l.reverted_at,
      deshechoPor: l.reverted_by ? (nombres.get(l.reverted_by) ?? null) : null,
      total: l.rows_total,
      creados: l.rows_created,
      actualizados: l.rows_updated,
      omitidos: l.rows_skipped,
      fallidos: l.rows_failed,
      politica: l.duplicate_policy,
      enRecordatorios: l.include_in_reminders,
    }));
  });

export const revisarReversaDeLote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), loteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ motivos: string[]; registros: number }> => {
    const { supabase, userId } = context;
    await exigirGestion(supabase, data.clinicId, userId);
    const [{ data: bloqueos, error }, pac, citas] = await Promise.all([
      supabase.rpc("migracion_bloqueos_de_lote", { p_batch_id: data.loteId }),
      supabase
        .from("patients")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", data.clinicId)
        .eq("import_batch_id", data.loteId),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", data.clinicId)
        .eq("import_batch_id", data.loteId),
    ]);
    if (error)
      throw new Error(mensajeDb(error, "No pudimos revisar si el lote se puede deshacer."));
    return {
      motivos: (bloqueos ?? []).map(explicarBloqueo),
      registros: (pac.count ?? 0) + (citas.count ?? 0),
    };
  });

export const deshacerLoteMigracion = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z
      .object({
        clinicId: z.string().uuid(),
        loteId: z.string().uuid(),
        /** Registros que la persona vio que se iban a borrar. */
        confirmacion: z.number().int().min(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await exigirGestion(supabase, data.clinicId, userId);
    const { data: lote } = await supabase
      .from("import_batches")
      .select("id")
      .eq("id", data.loteId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (!lote) throw new Error("No encontramos el lote de importación.");

    const [pac, citas] = await Promise.all([
      supabase
        .from("patients")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", data.clinicId)
        .eq("import_batch_id", data.loteId),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", data.clinicId)
        .eq("import_batch_id", data.loteId),
    ]);
    const registros = (pac.count ?? 0) + (citas.count ?? 0);
    if (registros !== data.confirmacion) {
      throw new Error(
        `El lote cambió (ahora son ${registros} registros). Vuelve a abrir la reversa para revisarla.`,
      );
    }

    const { data: res, error } = await supabase.rpc("migracion_deshacer_lote", {
      p_batch_id: data.loteId,
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos deshacer el lote."));
    return res as unknown as { pacientes: number; citas: number; campos_vaciados: number };
  });

export const activarRecordatoriosDeLote = createServerFn({ method: "POST" })
  .middleware([requireEscritura])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), loteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ citas: number }> => {
    const { supabase, userId } = context;
    await exigirGestion(supabase, data.clinicId, userId);
    const { data: lote } = await supabase
      .from("import_batches")
      .select("id")
      .eq("id", data.loteId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (!lote) throw new Error("No encontramos el lote de importación.");
    const { data: n, error } = await supabase.rpc("migracion_activar_recordatorios", {
      p_batch_id: data.loteId,
    });
    if (error) throw new Error(mensajeDb(error, "No pudimos activar los recordatorios del lote."));
    return { citas: n ?? 0 };
  });

/** Sello "Importado de <origen> el <fecha>" y dato de origen de una ficha (EXP-06). */
export interface OrigenImportado {
  origen: string;
  importadoEn: string;
  original: Record<string, string> | null;
}

export const origenDeLaFicha = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ clinicId: z.string().uuid(), patientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<OrigenImportado | null> => {
    const { data: fila, error } = await context.supabase
      .from("patients")
      .select("import_source, imported_at, import_original")
      .eq("id", data.patientId)
      .eq("clinic_id", data.clinicId)
      .maybeSingle();
    if (error) throw new Error(mensajeDb(error, "No pudimos leer el origen de la ficha."));
    if (!fila?.imported_at || !fila.import_source) return null;
    const original =
      fila.import_original &&
      typeof fila.import_original === "object" &&
      !Array.isArray(fila.import_original)
        ? Object.fromEntries(
            Object.entries(fila.import_original as Record<string, unknown>).map(([k, v]) => [
              k,
              String(v ?? ""),
            ]),
          )
        : null;
    return { origen: fila.import_source, importadoEn: fila.imported_at, original };
  });
