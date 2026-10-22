import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarDays,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  CloudOff,
  Ellipsis,
  FileUp,
  Inbox,
  Loader2,
  MoveRight,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { PatientConfirmedToggle } from "@/components/patient-confirmed-toggle";
import { FilterBar, Paginacion, SearchField, SelectField } from "@/components/filters";
import { AgendaGrid, AvisoDeChoques, type ArrastreGrilla } from "@/components/agenda-grid";
import {
  boxDe,
  conflictosDeCandidata,
  detectarConflictos,
  resumenConflictos,
  type Conflicto,
} from "@/components/agenda-conflictos";
import { LeyendaAgenda } from "@/components/agenda-leyenda";
import { QUERY_MOVIL, useMediaQuery } from "@/hooks/use-media-query";
import { enfocarCita } from "@/hooks/use-arrastre-cita";
import {
  aplicarMovimientosPendientes,
  destinoDeStartsAt,
  esMovible,
  fechaCorta,
  horarioDelDia,
  validarDestino,
  type Destino,
} from "@/components/agenda-movimiento";
import { MoverCitaDialog } from "@/components/agenda-mover-a";
import { CambiarEstadoMenu } from "@/components/cambiar-estado-cita-menu";
import { claseEstadoBadge, puedeConfirmarCita } from "@/components/cita-acciones";
import type { SemillaCita } from "@/components/agenda-hueco";
import { AgendaMonth, AgendaSemanaCarriles } from "@/components/agenda-views";
import { fechaMasAntigua } from "@/components/agenda-ocupacion";
import { AllergyAlertBanner, AllergyAlertIcon } from "@/components/medical-history-card";
import { PatientCombobox } from "@/components/patient-combobox";
import { addDaysISO, addMonthsISO, rangoDeVista } from "@/lib/clinic-operations/agenda-fechas";
import { Button, buttonVariants } from "@/components/ui/button";
import { HolidayNotice } from "@/components/holiday-notice";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { usePublicHolidays } from "@/hooks/use-public-holidays";
import { useColaOffline, useOfflineMutation } from "@/hooks/use-offline-mutation";
import { useReprogramarCita } from "@/hooks/use-reprogramar-cita";
import {
  puedeSimularSinConexion,
  simularSinConexion,
  useConnectivity,
} from "@/hooks/use-connectivity";
import { interpretarNuevaCita, leerNuevaCita } from "@/lib/shell";
import { esCuentaDemo } from "@/lib/demo-cuenta";
import { listProfessionalSchedules } from "@/lib/clinic-operations/professionals.functions";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useZonaClinica } from "@/hooks/use-zona-clinica";
import {
  fecha as fechaFmt,
  fechaCorta as fechaCortaFmt,
  hora as horaFmt,
  mesAnio,
  numero,
} from "@/lib/formato-fecha";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { requirePermission } from "@/lib/access/route-guards";
import { hasPermission } from "@/lib/access/access";
import {
  etiquetaEstado,
  formatoFechaLarga,
  HORA_INICIO,
  fechaDeAgenda,
  hoyISO,
  type Cita,
  type EstadoCita,
  type Profesional,
} from "@/lib/clinic-operations/clinic-data";

import { listBranches, listProfessionals } from "@/lib/clinic-operations/clinic-catalog.functions";
import { listProcedures } from "@/lib/finance/finance.functions";
import { formatMoney } from "@/lib/finance/finance";
import { listPatients } from "@/lib/patients/patients.functions";
import { listAllergyAlerts } from "@/lib/clinical/medical-history.functions";
import { getAppointmentPatientBalances } from "@/lib/clinic-operations/appointments.functions";
import {
  createAppointment,
  listAppointments,
  setAppointmentStatus,
  updateAppointment,
  type Solapamiento,
} from "@/lib/clinic-operations/appointments.functions";
import {
  importAppointments,
  previewImportAppointments,
  type ImportAppointmentPreviewRow,
  type ImportAppointmentsResult,
} from "@/lib/clinic-operations/appointments-import.functions";
import { CsvColumnMapper } from "@/components/csv-column-mapper";
import {
  aplicarMapeo,
  autoDetectMapping,
  faltanCamposObligatorios,
  parseCsvRaw,
  type CsvFieldSpec,
} from "@/lib/csv/column-mapping";
import {
  createWaitlistEntry,
  listWaitlist,
  removeWaitlistEntry,
} from "@/lib/clinic-operations/waitlist.functions";
import {
  declineAppointmentRequest,
  listPendingAppointmentRequests,
  markAppointmentRequestScheduled,
  type PendingAppointmentRequest,
} from "@/lib/patients/portal.functions";
import { coincide, num, paginar, str } from "@/lib/search";
import { EstadoCitaPastilla } from "@/components/estado-cita-pastilla";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";
import { BloqueoEscritura } from "@/components/solo-lectura";

/**
 * `lista`: solo el listado del día, sin grilla. Es la vista por defecto en el
 * celular (UX-02): la primera cita queda arriba sin desplazarse por horas
 * vacías. En la URL va solo si alguien la eligió; sin `vista`, el
 * componente decide según el ancho.
 */
type VistaAgenda = "dia" | "semana" | "mes" | "lista";

const NOMBRE_VISTA: Record<VistaAgenda, string> = {
  lista: "Lista",
  dia: "Día",
  semana: "Semana",
  mes: "Mes",
};

/** La lista cubre lo mismo que el día. */
function rangoDeLaVista(vista: VistaAgenda, fecha: string): [string, string] {
  return rangoDeVista(vista === "lista" ? "dia" : vista, fecha);
}

/** Mueve la fecha un período hacia adelante/atrás según la vista activa. */
function desplazarPeriodo(vista: VistaAgenda, fecha: string, dir: 1 | -1): string {
  if (vista === "semana") return addDaysISO(fecha, dir * 7);
  if (vista === "mes") return addMonthsISO(fecha, dir);
  return addDaysISO(fecha, dir);
}

/** Título del período visible: día largo, rango de semana, o mes + año. */
function labelPeriodo(vista: VistaAgenda, fecha: string): string {
  if (vista === "dia" || vista === "lista") return formatoFechaLarga(fecha) || fecha;
  if (vista === "mes") return mesAnio(fecha);
  const [desde, hasta] = rangoDeVista("semana", fecha);
  if (desde.slice(0, 7) === hasta.slice(0, 7))
    return `${Number(desde.slice(8, 10))}–${fechaFmt(hasta)}`;
  if (desde.slice(0, 4) === hasta.slice(0, 4))
    return `${fechaCortaFmt(desde)} – ${fechaFmt(hasta)}`;
  return `${fechaFmt(desde)} – ${fechaFmt(hasta)}`;
}

interface AgendaSearch {
  q: string;
  fecha: string;
  /** Ausente = la vista por defecto del equipo (lista en el celular, día en el resto). */
  vista?: VistaAgenda;
  sucursal: string;
  profesional: string;
  estado: string;
  page: number;
  /** Id de paciente: abre "Nueva cita" con ese paciente ya elegido (botón
   * "Agendar" de la ficha). `1` la abre vacía (acción "Nueva cita" del ⌘K).
   * Se limpia de la URL al abrir el diálogo (`interpretarNuevaCita`). */
  nueva?: string;
}

function parseVista(v: unknown): VistaAgenda | undefined {
  return v === "dia" || v === "semana" || v === "mes" || v === "lista" ? v : undefined;
}

export const Route = createFileRoute("/_authenticated/_clinic/agenda")({
  validateSearch: (search: Record<string, unknown>): AgendaSearch => ({
    q: str(search.q),
    // Sin default a propósito: `validateSearch` no tiene acceso al contexto de
    // la ruta, así que no puede saber el huso de la clínica. Cadena vacía
    // significa "sin fecha explícita" y el componente resuelve el hoy real con
    // `fechaDeAgenda`. Antes acá se caía al huso de Chile y una clínica en
    // México abría la agenda en mañana durante sus últimas horas del día.
    fecha: str(search.fecha),
    vista: parseVista(search.vista),
    sucursal: str(search.sucursal),
    profesional: str(search.profesional),
    estado: str(search.estado),
    page: num(search.page, 1),
    nueva: leerNuevaCita(search.nueva),
  }),
  beforeLoad: requirePermission("agenda:view"),
  head: () => ({
    meta: [
      { title: "Agenda inteligente | Esmalia" },
      {
        name: "description",
        content:
          "Agenda por fecha, profesional, sucursal y estado, con lista de espera inteligente.",
      },
      { property: "og:title", content: "Agenda inteligente | Esmalia" },
      {
        property: "og:description",
        content:
          "Agenda filtrable por fecha, profesional, sucursal y estado, con lista de espera inteligente.",
      },
    ],
  }),
  component: AgendaPage,
});

const estados: { value: EstadoCita; label: string }[] = (
  ["confirmada", "en-sala", "ausente", "finalizada", "tentativa"] as EstadoCita[]
).map((e) => ({ value: e, label: etiquetaEstado[e] }));

