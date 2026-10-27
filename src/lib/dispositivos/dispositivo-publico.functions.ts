import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  DispositivoInvalido,
  exigirDispositivo,
  admin,
  type Dispositivo,
} from "@/lib/dispositivos/dispositivo.server";
import {
  etiquetaDeSala,
  huellaDeCodigo,
  nombreCortoDe,
  normalizarCodigoVinculacion,
  type TipoDispositivo,
} from "@/lib/dispositivos/dispositivos";
import { ipYNavegador } from "@/lib/firma-distancia/firma.server";
import { generarSecreto, huellaDeSecreto } from "@/lib/firma-distancia/token";
import { checkRateLimit } from "@/lib/rate-limit.server";
import { actualYSiguiente, type EstadoCitaBox } from "@/lib/totem/totem";

/**
 * Server functions de las pantallas de dispositivo sin login (AUT-04 a
 * AUT-06): vincular con el código, saber quién es, la TV de la sala y la
 * pantalla del box. El token viaja en el cuerpo (POST); nada se guarda en el
 * navegador más allá de él.
 */

const TokenSchema = z.string().max(80);

export type ConDispositivo<T> = { invalido: true } | ({ invalido: false } & T);

async function conDispositivo<T>(
  token: string,
  tipo: TipoDispositivo | null,
  fn: (d: Dispositivo, db: Awaited<ReturnType<typeof admin>>) => Promise<T>,
): Promise<ConDispositivo<T>> {
  try {
    const { db, dispositivo } = await exigirDispositivo(token, tipo);
    return { invalido: false, ...(await fn(dispositivo, db)) };
  } catch (e) {
    if (e instanceof DispositivoInvalido) return { invalido: true };
    throw e;
  }
}

// ─── Vincular ─────────────────────────────────────────────────────────────

export type Vinculacion =
  { ok: true; token: string; tipo: TipoDispositivo } | { ok: false; motivo: string };

export const vincularDispositivo = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ codigo: z.string().max(20) }).parse(input))
  .handler(async ({ data }): Promise<Vinculacion> => {
    const { ip } = ipYNavegador();
    const r = checkRateLimit(ip ?? "unknown", {
      scope: "vincular-dispositivo",
      windowMs: 60_000,
      max: 10,
    });
    if (r.limited) {
      return {
        ok: false,
        motivo: `Demasiados intentos. Espera ${r.retryAfterSeconds} segundos.`,
      };
    }
    const codigo = normalizarCodigoVinculacion(data.codigo);
    if (!codigo) return { ok: false, motivo: "Revisa el código: son 8 letras y números." };
    const token = generarSecreto();
    const db = await admin();
    const { data: res, error } = await db.rpc("dispositivo_vincular", {
      p_code_hash: await huellaDeCodigo(codigo),
      p_token_hash: await huellaDeSecreto(token),
    });
    if (error) throw new Error("No pudimos vincular el dispositivo. Vuelve a intentarlo.");
    const j = (res ?? {}) as Record<string, unknown>;
    if (j.ok !== true || (j.kind !== "totem" && j.kind !== "sala" && j.kind !== "box")) {
      return {
        ok: false,
        motivo: "El código no es válido o ya venció. Genera uno nuevo en Ajustes → Dispositivos.",
      };
    }
    return { ok: true, token, tipo: j.kind };
  });

// ─── Quién soy ────────────────────────────────────────────────────────────

export interface IdentidadDispositivo {
  tipo: TipoDispositivo;
  nombre: string;
  clinica: string;
  sucursal: string;
  box: string | null;
  zona: string;
  pais: string | null;
}

export const verDispositivo = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: TokenSchema }).parse(input))
  .handler(async ({ data }): Promise<ConDispositivo<{ dispositivo: IdentidadDispositivo }>> =>
    conDispositivo(data.token, null, async (d) => ({
      dispositivo: {
        tipo: d.tipo,
        nombre: d.nombre,
        clinica: d.clinica,
        sucursal: d.sucursal,
        box: d.box,
        zona: d.zona,
        pais: d.pais,
      },
    })),
  );

// ─── Sala de espera (TV) ──────────────────────────────────────────────────

export interface PersonaEnSala {
  turno: string | null;
  nombre: string | null;
}

export interface LlamadoEnSala extends PersonaEnSala {
  box: string | null;
  llamadoEn: string;
  veces: number;
}

export interface EstadoSala {
  clinica: string;
  sucursal: string;
  zona: string;
  actual: LlamadoEnSala | null;
  recientes: LlamadoEnSala[];
  enEspera: PersonaEnSala[];
}

/** Un llamado es "actual" durante 10 minutos. */
const MINUTOS_LLAMADO_ACTUAL = 10;

type Obj = Record<string, unknown>;
const lista = (v: unknown): Obj[] =>
  Array.isArray(v) ? v.filter((x): x is Obj => Boolean(x) && typeof x === "object") : [];
const textoDe = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const numeroDe = (v: unknown): number | null => (typeof v === "number" ? v : null);

