import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus, Check, Lock, Sparkles, UserPlus } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { AvisoCitasPasadas } from "@/components/citas-pasadas";
import { ColaConfirmacion } from "@/components/cola-confirmacion";
import { EstadoCitaPastilla } from "@/components/estado-cita-pastilla";
import { tituloDeAgenda } from "@/components/agenda-titulo";
import {
  TarjetaDelDia,
  type CifraChica,
  type CifraProtagonista,
} from "@/components/hoy-tarjeta-del-dia";
import { AlertasDeHoy } from "@/components/hoy-alertas";
import { PanelDelRol } from "@/components/hoy-panel-del-rol";
import { ocupacionDelDia } from "@/components/agenda-ocupacion";
import { PanelDesempeno } from "@/components/panel-desempeno";
import { PattyCara } from "@/components/patty-cara";
import { buttonVariants } from "@/components/ui/button";
import { requirePermission } from "@/lib/access/route-guards";
import { hasPermission } from "@/lib/access/access";
import { listClinicMembers } from "@/lib/access/access.functions";
import { getMySubscription } from "@/lib/billing.functions";
import { accesoPorSuscripcion, requiereLlamadaOSuscripcion } from "@/lib/billing";
import { enlacePuestaEnMarcha, MINUTOS_PUESTA_EN_MARCHA } from "@/lib/marketing/puesta-en-marcha";
import { VideoDelPaso } from "@/components/ayuda/video-del-paso";
import type { IdPasoPuestaEnMarcha } from "@/content/ayuda/puesta-en-marcha";
import { formatoFecha, hoyISO, type Cita } from "@/lib/clinic-operations/clinic-data";
import { listProfessionals } from "@/lib/clinic-operations/clinic-catalog.functions";
import { listProfessionalSchedules } from "@/lib/clinic-operations/professionals.functions";
import { getPanelDeHoy } from "@/lib/panel/panel.functions";
import {
  alertasVisibles,
  bloqueMuestraDinero,
  bloquesDelPanel,
  perfilDePanel,
  type TipoAlerta,
} from "@/lib/panel/panel-por-rol";
import {
  getAppointmentPatientBalances,
  listAppointments,
} from "@/lib/clinic-operations/appointments.functions";
import { getFinanceSummary } from "@/lib/finance/finance-reports.functions";
import { getEstadoIa } from "@/lib/ai/estado.functions";
import { formatMoney, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/finance/finance";
import { countConversacionesSinResponder } from "@/lib/messaging/conversations.functions";
import { countPendingOutreach, listPendingReminders } from "@/lib/messaging/messaging.functions";
import { contarFilasDeRecordatorios } from "@/lib/messaging/recordatorios-agrupados";
import { listPatients } from "@/lib/patients/patients.functions";
import { cn } from "@/lib/utils";
import { hora as horaActual } from "@/lib/formato-fecha";
import { PacientesGes } from "@/components/pacientes-ges";

export const Route = createFileRoute("/_authenticated/_clinic/dashboard")({
  beforeLoad: requirePermission("dashboard:view"),
  head: () => ({
    meta: [
      { title: "Hoy | Esmalia" },
      {
        name: "description",
        content: "Esmalia: KPIs en vivo y agenda del día de tu clínica dental.",
      },
      { property: "og:title", content: "Hoy | Esmalia" },
      {
        property: "og:description",
        content: "KPIs en vivo y agenda del día de tu clínica dental.",
      },
    ],
  }),
  component: Dashboard,
});

/** "$1.284.000" → ["$", "1.284.000"]: el símbolo va en ocre, como en la caja. */
function partirMonto(texto: string): [string, string] {
  const m = /^(-?[^\d-]*)(.*)$/.exec(texto);
  return m && m[1] ? [m[1], m[2]] : ["", texto];
}

/** Panel A+ (el de la caja): radio 14 px y borde fino. */
const PANEL = "rounded-[14px] border border-hairline bg-card";

// `inicio` llega como minutos desde las 8:00 de la sucursal (no desde
// medianoche) — mismo criterio que usa el resto de la agenda para acotar la
// jornada laboral. Si esa semántica cambia en el backend, acá es donde hay
// que ajustar el offset.
function horaDeCita(inicio: number) {
  const total = 8 * 60 + inicio;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** "Dra. Camila Herrera" → "CH" (columna Prof. angosta). */
function iniciales(nombre: string) {
  const partes = nombre
    .replace(/^Dra?\.\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  if (partes.length === 0) return "—";
  return partes
    .slice(0, 2)
    .map((p) => p[0].toLocaleUpperCase("es"))
    .join("");
}

type PasoActivacion = {
  /** ONB-01: id del paso para su video de ayuda. */
  id: IdPasoPuestaEnMarcha;
  hecho: boolean;
  label: string;
  to?: "/pacientes" | "/agenda" | "/equipo";
  /** Enlace externo (la llamada de puesta en marcha): se abre en otra pestaña. */
  href?: string;
  cta?: string;
};

/**
 * Checklist "Activa tu clínica" (benchmark de onboarding, 25-sep-2026; forma
 * del rediseño, panel 1c). Se deriva de datos reales y desaparece sola cuando
 * todo está hecho: no hay botón de cerrar porque no hace falta.
 */
function ChecklistActivacion({ pasos }: { pasos: PasoActivacion[] }) {
  if (pasos.every((p) => p.hecho)) return null;
  const hechos = pasos.filter((p) => p.hecho).length;

  return (
    <section aria-labelledby="activacion" className={cn(PANEL, "p-5")}>
      <h2 id="activacion" className="font-display text-[22px] font-medium leading-tight">
        Activa tu clínica{" "}
        <em className="text-brand-600">
          <span className="cifra not-italic text-[0.7em]">{hechos}</span> de{" "}
          <span className="cifra not-italic text-[0.7em]">{pasos.length}</span>
        </em>
      </h2>
      <ul className="mt-4 space-y-3">
        {pasos.map((paso) => (
          <li key={paso.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border",
                  paso.hecho ? "border-success text-success" : "border-border",
                )}
              >
                {paso.hecho && <Check className="size-3" />}
              </span>
              <span className={cn(paso.hecho && "text-muted-foreground line-through")}>
                {paso.label}
                <span className="sr-only">{paso.hecho ? " (hecho)" : " (pendiente)"}</span>
              </span>
              {!paso.hecho && <VideoDelPaso id={paso.id} />}
            </span>
            {!paso.hecho && paso.to && (
              <Link to={paso.to} className="shrink-0 text-xs text-brand-700 hover:underline">
                {paso.cta} →
              </Link>
            )}
            {!paso.hecho && paso.href && (
              <a
                href={paso.href}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs text-brand-700 hover:underline"
              >
                {paso.cta} →
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Patty en Hoy (prototipo A+): lo que haría con el día. Está en habilitación
 * (docs/IA.md): lo dice y los botones van desactivados, como en el cajón de
 * la agenda. No promete nada que hoy no haga.
 */
function PattyDelDia() {
  const pasos = [
    "Ordenar a quién confirmar primero",
    "Avisar los huecos que quedan libres",
    "Resumir el día en 3 líneas",
  ];
  return (
    <aside
      aria-label="Patty, en habilitación"
      className="grid grid-cols-[34px_minmax(0,1fr)] items-start gap-3 rounded-[14px] border border-dashed border-ai bg-ai-soft p-4"
    >
      <PattyCara px={34} decorativa />
      <div className="min-w-0 text-[15px] leading-snug">
        <p>
          <b className="font-semibold text-ai">Patty</b> te ayudaría a ordenar el día.
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
      </div>
    </aside>
  );
}

function saludo(timezone: string | undefined) {
  const hora = Number(horaActual(new Date(), timezone).slice(0, 2));
  if (hora < 12) return "Buenos días";
  if (hora < 20) return "Buenas tardes";
  return "Buenas noches";
}

/**
 * Variante compacta de `TrialDesbloqueo` para el panel de desempeño del
 * dashboard (Task 11, fix round 1 — Critical #1).
 *
 * `TrialDesbloqueo` completo (grilla de dos columnas a página completa) no
 * entra bien acá: el dashboard ya tiene su propia agenda del día y KPIs
 * debajo, y esta sección es solo UNA de varias, no la pantalla entera. Lo que
 * sí hereda es la regla que importa: nunca un error rojo genérico donde en
 * realidad es un trial vencido — el estado tiene que decir la verdad.
 */
function DesempenoBloqueado({ porPago }: { porPago: boolean }) {
  return (
    <div className="card-clinical flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
          <Lock className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium">El panel de desempeño se activa al suscribirte</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {porPago
              ? "Tu suscripción no está al día. La agenda, los pacientes y la ficha clínica siguen funcionando con total normalidad."
              : "Tu trial de 14 días terminó. La agenda y el resto de la clínica siguen funcionando con total normalidad."}
          </p>
        </div>
      </div>
      <Link
        to="/suscripcion"
        className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-brand bg-transparent px-4 py-2 text-xs font-medium text-brand-700 transition-opacity hover:bg-brand/12"
      >
        <Sparkles className="size-3.5" /> Activar suscripción
      </Link>
    </div>
  );
}

function Dashboard() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const clinicTz = access.clinic?.timezone;
  const currency = access.clinic?.currency ?? "CLP";
  const hoy = hoyISO(clinicTz);

  const veFinanzas = hasPermission(access, "finance:view");
  const gestionaAgenda = hasPermission(access, "agenda:manage");

  const fetchPatients = useServerFn(listPatients);
  const fetchAppointments = useServerFn(listAppointments);
  const fetchProfessionals = useServerFn(listProfessionals);
  const fetchBalances = useServerFn(getAppointmentPatientBalances);
  const fetchFinance = useServerFn(getFinanceSummary);
  const fetchSubscription = useServerFn(getMySubscription);
  const fetchMembers = useServerFn(listClinicMembers);
  const fetchReminders = useServerFn(listPendingReminders);
  const fetchOutreachCount = useServerFn(countPendingOutreach);
  const fetchSinResponder = useServerFn(countConversacionesSinResponder);
  const fetchPanel = useServerFn(getPanelDeHoy);
  const fetchHorarios = useServerFn(listProfessionalSchedules);

  // Ola 11 · panel por rol: qué bloques y alertas ve este acceso (rol real o
  // simulado, con ajustes por persona). La base aplica lo mismo con el rol real.
  const perfil = perfilDePanel(access);
  const bloques = bloquesDelPanel(access);

  // Mismo queryKey que TrialBanner / StatusStrip / informes: comparten caché.
  // Con trial vencido, `getPanelDesempeno` y `getFinanceSummary` rechazan
  // (`requireFinanceView`): el panel lo dice en vez de mostrar un error rojo.
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  const acceso = accesoPorSuscripcion(sub ?? null);
  const informesBloqueados = acceso.nivel === "restringido";

  // Ventana hoy..+2 días: alcanza para la agenda de hoy y la cola de "sin
  // confirmar 48 h" (antes traía 30 días para cuatro tarjetas genéricas).
  const hasta = useMemo(() => {
    const d = new Date(hoy);
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  }, [hoy]);
  const {
    data: citas = [],
    isLoading,
    isError: citasConError,
    refetch: reintentarCitas,
  } = useQuery({
    queryKey: ["appointments", clinicId, hoy, hasta],
    enabled: Boolean(clinicId),
    queryFn: () => fetchAppointments({ data: { clinicId: clinicId!, desde: hoy, hasta } }),
    select: (res) => res.items,
  });
  const { data: profesionales = [] } = useQuery({
    queryKey: ["professionals", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchProfessionals({ data: { clinicId: clinicId! } }),
  });

  const citasHoy = useMemo(
    () => citas.filter((c) => c.fecha === hoy).sort((a, b) => a.inicio - b.inicio),
    [citas, hoy],
  );
  const nombreProfesional = useMemo(
    () => new Map(profesionales.map((p) => [p.id, p.nombre])),
    [profesionales],
  );

  const pacientesHoy = useMemo(
    () => [...new Set(citasHoy.map((c) => c.pacienteId))].sort(),
    [citasHoy],
  );
  const {
    data: saldos = {},
    isPending: saldosPendientes,
    isError: saldosConError,
  } = useQuery({
    queryKey: ["appointment-balances", clinicId, pacientesHoy],
    enabled: Boolean(clinicId) && veFinanzas && pacientesHoy.length > 0,
    queryFn: () => fetchBalances({ data: { clinicId: clinicId!, patientIds: pacientesHoy } }),
  });
  const { data: cajaHoy } = useQuery({
    queryKey: ["finance-summary", clinicId, hoy, hoy],
    // Esperar a conocer la suscripción: con el trial vencido el servidor
    // rechaza este informe, y mientras `sub` carga `informesBloqueados` es false.
    enabled: Boolean(clinicId) && veFinanzas && sub !== undefined && !informesBloqueados,
    queryFn: () => fetchFinance({ data: { clinicId: clinicId!, desde: hoy, hasta: hoy } }),
  });

  // Colas: mismos queryKeys que el badge de Mensajes del sidebar.
  const { data: recordatorios = [] } = useQuery({
    queryKey: ["pending-reminders", clinicId],
    enabled: Boolean(clinicId) && gestionaAgenda,
    queryFn: () => fetchReminders({ data: { clinicId: clinicId! } }),
    refetchInterval: 5 * 60_000,
  });
  // Misma clave que el badge del menú: comparten la cuenta (no la lista).
  const { data: outreach } = useQuery({
    queryKey: ["pending-outreach", clinicId, "count"],
    enabled: Boolean(clinicId) && gestionaAgenda,
    queryFn: () => fetchOutreachCount({ data: { clinicId: clinicId! } }),
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
  });
  const { data: sinResponder = 0 } = useQuery({
    queryKey: ["conversations-pendientes", clinicId],
    enabled: Boolean(clinicId) && gestionaAgenda,
    queryFn: () => fetchSinResponder({ data: { clinicId: clinicId! } }),
    refetchInterval: 2 * 60_000,
  });
  // Alertas y bloques del rol (PAN-03..08, REC-10): una sola llamada.
  const {
    data: panel,
    isLoading: panelCargando,
    isError: panelConError,
  } = useQuery({
    queryKey: ["panel-de-hoy", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchPanel({ data: { clinicId: clinicId! } }),
    refetchInterval: 5 * 60_000,
  });
  const { data: horarios } = useQuery({
    queryKey: ["professional-schedules", clinicId],
    enabled: Boolean(clinicId) && bloques.includes("ocupacion"),
    queryFn: () => fetchHorarios({ data: { clinicId: clinicId! } }),
  });
  // Patty en habilitación (docs/IA.md): misma consulta y clave que el cajón.
  const fetchEstadoIa = useServerFn(getEstadoIa);
  const { data: estadoIa } = useQuery({
    queryKey: ["estado-ia"],
    queryFn: () => fetchEstadoIa(),
    staleTime: 5 * 60_000,
  });

  // Checklist de activación: solo para el dueño, con datos reales. En la
  // clínica demo no va: ya viene sembrada y es de solo lectura, así que
  // "Activa tu clínica" invitaría a pasos que el visitante no puede hacer.
  const esDueno = access.role === "owner";
  const mostrarActivacion = esDueno && !access.clinic?.isDemo;
  const { data: hayPacientes } = useQuery({
    queryKey: ["patients", clinicId],
    enabled: Boolean(clinicId) && mostrarActivacion,
    queryFn: () => fetchPatients({ data: { clinicId: clinicId! } }),
    select: (res) => res.items.length > 0,
  });
  const { data: miembros = [] } = useQuery({
    queryKey: ["clinic-members", clinicId],
    enabled: Boolean(clinicId) && mostrarActivacion,
    queryFn: () => fetchMembers({ data: { clinicId: clinicId! } }),
  });

  // ── Derivados ────────────────────────────────────────────────────
  const confirmadas = citasHoy.filter((c) =>
    ["confirmada", "en-sala", "finalizada"].includes(c.estado),
  ).length;
  const sinRespuestaHoy = citasHoy.filter(
    (c) => c.estado === "tentativa" && !c.pacienteConfirmo,
  ).length;
  const enSala = citasHoy.filter((c) => c.estado === "en-sala");
  const profesionalesHoy = new Set(citasHoy.map((c) => c.profesionalId)).size;
  const conDeuda = pacientesHoy.filter((id) => (saldos[id] ?? 0) > 0);
  const porCobrarHoy = conDeuda.reduce((s, id) => s + (saldos[id] ?? 0), 0);
  const sinConfirmar48h = citas.filter(
    (c) => c.estado === "tentativa" && !c.pacienteConfirmo,
  ).length;

  const atendidas = citasHoy.filter((c) => c.estado === "finalizada").length;

  // Regla 11: si la agenda no cargó, las cifras que salen de ella dicen
  // "Sin datos" en vez de un 0 que se lee como "día libre".
  const sinDatosCitas = (label: string): CifraChica => ({ label, valor: "—", nota: "Sin datos" });
  const kpiCitas: CifraChica = citasConError
    ? sinDatosCitas("Citas hoy")
    : {
        label: "Citas hoy",
        valor: String(citasHoy.length),
        nota: `${profesionalesHoy} profesional${profesionalesHoy === 1 ? "" : "es"}`,
      };
  const kpiConfirmadas: CifraChica = citasConError
    ? sinDatosCitas("Confirmadas")
    : {
        label: "Confirmadas",
        valor: String(confirmadas),
        nota: `${sinRespuestaHoy} sin respuesta`,
        tonoNota: sinRespuestaHoy > 0 ? "warning" : undefined,
      };
  const kpiEnSala: CifraChica = citasConError
    ? sinDatosCitas("En sala")
    : {
        label: "En sala",
        valor: String(enSala.length),
        tonoNota: enSala.length > 0 ? "info" : undefined,
        nota: enSala[0]
          ? `${enSala[0].paciente} · ${horaDeCita(enSala[0].inicio)}`
          : "Nadie esperando",
      };
  // Regla 11: mientras los saldos cargan (o si fallan) no se fabrica un $0.
  const saldosSinDatos = pacientesHoy.length > 0 && (saldosPendientes || saldosConError);
  const kpiPorCobrar: CifraChica = saldosSinDatos
    ? {
        label: "Por cobrar hoy",
        valor: "—",
        nota: saldosConError ? "Sin datos" : "Cargando…",
      }
    : {
        label: "Por cobrar hoy",
        valor: formatMoney(porCobrarHoy, currency),
        nota: `${conDeuda.length} paciente${conDeuda.length === 1 ? "" : "s"}`,
        tonoNota: porCobrarHoy > 0 ? "warning" : undefined,
      };

  // Dueño y contabilidad (finance:view): plata primero, como la caja.
  // Recepción y el equipo clínico: el movimiento del día. "Por cobrar" y
  // "Cobrado" exigen finance:view también en el servidor, así que no se le
  // ofrecen a quien no lo tiene (ni siquiera se piden).
  const mediosDeHoy = (cajaHoy?.byMethod ?? [])
    .filter((m) => m.totalCents > 0)
    .sort((a, b) => b.totalCents - a.totalCents);
  const [simboloCobrado, cifraCobrado] = partirMonto(
    formatMoney(cajaHoy?.totalCents ?? 0, currency),
  );
  const protagonista: CifraProtagonista = veFinanzas
    ? {
        label: "Cobrado hoy",
        valor: informesBloqueados || !cajaHoy ? "—" : cifraCobrado,
        acento:
          informesBloqueados || !cajaHoy ? undefined : { texto: simboloCobrado, lado: "antes" },
        desglose: informesBloqueados ? (
          "Se activa al suscribirte."
        ) : !cajaHoy ? (
          "Cargando los cobros…"
        ) : cajaHoy.paymentsCount === 0 ? (
          "Todavía no hay cobros hoy."
        ) : (
          <>
            <b>
              {cajaHoy.paymentsCount} pago{cajaHoy.paymentsCount === 1 ? "" : "s"}
            </b>
            {mediosDeHoy.slice(0, 3).map((m) => (
              <span key={m.method}>
                {" · "}
                {PAYMENT_METHOD_LABELS[m.method as PaymentMethod] ?? m.method}{" "}
                <span className="cifra text-on-night">{formatMoney(m.totalCents, currency)}</span>
              </span>
            ))}
          </>
        ),
      }
    : {
        label: "Citas hoy",
        valor: citasConError ? "—" : String(citasHoy.length),
        acento: citasConError
          ? undefined
          : { texto: citasHoy.length === 1 ? "cita" : "citas", lado: "despues" },
        desglose: citasConError ? (
          "Sin datos"
        ) : (
          <>
            <b>
              {profesionalesHoy} profesional{profesionalesHoy === 1 ? "" : "es"}
            </b>
            {` · ${atendidas} atendida${atendidas === 1 ? "" : "s"}`}
          </>
        ),
      };
  const cifras: CifraChica[] = veFinanzas
    ? [kpiPorCobrar, kpiCitas, kpiConfirmadas, kpiEnSala]
    : [
        kpiConfirmadas,
        kpiEnSala,
        citasConError
          ? sinDatosCitas("Sin confirmar")
          : {
              label: "Sin confirmar",
              valor: String(sinConfirmar48h),
              nota: "Próximas 48 h",
              tonoNota: sinConfirmar48h > 0 ? "warning" : undefined,
            },
        citasConError
          ? sinDatosCitas("Atendidas")
          : {
              label: "Atendidas",
              valor: String(atendidas),
              nota: `de ${citasHoy.length} cita${citasHoy.length === 1 ? "" : "s"}`,
            },
      ];
  const avisosPorDespachar = gestionaAgenda
    ? contarFilasDeRecordatorios(recordatorios) + (outreach?.total ?? 0)
    : null;

  // PAN-03: lo que requiere acción. Lo que trae la base más lo que Hoy ya
  // tenía (mensajes, avisos y saldos, con sus mismas consultas y claves).
  const conteos: Partial<Record<TipoAlerta, number | null>> = {
    ...(panel?.alertas ?? {}),
    mensajes_sin_responder: gestionaAgenda ? sinResponder : null,
    avisos_por_despachar: avisosPorDespachar,
    saldo_pacientes_hoy: veFinanzas && !saldosSinDatos ? conDeuda.length : null,
  };
  const alertas = alertasVisibles(access, conteos);

  const ahora = horaActual(new Date(), clinicTz);
  const ahoraMin = Number(ahora.slice(0, 2)) * 60 + Number(ahora.slice(3, 5)) - 8 * 60;
  const ocupacion =
    bloques.includes("ocupacion") && horarios && !citasConError && !isLoading
      ? ocupacionDelDia({
          fecha: hoy,
          citas: citasHoy,
          profesionalIds: profesionales.map((p) => p.id),
          horarios,
        })
      : null;

  const pasosActivacion: PasoActivacion[] = [
    { id: "crear-clinica", hecho: true, label: "Crear la clínica" },
    {
      id: "invitar-equipo",
      hecho: miembros.length > 1,
      label: "Invitar al equipo",
      to: "/equipo",
      cta: "Invitar",
    },
    {
      id: "cargar-pacientes",
      hecho: Boolean(hayPacientes),
      label: "Importar o cargar pacientes",
      to: "/pacientes",
      cta: "Ir a pacientes",
    },
    {
      // `citas` mira hoy..+2 días: heurística de checklist, no una métrica.
      id: "primera-cita",
      hecho: citas.length > 0,
      label: "Agendar la primera cita",
      to: "/agenda",
      cta: "Ir a la agenda",
    },
    {
      // CS-02: WhatsApp, portal y efectividad se activan con la llamada de
      // puesta en marcha (o suscribiéndose). Estar en el checklist evita que
      // la clínica lo descubra al chocar con el candado. Mientras carga la
      // suscripción no se muestra, para que no parpadee.
      id: "llamada-puesta-en-marcha",
      hecho:
        sub === undefined ||
        !requiereLlamadaOSuscripcion(sub, access.clinic?.onboardingCallAt ?? null),
      label: `Hacer la puesta en marcha (${MINUTOS_PUESTA_EN_MARCHA} min): activa WhatsApp y el portal`,
      href: enlacePuestaEnMarcha({
        clinicName: access.clinic?.name,
        clinicEmail: access.email,
      }).href,
      cta: "Agendar",
    },
  ];

  // El nombre puede venir guardado en minúsculas ("walter la madriz").
  const nombre = (access.fullName ?? "").trim().split(/\s+/)[0] ?? "";
  const primerNombre = nombre ? nombre[0].toLocaleUpperCase("es") + nombre.slice(1) : "";
  const primerDiaDelMes = `${hoy.slice(0, 7)}-01`;
  const busquedaAgendaHoy = {
    q: "",
    fecha: hoy,
    // Sin `vista`: la agenda elige la suya (lista en el celular, día en el resto).
    sucursal: "",
    profesional: "",
    estado: "",
    page: 1,
  };

  const titulo = tituloDeAgenda("dia", hoy);
  const enlaceAgenda = (
    <Link
      to="/agenda"
      search={{ ...busquedaAgendaHoy, vista: "dia" }}
      className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-brand-on-night underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-on-night sm:min-h-9"
    >
      Abrir la agenda →
    </Link>
  );

  return (
    <AppShell title="Hoy" access={access}>
      {/* Pase A+ (27-oct-2026): encabezado editorial, tarjeta en tinta con la
          cifra del día y el día por profesional, y a la derecha lo que hay
          que resolver. Mismo lenguaje que la agenda y la caja. */}
      <div className="mx-auto max-w-[84rem] space-y-[18px]">
        <header className="flex flex-wrap items-end justify-between gap-x-7 gap-y-4 pb-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-muted-foreground">
              {access.clinic?.name && (
                <>
                  <b className="font-semibold text-foreground/85">{access.clinic.name}</b>
                  <span aria-hidden>·</span>
                </>
              )}
              <span>
                {saludo(clinicTz)}
                {primerNombre ? `, ${primerNombre}` : ""}
              </span>
            </p>
            <h2 className="mt-2 font-display text-[clamp(2.25rem,3.6vw,3.5rem)] font-medium leading-none tracking-[-0.02em] text-balance [font-variant-numeric:lining-nums]">
              {titulo.antes} <em className="text-brand-600">{titulo.enfasis}</em>
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasPermission(access, "patients:manage") && (
              <Link
                to="/pacientes"
                search={{
                  q: "",
                  sucursal: "",
                  profesional: "",
                  estado: "",
                  desde: "",
                  hasta: "",
                  page: 1,
                }}
                className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-full px-4")}
              >
                <UserPlus aria-hidden /> Nuevo paciente
              </Link>
            )}
            {gestionaAgenda && (
              <Link
                to="/agenda"
                search={busquedaAgendaHoy}
                className={cn(buttonVariants(), "h-10 rounded-full px-4")}
              >
                <CalendarPlus aria-hidden /> Agendar cita
              </Link>
            )}
          </div>
        </header>

        {/* PAN-05: citas que ya terminaron y nadie cerró. Solo si hay. */}
        {clinicId && gestionaAgenda && (
          <AvisoCitasPasadas clinicId={clinicId} timezone={clinicTz} />
        )}

        {/* PAN-03: alertas accionables del rol, arriba de todo. */}
        <AlertasDeHoy alertas={alertas} cargando={panelCargando} conError={panelConError} />

        {/* Celular de recepción: la cola se resume en un aviso de una línea
            que despliega la lista. */}
        {clinicId && gestionaAgenda && (
          <div className="empty:hidden md:hidden">
            <ColaConfirmacion
              variante="aviso"
              clinicId={clinicId}
              clinicaNombre={access.clinic?.name ?? "la clínica"}
              citas={citas}
              hoy={hoy}
              nombreProfesional={nombreProfesional}
            />
          </div>
        )}

        <TarjetaDelDia
          protagonista={protagonista}
          cifras={cifras}
          citasHoy={citasHoy}
          profesionales={profesionales}
          hoy={hoy}
          zonaHoraria={clinicTz}
          cargando={isLoading}
          conError={citasConError}
          enlaceAgenda={enlaceAgenda}
          avisosPorDespachar={avisosPorDespachar}
          pattyEnHabilitacion={estadoIa !== undefined && estadoIa.habilitada !== true}
        />

        <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <section aria-labelledby="agenda-hoy" className={cn(PANEL, "min-w-0 overflow-hidden")}>
            <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-[18px] pb-3">
              <h2 id="agenda-hoy" className="font-display text-[30px] font-medium leading-none">
                Agenda <em className="text-brand-600">de hoy</em>
              </h2>
              <Link
                to="/agenda"
                search={busquedaAgendaHoy}
                className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-brand-700 underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9"
              >
                Abrir agenda →
              </Link>
            </div>
            {citasConError ? (
              // Un error no es "no hay citas": antes se mostraba igual y la
              // recepción creía que el día estaba libre (auditoría 07-oct).
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 border-t border-destructive-border bg-destructive-soft px-5 py-5 text-sm text-destructive"
              >
                No pudimos cargar la agenda de hoy. Revisa la conexión.
                <button
                  type="button"
                  onClick={() => void reintentarCitas()}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Reintentar
                </button>
              </div>
            ) : citasHoy.length === 0 ? (
              <p className="border-t border-hairline px-5 py-8 text-sm text-muted-foreground">
                {isLoading ? "Cargando la agenda…" : "No hay citas para hoy."}
              </p>
            ) : (
              <>
                {/* Celular: lista de dos líneas, sin tabla que obligue a
                    deslizar de costado a 390px. */}
                <ul className="divide-y divide-hairline border-t border-hairline md:hidden">
                  {citasHoy.map((c) => {
                    const saldo = saldos[c.pacienteId];
                    return (
                      <li key={c.id}>
                        <Link
                          to="/pacientes/$pacienteId"
                          params={{ pacienteId: c.pacienteId }}
                          className="flex min-h-14 items-center gap-3 px-4 py-2.5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                        >
                          <span className="w-12 shrink-0 cifra text-sm text-muted-foreground">
                            {horaDeCita(c.inicio)}
                          </span>
                          <span className="min-w-0 flex-1 leading-snug">
                            <span className="block truncate font-display text-[19px] font-medium leading-tight">
                              {c.paciente}
                            </span>
                            <span className="block truncate text-[13px] text-muted-foreground">
                              {c.tratamiento}
                              {veFinanzas && saldo !== undefined && saldo > 0 && (
                                <span className="cifra text-warning">
                                  {" "}
                                  · debe {formatMoney(saldo, currency)}
                                </span>
                              )}
                            </span>
                          </span>
                          <EstadoCitaPastilla cita={c} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {/* Escritorio: una fila por cita, hora en mono, paciente en
                    serif, estado con forma + ícono + texto. */}
                <div className="hidden md:block">
                  <table className="w-full table-fixed border-collapse text-[15px]">
                    <thead>
                      <tr className="border-y border-control/50 text-left text-xs font-semibold text-muted-foreground">
                        <th scope="col" className="w-[4.5rem] py-2 pr-3 pl-5 font-semibold">
                          Hora
                        </th>
                        <th scope="col" className="py-2 pr-3 font-semibold">
                          Paciente · tratamiento
                        </th>
                        <th
                          scope="col"
                          className="hidden py-2 pr-3 font-semibold xl:table-cell xl:w-36"
                        >
                          Profesional
                        </th>
                        <th scope="col" className="w-36 py-2 pr-3 font-semibold">
                          Estado
                        </th>
                        {veFinanzas && (
                          <th scope="col" className="w-28 py-2 pr-5 text-right font-semibold">
                            Saldo
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {citasHoy.map((c) => {
                        const saldo = saldos[c.pacienteId];
                        const profesional = nombreProfesional.get(c.profesionalId) ?? "—";
                        return (
                          <tr
                            key={c.id}
                            data-cita
                            className="border-b border-hairline align-middle last:border-b-0 hover:bg-muted/40"
                          >
                            <td className="py-[11px] pr-3 pl-5 cifra text-muted-foreground">
                              {horaDeCita(c.inicio)}
                            </td>
                            {/* Paciente y tratamiento comparten celda: el
                                ancho se reparte según el largo real de cada
                                uno en vez de cortar los dos a la mitad. */}
                            <td
                              className="truncate py-[11px] pr-3"
                              title={`${c.paciente} · ${c.tratamiento} · ${profesional}`}
                            >
                              <Link
                                to="/pacientes/$pacienteId"
                                params={{ pacienteId: c.pacienteId }}
                                className="rounded-sm font-display text-[18px] font-medium outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                              >
                                {c.paciente}
                              </Link>
                              <span className="text-[13.5px] text-muted-foreground">
                                {" "}
                                · {c.tratamiento}
                                <span className="xl:hidden"> · {iniciales(profesional)}</span>
                              </span>
                            </td>
                            <td className="hidden truncate py-[11px] pr-3 text-[13.5px] text-foreground/80 xl:table-cell">
                              {profesional}
                            </td>
                            <td className="py-[11px] pr-3">
                              <EstadoCitaPastilla cita={c} />
                            </td>
                            {veFinanzas && (
                              <td
                                className={cn(
                                  "truncate py-[11px] pr-5 text-right cifra text-sm",
                                  saldo !== undefined && saldo > 0 && "text-warning",
                                )}
                              >
                                {saldo === undefined
                                  ? "—"
                                  : saldo > 0
                                    ? formatMoney(saldo, currency)
                                    : saldo < 0
                                      ? `A favor ${formatMoney(-saldo, currency)}`
                                      : "Al día"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <div className="min-w-0 space-y-[18px]">
            {/* Escritorio y tablet: la cola compacta, con "Confirmó" a un clic. */}
            {clinicId && gestionaAgenda && (
              <div className="hidden empty:hidden md:block">
                <ColaConfirmacion
                  clinicId={clinicId}
                  clinicaNombre={access.clinic?.name ?? "la clínica"}
                  citas={citas}
                  hoy={hoy}
                  nombreProfesional={nombreProfesional}
                />
              </div>
            )}
            {estadoIa !== undefined && estadoIa.habilitada !== true && <PattyDelDia />}
            {clinicId && (access.clinic?.country ?? "").toUpperCase() === "CL" && (
              <PacientesGes clinicId={clinicId} />
            )}
            {clinicId && mostrarActivacion && <ChecklistActivacion pasos={pasosActivacion} />}
          </div>
        </div>

        {/* PAN-04/06/07/08 y REC-10: bloques del rol. */}
        {perfil && (
          <PanelDelRol
            perfil={perfil}
            bloques={bloques}
            muestraDinero={(b) => bloqueMuestraDinero(access, b)}
            datos={{
              panel,
              cargando: panelCargando,
              conError: panelConError,
              currency,
              zonaHoraria: clinicTz,
              hoy,
              citasHoy,
              ahoraMin,
              myProfessionalId: access.myProfessionalId ?? null,
              nombreProfesional,
              cobradoHoy:
                veFinanzas && cajaHoy && !informesBloqueados
                  ? formatMoney(cajaHoy.totalCents, currency)
                  : null,
              porCobrarHoy:
                veFinanzas && !saldosSinDatos ? formatMoney(porCobrarHoy, currency) : null,
              ocupacion,
            }}
          />
        )}

        {clinicId && veFinanzas && (
          <section aria-labelledby="desempeno" className="space-y-3 pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="desempeno" className="font-display text-[30px] font-medium leading-none">
                Desempeño <em className="text-brand-600">del mes</em>
              </h2>
              <p className="cifra text-sm text-muted-foreground">
                {formatoFecha(primerDiaDelMes)} — {formatoFecha(hoy)}
              </p>
            </div>
            {informesBloqueados ? (
              <DesempenoBloqueado
                porPago={acceso.nivel === "restringido" && acceso.motivo === "pago"}
              />
            ) : (
              <PanelDesempeno clinicId={clinicId} desde={primerDiaDelMes} hasta={hoy} />
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
