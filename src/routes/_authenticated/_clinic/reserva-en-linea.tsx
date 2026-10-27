import { useEffect, useId, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Copy, Download, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { CLASE_CAMPO } from "@/components/cita-formulario";
import { ErrorDeCarga } from "@/components/estado-error";
import { ChipOpcion } from "@/components/reserva/piezas";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { requirePermission } from "@/lib/access/route-guards";
import { mensajeDeError } from "@/lib/mensaje-error";
import {
  getConfiguracionReserva,
  guardarConfiguracionReserva,
  type ConfiguracionReserva,
} from "@/lib/reserva/configuracion.functions";
import { matrizQr, nombreArchivoQr, pathSvgQr, snippetWidget } from "@/lib/reserva/qr";
import { duracionLegible, normalizarSlug, problemaDeSlug } from "@/lib/reserva/reserva";
import { cn } from "@/lib/utils";

/**
 * Reserva en línea (Ola 7 · RES-01 a RES-07): el link público de la clínica
 * y de cada profesional, sus reglas (encendido, anticipación, qué se puede
 * reservar), el widget para la web y el QR.
 *
 * Solo owner y admin (`settings:manage`): el servidor y la RLS de
 * `online_booking_settings` exigen lo mismo.
 */
export const Route = createFileRoute("/_authenticated/_clinic/reserva-en-linea")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Reserva en línea | Esmalia" },
      {
        name: "description",
        content:
          "Link para que tus pacientes reserven su hora en línea, con widget para tu web y código QR.",
      },
    ],
  }),
  component: ReservaEnLineaPage,
});

const ANTICIPACION = [0, 2, 12, 24, 48] as const;
const HORIZONTE = [7, 14, 30, 60, 90] as const;

function ReservaEnLineaPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const getFn = useServerFn(getConfiguracionReserva);
  const q = useQuery({
    queryKey: ["reserva-en-linea", clinicId],
    queryFn: () => getFn({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
  });
  return (
    <AppShell title="Reserva en línea" access={access}>
      {!clinicId ? null : q.isError ? (
        <ErrorDeCarga onReintentar={() => void q.refetch()} />
      ) : q.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
        </p>
      ) : (
        <Formulario clinicId={clinicId} config={q.data} />
      )}
    </AppShell>
  );
}