function horaDeCita(minutos: number) {
  const total = HORA_INICIO * 60 + minutos;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * `createAppointment` avisa (no bloquea) cuando la cita recién creada se
 * solapa con otra del mismo profesional — ver el comentario en
 * appointments.functions.ts. La hora se muestra en la zona horaria del
 * navegador (aproximada): es un aviso para que el staff decida, no un dato
 * que otra parte del sistema use.
 */
function avisarSiSolapa(resultado: unknown, zonaAviso?: string) {
  const solapamiento = (resultado as { solapamiento?: Solapamiento } | undefined)?.solapamiento;
  if (!solapamiento) return;
  const hora = horaFmt(solapamiento.startsAt, zonaAviso);
  toast.warning(
    `Ojo: ${solapamiento.treatmentLabel} ya está agendado a las ${hora} con este profesional. La cita se creó igual — revisa si hace falta reagendar.`,
  );
}

/**
 * Choques de lo que se está por agendar contra las citas cargadas (UX-04):
 * se muestran en el formulario ANTES de guardar. El servidor sigue siendo
 * quien decide (`validarHorarioYSolapamiento`, que avisa del mismo
 * profesional); esto suma el mismo paciente y el mismo box, y dice con qué
 * cita choca.
 */
function useChoquesDelFormulario({
  citas,
  profesionales,
  citaId,
  pacienteId,
  profesionalId,
  sucursalId,
  startsAt,
  duracion,
}: {
  citas: Cita[];
  profesionales: Profesional[];
  citaId?: string;
  pacienteId: string;
  profesionalId: string;
  sucursalId: string;
  startsAt: string;
  duracion: number;
}): Conflicto[] {
  return useMemo(() => {
    const destino = destinoDeStartsAt(startsAt);
    if (!destino || !profesionalId) return [];
    return conflictosDeCandidata(
      {
        id: citaId,
        pacienteId,
        profesionalId,
        sucursalId: sucursalId || undefined,
        fecha: destino.fecha,
        inicio: destino.inicio,
        duracion,
      },
      citas,
      profesionales,
    );
  }, [citas, profesionales, citaId, pacienteId, profesionalId, sucursalId, startsAt, duracion]);
}

function ChoquesDelFormulario({
  conflictos,
  profesionales,
  profesionalId,
}: {
  conflictos: Conflicto[];
  profesionales: Profesional[];
  profesionalId: string;
}) {
  if (conflictos.length === 0) return null;
  return (
    <AvisoDeChoques
      conflictos={conflictos}
      nombreProfesional={(id) =>
        profesionales.find((p) => p.id === id)?.nombre ?? "otro profesional"
      }
      box={boxDe(profesionales.find((p) => p.id === profesionalId))}
      titulo={
        conflictos.length === 1
          ? "Este horario choca con otra cita"
          : `Este horario choca con ${conflictos.length} citas`
      }
      pie="Puedes guardarla igual. Revisa si hace falta mover alguna."
    />
  );
}

/**
 * Situación financiera del paciente en la fila de la agenda (G-3).
 *
 * Tres estados y no dos: "sin datos" (el paciente no tiene ningún plan
 * facturado todavía) es distinto de "al día" (tiene planes y no debe nada), y
 * confundirlos haría que un paciente nuevo se vea igual que uno que ya pagó
 * todo. Regla 11 del CLAUDE.md: placeholder nullable, nunca fabricar el cero.
 */
function SaldoBadge({
  saldoCents,
  currency,
}: {
  saldoCents: number | undefined;
  currency: string;
}) {
  if (saldoCents === undefined) {
    return <span className="text-[11px] text-muted-foreground">Sin datos</span>;
  }
  if (saldoCents > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
        Debe {formatMoney(saldoCents, currency)}
      </span>
    );
  }
  if (saldoCents < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-info-soft px-1.5 py-0.5 text-[11px] font-medium text-info">
        A favor {formatMoney(-saldoCents, currency)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-success-soft px-1.5 py-0.5 text-[11px] font-medium text-success">
      Al día
    </span>
  );
}

function NuevaCitaDialog({
  clinicId,
  userId,
  country,
  sucursales,
  profesionales,
  pacientes,
  allergyAlerts,
  pacienteInicial,
  onPacienteInicialConsumido,
  semilla,
  onSemillaConsumida,
  citas,
}: {
  clinicId: string;
  userId: string;
  country: string | undefined;
  sucursales: { id: string; nombre: string }[];
  profesionales: Profesional[];
  pacientes: { id: string; nombre: string }[];
  /** Citas cargadas, para avisar choques antes de guardar. */
  citas: Cita[];
  pacienteInicial?: string;
  onPacienteInicialConsumido?: () => void;
  /** Clic en un hueco de la grilla de día: profesional, su sucursal y la
   * hora (wall-clock de la sucursal, ver agenda-hueco.ts) ya puestos. Mismo
   * patrón que `pacienteInicial`: se aplica una vez y se avisa que se usó.
   * `origen` es el hueco clicado, para devolverle el foco al cerrar. */
  semilla?: (SemillaCita & { origen?: HTMLElement | null }) | null;
  onSemillaConsumida?: () => void;
  /** patientId -> alergias, ver listAllergyAlerts. Ausente/vacío = sin
   * aviso (RLS restringe a owner/admin/dentist/assistant, o el rol no
   * tiene clinical:view — ver agenda.tsx). */
  allergyAlerts?: Record<string, string[]>;
}) {
  const zona = useZonaClinica();
  const [open, setOpen] = useState(false);
  const [pacienteId, setPacienteId] = useState("");
  const [sucursalId, setSucursalId] = useState("");
  const [profesionalId, setProfesionalId] = useState("");
  const [tratamiento, setTratamiento] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [duracion, setDuracion] = useState(30);

  // Con una sola sucursal o un solo profesional no hay nada que elegir:
  // se completan solos (antes eran dos selects obligatorios igual).
  function completarUnicos() {
    if (sucursales.length === 1) setSucursalId((v) => v || sucursales[0].id);
    if (profesionales.length === 1) setProfesionalId((v) => v || profesionales[0].id);
  }

  useEffect(() => {
    const pedido = interpretarNuevaCita(pacienteInicial);
    if (!pedido.abrir) return;
    if (pedido.pacienteId) setPacienteId(pedido.pacienteId);
    completarUnicos();
    setOpen(true);
    onPacienteInicialConsumido?.();
    // completarUnicos lee props estables de esta render; solo importa el seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacienteInicial]);

  // Al cerrar, Radix devuelve el foco al botón "Nueva cita" de arriba: si se
  // abrió desde un hueco de la grilla, eso salta el scroll al tope de la
  // página. Se devuelve al hueco (o, si ya no existe porque la cita lo ocupó,
  // al botón pero sin mover el scroll).
  const origenFoco = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!semilla) return;
    if (semilla.sucursalId) setSucursalId(semilla.sucursalId);
    setProfesionalId(semilla.profesionalId);
    setStartsAt(semilla.startsAt);
    origenFoco.current = semilla.origen ?? null;
    completarUnicos();
    setOpen(true);
    onSemillaConsumida?.();
    // Igual que arriba: solo importa la semilla nueva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semilla]);

  const createFn = useServerFn(createAppointment);
  const fetchProcedures = useServerFn(listProcedures);
  const proceduresQuery = useQuery({
    queryKey: ["procedures", clinicId],
    queryFn: () => fetchProcedures({ data: { clinicId } }),
  });
  const procedimientoSeleccionado = proceduresQuery.data?.find(
    (p) => p.name.trim().toLowerCase() === tratamiento.trim().toLowerCase(),
  );

  // Feriados (Nager.Date) del país de la clínica, para avisarle al staff si
  // agendó sobre un feriado (no bloquea: la clínica puede igual atender).
  const startsYear = startsAt ? Number(startsAt.slice(0, 4)) : new Date().getFullYear();
  const { holidaysByDate } = usePublicHolidays(country, [startsYear]);
  const feriadoSeleccionado = startsAt ? (holidaysByDate.get(startsAt.slice(0, 10)) ?? null) : null;

  const disponibles = profesionales.filter((p) => !sucursalId || p.sucursalId === sucursalId);

  const crear = useOfflineMutation({
    kind: "crear-cita",
    userId,
    ejecutar: (payload) => createFn({ data: payload }),
    invalidar: [["appointments", clinicId]],
    resumen: (p) => `Cita: ${String(p.tratamiento)}`,
    // Aviso SOLAPADO, no bloqueo (ver appointments.functions.ts): el server
    // igual creó la cita, esto solo le avisa a quien agenda que otra cita
    // del mismo profesional ya ocupa (parte de) ese horario, por si fue un
    // error y prefiere reagendar a mano.
    onExito: (resultado) => avisarSiSolapa(resultado, zona),
    onDone: () => {
      setOpen(false);
      setPacienteId("");
      setSucursalId("");
      setProfesionalId("");
      setTratamiento("");
      setStartsAt("");
      setDuracion(30);
    },
  });

  function agendar() {
    void crear.mutar({
      // Igual que en los cobros: el id sale del equipo para que reintentar
      // la cola no agende la misma cita dos veces.
      id: crypto.randomUUID(),
      clinicId,
      branchId: sucursalId,
      patientId: pacienteId,
      professionalId: profesionalId,
      tratamiento: tratamiento.trim(),
      procedureId: procedimientoSeleccionado?.id,
      // `startsAt` viaja como wall-clock crudo y el servidor lo interpreta en
      // la timezone de la sucursal. Es determinista: da igual si esto se
      // sincroniza dentro de tres días, la hora agendada no se corre.
      startsAt,
      duracionMin: duracion,
    });
  }

  const puedeCrear = pacienteId && sucursalId && profesionalId && tratamiento.trim() && startsAt;
  const choques = useChoquesDelFormulario({
    citas,
    profesionales,
    pacienteId,
    profesionalId,
    sucursalId,
    startsAt,
    duracion,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) completarUnicos();
      }}
    >
      <BloqueoEscritura>
        <DialogTrigger asChild>
          <Button ref={triggerRef} size="sm">
            <Plus className="size-4" /> Nueva cita
          </Button>
        </DialogTrigger>
      </BloqueoEscritura>
      <DialogContent
        onCloseAutoFocus={(e) => {
          const origen = origenFoco.current;
          origenFoco.current = null;
          if (!origen) return;
          e.preventDefault();
          const destino = origen.isConnected ? origen : triggerRef.current;
          destino?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle>Nueva cita</DialogTitle>
          <DialogDescription>
            La hora se interpreta en el huso horario de la sucursal seleccionada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="nc-paciente">Paciente</Label>
            <PatientCombobox
              id="nc-paciente"
              value={pacienteId}
              onChange={setPacienteId}
              pacientes={pacientes}
            />
            {pacienteId && <AllergyAlertBanner allergies={allergyAlerts?.[pacienteId] ?? []} />}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nc-sucursal">Sucursal</Label>
              <select
                id="nc-sucursal"
                value={sucursalId}
                onChange={(e) => {
                  setSucursalId(e.target.value);
                  setProfesionalId("");
                }}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              >
                <option value="">Elegir sucursal…</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-profesional">Profesional</Label>
              <select
                id="nc-profesional"
                value={profesionalId}
                onChange={(e) => setProfesionalId(e.target.value)}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              >
                <option value="">Elegir profesional…</option>
                {disponibles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-tratamiento">Tratamiento / motivo</Label>
            <input
              id="nc-tratamiento"
              value={tratamiento}
              onChange={(e) => setTratamiento(e.target.value)}
              placeholder="Ej: Control, limpieza…"
              list="nc-procedimientos"
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
            />
            <datalist id="nc-procedimientos">
              {(proceduresQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            {procedimientoSeleccionado && (
              <p className="text-[11px] text-muted-foreground">
                Ligado al procedimiento del catálogo — se reflejará en presupuestos futuros.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nc-inicio">Fecha y hora</Label>
              <input
                id="nc-inicio"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-duracion">Duración (min)</Label>
              <input
                id="nc-duracion"
                type="number"
                min={5}
                max={480}
                step={5}
                value={duracion}
                onChange={(e) => setDuracion(Number(e.target.value))}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              />
            </div>
          </div>
          {feriadoSeleccionado && <HolidayNotice name={feriadoSeleccionado} />}
          <ChoquesDelFormulario
            conflictos={choques}
            profesionales={profesionales}
            profesionalId={profesionalId}
          />
        </div>
        <DialogFooter>
          <Button onClick={agendar} disabled={crear.enCurso || !puedeCrear}>
            {crear.enCurso && <Loader2 className="size-3.5 animate-spin" />}
            {choques.length > 0 ? "Agendar igual" : "Agendar cita"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Reprograma una cita existente en el mismo diálogo de "Nueva cita" pero
 * precargado — antes la única forma de mover una cita era cancelarla y
 * volver a agendar desde cero, perdiendo el historial de WhatsApp ligado a
 * ese `appointmentId` (auditoría UX, 30-ago).
 */
function EditarCitaDialog({
  clinicId,
  userId,
  country,
  cita,
  sucursales,
  profesionales,
  citas,
}: {
  clinicId: string;
  userId: string;
  country: string | undefined;
  cita: Cita;
  sucursales: { id: string; nombre: string }[];
  profesionales: Profesional[];
  citas: Cita[];
}) {
  const zona = useZonaClinica();
  const [open, setOpen] = useState(false);
  const [sucursalId, setSucursalId] = useState(cita.sucursalId);
  const [profesionalId, setProfesionalId] = useState(cita.profesionalId);
  const [tratamiento, setTratamiento] = useState(cita.tratamiento);
  const [startsAt, setStartsAt] = useState(`${cita.fecha}T${horaDeCita(cita.inicio)}`);
  const [duracion, setDuracion] = useState(cita.duracion);

  function reabrirConValoresActuales(next: boolean) {
    if (next) {
      setSucursalId(cita.sucursalId);
      setProfesionalId(cita.profesionalId);
      setTratamiento(cita.tratamiento);
      setStartsAt(`${cita.fecha}T${horaDeCita(cita.inicio)}`);
      setDuracion(cita.duracion);
    }
    setOpen(next);
  }

  const updateFn = useServerFn(updateAppointment);
  const fetchProcedures = useServerFn(listProcedures);
  const proceduresQuery = useQuery({
    queryKey: ["procedures", clinicId],
    queryFn: () => fetchProcedures({ data: { clinicId } }),
    enabled: open,
  });
  const procedimientoSeleccionado = proceduresQuery.data?.find(
    (p) => p.name.trim().toLowerCase() === tratamiento.trim().toLowerCase(),
  );

  const startsYear = startsAt ? Number(startsAt.slice(0, 4)) : new Date().getFullYear();
  const { holidaysByDate } = usePublicHolidays(country, [startsYear]);
  const feriadoSeleccionado = startsAt ? (holidaysByDate.get(startsAt.slice(0, 10)) ?? null) : null;

  const disponibles = profesionales.filter((p) => !sucursalId || p.sucursalId === sucursalId);

  const editar = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          appointmentId: cita.id,
          clinicId,
          branchId: sucursalId,
          professionalId: profesionalId,
          tratamiento: tratamiento.trim(),
          procedureId: procedimientoSeleccionado?.id,
          startsAt,
          duracionMin: duracion,
        },
      }),
    onSuccess: (resultado) => {
      avisarSiSolapa(resultado, zona);
      toast.success("Cita actualizada.");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const puedeGuardar = sucursalId && profesionalId && tratamiento.trim() && startsAt;
  const choques = useChoquesDelFormulario({
    citas: open ? citas : SIN_CITAS,
    profesionales,
    citaId: cita.id,
    pacienteId: cita.pacienteId,
    profesionalId,
    sucursalId,
    startsAt,
    duracion,
  });

  return (
    <Dialog open={open} onOpenChange={reabrirConValoresActuales}>
      <DialogTrigger asChild>
        <button
          type="button"
          title="Editar cita"
          aria-label="Editar cita"
          className="inline-flex size-6 pointer-coarse:size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cita</DialogTitle>
          <DialogDescription>
            {cita.paciente} · la hora se interpreta en el huso horario de la sucursal seleccionada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ec-sucursal">Sucursal</Label>
              <select
                id="ec-sucursal"
                value={sucursalId}
                onChange={(e) => {
                  setSucursalId(e.target.value);
                  setProfesionalId("");
                }}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              >
                <option value="">Elegir sucursal…</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-profesional">Profesional</Label>
              <select
                id="ec-profesional"
                value={profesionalId}
                onChange={(e) => setProfesionalId(e.target.value)}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              >
                <option value="">Elegir profesional…</option>
                {disponibles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ec-tratamiento">Tratamiento / motivo</Label>
            <input
              id="ec-tratamiento"
              value={tratamiento}
              onChange={(e) => setTratamiento(e.target.value)}
              placeholder="Ej: Control, limpieza…"
              list="ec-procedimientos"
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
            />
            <datalist id="ec-procedimientos">
              {(proceduresQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ec-inicio">Fecha y hora</Label>
              <input
                id="ec-inicio"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-duracion">Duración (min)</Label>
              <input
                id="ec-duracion"
                type="number"
                min={5}
                max={480}
                step={5}
                value={duracion}
                onChange={(e) => setDuracion(Number(e.target.value))}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              />
            </div>
          </div>
          {feriadoSeleccionado && <HolidayNotice name={feriadoSeleccionado} />}
          <ChoquesDelFormulario
            conflictos={choques}
            profesionales={profesionales}
            profesionalId={profesionalId}
          />
        </div>
        <DialogFooter>
          <Button onClick={() => editar.mutate()} disabled={editar.isPending || !puedeGuardar}>
            {editar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {choques.length > 0 ? "Guardar igual" : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgendarSolicitudDialog({
  clinicId,
  country,
  sucursales,
  profesionales,
  request,
  open,
  onOpenChange,
  citas,
}: {
  clinicId: string;
  country: string | undefined;
  sucursales: { id: string; nombre: string }[];
  profesionales: Profesional[];
  citas: Cita[];
  request: PendingAppointmentRequest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const zona = useZonaClinica();
  const [sucursalId, setSucursalId] = useState("");
  const [profesionalId, setProfesionalId] = useState("");
  const [duracion, setDuracion] = useState(30);
  const [startsAt, setStartsAt] = useState(`${request.preferredDate}T09:00`);

  const queryClient = useQueryClient();
  const createFn = useServerFn(createAppointment);
  const markScheduledFn = useServerFn(markAppointmentRequestScheduled);

  // Feriados (Nager.Date) del país de la clínica — el paciente pidió esta
  // fecha desde el portal sin saber si es feriado; se lo marcamos al staff
  // acá, en el momento de confirmar la hora real.
  const startsYear = startsAt ? Number(startsAt.slice(0, 4)) : new Date().getFullYear();
  const { holidaysByDate } = usePublicHolidays(country, [startsYear]);
  const feriadoSeleccionado = startsAt ? (holidaysByDate.get(startsAt.slice(0, 10)) ?? null) : null;

  const disponibles = profesionales.filter((p) => !sucursalId || p.sucursalId === sucursalId);

  const agendar = useMutation({
    mutationFn: async () => {
      const { id, solapamiento } = await createFn({
        data: {
          clinicId,
          branchId: sucursalId,
          patientId: request.patientId,
          professionalId: profesionalId,
          tratamiento: request.reason.slice(0, 200),
          startsAt,
          duracionMin: duracion,
        },
      });
      await markScheduledFn({ data: { clinicId, requestId: request.id, appointmentId: id } });
      return { solapamiento };
    },
    onSuccess: ({ solapamiento }) => {
      queryClient.invalidateQueries({ queryKey: ["appointments", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["appointment-requests", clinicId] });
      toast.success("Cita agendada y solicitud cerrada");
      // Aviso SOLAPADO, no bloqueo — ver appointments.functions.ts.
      avisarSiSolapa({ solapamiento }, zona);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const puedeAgendar = sucursalId && profesionalId && startsAt;
  const choques = useChoquesDelFormulario({
    citas,
    profesionales,
    pacienteId: request.patientId,
    profesionalId,
    sucursalId,
    startsAt,
    duracion,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agendar solicitud de {request.patientName}</DialogTitle>
          <DialogDescription>{request.reason}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="as-sucursal">Sucursal</Label>
              <select
                id="as-sucursal"
                value={sucursalId}
                onChange={(e) => {
                  setSucursalId(e.target.value);
                  setProfesionalId("");
                }}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              >
                <option value="">Elegir sucursal…</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as-profesional">Profesional</Label>
              <select
                id="as-profesional"
                value={profesionalId}
                onChange={(e) => setProfesionalId(e.target.value)}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              >
                <option value="">Elegir profesional…</option>
                {disponibles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="as-inicio">Fecha y hora</Label>
              <input
                id="as-inicio"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as-duracion">Duración (min)</Label>
              <input
                id="as-duracion"
                type="number"
                min={5}
                max={480}
                step={5}
                value={duracion}
                onChange={(e) => setDuracion(Number(e.target.value))}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              />
            </div>
          </div>
          {feriadoSeleccionado && <HolidayNotice name={feriadoSeleccionado} />}
          <ChoquesDelFormulario
            conflictos={choques}
            profesionales={profesionales}
            profesionalId={profesionalId}
          />
        </div>
        <DialogFooter>
          <Button onClick={() => agendar.mutate()} disabled={agendar.isPending || !puedeAgendar}>
            {agendar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {choques.length > 0 ? "Confirmar igual" : "Confirmar cita"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Agrega a la lista de espera. El paciente es opcional en el server (puedes
 * anotar a alguien sin ficha todavía), pero acá lo pedimos siempre — sin
 * paciente vinculado no hay teléfono, y entonces la fila nunca va a poder
 * recibir el aviso de "Avisar" por WhatsApp cuando se libera un turno.
 */
function AgregarListaEsperaDialog({
  clinicId,
  pacientes,
}: {
  clinicId: string;
  pacientes: { id: string; nombre: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pacienteId, setPacienteId] = useState("");
  const [motivo, setMotivo] = useState("");

  const queryClient = useQueryClient();
  const createFn = useServerFn(createWaitlistEntry);

  const crear = useMutation({
    mutationFn: () =>
      createFn({ data: { clinicId, patientId: pacienteId, reason: motivo.trim() || undefined } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist", clinicId] });
      toast.success("Agregado a la lista de espera");
      setOpen(false);
      setPacienteId("");
      setMotivo("");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-3.5" /> Agregar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar a lista de espera</DialogTitle>
          <DialogDescription>
            Cuando se libere un turno, vas a poder avisarle por WhatsApp con un click.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="le-paciente">Paciente</Label>
            <PatientCombobox
              id="le-paciente"
              value={pacienteId}
              onChange={setPacienteId}
              pacientes={pacientes}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="le-motivo">Motivo (opcional)</Label>
            <input
              id="le-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: Control, limpieza…"
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => crear.mutate()} disabled={crear.isPending || !pacienteId}>
            {crear.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SIN_CITAS: Cita[] = [];

/** Lo que el paciente eligió en el portal (`portal.inicio.tsx`). */
const URGENCIA_PORTAL = {
  alta: "alta, dolor o urgencia",
  media: "media, esta semana",
  baja: "baja, puede esperar",
} as const;

const IMPORT_APPT_MAX_FILAS = 1000;

type FilaCitaCsv = {
  documentoPaciente: string;
  profesional?: string;
  sucursal?: string;
  fechaHora: string;
  tratamiento: string;
  duracionMin?: number;
};

/** Especificacion de columnas para el mapeo (recomendacion #5 del benchmark
 *  de onboarding, 25-sep-2026): los alias cubren los exports mas comunes
 *  (Dentalink, planillas propias); cuando el CSV real trae otra cosa,
 *  `CsvColumnMapper` deja elegir la columna a mano - ver
 *  src/lib/csv/column-mapping.ts para el diseno completo. */
const CAMPOS_CITA: CsvFieldSpec[] = [
  {
    key: "documentoPaciente",
    label: "Documento paciente",
    required: true,
    aliases: ["documento", "documento_paciente", "rut", "rut_paciente"],
  },
  {
    key: "profesional",
    label: "Profesional",
    required: false,
    aliases: ["profesional", "dentista", "doctor"],
  },
  { key: "sucursal", label: "Sucursal", required: false, aliases: ["sucursal"] },
  {
    key: "fechaHora",
    label: "Fecha y hora",
    required: true,
    aliases: ["fecha_hora", "fechahora", "fecha"],
  },
  { key: "tratamiento", label: "Tratamiento", required: true, aliases: ["tratamiento", "motivo"] },
  {
    key: "duracionMin",
    label: "Duracion (min)",
    required: false,
    aliases: ["duracion", "duracion_min"],
  },
];

/** Importador CSV de citas futuras - recomendacion #4 del benchmark de
 * onboarding (25-sep-2026). A diferencia de `ImportarPacientesDialog`, cada
 * fila puede fallar por ambiguedad de matching (profesional/sucursal no
 * encontrados o duplicados) - por eso el preview siempre muestra el motivo
 * exacto de cada skip, nunca solo un conteo. */
function ImportarCitasDialog({ clinicId }: { clinicId: string }) {
  const [open, setOpen] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapeo, setMapeo] = useState<Record<string, string | null>>({});
  const [necesitaMapeo, setNecesitaMapeo] = useState(false);
  const [filas, setFilas] = useState<FilaCitaCsv[]>([]);
  const [incompletas, setIncompletas] = useState(0);
  const [truncado, setTruncado] = useState(false);
  const [preview, setPreview] = useState<ImportAppointmentPreviewRow[] | null>(null);
  const [resultado, setResultado] = useState<ImportAppointmentsResult | null>(null);
  const queryClient = useQueryClient();

  const previewFn = useServerFn(previewImportAppointments);
  const importFn = useServerFn(importAppointments);

  const reset = () => {
    setHeaders([]);
    setRawRows([]);
    setMapeo({});
    setNecesitaMapeo(false);
    setFilas([]);
    setIncompletas(0);
    setTruncado(false);
    setPreview(null);
    setResultado(null);
  };

  const construirFilas = (
    mapping: Record<string, string | null>,
    rows: Record<string, string>[],
  ) => {
    const mapeadas = aplicarMapeo(rows, mapping, CAMPOS_CITA);
    const parseadas: FilaCitaCsv[] = [];
    let incompletasCount = 0;
    for (const m of mapeadas) {
      if (!m.documentoPaciente || !m.fechaHora || !m.tratamiento) {
        incompletasCount += 1;
        continue;
      }
      const n = m.duracionMin ? Number(m.duracionMin) : NaN;
      parseadas.push({
        documentoPaciente: m.documentoPaciente,
        profesional: m.profesional || undefined,
        sucursal: m.sucursal || undefined,
        fechaHora: m.fechaHora,
        tratamiento: m.tratamiento,
        duracionMin: Number.isFinite(n) ? n : undefined,
      });
    }
    setIncompletas(incompletasCount);
    setTruncado(parseadas.length > IMPORT_APPT_MAX_FILAS);
    setFilas(parseadas.slice(0, IMPORT_APPT_MAX_FILAS));
    setNecesitaMapeo(false);
  };

  const onFile = async (file: File) => {
    reset();
    try {
      const { headers: hs, rows } = await parseCsvRaw(file);
      const auto = autoDetectMapping(hs, CAMPOS_CITA);
      setHeaders(hs);
      setRawRows(rows);
      setMapeo(auto);
      if (faltanCamposObligatorios(auto, CAMPOS_CITA)) {
        setNecesitaMapeo(true);
      } else {
        construirFilas(auto, rows);
      }
    } catch (err) {
      toast.error("No pudimos leer el CSV: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const cargarPreview = useMutation({
    mutationFn: () => previewFn({ data: { clinicId, rows: filas } }),
    onSuccess: (res) => setPreview(res),
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const importar = useMutation({
    mutationFn: () => importFn({ data: { clinicId, rows: filas } }),
    onSuccess: (res) => {
      setResultado(res);
      queryClient.invalidateQueries({ queryKey: ["appointments", clinicId] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const aCrear = (preview ?? []).filter((p) => p.action === "create").length;
  const aSaltear = (preview ?? []).filter((p) => p.action === "skip").length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <FileUp className="size-4" /> Importar citas
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar citas futuras desde CSV</DialogTitle>
          <DialogDescription>
            Columnas: documento_paciente, fecha_hora (AAAA-MM-DD HH:mm), tratamiento. profesional y
            sucursal son obligatorias solo si la clínica tiene más de una — si hay una sola, se
            asigna sola. El paciente tiene que existir ya (impórtalo primero desde /pacientes).{" "}
            <a
              href="/plantillas/plantilla-citas.csv"
              download
              className="font-medium text-brand-700 underline underline-offset-2"
            >
              Descargar plantilla
            </a>{" "}
            (trae una fila de ejemplo: bórrala antes de subirla).
          </DialogDescription>
        </DialogHeader>

        {!resultado && !preview && necesitaMapeo && (
          <CsvColumnMapper
            fields={CAMPOS_CITA}
            headers={headers}
            sampleRow={rawRows[0]}
            mapping={mapeo}
            onChange={(key, header) => setMapeo((prev) => ({ ...prev, [key]: header }))}
          />
        )}

        {!resultado && !preview && !necesitaMapeo && (
          <div className="space-y-3">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
              className="w-full rounded-lg border border-dashed border-hairline px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium"
            />
            {filas.length > 0 && (
              <div className="rounded-lg border border-hairline p-3 text-xs text-muted-foreground">
                <p>
                  <strong className="text-foreground">{filas.length}</strong> cita
                  {filas.length === 1 ? "" : "s"} lista{filas.length === 1 ? "" : "s"} para revisar.
                  {incompletas > 0 &&
                    ` ${incompletas} fila(s) sin documento/fecha/tratamiento se ignoraron.`}
                </p>
                {truncado && (
                  <p className="mt-1 flex items-center gap-1 text-warning">
                    <AlertTriangle className="size-3.5" /> El archivo tiene más de{" "}
                    {IMPORT_APPT_MAX_FILAS} filas — se importarán solo las primeras{" "}
                    {IMPORT_APPT_MAX_FILAS}.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {!resultado && preview && (
          <div className="space-y-2 rounded-lg border border-hairline p-3 text-sm">
            <p>
              <strong className="text-foreground">{aCrear}</strong> se van a crear
              {aSaltear > 0 && (
                <>
                  {" "}
                  · <strong className="text-muted-foreground">{aSaltear}</strong> se van a saltear
                </>
              )}
              .
            </p>
            <ul className="max-h-56 space-y-1 overflow-y-auto text-xs text-muted-foreground">
              {preview.map((p) => (
                <li key={p.row} className={cn(p.action === "skip" && "line-through")}>
                  Fila {p.row}: {p.documentoPaciente} · {p.fechaHora}
                  {p.action === "create" && p.profesionalNombre && ` · ${p.profesionalNombre}`}
                  {p.nota && (
                    <span className={p.action === "skip" ? "text-destructive" : "text-warning"}>
                      {" "}
                      · {p.nota}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {resultado && (
          <div className="space-y-2 rounded-lg border border-hairline p-3 text-sm">
            <p>
              <strong className="text-success">{resultado.created}</strong> citas importadas.
            </p>
            {resultado.skipped > 0 && (
              <p className="text-muted-foreground">{resultado.skipped} se saltearon.</p>
            )}
            {resultado.warnings.length > 0 && (
              <p className="text-warning">
                {resultado.warnings.length} con choque de horario (se crearon igual).
              </p>
            )}
            {resultado.errors.length > 0 && (
              <p className="text-destructive">
                {resultado.errors.length} lote(s) fallaron: {resultado.errors[0].message}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {resultado ? (
            <Button onClick={() => setOpen(false)}>Listo</Button>
          ) : preview ? (
            <>
              <Button variant="outline" onClick={() => setPreview(null)}>
                Volver
              </Button>
              <Button
                onClick={() => importar.mutate()}
                disabled={importar.isPending || aCrear === 0}
              >
                {importar.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Importar {aCrear} cita{aCrear === 1 ? "" : "s"}
              </Button>
            </>
          ) : necesitaMapeo ? (
            <Button
              onClick={() => construirFilas(mapeo, rawRows)}
              disabled={faltanCamposObligatorios(mapeo, CAMPOS_CITA)}
            >
              Continuar
            </Button>
          ) : (
            <Button
              onClick={() => cargarPreview.mutate()}
              disabled={cargarPreview.isPending || filas.length === 0}
            >
              {cargarPreview.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Revisar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgendaPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const clinicId = access.clinic?.id;
  const hoy = hoyISO(access.clinic?.timezone);
  const fecha = fechaDeAgenda(search.fecha, access.clinic?.timezone);
  const puedeGestionarAgenda = Boolean(clinicId) && hasPermission(access.role, "agenda:manage");
  // Mismo criterio que `puedeFacturar` en la ficha del paciente.
  const puedeCobrar = hasPermission(access.role, "patients:manage");
  // Sin `vista` en la URL: lista en el celular (UX-02), día en el resto. En
  // el servidor y en la hidratación vale "día"; en el celular se corrige al
  // montar.
  const movil = useMediaQuery(QUERY_MOVIL);
  const vista: VistaAgenda = search.vista ?? (movil ? "lista" : "dia");
  // Semana: el panel lateral (solicitudes, lista de espera) se pliega para
  // que la grilla tenga el ancho entero (UX-01). Se abre a pedido.
  const [panelEnSemana, setPanelEnSemana] = useState(false);
  const panelPlegado = vista === "semana" && !panelEnSemana;
  const refFecha = useRef<HTMLInputElement>(null);
  const [semillaHueco, setSemillaHueco] = useState<
    (SemillaCita & { origen?: HTMLElement | null }) | null
  >(null);

  const fetchAppointments = useServerFn(listAppointments);
  const fetchBranches = useServerFn(listBranches);
  const fetchProfessionals = useServerFn(listProfessionals);
  const fetchPatients = useServerFn(listPatients);
  const fetchWaitlist = useServerFn(listWaitlist);
  const fetchAllergyAlerts = useServerFn(listAllergyAlerts);
  const fetchBalances = useServerFn(getAppointmentPatientBalances);

  const { data: appointmentsRes, isLoading } = useQuery({
    queryKey: ["appointments", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchAppointments({ data: { clinicId: clinicId! } }),
  });

  // Horario declarado por profesional: lo usan el arrastre (PR 10 del plan
  // A+) y la semana por carriles con ocupación por día (PR 10b).
  const fetchHorarios = useServerFn(listProfessionalSchedules);
  const { data: horarios } = useQuery({
    queryKey: ["professional-schedules", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchHorarios({ data: { clinicId: clinicId! } }),
  });
  const { pendientes: enColaOffline } = useColaOffline(access.userId);
  // Los movimientos que esperan conexión se pintan en su destino: si no,
  // la cita "volvería" a su hora vieja con cada refresco del cache.
  const { citas, enCola } = useMemo(
    () => aplicarMovimientosPendientes(appointmentsRes?.items ?? [], enColaOffline),
    [appointmentsRes, enColaOffline],
  );

  // Reemplaza la tarjeta "Optimización IA" (siempre vacía, "Próximamente" —
  // auditoría de UI, 30-ago) por un dato real: citas de las próximas 48h que
  // nadie confirmó todavía. Mismo criterio que el dashboard.
  const sinConfirmar48h = useMemo(() => {
    const limite = new Date(hoy);
    limite.setDate(limite.getDate() + 2);
    const limiteISO = limite.toISOString().slice(0, 10);
    return citas.filter((c) => c.fecha >= hoy && c.fecha <= limiteISO && c.estado === "tentativa");
  }, [citas, hoy]);
  // producto-1/ux-1: alergias por paciente para toda la clínica en 1 query
  // (no una por cita — ver listAllergyAlerts). Mismo gate que la ficha del
  // paciente (clinical:view): reception/accounting no ven este aviso, es
  // la misma restricción de RLS que ya rige patient_medical_history
  // (migración 20260826180000), no algo nuevo introducido acá.
  const { data: allergyAlerts = {} } = useQuery({
    queryKey: ["allergy-alerts", clinicId],
    enabled: Boolean(clinicId) && hasPermission(access.role, "clinical:view"),
    queryFn: () => fetchAllergyAlerts({ data: { clinicId: clinicId! } }),
  });

  const { data: sucursales = [] } = useQuery({
    queryKey: ["branches", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchBranches({ data: { clinicId: clinicId! } }),
  });
  const { data: profesionales = [] } = useQuery({
    queryKey: ["professionals", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchProfessionals({ data: { clinicId: clinicId! } }),
  });
  const { data: pacientesRes } = useQuery({
    queryKey: ["patients", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchPatients({ data: { clinicId: clinicId! } }),
  });
  const pacientes = useMemo(() => pacientesRes?.items ?? [], [pacientesRes]);
  const { data: listaEspera = [] } = useQuery({
    queryKey: ["waitlist", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchWaitlist({ data: { clinicId: clinicId! } }),
  });

  const nombreProfesional = useCallback(
    (id: string) => profesionales.find((p) => p.id === id)?.nombre ?? "el profesional",
    [profesionales],
  );
  const reprogramar = useReprogramarCita({
    clinicId,
    userId: access.userId,
    clinicName: access.clinic?.name,
    nombreProfesional,
  });
  const validarMovimiento = useCallback(
    (cita: Cita, destino: Destino) =>
      validarDestino({
        cita,
        destino,
        horario: horarioDelDia(horarios?.[destino.profesionalId], destino.fecha),
        citasDelCarril: citas.filter(
          (c) => c.fecha === destino.fecha && c.profesionalId === destino.profesionalId,
        ),
        nombreProfesional: nombreProfesional(destino.profesionalId),
      }),
    [horarios, citas, nombreProfesional],
  );
  const rechazarMovimiento = useCallback(
    (mensaje: string) => {
      reprogramar.avisar(mensaje);
      toast.error(mensaje);
    },
    [reprogramar],
  );
  const [citaAMover, setCitaAMover] = useState<Cita | null>(null);
  const puedeSimular = puedeSimularSinConexion(esCuentaDemo(access.email));

  const fetchSolicitudes = useServerFn(listPendingAppointmentRequests);
  const declineFn = useServerFn(declineAppointmentRequest);
  const queryClient = useQueryClient();

  const { data: solicitudes = [] } = useQuery({
    queryKey: ["appointment-requests", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchSolicitudes({ data: { clinicId: clinicId! } }),
  });

  const [solicitudEnAgenda, setSolicitudEnAgenda] = useState<PendingAppointmentRequest | null>(
    null,
  );

  const rechazar = useMutation({
    mutationFn: (requestId: string) => declineFn({ data: { clinicId: clinicId!, requestId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointment-requests", clinicId] });
      toast.success("Solicitud rechazada");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const removeWaitlistFn = useServerFn(removeWaitlistEntry);
  const quitarDeEspera = useMutation({
    mutationFn: (id: string) => removeWaitlistFn({ data: { clinicId: clinicId!, id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist", clinicId] });
      toast.success("Sacado de la lista de espera");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const setEstadoFn = useServerFn(setAppointmentStatus);
  const aceptarCita = useMutation({
    mutationFn: (appointmentId: string) =>
      setEstadoFn({ data: { appointmentId, estado: "confirmada" } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments", clinicId] });
      toast.success("Cita confirmada");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const set = (patch: Partial<AgendaSearch>) =>
    navigate({ search: (prev: AgendaSearch) => ({ ...prev, ...patch, page: patch.page ?? 1 }) });

  // Rango de fechas visible según la vista (día = un día; semana = L→D;
  // mes = primer→último del mes). El listado de abajo y las tres vistas
  // comparten este rango, así el conteo y el listado siempre concuerdan.
  const [rangoDesde, rangoHasta] = useMemo(() => rangoDeLaVista(vista, fecha), [vista, fecha]);

  // Choques de horario (UX-04) sobre todas las citas cargadas, sin los
  // filtros: un choque con una cita que el filtro esconde sigue siendo un
  // choque.
  const conflictos = useMemo(
    () => detectarConflictos(citas, profesionales),
    [citas, profesionales],
  );

  const filtradas = useMemo(
    () =>
      citas.filter((c) => {
        const profesionalNombre = profesionales.find((p) => p.id === c.profesionalId)?.nombre;
        if (!coincide(search.q, c.paciente, c.tratamiento, profesionalNombre)) return false;
        if (c.fecha < rangoDesde || c.fecha > rangoHasta) return false;
        if (search.sucursal && c.sucursalId !== search.sucursal) return false;
        if (search.profesional && c.profesionalId !== search.profesional) return false;
        if (search.estado && c.estado !== search.estado) return false;
        return true;
      }),
    [
      citas,
      profesionales,
      search.q,
      search.sucursal,
      search.profesional,
      search.estado,
      rangoDesde,
      rangoHasta,
    ],
  );

  const columnas = useMemo(
    () =>
      profesionales.filter((p) => {
        if (search.sucursal && p.sucursalId !== search.sucursal) return false;
        if (search.profesional && p.id !== search.profesional) return false;
        return true;
      }),
    [profesionales, search.sucursal, search.profesional],
  );

  // Ocupación de la semana: solo los filtros que cambian qué sillones se miden
  // (sucursal y profesional, vía `columnas`). La búsqueda y el estado no
  // cambian lo que está ocupado.
  const citasParaOcupacion = useMemo(
    () =>
      vista === "semana" ? citas.filter((c) => c.fecha >= rangoDesde && c.fecha <= rangoHasta) : [],
    [vista, citas, rangoDesde, rangoHasta],
  );

  const ordenadas = useMemo(
    () => [...filtradas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.inicio - b.inicio),
    [filtradas],
  );
  const pagina = paginar(ordenadas, search.page);

  // G-3: situación financiera de los pacientes visibles en la página, para que
  // recepción sepa a quién cobrarle antes de que entre al box. Una sola
  // agregación por lote (igual que las alergias), acotada a la página y no a
  // la clínica entera. Gate `finance:view`: un asistente clínico no ve deudas.
  const puedeVerSaldos = hasPermission(access.role, "finance:view");
  const pacienteIdsVisibles = useMemo(
    () => [...new Set(pagina.items.map((c) => c.pacienteId))].sort(),
    [pagina.items],
  );
  const { data: saldos = {} } = useQuery({
    queryKey: ["appointment-balances", clinicId, pacienteIdsVisibles],
    enabled: Boolean(clinicId) && puedeVerSaldos && pacienteIdsVisibles.length > 0,
    queryFn: () =>
      fetchBalances({ data: { clinicId: clinicId!, patientIds: pacienteIdsVisibles } }),
  });
  // La fecha ya no es un filtro (se navega con las flechas y "Ir a fecha"):
  // no cuenta como filtro activo ni se limpia con "Limpiar".
  const activos = [search.q, search.sucursal, search.profesional, search.estado].filter(
    Boolean,
  ).length;

  // Acciones de una cita: las comparten el popover de la grilla de día y el
  // panel lateral de la semana.
  const accionesDeCita = (c: Cita, p: Profesional) => (
    <>
      {/* Mismos gates que el listado de abajo y que la ficha:
        cambiar estado con agenda:manage, cobrar con
        patients:manage (`puedeFacturar` de la ficha). El
        servidor repite ambos chequeos. */}
      {clinicId && puedeGestionarAgenda && (
        <CambiarEstadoMenu
          clinicId={clinicId}
          userId={access.userId}
          appointmentId={c.id}
          estadoActual={c.estado}
          puedeConfirmar={puedeConfirmarCita(access, c.profesionalId)}
          variante="boton"
        />
      )}
      {puedeCobrar && (
        <Link
          to="/pacientes/$pacienteId"
          params={{ pacienteId: c.pacienteId }}
          search={{ cobrar: 1 }}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "justify-start pointer-coarse:h-11",
          )}
        >
          <Wallet aria-hidden /> Cobrar
        </Link>
      )}
      {clinicId && access.clinic?.name && (
        <WhatsAppButton
          variant="full"
          label="Recordatorio por WhatsApp"
          className="h-8 justify-start text-sm pointer-coarse:h-11"
          clinicId={clinicId}
          patientId={c.pacienteId}
          appointmentId={c.id}
          templateKind="appointment_reminder"
          variables={{
            tratamiento: c.tratamiento,
            fecha_larga: formatoFechaLarga(c.fecha),
            hora: horaDeCita(c.inicio),
            profesional: p.nombre,
            clinica: access.clinic.name,
          }}
        />
      )}
      {puedeGestionarAgenda && esMovible(c) && (
        <BloqueoEscritura>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-start pointer-coarse:h-11"
            onClick={() => setCitaAMover(c)}
          >
            <MoveRight aria-hidden /> Mover a…
          </Button>
        </BloqueoEscritura>
      )}
    </>
  );

  return (
    <AppShell title="Agenda" access={access}>
      <div className="space-y-6 max-md:space-y-4">
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {reprogramar.anuncio}
        </p>
        <MoverCitaDialog
          cita={citaAMover}
          profesionales={profesionales}
          horarios={horarios}
          validar={validarMovimiento}
          onMover={(c, d) => {
            void reprogramar.mover(c, d);
            enfocarCita(c.id);
          }}
          onClose={() => setCitaAMover(null)}
        />
        <div className="flex items-center justify-end gap-2">
          {/* Importar es trabajo de escritorio (un CSV): con el dedo no se ofrece. */}
          {clinicId && hasPermission(access.role, "agenda:manage") && (
            <div className="pointer-coarse:hidden">
              <ImportarCitasDialog clinicId={clinicId} />
            </div>
          )}
          {/* Solo demo y desarrollo: fuera de la barra principal (UX, Ola 0). */}
          {puedeSimular && <MasOpcionesAgenda enCola={enColaOffline.length} />}
          {clinicId && hasPermission(access.role, "agenda:manage") && (
            <NuevaCitaDialog
              clinicId={clinicId}
              userId={access.userId}
              country={access.clinic?.country}
              sucursales={sucursales}
              profesionales={profesionales}
              pacientes={pacientes}
              citas={citas}
              allergyAlerts={allergyAlerts}
              pacienteInicial={search.nueva}
              onPacienteInicialConsumido={() =>
                navigate({ search: (prev) => ({ ...prev, nueva: undefined }), replace: true })
              }
              semilla={semillaHueco}
              onSemillaConsumida={() => setSemillaHueco(null)}
            />
          )}
        </div>

        {appointmentsRes?.truncated && (
          <p className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-warning">
            Mostrando las primeras {numero(citas.length)} citas. Si buscas una cita muy antigua o
            muy futura, puede que no aparezca acá.
          </p>
        )}

        <FilterBar
          activos={activos}
          onReset={() =>
            navigate({
              search: (prev: AgendaSearch) => ({
                ...prev,
                q: "",
                sucursal: "",
                profesional: "",
                estado: "",
                page: 1,
              }),
            })
          }
        >
          <SearchField
            label="Buscar"
            value={search.q}
            onChange={(q) => set({ q })}
            placeholder="Paciente, tratamiento…"
          />
          <SelectField
            label="Sucursal"
            value={search.sucursal}
            onChange={(sucursal) => set({ sucursal, profesional: "" })}
            allLabel="Todas las sucursales"
            options={sucursales.map((s) => ({ value: s.id, label: s.nombre }))}
          />
          <SelectField
            label="Profesional"
            value={search.profesional}
            onChange={(profesional) => set({ profesional })}
            allLabel="Todos los profesionales"
            options={profesionales
              .filter((p) => !search.sucursal || p.sucursalId === search.sucursal)
              .map((p) => {
                const box = boxDe(p);
                return { value: p.id, label: box ? `${p.nombre} · ${box}` : p.nombre };
              })}
          />
          <SelectField
            label="Estado"
            value={search.estado}
            onChange={(estado) => set({ estado })}
            allLabel="Todos los estados"
            options={estados}
          />
        </FilterBar>

        {/* `grid-cols-1` y `min-w-0`: sin ellos la columna implícita crece al
            ancho mínimo de la grilla de la agenda y, en celular, la página
            queda más ancha que la pantalla. La grilla se desplaza adentro de
            su propio contenedor. En la semana el panel lateral se pliega y la
            grilla toma el ancho entero. */}
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
          <div
            className={cn(
              "min-w-0 space-y-4 max-md:space-y-3",
              panelPlegado ? "xl:col-span-12" : "xl:col-span-9",
            )}
          >
            {/* Barra de navegación: en el celular queda fija bajo el
                encabezado y es compacta (UX-02). */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 max-md:sticky max-md:top-[calc(4rem+env(safe-area-inset-top))] max-md:z-20 max-md:-mx-5 max-md:border-b max-md:border-hairline max-md:bg-background/95 max-md:px-5 max-md:py-2 max-md:backdrop-blur-sm">
              <div className="relative flex min-w-0 items-center gap-1.5 md:gap-2">
                <button
                  type="button"
                  aria-label="Período anterior"
                  onClick={() => set({ fecha: desplazarPeriodo(vista, fecha, -1) })}
                  className="grid size-8 shrink-0 place-items-center rounded-lg border border-control hover:bg-secondary/60 pointer-coarse:size-11"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => set({ fecha: hoy })}
                  className="shrink-0 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium hover:bg-secondary/60 pointer-coarse:min-h-11"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  aria-label="Período siguiente"
                  onClick={() => set({ fecha: desplazarPeriodo(vista, fecha, 1) })}
                  className="grid size-8 shrink-0 place-items-center rounded-lg border border-control hover:bg-secondary/60 pointer-coarse:size-11"
                >
                  <ChevronRight className="size-4" />
                </button>
                {/* Ir a una fecha lejana: reemplaza el filtro "Fecha" que
                    repetía la navegación. */}
                <button
                  type="button"
                  aria-label="Ir a una fecha"
                  title="Ir a una fecha"
                  onClick={() => {
                    const input = refFecha.current;
                    if (!input) return;
                    try {
                      input.showPicker();
                    } catch {
                      input.focus();
                    }
                  }}
                  className="grid size-8 shrink-0 place-items-center rounded-lg border border-hairline text-muted-foreground hover:bg-secondary/60 hover:text-foreground pointer-coarse:size-11"
                >
                  <CalendarDays className="size-4" aria-hidden />
                </button>
                <input
                  ref={refFecha}
                  type="date"
                  tabIndex={-1}
                  aria-hidden="true"
                  value={fecha}
                  onChange={(e) => e.target.value && set({ fecha: e.target.value })}
                  className="pointer-events-none absolute size-px opacity-0"
                />
                <h2 className="ml-1 min-w-0 truncate font-display text-lg font-semibold first-letter:uppercase max-md:text-base">
                  {vista === "dia" || vista === "lista" ? (
                    <>
                      <span className="md:hidden">{fechaCorta(fecha)}</span>
                      <span className="max-md:hidden">{labelPeriodo(vista, fecha)}</span>
                    </>
                  ) : (
                    labelPeriodo(vista, fecha)
                  )}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <div
                  role="group"
                  aria-label="Vista"
                  className="flex rounded-lg border border-hairline p-0.5 text-xs"
                >
                  {(["lista", "dia", "semana", "mes"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={vista === v}
                      onClick={() => set({ vista: v })}
                      className={cn(
                        "rounded-md px-2.5 py-1 font-medium pointer-coarse:min-h-11 pointer-coarse:px-3",
                        vista === v
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {NOMBRE_VISTA[v]}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {isLoading
                    ? "Cargando…"
                    : `${filtradas.length} cita${filtradas.length === 1 ? "" : "s"}`}
                </p>
                {vista === "semana" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="hidden xl:inline-flex"
                    aria-expanded={!panelPlegado}
                    aria-controls="agenda-panel-lateral"
                    onClick={() => setPanelEnSemana((v) => !v)}
                  >
                    {panelPlegado ? (
                      <PanelRightOpen aria-hidden />
                    ) : (
                      <PanelRightClose aria-hidden />
                    )}
                    {panelPlegado ? "Mostrar panel" : "Ocultar panel"}
                    {panelPlegado && solicitudes.length > 0 && (
                      <span className="rounded-full bg-brand-soft px-1.5 text-[11px] font-semibold text-brand-700">
                        {solicitudes.length}
                        <span className="sr-only"> solicitudes del portal</span>
                      </span>
                    )}
                  </Button>
                )}
              </div>
            </div>

            {(vista === "dia" || vista === "semana") && (
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                {vista === "dia" && puedeGestionarAgenda ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="pointer-coarse:hidden">
                      Arrastra una cita para moverla. Con teclado:{" "}
                      <kbd className="rounded border border-hairline px-1 font-mono text-[11px]">
                        Alt
                      </kbd>{" "}
                      + flechas.
                    </span>
                    <span className="hidden pointer-coarse:inline">
                      Mantén presionada una cita para moverla.
                    </span>
                  </p>
                ) : (
                  <span />
                )}
                <LeyendaAgenda
                  vista={vista}
                  profesionales={columnas}
                  hayChoques={filtradas.some((c) => conflictos.has(c.id))}
                />
              </div>
            )}
            {vista === "dia" && (
              <AgendaGrid
                arrastre={
                  {
                    habilitado: puedeGestionarAgenda,
                    validar: validarMovimiento,
                    onMover: (c, d) => void reprogramar.mover(c, d),
                    onRechazo: rechazarMovimiento,
                    enCola,
                    horarios,
                  } satisfies ArrastreGrilla
                }
                citas={filtradas}
                profesionales={columnas}
                allergyAlerts={allergyAlerts}
                fecha={fecha}
                esHoy={fecha === hoy}
                zonaHoraria={access.clinic?.timezone}
                onAgendarHueco={
                  puedeGestionarAgenda
                    ? (semilla, origen) => setSemillaHueco({ ...semilla, origen })
                    : undefined
                }
                renderAcciones={accionesDeCita}
                conflictos={conflictos}
                nombreProfesional={nombreProfesional}
              />
            )}
            {vista === "semana" && (
              <AgendaSemanaCarriles
                citas={filtradas}
                citasOcupacion={citasParaOcupacion}
                fecha={fecha}
                hoy={hoy}
                profesionales={columnas}
                horarios={horarios}
                zonaHoraria={access.clinic?.timezone}
                datosDesde={appointmentsRes?.truncated ? fechaMasAntigua(citas) : null}
                allergyAlerts={allergyAlerts}
                renderAcciones={accionesDeCita}
                conflictos={conflictos}
                nombreProfesional={nombreProfesional}
              />
            )}
            {vista === "mes" && (
              <AgendaMonth
                citas={filtradas}
                fecha={fecha}
                hoy={hoy}
                onSelectDay={(dia) => set({ fecha: dia, vista: "dia" })}
                profesionales={profesionales}
              />
            )}

            <div className="card-clinical overflow-hidden">
              <div className="border-b border-hairline bg-secondary/40 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground max-md:px-4">
                {vista === "lista" ? "Citas del día" : "Listado de citas filtradas"}
              </div>
              <div className="divide-y divide-hairline">
                {pagina.items.map((c) => {
                  const profesionalNombre =
                    profesionales.find((p) => p.id === c.profesionalId)?.nombre ?? "—";
                  const sucursalNombre =
                    sucursales.find((s) => s.id === c.sucursalId)?.nombre ?? "—";
                  const choque = resumenConflictos(conflictos.get(c.id));
                  // La fila es un contenedor, no un link: antes era un <Link>
                  // con botones, menú y WhatsApp adentro (interactivo dentro de
                  // interactivo, HTML inválido). Ahora el bloque de la cita es
                  // el link a la ficha y las acciones son sus hermanas.
                  return (
                    <div
                      key={c.id}
                      className="grid gap-2 px-5 py-3 transition-colors hover:bg-secondary/50 max-md:px-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                    >
                      <Link
                        to="/pacientes/$pacienteId"
                        params={{ pacienteId: c.pacienteId }}
                        className="grid gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:grid-cols-[auto_2fr_1.5fr_1fr] sm:items-center sm:gap-4"
                      >
                        <span className="cifra text-xs text-muted-foreground">
                          {vista === "semana" || vista === "mes" ? `${fechaCorta(c.fecha)} · ` : ""}
                          {horaDeCita(c.inicio)}
                        </span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1 truncate text-sm font-medium">
                            <span className="truncate">{c.paciente}</span>
                            <AllergyAlertIcon allergies={allergyAlerts[c.pacienteId]} />
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{c.tratamiento}</p>
                          {choque && (
                            <p
                              className="mt-0.5 inline-flex items-center gap-1 rounded bg-warning-soft px-1.5 py-px text-[11px] font-medium text-warning"
                              title={conflictos
                                .get(c.id)
                                ?.map((x) => `${x.cita.paciente} · ${horaDeCita(x.cita.inicio)}`)
                                .join("\n")}
                            >
                              <CalendarX2 className="size-3" aria-hidden />
                              {choque}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {profesionalNombre} · {sucursalNombre}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {c.duracion} min
                          {puedeVerSaldos && (
                            <SaldoBadge
                              saldoCents={saldos[c.pacienteId]}
                              currency={access.clinic?.currency ?? "CLP"}
                            />
                          )}
                        </span>
                      </Link>
                      {clinicId && hasPermission(access.role, "agenda:manage") ? (
                        <span className="flex items-center gap-1">
                          <PatientConfirmedToggle
                            clinicId={clinicId}
                            appointmentId={c.id}
                            confirmado={Boolean(c.pacienteConfirmo)}
                          />
                          <CambiarEstadoMenu
                            clinicId={clinicId}
                            userId={access.userId}
                            appointmentId={c.id}
                            estadoActual={c.estado}
                            puedeConfirmar={puedeConfirmarCita(access, c.profesionalId)}
                          />
                          <EditarCitaDialog
                            clinicId={clinicId}
                            userId={access.userId}
                            country={access.clinic?.country}
                            cita={c}
                            sucursales={sucursales}
                            profesionales={profesionales}
                            citas={citas}
                          />
                        </span>
                      ) : (
                        <EstadoCitaPastilla cita={{ estado: c.estado }} />
                      )}
                      {clinicId && access.clinic?.name && (
                        <WhatsAppButton
                          clinicId={clinicId}
                          patientId={c.pacienteId}
                          appointmentId={c.id}
                          templateKind="appointment_reminder"
                          variables={{
                            tratamiento: c.tratamiento,
                            fecha_larga: formatoFechaLarga(c.fecha),
                            hora: horaDeCita(c.inicio),
                            profesional: profesionalNombre,
                            clinica: access.clinic.name,
                          }}
                        />
                      )}
                    </div>
                  );
                })}
                {!isLoading && pagina.items.length === 0 && (
                  <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                    {vista === "lista"
                      ? "No hay citas este día con los filtros aplicados."
                      : "No hay citas que coincidan con los filtros aplicados."}
                  </p>
                )}
              </div>
              <Paginacion
                pagina={pagina}
                etiqueta="citas"
                onPage={(page) => navigate({ search: (p: AgendaSearch) => ({ ...p, page }) })}
              />
            </div>
          </div>

          <aside
            id="agenda-panel-lateral"
            className={cn("min-w-0 space-y-4 xl:col-span-3", panelPlegado && "xl:hidden")}
          >
            {solicitudes.length > 0 && (
              <>
                <h2 className="flex items-center gap-1.5 font-display text-xl font-semibold text-muted-foreground">
                  <Inbox className="size-4" /> Solicitudes del portal
                  <span className="ml-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                    {solicitudes.length}
                  </span>
                </h2>
                <div className="card-clinical divide-y divide-hairline">
                  {solicitudes.map((s) => (
                    <div key={s.id} className="space-y-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{s.patientName}</p>
                        <span
                          title={`Urgencia que eligió el paciente: ${URGENCIA_PORTAL[s.priority]}`}
                          className={cn(
                            "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                            s.priority === "alta"
                              ? "bg-destructive/10 text-destructive"
                              : s.priority === "media"
                                ? "bg-warning-soft text-warning"
                                : "bg-secondary text-muted-foreground",
                          )}
                        >
                          <span className="sr-only">Urgencia </span>
                          {s.priority}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.reason}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Prefiere: {formatoFechaLarga(s.preferredDate)}
                      </p>
                      {clinicId && hasPermission(access.role, "agenda:manage") && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="pointer-coarse:h-11"
                            onClick={() => setSolicitudEnAgenda(s)}
                          >
                            Agendar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground pointer-coarse:h-11"
                            disabled={rechazar.isPending}
                            onClick={() => rechazar.mutate(s.id)}
                          >
                            <X className="size-3.5" /> Rechazar
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-xl font-semibold text-muted-foreground">
                Lista de espera
              </h2>
              {clinicId && hasPermission(access.role, "agenda:manage") && (
                <AgregarListaEsperaDialog clinicId={clinicId} pacientes={pacientes} />
              )}
            </div>
            <div className="card-clinical divide-y divide-hairline">
              {listaEspera.length === 0 && (
                <p className="p-4 text-xs text-muted-foreground">
                  Sin pacientes en lista de espera por ahora.
                </p>
              )}
              {listaEspera.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{e.nombre}</p>
                      <p className="text-xs text-muted-foreground">{e.motivo}</p>
                      {e.espera !== "—" && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="size-3" /> {e.espera} de espera
                        </p>
                      )}
                      {!e.patientPhone && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Sin paciente vinculado — no se le puede avisar por WhatsApp.
                        </p>
                      )}
                    </div>
                  </div>
                  {clinicId && hasPermission(access.role, "agenda:manage") && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {e.patientId && access.clinic?.name && (
                        <WhatsAppButton
                          clinicId={clinicId}
                          patientId={e.patientId}
                          templateKind="waitlist_opening"
                          label="Avisar"
                          variables={{ motivo: e.motivo, clinica: access.clinic.name }}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => quitarDeEspera.mutate(e.id)}
                        disabled={quitarDeEspera.isPending}
                        title="Quitar de la lista"
                        aria-label="Quitar de la lista"
                        className="inline-flex size-7 pointer-coarse:size-11 items-center justify-center rounded-md border border-hairline text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-warning/20 bg-warning-soft p-5">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-warning">
                <CircleAlert className="size-3" /> Sin confirmar (48h)
              </p>
              {sinConfirmar48h.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Todo confirmado en las próximas 48h.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    {sinConfirmar48h.length} cita{sinConfirmar48h.length === 1 ? "" : "s"} sin
                    confirmar todavía:
                  </p>
                  <ul className="space-y-1.5">
                    {sinConfirmar48h.slice(0, 4).map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">
                          {c.paciente} · {formatoFechaLarga(c.fecha)} {horaDeCita(c.inicio)}
                        </span>
                        {puedeConfirmarCita(access, c.profesionalId) && (
                          <button
                            type="button"
                            onClick={() => aceptarCita.mutate(c.id)}
                            disabled={aceptarCita.isPending}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 transition-colors hover:bg-brand-soft disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:px-3"
                          >
                            Aceptar
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {clinicId && solicitudEnAgenda && (
        <AgendarSolicitudDialog
          clinicId={clinicId}
          country={access.clinic?.country}
          sucursales={sucursales}
          profesionales={profesionales}
          citas={citas}
          request={solicitudEnAgenda}
          open={Boolean(solicitudEnAgenda)}
          onOpenChange={(open) => !open && setSolicitudEnAgenda(null)}
        />
      )}
    </AppShell>
  );
}

/**
 * Más opciones de la agenda (solo demo y desarrollo). "Simular sin conexión"
 * fuerza el modo sin conexión para mostrar la cola en vivo; al apagarlo, la
 * cola se sincroniza sola si la red responde. Una clínica real no ve este
 * menú. Antes era un botón en la barra principal de la agenda (Ola 0).
 */
function MasOpcionesAgenda({ enCola }: { enCola: number }) {
  const { simulado } = useConnectivity();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Más opciones de la agenda"
          className="pointer-coarse:size-11"
        >
          {simulado ? <CloudOff aria-hidden /> : <Ellipsis aria-hidden />}
          {simulado && <span className="tabular-nums">{enCola} en cola</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Solo en la demo
        </DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={Boolean(simulado)}
          onCheckedChange={(activar) => {
            simularSinConexion(activar);
            if (activar)
              toast("Sin conexión: la agenda sigue abierta. Lo que cambies queda en cola.");
          }}
        >
          {simulado ? `Sin conexión · ${enCola} en cola` : "Simular sin conexión"}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
