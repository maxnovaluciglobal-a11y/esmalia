// Desafío de la verificación en dos pasos (SEG-01). Llega acá quien inició
// sesión (contraseña o Google) con una cuenta que tiene un factor TOTP
// verificado: `_authenticated/route.tsx` redirige mientras la sesión siga en
// `aal1`. Al verificar el código la sesión sube a `aal2` y se sigue al panel.
//
// `auth_` (con guion bajo) saca la ruta del layout de `/auth`, igual que
// `/auth/nueva-clave`.
import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { EsmaliaLogo } from "@/components/esmalia-logo";
import { getSupabase } from "@/integrations/supabase/lazy";
import { factoresTotpVerificados, necesitaDesafioMfa, normalizarCodigoTotp } from "@/lib/auth/mfa";
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

function VerificarPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [codigo, setCodigo] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      const { data: niveles } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!necesitaDesafioMfa(niveles)) {
        // Ya está en aal2, o la cuenta no tiene factor: nada que pedir.
        if (!cancelado) void navigate({ to: destino() });
        return;
      }
      const { data: factores, error: errorFactores } = await supabase.auth.mfa.listFactors();
      if (cancelado) return;
      const totp = factoresTotpVerificados(factores?.all ?? [])[0];
      if (errorFactores || !totp) {
        setError("No pudimos cargar tu verificación en dos pasos. Intenta de nuevo en un momento.");
      } else {
        setFactorId(totp.id);
      }
      setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (factorId) inputRef.current?.focus();
  }, [factorId]);

  async function verificar(event: React.FormEvent) {
    event.preventDefault();
    if (!factorId) return;
    const limpio = normalizarCodigoTotp(codigo);
    if (!limpio) {
      setError("El código tiene 6 números.");
      return;
    }
    setVerificando(true);
    setError(null);
    const supabase = await getSupabase();
    const { error: errorVerificacion } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: limpio,
    });
    if (errorVerificacion) {
      // Mismo mensaje para código vencido o equivocado: no hace falta más
      // detalle y no se le da pista a quien prueba códigos.
      setError("El código no es válido o ya venció. Usa el que muestra ahora tu app.");
      setCodigo("");
      setVerificando(false);
      inputRef.current?.focus();
      return;
    }
    await router.invalidate();
    void navigate({ to: destino() });
  }

  async function salir() {
    const supabase = await getSupabase();
    await supabase.auth.signOut({ scope: "local" });
    void navigate({ to: "/auth" });
  }

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
          <p className="mt-1 text-sm text-muted-foreground">
            Abre tu app de autenticación (Google Authenticator, 1Password, Authy u otra) y escribe
            el código de 6 números de Esmalia.
          </p>

          {cargando && !error ? (
            <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Preparando la verificación…
            </p>
          ) : (
            <form onSubmit={verificar} className="mt-6 space-y-4">
              <div>
                <label htmlFor="codigo-mfa" className="mb-1.5 block text-xs font-medium">
                  Código de verificación
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
                  disabled={!factorId || verificando}
                  required
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-center text-lg tracking-[0.3em] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                />
              </div>

              <div aria-live="polite" role="status">
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>

              <button
                type="submit"
                disabled={!factorId || verificando}
                className={cn(buttonVariants({ size: "lg" }), "w-full")}
              >
                {verificando && <Loader2 className="size-4 animate-spin" />}
                Verificar
              </button>
            </form>
          )}

          <div className="mt-6 space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
            <p>
              ¿Perdiste el teléfono o la app? Escríbenos a{" "}
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
