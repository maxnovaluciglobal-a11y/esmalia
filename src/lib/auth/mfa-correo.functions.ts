/**
 * Segundo paso por correo (SEG-01, 26-oct-2026): server functions.
 *
 * Todas usan `requireSupabaseAuth` y NO el middleware de escritura: son la
 * seguridad de la propia cuenta, no datos de la clínica, y tienen que andar
 * con la suscripción impaga (están en `ESCRITURA_EXENTA`).
 *
 * Fronteras:
 * - El `session_id` y el `aal` salen del JWT verificado (`context.claims`),
 *   nunca del cliente. El código se ata a usuario + sesión.
 * - Activar el correo exige inicio de sesión reciente y, si la cuenta ya
 *   tiene la app autenticadora, una sesión `aal2`: con la contraseña sola no
 *   se suma un método que esquive el TOTP.
 * - Desactivar el correo o cambiar el método preferido exige una sesión que
 *   ya cumple el segundo paso (`mi_estado_mfa().sesion_cumple`).
 * - Ninguna recibe una dirección de correo: el código va al correo de la
 *   cuenta, leído con el rol de servicio. No hay forma de preguntar por otra.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sesionReciente } from "@/lib/auth/mfa";
import {
  enmascararCorreo,
  esUuid,
  huellaCodigoMfaCorreo,
  motivoCorreoNoDisponible,
  TEXTO_CORREO_NO_DISPONIBLE,
  TEXTO_MOTIVO_CODIGO,
  textoEspera,
  type MetodoMfa,
  type MotivoCorreoNoDisponible,
} from "@/lib/auth/mfa-correo";
import { esCuentaDemo } from "@/lib/demo-cuenta";
import { generarCodigo, normalizarCodigo } from "@/lib/firma-distancia/token";

export type EstadoSegundoPaso = {
  tieneTotp: boolean;
  correoActivo: boolean;
  metodoPreferido: MetodoMfa;
  /** Esta sesión ya pasó el segundo paso (aal2 o código por correo). */
  sesionCumple: boolean;
  sesionVerificadaPorCorreo: boolean;
  correoEnmascarado: string | null;
  /** `null` si el correo se puede usar como segundo paso. */
  correoNoDisponible: MotivoCorreoNoDisponible | null;
  textoCorreoNoDisponible: string | null;
  esDemo: boolean;
};

type Claims = { session_id?: unknown; aal?: unknown; amr?: unknown };

function sessionIdDe(claims: Claims): string {
  const id = claims.session_id;
  if (!esUuid(id)) throw new Error("Tu sesión no es válida. Vuelve a iniciar sesión.");
  return id;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function leerEstado(context: {
  supabase: { rpc: (fn: "mi_estado_mfa") => PromiseLike<{ data: unknown; error: unknown }> };
  userId: string;
}): Promise<EstadoSegundoPaso> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { envioDeCorreoConfigurado } = await import("@/lib/auth/mfa-correo.server");
  const [{ data, error }, { data: usuario }] = await Promise.all([
    context.supabase.rpc("mi_estado_mfa"),
    supabaseAdmin.auth.admin.getUserById(context.userId),
  ]);
  if (error) throw new Error("No pudimos leer tu verificación en dos pasos.");
  const j = obj(data);
  const email = usuario?.user?.email ?? null;
  const esDemo = esCuentaDemo(email);
  const motivo = motivoCorreoNoDisponible({
    envioConfigurado: envioDeCorreoConfigurado(),
    email,
    emailConfirmado: Boolean(usuario?.user?.email_confirmed_at),
    esDemo,
  });
  return {
    tieneTotp: j.tiene_totp === true,
    correoActivo: j.correo_activo === true,
    metodoPreferido: j.metodo_preferido === "email" ? "email" : "totp",
    sesionCumple: j.sesion_cumple === true,
    sesionVerificadaPorCorreo: j.sesion_verificada_por_correo === true,
    correoEnmascarado: enmascararCorreo(email),
    correoNoDisponible: motivo,
    textoCorreoNoDisponible: motivo ? TEXTO_CORREO_NO_DISPONIBLE[motivo] : null,
    esDemo,
  };
}

export const getMiSegundoPaso = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EstadoSegundoPaso> => leerEstado(context));

const Proposito = z.enum(["login", "activar"]);

const MENSAJE_REINGRESO =
  "Por seguridad, para activarlo tienes que haber iniciado sesión hace menos de 10 minutos. Vuelve a entrar y actívalo de inmediato.";
const MENSAJE_PRIMERO_LA_APP =
  "Como ya usas la app autenticadora, primero verifica esta sesión con ella para sumar el correo.";

