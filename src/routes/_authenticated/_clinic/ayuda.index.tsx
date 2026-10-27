import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, GraduationCap, MessageSquareWarning, Sparkles } from "lucide-react";

import { BOTON_PASTILLA, EncabezadoEditorial, PANEL_LISTA } from "@/components/a-plus/lista";
import { AppShell } from "@/components/app-shell";
import { EspacioVideo } from "@/components/ayuda/espacio-video";
import { GUIAS_DOCS, articulosDeAyuda } from "@/content/ayuda/indice";
import { AYUDA_PANTALLAS } from "@/content/ayuda/pantallas";
import { AYUDA_PUESTA_EN_MARCHA } from "@/content/ayuda/puesta-en-marcha";
import { requirePermission } from "@/lib/access/route-guards";
import { buscarAyuda, type TipoArticulo } from "@/lib/ayuda/buscador";
import { abrirReporte } from "@/lib/ayuda/eventos";

const TIPO: Record<TipoArticulo, string> = {
  pantalla: "Pantalla",
  leccion: "Academia",
  guia: "Guía",
  novedad: "Novedad",
};

/** Ola 12 · ONB-10: centro de ayuda con buscador. */
export const Route = createFileRoute("/_authenticated/_clinic/ayuda/")({
  validateSearch: (search: Record<string, unknown>): { q: string } => ({
    q: typeof search.q === "string" ? search.q.slice(0, 120) : "",
  }),
  beforeLoad: requirePermission("dashboard:view"),
  head: () => ({
    meta: [{ title: "Centro de ayuda | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: CentroDeAyuda,
});

function CentroDeAyuda() {
  const { access } = Route.useRouteContext();
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const articulos = useMemo(() => articulosDeAyuda(access.role), [access.role]);
  const resultados = useMemo(() => buscarAyuda(articulos, q, 30), [articulos, q]);

  return (
    <AppShell title="Ayuda" access={access}>
      <div className="mx-auto max-w-[64rem] space-y-[18px]">
        <EncabezadoEditorial
          contexto={[access.clinic?.name, "Ayuda"]}
          titulo="Centro de"
          enfasis="ayuda"
          acciones={
            <>
              <Link to="/ayuda/academia" className={BOTON_PASTILLA}>
                <GraduationCap aria-hidden className="size-4" /> Academia
              </Link>
              <button type="button" className={BOTON_PASTILLA} onClick={abrirReporte}>
                <MessageSquareWarning aria-hidden className="size-4" /> Reportar
              </button>
            </>
          }
        />

        <form
          role="search"
          onSubmit={(e) => e.preventDefault()}
          className="rounded-[14px] border border-night-line bg-night p-5 text-on-night"
        >
          <label className="block">
            <span className="font-display text-[22px] font-medium">
              ¿Qué necesitas <em className="text-brand-on-night">hacer</em>?
            </span>
            <input
              type="search"
              autoFocus
              value={q}
              onChange={(e) => void navigate({ search: { q: e.target.value }, replace: true })}
              placeholder="Ej.: cerrar la caja, reagendar, importar pacientes"
              className="mt-3 h-12 w-full rounded-full border border-night-line bg-night-2 px-5 text-base text-on-night outline-none placeholder:text-on-night-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-on-night"
            />
          </label>
        </form>

        {q.trim() ? (
          <section aria-labelledby="resultados" aria-live="polite" className={PANEL_LISTA}>
            <h2
              id="resultados"
              className="px-5 pt-4 pb-2 text-sm font-semibold text-muted-foreground"
            >
              {resultados.length === 0
                ? "Sin resultados"
                : `${resultados.length} resultado${resultados.length === 1 ? "" : "s"}`}
            </h2>
            {resultados.length === 0 ? (
              <p className="px-5 pb-5 text-[15px]">
                No encontramos nada con «{q}». Prueba con otra palabra o{" "}
                <button
                  type="button"
                  onClick={abrirReporte}
                  className="font-semibold text-brand-700 underline underline-offset-2"
                >
                  cuéntanos qué buscabas
                </button>
                .
              </p>
            ) : (
              <ul className="divide-y divide-hairline border-t border-hairline">
                {resultados.map(({ articulo }) => {
                  const contenido = (
                    <>
                      <span className="flex items-center gap-2">
                        <span className="rounded-full border border-control px-2 py-0.5 text-[11.5px] font-semibold text-muted-foreground">
                          {TIPO[articulo.tipo]}
                        </span>
                        <span className="text-[16px] font-semibold">{articulo.titulo}</span>
                        {articulo.tipo === "guia" && (
                          <ArrowUpRight aria-hidden className="size-3.5 text-muted-foreground" />
                        )}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-[14px] text-muted-foreground">
                        {articulo.resumen}
                      </span>
                    </>
                  );
                  const [ruta, hash] = articulo.href.split("#");
                  return (
                    <li key={articulo.id}>
                      {articulo.tipo === "guia" ? (
                        <a
                          href={articulo.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block px-5 py-3.5 hover:bg-secondary"
                        >
                          {contenido}
                          <span className="sr-only"> (se abre en otra pestaña)</span>
                        </a>
                      ) : (
                        <Link
                          to={ruta as "/ayuda/novedades"}
                          hash={hash}
                          className="block px-5 py-3.5 hover:bg-secondary"
                        >
                          {contenido}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : (
          <>
            <section aria-labelledby="pantallas" className={PANEL_LISTA}>
              <h2
                id="pantallas"
                className="px-5 pt-[18px] pb-3 font-display text-[28px] font-medium leading-none"
              >
                Cómo se usa <em className="text-brand-600">cada pantalla</em>
              </h2>
              <ul className="grid gap-px border-t border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-3">
                {AYUDA_PANTALLAS.map((p) => (
                  <li key={p.id} className="bg-card">
                    <Link
                      to="/ayuda/pantalla/$pantalla"
                      params={{ pantalla: p.id }}
                      className="block h-full px-5 py-3.5 hover:bg-secondary"
                    >
                      <span className="block text-[15px] font-semibold">{p.nombre}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[13.5px] text-muted-foreground">
                        {p.resumen}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section
              aria-labelledby="puesta-en-marcha-titulo"
              id="puesta-en-marcha"
              className={PANEL_LISTA}
            >
              <h2
                id="puesta-en-marcha-titulo"
                className="px-5 pt-[18px] pb-1 font-display text-[28px] font-medium leading-none"
              >
                Puesta <em className="text-brand-600">en marcha</em>
              </h2>
              <p className="px-5 pb-3 text-sm text-muted-foreground">
                Los pasos para dejar tu clínica funcionando, con su video.
              </p>
              <ol className="grid gap-4 border-t border-hairline p-5 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(AYUDA_PUESTA_EN_MARCHA).map(([id, paso], i) => (
                  <li key={id} className="space-y-2">
                    <p className="text-[15px] font-semibold">
                      <span className="cifra mr-1.5 text-muted-foreground">{i + 1}.</span>
                      {paso.titulo}
                    </p>
                    <p className="text-[14px] text-foreground/80">{paso.texto}</p>
                    <EspacioVideo video={paso.video} titulo={paso.titulo} />
                  </li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="guias" className={PANEL_LISTA}>
              <h2
                id="guias"
                className="px-5 pt-[18px] pb-3 font-display text-[28px] font-medium leading-none"
              >
                Guías <em className="text-brand-600">más largas</em>
              </h2>
              <ul className="divide-y divide-hairline border-t border-hairline">
                {GUIAS_DOCS.map((g) => (
                  <li key={g.href}>
                    <a
                      href={g.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start justify-between gap-3 px-5 py-3.5 hover:bg-secondary"
                    >
                      <span>
                        <span className="block text-[15px] font-semibold">{g.titulo}</span>
                        <span className="block text-[13.5px] text-muted-foreground">
                          {g.resumen}
                        </span>
                      </span>
                      <ArrowUpRight
                        aria-hidden
                        className="mt-1 size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="sr-only"> (se abre en otra pestaña)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>

            <Link
              to="/ayuda/novedades"
              className="flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline"
            >
              <Sparkles aria-hidden className="size-4" /> Ver las novedades
            </Link>
          </>
        )}
      </div>
    </AppShell>
  );
}
