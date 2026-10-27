import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { VideoDelPaso } from "@/components/ayuda/video-del-paso";
import type { ClinicAccess } from "@/lib/access/access";
import { enlacePuestaEnMarcha } from "@/lib/marketing/puesta-en-marcha";
import {
  avanceDe,
  enlaceDelPaso,
  mostrarPuestaEnMarcha,
  pasosDePuestaEnMarcha,
  puedeVerPuestaEnMarcha,
  type DatosPuestaEnMarcha,
} from "@/lib/panel/puesta-en-marcha";
import {
  getPuestaEnMarcha,
  setPuestaEnMarchaDescartada,
} from "@/lib/panel/puesta-en-marcha.functions";
import { cn } from "@/lib/utils";

/**
 * NAV-02 · Avance de la puesta en marcha: tarjeta en Hoy y una línea en el
 * menú lateral, con la misma consulta (una sola clave de caché). Ver
 * `src/lib/panel/puesta-en-marcha.ts`.
 */
const CLAVE_PUESTA_EN_MARCHA = "puesta-en-marcha";

function usePuestaEnMarcha(access: ClinicAccess) {
  const clinicId = access.clinic?.id;
  const habilitado = puedeVerPuestaEnMarcha(access, access.clinic) && Boolean(clinicId);
  const fetchDatos = useServerFn(getPuestaEnMarcha);
  const { data } = useQuery({
    queryKey: [CLAVE_PUESTA_EN_MARCHA, clinicId],
    enabled: habilitado,
    queryFn: () => fetchDatos({ data: { clinicId: clinicId! } }),
    staleTime: 5 * 60_000,
  });
  const visible = habilitado && mostrarPuestaEnMarcha(data);
  return { datos: visible ? (data as DatosPuestaEnMarcha) : null, clinicId };
}

function BarraDeAvance({ porcentaje, className }: { porcentaje: number; className?: string }) {
  return (
    <div aria-hidden className={cn("h-1.5 overflow-hidden rounded-full", className)}>
      <div className="h-full rounded-full bg-brand" style={{ width: `${porcentaje}%` }} />
    </div>
  );
}