/** Chequeos de activar (los repite el verificar: la ventana es corta). */
function exigirPuedeActivar(claims: Claims, estado: EstadoSegundoPaso): string | null {
  const amr = Array.isArray(claims.amr) ? (claims.amr as unknown[]) : [];
  if (!sesionReciente(amr, Date.now())) return MENSAJE_REINGRESO;
  if (estado.tieneTotp && claims.aal !== "aal2") return MENSAJE_PRIMERO_LA_APP;
  return null;
}

export type ResultadoEnvioCodigo =
  | { ok: true; enviadoA: string | null; venceEl: string | null }
  | {
      ok: false;
      motivo: string;
      esperarSegundos: number | null;
      /** Ya hay un código vigente de esta sesión: no es un error. */
      espera?: boolean;
      reingreso?: boolean;
    };

export const enviarCodigoPorCorreo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ proposito: Proposito }).parse(input))
  .handler(async ({ data, context }): Promise<ResultadoEnvioCodigo> => {
    const claims = context.claims as Claims;
    const sessionId = sessionIdDe(claims);
    const srv = await import("@/lib/auth/mfa-correo.server");
    const { ip, ua } = srv.ipYNavegadorMfa();
    srv.exigirLimiteMfaCorreo(ip, "enviar");

    const estado = await leerEstado(context);
    if (estado.textoCorreoNoDisponible) {
      return { ok: false, motivo: estado.textoCorreoNoDisponible, esperarSegundos: null };
    }
    if (data.proposito === "activar") {
      const motivo = exigirPuedeActivar(claims, estado);
      if (motivo) {
        return {
          ok: false,
          motivo,
          esperarSegundos: null,
          reingreso: motivo === MENSAJE_REINGRESO,
        };
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: usuario } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const email = usuario?.user?.email;
    if (!email)
      return { ok: false, motivo: TEXTO_CORREO_NO_DISPONIBLE.sin_correo, esperarSegundos: null };

    const codigo = generarCodigo();
    const { data: r, error } = await supabaseAdmin.rpc("mfa_correo_emitir_codigo", {
      p_user_id: context.userId,
      p_session_id: sessionId,
      p_proposito: data.proposito,
      p_code_hash: await huellaCodigoMfaCorreo(context.userId, sessionId, codigo),
      p_ip: ip,
      p_user_agent: ua,
    });
    if (error) throw new Error("No pudimos preparar el código. Vuelve a intentarlo.");
    const j = obj(r);
    if (j.ok !== true) {
      const motivo = typeof j.motivo === "string" ? j.motivo : "invalida";
      const esperar = typeof j.esperar === "number" ? j.esperar : null;
      return {
        ok: false,
        motivo:
          motivo === "espera"
            ? textoEspera(esperar)
            : (TEXTO_MOTIVO_CODIGO[motivo] ?? TEXTO_MOTIVO_CODIGO.invalida),
        esperarSegundos: esperar,
        espera: motivo === "espera",
      };
    }

    const { appOrigin } = await import("@/lib/app-origin.server");
    const envio = await srv.enviarCorreoConCodigo({
      to: email,
      codigo,
      proposito: data.proposito,
      appUrl: appOrigin(),
    });
    if (!envio.ok) {
      // Sin el código ni la dirección en el log.
      console.error("[mfa-correo] no salió el correo del código:", envio.reason);
      await srv.registrarEventoMfaCorreo(supabaseAdmin, {
        userId: context.userId,
        sessionId,
        event: "envio_fallido",
        detail: envio.reason,
        ip,
        ua,
      });
      return {
        ok: false,
        motivo: "No pudimos enviarte el correo. Intenta de nuevo en un minuto o usa otro método.",
        esperarSegundos: 60,
      };
    }
    return {
      ok: true,
      enviadoA: estado.correoEnmascarado,
      venceEl: typeof j.vence === "string" ? j.vence : null,
    };
  });

export type ResultadoVerificacionCorreo =
  { ok: true } | { ok: false; motivo: string; restantes: number | null };

export const verificarCodigoPorCorreo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ proposito: Proposito, codigo: z.string().max(20) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ResultadoVerificacionCorreo> => {
    const claims = context.claims as Claims;
    const sessionId = sessionIdDe(claims);
    const srv = await import("@/lib/auth/mfa-correo.server");
    const { ip, ua } = srv.ipYNavegadorMfa();
    srv.exigirLimiteMfaCorreo(ip, "verificar");

    const codigo = normalizarCodigo(data.codigo);
    if (!codigo) return { ok: false, motivo: "El código tiene 6 números.", restantes: null };

    if (data.proposito === "activar") {
      const motivo = exigirPuedeActivar(claims, await leerEstado(context));
      if (motivo) return { ok: false, motivo, restantes: null };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await supabaseAdmin.rpc("mfa_correo_verificar_codigo", {
      p_user_id: context.userId,
      p_session_id: sessionId,
      p_proposito: data.proposito,
      p_code_hash: await huellaCodigoMfaCorreo(context.userId, sessionId, codigo),
      p_ip: ip,
      p_user_agent: ua,
    });
    if (error) throw new Error("No pudimos verificar el código. Vuelve a intentarlo.");
    const j = obj(r);
    if (j.ok === true) return { ok: true };
    const motivo = typeof j.motivo === "string" ? j.motivo : "invalida";
    const restantes = typeof j.restantes === "number" ? j.restantes : null;
    const base = TEXTO_MOTIVO_CODIGO[motivo] ?? TEXTO_MOTIVO_CODIGO.invalida;
    return {
      ok: false,
      motivo:
        motivo === "incorrecto" && restantes !== null
          ? `${base} Te quedan ${restantes} ${restantes === 1 ? "intento" : "intentos"}.`
          : base,
      restantes,
    };
  });

const Configuracion = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("desactivar") }),
  z.object({ accion: z.literal("preferir"), metodo: z.enum(["totp", "email"]) }),
]);

