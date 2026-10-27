import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";

import { ChipFiltro, EncabezadoEditorial, PANEL_LISTA } from "@/components/a-plus/lista";
import { AppShell } from "@/components/app-shell";
import { EspacioVideo } from "@/components/ayuda/espacio-video";
import { LECCIONES } from "@/content/ayuda/academia";
import { ayudaDePantalla } from "@/content/ayuda/pantallas";
import type { Leccion, PistaAcademia } from "@/content/ayuda/tipos";
import { useProgresoAyuda, type UsoProgresoAyuda } from "@/hooks/use-progreso-ayuda";
import { requirePermission } from "@/lib/access/route-guards";
import {
  avance,
  leccionesBasicas,
  leccionesDeLaPista,
  NOMBRE_PISTA,
  pistaDelRol,
  pistasVisibles,
} from "@/lib/ayuda/academia";
import { RUTA_DE_PANTALLA } from "@/lib/ayuda/pantalla-actual";
import { cn } from "@/lib/utils";

/** Ola 12 · ONB-04: Academia por rol. */
export const Route = createFileRoute("/_authenticated/_clinic/ayuda/academia")({
  beforeLoad: requirePermission("dashboard:view"),
  head: () => ({
    meta: [{ title: "Academia | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: AcademiaPage,
});

function AcademiaPage() {
  const { access } = Route.useRouteContext();
  const progreso = useProgresoAyuda({
    userId: access.userId,
    esDemo: Boolean(access.clinic?.isDemo),
  });
  const propia = pistaDelRol(access.role);
  const pistas = pistasVisibles(access.role);
  const [pista, setPista] = useState<PistaAcademia | null>(propia);

  const basicas = leccionesBasicas(LECCIONES);
  const delaPista = pista ? leccionesDeLaPista(LECCIONES, pista) : [];
  const vistas = progreso.vistos("leccion");
  const total = avance(
    [...basicas, ...(propia ? leccionesDeLaPista(LECCIONES, propia) : [])],
    vistas,
  );

  return (
    <AppShell title="Academia" access={access}>
      <div className="mx-auto max-w-[60rem] space-y-[18px]">
        <EncabezadoEditorial
          contexto={[
            access.clinic?.name,
            total.total > 0 ? `${total.vistas} de ${total.total} lecciones vistas` : null,
          ]}
          titulo="Academia"
          enfasis={propia ? `para ${NOMBRE_PISTA[propia].toLocaleLowerCase("es")}` : undefined}
        >
          <p className="mt-3 max-w-2xl text-[16px] text-foreground/80">
            Lecciones cortas para aprender Esmalia según lo que haces en la clínica. Marca cada una
            al terminarla.
          </p>
        </EncabezadoEditorial>

        {pistas.length === 0 ? (
          <p className="text-[15px] text-muted-foreground">
            Tu usuario todavía no tiene un rol en esta clínica.
          </p>
        ) : (
          <>
            <Bloque
              titulo="Lo básico"
              enfasis="para todo el equipo"
              lecciones={basicas}
              progreso={progreso}
            />

            {pistas.length > 1 && (
              <div
                role="group"
                aria-label="Ver lecciones de otro rol"
                className="flex flex-wrap gap-2"
              >
                {pistas.map((p) => (
                  <ChipFiltro key={p} activo={pista === p} onClick={() => setPista(p)}>
                    {NOMBRE_PISTA[p]}
                    {p === propia ? " (tu rol)" : ""}
                  </ChipFiltro>
                ))}
              </div>
            )}

            {pista && (
              <Bloque
                titulo={pista === propia ? "Para tu rol:" : "Para"}
                enfasis={NOMBRE_PISTA[pista].toLocaleLowerCase("es")}
                lecciones={delaPista}
                progreso={progreso}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function Bloque({
  titulo,
  enfasis,
  lecciones,
  progreso,
}: {
  titulo: string;
  enfasis: string;
  lecciones: Leccion[];
  progreso: UsoProgresoAyuda;
}) {
  const vistas = progreso.vistos("leccion");
  const { vistas: n, total } = avance(lecciones, vistas);
  return (
    <section aria-label={`${titulo} ${enfasis}`} className="space-y-3">
      <h2 className="flex flex-wrap items-baseline gap-x-3 font-display text-[28px] font-medium leading-none">
        <span>
          {titulo} <em className="text-brand-600">{enfasis}</em>
        </span>
        <span className="cifra text-sm text-muted-foreground">
          {n}/{total}
        </span>
      </h2>
      <ul className="grid gap-[14px] md:grid-cols-2">
        {lecciones.map((l) => (
          <TarjetaLeccion
            key={l.id}
            leccion={l}
            vista={vistas.has(l.id)}
            onMarcar={(v) => progreso.marcar("leccion", [l.id], v)}
          />
        ))}
      </ul>
    </section>
  );
}

function TarjetaLeccion({
  leccion,
  vista,
  onMarcar,
}: {
  leccion: Leccion;
  vista: boolean;
  onMarcar: (vista: boolean) => void;
}) {
  const pantalla = leccion.pantalla ? ayudaDePantalla(leccion.pantalla) : null;
  return (
    <li id={leccion.id} className={cn(PANEL_LISTA, "scroll-mt-24 space-y-3 p-5")}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-[22px] font-medium leading-tight">{leccion.titulo}</h3>
        <span className="cifra shrink-0 pt-1 text-[13px] text-muted-foreground">
          {leccion.minutos} min
        </span>
      </div>
      <EspacioVideo video={leccion.video} titulo={leccion.titulo} />
      <div className="space-y-2 text-[15px] leading-snug text-foreground/85">
        {leccion.cuerpo.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          aria-pressed={vista}
          onClick={() => onMarcar(!vista)}
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9",
            vista
              ? "border-success bg-success-soft text-success"
              : "border-border hover:border-foreground",
          )}
        >
          <Check aria-hidden className="size-4" />
          {vista ? "Vista" : "Marcar como vista"}
        </button>
        {pantalla && leccion.pantalla && (
          <Link
            to={RUTA_DE_PANTALLA[leccion.pantalla] as "/dashboard"}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700 hover:underline sm:min-h-9"
          >
            Practicar en {pantalla.nombre} <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        )}
      </div>
    </li>
  );
}
