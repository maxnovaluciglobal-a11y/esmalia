// src/routes/_authenticated/admin.reportes.tsx
//
// Ola 12 · ONB-09: los problemas y sugerencias que las clínicas mandan desde
// la app. Pantalla interna del equipo de Esmalia: mismo gate que /admin/leads
// (allowlist ESMALIA_STAFF_EMAILS + aal2, resuelto en el servidor). No usa
// AppShell porque no hay un rol de clínica en juego.
import { createFileRoute, Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { EsmaliaLogo } from "@/components/esmalia-logo";
import { ETIQUETA_TIPO_REPORTE } from "@/lib/ayuda/reportes";
import {
  cambiarEstadoReporteStaff,
  listarReportesStaff,
  type ReporteStaff,
} from "@/lib/ayuda/reportes.functions";
import { fechaHora } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/reportes")({
  loader: () => listarReportesStaff(),
  head: () => ({
    meta: [{ title: "Reportes de clínicas | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  errorComponent: AccesoRestringido,
  component: AdminReportesPage,
});

function AccesoRestringido({ error }: ErrorComponentProps) {
  const mensaje = error instanceof Error ? error.message : "No pudimos mostrar esta sección.";
  return (
    <div className="grid min-h-dvh place-items-center bg-surface px-6 text-foreground">
      <div className="card-clinical max-w-md p-8 text-center">
        <EsmaliaLogo variant="icon" size={40} className="mx-auto mb-4 block" />
        <h1 className="mb-2 font-display text-xl font-semibold">Acceso restringido</h1>
        <p className="mb-6 text-sm text-muted-foreground">{mensaje}</p>
        <Link to="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
          Volver al panel
        </Link>
      </div>
    </div>
  );
}

const ESTADOS: ReporteStaff["estado"][] = ["nuevo", "visto", "resuelto"];
const ETIQUETA_ESTADO: Record<ReporteStaff["estado"], string> = {
  nuevo: "Nuevo",
  visto: "Visto",
  resuelto: "Resuelto",
};

function AdminReportesPage() {
  const reportes = Route.useLoaderData();
  const router = useRouter();
  const cambiar = useServerFn(cambiarEstadoReporteStaff);
  const [filtro, setFiltro] = useState<ReporteStaff["estado"] | "todos">("nuevo");
  const visibles = reportes.filter((r) => filtro === "todos" || r.estado === filtro);

  return (
    <div className="min-h-dvh bg-background px-5 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Equipo de Esmalia</p>
            <h1 className="font-display text-[clamp(2rem,3.4vw,3rem)] font-medium leading-none">
              Reportes de <em className="text-brand-600">clínicas</em>
            </h1>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
            {(["nuevo", "visto", "resuelto", "todos"] as const).map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={filtro === e}
                onClick={() => setFiltro(e)}
                className={cn(
                  "h-9 rounded-full border px-3.5 text-sm font-semibold",
                  filtro === e
                    ? "border-foreground bg-foreground text-background"
                    : "border-control hover:border-foreground",
                )}
              >
                {e === "todos" ? "Todos" : ETIQUETA_ESTADO[e]}
                {e !== "todos" && (
                  <span className="cifra ml-1.5">
                    {reportes.filter((r) => r.estado === e).length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </header>

        {visibles.length === 0 ? (
          <p className="text-muted-foreground">No hay reportes en este estado.</p>
        ) : (
          <ul className="space-y-3">
            {visibles.map((r) => (
              <li key={r.id} className="rounded-[14px] border border-hairline bg-card p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    <b className="font-semibold text-foreground">{r.clinica ?? "Clínica"}</b> ·{" "}
                    {r.autor ?? "Sin nombre"} · {fechaHora(r.creado, "America/Santiago")}
                  </p>
                  <span className="rounded-full border border-control px-2.5 py-0.5 text-[12px] font-semibold">
                    {ETIQUETA_TIPO_REPORTE[r.tipo]}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[15px]">{r.mensaje}</p>
                <p className="mt-2 text-[13px] text-muted-foreground">
                  Pantalla: {r.pantalla ?? "sin dato"}
                  {r.ruta ? ` · ${r.ruta}` : ""}
                  {r.viewport ? ` · ${r.viewport}` : ""}
                </p>
                {r.captura && (
                  <a
                    href={r.captura}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 block"
                  >
                    <img
                      src={r.captura}
                      alt="Captura enviada con el reporte"
                      loading="lazy"
                      className="max-h-72 rounded-[10px] border border-hairline"
                    />
                  </a>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {ESTADOS.filter((e) => e !== r.estado).map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={async () => {
                        await cambiar({ data: { id: r.id, estado: e } });
                        await router.invalidate();
                      }}
                      className="h-9 rounded-full border border-border px-3.5 text-sm font-semibold hover:border-foreground"
                    >
                      Marcar {ETIQUETA_ESTADO[e].toLocaleLowerCase("es")}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
