// src/lib/auth/mfa-correo.ts
//
// Verificación en dos pasos con un código por correo (SEG-01, pedido de
// Walter del 26-oct-2026). Lógica pura, sin red: la comparten el servidor
// (`mfa-correo.functions.ts`), la interfaz y los tests.
//
// Supabase Auth solo tiene factores TOTP y teléfono, y un código por correo
// no sube la sesión a `aal2`. Por eso la verificación por correo se registra
// en la base atada al `session_id` del JWT (migración
// 20261026900000_mfa_por_correo.sql) y `sesion_cumple_mfa()` la acepta igual
// que `aal2`. Detalle en docs/MFA.md.

import { renderCorreo, type CorreoRenderizado } from "@/lib/email/layout";
import { sha256Hex } from "@/lib/firma-distancia/token";

export type MetodoMfa = "totp" | "email";

export const MINUTOS_VIGENCIA_CODIGO_CORREO = 10;
export const INTENTOS_CODIGO_CORREO = 5;

/** Huella que guarda la base: atada al usuario y a la sesión, así el mismo
 *  código no sirve en otra sesión ni para otra cuenta. */
export function huellaCodigoMfaCorreo(
  userId: string,
  sessionId: string,
  codigo: string,
): Promise<string> {
  return sha256Hex(`mfa-correo:${userId}:${sessionId}:${codigo}`);
}

/** "walter@gmail.com" → "wa•••@gmail.com". Para mostrar a dónde llega el
 *  código sin escribir la dirección completa en pantalla. */
