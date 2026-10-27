// Verificación en dos pasos — SEG-01.
//
// - `VerificacionDosPasosCard`: en /preferencias (Seguridad de tu cuenta).
//   Dos métodos que se activan por separado:
//   · App autenticadora (TOTP de Supabase): QR + código, todo por supabase-js
//     con la sesión del propio usuario.
//   · Código por correo (26-oct-2026): server functions de
//     `mfa-correo.functions.ts`; la base registra la verificación por sesión.
//   Con los dos activos, el usuario elige cuál se le ofrece primero al entrar.
// - `AvisoMfaRecomendado`: franja para el owner sin segundo paso
//   (recomendado, no bloqueante). La monta `StatusStrip`.
import { useState } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, ShieldAlert, ShieldCheck, Smartphone, X } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { getSupabase } from "@/integrations/supabase/lazy";
import { MFA_QUERY_KEY, useEstadoMfa } from "@/hooks/use-estado-mfa";
import {
  factoresTotpSinVerificar,
  MINUTOS_SESION_RECIENTE,
  normalizarCodigoTotp,
  sesionReciente,
} from "@/lib/auth/mfa";
import { resumenAlEntrar, type MetodoMfa } from "@/lib/auth/mfa-correo";
import {
  autorizarInscripcionApp,
  configurarSegundoPaso,
  enviarCodigoPorCorreo,
  getMiSegundoPaso,
  verificarCodigoPorCorreo,
} from "@/lib/auth/mfa-correo.functions";
import { marcarSesionQueCumple } from "@/lib/auth/mfa-sesion";
import { cn } from "@/lib/utils";

type Inscripcion = { factorId: string; qr: string; secreto: string };

/** Comparte el prefijo de `MFA_QUERY_KEY`: invalidar ese invalida los dos. */
const SEGUNDO_PASO_KEY = [...MFA_QUERY_KEY, "servidor"] as const;

const BOTON_SECUNDARIO =
  "rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50";
const BOTON_MARCA =
  "rounded-lg border border-brand bg-transparent px-3 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand/12 disabled:opacity-50";
const BOTON_PRIMARIO =
  "rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50";
const INPUT_CODIGO =
  "w-40 rounded-lg border border-input bg-background px-3 py-2 text-center tracking-[0.3em] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function Estado({ activo }: { activo: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        activo
          ? "border-success-border bg-success-soft text-success"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {activo ? "Activa" : "No activa"}
    </span>
  );
}

/**
 * Solo se monta en /preferencias, dentro de la app. NO en la pantalla de
 * acceso restringido de /admin: ahí cualquiera con una contraseña robada de
 * staff podría inscribir su propio TOTP y subir a aal2 (revisión del PR #65).
 */
