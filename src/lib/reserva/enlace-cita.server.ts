import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { appOrigin } from "@/lib/app-origin.server";

/**
 * Link firmado para que el paciente gestione su cita (RES-05 + REC-11):
 * `<origen>/mi-cita/<token>`. Ahí la ve, confirma que va, la cancela o la
 * reagenda.
 *
 * CONTRATO (lo consume el frente de correos automáticos, no cambiarlo):
 *   enlaceGestionCita({ appointmentId, clinicId, expiraEn? }) → URL absoluta
 *   Síncrono y solo de servidor.
 *
 * El token es autocontenido (nada se guarda en la base, tampoco en claro):
 *   base64url(JSON {v, p, a, c, e}) + "." + base64url(HMAC-SHA256)
 * - `p = "mi-cita"`: un solo propósito; un token de otro uso no sirve acá.
 * - `e`: vencimiento en segundos epoch (por defecto, 90 días).
 * - La clave es una subclave derivada de `PORTAL_TOKEN_SECRET` (la del portal
 *   del paciente, ya cargada en Vercel) con HMAC y la etiqueta de este uso:
 *   un token del portal no valida acá ni al revés. En desarrollo, sin la
 *   variable, una clave al azar por proceso (como el portal).
 */

type Proposito = "mi-cita" | "reserva-recall";
const PROPOSITO: Proposito = "mi-cita";
const VERSION = 1;
const TTL_POR_DEFECTO_MS = 90 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{20,400}\.[A-Za-z0-9_-]{43}$/;

let claveDev: Buffer | null = null;

function secretoBase(): Buffer {
  const raw = process.env.PORTAL_TOKEN_SECRET;
  if (raw) return Buffer.from(raw, "utf8");
  if (process.env.NODE_ENV !== "production") {
    if (!claveDev) {
      console.warn(
        "[mi-cita] Usando una clave de desarrollo al azar (no persiste entre reinicios). En producción se usa PORTAL_TOKEN_SECRET.",
      );
      claveDev = randomBytes(32);
    }
    return claveDev;
  }
  throw new Error("PORTAL_TOKEN_SECRET no configurada.");
}

function subclave(proposito: Proposito): Buffer {
  return createHmac("sha256", secretoBase()).update(`esmalia:${proposito}:v1`).digest();
}

function firmar(cuerpo: string, proposito: Proposito): string {
  return createHmac("sha256", subclave(proposito)).update(cuerpo).digest("base64url");
}

function emitir(proposito: Proposito, a: string, c: string, expira: Date): string {
  if (!UUID.test(a) || !UUID.test(c)) throw new Error("Datos inválidos para el link.");
  const e = Math.floor(expira.getTime() / 1000);
  if (!Number.isFinite(e)) throw new Error("Vencimiento inválido para el link.");
  const cuerpo = Buffer.from(
    JSON.stringify({ v: VERSION, p: proposito, a: a.toLowerCase(), c: c.toLowerCase(), e }),
    "utf8",
  ).toString("base64url");
  return `${cuerpo}.${firmar(cuerpo, proposito)}`;
}

type Verificado =
  | { ok: true; a: string; c: string; expiraEn: Date }
  | { ok: false; motivo: "invalido" | "vencido" };

function verificar(proposito: Proposito, token: unknown, ahora: Date): Verificado {
  if (typeof token !== "string" || !TOKEN.test(token)) return { ok: false, motivo: "invalido" };
  const [cuerpo, firma] = token.split(".");
  const esperada = Buffer.from(firmar(cuerpo, proposito), "base64url");
  const recibida = Buffer.from(firma, "base64url");
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) {
    return { ok: false, motivo: "invalido" };
  }
  let d: { v?: unknown; p?: unknown; a?: unknown; c?: unknown; e?: unknown };
  try {
    d = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as typeof d;
  } catch {
    return { ok: false, motivo: "invalido" };
  }
  if (
    !d ||
    d.v !== VERSION ||
    d.p !== proposito ||
    typeof d.a !== "string" ||
    typeof d.c !== "string" ||
    typeof d.e !== "number" ||
    !UUID.test(d.a) ||
    !UUID.test(d.c)
  ) {
    return { ok: false, motivo: "invalido" };
  }
  if (d.e * 1000 <= ahora.getTime()) return { ok: false, motivo: "vencido" };
  return { ok: true, a: d.a, c: d.c, expiraEn: new Date(d.e * 1000) };
}

export interface CitaFirmada {
  appointmentId: string;
  clinicId: string;
  expiraEn: Date;
}

/** Token firmado (sin el origen). */
export function tokenGestionCita(input: {
  appointmentId: string;
  clinicId: string;
  expiraEn?: Date;
}): string {
  return emitir(
    PROPOSITO,
    input.appointmentId,
    input.clinicId,
    input.expiraEn ?? new Date(Date.now() + TTL_POR_DEFECTO_MS),
  );
}

/** URL absoluta para que el paciente gestione su cita. Síncrona, solo servidor. */
export function enlaceGestionCita(input: {
  appointmentId: string;
  clinicId: string;
  expiraEn?: Date;
}): string {
  return `${appOrigin()}/mi-cita/${tokenGestionCita(input)}`;
}

export type VerificacionToken =
  { ok: true; cita: CitaFirmada } | { ok: false; motivo: "invalido" | "vencido" };

/** Valida firma, propósito y vencimiento. Nunca lanza. */
export function verificarTokenGestionCita(
  token: unknown,
  ahora: Date = new Date(),
): VerificacionToken {
  const r = verificar(PROPOSITO, token, ahora);
  if (!r.ok) return r;
  return { ok: true, cita: { appointmentId: r.a, clinicId: r.c, expiraEn: r.expiraEn } };
}

/**
 * MKT-06: token del recall para prellenar la reserva con el paciente
 * (`/reservar/<slug>?r=<token>`). Propósito propio: no abre su cita ni el
 * portal. Solo sirve para saludarlo y precargar su nombre.
 */
export function tokenRecallReserva(input: { patientId: string; clinicId: string }): string {
  return emitir(
    "reserva-recall",
    input.patientId,
    input.clinicId,
    new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
  );
}

export function verificarTokenRecall(
  token: unknown,
  ahora: Date = new Date(),
): { ok: true; patientId: string; clinicId: string } | { ok: false } {
  const r = verificar("reserva-recall", token, ahora);
  return r.ok ? { ok: true, patientId: r.a, clinicId: r.c } : { ok: false };
}
