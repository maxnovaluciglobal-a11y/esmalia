import { useEffect, useId, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { AppShell } from "@/components/app-shell";
import { CLASE_CAMPO, GrupoDeChips } from "@/components/cita-formulario";
import { ErrorDeCarga } from "@/components/estado-error";
import { ResumenNpsEnTinta } from "@/components/notificaciones/resumen-nps";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { requirePermission } from "@/lib/access/route-guards";
import { clasePastilla } from "@/lib/clinic-operations/estado-cita-tono";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import {
  getNotificacionesPacientes,
  guardarNotificacionesPacientes,
  type PantallaNotificaciones,
} from "@/lib/notificaciones-pacientes/notificaciones.functions";
import {
  etiquetaHoras,
  GuardarConfigSchema,
  HORAS_ENCUESTA_SUGERIDAS,
  HORAS_RECORDATORIO_SUGERIDAS,
  MAX_FRANJAS_RECORDATORIO,
  MOTIVO_WHATSAPP_AUTOMATICO,
  type ModoFormulario,
} from "@/lib/notificaciones-pacientes/reglas";
import { cn } from "@/lib/utils";

/**
 * Notificaciones a pacientes (Ola 7 · frente B):
 *
 * - REC-07: encender o apagar cada correo automático (confirmación al
 *   agendar, recordatorio y sus horas, formulario antes de la cita y encuesta
 *   después), con el link de reseña de Google.
 * - REC-09: WhatsApp automático deshabilitado con su motivo visible.
 * - MKT-08: resumen NPS y los últimos comentarios.
 *
 * Solo owner y admin (`settings:manage`), igual que el servidor y la RLS.
 */
export const Route = createFileRoute("/_authenticated/_clinic/notificaciones-a-pacientes")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Notificaciones a pacientes | Esmalia" },
      {
        name: "description",
        content:
          "Correos automáticos a pacientes: confirmación, recordatorio, formulario antes de la cita y encuesta de satisfacción.",
      },
    ],
  }),
  component: NotificacionesPage,
});

const PANEL = "rounded-[14px] border border-hairline bg-card";

function NotificacionesPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const zona = access.clinic?.timezone ?? "America/Santiago";
  const cargar = useServerFn(getNotificacionesPacientes);
  const consulta = useQuery({
    queryKey: ["notificaciones-pacientes", clinicId],
    queryFn: () => cargar({ data: { clinicId: clinicId as string } }),
    enabled: Boolean(clinicId),
  });

  return (
    <AppShell title="Notificaciones a pacientes" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-x-7 gap-y-4 pb-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-muted-foreground">
              <b className="font-semibold text-foreground/85">Ajustes</b>
              <span aria-hidden>·</span>
              <span>Mensajería</span>
            </p>
            <h2 className="mt-2 font-display text-[clamp(2.25rem,3.6vw,3.5rem)] font-medium leading-none tracking-[-0.02em] text-balance">
              Correos a <em className="text-brand-600">pacientes</em>
            </h2>
            <p className="mt-3 max-w-2xl text-base text-muted-foreground">
              Esmalia los manda solos, a la hora que corresponde y en el horario de la clínica (8:00
              a 21:00). WhatsApp sigue saliendo a mano desde Recordatorios.
            </p>
          </div>
          {consulta.data && <PastillaModo modo={consulta.data.modoCorreo} />}
        </header>

        {consulta.isPending && (
          <p className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
          </p>
        )}
        {consulta.isError && (
          <ErrorDeCarga
            onReintentar={() => consulta.refetch()}
            reintentando={consulta.isFetching}
            mensaje={mensajeDeError(consulta.error)}
          />
        )}
        {consulta.data && clinicId && (
          <Contenido clinicId={clinicId} zona={zona} datos={consulta.data} />
        )}
      </div>
    </AppShell>
  );
}

function PastillaModo({ modo }: { modo: PantallaNotificaciones["modoCorreo"] }) {
  return (
    <span
      className={cn(
        "inline-flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap",
        clasePastilla[modo === "production" ? "success" : "warning"],
      )}
    >
      <Mail className="size-3.5" aria-hidden />
      {modo === "production" ? "Correo en envío real" : "Correo en modo de prueba"}
    </span>
  );
}