const MENSAJE_VERIFICA_PRIMERO =
  "Para cambiar esto, primero verifica esta sesión con tu segundo paso. Vuelve a iniciar sesión e intenta de nuevo.";

export const configurarSegundoPaso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Configuracion.parse(input))
  .handler(async ({ data, context }): Promise<EstadoSegundoPaso> => {
    const claims = context.claims as Claims;
    const sessionId = esUuid(claims.session_id) ? claims.session_id : null;
    const estado = await leerEstado(context);
    if (!estado.sesionCumple) throw new Error(MENSAJE_VERIFICA_PRIMERO);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const srv = await import("@/lib/auth/mfa-correo.server");
    const { ip, ua } = srv.ipYNavegadorMfa();
    const ahora = new Date().toISOString();

    if (data.accion === "desactivar") {
      if (!estado.correoActivo) return estado;
      const { error } = await supabaseAdmin
        .from("mfa_email_settings")
        .update({ enabled: false, preferred_method: "totp", updated_at: ahora })
        .eq("user_id", context.userId);
      if (error) throw new Error("No pudimos desactivarlo. Vuelve a intentarlo.");
      await srv.registrarEventoMfaCorreo(supabaseAdmin, {
        userId: context.userId,
        sessionId,
        event: "correo_desactivado",
        ip,
        ua,
      });
    } else {
      const disponible = data.metodo === "email" ? estado.correoActivo : estado.tieneTotp;
      if (!disponible) throw new Error("Ese método no está activo en tu cuenta.");
      if (!estado.correoActivo) return estado; // sin correo, el único es la app
      const { error } = await supabaseAdmin
        .from("mfa_email_settings")
        .update({ preferred_method: data.metodo, updated_at: ahora })
        .eq("user_id", context.userId);
      if (error) throw new Error("No pudimos guardar el cambio. Vuelve a intentarlo.");
      await srv.registrarEventoMfaCorreo(supabaseAdmin, {
        userId: context.userId,
        sessionId,
        event: "metodo_preferido",
        detail: data.metodo,
        ip,
        ua,
      });
    }
    return leerEstado(context);
  });

/**
 * Antes de inscribir la app autenticadora con el correo activo: la base
 * rechaza el factor nuevo (trigger `exigir_correo_para_inscribir_factor`)
 * salvo que una sesión verificada lo autorice en los últimos 10 minutos.
 * Sin el correo activo no hace nada.
 */
export const autorizarInscripcionApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true } | { ok: false; motivo: string }> => {
    const claims = context.claims as Claims;
    const estado = await leerEstado(context);
    if (!estado.correoActivo) return { ok: true };
    if (!estado.sesionCumple) return { ok: false, motivo: MENSAJE_VERIFICA_PRIMERO };
    const amr = Array.isArray(claims.amr) ? (claims.amr as unknown[]) : [];
    if (!sesionReciente(amr, Date.now())) return { ok: false, motivo: MENSAJE_REINGRESO };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("mfa_email_settings")
      .update({ totp_enroll_allowed_until: new Date(Date.now() + 10 * 60_000).toISOString() })
      .eq("user_id", context.userId);
    if (error) throw new Error("No pudimos preparar la activación. Vuelve a intentarlo.");
    const srv = await import("@/lib/auth/mfa-correo.server");
    const { ip, ua } = srv.ipYNavegadorMfa();
    await srv.registrarEventoMfaCorreo(supabaseAdmin, {
      userId: context.userId,
      sessionId: esUuid(claims.session_id) ? claims.session_id : null,
      event: "totp_autorizado",
      ip,
      ua,
    });
    return { ok: true };
  });
