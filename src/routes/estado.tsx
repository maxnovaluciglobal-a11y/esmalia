import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, XCircle } from "lucide-react";
import { LegalH2, LegalP, LegalPage } from "@/components/legal-page";
import { INCIDENTES, type Incidente } from "@/content/incidentes";
import { canonicalHead } from "@/lib/seo";
import { EMAIL_CONTACTO } from "@/lib/marketing/contacto";
import {
  NOMBRE_COMPONENTE,
  NOMBRE_FASE,
  NOMBRE_IMPACTO,
  VENTANA_HISTORIAL_DIAS,
  estadoGeneral,
  incidentesEnCurso,
  incidentesRecientes,
  interpretarSalud,
  type EstadoGeneral,
  type SaludMedida,
} from "@/lib/estado-servicio";
import { cn } from "@/lib/utils";
import { fechaHora, hora } from "@/lib/formato-fecha";

/**
 * Status page propia, sin terceros: el estado se mide desde el navegador
 * contra /api/health de este mismo servidor (cada minuto) y los incidentes
 * vienen de src/content/incidentes.ts, versionado en el repo. Ver docs/SLO.md.
 */
export const Route = createFileRoute("/estado")({
  head: () => {
    const canonical = canonicalHead("/estado");
    return {
      meta: [
        { title: "Estado del servicio · Esmalia" },
        {
          name: "description",
          content:
            "Estado actual de Esmalia medido en vivo e historial de incidentes de los últimos 90 días.",
        },
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: EstadoDelServicio,
});

const INTERVALO_MS = 60_000;
const TIMEOUT_MS = 10_000;

function useSaludDelServidor() {
  const [salud, setSalud] = useState<SaludMedida | null>(null);
  const [comprobadoEn, setComprobadoEn] = useState<Date | null>(null);
  const [comprobando, setComprobando] = useState(false);

  const comprobar = useCallback(async () => {
    setComprobando(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("/api/health", { cache: "no-store", signal: ctrl.signal });
      const cuerpo: unknown = await res.json().catch(() => null);
      setSalud(interpretarSalud(res.status, cuerpo));
    } catch {
      setSalud(interpretarSalud(null, null));
    } finally {
      clearTimeout(timer);
      setComprobadoEn(new Date());
      setComprobando(false);
    }
  }, []);

  useEffect(() => {
    void comprobar();
    const id = setInterval(() => void comprobar(), INTERVALO_MS);
    return () => clearInterval(id);
  }, [comprobar]);

  return { salud, comprobadoEn, comprobando, comprobar };
}

const PRESENTACION: Record<
  EstadoGeneral,
  { titulo: string; detalle: string; Icono: typeof CheckCircle2; clase: string }
> = {
  operativo: {
    titulo: "Todo funciona con normalidad",
    detalle: "La aplicación responde y la base de datos contesta.",
    Icono: CheckCircle2,
    clase: "border-success/40 bg-success-soft text-success",
  },
  "con-incidentes": {
    titulo: "Hay un incidente en curso",
    detalle: "El servidor responde, pero parte del servicio tiene problemas. Detalle abajo.",
    Icono: AlertTriangle,
    clase: "border-warning-border bg-warning-soft text-warning",
  },
  interrumpido: {
    titulo: "Servicio interrumpido",
    detalle: "Esmalia no está funcionando con normalidad. Estamos trabajando en ello.",
    Icono: XCircle,
    clase: "border-destructive/40 bg-destructive-soft text-destructive",
  },
  desconocido: {
    titulo: "No pudimos comprobar el estado",
    detalle:
      "Tu navegador no recibió respuesta del servidor. Puede ser tu conexión o una caída nuestra.",
    Icono: CircleHelp,
    clase: "border-hairline bg-card text-foreground",
  },
};

function EstadoDelServicio() {
  const { salud, comprobadoEn, comprobando, comprobar } = useSaludDelServidor();
  const enCurso = incidentesEnCurso(INCIDENTES);
  const recientes = incidentesRecientes(INCIDENTES, new Date());

  return (
    <LegalPage label="Empresa" title="Estado del servicio">
      {salud === null && enCurso.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-hairline bg-card p-5 text-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          <p className="text-base font-medium">Comprobando el estado…</p>
        </div>
      ) : (
        <TarjetaDeEstado estado={estadoGeneral(salud, INCIDENTES)} />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span aria-live="polite">
          {comprobadoEn
            ? `Última comprobación: ${hora(comprobadoEn, zonaDelEquipo())} (hora de tu equipo). Se repite cada minuto.`
            : "Midiendo desde tu navegador…"}
        </span>
        <button
          type="button"
          onClick={() => void comprobar()}
          disabled={comprobando}
          className="text-brand-700 underline underline-offset-2 disabled:opacity-50"
        >
          Volver a comprobar
        </button>
      </div>

      {enCurso.length > 0 ? (
        <>
          <LegalH2>Incidentes en curso</LegalH2>
          {enCurso.map((i) => (
            <TarjetaIncidente key={i.id} incidente={i} />
          ))}
        </>
      ) : null}

      <LegalH2>Historial de los últimos {VENTANA_HISTORIAL_DIAS} días</LegalH2>
      {recientes.length === 0 ? (
        <LegalP>No hay incidentes registrados en los últimos {VENTANA_HISTORIAL_DIAS} días.</LegalP>
      ) : (
        recientes.map((i) => <TarjetaIncidente key={i.id} incidente={i} />)
      )}

      <LegalH2>Cómo se mide</LegalH2>
      <LegalP>
        Esta página consulta a nuestro propio servidor desde tu navegador: confirma que la
        aplicación responde y que la base de datos contesta. Además, un monitor externo hace la
        misma comprobación cada minuto. Nuestro objetivo interno es una disponibilidad del 99,5 %
        mensual; no es un acuerdo de nivel de servicio contractual.
      </LegalP>
      <LegalP>
        Si algo no te funciona y aquí no aparece, escríbenos a{" "}
        <a
          href={`mailto:${EMAIL_CONTACTO}`}
          className="text-brand-700 underline underline-offset-2"
        >
          {EMAIL_CONTACTO}
        </a>
        .
      </LegalP>
    </LegalPage>
  );
}

function TarjetaDeEstado({ estado }: { estado: EstadoGeneral }) {
  const { titulo, detalle, Icono, clase } = PRESENTACION[estado];
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-xl border p-5", clase)}>
      <Icono className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="text-base font-semibold">{titulo}</p>
        <p className="mt-1 text-sm text-foreground/80">{detalle}</p>
      </div>
    </div>
  );
}

/** Fechas en UTC a propósito: igual en el render del servidor y del navegador. */
function fechaUtc(iso: string) {
  return `${fechaHora(iso, "UTC")} UTC`;
}

/** Huso del equipo de quien mira (la página es pública: no hay clínica). */
function zonaDelEquipo(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function TarjetaIncidente({ incidente: i }: { incidente: Incidente }) {
  const actualizaciones = [...i.actualizaciones].sort((a, b) => b.fecha.localeCompare(a.fecha));
  return (
    <article className="mt-4 rounded-xl border border-hairline bg-card p-5">
      <h3 className="text-base font-semibold text-foreground">{i.titulo}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {NOMBRE_IMPACTO[i.impacto]} · {i.componentes.map((c) => NOMBRE_COMPONENTE[c]).join(", ")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {fechaUtc(i.inicio)} → {i.fin ? fechaUtc(i.fin) : "en curso"}
      </p>
      <ol className="mt-4 space-y-3 border-l border-hairline pl-4">
        {actualizaciones.map((a) => (
          <li key={`${a.fecha}-${a.fase}`}>
            <p className="text-xs font-semibold text-foreground">
              {NOMBRE_FASE[a.fase]}{" "}
              <span className="font-normal text-muted-foreground">· {fechaUtc(a.fecha)}</span>
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-foreground/80">{a.mensaje}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}