function Contenido({
  clinicId,
  zona,
  datos,
}: {
  clinicId: string;
  zona: string;
  datos: PantallaNotificaciones;
}) {
  return (
    <div className="space-y-8">
      {!datos.envioGlobalEncendido && (
        <div className="rounded-[14px] border border-warning-border bg-warning-soft p-4 text-sm text-warning">
          Los correos automáticos a pacientes todavía no están habilitados en tu cuenta. Puedes
          dejarlos configurados: empiezan a salir apenas se habiliten.
        </div>
      )}
      {datos.modoCorreo === "sandbox" && (
        <div className={cn(PANEL, "flex items-start gap-3 p-4 text-sm")}>
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
          <p>
            Tu correo está en <b>modo de prueba</b>: ningún paciente real recibe nada, los correos
            se bloquean o llegan a tu casilla de pruebas. Cuando quieras que salgan, cambia el modo
            en{" "}
            <Link to="/sandbox-email" className="font-medium text-brand-700 underline">
              Modo prueba de email
            </Link>
            .
          </p>
        </div>
      )}

      <ResumenNpsEnTinta
        nps={datos.nps}
        envios={datos.envios}
        diasResumen={datos.diasResumen}
        diasEnvios={datos.diasEnvios}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Formulario clinicId={clinicId} datos={datos} />
        <div className="space-y-8">
          <Canales />
          <Comentarios datos={datos} zona={zona} />
        </div>
      </div>
    </div>
  );
}

// ─── Formulario de configuración ─────────────────────────────────────────

