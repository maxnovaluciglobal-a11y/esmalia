// Desafío de la verificación en dos pasos (SEG-01). Llega acá quien inició
// sesión (contraseña o Google) con una cuenta que tiene un segundo paso y
// cuya sesión todavía no lo pasó: `_authenticated/route.tsx` redirige.
//
// Dos métodos (26-oct-2026):
// - App autenticadora (TOTP de Supabase): la sesión sube a `aal2`.
// - Código por correo: lo manda el servidor y la base registra la
//   verificación para esta sesión (`mfa-correo.functions.ts`).
// Se ofrece primero el preferido y, si la cuenta tiene los dos, "usar el
// otro método".
//
// `auth_` (con guion bajo) saca la ruta del layout de `/auth`, igual que
// `/auth/nueva-clave`.
import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Loader2, Mail, Smartphone } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { EsmaliaLogo } from "@/components/esmalia-logo";
import { getSupabase } from "@/integrations/supabase/lazy";
import { esCuentaDemo } from "@/lib/demo-cuenta";
import { factoresTotpVerificados, necesitaDesafioMfa, normalizarCodigoTotp } from "@/lib/auth/mfa";
import { metodosDisponibles, type MetodoMfa } from "@/lib/auth/mfa-correo";
import {
  enviarCodigoPorCorreo,
  getMiSegundoPaso,
  verificarCodigoPorCorreo,
  type EstadoSegundoPaso,
} from "@/lib/auth/mfa-correo.functions";
import { marcarSesionQueCumple } from "@/lib/auth/mfa-sesion";
import { peekPlanIntent } from "@/lib/marketing/plan-intent";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth_/verificar")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Verificación en dos pasos · Esmalia" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VerificarPage,
});

const SOPORTE = "soporte@esmalia.com";

type EstadoEnvio =
  | { tipo: "nada" }
  | { tipo: "enviando" }
  | { tipo: "enviado"; a: string | null }
  | { tipo: "espera"; mensaje: string }
  | { tipo: "error"; mensaje: string };

function VerificarPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [cargando, setCargando] = useState(true);
  const [estado, setEstado] = useState<EstadoSegundoPaso | null>(null);
  const [metodos, setMetodos] = useState<MetodoMfa[]>([]);
  const [metodo, setMetodo] = useState<MetodoMfa | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [envio, setEnvio] = useState<EstadoEnvio>({ tipo: "nada" });
  const [espera, setEspera] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const yaEnviado = useRef(false);

  const destino = () => (peekPlanIntent() ? "/suscripcion" : "/dashboard");

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      const supabase = await getSupabase();
      const { data: sesion } = await supabase.auth.getSession();
      if (!sesion.session) {
        if (!cancelado) void navigate({ to: "/auth" });
        return;
      }
      // La demo nunca pasa por el desafío (cuenta compartida).
      if (esCuentaDemo(sesion.session.user.email)) {
        if (!cancelado) void navigate({ to: destino() });
        return;
      }
      const { data: niveles } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      let disponibles: MetodoMfa[];
      try {
        const e = await getMiSegundoPaso();
        if (cancelado) return;
        if (e.sesionCumple) {
          marcarSesionQueCumple(sesion.session);
          void navigate({ to: destino() });
          return;
        }
        setEstado(e);
        disponibles = metodosDisponibles(e);
      } catch {
        // Sin el estado del servidor queda la regla de la app (sesión local).
        disponibles = necesitaDesafioMfa(niveles) ? ["totp"] : [];
      }
      if (cancelado) return;
      if (disponibles.length === 0) {
        void navigate({ to: destino() });
        return;
      }
      if (disponibles.includes("totp")) {
        const { data: factores } = await supabase.auth.mfa.listFactors();
        if (cancelado) return;
        const totp = factoresTotpVerificados(factores?.all ?? [])[0];
        if (totp) setFactorId(totp.id);
        else disponibles = disponibles.filter((m) => m !== "totp");
      }
      if (disponibles.length === 0) {
        setError("No pudimos cargar tu verificación en dos pasos. Intenta de nuevo en un momento.");
      }
      setMetodos(disponibles);
      setMetodo(disponibles[0] ?? null);
      setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [navigate]);

  // Cuenta regresiva para "Reenviar código".
  useEffect(() => {
    if (espera <= 0) return;
    const t = window.setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [espera]);

  const enviarCodigo = useCallback(async () => {
    setEnvio({ tipo: "enviando" });
    setError(null);
    try {
      const r = await enviarCodigoPorCorreo({ data: { proposito: "login" } });
      if (r.ok) {
        setEnvio({ tipo: "enviado", a: r.enviadoA });
        setEspera(60);
        inputRef.current?.focus();
      } else {
        setEnvio({ tipo: r.espera ? "espera" : "error", mensaje: r.motivo });
        if (r.esperarSegundos) setEspera(r.esperarSegundos);
      }
    } catch (e) {
      setEnvio({
        tipo: "error",
        mensaje: e instanceof Error ? e.message : "No pudimos enviarte el código.",
      });
    }
  }, []);

  // Al mostrar el correo por primera vez, el código sale solo.
  useEffect(() => {
    if (metodo !== "email" || yaEnviado.current || estado?.correoNoDisponible) return;
    yaEnviado.current = true;
    void enviarCodigo();
  }, [metodo, estado?.correoNoDisponible, enviarCodigo]);

  useEffect(() => {
    if (metodo) inputRef.current?.focus();
  }, [metodo]);

  async function terminar() {
    const supabase = await getSupabase();
    const { data: sesion } = await supabase.auth.getSession();
    marcarSesionQueCumple(sesion.session);
    await router.invalidate();
    void navigate({ to: destino() });
  }

  async function verificar(event: React.FormEvent) {
    event.preventDefault();
    if (!metodo || (metodo === "totp" && !factorId)) return;
    const limpio = normalizarCodigoTotp(codigo);
    if (!limpio) {
      setError("El código tiene 6 números.");
      return;
    }
    setVerificando(true);
    setError(null);
    if (metodo === "totp" && factorId) {
      const supabase = await getSupabase();
      const { error: errorVerificacion } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: limpio,
      });
      if (errorVerificacion) {
        // Mismo mensaje para código vencido o equivocado: no hace falta más
        // detalle y no se le da pista a quien prueba códigos.
        setError(
          "El código no es válido o ya venció. Usa el que muestra ahora tu app autenticadora.",
        );
        setCodigo("");
        setVerificando(false);
        inputRef.current?.focus();
        return;
      }
      await terminar();
      return;
    }
    try {
      const r = await verificarCodigoPorCorreo({ data: { proposito: "login", codigo: limpio } });
      if (!r.ok) {
        setError(r.motivo);
        setCodigo("");
        setVerificando(false);
        inputRef.current?.focus();
        return;
      }
      await terminar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos verificar el código.");
      setVerificando(false);
    }
  }

  function cambiarMetodo(nuevo: MetodoMfa) {
    setMetodo(nuevo);
    setCodigo("");
    setError(null);
  }

  async function salir() {
    const supabase = await getSupabase();
    await supabase.auth.signOut({ scope: "local" });
    void navigate({ to: "/auth" });
  }

  const otro = metodos.find((m) => m !== metodo) ?? null;
  const correoBloqueado = metodo === "email" && Boolean(estado?.correoNoDisponible);
  const deshabilitado =
    verificando || !metodo || (metodo === "totp" && !factorId) || correoBloqueado;

  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-surface px-4 py-12"
    >
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center">
          <EsmaliaLogo size={34} />
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <h1 className="font-display text-xl font-semibold">Verificación en dos pasos</h1>

          {cargando && !error ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Preparando la verificación…
            </p>
          ) : (
            <>
              {metodo === "totp" && (
                <div className="mt-2 space-y-3">
                  <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Smartphone className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>
                      Abre tu app autenticadora (Google Authenticator, 1Password, Authy u otra) y
                      escribe el código de 6 números que muestra para Esmalia.
                    </span>
                  </p>
                  <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    El código de la app no llega por correo: abre tu app autenticadora y escribe el
                    número que muestra. Cambia cada 30 segundos.
                  </p>
                </div>
              )}

              {metodo === "email" && (
                <div className="mt-2 space-y-3">
                  <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Mail className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>
                      Te mandamos un código de 6 números
                      {estado?.correoEnmascarado ? (
                        <>
                          {" "}
                          a{" "}
                          <span className="font-medium text-foreground">
                            {estado.correoEnmascarado}
                          </span>
                        </>
                      ) : (
                        " a tu correo"
                      )}
                      . Vence en 10 minutos. Si no lo ves, revisa la carpeta de spam.
                    </span>
                  </p>
                  {estado?.textoCorreoNoDisponible && (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                      {estado.textoCorreoNoDisponible}
                    </p>
                  )}
                  <div aria-live="polite" className="text-xs text-muted-foreground">
                    {envio.tipo === "enviando" && (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="size-3.5 animate-spin" /> Enviando el código…
                      </span>
                    )}
                    {envio.tipo === "enviado" && <span>Código enviado. Revisa tu correo.</span>}
                    {envio.tipo === "espera" && <span>{envio.mensaje}</span>}
                    {envio.tipo === "error" && (
                      <span className="text-destructive">{envio.mensaje}</span>
                    )}
                  </div>
                </div>
              )}

              {metodo && (
                <form onSubmit={verificar} className="mt-5 space-y-4">
                  <div>
                    <label htmlFor="codigo-mfa" className="mb-1.5 block text-xs font-medium">
                      {metodo === "totp" ? "Código de tu app autenticadora" : "Código del correo"}
                    </label>
                    <input
                      ref={inputRef}
                      id="codigo-mfa"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9 \-]*"
                      maxLength={9}
                      value={codigo}
                      onChange={(e) => setCodigo(e.target.value)}
                      disabled={deshabilitado}
                      required
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-center text-lg tracking-[0.3em] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    />
                  </div>

                  <div aria-live="polite" role="status">
                    {error && <p className="text-xs text-destructive">{error}</p>}
                  </div>

                  <button
                    type="submit"
                    disabled={deshabilitado}
                    className={cn(buttonVariants({ size: "lg" }), "w-full")}
                  >
                    {verificando && <Loader2 className="size-4 animate-spin" />}
                    Verificar
                  </button>

                  {metodo === "email" && !estado?.correoNoDisponible && (
                    <button
                      type="button"
                      onClick={() => void enviarCodigo()}
                      disabled={espera > 0 || envio.tipo === "enviando"}
                      className="w-full text-center text-xs font-medium text-brand-700 hover:underline disabled:text-muted-foreground disabled:no-underline pointer-coarse:min-h-11"
                    >
                      {espera > 0
                        ? `Puedes pedir otro código en ${espera} s`
                        : "Reenviar el código"}
                    </button>
                  )}
                </form>
              )}

              {!metodo && error && (
                <p className="mt-4 text-xs text-destructive" role="status">
                  {error}
                </p>
              )}

              {otro && (
                <div className="mt-5 border-t border-border pt-4">
                  <button
                    type="button"
                    onClick={() => cambiarMetodo(otro)}
                    className="inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline pointer-coarse:min-h-11"
                  >
                    {otro === "email" ? (
                      <Mail className="size-4" aria-hidden />
                    ) : (
                      <Smartphone className="size-4" aria-hidden />
                    )}
                    {otro === "email"
                      ? "Usar el otro método: código por correo"
                      : "Usar el otro método: app autenticadora"}
                  </button>
                </div>
              )}
            </>
          )}

          <div className="mt-6 space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
            <p>
              ¿No tienes acceso a tu app ni a tu correo? Escríbenos a{" "}
              <a href={`mailto:${SOPORTE}`} className="font-medium text-brand-700 hover:underline">
                {SOPORTE}
              </a>{" "}
              desde el correo de tu cuenta y te ayudamos a recuperar el acceso.
            </p>
            <p>
              <button
                type="button"
                onClick={salir}
                className="inline-flex items-center font-medium text-brand-700 hover:underline pointer-coarse:min-h-11"
              >
                Cerrar sesión
              </button>{" "}
              o{" "}
              <Link to="/" className="font-medium text-brand-700 hover:underline">
                volver al inicio
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
