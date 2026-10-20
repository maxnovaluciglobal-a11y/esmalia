// Verificación en dos pasos (TOTP de Supabase Auth) — SEG-01.
//
// - `VerificacionDosPasosCard`: inscribir (QR + código) y desinscribir. Vive
//   en /preferencias y, para el staff sin factor, en la pantalla de acceso
//   restringido de /admin.
// - `AvisoMfaRecomendado`: franja para el owner sin factor (recomendado, no
//   bloqueante). La monta `StatusStrip`.
//
// Todo pasa por supabase-js en el navegador: la inscripción la hace el propio
// usuario con su sesión, no hay server function ni service_role en el medio.
import { useState } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { getSupabase } from "@/integrations/supabase/lazy";
import { esCuentaDemo } from "@/lib/demo-cuenta";
import {
  factoresTotpSinVerificar,
  factoresTotpVerificados,
  MINUTOS_SESION_RECIENTE,
  normalizarCodigoTotp,
  sesionReciente,
  tieneFactorVerificado,
} from "@/lib/auth/mfa";
import { cn } from "@/lib/utils";

export const MFA_QUERY_KEY = ["mfa-estado"] as const;

type EstadoMfa = {
  tieneFactor: boolean;
  factorId: string | null;
  esDemo: boolean;
  /** `amr` del JWT: cuándo inició sesión (para exigir sesión reciente). */
  amr: readonly unknown[];
};

/** Lee el estado de la sesión local (sin red): si la cuenta tiene un factor
 *  verificado y cuál. `listFactors` también sale de la sesión guardada. */