export function enmascararCorreo(email: string | null | undefined): string | null {
  const limpio = (email ?? "").trim();
  const arroba = limpio.lastIndexOf("@");
  if (arroba < 1 || arroba === limpio.length - 1) return null;
  const usuario = limpio.slice(0, arroba);
  const dominio = limpio.slice(arroba + 1);
  const visible = usuario.length <= 2 ? usuario.slice(0, 1) : usuario.slice(0, 2);
  return `${visible}•••@${dominio}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

/** `session_id` del payload de un JWT de Supabase (sin verificar la firma:
 *  en el cliente solo sirve como clave de cache; el servidor y la base usan
 *  el JWT verificado). */
export function sessionIdDeToken(token: string | null | undefined): string | null {
  const partes = (token ?? "").split(".");
  if (partes.length !== 3) return null;
  try {
    const b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=")));
    const id = (json as { session_id?: unknown }).session_id;
    return esUuid(id) ? id : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ¿Se le puede mandar el código a este usuario?
// ---------------------------------------------------------------------------

export type MotivoCorreoNoDisponible =
  "sin_configurar" | "sin_correo" | "correo_sin_confirmar" | "correo_reservado" | "demo";

export const TEXTO_CORREO_NO_DISPONIBLE: Record<MotivoCorreoNoDisponible, string> = {
  sin_configurar:
    "El envío de correos de Esmalia no está disponible en este momento. Usa la app autenticadora.",
  sin_correo: "Tu cuenta no tiene un correo al que mandarte el código.",
  correo_sin_confirmar:
    "Primero confirma tu correo con el enlace que te mandamos al crear la cuenta.",
  correo_reservado:
    "Tu cuenta usa un correo de prueba que no recibe mensajes. Cámbialo por uno real para usar esta opción.",
  demo: "La cuenta de la demo es compartida: no admite verificación en dos pasos.",
};

const DOMINIOS_RESERVADOS = /(^|\.)(example\.(com|net|org)|test|invalid|localhost|local)$/i;

/** Decide si el correo como segundo paso se puede ofrecer (`null`) o por
 *  qué no. Nunca redirige: un código de acceso que llega a otra dirección
 *  (modo de prueba de la clínica) se lo entrega a otra persona. */
export function motivoCorreoNoDisponible(input: {
  envioConfigurado: boolean;
  email: string | null | undefined;
  emailConfirmado: boolean;
  esDemo: boolean;
}): MotivoCorreoNoDisponible | null {
  if (input.esDemo) return "demo";
  if (!input.envioConfigurado) return "sin_configurar";
  const email = (input.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "sin_correo";
  if (!input.emailConfirmado) return "correo_sin_confirmar";
  if (DOMINIOS_RESERVADOS.test(email.slice(email.lastIndexOf("@") + 1))) return "correo_reservado";
  return null;
}

// ---------------------------------------------------------------------------
// Qué se le pide al entrar
// ---------------------------------------------------------------------------

export type EstadoMetodos = {
  tieneTotp: boolean;
  correoActivo: boolean;
  metodoPreferido: MetodoMfa;
};

/** Métodos con los que esta cuenta puede pasar el segundo paso, el
 *  preferido primero. */
export function metodosDisponibles(e: EstadoMetodos): MetodoMfa[] {
  const metodos: MetodoMfa[] = [];
  if (e.tieneTotp) metodos.push("totp");
  if (e.correoActivo) metodos.push("email");
  if (metodos.length === 2 && e.metodoPreferido === "email") metodos.reverse();
  return metodos;
}

/** Texto corto de lo que se le pide al entrar (Ajustes → Seguridad). */
export function resumenAlEntrar(e: EstadoMetodos, correoEnmascarado: string | null): string {
  const metodos = metodosDisponibles(e);
  const correo = correoEnmascarado
    ? `un código que te mandamos a ${correoEnmascarado}`
    : "un código que te mandamos por correo";
  const app = "el código de tu app autenticadora";
  if (metodos.length === 0) return "Al entrar te pedimos solo tu contraseña.";
  if (metodos.length === 1) {
    return `Al entrar te pedimos tu contraseña y ${metodos[0] === "totp" ? app : correo}.`;
  }
  const [primero, segundo] = metodos.map((m) => (m === "totp" ? app : correo));
  return `Al entrar te pedimos tu contraseña y ${primero}. Si no lo tienes a mano, puedes usar ${segundo}.`;
}

// ---------------------------------------------------------------------------
// Respuestas de la base → textos
// ---------------------------------------------------------------------------

export const TEXTO_MOTIVO_CODIGO: Record<string, string> = {
  invalida: "No pudimos procesar el pedido. Vuelve a intentarlo.",
  no_activo: "Tu cuenta no tiene activado el código por correo.",
  ya_activo: "El código por correo ya está activado en tu cuenta.",
  demasiados: "Pediste demasiados códigos en la última hora. Espera un rato o usa otro método.",
  sin_codigo: "No hay un código vigente para esta sesión. Pide uno nuevo.",
  vencido: "El código venció. Pide uno nuevo.",
  agotado: "Te equivocaste demasiadas veces con ese código. Pide uno nuevo.",
  incorrecto: "El código no coincide.",
};

export function textoEspera(segundos: number | null | undefined): string {
  const s = Math.max(1, Math.round(segundos ?? 60));
  return `Ya te mandamos un código. Puedes pedir otro en ${s} segundos.`;
}

// ---------------------------------------------------------------------------
// Correo con el código
// ---------------------------------------------------------------------------

export function codigoLegibleMfa(codigo: string): string {
  return codigo.length === 6 ? `${codigo.slice(0, 3)} ${codigo.slice(3)}` : codigo;
}

/** El correo con el código. Sin el nombre de la clínica ni datos de la
 *  cuenta: solo el código, cuánto dura y qué hacer si no lo pidió. */
export function correoCodigoMfa(d: {
  appUrl: string;
  codigo: string;
  proposito: "login" | "activar";
}): CorreoRenderizado {
  const minutos = MINUTOS_VIGENCIA_CODIGO_CORREO;
  const para =
    d.proposito === "activar"
      ? "Este es tu código para activar la verificación en dos pasos por correo en Esmalia:"
      : "Este es tu código para terminar de entrar a Esmalia:";
  return renderCorreo({
    appUrl: d.appUrl,
    asunto: `Tu código de Esmalia: ${codigoLegibleMfa(d.codigo)}`,
    preencabezado: `Vence en ${minutos} minutos.`,
    titulo: "Verificación en dos pasos",
    bloques: [
      { tipo: "parrafo", partes: ["Hola:"] },
      { tipo: "parrafo", partes: [para] },
      {
        tipo: "cifra",
        etiqueta: "Código",
        valor: codigoLegibleMfa(d.codigo),
        detalle: `Vence en ${minutos} minutos y sirve una sola vez`,
      },
      {
        tipo: "parrafo",
        tenue: true,
        partes: [
          "Escríbelo en la pantalla de Esmalia donde te lo pidieron. Nadie de Esmalia ni de tu clínica te lo va a pedir: no lo compartas.",
        ],
      },
      {
        tipo: "parrafo",
        tenue: true,
        partes: [
          "Si no fuiste tú, alguien tiene tu contraseña: cámbiala de inmediato y escríbenos a soporte@esmalia.com.",
        ],
      },
    ],
    pie: {
      motivo: "Recibes este correo porque se pidió un código de acceso para tu cuenta de Esmalia.",
    },
  });
}
