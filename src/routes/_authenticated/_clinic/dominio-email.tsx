import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Lock,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { requirePermission } from "@/lib/access/route-guards";
import { verificarDnsEmail } from "@/lib/messaging/dns-email.functions";
import {
  PASOS_ASISTENTE,
  VIGENCIA_HORAS,
  esDominioValido,
  guardarVerificacion,
  leerVerificacion,
  puedeActivarProduccion,
  type DnsCheckId,
  type DnsCheckState,
  type DnsVerification,
} from "@/lib/messaging/dns-email";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_clinic/dominio-email")({
  beforeLoad: requirePermission("team:manage"),
  head: () => ({
    meta: [
      { title: "Autenticación del dominio de email | Esmalia" },
      {
        name: "description",
        content:
          "Asistente guiado para configurar SPF, DKIM y DMARC y validar que el dominio pasa antes de habilitar los envíos en producción.",
      },
      { property: "og:title", content: "Autenticación del dominio de email | Esmalia" },
      {
        property: "og:description",
        content: "Verifica SPF, DKIM y DMARC de tu clínica antes de enviar correos reales.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DominioEmailPage,
});

const ESTADO_UI: Record<
  DnsCheckState,
  { label: string; clase: string; Icono: typeof CheckCircle2 }
> = {
  pass: {
    label: "Correcto",
    clase: "border-primary/30 bg-primary/5 text-primary",
    Icono: CheckCircle2,
  },
  warn: {
    label: "Aviso",
    clase: "border-warning-border bg-warning-soft text-warning",
    Icono: AlertTriangle,
  },
  fail: {
    label: "Falla",
    clase: "border-destructive/40 bg-destructive/5 text-destructive",
    Icono: XCircle,
  },
};

function tituloPaso(id: DnsCheckId) {
  return PASOS_ASISTENTE.find((p) => p.id === id)?.titulo ?? id.toUpperCase();
}

function DominioEmailPage() {
  const { access } = Route.useRouteContext();
  const verificar = useServerFn(verificarDnsEmail);

  const [domain, setDomain] = useState("");
  const [selector, setSelector] = useState("default");
  const [verificacion, setVerificacion] = useState<DnsVerification | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const guardada = leerVerificacion();
    if (guardada) {
      setVerificacion(guardada);
      setDomain(guardada.domain);
      setSelector(guardada.dkimSelector);
    }
  }, []);

  const puerta = useMemo(() => puedeActivarProduccion(verificacion), [verificacion]);

  async function ejecutar() {
    if (!esDominioValido(domain)) {
      toast.error("Introduce un dominio válido, por ejemplo tuclinica.com");
      return;
    }
    if (!access.clinic?.id) {
      toast.error("Todavía no elegiste clínica activa.");
      return;
    }
    setCargando(true);
    setError(null);
    try {
      const resultado = await verificar({
        data: { clinicId: access.clinic.id, domain, dkimSelector: selector },
      });
      setVerificacion(resultado);
      guardarVerificacion(resultado);
      if (resultado.aprobado) {
        toast.success("Dominio verificado: ya puedes habilitar producción.");
      } else {
        toast.error("Hay controles en falla. Corrige el DNS y vuelve a validar.");
      }
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : "No se pudo completar la verificación DNS.";
      setError(mensaje);
      toast.error(mensaje);
    } finally {
      setCargando(false);
    }
  }

  return (
    <AppShell title="Autenticación del dominio" access={access}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-xl font-semibold text-foreground">
            Asistente de SPF, DKIM y DMARC
          </h1>
          <p className="text-sm text-muted-foreground">
            Configura los tres registros que autentican tu dominio y valida en DNS real que están
            publicados. Hasta que la verificación pase, el sandbox de email mantiene bloqueados los
            envíos a destinatarios reales.
          </p>
        </header>

        <div
          className={cn(
            "flex items-start gap-3 rounded-xl border p-5",
            puerta.permitido
              ? "border-primary/30 bg-primary/5 text-primary"
              : "border-warning-border bg-warning-soft text-warning",
          )}
          role="status"
        >
          {puerta.permitido ? (
            <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
          ) : (
            <Lock className="mt-0.5 size-5 shrink-0" aria-hidden />
          )}
          <div>
            <h2 className="font-display text-base font-semibold">
              {puerta.permitido ? "Producción habilitada" : "Producción bloqueada"}
            </h2>
            <p className="text-sm opacity-90">{puerta.motivo}</p>
          </div>
        </div>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-base font-semibold">1. Verifica tu dominio</h2>
          <p className="text-sm text-muted-foreground">
            Consultamos los registros TXT publicados en DNS en este momento. La verificación caduca
            a las {VIGENCIA_HORAS} h para detectar cambios de DNS.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dominio" className="text-sm font-medium">
                Dominio de envío
              </label>
              <input
                id="dominio"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="tuclinica.com"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="selector" className="text-sm font-medium">
                Selector DKIM
              </label>
              <input
                id="selector"
                value={selector}
                onChange={(e) => setSelector(e.target.value)}
                placeholder="default"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
            <button
              type="button"
              onClick={ejecutar}
              disabled={cargando}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-brand bg-transparent px-4 py-2 text-sm font-medium text-brand-700 transition-opacity hover:bg-brand/12 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <RefreshCw className={cn("size-4", cargando && "animate-spin")} aria-hidden />
              {cargando ? "Verificando…" : "Verificar DNS"}
            </button>
          </div>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </section>

        {verificacion ? (
          <section className="rounded-xl border border-border bg-card">
            <header className="border-b border-border p-5">
              <h2 className="font-display text-base font-semibold">Resultado de la verificación</h2>
              <p className="text-sm text-muted-foreground">
                {verificacion.domain} · selector {verificacion.dkimSelector} ·{" "}
                {new Date(verificacion.checkedAt).toLocaleString("es-MX")} ·{" "}
                {verificacion.durationMs} ms
              </p>
            </header>
            <ul className="divide-y divide-border">
              {verificacion.results.map((r) => {
                const ui = ESTADO_UI[r.state];
                return (
                  <li key={r.id} className="flex gap-3 p-5">
                    <ui.Icono
                      className={cn(
                        "mt-0.5 size-5 shrink-0",
                        r.state === "pass"
                          ? "text-primary"
                          : r.state === "warn"
                            ? "text-warning"
                            : "text-destructive",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{tituloPaso(r.id)}</p>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-medium",
                            ui.clase,
                          )}
                        >
                          {ui.label}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{r.detalle}</p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{r.name}</p>
                      {r.records.length > 0 ? (
                        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-xs text-foreground">
                          {r.records.join("\n")}
                        </pre>
                      ) : null}
                      {r.sugerencia ? (
                        <p className="mt-2 flex items-start gap-1 text-sm text-foreground">
                          <ChevronRight
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          {r.sugerencia}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border p-5">
            <h2 className="font-display text-base font-semibold">2. Guía de configuración</h2>
            <p className="text-sm text-muted-foreground">
              Publica estos registros en el DNS de tu dominio antes de volver a verificar.
            </p>
          </header>
          <ol className="divide-y divide-border">
            {PASOS_ASISTENTE.map((paso, indice) => {
              const resultado = verificacion?.results.find((r) => r.id === paso.id);
              return (
                <li key={paso.id} className="flex gap-4 p-5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border text-sm font-medium text-muted-foreground">
                    {indice + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">{paso.titulo}</h3>
                      {resultado ? (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-medium",
                            ESTADO_UI[resultado.state].clase,
                          )}
                        >
                          {ESTADO_UI[resultado.state].label}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{paso.porQue}</p>
                    <p className="mt-2 text-sm text-foreground">{paso.comoSeArregla}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </AppShell>
  );
}
