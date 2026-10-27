import { useEffect, useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  CircleHelp,
  GraduationCap,
  Keyboard,
  Map as IconoMapa,
  MessageCircle,
  MessageSquareWarning,
  Sparkles,
} from "lucide-react";

import { EspacioVideo } from "@/components/ayuda/espacio-video";
import { RecorridoGuiado } from "@/components/ayuda/recorrido-guiado";
import { ReportarDialog } from "@/components/ayuda/reportar-dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { articulosDeAyuda } from "@/content/ayuda/indice";
import { NOVEDADES } from "@/content/ayuda/novedades";
import { ayudaDePantalla } from "@/content/ayuda/pantallas";
import { recorridoDePantalla } from "@/content/ayuda/recorridos";
import { useProgresoAyuda } from "@/hooks/use-progreso-ayuda";
import type { ClinicAccess } from "@/lib/access/access";
import { EVENTO_ABRIR_ATAJOS } from "@/lib/atajos";
import { buscarAyuda } from "@/lib/ayuda/buscador";
import {
  EVENTO_ABRIR_AYUDA,
  EVENTO_ABRIR_REPORTE,
  EVENTO_VER_RECORRIDO,
} from "@/lib/ayuda/eventos";
import { pantallaDeRuta } from "@/lib/ayuda/pantalla-actual";
import { EMAIL_SOPORTE, enlaceWhatsAppSoporte } from "@/lib/marketing/contacto";
import { cn } from "@/lib/utils";

const ITEM =
  "flex min-h-12 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[15px] font-medium hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Botón de ayuda siempre visible (NAV-06, Ola 12), en la barra superior
 * junto a la campana. Abre un panel con:
 * - "Cómo se usa esta pantalla" (ONB-02) y su recorrido (ONB-03);
 * - el buscador de la ayuda (ONB-10);
 * - Academia (ONB-04), Novedades con su marca de no leído (NAV-10);
 * - WhatsApp de soporte y "Reportar un problema" (ONB-09).
 * También ofrece el recorrido la primera vez que la persona entra a una
 * pantalla que lo tiene (se puede saltar y volver a ver desde aquí).
 */