export const estadoDeSala = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: TokenSchema }).parse(input))
  .handler(async ({ data }): Promise<ConDispositivo<{ sala: EstadoSala }>> =>
    conDispositivo(data.token, "sala", async (d, db) => {
      const { data: res, error } = await db.rpc("sala_estado", { p_device_id: d.id });
      if (error) throw new Error("No pudimos leer la sala de espera.");
      const j = (res ?? {}) as Obj;
      // El nombre completo se reduce acá, en el servidor: a la TV solo llega
      // la etiqueta que permite la privacidad del dispositivo.
      const llamados: LlamadoEnSala[] = lista(j.llamados).map((l) => ({
        ...etiquetaDeSala(textoDe(l.nombre) ?? "", numeroDe(l.turno), d.privacidad),
        box: textoDe(l.box),
        llamadoEn: textoDe(l.llamado_en) ?? new Date().toISOString(),
        veces: numeroDe(l.veces) ?? 1,
      }));
      const primero = llamados[0];
      const esActual =
        primero &&
        Date.now() - new Date(primero.llamadoEn).getTime() < MINUTOS_LLAMADO_ACTUAL * 60_000;
      return {
        sala: {
          clinica: d.clinica,
          sucursal: d.sucursal,
          zona: d.zona,
          actual: esActual ? primero : null,
          recientes: esActual ? llamados.slice(1) : llamados,
          enEspera: lista(j.en_espera).map((p) =>
            etiquetaDeSala(textoDe(p.nombre) ?? "", numeroDe(p.turno), d.privacidad),
          ),
        },
      };
    }),
  );

// ─── Pantalla del box ─────────────────────────────────────────────────────

export interface CitaEnBox {
  id: string;
  inicio: string;
  fin: string;
  estado: EstadoCitaBox;
  paciente: string;
  tratamiento: string | null;
  profesional: string | null;
  turno: number | null;
  llamadoEn: string | null;
  llamadoAqui: boolean;
}

export interface EstadoBox {
  clinica: string;
  sucursal: string;
  box: string | null;
  zona: string;
  sinBox: boolean;
  actual: CitaEnBox | null;
  siguiente: CitaEnBox | null;
  llamable: CitaEnBox | null;
  /** Citas que quedan hoy (sin la actual). */
  quedan: number;
}

const ESTADOS: readonly EstadoCitaBox[] = [
  "tentativa",
  "confirmada",
  "en-sala",
  "ausente",
  "finalizada",
  "cancelada",
];

export const estadoDeBox = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: TokenSchema }).parse(input))
  .handler(async ({ data }): Promise<ConDispositivo<{ box: EstadoBox }>> =>
    conDispositivo(data.token, "box", async (d, db) => {
      const { data: res, error } = await db.rpc("box_estado", { p_device_id: d.id });
      if (error) throw new Error("No pudimos leer las citas del box.");
      const j = (res ?? {}) as Obj;
      const citas: CitaEnBox[] = lista(j.citas).flatMap((c) => {
        const id = textoDe(c.id);
        const inicio = textoDe(c.inicio);
        const fin = textoDe(c.fin);
        const estado = ESTADOS.find((e) => e === c.estado);
        if (!id || !inicio || !fin || !estado) return [];
        return [
          {
            id,
            inicio,
            fin,
            estado,
            // Datos mínimos: nombre corto, nunca el RUT.
            paciente: nombreCortoDe(textoDe(c.nombre) ?? "") || "Paciente",
            tratamiento: textoDe(c.tratamiento),
            profesional: textoDe(c.profesional),
            turno: numeroDe(c.turno),
            llamadoEn: textoDe(c.llamado_en),
            llamadoAqui: c.llamado_aqui === true,
          },
        ];
      });
      const { actual, siguiente, llamable } = actualYSiguiente(citas);
      const quedan = citas.filter(
        (c) =>
          c.id !== actual?.id &&
          (c.estado === "tentativa" || c.estado === "confirmada" || c.estado === "en-sala"),
      ).length;
      return {
        box: {
          clinica: d.clinica,
          sucursal: d.sucursal,
          box: d.box,
          zona: d.zona,
          sinBox: j.sin_box === true,
          actual,
          siguiente,
          llamable,
          quedan,
        },
      };
    }),
  );

export type ResultadoLlamado = { ok: true; turno: number | null } | { ok: false; motivo: string };

export const llamarDesdeBox = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ token: TokenSchema, appointmentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }): Promise<ConDispositivo<{ resultado: ResultadoLlamado }>> =>
    conDispositivo(data.token, "box", async (d, db) => {
      const { data: res, error } = await db.rpc("dispositivo_llamar", {
        p_device_id: d.id,
        p_appointment_id: data.appointmentId,
      });
      if (error) throw new Error("No pudimos llamar al paciente.");
      const j = (res ?? {}) as Obj;
      return {
        resultado:
          j.ok === true
            ? { ok: true, turno: numeroDe(j.turno) }
            : {
                ok: false,
                motivo:
                  j.motivo === "no_en_sala"
                    ? "Ese paciente todavía no marca su llegada."
                    : "No pudimos llamar a ese paciente.",
              },
      };
    }),
  );
