import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Download,
  Send,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { requireOwner } from "@/lib/access/route-guards";
import { useServerFn } from "@tanstack/react-start";
import { leerVerificacion, type DnsVerification } from "@/lib/messaging/dns-email";
import { getEmailSandboxConfig } from "@/lib/messaging/email-config.functions";
import {
  DEFAULT_EMAIL_SANDBOX,
  resumenSandbox,
  type EmailSandboxConfig,
} from "@/lib/messaging/email-sandbox";
import {
  GRUPO_LABEL,
  ejecutarPreflight,
  preflightVigente,
  type PreflightGroup,
  type PreflightReport,
  type PreflightState,
} from "@/lib/messaging/email-preflight";
import {
  CANAL_SIN_DOMINIO,
  EMAIL_TEST_TEMPLATES,
  datosEjemplo,
  definicionPlantilla,
  ejecutarPruebaEmail,
  estadoPorDestinatario,
  etiquetaPlantilla,
  exportarLogCsv,
  guardarEmailTestLog,
  leerEmailTestLog,
  limpiarEmailTestLog,
  type EmailTemplateData,
  type EmailTestEntry,
  type EmailTestStatus,
  type EmailTestTemplate,
} from "@/lib/messaging/email-test-log";
import { cn } from "@/lib/utils";
import { fechaCortaHora } from "@/lib/formato-fecha";