export function VerificacionDosPasosCard() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const { data: local, isLoading: cargandoLocal } = useEstadoMfa();
  const {
    data: servidor,
    isLoading: cargandoServidor,
    isError: errorServidor,
  } = useQuery({
    queryKey: SEGUNDO_PASO_KEY,
    queryFn: () => getMiSegundoPaso(),
    staleTime: 30_000,
    retry: 1,
  });
  const [inscripcion, setInscripcion] = useState<Inscripcion | null>(null);
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmandoBaja, setConfirmandoBaja] = useState<MetodoMfa | null>(null);
  const [pedirReingreso, setPedirReingreso] = useState(false);
  // Activación del correo: null = sin empezar; si no, a dónde se mandó.
  const [altaCorreo, setAltaCorreo] = useState<{ a: string | null } | null>(null);
  const [codigoCorreo, setCodigoCorreo] = useState("");
  const [errorCorreo, setErrorCorreo] = useState<string | null>(null);

  const tieneApp = Boolean(local?.tieneFactor);
  const correoActivo = Boolean(servidor?.correoActivo);
  const esDemo = Boolean(local?.esDemo || servidor?.esDemo);
  const isLoading = cargandoLocal || cargandoServidor;

  const refrescar = async () => {
    await queryClient.invalidateQueries({ queryKey: MFA_QUERY_KEY });
  };

  async function volverAEntrar() {
    const supabase = await getSupabase();
    await supabase.auth.signOut({ scope: "local" });
    void navigate({ to: "/auth" });
  }

  // ---------------------------------------------------------------- App (TOTP)

  const iniciar = useMutation({
    mutationFn: async (): Promise<Inscripcion | null> => {
      const supabase = await getSupabase();
      // Inscribir un factor exige haber iniciado sesión hace poco: una sesión
      // olvidada abierta (o robada) no alcanza para atarle un TOTP ajeno.
      // Se relee del JWT en el momento del clic, no del cache.
      const { data: niveles } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!sesionReciente(niveles?.currentAuthenticationMethods, Date.now())) return null;
      // Con el correo activo, la base solo acepta el factor nuevo si una
      // sesión verificada lo autoriza (trigger exigir_correo_para_inscribir_factor).
      const permiso = await autorizarInscripcionApp();
      if (!permiso.ok) throw new Error(permiso.motivo);
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
    onError: (e: Error) =>
      toast.error(e.message || "No pudimos iniciar la activación. Intenta de nuevo."),
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
      toast.success("App autenticadora activada");
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

  const desactivarApp = useMutation({
    mutationFn: async () => {
      if (!local?.factorId) throw new Error("No hay una app activa.");
      const supabase = await getSupabase();
      // Supabase exige una sesión aal2 para quitar un factor verificado.
      const { error: errorBaja } = await supabase.auth.mfa.unenroll({
        factorId: local.factorId,
      });
      if (errorBaja) {
        throw new Error(
          "Para desactivar la app, entra verificando con la app (no con el correo) e intenta de nuevo.",
        );
      }
      // Sin esto la sesión sigue diciendo aal2 hasta el próximo refresco.
      await supabase.auth.refreshSession();
    },
    onSuccess: async () => {
      setConfirmandoBaja(null);
      toast.success("App autenticadora desactivada");
      await refrescar();
      await router.invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ------------------------------------------------------------------ Correo

  const pedirCodigoCorreo = useMutation({
    mutationFn: () => enviarCodigoPorCorreo({ data: { proposito: "activar" } }),
    onSuccess: (r) => {
      if (r.ok) {
        setAltaCorreo({ a: r.enviadoA });
        setCodigoCorreo("");
        setErrorCorreo(null);
        return;
      }
      if (r.reingreso) setPedirReingreso(true);
      setErrorCorreo(r.motivo);
    },
    onError: (e: Error) => setErrorCorreo(e.message),
  });

  const confirmarCorreo = useMutation({
    mutationFn: async () => {
      const r = await verificarCodigoPorCorreo({
        data: { proposito: "activar", codigo: codigoCorreo },
      });
      if (!r.ok) throw new Error(r.motivo);
    },
    onSuccess: async () => {
      setAltaCorreo(null);
      setCodigoCorreo("");
      setErrorCorreo(null);
      // La activación verificó esta sesión: no se le vuelve a pedir el código.
      const supabase = await getSupabase();
      const { data } = await supabase.auth.getSession();
      marcarSesionQueCumple(data.session);
      toast.success("Código por correo activado");
      await refrescar();
    },
    onError: (e: Error) => {
      setErrorCorreo(e.message);
      setCodigoCorreo("");
    },
  });

  const configurar = useMutation({
    mutationFn: (input: { accion: "desactivar" } | { accion: "preferir"; metodo: MetodoMfa }) =>
      configurarSegundoPaso({ data: input }),
    onSuccess: async (nuevo, input) => {
      queryClient.setQueryData(SEGUNDO_PASO_KEY, nuevo);
      setConfirmandoBaja(null);
      toast.success(
        input.accion === "desactivar"
          ? "Código por correo desactivado"
          : "Método preferido guardado",
      );
      await refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ocupado =
    iniciar.isPending ||
    confirmar.isPending ||
    cancelar.isPending ||
    desactivarApp.isPending ||
    pedirCodigoCorreo.isPending ||
    confirmarCorreo.isPending ||
    configurar.isPending;

  const algunoActivo = tieneApp || correoActivo;
  const metodoPreferido: MetodoMfa = servidor?.metodoPreferido ?? "totp";
  const motivoCorreo = servidor?.textoCorreoNoDisponible ?? null;

  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="titulo-2fa">
      <div className="flex gap-3">
        {algunoActivo ? (
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        ) : (
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <h2 id="titulo-2fa" className="font-display text-base font-semibold">
            Verificación en dos pasos
          </h2>
          <p className="text-sm text-muted-foreground">
            Además de tu contraseña, al entrar Esmalia te pide un código de 6 números. Si alguien
            consigue tu contraseña, igual no puede entrar a las fichas de tus pacientes. Elige cómo
            recibir el código: con una app autenticadora en tu teléfono, por correo, o los dos.
          </p>

          {isLoading ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando…
            </p>
          ) : esDemo ? (
            <p className="mt-3 text-sm text-muted-foreground">
              La cuenta de la demo es compartida: no se le puede activar la verificación en dos
              pasos. Crea tu propia cuenta para eso.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {servidor && (
                <p
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm",
                    algunoActivo
                      ? "border-success-border bg-success-soft"
                      : "border-border bg-muted/40",
                  )}
                >
                  {resumenAlEntrar(
                    { tieneTotp: tieneApp, correoActivo, metodoPreferido },
                    servidor.correoEnmascarado,
                  )}
                </p>
              )}
              {errorServidor && (
                <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  No pudimos cargar el estado del código por correo. Recarga la página para verlo.
                </p>
              )}

              {/* ---------------------------------------- App autenticadora */}
              <div className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 gap-2.5">
                    <Smartphone className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">App autenticadora</h3>
                      <p className="text-sm text-muted-foreground">
                        Google Authenticator, 1Password, Authy u otra. El código lo genera la app en
                        tu teléfono, sin conexión; no llega por correo.
                      </p>
                    </div>
                  </div>
                  <Estado activo={tieneApp} />
                </div>

                {tieneApp ? (
                  confirmandoBaja === "totp" ? (
                    <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      <p className="text-sm">
                        {correoActivo
                          ? "Te quedará solo el código por correo. ¿La desactivas igual?"
                          : "Sin la verificación, tu cuenta queda protegida solo por la contraseña. ¿La desactivas igual?"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => desactivarApp.mutate()}
                          className="rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                        >
                          {desactivarApp.isPending && (
                            <Loader2 className="mr-1 inline size-4 animate-spin" />
                          )}
                          Sí, desactivar
                        </button>
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => setConfirmandoBaja(null)}
                          className={BOTON_SECUNDARIO}
                        >
                          Mantenerla
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmandoBaja("totp")}
                      className={cn(BOTON_SECUNDARIO, "mt-3")}
                    >
                      Desactivar la app
                    </button>
                  )
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
                        Abre tu app autenticadora (Google Authenticator, 1Password, Authy u otra).
                      </li>
                      <li>Escanea este código QR.</li>
                      <li>Escribe el código de 6 números que te muestra la app.</li>
                    </ol>
                    <img
                      src={inscripcion.qr}
                      alt="Código QR para tu app autenticadora"
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
                        Código de la app
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
                        className={INPUT_CODIGO}
                      />
                    </div>
                    <div aria-live="polite" role="status">
                      {error && <p className="text-xs text-destructive">{error}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>
                        {confirmar.isPending && (
                          <Loader2 className="mr-1 inline size-4 animate-spin" />
                        )}
                        Activar
                      </button>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => cancelar.mutate()}
                        className={BOTON_SECUNDARIO}
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
                    className={cn(BOTON_MARCA, "mt-3")}
                  >
                    {iniciar.isPending && <Loader2 className="mr-1 inline size-4 animate-spin" />}
                    Activar con una app
                  </button>
                )}
              </div>

              {/* ------------------------------------------- Código por correo */}
              <div className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 gap-2.5">
                    <Mail className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">Código por correo</h3>
                      <p className="text-sm text-muted-foreground">
                        Te mandamos un código de 6 números
                        {servidor?.correoEnmascarado ? (
                          <>
                            {" "}
                            a{" "}
                            <span className="font-medium text-foreground">
                              {servidor.correoEnmascarado}
                            </span>
                          </>
                        ) : (
                          " al correo de tu cuenta"
                        )}{" "}
                        cada vez que entras. Vence en 10 minutos.
                      </p>
                    </div>
                  </div>
                  <Estado activo={correoActivo} />
                </div>

                {correoActivo ? (
                  confirmandoBaja === "email" ? (
                    <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      <p className="text-sm">
                        {tieneApp
                          ? "Te quedará solo la app autenticadora. ¿Lo desactivas igual?"
                          : "Sin la verificación, tu cuenta queda protegida solo por la contraseña. ¿Lo desactivas igual?"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => configurar.mutate({ accion: "desactivar" })}
                          className="rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                        >
                          {configurar.isPending && (
                            <Loader2 className="mr-1 inline size-4 animate-spin" />
                          )}
                          Sí, desactivar
                        </button>
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => setConfirmandoBaja(null)}
                          className={BOTON_SECUNDARIO}
                        >
                          Mantenerlo
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmandoBaja("email")}
                      className={cn(BOTON_SECUNDARIO, "mt-3")}
                    >
                      Desactivar el correo
                    </button>
                  )
                ) : altaCorreo ? (
                  <form
                    className="mt-4 space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setErrorCorreo(null);
                      confirmarCorreo.mutate();
                    }}
                  >
                    <p className="text-sm text-muted-foreground">
                      Te mandamos un código
                      {altaCorreo.a ? ` a ${altaCorreo.a}` : ""}. Escríbelo aquí para confirmar que
                      ese correo es tuyo.
                    </p>
                    <div>
                      <label
                        htmlFor="codigo-alta-correo"
                        className="mb-1.5 block text-xs font-medium"
                      >
                        Código del correo
                      </label>
                      <input
                        id="codigo-alta-correo"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={9}
                        value={codigoCorreo}
                        onChange={(e) => setCodigoCorreo(e.target.value)}
                        disabled={ocupado}
                        required
                        className={INPUT_CODIGO}
                      />
                    </div>
                    <div aria-live="polite" role="status">
                      {errorCorreo && <p className="text-xs text-destructive">{errorCorreo}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>
                        {confirmarCorreo.isPending && (
                          <Loader2 className="mr-1 inline size-4 animate-spin" />
                        )}
                        Activar
                      </button>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => pedirCodigoCorreo.mutate()}
                        className={BOTON_SECUNDARIO}
                      >
                        Reenviar el código
                      </button>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => {
                          setAltaCorreo(null);
                          setErrorCorreo(null);
                        }}
                        className={BOTON_SECUNDARIO}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="mt-3">
                    <AccionDeshabilitada
                      motivo={motivoCorreo}
                      className="items-start [&>span]:text-left"
                    >
                      <button
                        type="button"
                        disabled={ocupado || !servidor}
                        onClick={() => {
                          setErrorCorreo(null);
                          pedirCodigoCorreo.mutate();
                        }}
                        className={BOTON_MARCA}
                      >
                        {pedirCodigoCorreo.isPending && (
                          <Loader2 className="mr-1 inline size-4 animate-spin" />
                        )}
                        Activar por correo
                      </button>
                    </AccionDeshabilitada>
                    <div aria-live="polite" role="status">
                      {errorCorreo && (
                        <p className="mt-2 text-xs text-destructive">{errorCorreo}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ---------------------------------------- Método preferido */}
              {tieneApp && correoActivo && (
                <fieldset className="rounded-lg border border-border p-4" disabled={ocupado}>
                  <legend className="px-1 text-sm font-semibold">Al entrar, pedirme primero</legend>
                  <p className="text-sm text-muted-foreground">
                    En la pantalla del código siempre puedes elegir &quot;Usar el otro método&quot;.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2" role="radiogroup">
                    {(["totp", "email"] as const).map((m) => {
                      const elegido = metodoPreferido === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={elegido}
                          onClick={() => {
                            if (!elegido) configurar.mutate({ accion: "preferir", metodo: m });
                          }}
                          className={cn(
                            "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors pointer-coarse:min-h-11",
                            elegido
                              ? "border-brand bg-brand/12 text-brand-700"
                              : "border-border hover:bg-accent",
                          )}
                        >
                          {m === "totp" ? (
                            <Smartphone className="size-4" aria-hidden />
                          ) : (
                            <Mail className="size-4" aria-hidden />
                          )}
                          {m === "totp" ? "La app autenticadora" : "El código por correo"}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
            </div>
          )}

          {pedirReingreso && !inscripcion && (
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p>
                Por seguridad, para activar un método tienes que haber iniciado sesión hace menos de{" "}
                {MINUTOS_SESION_RECIENTE} minutos. Vuelve a entrar y actívalo de inmediato.
              </p>
              <button
                type="button"
                onClick={() => void volverAEntrar()}
                className={cn(BOTON_MARCA, "mt-2")}
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