function Interruptor({
  id,
  encendido,
  onChange,
  etiqueta,
  disabled,
}: {
  id: string;
  encendido: boolean;
  onChange: (v: boolean) => void;
  etiqueta: string;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={encendido}
      aria-label={etiqueta}
      disabled={disabled}
      onClick={() => onChange(!encendido)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-50",
        encendido ? "border-brand-700 bg-brand-700" : "border-hairline bg-muted",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block size-5 rounded-full bg-card shadow-sm transition-transform",
          encendido ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

function Bloque({
  titulo,
  detalle,
  control,
  children,
}: {
  titulo: string;
  detalle: string;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-3 border-b border-hairline py-5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-display text-xl font-semibold leading-tight">{titulo}</p>
          <p className="mt-1 text-sm text-muted-foreground">{detalle}</p>
        </div>
        {control}
      </div>
      {children}
    </div>
  );
}

function ChipsMultiples({
  etiqueta,
  opciones,
  valores,
  max,
  onChange,
  disabled,
}: {
  etiqueta: string;
  opciones: readonly number[];
  valores: number[];
  max: number;
  onChange: (v: number[]) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={etiqueta} className="flex flex-wrap gap-1.5">
      {opciones.map((h) => {
        const activo = valores.includes(h);
        const lleno = !activo && valores.length >= max;
        return (
          <button
            key={h}
            type="button"
            aria-pressed={activo}
            disabled={disabled || lleno}
            onClick={() =>
              onChange(activo ? valores.filter((v) => v !== h) : [...valores, h].slice(-max))
            }
            className={cn(
              "inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:px-4 pointer-coarse:text-sm",
              activo
                ? "border-brand-700 bg-brand-soft text-brand-700"
                : "border-hairline text-muted-foreground hover:border-brand-300 hover:text-foreground",
            )}
          >
            {etiquetaHoras(h)} antes
          </button>
        );
      })}
    </div>
  );
}

function Formulario({ clinicId, datos }: { clinicId: string; datos: PantallaNotificaciones }) {
  const fid = useId();
  const c = datos.config;
  const [confirmacion, setConfirmacion] = useState(c.confirmacion);
  const [recordatorio, setRecordatorio] = useState(c.recordatorio);
  const [horas, setHoras] = useState<number[]>(c.horasRecordatorio);
  const [formulario, setFormulario] = useState<ModoFormulario>(c.formulario);
  const [encuesta, setEncuesta] = useState(c.encuesta);
  const [horasEncuesta, setHorasEncuesta] = useState(c.horasEncuesta);
  const [resena, setResena] = useState(c.resenaGoogleUrl ?? "");

  useEffect(() => {
    setConfirmacion(c.confirmacion);
    setRecordatorio(c.recordatorio);
    setHoras(c.horasRecordatorio);
    setFormulario(c.formulario);
    setEncuesta(c.encuesta);
    setHorasEncuesta(c.horasEncuesta);
    setResena(c.resenaGoogleUrl ?? "");
  }, [c]);

  const entrada = {
    clinicId,
    confirmacion,
    recordatorio,
    horasRecordatorio: horas,
    formulario,
    encuesta,
    horasEncuesta,
    resenaGoogleUrl: resena,
  };
  const validacion = GuardarConfigSchema.safeParse(entrada);
  const problema = validacion.success ? null : (validacion.error.issues[0]?.message ?? null);

  const queryClient = useQueryClient();
  const guardarFn = useServerFn(guardarNotificacionesPacientes);
  const guardar = useMutation({
    mutationFn: () => guardarFn({ data: entrada }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notificaciones-pacientes", clinicId] });
      toast.success("Notificaciones guardadas.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const horasSugeridas = [...new Set([...HORAS_RECORDATORIO_SUGERIDAS, ...horas])].sort(
    (a, b) => a - b,
  );
  const encuestaSugeridas = [...new Set([...HORAS_ENCUESTA_SUGERIDAS, horasEncuesta])].sort(
    (a, b) => a - b,
  );

  return (
    <section aria-labelledby={`${fid}-titulo`} className="space-y-4">
      <div>
        <h3 id={`${fid}-titulo`} className="kicker">
          Qué correo sale y cuándo
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Siempre se respeta el modo de prueba, la baja de cada paciente y, si es menor de edad, el
          correo va a su tutor. Cada correo trae su enlace de baja.
        </p>
      </div>

      <div className={cn(PANEL, "p-4 md:p-6")}>
        <Bloque
          titulo="Confirmación al agendar"
          detalle="Cuando se crea una cita futura (en la agenda o por otra vía), el paciente recibe el día, la hora, el profesional y la dirección."
          control={
            <Interruptor
              id={`${fid}-confirmacion`}
              etiqueta="Confirmación al agendar"
              encendido={confirmacion}
              onChange={setConfirmacion}
            />
          }
        >
          <p className="text-xs text-muted-foreground">
            Solo para citas creadas después de encenderla. Las citas importadas no la reciben, salvo
            que el lote se haya importado con recordatorios.
          </p>
        </Bloque>

        <Bloque
          titulo="Recordatorio antes de la cita"
          detalle={`Hasta ${MAX_FRANJAS_RECORDATORIO} recordatorios por cita. Si la cita se creó adentro de esa ventana, ese recordatorio no sale: la confirmación ya le avisó.`}
          control={
            <Interruptor
              id={`${fid}-recordatorio`}
              etiqueta="Recordatorio antes de la cita"
              encendido={recordatorio}
              onChange={setRecordatorio}
            />
          }
        >
          <ChipsMultiples
            etiqueta="Horas antes de la cita"
            opciones={horasSugeridas}
            valores={horas}
            max={MAX_FRANJAS_RECORDATORIO}
            onChange={setHoras}
            disabled={!recordatorio}
          />
          <p className="text-xs text-muted-foreground">
            Fuera del horario de 8:00 a 21:00 no se escribe: un recordatorio que cae de noche sale a
            las 8:00, si todavía llega a tiempo.
          </p>
        </Bloque>

        <Bloque
          titulo="Formulario antes de la cita"
          detalle="Un link para que el paciente actualice sus datos de contacto y responda el cuestionario de salud. Lo que envía queda pendiente de revisión en la ficha: no cambia nada hasta que alguien del equipo clínico lo acepta."
        >
          <GrupoDeChips
            id={`${fid}-formulario`}
            etiqueta="Formulario antes de la cita"
            opciones={[
              { value: "off", label: "No enviar" },
              { value: "confirmation", label: "En la confirmación" },
              { value: "reminder", label: "En el recordatorio" },
            ]}
            value={formulario}
            onChange={(v) => v && setFormulario(v as ModoFormulario)}
          />
        </Bloque>

        <Bloque
          titulo="Encuesta después de la cita"
          detalle="Cuando la cita queda como atendida, una pregunta de 0 a 10 y un comentario. A quien pone 9 o 10 se le ofrece dejar una reseña en Google."
          control={
            <Interruptor
              id={`${fid}-encuesta`}
              etiqueta="Encuesta después de la cita"
              encendido={encuesta}
              onChange={setEncuesta}
            />
          }
        >
          <div className="space-y-1.5">
            <p className="text-sm font-medium leading-none">Cuándo se manda</p>
            <GrupoDeChips
              id={`${fid}-horas-encuesta`}
              etiqueta="Horas después de la cita"
              opciones={encuestaSugeridas.map((h) => ({
                value: String(h),
                label: `${etiquetaHoras(h)} después`,
              }))}
              value={String(horasEncuesta)}
              onChange={(v) => v && setHorasEncuesta(Number(v))}
            />
            <p className="text-xs text-muted-foreground">
              Un paciente recibe como mucho una encuesta cada 30 días.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-resena`}>Link de reseña de Google</Label>
            <input
              id={`${fid}-resena`}
              type="url"
              inputMode="url"
              placeholder={datos.resenaDeSucursal ?? "https://g.page/r/…/review"}
              value={resena}
              onChange={(e) => setResena(e.target.value)}
              className={CLASE_CAMPO}
            />
            <p className="text-xs text-muted-foreground">
              {datos.resenaDeSucursal
                ? "Si lo dejas vacío, se usa el de la sucursal de la cita (Sucursales)."
                : "Sin link, a los promotores solo se les agradece: no se les pide la reseña."}
            </p>
          </div>
        </Bloque>

        <div className="flex justify-end pt-5">
          <BloqueoEscritura otroMotivo={problema}>
            <Button
              className="h-10 rounded-full px-5"
              onClick={() => guardar.mutate()}
              disabled={guardar.isPending || Boolean(problema)}
            >
              {guardar.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Guardar cambios
            </Button>
          </BloqueoEscritura>
        </div>
      </div>
    </section>
  );
}

// ─── Canales (REC-09) ────────────────────────────────────────────────────

function Canales() {
  const fid = useId();
  return (
    <section aria-labelledby={`${fid}-titulo`} className="space-y-4">
      <h3 id={`${fid}-titulo`} className="kicker">
        Canales
      </h3>
      <ul className={cn(PANEL, "divide-y divide-hairline")}>
        <li className="flex items-center justify-between gap-4 p-4">
          <span className="flex min-w-0 items-center gap-3">
            <Mail className="size-5 shrink-0 text-brand-700" aria-hidden />
            <span>
              <span className="block font-medium">Correo</span>
              <span className="block text-sm text-muted-foreground">Automático</span>
            </span>
          </span>
          <span
            className={cn(
              "inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold",
              clasePastilla.success,
            )}
          >
            Disponible
          </span>
        </li>
        <li className="flex flex-wrap items-start justify-between gap-4 p-4">
          <span className="flex min-w-0 items-center gap-3">
            <MessageCircle className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              <span className="block font-medium">WhatsApp automático</span>
              <span className="block text-sm text-muted-foreground">No disponible todavía</span>
            </span>
          </span>
          <AccionDeshabilitada motivo={MOTIVO_WHATSAPP_AUTOMATICO}>
            <Button variant="outline" className="h-9 rounded-full px-4">
              Activar
            </Button>
          </AccionDeshabilitada>
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">
        Los recordatorios por WhatsApp se mandan con un clic desde{" "}
        <Link to="/recordatorios" className="font-medium text-brand-700 underline">
          Recordatorios
        </Link>
        .
      </p>
    </section>
  );
}

// ─── Comentarios de la encuesta ──────────────────────────────────────────

function Comentarios({ datos, zona }: { datos: PantallaNotificaciones; zona: string }) {
  const fid = useId();
  return (
    <section aria-labelledby={`${fid}-titulo`} className="space-y-4">
      <h3 id={`${fid}-titulo`} className="kicker">
        Últimos comentarios
      </h3>
      {datos.comentarios.length === 0 ? (
        <p className={cn(PANEL, "p-4 text-sm text-muted-foreground")}>
          Todavía no hay comentarios. Aparecen acá cuando un paciente responde la encuesta y deja
          unas palabras.
        </p>
      ) : (
        <ul className={cn(PANEL, "divide-y divide-hairline")}>
          {datos.comentarios.map((c, i) => (
            <li key={i} className="space-y-1 p-4">
              <p className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="cifra rounded-full border border-hairline px-2 py-0.5 text-foreground">
                  {c.nota}/10
                </span>
                <span>{fecha(c.respondidoEl, zona)}</span>
              </p>
              <p className="text-sm leading-relaxed">{c.comentario}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