export const Route = createFileRoute("/_authenticated/_clinic/pruebas-email")({
  beforeLoad: requireOwner(),
  head: () => ({
    meta: [
      { title: "Pruebas de email | Esmalia" },
      {
        name: "description",
        content:
          "Ejecuta emails de prueba, revisa el estado por destinatario y consulta el registro de tiempos y errores de envío.",
      },
      { property: "og:title", content: "Pruebas de email | Esmalia" },
      {
        property: "og:description",
        content: "Panel de validación de entregabilidad de correos en Esmalia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PruebasEmailPage,
});

const ESTADO_UI: Record<EmailTestStatus, { label: string; clase: string }> = {
  enviado: { label: "Enviado", clase: "bg-primary/10 text-primary border-primary/30" },
  redirigido: { label: "Redirigido", clase: "bg-accent text-accent-foreground border-border" },
  bloqueado: { label: "Bloqueado", clase: "bg-muted text-muted-foreground border-border" },
  error: { label: "Error", clase: "bg-destructive/10 text-destructive border-destructive/30" },
};

function EstadoBadge({ estado }: { estado: EmailTestStatus }) {
  const ui = ESTADO_UI[estado];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        ui.clase,
      )}
    >
      {ui.label}
    </span>
  );
}

function formatoFecha(iso: string) {
  return fechaCortaHora(iso);
}

const ICONO_PREFLIGHT: Record<PreflightState, { Icon: typeof CheckCircle2; clase: string }> = {
  pass: { Icon: CheckCircle2, clase: "text-primary" },
  warn: { Icon: AlertTriangle, clase: "text-muted-foreground" },
  fail: { Icon: XCircle, clase: "text-destructive" },
};

const GRUPOS: PreflightGroup[] = ["conexion", "plantilla", "variables"];

function PreflightPanel({ report }: { report: PreflightReport | null }) {
  if (!report) {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        Ejecuta la verificación previa para comprobar conexión, plantilla y variables. El envío
        permanece bloqueado hasta que todos los controles pasen.
      </p>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3",
        report.ok ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5",
      )}
      role="status"
    >
      <p className="text-sm font-medium text-foreground">
        {report.ok
          ? `Verificación aprobada (${report.durationMs} ms) — ${formatoFecha(report.checkedAt)}`
          : report.motivoBloqueo}
      </p>

      {GRUPOS.map((grupo) => {
        const items = report.checks.filter((c) => c.group === grupo);
        if (items.length === 0) return null;
        return (
          <div key={grupo} className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {GRUPO_LABEL[grupo]}
            </p>
            <ul className="flex flex-col gap-1">
              {items.map((check) => {
                const { Icon, clase } = ICONO_PREFLIGHT[check.state];
                return (
                  <li key={check.id} className="flex items-start gap-2 text-xs">
                    <Icon className={cn("mt-0.5 size-3.5 shrink-0", clase)} aria-hidden />
                    <span className="text-foreground">
                      <span className="font-medium">{check.label}:</span> {check.detail}
                      {check.fix ? (
                        <span className="text-muted-foreground"> {check.fix}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {report.preview ? (
        <details className="rounded-md border border-border bg-background p-2 text-xs">
          <summary className="cursor-pointer font-medium text-foreground">
            Vista previa renderizada
          </summary>
          <p className="mt-2 font-medium text-foreground">{report.preview.subject}</p>
          <p className="mt-1 whitespace-pre-line text-muted-foreground">{report.preview.body}</p>
        </details>
      ) : null}
    </div>
  );
}

function PruebasEmailPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const fetchConfig = useServerFn(getEmailSandboxConfig);
  const [config, setConfig] = useState<EmailSandboxConfig>(DEFAULT_EMAIL_SANDBOX);
  const [verificacion, setVerificacion] = useState<DnsVerification | null>(null);
  const [log, setLog] = useState<EmailTestEntry[]>([]);
  const [destinatarios, setDestinatarios] = useState("");
  const [plantilla, setPlantilla] = useState<EmailTestTemplate>("smoke_test");
  const [datos, setDatos] = useState<EmailTemplateData>(() => datosEjemplo("smoke_test"));
  const [filtro, setFiltro] = useState<"todos" | EmailTestStatus>("todos");
  const [ejecutando, setEjecutando] = useState(false);
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    if (clinicId) {
      void fetchConfig({ data: { clinicId } })
        .then(setConfig)
        .catch(() => setConfig(DEFAULT_EMAIL_SANDBOX));
    }
    setLog(leerEmailTestLog());
    setVerificacion(leerVerificacion());
  }, [clinicId, fetchConfig]);

  const def = useMemo(() => definicionPlantilla(plantilla), [plantilla]);
  const resumen = useMemo(() => resumenSandbox(config), [config]);
  const destinatarioStatus = useMemo(() => estadoPorDestinatario(log), [log]);
  const logFiltrado = useMemo(
    () => (filtro === "todos" ? log : log.filter((e) => e.status === filtro)),
    [log, filtro],
  );

  const listaDestinatarios = useMemo(
    () =>
      destinatarios
        .split(/[\n,;]/)
        .map((v) => v.trim())
        .filter(Boolean),
    [destinatarios],
  );

  const puedeEnviar = preflightVigente(preflight);

  const metricas = useMemo(() => {
    const total = log.length;
    const errores = log.filter((e) => e.status === "error").length;
    const bloqueados = log.filter((e) => e.status === "bloqueado").length;
    const promedio = total ? Math.round(log.reduce((acc, e) => acc + e.durationMs, 0) / total) : 0;
    return { total, errores, bloqueados, promedio };
  }, [log]);

  function cambiarPlantilla(id: EmailTestTemplate) {
    setPlantilla(id);
    setDatos(datosEjemplo(id));
    setPreflight(null);
  }

  function cambiarDato(clave: string, valor: string) {
    setDatos((prev) => ({ ...prev, [clave]: valor }));
    setPreflight(null);
  }

  function lanzarPreflight(): PreflightReport {
    setVerificando(true);
    try {
      const reporte = ejecutarPreflight({
        template: plantilla,
        datos,
        destinatarios: listaDestinatarios,
        config,
        canal: CANAL_SIN_DOMINIO,
        verificacion,
      });
      setPreflight(reporte);
      if (reporte.ok) {
        toast.success("Verificación previa aprobada: puedes enviar.");
      } else {
        toast.error(reporte.motivoBloqueo);
      }
      return reporte;
    } finally {
      setVerificando(false);
    }
  }

  async function lanzarPrueba() {
    // Nunca se envía sin un preflight aprobado y vigente: si caducó, se repite.
    const reporte = preflightVigente(preflight) ? preflight : lanzarPreflight();
    if (!reporte?.ok) return;

    setEjecutando(true);
    try {
      const resultados = await ejecutarPruebaEmail({
        destinatarios: listaDestinatarios,
        template: plantilla,
        config,
        canal: CANAL_SIN_DOMINIO,
        datos,
        preflight: reporte,
      });
      const nuevo = [...resultados, ...log];
      setLog(nuevo);
      guardarEmailTestLog(nuevo);

      const errores = resultados.filter((r) => r.status === "error").length;
      if (errores > 0) {
        toast.error(`${errores} intento(s) con error. Revisa el registro para el detalle.`);
      } else {
        toast.success(`${resultados.length} intento(s) registrados.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo ejecutar la prueba.");
    } finally {
      setEjecutando(false);
    }
  }

  function descargarCsv() {
    const blob = new Blob([exportarLogCsv(log)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `esmalia-pruebas-email-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell access={access} title="Pruebas de email">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-2">
          <h2 className="font-display text-2xl font-semibold text-foreground">Pruebas de email</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Lanza envíos de prueba de cada aviso del flujo clínico, revisa cómo queda cada
            destinatario tras aplicar el sandbox y consulta los tiempos y errores de cada intento.
          </p>
        </header>

        <div
          className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <p className="text-foreground">
            Todavía no hay dominio de envío configurado, así que ningún correo puede salir: los
            intentos quedan registrados con el error{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">domain_not_configured</code>. En
            cuanto conectes tu dominio, este mismo panel despacha correos reales sin cambios.
          </p>
        </div>

        <section className="grid gap-4 sm:grid-cols-4">
          {[
            { label: "Intentos registrados", valor: String(metricas.total) },
            { label: "Errores", valor: String(metricas.errores) },
            { label: "Bloqueados por el modo prueba", valor: String(metricas.bloqueados) },
            { label: "Tiempo medio", valor: `${metricas.promedio} ms` },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className="mt-1 font-display text-xl font-semibold text-foreground">{kpi.valor}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-lg font-semibold text-foreground">Ejecutar prueba</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Política vigente:{" "}
              <span className="font-medium text-foreground">{resumen.titulo}</span> —{" "}
              {resumen.detalle}
            </p>

            <div className="mt-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="plantilla" className="text-sm font-medium text-foreground">
                  Plantilla
                </label>
                <select
                  id="plantilla"
                  value={plantilla}
                  onChange={(e) => cambiarPlantilla(e.target.value as EmailTestTemplate)}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {EMAIL_TEST_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">{def?.descripcion}</p>
              </div>

              {def && def.variables.length > 0 ? (
                <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
                  <legend className="px-1 text-sm font-medium text-foreground">
                    Variables de la plantilla
                  </legend>
                  {def.variables.map((v) => (
                    <div key={v.clave} className="flex flex-col gap-1">
                      <label
                        htmlFor={`var-${v.clave}`}
                        className="text-xs font-medium text-foreground"
                      >
                        {v.label}
                        {v.requerida ? <span className="text-destructive"> *</span> : null}{" "}
                        <code className="rounded bg-muted px-1 text-[11px] text-muted-foreground">
                          {`{{${v.clave}}}`}
                        </code>
                      </label>
                      <input
                        id={`var-${v.clave}`}
                        value={datos[v.clave] ?? ""}
                        onChange={(e) => cambiarDato(v.clave, e.target.value)}
                        placeholder={v.ejemplo}
                        className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      />
                    </div>
                  ))}
                </fieldset>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="destinatarios" className="text-sm font-medium text-foreground">
                  Destinatarios de prueba
                </label>
                <textarea
                  id="destinatarios"
                  rows={4}
                  value={destinatarios}
                  onChange={(e) => {
                    setDestinatarios(e.target.value);
                    setPreflight(null);
                  }}
                  placeholder={"qa@tuclinica.com\ndoctor@tuclinica.com"}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                <p className="text-xs text-muted-foreground">
                  Una dirección por línea (o separadas por coma). Cada una pasa primero por la
                  política de sandbox.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => lanzarPreflight()}
                  disabled={verificando}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <ShieldCheck className="size-4" aria-hidden />
                  {verificando ? "Verificando…" : "Verificación previa"}
                </button>
                <button
                  type="button"
                  onClick={lanzarPrueba}
                  disabled={ejecutando || !puedeEnviar}
                  title={
                    puedeEnviar
                      ? undefined
                      : "Ejecuta la verificación previa y resuelve los fallos antes de enviar."
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-brand bg-transparent px-4 py-2 text-sm font-medium text-brand-700 transition-opacity hover:bg-brand/12 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Send className="size-4" aria-hidden />
                  {ejecutando ? "Ejecutando…" : "Enviar prueba"}
                </button>
              </div>

              <PreflightPanel report={preflight} />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Estado por destinatario
            </h2>
            {destinatarioStatus.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Aún no hay destinatarios probados.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col divide-y divide-border">
                {destinatarioStatus.map((d) => (
                  <li key={d.recipient} className="flex flex-col gap-1 py-3 first:pt-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-foreground">
                        {d.recipient}
                      </span>
                      <EstadoBadge estado={d.ultimoEstado} />
                    </div>
                    <p className="text-xs text-muted-foreground">{d.ultimoMotivo}</p>
                    <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="size-3" aria-hidden /> {d.entregados} ok
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Ban className="size-3" aria-hidden /> {d.bloqueados} bloqueados
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <AlertTriangle className="size-3" aria-hidden /> {d.errores} errores
                      </span>
                      <span>
                        {d.intentos} intentos · {d.promedioMs} ms medios
                      </span>
                      <span>Último: {formatoFecha(d.ultimoIntento)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Registro de tiempos y errores
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="filtro" className="sr-only">
                Filtrar por estado
              </label>
              <select
                id="filtro"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value as typeof filtro)}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <option value="todos">Todos los estados</option>
                <option value="enviado">Enviados</option>
                <option value="redirigido">Redirigidos</option>
                <option value="bloqueado">Bloqueados</option>
                <option value="error">Con error</option>
              </select>
              <button
                type="button"
                onClick={descargarCsv}
                disabled={log.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Download className="size-4" aria-hidden /> CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  limpiarEmailTestLog();
                  setLog([]);
                  toast.success("Registro de pruebas vaciado.");
                }}
                disabled={log.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Trash2 className="size-4" aria-hidden /> Vaciar
              </button>
            </div>
          </header>

          {logFiltrado.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              No hay intentos que coincidan con el filtro.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-5 py-3 font-medium">
                      Fecha
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Plantilla
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Destinatario
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Entregado a
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Estado
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Tiempo
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      Detalle
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logFiltrado.map((e) => (
                    <tr key={e.id} className="align-top">
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                        {formatoFecha(e.startedAt)}
                      </td>
                      <td className="px-5 py-3 text-foreground">{etiquetaPlantilla(e.template)}</td>
                      <td className="px-5 py-3 text-foreground">{e.requested}</td>
                      <td className="px-5 py-3 text-muted-foreground">{e.delivered ?? "—"}</td>
                      <td className="px-5 py-3">
                        <EstadoBadge estado={e.status} />
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                        {e.durationMs} ms
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {e.reason}
                        {e.errorCode ? (
                          <code className="ml-1 rounded bg-muted px-1 py-0.5 text-xs">
                            {e.errorCode}
                          </code>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
