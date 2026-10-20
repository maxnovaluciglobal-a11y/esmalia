import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, ShieldAlert, ShieldCheck, Siren } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { requirePermission } from "@/lib/access/route-guards";
import {
  getEmailSandboxConfig,
  setEmailSandboxConfig,
} from "@/lib/messaging/email-config.functions";
import {
  DEFAULT_EMAIL_SANDBOX,
  isValidEmail,
  parseAllowlist,
  resolveEmailRecipient,
  resumenSandbox,
  clampMinEntregas,
  MAX_ENTREGAS_PRODUCCION,
  type EmailSandboxConfig,
} from "@/lib/messaging/email-sandbox";
import {
  leerEmailTestLog,
  puertaEntregasProduccion,
  type EmailTestEntry,
} from "@/lib/messaging/email-test-log";
import {
  leerVerificacion,
  puedeActivarProduccion,
  type DnsVerification,
} from "@/lib/messaging/dns-email";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";

export const Route = createFileRoute("/_authenticated/_clinic/sandbox-email")({
  beforeLoad: requirePermission("team:manage"),
  head: () => ({
    meta: [
      { title: "Modo sandbox de email | Esmalia" },
      {
        name: "description",
        content:
          "Bloquea los envíos reales y desvía todos los emails a direcciones de prueba mientras validas la entregabilidad.",
      },
      { property: "og:title", content: "Modo sandbox de email | Esmalia" },
      {
        property: "og:description",
        content: "Control de envíos de prueba y bloqueo de emails reales en Esmalia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SandboxEmailPage,
});

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border border-border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        checked ? "bg-primary" : "bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-4.5 rounded-full bg-background shadow transition-all",
          checked ? "left-[1.4rem]" : "left-0.5",
        )}
      />
    </button>
  );
}

function SandboxEmailPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const fetchConfig = useServerFn(getEmailSandboxConfig);
  const saveConfig = useServerFn(setEmailSandboxConfig);
  const [config, setConfig] = useState<EmailSandboxConfig>(DEFAULT_EMAIL_SANDBOX);
  const [allowlistTexto, setAllowlistTexto] = useState("");
  const [prueba, setPrueba] = useState("");
  const [listo, setListo] = useState(false);
  const [verificacionDns, setVerificacionDns] = useState<DnsVerification | null>(null);
  const [log, setLog] = useState<EmailTestEntry[]>([]);
  const puertaDns = useMemo(() => puedeActivarProduccion(verificacionDns), [verificacionDns]);
  const puertaEntregas = useMemo(
    () => puertaEntregasProduccion(log, config.minEntregasProduccion),
    [log, config.minEntregasProduccion],
  );
  const puertaProduccion = useMemo(
    () =>
      puertaDns.permitido
        ? { permitido: puertaEntregas.permitido, motivo: puertaEntregas.motivo }
        : puertaDns,
    [puertaDns, puertaEntregas],
  );

  useEffect(() => {
    if (!clinicId) return;
    let cancelado = false;
    void fetchConfig({ data: { clinicId } })
      .then((guardado) => {
        if (cancelado) return;
        setConfig(guardado);
        setAllowlistTexto(guardado.allowlist.join("\n"));
      })
      .catch(() => {
        if (!cancelado) toast.error("No pudimos cargar la configuración de sandbox.");
      })
      .finally(() => {
        if (!cancelado) setListo(true);
      });
    setVerificacionDns(leerVerificacion());
    setLog(leerEmailTestLog());
    return () => {
      cancelado = true;
    };
  }, [clinicId, fetchConfig]);

  function persistir(siguiente: EmailSandboxConfig) {
    if (!clinicId) return;
    void saveConfig({
      data: {
        clinicId,
        mode: siguiente.mode,
        redirectTo: siguiente.redirectTo,
        allowlist: siguiente.allowlist,
        redirectEnabled: siguiente.redirectEnabled,
        prefixSubject: siguiente.prefixSubject,
        minEntregasProduccion: siguiente.minEntregasProduccion,
      },
    }).catch((e: Error) => toast.error(mensajeDeError(e)));
  }

  function actualizar(parcial: Partial<EmailSandboxConfig>) {
    setConfig((prev) => {
      const siguiente = { ...prev, ...parcial };
      persistir(siguiente);
      return siguiente;
    });
  }

  function guardarAllowlist() {
    const lista = parseAllowlist(allowlistTexto);
    actualizar({ allowlist: lista });
    setAllowlistTexto(lista.join("\n"));
    toast.success(
      lista.length === 0
        ? "Lista de direcciones de prueba vaciada"
        : `${lista.length} dirección(es) de prueba guardada(s)`,
    );
  }

  const resumen = resumenSandbox(config);
  const decision = useMemo(
    () => (isValidEmail(prueba) ? resolveEmailRecipient(prueba, config) : null),
    [prueba, config],
  );

  const tonoClases = {
    seguro: "border-primary/30 bg-primary/5 text-primary",
    aviso: "border-warning-border bg-warning-soft text-warning",
    peligro: "border-destructive/40 bg-destructive/5 text-destructive",
  }[resumen.tono];

  const IconoResumen =
    resumen.tono === "peligro" ? Siren : resumen.tono === "aviso" ? ShieldAlert : ShieldCheck;

  return (
    <AppShell title="Modo sandbox de email" access={access}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className={cn("flex items-start gap-3 rounded-xl border p-5", tonoClases)}>
          <IconoResumen className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 className="font-display text-base font-semibold">{resumen.titulo}</h2>
            <p className="text-sm opacity-90">{resumen.detalle}</p>
          </div>
        </div>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex gap-3">
            <FlaskConical className="mt-0.5 size-5 text-primary" />
            <div className="flex-1">
              <h2 className="font-display text-base font-semibold">Estado del entorno</h2>
              <p className="text-sm text-muted-foreground">
                En sandbox ningún email puede llegar a un paciente o profesional real. Actívalo
                durante toda la validación y pásalo a producción solo cuando la entregabilidad esté
                confirmada.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {[
                  {
                    valor: "sandbox" as const,
                    titulo: "Sandbox",
                    detalle: "Envíos reales bloqueados",
                  },
                  {
                    valor: "production" as const,
                    titulo: "Producción",
                    detalle: "Envíos reales habilitados",
                  },
                ].map((opcion) => (
                  <button
                    key={opcion.valor}
                    type="button"
                    disabled={
                      !listo || (opcion.valor === "production" && !puertaProduccion.permitido)
                    }
                    title={
                      opcion.valor === "production" && !puertaProduccion.permitido
                        ? puertaProduccion.motivo
                        : undefined
                    }
                    onClick={() => {
                      if (opcion.valor === "production" && !puertaProduccion.permitido) {
                        toast.error(puertaProduccion.motivo);
                        return;
                      }
                      actualizar({ mode: opcion.valor });
                      toast[opcion.valor === "production" ? "warning" : "success"](
                        opcion.valor === "production"
                          ? "Producción activada: los emails saldrán a destinatarios reales"
                          : "Sandbox activado: los envíos reales quedan bloqueados",
                      );
                    }}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
                      config.mode === opcion.valor
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent",
                    )}
                  >
                    <p className="text-sm font-medium">{opcion.titulo}</p>
                    <p className="text-sm text-muted-foreground">{opcion.detalle}</p>
                  </button>
                ))}
              </div>
              <p
                className={cn(
                  "mt-3 text-sm",
                  puertaDns.permitido ? "text-muted-foreground" : "text-warning",
                )}
              >
                {puertaDns.motivo}
              </p>

              <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Entregas de prueba exigidas</p>
                    <p className="text-sm text-muted-foreground">
                      Producción queda bloqueada hasta que se entreguen correctamente al menos estos
                      emails de prueba.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Mínimo</span>
                    <input
                      type="number"
                      min={0}
                      max={MAX_ENTREGAS_PRODUCCION}
                      value={config.minEntregasProduccion}
                      onChange={(e) =>
                        actualizar({ minEntregasProduccion: clampMinEntregas(e.target.value) })
                      }
                      className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    />
                  </label>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      puertaEntregas.permitido ? "bg-primary" : "bg-warning-border",
                    )}
                    style={{
                      width: `${
                        config.minEntregasProduccion > 0
                          ? Math.min(
                              100,
                              (puertaEntregas.entregados / config.minEntregasProduccion) * 100,
                            )
                          : 100
                      }%`,
                    }}
                  />
                </div>
                <p
                  className={cn(
                    "mt-2 text-sm",
                    puertaEntregas.permitido ? "text-muted-foreground" : "text-warning",
                  )}
                >
                  {puertaEntregas.motivo}
                  {puertaEntregas.destinatarios > 0
                    ? ` (${puertaEntregas.destinatarios} destinatario(s) distintos)`
                    : ""}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border p-5">
            <h2 className="font-display text-base font-semibold">Reglas de sandbox</h2>
            <p className="text-sm text-muted-foreground">
              Define a dónde va cada email mientras el sandbox está activo.
            </p>
          </header>

          <div className="flex items-start justify-between gap-4 border-b border-border p-5">
            <div>
              <p className="text-sm font-medium">Redirigir en lugar de bloquear</p>
              <p className="text-sm text-muted-foreground">
                Si está desactivado, cualquier destinatario fuera de la lista de prueba se bloquea
                sin enviarse.
              </p>
            </div>
            <Switch
              label="Redirigir en lugar de bloquear"
              checked={config.redirectEnabled}
              disabled={!listo || config.mode === "production"}
              onChange={(v) => actualizar({ redirectEnabled: v })}
            />
          </div>

          <div className="border-b border-border p-5">
            <label htmlFor="redirect-to" className="text-sm font-medium">
              Dirección de redirección
            </label>
            <p className="text-sm text-muted-foreground">
              Todos los emails desviados llegarán aquí, con el destinatario original indicado en el
              contenido.
            </p>
            <input
              id="redirect-to"
              type="email"
              value={config.redirectTo}
              disabled={!listo || config.mode === "production"}
              onChange={(e) => actualizar({ redirectTo: e.target.value })}
              placeholder="pruebas@tuclinica.com"
              className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
            />
            {config.redirectTo && !isValidEmail(config.redirectTo) ? (
              <p className="mt-2 text-sm text-destructive">Introduce una dirección válida.</p>
            ) : null}
          </div>

          <div className="border-b border-border p-5">
            <label htmlFor="allowlist" className="text-sm font-medium">
              Direcciones de prueba permitidas
            </label>
            <p className="text-sm text-muted-foreground">
              Una por línea. Estas reciben su email tal cual, sin redirección.
            </p>
            <textarea
              id="allowlist"
              rows={4}
              value={allowlistTexto}
              disabled={!listo || config.mode === "production"}
              onChange={(e) => setAllowlistTexto(e.target.value)}
              placeholder={"yo@tuclinica.com\nqa@tuclinica.com"}
              className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
            />
            <button
              type="button"
              disabled={!listo || config.mode === "production"}
              onClick={guardarAllowlist}
              className="mt-3 rounded-lg border border-brand bg-transparent px-3 py-2 text-sm font-medium text-brand-700 transition-opacity hover:bg-brand/12 disabled:opacity-50"
            >
              Guardar lista
            </button>
          </div>

          <div className="flex items-start justify-between gap-4 p-5">
            <div>
              <p className="text-sm font-medium">Marcar el asunto con [SANDBOX]</p>
              <p className="text-sm text-muted-foreground">
                Distingue de un vistazo los correos de validación en tu bandeja.
              </p>
            </div>
            <Switch
              label="Marcar el asunto con SANDBOX"
              checked={config.prefixSubject}
              disabled={!listo || config.mode === "production"}
              onChange={(v) => actualizar({ prefixSubject: v })}
            />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-base font-semibold">Simulador de destinatario</h2>
          <p className="text-sm text-muted-foreground">
            Comprueba qué haría Esmalia con un destinatario concreto sin enviar nada.
          </p>
          <input
            type="email"
            value={prueba}
            onChange={(e) => setPrueba(e.target.value)}
            placeholder="paciente@ejemplo.com"
            className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          {decision ? (
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                {decision.action === "block"
                  ? "Bloqueado"
                  : decision.action === "redirect"
                    ? `Redirigido a ${decision.recipient}`
                    : `Enviado a ${decision.recipient}`}
              </p>
              <p className="text-muted-foreground">{decision.reason}</p>
            </div>
          ) : null}
        </section>

        <p className="text-sm text-muted-foreground">
          El sandbox ya está aplicado como puerta de salida: cuando conectes el dominio de envío,
          ningún email podrá despacharse sin pasar por estas reglas.
        </p>
      </div>
    </AppShell>
  );
}