/** Tarjeta de Hoy (A+: panel en tinta suave, título editorial con itálica ocre). */
export function AvancePuestaEnMarcha({ access }: { access: ClinicAccess }) {
  const { datos, clinicId } = usePuestaEnMarcha(access);
  const queryClient = useQueryClient();
  const descartar = useServerFn(setPuestaEnMarchaDescartada);
  const ocultar = useMutation({
    mutationFn: () => descartar({ data: { clinicId: clinicId!, descartada: true } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [CLAVE_PUESTA_EN_MARCHA, clinicId] });
      toast.success("Listo, ocultamos la guía. Puedes volver a mostrarla desde Ajustes.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos ocultar la guía."),
  });

  if (!datos) return null;
  const pasos = pasosDePuestaEnMarcha(datos);
  const avance = avanceDe(pasos);
  const llamada = enlacePuestaEnMarcha({
    clinicName: access.clinic?.name,
    clinicEmail: access.email,
  });

  return (
    <section
      id="puesta-en-marcha"
      aria-labelledby="puesta-en-marcha-titulo"
      className="scroll-mt-24 rounded-[14px] border border-hairline bg-card p-5"
    >
      <h2
        id="puesta-en-marcha-titulo"
        className="font-display text-[22px] font-medium leading-tight"
      >
        Puesta en marcha{" "}
        <em className="text-brand-600">
          <span className="cifra not-italic text-[0.7em]">{avance.hechos}</span> de{" "}
          <span className="cifra not-italic text-[0.7em]">{avance.total}</span>
        </em>
      </h2>
      <div
        role="progressbar"
        aria-label="Avance de la puesta en marcha"
        aria-valuemin={0}
        aria-valuemax={avance.total}
        aria-valuenow={avance.hechos}
        aria-valuetext={`${avance.hechos} de ${avance.total} pasos`}
        className="mt-3"
      >
        <BarraDeAvance porcentaje={avance.porcentaje} className="bg-muted" />
      </div>
      <ul className="mt-4 space-y-3">
        {pasos.map((paso) => {
          const to = enlaceDelPaso(access, paso);
          return (
            <li key={paso.id} className="flex items-start justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-start gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                    paso.hecho ? "border-success text-success" : "border-border",
                  )}
                >
                  {paso.hecho && <Check className="size-3" />}
                </span>
                <span className="min-w-0">
                  <span className={cn("block", paso.hecho && "text-muted-foreground line-through")}>
                    {paso.label}
                    <span className="sr-only">{paso.hecho ? " (hecho)" : " (pendiente)"}</span>
                  </span>
                  {!paso.hecho && (
                    <span className="block text-xs text-muted-foreground">{paso.detalle}</span>
                  )}
                </span>
              </span>
              {/* ONB-01: video del paso (o "Video pendiente"). */}
              {!paso.hecho && <VideoDelPaso id={paso.id} />}
              {!paso.hecho && to && (
                <Link
                  to={to}
                  className="inline-flex min-h-8 shrink-0 items-center text-xs text-brand-700 hover:underline"
                >
                  {paso.cta} →
                </Link>
              )}
              {!paso.hecho && paso.id === "llamada" && (
                <a
                  href={llamada.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-8 shrink-0 items-center text-xs text-brand-700 hover:underline"
                >
                  {paso.cta} →
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 border-t border-hairline pt-3">
        <button
          type="button"
          onClick={() => ocultar.mutate()}
          disabled={ocultar.isPending}
          className="inline-flex min-h-9 items-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60"
        >
          Ocultar esta guía para toda la clínica
        </button>
      </div>
    </section>
  );
}

/** Línea del menú lateral: "Puesta en marcha · 4 de 10", lleva a la tarjeta de Hoy. */
export function PuestaEnMarchaLateral({ access }: { access: ClinicAccess }) {
  const { datos } = usePuestaEnMarcha(access);
  if (!datos) return null;
  const avance = avanceDe(pasosDePuestaEnMarcha(datos));
  return (
    <Link
      to="/dashboard"
      hash="puesta-en-marcha"
      className="block rounded-md px-3 py-2 text-on-night-2 transition-colors hover:bg-night-2 hover:text-on-night focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="flex items-baseline justify-between gap-2 text-[13px]">
        <span>Puesta en marcha</span>
        <span className="cifra text-[12px] text-on-night">
          {avance.hechos} de {avance.total}
        </span>
      </span>
      <BarraDeAvance porcentaje={avance.porcentaje} className="mt-1.5 bg-night-3" />
      {avance.siguiente && (
        <span className="mt-1.5 block truncate text-[12px]">
          Sigue: {avance.siguiente.label.toLocaleLowerCase("es")}
        </span>
      )}
    </Link>
  );
}

/** Ajustes: volver a mostrar la guía si se ocultó. */
export function MostrarPuestaEnMarchaDeNuevo({ access }: { access: ClinicAccess }) {
  const clinicId = access.clinic?.id;
  const habilitado = puedeVerPuestaEnMarcha(access, access.clinic) && Boolean(clinicId);
  const fetchDatos = useServerFn(getPuestaEnMarcha);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: [CLAVE_PUESTA_EN_MARCHA, clinicId],
    enabled: habilitado,
    queryFn: () => fetchDatos({ data: { clinicId: clinicId! } }),
    staleTime: 5 * 60_000,
  });
  const cambiar = useServerFn(setPuestaEnMarchaDescartada);
  const mostrar = useMutation({
    mutationFn: () => cambiar({ data: { clinicId: clinicId!, descartada: false } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [CLAVE_PUESTA_EN_MARCHA, clinicId] });
      toast.success("La guía de puesta en marcha vuelve a aparecer en Hoy.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos mostrar la guía."),
  });
  if (!habilitado || !data?.descartadoAt) return null;
  const avance = avanceDe(pasosDePuestaEnMarcha(data));
  if (avance.completo) return null;
  return (
    <p className="text-sm text-muted-foreground">
      Ocultaste la guía de puesta en marcha con{" "}
      <span className="cifra">
        {avance.hechos} de {avance.total}
      </span>{" "}
      pasos hechos.{" "}
      <button
        type="button"
        onClick={() => mostrar.mutate()}
        disabled={mostrar.isPending}
        className="text-brand-700 underline-offset-2 hover:underline disabled:opacity-60"
      >
        Volver a mostrarla
      </button>
    </p>
  );
}