export function BotonAyuda({ access }: { access: ClinicAccess }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pantallaId = pantallaDeRuta(pathname);
  const ayuda = ayudaDePantalla(pantallaId);
  const recorrido = recorridoDePantalla(pantallaId);
  const esDemo = Boolean(access.clinic?.isDemo);
  const progreso = useProgresoAyuda({ userId: access.userId, esDemo });

  const [abierto, setAbierto] = useState(false);
  const [reportando, setReportando] = useState(false);
  const [enRecorrido, setEnRecorrido] = useState(false);
  const [invitacionCerrada, setInvitacionCerrada] = useState<string | null>(null);
  const [consulta, setConsulta] = useState("");

  const sinLeer = NOVEDADES.filter((n) => !progreso.hecho("novedad", n.id)).length;
  const whatsapp = enlaceWhatsAppSoporte(access.clinic?.name);

  const articulos = useMemo(() => articulosDeAyuda(access.role), [access.role]);
  const resultados = useMemo(() => buscarAyuda(articulos, consulta, 6), [articulos, consulta]);

  // Eventos desde el menú Ayuda, el centro de ayuda u otras pantallas.
  useEffect(() => {
    const abrir = () => setAbierto(true);
    const reportar = () => {
      setAbierto(false);
      setReportando(true);
    };
    const tour = () => {
      setAbierto(false);
      setEnRecorrido(true);
    };
    window.addEventListener(EVENTO_ABRIR_AYUDA, abrir);
    window.addEventListener(EVENTO_ABRIR_REPORTE, reportar);
    window.addEventListener(EVENTO_VER_RECORRIDO, tour);
    return () => {
      window.removeEventListener(EVENTO_ABRIR_AYUDA, abrir);
      window.removeEventListener(EVENTO_ABRIR_REPORTE, reportar);
      window.removeEventListener(EVENTO_VER_RECORRIDO, tour);
    };
  }, []);

  // Al cambiar de pantalla se cierra un recorrido en curso.
  useEffect(() => {
    setEnRecorrido(false);
  }, [pantallaId]);

  // Invitación al recorrido: primera vez en la pantalla, con el avance ya
  // cargado (para no ofrecerlo a quien ya lo vio en otro equipo).
  const [listo, setListo] = useState(false);
  useEffect(() => {
    setListo(false);
    const t = window.setTimeout(() => setListo(true), 900);
    return () => window.clearTimeout(t);
  }, [pantallaId]);
  const ofrecer =
    listo &&
    recorrido !== null &&
    !progreso.cargando &&
    !progreso.hecho("tour", recorrido.id) &&
    invitacionCerrada !== recorrido.id &&
    !enRecorrido &&
    !abierto &&
    !reportando;

  function cerrarRecorrido() {
    setEnRecorrido(false);
    if (recorrido) progreso.marcar("tour", [recorrido.id]);
  }

  return (
    <>
      <button
        type="button"
        data-boton-ayuda=""
        onClick={() => setAbierto(true)}
        aria-label={sinLeer > 0 ? `Ayuda (${sinLeer} novedades sin leer)` : "Ayuda"}
        aria-haspopup="dialog"
        className="relative inline-flex size-9 items-center justify-center rounded-lg border border-hairline hover:bg-secondary/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:size-11"
      >
        <CircleHelp aria-hidden className="size-[18px]" />
        {sinLeer > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-brand-600"
          />
        )}
      </button>

      <Sheet open={abierto} onOpenChange={setAbierto}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
          <div className="space-y-5 px-5 pt-6 pb-8">
            <div className="pr-10">
              <p className="text-sm font-medium text-muted-foreground">Ayuda</p>
              <SheetTitle className="mt-1 font-display text-[30px] font-medium leading-none">
                {ayuda ? (
                  <>
                    Cómo se usa <em className="text-brand-600">{ayuda.nombre}</em>
                  </>
                ) : (
                  <>
                    ¿En qué te <em className="text-brand-600">ayudamos</em>?
                  </>
                )}
              </SheetTitle>
              <SheetDescription className="mt-2 text-[15px]">
                {ayuda?.resumen ?? "Busca en la ayuda o escríbenos."}
              </SheetDescription>
            </div>

            <label className="block">
              <span className="sr-only">Buscar en la ayuda</span>
              <input
                type="search"
                value={consulta}
                onChange={(e) => setConsulta(e.target.value)}
                placeholder="Buscar en la ayuda (ej.: cerrar caja)"
                className="h-11 w-full rounded-full border border-control bg-card px-4 text-base outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </label>
            {consulta.trim() && (
              <section aria-label="Resultados de la búsqueda" aria-live="polite">
                {resultados.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sin resultados. Prueba con otra palabra o escríbenos.
                  </p>
                ) : (
                  <ul className="divide-y divide-hairline rounded-[12px] border border-hairline">
                    {resultados.map(({ articulo }) => (
                      <li key={articulo.id}>
                        <EnlaceArticulo
                          href={articulo.href}
                          onIr={() => setAbierto(false)}
                          className="block px-3.5 py-2.5 hover:bg-secondary"
                        >
                          <span className="block text-[15px] font-semibold">{articulo.titulo}</span>
                          <span className="line-clamp-2 block text-[13px] text-muted-foreground">
                            {articulo.resumen}
                          </span>
                        </EnlaceArticulo>
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  to="/ayuda"
                  search={{ q: consulta }}
                  onClick={() => setAbierto(false)}
                  className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
                >
                  Ver todo en el centro de ayuda <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </section>
            )}

            {ayuda && !consulta.trim() && (
              <section aria-labelledby="ayuda-pasos" className="space-y-3">
                <h3 id="ayuda-pasos" className="sr-only">
                  Pasos
                </h3>
                <ol className="space-y-3">
                  {ayuda.pasos.map((p, i) => (
                    <li key={p.titulo} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2.5">
                      <span
                        aria-hidden
                        className="cifra grid size-7 place-items-center rounded-full border border-control text-[13px]"
                      >
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-[15px] font-semibold leading-snug">{p.titulo}</p>
                        <p className="text-[14.5px] leading-snug text-foreground/80">{p.texto}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                {ayuda.tenEnCuenta.length > 0 && (
                  <div className="rounded-[12px] border border-hairline bg-secondary/50 px-3.5 py-3">
                    <p className="text-[13px] font-semibold">Ten en cuenta</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[13.5px] text-foreground/80">
                      {ayuda.tenEnCuenta.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <EspacioVideo video={ayuda.video} titulo={`Cómo se usa ${ayuda.nombre}`} />
                <div className="flex flex-wrap gap-2">
                  {recorrido && (
                    <button
                      type="button"
                      onClick={() => {
                        setAbierto(false);
                        // Que el panel termine de cerrarse antes de medir.
                        window.setTimeout(() => setEnRecorrido(true), 250);
                      }}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background hover:bg-foreground/88 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <IconoMapa aria-hidden className="size-4" />
                      {progreso.hecho("tour", recorrido.id)
                        ? "Ver el recorrido de nuevo"
                        : "Ver el recorrido"}
                    </button>
                  )}
                  <Link
                    to="/ayuda/pantalla/$pantalla"
                    params={{ pantalla: ayuda.id }}
                    onClick={() => setAbierto(false)}
                    className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-4 text-sm font-semibold hover:border-foreground"
                  >
                    Abrir en página completa
                  </Link>
                </div>
              </section>
            )}

            <nav aria-label="Más ayuda" className="-mx-2 border-t border-hairline pt-3">
              <Link
                to="/ayuda"
                search={{ q: "" }}
                onClick={() => setAbierto(false)}
                className={ITEM}
              >
                <BookOpen aria-hidden className="size-4 text-muted-foreground" /> Centro de ayuda
              </Link>
              <Link to="/ayuda/academia" onClick={() => setAbierto(false)} className={ITEM}>
                <GraduationCap aria-hidden className="size-4 text-muted-foreground" /> Academia para
                tu rol
              </Link>
              <Link to="/ayuda/novedades" onClick={() => setAbierto(false)} className={ITEM}>
                <Sparkles aria-hidden className="size-4 text-muted-foreground" /> Novedades
                {sinLeer > 0 && (
                  <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-semibold text-brand-700">
                    {sinLeer} sin leer
                  </span>
                )}
              </Link>
              {whatsapp && (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={ITEM}>
                  <MessageCircle aria-hidden className="size-4 text-muted-foreground" /> Escribir
                  por WhatsApp
                </a>
              )}
              <button
                type="button"
                className={ITEM}
                onClick={() => {
                  setAbierto(false);
                  setReportando(true);
                }}
              >
                <MessageSquareWarning aria-hidden className="size-4 text-muted-foreground" />
                Reportar un problema o sugerir algo
              </button>
              <button
                type="button"
                className={cn(ITEM, "pointer-coarse:hidden")}
                onClick={() => {
                  setAbierto(false);
                  window.dispatchEvent(new Event(EVENTO_ABRIR_ATAJOS));
                }}
              >
                <Keyboard aria-hidden className="size-4 text-muted-foreground" /> Atajos de teclado
                <span className="ml-auto font-mono text-[12px] text-muted-foreground">?</span>
              </button>
              <p className="px-3 pt-2 text-[13px] text-muted-foreground">
                También en{" "}
                <a href={`mailto:${EMAIL_SOPORTE}`} className="underline underline-offset-2">
                  {EMAIL_SOPORTE}
                </a>
              </p>
            </nav>
          </div>
        </SheetContent>
      </Sheet>

      {access.clinic && (
        <ReportarDialog
          abierto={reportando}
          onAbiertoChange={setReportando}
          clinicId={access.clinic.id}
          pantalla={ayuda?.nombre ?? null}
          esDemo={esDemo}
        />
      )}

      {ofrecer && recorrido && ayuda && (
        <section
          aria-label="Recorrido disponible"
          className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-sm rounded-[14px] border border-night-line bg-night p-4 text-on-night shadow-lg md:inset-x-auto md:right-6 md:bottom-6"
        >
          <p className="font-display text-[20px] font-medium leading-tight">
            ¿Primera vez en <em className="text-brand-on-night">{ayuda.nombre}</em>?
          </p>
          <p className="mt-1 text-sm text-on-night-2">
            Te mostramos lo principal en {recorrido.pasos.length} pasos. Lo puedes volver a ver
            desde la ayuda.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setEnRecorrido(true)}
              className="inline-flex min-h-11 items-center rounded-full bg-on-night px-4 text-sm font-semibold text-night focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-on-night sm:min-h-9"
            >
              Ver el recorrido
            </button>
            <button
              type="button"
              onClick={() => {
                setInvitacionCerrada(recorrido.id);
                progreso.marcar("tour", [recorrido.id]);
              }}
              className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-on-night-2 hover:text-on-night focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-on-night sm:min-h-9"
            >
              Ahora no
            </button>
          </div>
        </section>
      )}

      {enRecorrido && recorrido && ayuda && (
        <RecorridoGuiado
          recorrido={recorrido}
          nombrePantalla={ayuda.nombre}
          onCerrar={cerrarRecorrido}
        />
      )}
    </>
  );
}

/** Enlace a un artículo: las guías de /docs se abren en otra pestaña. */
function EnlaceArticulo({
  href,
  onIr,
  className,
  children,
}: {
  href: string;
  onIr: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (href.startsWith("/docs")) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  const [ruta, hash] = href.split("#");
  return (
    // Las rutas salen del contenido de la ayuda (no del usuario).
    <Link to={ruta as "/ayuda/novedades"} hash={hash} onClick={onIr} className={className}>
      {children}
    </Link>
  );
}