function Formulario({ clinicId, config }: { clinicId: string; config: ConfiguracionReserva }) {
  const fid = useId();
  const qc = useQueryClient();
  const guardarFn = useServerFn(guardarConfiguracionReserva);
  const [enabled, setEnabled] = useState(config.enabled);
  const [slug, setSlug] = useState(config.slug);
  const [anticipacion, setAnticipacion] = useState(config.minNoticeHours);
  const [horizonte, setHorizonte] = useState(config.maxDaysAhead);
  const [procs, setProcs] = useState<string[]>(config.procedimientoIds);
  const [tipos, setTipos] = useState<string[]>(config.tipoIds);
  const [nota, setNota] = useState(config.nota);

  useEffect(() => {
    setEnabled(config.enabled);
    setSlug(config.slug);
    setAnticipacion(config.minNoticeHours);
    setHorizonte(config.maxDaysAhead);
    setProcs(config.procedimientoIds);
    setTipos(config.tipoIds);
    setNota(config.nota);
  }, [config]);

  const problema = problemaDeSlug(slug);
  const guardado = config.existe ? config.slug : null;
  const url = `${config.origen}/reservar/${guardado ?? slug}`;
  const sinMotivos = procs.length + tipos.length === 0;

  const guardar = useMutation({
    mutationFn: (encender?: boolean) =>
      guardarFn({
        data: {
          clinicId,
          enabled: encender ?? enabled,
          slug,
          minNoticeHours: anticipacion,
          maxDaysAhead: horizonte,
          procedimientoIds: procs,
          tipoIds: tipos,
          nota,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reserva-en-linea", clinicId] });
      toast.success("Reserva en línea guardada.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const alternar = (lista: string[], set: (l: string[]) => void, id: string) =>
    set(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

  const avisos: string[] = [];
  const sinHorario = config.profesionales.filter((p) => !p.tieneHorario);
  if (config.sucursalesConHorario < config.sucursales && sinHorario.length > 0) {
    avisos.push(
      `${sinHorario.map((p) => p.nombre).join(", ")} no ${sinHorario.length === 1 ? "tiene" : "tienen"} horario declarado y hay sucursales sin horario de atención: ahí no se ofrecen horas. Decláralo en Profesionales o en Configuración de la agenda.`,
    );
  }
  if (config.profesionales.length === 0) {
    avisos.push(
      'Nadie del equipo está marcado como "Atiende pacientes": no hay con quién reservar.',
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-9">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            <b className="font-semibold text-foreground/80">{config.clinica}</b> · Tus pacientes
            eligen su hora, tú la aceptas
          </p>
          <h2 className="font-display text-[clamp(2.25rem,3.6vw,3.5rem)] font-medium leading-none tracking-[-0.02em]">
            Reserva en <em className="text-brand-600">línea</em>
          </h2>
        </div>
        <span
          className={cn(
            "inline-flex h-7 items-center rounded-full border px-3 text-sm font-semibold",
            config.enabled
              ? "border-success-border bg-success-soft text-success"
              : "border-border bg-card text-muted-foreground",
          )}
        >
          {config.enabled ? "Encendida" : "Apagada"}
        </span>
      </header>

      {/* Link en tinta: lo que la clínica comparte. */}
      <section
        aria-label="Tu link de reserva"
        className="space-y-4 rounded-[14px] border border-night-line bg-night p-5 text-on-night md:p-7"
      >
        <p className="text-[13px] font-semibold text-on-night-2">Tu link de reserva</p>
        <p className="cifra break-all text-lg text-brand-on-night md:text-xl">{url}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!config.existe}
            onClick={() => copiar(url, "Link copiado.")}
          >
            <Copy className="size-4" aria-hidden /> Copiar
          </Button>
          <Button type="button" variant="secondary" size="sm" asChild disabled={!config.existe}>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" aria-hidden /> Abrir
            </a>
          </Button>
          <BloqueoEscritura
            otroMotivo={
              !config.enabled && sinMotivos
                ? "Elige al menos un procedimiento o tipo de cita para encender."
                : null
            }
          >
            <Button
              type="button"
              size="sm"
              disabled={guardar.isPending || Boolean(problema) || (!config.enabled && sinMotivos)}
              onClick={() => {
                setEnabled(!config.enabled);
                guardar.mutate(!config.enabled);
              }}
            >
              {config.enabled ? "Apagar la reserva" : "Encender la reserva"}
            </Button>
          </BloqueoEscritura>
        </div>
        <p className="text-sm text-on-night-2">
          Las citas que lleguen por aquí entran <b className="text-on-night">por confirmar</b> y
          marcadas como reserva en línea: el profesional las acepta en la agenda.
        </p>
      </section>

      {avisos.length > 0 ? (
        <div className="space-y-2">
          {avisos.map((a) => (
            <p
              key={a}
              className="flex items-start gap-2 rounded-[12px] border border-warning-border bg-warning-soft p-3 text-sm"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              {a}
            </p>
          ))}
        </div>
      ) : null}

      <section aria-labelledby={`${fid}-reglas`} className="space-y-4">
        <div>
          <h3 id={`${fid}-reglas`} className="kicker">
            Reglas
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Se aplican a la página pública y cuando el paciente cambia su hora desde su link.
          </p>
        </div>
        <div className="card-clinical space-y-6 p-4 md:p-5">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-slug`}>Dirección del link</Label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="cifra text-sm text-muted-foreground">{config.origen}/reservar/</span>
              <input
                id={`${fid}-slug`}
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                onBlur={() => setSlug((s) => normalizarSlug(s) || s)}
                maxLength={48}
                spellCheck={false}
                autoCapitalize="none"
                className={cn(CLASE_CAMPO, "cifra max-w-xs")}
                aria-invalid={Boolean(problema)}
                aria-describedby={`${fid}-slug-ayuda`}
              />
            </div>
            <p
              id={`${fid}-slug-ayuda`}
              className={cn("text-sm", problema ? "text-destructive" : "text-muted-foreground")}
            >
              {problema ??
                (guardado && guardado !== slug
                  ? "Si la cambias, el link anterior deja de funcionar."
                  : "Letras minúsculas, números y guiones.")}
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Anticipación mínima</legend>
            <div className="flex flex-wrap gap-2">
              {ANTICIPACION.map((h) => (
                <ChipOpcion key={h} activo={anticipacion === h} onClick={() => setAnticipacion(h)}>
                  {h === 0
                    ? "Sin mínimo"
                    : h < 24
                      ? `${h} horas`
                      : `${h / 24} ${h === 24 ? "día" : "días"}`}
                </ChipOpcion>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Hasta cuántos días hacia adelante</legend>
            <div className="flex flex-wrap gap-2">
              {HORIZONTE.map((d) => (
                <ChipOpcion key={d} activo={horizonte === d} onClick={() => setHorizonte(d)}>
                  {d} días
                </ChipOpcion>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-nota`}>Mensaje de bienvenida (opcional)</Label>
            <textarea
              id={`${fid}-nota`}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={400}
              rows={2}
              placeholder="Por ejemplo: llega 10 minutos antes y trae tu bono si tienes Fonasa."
              className={CLASE_CAMPO}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby={`${fid}-motivos`} className="space-y-4">
        <div>
          <h3 id={`${fid}-motivos`} className="kicker">
            Qué se puede reservar
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            La duración sale del arancel (o de la duración por defecto de la agenda).
          </p>
        </div>
        <div className="card-clinical grid gap-6 p-4 md:grid-cols-2 md:p-5">
          <ListaMarcable
            titulo="Tipos de cita"
            vacio="No hay tipos de cita activos."
            items={config.tipos}
            marcados={tipos}
            onAlternar={(id) => alternar(tipos, setTipos, id)}
          />
          <ListaMarcable
            titulo="Procedimientos del arancel"
            vacio="No hay procedimientos activos en el arancel."
            items={config.procedimientos}
            marcados={procs}
            onAlternar={(id) => alternar(procs, setProcs, id)}
          />
        </div>
        <BloqueoEscritura
          otroMotivo={
            problema ??
            (enabled && sinMotivos
              ? "Elige al menos un procedimiento o tipo de cita, o apaga la reserva."
              : null)
          }
        >
          <Button
            type="button"
            disabled={guardar.isPending || Boolean(problema) || (enabled && sinMotivos)}
            onClick={() => guardar.mutate(undefined)}
          >
            {guardar.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Guardar
          </Button>
        </BloqueoEscritura>
      </section>

      {config.existe ? <Compartir config={config} url={url} /> : null}
    </div>
  );
}

function ListaMarcable({
  titulo,
  vacio,
  items,
  marcados,
  onAlternar,
}: {
  titulo: string;
  vacio: string;
  items: { id: string; nombre: string; duracion: number }[];
  marcados: string[];
  onAlternar: (id: string) => void;
}) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-semibold">
        {titulo}{" "}
        <span className="font-normal text-muted-foreground">
          ({marcados.filter((m) => items.some((i) => i.id === m)).length} de {items.length})
        </span>
      </legend>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vacio}</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
          {items.map((i) => (
            <li key={i.id}>
              <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={marcados.includes(i.id)}
                  onChange={() => onAlternar(i.id)}
                  className="size-4 accent-brand-700"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{i.nombre}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {duracionLegible(i.duracion)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

async function copiar(texto: string, ok: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(ok);
  } catch {
    toast.error("No pudimos copiar. Selecciona el texto y cópialo a mano.");
  }
}

function Compartir({ config, url }: { config: ConfiguracionReserva; url: string }) {
  const fid = useId();
  const snippet = snippetWidget(url, config.clinica);
  const qr = useMemo(() => pathSvgQr(matrizQr(url)), [url]);

  function descargarQr() {
    const escala = 16;
    const lado = qr.lado * escala;
    const canvas = document.createElement("canvas");
    canvas.width = lado;
    canvas.height = lado;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, lado, lado);
    ctx.fillStyle = "#15120f";
    ctx.scale(escala, escala);
    ctx.fill(new Path2D(qr.d));
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = nombreArchivoQr(config.slug);
    a.click();
  }

  return (
    <section aria-labelledby={`${fid}-compartir`} className="space-y-4">
      <div>
        <h3 id={`${fid}-compartir`} className="kicker">
          Compartir
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          En tu web, en Instagram, en el mostrador o en la firma de tus correos.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="card-clinical min-w-0 space-y-3 p-4 md:p-5">
          <p className="text-sm font-semibold">Widget para tu web</p>
          <pre className="cifra max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-hairline bg-muted/40 p-3 text-xs">
            {snippet}
          </pre>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => copiar(snippet, "Código copiado.")}
          >
            <Copy className="size-4" aria-hidden /> Copiar código
          </Button>
          <p className="text-xs text-muted-foreground">
            Pégalo en tu página. Si tu sitio no permite insertar páginas, usa el link de abajo del
            código.
          </p>
        </div>
        <div className="card-clinical flex flex-col items-center gap-3 p-4">
          <p className="self-start text-sm font-semibold">Código QR</p>
          <svg
            viewBox={`0 0 ${qr.lado} ${qr.lado}`}
            role="img"
            aria-label={`Código QR de ${url}`}
            className="size-40 rounded-md bg-white"
            shapeRendering="crispEdges"
          >
            <path d={qr.d} className="fill-night" />
          </svg>
          <Button type="button" variant="outline" size="sm" onClick={descargarQr}>
            <Download className="size-4" aria-hidden /> Descargar PNG
          </Button>
        </div>
      </div>

      {config.profesionales.length > 0 ? (
        <div className="card-clinical space-y-2 p-4 md:p-5">
          <p className="text-sm font-semibold">Link de cada profesional</p>
          <ul className="divide-y divide-hairline">
            {config.profesionales.map((p) => {
              const link = `${url}/${p.slug}`;
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{p.nombre}</p>
                    <p className="cifra truncate text-xs text-muted-foreground">{link}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => copiar(link, `Link de ${p.nombre} copiado.`)}
                  >
                    <Copy className="size-4" aria-hidden /> Copiar
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
