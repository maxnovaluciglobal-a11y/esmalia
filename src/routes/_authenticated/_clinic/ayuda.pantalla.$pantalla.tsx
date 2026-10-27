import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { EncabezadoEditorial, PANEL_LISTA } from "@/components/a-plus/lista";
import { AppShell } from "@/components/app-shell";
import { EspacioVideo } from "@/components/ayuda/espacio-video";
import { AYUDA_PANTALLAS, ayudaDePantalla } from "@/content/ayuda/pantallas";
import { recorridoDePantalla } from "@/content/ayuda/recorridos";
import type { PantallaId } from "@/content/ayuda/tipos";
import { requirePermission } from "@/lib/access/route-guards";

const IDS = new Set<string>(AYUDA_PANTALLAS.map((p) => p.id));

/** Ola 12 · ONB-02: "Cómo se usa esta pantalla" en página completa. */
export const Route = createFileRoute("/_authenticated/_clinic/ayuda/pantalla/$pantalla")({
  beforeLoad: requirePermission("dashboard:view"),
  loader: ({ params }) => {
    if (!IDS.has(params.pantalla)) throw notFound();
    return { id: params.pantalla as PantallaId };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${ayudaDePantalla(loaderData?.id ?? null)?.nombre ?? "Ayuda"} · Ayuda | Esmalia`,
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AyudaDePantallaPage,
});

function AyudaDePantallaPage() {
  const { access } = Route.useRouteContext();
  const { id } = Route.useLoaderData();
  const ayuda = ayudaDePantalla(id)!;
  const recorrido = recorridoDePantalla(id);

  return (
    <AppShell title="Ayuda" access={access}>
      <div className="mx-auto max-w-[52rem] space-y-[18px]">
        <Link
          to="/ayuda"
          search={{ q: "" }}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" /> Centro de ayuda
        </Link>
        <EncabezadoEditorial contexto={["Cómo se usa"]} titulo={ayuda.nombre}>
          <p className="mt-3 max-w-2xl text-[17px] text-foreground/80">{ayuda.resumen}</p>
        </EncabezadoEditorial>

        <div className="grid items-start gap-[18px] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <section aria-labelledby="pasos" className={`${PANEL_LISTA} p-5`}>
            <h2 id="pasos" className="font-display text-[26px] font-medium leading-none">
              Paso a <em className="text-brand-600">paso</em>
            </h2>
            <ol className="mt-4 space-y-4">
              {ayuda.pasos.map((p, i) => (
                <li key={p.titulo} className="grid grid-cols-[30px_minmax(0,1fr)] gap-3">
                  <span
                    aria-hidden
                    className="cifra grid size-[30px] place-items-center rounded-full border border-control text-[13px]"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-base font-semibold leading-snug">{p.titulo}</h3>
                    <p className="mt-0.5 text-[15px] leading-snug text-foreground/80">{p.texto}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className="space-y-[18px]">
            <EspacioVideo video={ayuda.video} titulo={`Cómo se usa ${ayuda.nombre}`} />
            {ayuda.tenEnCuenta.length > 0 && (
              <section aria-labelledby="ten-en-cuenta" className={`${PANEL_LISTA} p-5`}>
                <h2 id="ten-en-cuenta" className="text-sm font-semibold">
                  Ten en cuenta
                </h2>
                <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[15px] text-foreground/80">
                  {ayuda.tenEnCuenta.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </section>
            )}
            {recorrido && (
              <p className="text-[14px] text-muted-foreground">
                En la pantalla {ayuda.nombre}, el botón de ayuda (arriba, junto a la campana) ofrece
                un recorrido guiado de {recorrido.pasos.length} pasos.
              </p>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
