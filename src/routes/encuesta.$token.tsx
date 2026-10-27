import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Clock, ExternalLink, Heart, Loader2, Star, XCircle } from "lucide-react";

import { CLASE_CAMPO } from "@/components/cita-formulario";
import {
  AvisoPublico,
  EncabezadoPublico,
  PANEL_PUBLICO,
} from "@/components/notificaciones/piezas-publicas";
import { PublicPageShell } from "@/components/site-chrome";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fechaLarga } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import {
  abrirEncuesta,
  responderEncuesta,
  type EncuestaAbierta,
  type EstadoEncuesta,
  type RespuestaEncuesta,
} from "@/lib/notificaciones-pacientes/encuesta.functions";
import { cn } from "@/lib/utils";

/**
 * MKT-08 · Encuesta después de la cita: `<dominio>/encuesta/<token>`.
 *
 * Página pública, sin login y sin índice. Una pregunta de 0 a 10 y un
 * comentario. A un promotor (9-10) se le ofrece la reseña en Google con el
 * link que cargó la clínica; si no hay link, solo se le agradece.
 */
export const Route = createFileRoute("/encuesta/$token")({
  head: () => ({
    meta: [
      { title: "¿Cómo fue tu visita? · Esmalia" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: EncuestaPage,
});

type Paso =
  | { tipo: "cargando" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "fin"; estado: Exclude<EstadoEncuesta, "abierta">; clinica: string | null }
  | { tipo: "abierta"; info: EncuestaAbierta }
  | {
      tipo: "gracias";
      info: EncuestaAbierta;
      r: Extract<RespuestaEncuesta, { estado: "gracias" }>;
    };

function EncuestaPage() {
  const { token } = Route.useParams();
  const abrir = useServerFn(abrirEncuesta);
  const [paso, setPaso] = useState<Paso>({ tipo: "cargando" });

  useEffect(() => {
    let vivo = true;
    abrir({ data: { token } })
      .then((info) => {
        if (!vivo) return;
        setPaso(
          info.estado === "abierta"
            ? { tipo: "abierta", info }
            : { tipo: "fin", estado: info.estado, clinica: info.clinica },
        );
      })
      .catch((e) => vivo && setPaso({ tipo: "error", mensaje: mensajeDeError(e) }));
    return () => {
      vivo = false;
    };
  }, [token, abrir]);

  return (
    <PublicPageShell mainClassName="max-w-2xl px-4 sm:px-6">
      {paso.tipo === "cargando" && (
        <p className="flex items-center justify-center gap-2 py-20 text-base text-muted-foreground">
          <Loader2 className="size-5 animate-spin text-brand" aria-hidden /> Abriendo…
        </p>
      )}
      {paso.tipo === "error" && (
        <AvisoPublico
          icono={<XCircle className="size-8 text-destructive" aria-hidden />}
          titulo="No pudimos abrir la encuesta"
        >
          <p>{paso.mensaje}</p>
        </AvisoPublico>
      )}
      {paso.tipo === "fin" && <Fin estado={paso.estado} clinica={paso.clinica} />}
      {paso.tipo === "abierta" && (
        <Pregunta
          token={token}
          info={paso.info}
          onRespuesta={(r) =>
            r.estado === "gracias"
              ? setPaso({ tipo: "gracias", info: paso.info, r })
              : setPaso({ tipo: "fin", estado: r.estado, clinica: paso.info.clinica })
          }
        />
      )}
      {paso.tipo === "gracias" && <Gracias info={paso.info} r={paso.r} />}
    </PublicPageShell>
  );
}

function Fin({
  estado,
  clinica,
}: {
  estado: Exclude<EstadoEncuesta, "abierta">;
  clinica: string | null;
}) {
  if (estado === "respondida") {
    return (
      <AvisoPublico
        icono={<CheckCircle2 className="size-8 text-success" aria-hidden />}
        titulo="Ya respondiste esta encuesta"
      >
        <p>Gracias: {clinica ?? "la clínica"} ya tiene tu respuesta.</p>
      </AvisoPublico>
    );
  }
  if (estado === "vencida") {
    return (
      <AvisoPublico
        icono={<Clock className="size-8 text-warning" aria-hidden />}
        titulo="Esta encuesta ya cerró"
      >
        <p>Se podía responder durante 14 días después de la visita.</p>
      </AvisoPublico>
    );
  }
  return (
    <AvisoPublico
      icono={<XCircle className="size-8 text-destructive" aria-hidden />}
      titulo="Este link no es válido"
    >
      <p>Revisa que lo hayas abierto completo desde el correo de la clínica.</p>
    </AvisoPublico>
  );
}

const NOTAS = Array.from({ length: 11 }, (_, i) => i);

function Pregunta({
  token,
  info,
  onRespuesta,
}: {
  token: string;
  info: EncuestaAbierta;
  onRespuesta: (r: RespuestaEncuesta) => void;
}) {
  const fid = useId();
  const responder = useServerFn(responderEncuesta);
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function mover(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let destino: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") destino = Math.min(10, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") destino = Math.max(0, i - 1);
    else if (e.key === "Home") destino = 0;
    else if (e.key === "End") destino = 10;
    if (destino === null) return;
    e.preventDefault();
    refs.current[destino]?.focus();
    setNota(destino);
  }

  async function onEnviar() {
    if (nota === null) return;
    setEnviando(true);
    setError(null);
    try {
      onRespuesta(
        await responder({
          data: { token, nota, comentario: comentario.trim() || undefined },
        }),
      );
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-8">
      <EncabezadoPublico
        antetitulo={
          info.cita ? `Tu visita del ${fechaLarga(info.cita, info.zona)}` : "Tu última visita"
        }
        titulo="¿Cómo te fue en"
        enfasis={info.clinica ? `${info.clinica}?` : null}
      >
        <p>
          Dos preguntas, menos de un minuto.
          {info.profesional ? ` Te atendió ${info.profesional}.` : ""}
        </p>
      </EncabezadoPublico>

      <section aria-labelledby={`${fid}-pregunta`} className={cn(PANEL_PUBLICO, "space-y-5 p-5")}>
        <h2 id={`${fid}-pregunta`} className="font-display text-2xl font-medium leading-tight">
          ¿Qué tan probable es que recomiendes la clínica a un familiar o a un amigo?
        </h2>
        <div>
          <div
            role="radiogroup"
            aria-labelledby={`${fid}-pregunta`}
            className="grid grid-cols-6 gap-2 sm:grid-cols-11"
          >
            {NOTAS.map((n) => {
              const activa = nota === n;
              return (
                <button
                  key={n}
                  ref={(el) => {
                    refs.current[n] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={activa}
                  aria-label={`${n} de 10`}
                  tabIndex={nota === null ? (n === 0 ? 0 : -1) : activa ? 0 : -1}
                  onKeyDown={(e) => mover(e, n)}
                  onClick={() => setNota(n)}
                  className={cn(
                    "cifra flex h-12 items-center justify-center rounded-xl border text-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700",
                    activa
                      ? "border-brand-700 bg-brand-700 text-brand-foreground"
                      : "border-hairline bg-background hover:border-brand-300",
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-sm text-muted-foreground">
            <span>Nada probable</span>
            <span>Muy probable</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-comentario`}>
            {nota !== null && nota >= 9
              ? "¿Qué fue lo que más te gustó? (opcional)"
              : "¿Qué podríamos mejorar? (opcional)"}
          </Label>
          <textarea
            id={`${fid}-comentario`}
            rows={4}
            maxLength={1000}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            className={cn(CLASE_CAMPO, "text-base")}
          />
        </div>
      </section>

      {error && (
        <p role="alert" className="text-base text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Tu respuesta llega a {info.clinica ?? "la clínica"}.
        </p>
        <Button
          className="h-12 rounded-full px-6 text-base"
          onClick={onEnviar}
          disabled={enviando || nota === null}
        >
          {enviando && <Loader2 className="animate-spin" aria-hidden />}
          Enviar respuesta
        </Button>
      </div>
    </div>
  );
}

function Gracias({
  info,
  r,
}: {
  info: EncuestaAbierta;
  r: Extract<RespuestaEncuesta, { estado: "gracias" }>;
}) {
  const clinica = info.clinica ?? "la clínica";
  return (
    <div className="space-y-6">
      <AvisoPublico
        icono={<Heart className="size-8 text-brand-600" aria-hidden />}
        titulo="¡Gracias por responder!"
      >
        <p>
          {r.promotor
            ? `Nos alegra mucho que te haya ido bien en ${clinica}.`
            : `${clinica} recibió tu respuesta y la va a tener en cuenta.`}
        </p>
      </AvisoPublico>
      {r.promotor && r.resenaUrl && (
        <section className="mx-auto max-w-lg rounded-[14px] border border-night-line bg-night p-6 text-center text-on-night">
          <Star className="mx-auto size-7 text-brand-on-night" aria-hidden />
          <h2 className="mt-3 font-display text-2xl font-medium">
            ¿Nos ayudas con una reseña en Google?
          </h2>
          <p className="mt-2 text-base text-on-night-2">
            Toma un minuto y ayuda a otras personas a encontrar a {clinica}.
          </p>
          <a
            href={r.resenaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants(), "mt-5 h-12 rounded-full px-6 text-base")}
          >
            Dejar una reseña en Google
            <ExternalLink aria-hidden />
          </a>
        </section>
      )}
    </div>
  );
}
