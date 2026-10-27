import { createContext, useContext, type ReactNode, type Ref } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowUpRight, Check, Circle, Globe, Loader2 } from "lucide-react";

import { AvisoDeChoques } from "@/components/agenda-grid";
import { ChipEstado } from "@/components/agenda-estado";
import { telefonoEnmascarado } from "@/components/agenda-titulo";
import { boxEfectivo, nombreBoxDe, type Conflicto } from "@/components/agenda-conflictos";
import { rangoHorarioCita } from "@/components/cita-acciones";
import { PatientConfirmedBadge } from "@/components/patient-confirmed-badge";
import { PattyCara } from "@/components/patty-cara";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { buttonVariants } from "@/components/ui/button";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { useOfflineMutation } from "@/hooks/use-offline-mutation";
import { esMovible } from "@/components/agenda-movimiento";
import {
  getAlertasClinicasDeCita,
  getResumenFinancieroDeCita,
} from "@/lib/clinic-operations/cajon-cita.functions";
import { setAppointmentStatus } from "@/lib/clinic-operations/appointments.functions";
import { horaDeMinutos } from "@/components/agenda-hueco";
import {
  formatoFechaLarga,
  type Cita,
  type EstadoCita,
  type Paciente,
  type Profesional,
} from "@/lib/clinic-operations/clinic-data";
import { colorProfesional } from "@/lib/clinic-operations/color-profesional";
import { getEstadoIa } from "@/lib/ai/estado.functions";
import { formatMoney } from "@/lib/finance/finance";
import { diaSemana, fechaCortaHora } from "@/lib/formato-fecha";
import { listMessages } from "@/lib/messaging/messaging.functions";
import { textoPrevision } from "@/lib/patients/datos-ficha";
import { cn } from "@/lib/utils";

/**
 * Lo que el cajón de la cita necesita de la página de la agenda: ids,
 * permisos y las acciones que viven arriba (Mover a…). Va por contexto para
 * no pasarlo por las tres grillas (día, semana, box).
 */
export interface ContextoCajonCita {
  clinicId: string;
  userId: string;
  clinicName?: string;
  currency: string;
  zona?: string;
  /** Hoy en el huso de la clínica. */
  hoy: string;
  puedeGestionar: boolean;
  puedeVerFinanzas: boolean;
  puedeVerClinico: boolean;
  puedeConfirmar: (profesionalId: string) => boolean;
  paciente: (id: string) => Paciente | undefined;
  nombreBox: (id: string) => string | undefined;
  onReagendar: (cita: Cita) => void;
}

const Contexto = createContext<ContextoCajonCita | null>(null);

export function ProveedorCajonCita({
  valor,
  children,
}: {
  valor: ContextoCajonCita;
  children: ReactNode;
}) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useContextoCajonCita() {
  return useContext(Contexto);
}

const ESTADOS_ENVIADO = new Set(["queued", "sent", "delivered", "read"]);

/** Botón grande del cajón (2 × 2, como el prototipo). */
const claseAccion = (primaria = false) =>
  cn(
    buttonVariants({ variant: primaria ? "default" : "outline" }),
    "h-10 w-full rounded-full px-3 text-[13.5px] font-semibold",
    primaria && "bg-foreground text-background hover:bg-foreground/85",
  );

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="border-t border-border py-3.5">
      <h3 className="mb-2.5 font-sans text-xs font-semibold text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

/**
 * Contenido del cajón de la cita (A+): fecha y box en mono, el nombre en
 * Cormorant, el estado, los datos del paciente, las alertas clínicas en rojo,
 * los recordatorios por WhatsApp (asistidos: nada sale solo), el plan de
 * tratamiento con su saldo, las cuatro acciones grandes y Patty en
 * habilitación. Todo lo que no tiene datos en la base no se muestra.
 */
