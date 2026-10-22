// src/routes/_authenticated/admin.leads.tsx
//
// Cierre del hallazgo diferido de la revisión final de la rama de captación:
// `listMarketingLeads` (src/lib/marketing/leads.functions.ts) existía sin
// ningún caller — la única forma de ver un lead de la calculadora/checklist
// era entrar al dashboard de Supabase a mano. Esta pantalla es ese caller.
//
// Deliberadamente NO vive bajo `_authenticated/_clinic/`: el gate real no es
// un rol de clínica (`ClinicAccess`/`hasPermission`), es una allowlist de
// emails del equipo de Esmalia (`ESMALIA_STAFF_EMAILS`) que ya resuelve
// `listMarketingLeads` del lado del servidor. Cualquier usuario logueado
// puede navegar a la URL; el server function decide si tiene permiso real.
// Por eso tampoco usa `AppShell` (pide un `ClinicAccess` con rol de clínica
// que esta ruta no tiene en su contexto) ni reusa `sin-acceso.tsx` (esa
// pantalla es específica de roles de clínica — `ROLE_LABELS`/`ClinicAccess`
// no aplican acá).

import { useEffect } from "react";
import { createFileRoute, Link, type ErrorComponentProps } from "@tanstack/react-router";

import { EsmaliaLogo } from "@/components/esmalia-logo";
import { marcarEquipoInterno } from "@/lib/marketing/eventos";
import { MENSAJE_STAFF_REQUIERE_MFA } from "@/lib/auth/mfa";
import { listMarketingLeads } from "@/lib/marketing/leads.functions";
import type { MetaLead } from "@/lib/marketing/leads";
import type { Json } from "@/integrations/supabase/types";
import { fechaHora } from "@/lib/formato-fecha";

