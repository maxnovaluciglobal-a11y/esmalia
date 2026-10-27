import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  BellOff,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  Inbox,
  Loader2,
  Send,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { buttonVariants } from "@/components/ui/button";
import { requirePermission } from "@/lib/access/route-guards";
import { clasePastilla } from "@/lib/clinic-operations/estado-cita-tono";
import { MESSAGE_TEMPLATE_KIND_LABELS, type MessageTemplateKind } from "@/lib/messaging/messaging";
import {
  estadoOptIn,
  formatVentana,
  sinResponder,
  type ConversationMessage,
  type ConversationSummary,
} from "@/lib/messaging/conversations";
import { tiempoRelativo } from "@/lib/messaging/notifications";
import {
  listConversationThread,
  listConversations,
  replyToConversation,
} from "@/lib/messaging/conversations.functions";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";
import { fecha, fechaCortaHora } from "@/lib/formato-fecha";
import { useZonaClinica } from "@/hooks/use-zona-clinica";

export const Route = createFileRoute("/_authenticated/_clinic/conversaciones")({
  beforeLoad: requirePermission("agenda:manage"),
  validateSearch: (search: Record<string, unknown>) => ({
    paciente: typeof search.paciente === "string" ? search.paciente : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Conversaciones | Esmalia" },
      {
        name: "description",
        content:
          "Todos los mensajes de WhatsApp con tus pacientes en un solo hilo, con lo que quedó sin responder arriba.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConversacionesPage,
});

function ConversacionesPage() {
  const { access } = Route.useRouteContext();
  const { paciente: pacienteSeleccionado } = Route.useSearch();
  const navigate = Route.useNavigate();
  const clinicId = access.clinic?.id;
  const [soloSinResponder, setSoloSinResponder] = useState(false);

  const fetchConversations = useServerFn(listConversations);
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["conversations", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchConversations({ data: { clinicId: clinicId! } }),
    refetchInterval: 2 * 60_000,
  });

  const conversaciones = useMemo(() => data?.conversations ?? [], [data]);
  const pendientes = conversaciones.filter(sinResponder).length;
  const visibles = soloSinResponder ? conversaciones.filter(sinResponder) : conversaciones;

  function seleccionar(patientId: string | undefined) {
    void navigate({ search: { paciente: patientId }, replace: true });
  }

  // Título editorial A+: una parte en redonda y la otra en itálica ocre.
  const titular: [string, string] =
    isLoading || isError
      ? ["Tus", "conversaciones"]
      : conversaciones.length === 0
        ? ["Todavía no hay", "conversaciones"]
        : pendientes === 0
          ? ["Todo", "respondido"]
          : [
              `${pendientes} ${pendientes === 1 ? "conversación" : "conversaciones"}`,
              pendientes === 1 ? "espera respuesta" : "esperan respuesta",
            ];

  return (
    <AppShell title="Conversaciones" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-[18px]">
        {/* En celular, con un hilo abierto, la conversación es su propia
            pantalla: el encabezado y la lista se ocultan. */}
        <header
          className={cn(
            "flex flex-wrap items-end justify-between gap-x-7 gap-y-4 pb-1",
            pacienteSeleccionado && "hidden lg:flex",
          )}
        >
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-muted-foreground">
              <b className="font-semibold text-foreground/85">Mensajes</b>
              <span aria-hidden>·</span>
              <span>WhatsApp</span>
            </p>
            <h2 className="mt-2 font-display text-[clamp(2.25rem,3.6vw,3.5rem)] font-medium leading-none tracking-[-0.02em] text-balance [font-variant-numeric:lining-nums]">
              {titular[0]} <em className="text-brand-600">{titular[1]}</em>
            </h2>
            <p className="mt-3 max-w-prose text-[15px] text-muted-foreground">
              Un hilo por paciente. Queda <span className="text-warning">sin responder</span> cuando
              el último mensaje lo escribió el paciente.
            </p>
          </div>
          <div role="group" aria-label="Filtrar conversaciones" className="flex shrink-0 gap-1.5">
            <FiltroBoton activo={!soloSinResponder} onClick={() => setSoloSinResponder(false)}>
              Todas <span className="cifra text-xs opacity-80">{conversaciones.length}</span>
            </FiltroBoton>
            <FiltroBoton activo={soloSinResponder} onClick={() => setSoloSinResponder(true)}>
              <Clock aria-hidden className="size-3.5" />
              Sin responder <span className="cifra text-xs opacity-80">{pendientes}</span>
            </FiltroBoton>
          </div>
        </header>

        {data?.truncated && (
          <p
            className={cn(
              "flex items-start gap-2 rounded-[14px] border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning",
              pacienteSeleccionado && "hidden lg:flex",
            )}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Se están mostrando los 1.000 mensajes más recientes de la clínica. Las conversaciones
              más viejas siguen completas en la ficha de cada paciente.
            </span>
          </p>
        )}

        <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <section
            aria-label="Lista de conversaciones"
            className={cn("min-w-0", pacienteSeleccionado && "hidden lg:block")}
          >
            {isError ? (
              <ErrorDeCarga
                mensaje="No pudimos cargar las conversaciones. Revisa la conexión."
                onReintentar={() => void refetch()}
                reintentando={isFetching}
              />
            ) : (
              <ListaConversaciones
                conversaciones={visibles}
                cargando={isLoading}
                seleccionado={pacienteSeleccionado}
                onSeleccionar={seleccionar}
                vacioPorFiltro={soloSinResponder && conversaciones.length > 0}
                onVerTodas={() => setSoloSinResponder(false)}
              />
            )}
          </section>

          <div className={cn("min-w-0", !pacienteSeleccionado && "hidden lg:block")}>
            {pacienteSeleccionado && clinicId ? (
              <Hilo
                clinicId={clinicId}
                patientId={pacienteSeleccionado}
                onVolver={() => seleccionar(undefined)}
              />
            ) : (
              <div className="flex h-full min-h-[24rem] flex-col items-center justify-center gap-3 rounded-[14px] border border-dashed border-border p-8 text-center">
                <Inbox className="size-7 text-muted-foreground" aria-hidden />
                <p className="max-w-xs text-sm text-muted-foreground">
                  Elige una conversación de la lista para leerla y responder.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function FiltroBoton({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "inline-flex h-[34px] items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11",
        activo
          ? "border-foreground bg-foreground text-background"
          : "border-control text-foreground/80 hover:border-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ListaConversaciones({
  conversaciones,
  cargando,
  seleccionado,
  onSeleccionar,
  vacioPorFiltro,
  onVerTodas,
}: {
  conversaciones: ConversationSummary[];
  cargando: boolean;
  seleccionado: string | undefined;
  onSeleccionar: (id: string) => void;
  vacioPorFiltro: boolean;
  onVerTodas: () => void;
}) {
  if (cargando) {
    return (
      <p className="rounded-[14px] border border-hairline bg-card px-5 py-8 text-sm text-muted-foreground">
        Cargando conversaciones…
      </p>
    );
  }

  if (conversaciones.length === 0) {
    return (
      <div className="space-y-3 rounded-[14px] border border-hairline bg-card px-5 py-6">
        <p className="text-sm font-medium">
          {vacioPorFiltro ? "No queda nada sin responder." : "Todavía no hay conversaciones."}
        </p>
        <p className="text-sm text-muted-foreground">
          {vacioPorFiltro
            ? "Todos los hilos terminan con un mensaje de la clínica."
            : "Cuando un paciente escriba al WhatsApp de la clínica, o le mandes un recordatorio, el hilo aparece acá."}
        </p>
        {vacioPorFiltro ? (
          <button
            type="button"
            onClick={onVerTodas}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Ver todas
          </button>
        ) : (
          <Link to="/whatsapp" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Revisar la conexión de WhatsApp
          </Link>
        )}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-hairline overflow-hidden rounded-[14px] border border-hairline bg-card">
      {conversaciones.map((c) => {
        const pendiente = sinResponder(c);
        const activo = seleccionado === c.patientId;
        const deBaja = estadoOptIn(c) === "dado_de_baja";
        return (
          <li key={c.patientId}>
            <button
              type="button"
              onClick={() => onSeleccionar(c.patientId)}
              aria-current={activo ? "true" : undefined}
              className={cn(
                "flex w-full flex-col gap-1 px-4 py-3.5 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                activo ? "bg-brand-soft" : "hover:bg-muted/50",
              )}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span
                  className={cn(
                    "truncate font-display text-[19px] leading-tight",
                    pendiente || activo ? "font-semibold" : "font-medium",
                    activo && "text-brand-700",
                  )}
                >
                  {c.patientName}
                </span>
                <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                  {tiempoRelativo(c.lastMessageAt)}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {c.lastMessageDirection === "outbound" && (
                  <Check className="size-3.5 shrink-0" aria-label="Último mensaje de la clínica" />
                )}
                <span className="truncate">{c.lastMessageBody}</span>
              </span>
              {(pendiente || deBaja) && (
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {pendiente && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                        clasePastilla.warning,
                      )}
                    >
                      <Clock className="size-3" aria-hidden strokeWidth={2.4} />
                      {c.inboundStreak > 1
                        ? `${c.inboundStreak} mensajes sin responder`
                        : "Sin responder"}
                    </span>
                  )}
                  {deBaja && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                        clasePastilla.danger,
                      )}
                    >
                      <BellOff className="size-3" aria-hidden /> Pidió la baja
                    </span>
                  )}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Hilo({
  clinicId,
  patientId,
  onVolver,
}: {
  clinicId: string;
  patientId: string;
  onVolver: () => void;
}) {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const finRef = useRef<HTMLDivElement>(null);

  const fetchThread = useServerFn(listConversationThread);
  const {
    data: hilo,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["conversation-thread", clinicId, patientId],
    queryFn: () => fetchThread({ data: { clinicId, patientId } }),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [hilo?.messages.length]);

  const responder = useServerFn(replyToConversation);
  const mutation = useMutation({
    mutationFn: (body: string) => responder({ data: { clinicId, patientId, body } }),
    onSuccess: (res) => {
      setTexto("");
      if (res.via === "api") {
        toast.success("Respuesta enviada por WhatsApp.");
      } else if (res.waMeUrl) {
        window.open(res.waMeUrl, "_blank", "noopener,noreferrer");
        toast.success("Se abrió WhatsApp con el mensaje listo para enviar.");
      }
      void queryClient.invalidateQueries({
        queryKey: ["conversation-thread", clinicId, patientId],
      });
      void queryClient.invalidateQueries({ queryKey: ["conversations", clinicId] });
      void queryClient.invalidateQueries({ queryKey: ["conversations-pendientes", clinicId] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const volver = (
    <button
      type="button"
      onClick={onVolver}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 lg:hidden")}
    >
      <ArrowLeft aria-hidden /> Conversaciones
    </button>
  );

  if (isError) {
    return (
      <div className="space-y-3">
        {volver}
        <ErrorDeCarga
          mensaje="No pudimos cargar esta conversación. Revisa la conexión."
          onReintentar={() => void refetch()}
          reintentando={isFetching}
        />
      </div>
    );
  }

  if (isLoading || !hilo) {
    return (
      <div className="space-y-3">
        {volver}
        <p className="rounded-[14px] border border-hairline bg-card px-5 py-8 text-sm text-muted-foreground">
          Cargando conversación…
        </p>
      </div>
    );
  }

  const ventanaAbierta = hilo.ventanaMinutos > 0;
  const enviaPorApi = ventanaAbierta && hilo.apiConectada;

  return (
    <div className="space-y-3">
      {volver}
      <section
        aria-label={`Conversación con ${hilo.patientName}`}
        className="flex flex-col overflow-hidden rounded-[14px] border border-hairline bg-card"
      >
        <header className="flex items-center gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-[28px] font-medium leading-none">
              {hilo.patientName}
            </h3>
            <p className="mt-1 truncate text-sm text-muted-foreground cifra">
              {hilo.patientPhone ?? "Sin teléfono en la ficha"}
            </p>
          </div>
          <Link
            to="/pacientes/$pacienteId"
            params={{ pacienteId: patientId }}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "shrink-0 rounded-full",
            )}
          >
            <User aria-hidden /> Ficha
          </Link>
        </header>

        {estadoOptIn(hilo) === "dado_de_baja" && (
          <p className="flex items-start gap-2 border-b border-destructive-border bg-destructive-soft px-4 py-3 text-sm text-destructive">
            <BellOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Este paciente pidió la baja
              {hilo.waOptOutAt && ` el ${fecha(hilo.waOptOutAt)}`}. No recibe recordatorios
              automáticos. Responder a mano a algo que él mismo escribió está bien; volver a
              incluirlo en envíos masivos, no.
            </span>
          </p>
        )}
        {estadoOptIn(hilo) === "sin_opt_in" && (
          <p className="flex items-start gap-2 border-b border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning">
            <BellOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Todavía no dio consentimiento para recibir mensajes automáticos — no es lo mismo que
              haber pedido la baja. Puedes contestarle lo que él mismo escribió; para incluirlo en
              recordatorios, primero activa el opt-in desde su ficha.
            </span>
          </p>
        )}

        <div className="max-h-[60dvh] flex-1 space-y-3 overflow-y-auto bg-background/60 px-5 py-5 lg:max-h-[32rem]">
          {hilo.messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay mensajes en este hilo todavía. Lo que escribas abajo será el primero.
            </p>
          )}
          {hilo.messages.map((m) => (
            <Burbuja key={m.id} mensaje={m} />
          ))}
          <div ref={finRef} />
        </div>

        <footer className="space-y-2.5 border-t border-hairline px-5 py-4">
          <p
            className={cn(
              "flex items-start gap-1.5 text-sm",
              enviaPorApi ? "text-success" : "text-muted-foreground",
            )}
          >
            <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {enviaPorApi ? (
                <>
                  Ventana de respuesta abierta ({formatVentana(hilo.ventanaMinutos)}). Se envía
                  directo, sin salir de Esmalia.
                </>
              ) : ventanaAbierta ? (
                <>
                  Ventana abierta ({formatVentana(hilo.ventanaMinutos)}), pero todavía no hay un
                  número conectado a la API: se abre WhatsApp con el texto listo.
                </>
              ) : (
                <>
                  Pasaron más de 24 h desde el último mensaje del paciente: WhatsApp no deja
                  responder texto libre por la API. Se abre WhatsApp con el texto listo.
                </>
              )}
            </span>
          </p>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const limpio = texto.trim();
              if (!limpio || mutation.isPending) return;
              mutation.mutate(limpio);
            }}
          >
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              maxLength={4096}
              placeholder="Escribe tu respuesta…"
              aria-label="Respuesta al paciente"
              className="min-h-[2.75rem] flex-1 resize-y rounded-lg border border-input bg-card p-2.5 text-sm outline-none pointer-coarse:text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <button
              type="submit"
              disabled={!texto.trim() || mutation.isPending}
              className={cn(
                buttonVariants({ variant: enviaPorApi ? "default" : "outline" }),
                "h-11 shrink-0 rounded-full px-4",
              )}
            >
              {mutation.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : enviaPorApi ? (
                <Send aria-hidden />
              ) : (
                <ExternalLink aria-hidden />
              )}
              {enviaPorApi ? "Enviar" : "Abrir WhatsApp"}
            </button>
          </form>
        </footer>
      </section>
    </div>
  );
}

function Burbuja({ mensaje: m }: { mensaje: ConversationMessage }) {
  const zona = useZonaClinica();
  const entrante = m.direction === "inbound";
  const etiqueta =
    m.templateKind && m.templateKind in MESSAGE_TEMPLATE_KIND_LABELS
      ? MESSAGE_TEMPLATE_KIND_LABELS[m.templateKind as MessageTemplateKind]
      : null;

  return (
    <div className={cn("flex", entrante ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-[14px] px-3.5 py-2.5",
          entrante
            ? "rounded-bl-[4px] border border-hairline bg-card text-foreground"
            : "rounded-br-[4px] border border-hairline bg-brand-soft text-foreground",
        )}
      >
        {etiqueta && <p className="mb-1 text-xs font-semibold text-muted-foreground">{etiqueta}</p>}
        <p className="whitespace-pre-wrap text-[15px]">{m.body}</p>
        <p className="mt-1 flex items-center justify-end gap-1 text-[11.5px] text-muted-foreground cifra">
          {fechaCortaHora(m.createdAt, zona)}
          {!entrante && m.status === "read" && (
            <CheckCheck className="size-3.5 text-info" aria-label="Leído" />
          )}
          {!entrante && m.status === "delivered" && (
            <CheckCheck className="size-3.5" aria-label="Entregado" />
          )}
          {!entrante && m.status === "sent" && <Check className="size-3.5" aria-label="Enviado" />}
          {!entrante && m.status === "failed" && (
            <AlertTriangle className="size-3.5 text-destructive" aria-label="No se pudo enviar" />
          )}
        </p>
        {m.error && <p className="mt-1 text-xs text-destructive">{m.error}</p>}
      </div>
    </div>
  );
}
