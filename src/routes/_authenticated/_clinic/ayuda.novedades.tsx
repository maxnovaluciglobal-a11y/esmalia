import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCheck } from "lucide-react";

import { BOTON_PASTILLA, EncabezadoEditorial, PANEL_LISTA } from "@/components/a-plus/lista";
import { AppShell } from "@/components/app-shell";
import { NOVEDADES } from "@/content/ayuda/novedades";
import { useProgresoAyuda } from "@/hooks/use-progreso-ayuda";
import { hasPermission } from "@/lib/access/access";
import { requirePermission } from "@/lib/access/route-guards";
import { fechaLarga } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

/** Ola 12 · NAV-10: qué hay de nuevo, con marca de no leído por persona. */
export const Route = createFileRoute("/_authenticated/_clinic/ayuda/novedades")({
  beforeLoad: requirePermission("dashboard:view"),
  head: () => ({
    meta: [{ title: "Novedades | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: NovedadesPage,
});

function NovedadesPage() {
  const { access } = Route.useRouteContext();
  const progreso = useProgresoAyuda({
    userId: access.userId,
    esDemo: Boolean(access.clinic?.isDemo),
  });
  const sinLeer = NOVEDADES.filter((n) => !progreso.hecho("novedad", n.id));
  const zona = access.clinic?.timezone ?? "America/Santiago";

  return (
    <AppShell title="Novedades" access={access}>
      <div className="mx-auto max-w-[52rem] space-y-[18px]">
        <EncabezadoEditorial
          contexto={[
            access.clinic?.name,
            sinLeer.length === 0 ? "Todo leído" : `${sinLeer.length} sin leer`,
          ]}
          titulo="Qué hay de"
          enfasis="nuevo"
          acciones={
            sinLeer.length > 0 && (
              <button
                type="button"
                className={BOTON_PASTILLA}
                onClick={() =>
                  progreso.marcar(
                    "novedad",
                    sinLeer.map((n) => n.id),
                  )
                }
              >
                <CheckCheck aria-hidden className="size-4" /> Marcar todo como leído
              </button>
            )
          }
        />

        <ol className={cn(PANEL_LISTA, "divide-y divide-hairline")}>
          {NOVEDADES.map((n) => {
            const leida = progreso.hecho("novedad", n.id);
            const verEnlace =
              n.enlace && (!n.enlace.permiso || hasPermission(access, n.enlace.permiso));
            return (
              <li key={n.id} id={n.id} className="scroll-mt-24 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                      {!leida && (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-brand-700">
                          <span aria-hidden className="size-2 rounded-full bg-brand-600" />
                          Nueva
                        </span>
                      )}
                      <time dateTime={n.fecha}>{fechaLarga(`${n.fecha}T12:00:00Z`, zona)}</time>
                    </p>
                    <h2 className="mt-1 text-[17px] font-semibold leading-snug">{n.titulo}</h2>
                    <p className="mt-1 text-[15px] leading-snug text-foreground/80">{n.texto}</p>
                    {verEnlace && n.enlace && (
                      <Link
                        to={n.enlace.href as "/dashboard"}
                        onClick={() => progreso.marcar("novedad", [n.id])}
                        className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700 hover:underline sm:min-h-8"
                      >
                        {n.enlace.texto} <ArrowRight aria-hidden className="size-3.5" />
                      </Link>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => progreso.marcar("novedad", [n.id], !leida)}
                    className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
                  >
                    {leida ? "Marcar como no leída" : "Marcar como leída"}
                    <span className="sr-only">: {n.titulo}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </AppShell>
  );
}