export function CajonCita({
  ctx,
  cita: c,
  profesional: p,
  allergies,
  conflictos,
  nombreProfesional,
  renderAcciones,
  refTitulo,
}: {
  ctx: ContextoCajonCita;
  cita: Cita;
  profesional: Profesional;
  allergies: string[] | undefined;
  conflictos?: Conflicto[];
  nombreProfesional?: (id: string) => string;
  renderAcciones?: (cita: Cita, profesional: Profesional) => ReactNode;
  refTitulo: Ref<HTMLHeadingElement>;
}) {
  const paciente = ctx.paciente(c.pacienteId);
  const box = boxEfectivo(c, p, ctx.nombreBox);
  const telefono = telefonoEnmascarado(paciente?.telefono);
  const prevision = paciente?.prevision
    ? textoPrevision({
        plan: paciente.prevision,
        tramo: paciente.previsionTramo ?? null,
        institucion: paciente.previsionInstitucion ?? null,
      })
    : (paciente?.convenioNombre ?? null);
  const datosPaciente = [
    paciente && paciente.fechaNacimiento ? `${paciente.edad} años` : null,
    telefono,
  ]
    .filter(Boolean)
    .join(" · ");

  // ── Alertas clínicas (gate clinical:view; RLS repite) ──
  const fetchAlertas = useServerFn(getAlertasClinicasDeCita);
  const { data: alertas } = useQuery({
    queryKey: ["alertas-cita", ctx.clinicId, c.pacienteId],
    enabled: ctx.puedeVerClinico,
    staleTime: 60_000,
    queryFn: () => fetchAlertas({ data: { clinicId: ctx.clinicId, patientId: c.pacienteId } }),
  });
  // Mientras llegan (o sin permiso clínico) quedan las alergias que la
  // agenda ya tenía cargadas.
  const textosAlerta =
    alertas?.map((a) => a.texto) ?? (allergies?.length ? [`Alergia: ${allergies.join(", ")}`] : []);

  // ── Plan y saldo (gate finance:view; requireFinanceViewRole en el servidor) ──
  const fetchResumen = useServerFn(getResumenFinancieroDeCita);
  const { data: resumen } = useQuery({
    queryKey: ["resumen-financiero-cita", ctx.clinicId, c.pacienteId],
    enabled: ctx.puedeVerFinanzas,
    staleTime: 60_000,
    queryFn: () => fetchResumen({ data: { clinicId: ctx.clinicId, patientId: c.pacienteId } }),
  });

  // ── Recordatorios de esta cita (misma clave que el historial de la ficha) ──
  const fetchMensajes = useServerFn(listMessages);
  const { data: mensajes } = useQuery({
    queryKey: ["messages", ctx.clinicId, c.pacienteId],
    enabled: ctx.puedeGestionar,
    queryFn: () => fetchMensajes({ data: { clinicId: ctx.clinicId, patientId: c.pacienteId } }),
  });

  const fetchEstadoIa = useServerFn(getEstadoIa);
  const { data: estadoIa } = useQuery({
    queryKey: ["estado-ia"],
    queryFn: () => fetchEstadoIa(),
    staleTime: 5 * 60_000,
  });

  const setEstadoFn = useServerFn(setAppointmentStatus);
  const cambiar = useOfflineMutation({
    kind: "cambiar-estado-cita",
    userId: ctx.userId,
    ejecutar: (payload) => setEstadoFn({ data: payload }),
    invalidar: [["appointments", ctx.clinicId]],
    resumen: (x) => `Cita → ${String(x.estado)}`,
    identidad: (x) => String(x.appointmentId),
  });
  const marcar = (estado: EstadoCita) => void cambiar.mutar({ appointmentId: c.id, estado });

  const futura = c.fecha >= ctx.hoy && (c.estado === "tentativa" || c.estado === "confirmada");
  const variables = {
    tratamiento: c.tratamiento,
    fecha_larga: formatoFechaLarga(c.fecha),
    hora: horaDeMinutos(c.inicio),
    profesional: p.nombre,
    clinica: ctx.clinicName ?? "",
  };
  const avisos: { kind: "appointment_reminder" | "appointment_checkin"; titulo: string }[] = [
    { kind: "appointment_reminder", titulo: "Aviso de 48 h" },
    { kind: "appointment_checkin", titulo: "Aviso de 3 h" },
  ];

  // Acción principal según el estado: llega → en sala → finalizada.
  const principal: { etiqueta: string; estado: EstadoCita } | null =
    c.estado === "tentativa" || c.estado === "confirmada"
      ? { etiqueta: "Pasar a sala", estado: "en-sala" }
      : c.estado === "en-sala"
        ? { etiqueta: "Marcar finalizada", estado: "finalizada" }
        : null;
  const puedeAusente = c.estado === "tentativa" || c.estado === "confirmada";

  return (
    <div className="space-y-0">
      <p className="flex justify-between gap-3 pr-11 cifra text-[12.5px] text-muted-foreground">
        <span>
          {diaSemana(c.fecha)} · {rangoHorarioCita(c)}
        </span>
        <span className="truncate">{box?.nombre ?? "Sin box"}</span>
      </p>
      <h2
        id="agenda-panel-titulo"
        ref={refTitulo}
        tabIndex={-1}
        className="mt-2.5 flex items-start gap-2 rounded-sm font-display text-[34px] font-medium leading-none tracking-[-0.01em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="min-w-0 break-words">{c.paciente}</span>
      </h2>
      <p className="mt-1.5 text-[15px] font-semibold">{c.tratamiento || "Sin tratamiento"}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <ChipEstado estado={c.estado} />
        {c.pacienteConfirmo && !ctx.puedeGestionar && <PatientConfirmedBadge />}
        {c.reservaEnLinea && (
          <span className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 text-xs font-semibold leading-none text-muted-foreground">
            <Globe aria-hidden strokeWidth={2.4} className="size-3 shrink-0" />
            Reserva en línea
          </span>
        )}
      </div>

      <dl className="my-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 text-[13.5px]">
        <dt className="font-medium text-muted-foreground">Profesional</dt>
        <dd className="flex min-w-0 items-center gap-1.5 font-medium">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: colorProfesional(p.color) }}
          />
          <span className="truncate">{p.nombre}</span>
        </dd>
        {datosPaciente && (
          <>
            <dt className="font-medium text-muted-foreground">Paciente</dt>
            <dd className="cifra-mixta font-medium">{datosPaciente}</dd>
          </>
        )}
        {prevision && (
          <>
            <dt className="font-medium text-muted-foreground">Previsión</dt>
            <dd className="font-medium">{prevision}</dd>
          </>
        )}
        <dt className="font-medium text-muted-foreground">Duración</dt>
        <dd className="font-medium">
          <span className="cifra">{c.duracion}</span> min
        </dd>
      </dl>

      {textosAlerta.length > 0 && (
        <div
          role="note"
          aria-label="Alertas clínicas"
          className="mb-3.5 flex items-start gap-2 rounded-[10px] border border-destructive bg-destructive-soft px-3 py-2.5 text-[13px] font-semibold leading-snug text-destructive"
        >
          <AlertTriangle aria-hidden className="mt-px size-4 shrink-0" />
          <ul className="space-y-0.5">
            {textosAlerta.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {conflictos && conflictos.length > 0 && (
        <div className="mb-3.5">
          <AvisoDeChoques
            conflictos={conflictos}
            nombreProfesional={nombreProfesional ?? (() => "otro profesional")}
            box={nombreBoxDe(c, p)}
            titulo="Choque de horario"
          />
        </div>
      )}

      {ctx.puedeGestionar && (
        <Seccion titulo="Recordatorios por WhatsApp">
          <ul className="relative grid gap-2.5 before:absolute before:bottom-2 before:left-[6px] before:top-2 before:w-px before:bg-border">
            {avisos.map((a) => {
              const enviado = mensajes?.find(
                (m) =>
                  m.appointmentId === c.id &&
                  m.direction === "outbound" &&
                  m.templateKind === a.kind &&
                  ESTADOS_ENVIADO.has(m.status),
              );
              return (
                <li
                  key={a.kind}
                  className="relative grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-2.5 text-[13.5px]"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-[3px] size-[13px] rounded-full border-[1.5px] bg-card",
                      enviado ? "border-success bg-success" : "border-dashed border-warning",
                    )}
                  />
                  <div className="min-w-0">
                    {a.titulo}
                    <small className="block text-xs font-medium text-muted-foreground">
                      {enviado
                        ? `Enviado · ${fechaCortaHora(enviado.sentAt ?? enviado.createdAt, ctx.zona)}`
                        : mensajes === undefined
                          ? "Revisando…"
                          : futura
                            ? "Sin enviar"
                            : "No se envió"}
                    </small>
                  </div>
                  {!enviado && futura && mensajes !== undefined && ctx.clinicName ? (
                    <WhatsAppButton
                      variant="full"
                      label="Enviar"
                      className="h-[30px] rounded-full border-transparent bg-foreground px-3 text-xs font-semibold text-background hover:border-transparent hover:bg-foreground/85 hover:text-background"
                      clinicId={ctx.clinicId}
                      patientId={c.pacienteId}
                      appointmentId={c.id}
                      templateKind={a.kind}
                      variables={variables}
                    />
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
          {c.pacienteConfirmo && (
            <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-[9px] rounded-bl-sm bg-success-soft px-2.5 py-1 text-[12.5px] font-medium text-success">
              <Check aria-hidden className="size-3.5" /> El paciente avisó que viene
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Nada sale solo: cada aviso se abre en WhatsApp con un toque.
          </p>
        </Seccion>
      )}

      {ctx.puedeVerFinanzas && resumen && (resumen.plan || resumen.saldoCents !== null) && (
        <Seccion titulo="Del plan de tratamiento">
          {resumen.plan && (
            <p className="flex items-baseline justify-between gap-3 text-[13.5px]">
              <span className="min-w-0 truncate">{resumen.plan.nombre}</span>
              <b className="cifra text-[15px] font-medium">
                {formatMoney(resumen.plan.totalCents, resumen.plan.currency)}
              </b>
            </p>
          )}
          <p className="mt-1.5 flex items-baseline justify-between gap-3 text-[13.5px] text-muted-foreground">
            <span>Saldo del paciente</span>
            {resumen.saldoCents === null ? (
              <span>Sin datos</span>
            ) : (
              <b
                className={cn(
                  "cifra text-[15px] font-medium",
                  resumen.saldoCents > 0 ? "text-destructive" : "text-foreground",
                )}
              >
                {resumen.saldoCents < 0 ? "A favor " : ""}
                {formatMoney(Math.abs(resumen.saldoCents), ctx.currency)}
              </b>
            )}
          </p>
        </Seccion>
      )}

      <div className="grid grid-cols-2 gap-2 border-t border-border pt-3.5 pb-3.5">
        {ctx.puedeGestionar && principal ? (
          <BloqueoEscritura>
            <button
              type="button"
              disabled={cambiar.enCurso}
              onClick={() => marcar(principal.estado)}
              className={claseAccion(true)}
            >
              {cambiar.enCurso ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                principal.estado === "en-sala" && (
                  <Circle aria-hidden className="size-2.5 fill-current" />
                )
              )}
              {principal.etiqueta}
            </button>
          </BloqueoEscritura>
        ) : null}
        <Link
          to="/pacientes/$pacienteId"
          params={{ pacienteId: c.pacienteId }}
          className={claseAccion(!(ctx.puedeGestionar && principal))}
        >
          Abrir ficha
          <ArrowUpRight aria-hidden className="size-4" />
        </Link>
        {ctx.puedeGestionar && esMovible(c) && (
          <BloqueoEscritura>
            <button type="button" onClick={() => ctx.onReagendar(c)} className={claseAccion()}>
              Reagendar
            </button>
          </BloqueoEscritura>
        )}
        {ctx.puedeGestionar && puedeAusente && (
          <BloqueoEscritura>
            <button
              type="button"
              disabled={cambiar.enCurso}
              onClick={() => marcar("ausente")}
              className={claseAccion()}
            >
              No asistió
            </button>
          </BloqueoEscritura>
        )}
      </div>

      {renderAcciones && (
        <div className="flex flex-wrap gap-2 pb-4 [&>*]:h-9">{renderAcciones(c, p)}</div>
      )}

      {estadoIa?.habilitada !== true && <TarjetaPatty paciente={c.paciente} />}
    </div>
  );
}

/**
 * Patty en el cajón (prototipo A+): lo que haría antes de que entre el
 * paciente. Está en habilitación (docs/IA.md): el texto lo dice y los
 * botones van desactivados. No promete nada que hoy no haga.
 */
function TarjetaPatty({ paciente }: { paciente: string }) {
  const partes = paciente.trim().split(/\s+/);
  const apellido = partes.length >= 3 ? partes[partes.length - 2] : partes[partes.length - 1];
  const pasos = [
    "Leer las 2 últimas notas",
    "Revisar alertas y presupuesto",
    "Resumir en 3 líneas",
  ];
  return (
    <aside
      aria-label="Patty, en habilitación"
      className="grid grid-cols-[34px_minmax(0,1fr)] items-start gap-3 rounded-xl border border-dashed border-ai bg-ai-soft p-4"
    >
      <PattyCara px={34} decorativa />
      <div className="min-w-0 text-[15px] leading-snug">
        <p>
          <b className="font-semibold text-ai">Patty</b> prepararía un resumen antes de que entre{" "}
          {apellido}.
        </p>
        <ul className="mt-2.5 grid gap-1.5 text-sm font-medium text-muted-foreground">
          {pasos.map((paso) => (
            <li key={paso} className="flex items-center gap-2">
              <span aria-hidden="true" className="size-3 rounded-full border-[1.5px] border-ai" />
              {paso}
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-sm text-muted-foreground">En habilitación: hoy no está activa.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled
            className="h-8 rounded-full bg-ai px-3.5 text-[13px] font-semibold text-ai-foreground opacity-50"
          >
            Aprobar
          </button>
          <button
            type="button"
            disabled
            className="h-8 rounded-full border border-ai px-3.5 text-[13px] font-semibold text-ai opacity-50"
          >
            Descartar
          </button>
        </div>
      </div>
    </aside>
  );
}