async function leerEstadoMfa(): Promise<EstadoMfa> {
  const supabase = await getSupabase();
  const [{ data: sesion }, { data: niveles }, { data: factores }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  const verificado = factoresTotpVerificados(factores?.all ?? [])[0];
  return {
    tieneFactor: tieneFactorVerificado(niveles) || Boolean(verificado),
    factorId: verificado?.id ?? null,
    esDemo: esCuentaDemo(sesion.session?.user.email),
    amr: niveles?.currentAuthenticationMethods ?? [],
  };
}

export function useEstadoMfa() {
  return useQuery({ queryKey: MFA_QUERY_KEY, queryFn: leerEstadoMfa, staleTime: 60_000 });
}

type Inscripcion = { factorId: string; qr: string; secreto: string };

/**
 * Solo se monta en /preferencias, dentro de la app. NO en la pantalla de
 * acceso restringido de /admin: ahí cualquiera con una contraseña robada de
 * staff podría inscribir su propio TOTP y subir a aal2 (revisión del PR #65).
 */
export function VerificacionDosPasosCard() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const { data: estado, isLoading } = useEstadoMfa();
  const [inscripcion, setInscripcion] = useState<Inscripcion | null>(null);
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmandoBaja, setConfirmandoBaja] = useState(false);
  const [pedirReingreso, setPedirReingreso] = useState(false);

  const refrescar = async () => {
    await queryClient.invalidateQueries({ queryKey: MFA_QUERY_KEY });
  };

  const iniciar = useMutation({
    mutationFn: async (): Promise<Inscripcion | null> => {
      const supabase = await getSupabase();
      // Inscribir un factor exige haber iniciado sesión hace poco: una sesión
      // olvidada abierta (o robada) no alcanza para atarle un TOTP ajeno.
      // Se relee del JWT en el momento del clic, no del cache.
      const { data: niveles } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!sesionReciente(niveles?.currentAuthenticationMethods, Date.now())) return null;
      // Un QR abierto y abandonado deja un factor sin verificar; se limpia
      // antes de crear otro para no acumularlos.
      const { data: factores } = await supabase.auth.mfa.listFactors();
      for (const f of factoresTotpSinVerificar(factores?.all ?? [])) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: errorAlta } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        issuer: "Esmalia",
      });
      if (errorAlta || !data) throw new Error("No pudimos iniciar la activación.");
      return { factorId: data.id, qr: data.totp.qr_code, secreto: data.totp.secret };
    },
    onSuccess: (datos) => {
      if (!datos) {
        setPedirReingreso(true);
        return;
      }
      setPedirReingreso(false);
      setInscripcion(datos);
      setCodigo("");
      setError(null);
    },
    onError: () => toast.error("No pudimos iniciar la activación. Intenta de nuevo."),
  });

  const confirmar = useMutation({
    mutationFn: async () => {
      if (!inscripcion) throw new Error("Sin inscripción en curso.");
      const limpio = normalizarCodigoTotp(codigo);
      if (!limpio) throw new Error("El código tiene 6 números.");
      const supabase = await getSupabase();
      const { error: errorVerificacion } = await supabase.auth.mfa.challengeAndVerify({
        factorId: inscripcion.factorId,
        code: limpio,
      });
      if (errorVerificacion) {
        throw new Error("El código no es válido o ya venció. Usa el que muestra ahora tu app.");
      }
    },
    onSuccess: async () => {
      setInscripcion(null);
      setCodigo("");
      toast.success("Verificación en dos pasos activada");
      await refrescar();
      // La sesión ya es aal2: lo que dependía de eso (ej. /admin) se recarga.
      await router.invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const cancelar = useMutation({
    mutationFn: async () => {
      if (!inscripcion) return;
      const supabase = await getSupabase();
      await supabase.auth.mfa.unenroll({ factorId: inscripcion.factorId });
    },
    onSettled: () => {
      setInscripcion(null);
      setCodigo("");
      setError(null);
    },
  });

  const desactivar = useMutation({
    mutationFn: async () => {
      if (!estado?.factorId) throw new Error("No hay verificación activa.");
      const supabase = await getSupabase();
      // Supabase exige una sesión aal2 para quitar un factor verificado:
      // quien está adentro con factor ya pasó el desafío.
      const { error: errorBaja } = await supabase.auth.mfa.unenroll({
        factorId: estado.factorId,
      });
      if (errorBaja) throw new Error("No pudimos desactivarla. Vuelve a iniciar sesión e intenta.");
      // Sin esto la sesión sigue diciendo aal2 hasta el próximo refresco.
      await supabase.auth.refreshSession();
    },
    onSuccess: async () => {
      setConfirmandoBaja(false);
      toast.success("Verificación en dos pasos desactivada");
      await refrescar();
      await router.invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ocupado =
    iniciar.isPending || confirmar.isPending || cancelar.isPending || desactivar.isPending;

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex gap-3">
        {estado?.tieneFactor ? (
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" />
        ) : (
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-primary" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold">Verificación en dos pasos</h2>
          <p className="text-sm text-muted-foreground">
            {
              "Además de tu contraseña, Esmalia te pide un código de 6 números de una app de autenticación. Si alguien consigue tu contraseña, igual no puede entrar a las fichas de tus pacientes."
            }
          </p>

          {isLoading ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando…
            </p>
          ) : estado?.esDemo ? (
            <p className="mt-3 text-sm text-muted-foreground">
              La cuenta de la demo es compartida: no se le puede activar la verificación en dos
              pasos. Crea tu propia cuenta para eso.
            </p>
          ) : estado?.tieneFactor ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm font-medium text-success">Activa en esta cuenta.</p>
              {confirmandoBaja ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-sm">
                    Sin la verificación, tu cuenta queda protegida solo por la contraseña. ¿La
                    desactivas igual?
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => desactivar.mutate()}
                      className="rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                    >
                      {desactivar.isPending && (
                        <Loader2 className="mr-1 inline size-4 animate-spin" />
                      )}
                      Sí, desactivar
                    </button>
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => setConfirmandoBaja(false)}
                      className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      Mantenerla
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmandoBaja(true)}
                  className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  Desactivar
                </button>
              )}
            </div>
          ) : inscripcion ? (
            <form
              className="mt-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                confirmar.mutate();
              }}
            >
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  Abre tu app de autenticación (Google Authenticator, 1Password, Authy u otra).
                </li>
                <li>Escanea este código QR.</li>
                <li>Escribe el código de 6 números que te muestra la app.</li>
              </ol>
              <img
                src={inscripcion.qr}
                alt="Código QR para tu app de autenticación"
                width={176}
                height={176}
                className="size-44 rounded-lg border border-border bg-white p-2"
              />
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  ¿No puedes escanear? Usa esta clave
                </summary>
                <code className="mt-2 block break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
                  {inscripcion.secreto}
                </code>
              </details>
              <div>
                <label htmlFor="codigo-alta-mfa" className="mb-1.5 block text-xs font-medium">
                  Código de verificación
                </label>
                <input
                  id="codigo-alta-mfa"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={9}
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  disabled={ocupado}
                  required
                  className="w-40 rounded-lg border border-input bg-background px-3 py-2 text-center tracking-[0.3em] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                />
              </div>
              <div aria-live="polite" role="status">
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={ocupado}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {confirmar.isPending && <Loader2 className="mr-1 inline size-4 animate-spin" />}
                  Activar
                </button>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => cancelar.mutate()}
                  className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => iniciar.mutate()}
              className="mt-3 rounded-lg border border-brand bg-transparent px-3 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand/12 disabled:opacity-50"
            >
              {iniciar.isPending && <Loader2 className="mr-1 inline size-4 animate-spin" />}
              Activar verificación en dos pasos
            </button>
          )}

          {pedirReingreso && !inscripcion && !estado?.tieneFactor && (
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p>
                Por seguridad, para activarla tienes que haber iniciado sesión hace menos de{" "}
                {MINUTOS_SESION_RECIENTE} minutos. Vuelve a entrar y actívala de inmediato.
              </p>
              <button
                type="button"
                onClick={async () => {
                  const supabase = await getSupabase();
                  await supabase.auth.signOut({ scope: "local" });
                  void navigate({ to: "/auth" });
                }}
                className="mt-2 rounded-lg border border-brand bg-transparent px-3 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand/12"
              >
                Volver a iniciar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const CLAVE_POSPUESTO = "esmalia:mfa-aviso-pospuesto-hasta";
const DIAS_POSPUESTO = 7;

function leerPospuesto(): boolean {
  try {
    const hasta = Number(window.localStorage.getItem(CLAVE_POSPUESTO) ?? 0);
    return Number.isFinite(hasta) && hasta > Date.now();
  } catch {
    return false;
  }
}

/** `[pospuesto, posponer]`: el owner puede pedir que se le recuerde en una
 *  semana. Vive en quien decide qué franja mostrar (`StatusStrip`) para que,
 *  pospuesto el aviso, aparezca la franja siguiente (el trial) y no un hueco. */
export function useAvisoMfaPospuesto(): [boolean, () => void] {
  const [pospuesto, setPospuesto] = useState(leerPospuesto);
  function posponer() {
    try {
      window.localStorage.setItem(
        CLAVE_POSPUESTO,
        String(Date.now() + DIAS_POSPUESTO * 24 * 60 * 60 * 1000),
      );
    } catch {
      // Sin almacenamiento: se oculta solo por esta visita.
    }
    setPospuesto(true);
  }
  return [pospuesto, posponer];
}

/** Franja para el owner sin verificación en dos pasos (recomendada, no
 *  bloqueante). */
export function AvisoMfaRecomendado({
  onPosponer,
  className,
}: {
  onPosponer: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-brand/40 bg-brand-100 px-5 py-2 text-sm sm:px-8",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0 text-brand-700" />
        <span>
          Protege las fichas de tu clínica: activa la verificación en dos pasos en tu cuenta.
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Link
          to="/preferencias"
          className="rounded-md border border-brand bg-transparent px-3 py-1 text-xs font-medium text-brand-700 hover:bg-brand/12"
        >
          Activar
        </Link>
        <button
          type="button"
          onClick={onPosponer}
          aria-label="Recordármelo en una semana"
          title="Recordármelo en una semana"
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-brand/12 pointer-coarse:size-11"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