export const Route = createFileRoute("/_authenticated/admin/leads")({
  loader: () => listMarketingLeads({}),
  head: () => ({
    meta: [
      { title: "Leads capturados | Esmalia" },
      {
        name: "description",
        content: "Leads capturados por la calculadora y el checklist de captación.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: AccesoRestringido,
  component: AdminLeadsPage,
});

/**
 * `listMarketingLeads` tira SIEMPRE con `Error("...")` (nunca deja pasar el
 * error crudo de Postgres/Supabase — ver el `throw new Error(...)` de cada
 * rama en `leads.functions.ts`), así que `error.message` ya es texto seguro
 * para mostrar tal cual: "No tienes permisos." (email fuera de la allowlist,
 * el caso esperado) o "No pudimos cargar los leads." (falla de DB). Mismo
 * layout para los dos — no hay forma de distinguir "no tenés permiso" de
 * "algo falló" sin que el server function lo exponga, y no vale la pena
 * ensanchar esa superficie para una pantalla interna de lectura.
 */
function AccesoRestringido({ error: errorDesconocido }: ErrorComponentProps) {
  const error =
    errorDesconocido instanceof Error ? errorDesconocido : new Error(String(errorDesconocido));
  return (
    <div className="grid min-h-dvh place-items-center bg-surface px-6 text-foreground">
      <div className="card-clinical max-w-md p-8 text-center">
        <EsmaliaLogo variant="icon" size={40} className="mx-auto mb-4 block" />
        <h1 className="mb-2 font-display text-xl font-semibold">Acceso restringido</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {error?.message || "No pudimos mostrar esta sección."}
        </p>
        <Link
          to="/dashboard"
          className="inline-block rounded-lg border border-brand bg-transparent px-4 py-2 text-sm font-medium text-brand-700 transition-opacity hover:bg-brand/12"
        >
          Volver al dashboard
        </Link>
        {/* SEG-01: acá NO se ofrece activar el factor (revisión del PR #65):
            con una contraseña robada de staff, eso alcanzaba para inscribir
            un TOTP propio y subir a aal2. Se activa desde /preferencias, con
            un inicio de sesión reciente. */}
        {error.message === MENSAJE_STAFF_REQUIERE_MFA && (
          <p className="mt-4 text-xs text-muted-foreground">
            Actívala desde{" "}
            <Link to="/preferencias" className="font-medium text-brand-700 hover:underline">
              Preferencias
            </Link>{" "}
            justo después de iniciar sesión.
          </p>
        )}
      </div>
    </div>
  );
}

const FUENTE_LABEL: Record<string, string> = {
  calculadora: "Calculadora",
  checklist: "Checklist",
  benchmark: "Benchmark",
  demo: "Demo",
};

const FUENTE_TONO: Record<string, string> = {
  calculadora: "bg-info-soft text-info",
  checklist: "bg-brand-soft text-brand-700",
  benchmark: "bg-warning-soft text-warning",
  demo: "bg-secondary text-foreground",
};

/** Duck-typing liviano: `meta` es `Json` en el schema (Task 1 no le puso un
 *  CHECK de forma), así que un lead magnet futuro que no llene estas 4
 *  claves (el propio comentario de la Task 17 lo anticipa) tiene que
 *  resolver en `null` acá, no en un objeto a medio llenar que pinta badges
 *  con `undefined`. */
function comoMetaLead(meta: Json | null): MetaLead | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const m = meta as Record<string, unknown>;
  if (
    typeof m.margen_bucket !== "string" &&
    typeof m.ausencias_bucket !== "string" &&
    typeof m.conversion_bucket !== "string"
  ) {
    return null;
  }
  return m as unknown as MetaLead;
}

const MARGEN_LABEL: Record<MetaLead["margen_bucket"], string> = {
  perdida: "Margen: pérdida",
  bajo: "Margen: bajo",
  medio: "Margen: medio",
  alto: "Margen: alto",
  na: "",
};
const MARGEN_TONO: Record<MetaLead["margen_bucket"], string> = {
  perdida: "bg-destructive/10 text-destructive",
  bajo: "bg-warning-soft text-warning",
  medio: "bg-secondary text-muted-foreground",
  alto: "bg-success-soft text-success",
  na: "",
};

const AUSENCIAS_LABEL: Record<MetaLead["ausencias_bucket"], string> = {
  bajo: "Ausencias: bajo",
  medio: "Ausencias: medio",
  alto: "Ausencias: alto",
  na: "",
};
const AUSENCIAS_TONO: Record<MetaLead["ausencias_bucket"], string> = {
  bajo: "bg-success-soft text-success",
  medio: "bg-secondary text-muted-foreground",
  alto: "bg-destructive/10 text-destructive",
  na: "",
};

const CONVERSION_LABEL: Record<MetaLead["conversion_bucket"], string> = {
  baja: "Conversión: baja",
  media: "Conversión: media",
  alta: "Conversión: alta",
  na: "",
};
const CONVERSION_TONO: Record<MetaLead["conversion_bucket"], string> = {
  baja: "bg-destructive/10 text-destructive",
  media: "bg-secondary text-muted-foreground",
  alta: "bg-success-soft text-success",
  na: "",
};

function Pill({ tono, children }: { tono: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tono}`}
    >
      {children}
    </span>
  );
}

function SenalesMeta({ meta }: { meta: Json | null }) {
  const lead = comoMetaLead(meta);
  if (!lead) return null;

  const pills: React.ReactNode[] = [];
  if (lead.margen_bucket && lead.margen_bucket !== "na") {
    pills.push(
      <Pill key="margen" tono={MARGEN_TONO[lead.margen_bucket]}>
        {MARGEN_LABEL[lead.margen_bucket]}
      </Pill>,
    );
  }
  if (lead.ausencias_bucket && lead.ausencias_bucket !== "na") {
    pills.push(
      <Pill key="ausencias" tono={AUSENCIAS_TONO[lead.ausencias_bucket]}>
        {AUSENCIAS_LABEL[lead.ausencias_bucket]}
      </Pill>,
    );
  }
  if (lead.conversion_bucket && lead.conversion_bucket !== "na") {
    pills.push(
      <Pill key="conversion" tono={CONVERSION_TONO[lead.conversion_bucket]}>
        {CONVERSION_LABEL[lead.conversion_bucket]}
      </Pill>,
    );
  }
  if (pills.length === 0) return null;

  return <div className="flex flex-wrap gap-1">{pills}</div>;
}

/** `created_at` es un instante: fecha y hora con el formato único (UX-09). */
function formatFechaHora(iso: string): string {
  return fechaHora(iso);
}

function AdminLeadsPage() {
  const leads = Route.useLoaderData();
  // El loader ya pasó el gate de staff: las visitas de este equipo a las
  // páginas públicas se marcan `interno` (docs/MEDICION.md).
  useEffect(() => {
    marcarEquipoInterno();
  }, []);

  return (
    <div className="min-h-dvh bg-surface px-4 py-10 sm:py-12">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <EsmaliaLogo variant="icon" size={36} />
            <div>
              <h1 className="font-display text-xl font-semibold sm:text-2xl">Leads capturados</h1>
              <p className="text-sm text-muted-foreground">
                Calculadora, checklist y demás material de captación — {leads.length}{" "}
                {leads.length === 1 ? "lead" : "leads"}.
              </p>
            </div>
          </div>
          <Link
            to="/dashboard"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Volver al dashboard
          </Link>
        </header>

        {leads.length === 0 ? (
          <div className="card-clinical p-8 text-center">
            <p className="mb-1 font-display text-lg font-semibold">
              Todavía no hay leads capturados
            </p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              En cuanto alguien complete la calculadora o el checklist de la landing, va a aparecer
              aquí.
            </p>
          </div>
        ) : (
          <section className="card-clinical overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Fecha</th>
                    <th className="px-3 py-2 text-left font-medium">Contacto</th>
                    <th className="px-3 py-2 text-left font-medium">Clínica</th>
                    <th className="px-3 py-2 text-left font-medium">País</th>
                    <th className="px-3 py-2 text-left font-medium">Fuente</th>
                    <th className="px-3 py-2 text-right font-medium">Envíos</th>
                    <th className="px-3 py-2 text-left font-medium">Señales</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => {
                    const contacto = [lead.email, lead.phone].filter(Boolean).join(" · ");
                    return (
                      <tr key={lead.id} className="border-b border-hairline last:border-0">
                        <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">
                          {formatFechaHora(lead.created_at)}
                        </td>
                        <td className="px-3 py-2">
                          {lead.name && <p className="font-medium">{lead.name}</p>}
                          <p className="text-xs text-muted-foreground">{contacto || "—"}</p>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {lead.clinic_name ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">
                          {lead.country_code ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Pill
                            tono={FUENTE_TONO[lead.source] ?? "bg-secondary text-muted-foreground"}
                          >
                            {FUENTE_LABEL[lead.source] ?? lead.source}
                          </Pill>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                          {lead.submissions_count}
                        </td>
                        <td className="px-3 py-2">
                          <SenalesMeta meta={lead.meta} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Hasta 200 leads más recientes. Pantalla de lectura — para más volumen, el dashboard de
          Supabase sigue siendo la fuente completa.
        </p>
      </div>
    </div>
  );
}
