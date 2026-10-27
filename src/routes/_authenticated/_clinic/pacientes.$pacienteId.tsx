import { useEffect, useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CalendarClock, Gift, Pencil, ShieldAlert, Tag } from "lucide-react";

import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EtiquetasDeLaFicha } from "@/components/pacientes/etiquetas-de-la-ficha";
import { SelloImportado } from "@/components/migracion/sello-importado";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requirePermission } from "@/lib/access/route-guards";
import { PacienteTimeline } from "@/components/paciente-timeline";
import { NotasClinicas } from "@/components/notas-clinicas";
import { ImplantesCard } from "@/components/ficha/implantes-card";
import { InterconsultasCard } from "@/components/ficha/interconsultas-card";
import { MedicalHistoryCard } from "@/components/medical-history-card";
import { FormularioPrevioPendiente } from "@/components/notificaciones/formulario-previo-pendiente";
import { VitalSignsCard } from "@/components/vital-signs-card";
import { PatientGuardiansCard } from "@/components/patient-guardians-card";
import { useGuardians } from "@/hooks/use-guardians";
import {
  alertasDeAnamnesis,
  conciliarCuestionario,
  riesgosDesdeAntecedentes,
} from "@/lib/clinical/anamnesis";
import { getMedicalHistory } from "@/lib/clinical/medical-history.functions";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { esMenorDeEdad, parentescoLegible, tutorPrincipal } from "@/lib/patients/tutor";
import { listAgreements, setPatientAgreement } from "@/lib/finance/clinic-finance.functions";
import { PatientDocumentsCard } from "@/components/patient-documents-card";
import { PatientConsentsCard } from "@/components/patient-consents-card";
import { PatientPrescriptionsCard } from "@/components/patient-prescriptions-card";
import { DocumentosEmitidosCard } from "@/components/documentos/documentos-emitidos-card";
import { ExamenesDelPaciente } from "@/components/examenes/examenes-del-paciente";
import { ExamenesDeLaPieza } from "@/components/examenes/examenes-de-la-pieza";
import { FirmasADistanciaCard } from "@/components/firma-distancia/firmas-a-distancia";
import { Odontogram } from "@/components/odontogram";
import { PeriodontalChart } from "@/components/periodontal-chart";
import { FinanceSection, type PiezaSeed } from "@/components/finance-section";
import { EmpresaYMembresiaFicha } from "@/components/finanzas/empresa-y-membresia-ficha";
import { MessagesHistory } from "@/components/messages-history";
import { WhatsAppOptInToggle } from "@/components/whatsapp-opt-in-toggle";
import { PortalLinkButton, RevokePortalAccessButton } from "@/components/portal-link-button";
import { ReferralCodeCard } from "@/components/referral-code-card";
import { EncabezadoPaciente } from "@/components/ficha/encabezado-paciente";
import { NotaSoapReciente } from "@/components/ficha/nota-soap-reciente";
import { PresupuestoPorFases } from "@/components/ficha/presupuesto-por-fases";
import { OrtodonciaEnLaFicha } from "@/components/ortodoncia/seguimiento-ortodoncia";
import { EditarPacienteDialog } from "@/components/editar-paciente-dialog";
import { CompletitudDeLaFicha, ContactoDeEmergencia } from "@/components/ficha-ola1";
import { ContadoresDeCitasFicha } from "@/components/ficha-contadores-citas";
import { faltantesDeLaFicha, textoPrevision } from "@/lib/patients/datos-ficha";
import { puedeEditarPaciente } from "@/lib/patients/editar-paciente";
import { motivosGes } from "@/lib/patients/ges";
import { useSoloLectura } from "@/hooks/use-solo-lectura";
import { EXPLICACION_BOTON_SOLO_LECTURA } from "@/lib/solo-lectura";
import { getPortalAccessState } from "@/lib/patients/portal.functions";
import { unirSinRepetir } from "@/lib/patients/fusion";
import { hasPermission } from "@/lib/access/access";
import { getMySubscription } from "@/lib/billing.functions";
import { requiereLlamadaOSuscripcion } from "@/lib/billing";
import { formatoFecha, type Paciente } from "@/lib/clinic-operations/clinic-data";
import { formatMoney } from "@/lib/finance/finance";
import { getPatient } from "@/lib/patients/patients.functions";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";
import {
  busquedaConPestana,
  parsePestana,
  pestanaVisible,
  validarBusquedaFicha,
  type PestanaFicha,
} from "@/components/ficha-busqueda";

/**
 * Pestañas de la ficha con el subrayado ocre del prototipo A+: 15 px
 * semibold, el filete de 2 px solo en la activa.
 */
const CLASE_PESTANA =
  "px-3.5 text-[15px] font-semibold text-muted-foreground data-[state=active]:text-foreground";

/** Bloque gris mientras carga: evita mostrar un valor por defecto que después cambia. */
function Esqueleto({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block animate-pulse rounded bg-muted motion-reduce:animate-none", className)}
    />
  );
}

export const Route = createFileRoute("/_authenticated/_clinic/pacientes/$pacienteId")({
  validateSearch: validarBusquedaFicha,
  // Datos demográficos (nombre, teléfono, próximo control) son de agenda/recepción,
  // no solo del equipo clínico — separado de "clinical:view" que gatea las notas.
  beforeLoad: requirePermission("patients:view"),
  loader: async ({ params, context }): Promise<{ paciente: Paciente }> => {
    const clinicId = context.access.clinic?.id;
    if (!clinicId) throw notFound();
    const paciente = await getPatient({ data: { clinicId, patientId: params.pacienteId } });
    if (!paciente) throw notFound();
    return { paciente };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Ficha no disponible | Esmalia" }, { name: "robots", content: "noindex" }],
      };
    }
    const titulo = `${loaderData.paciente.nombre} · Ficha clínica | Esmalia`;
    const desc = `Ficha clínica de ${loaderData.paciente.nombre}: timeline, saldo y próximos controles.`;
    return {
      meta: [
        { title: titulo },
        { name: "description", content: desc },
        { property: "og:title", content: titulo },
        { property: "og:description", content: desc },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  notFoundComponent: PacienteNoEncontrado,
  errorComponent: PacienteError,
  component: PacienteDetalle,
});

function PacienteNoEncontrado() {
  const { access } = Route.useRouteContext();
  return (
    <AppShell title="Paciente" access={access}>
      <p className="text-sm text-muted-foreground">
        No encontramos esa ficha.{" "}
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
          className="text-brand-700 hover:underline"
        >
          Volver al listado
        </Link>
      </p>
    </AppShell>
  );
}

function PacienteError() {
  const { access } = Route.useRouteContext();
  return (
    <AppShell title="Paciente" access={access}>
      <p className="text-sm text-muted-foreground">
        No pudimos cargar la ficha.{" "}
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
          className="text-brand-700 hover:underline"
        >
          Volver al listado
        </Link>
      </p>
    </AppShell>
  );
}

/**
 * Convenio del paciente en el encabezado de la ficha (Tanda B). Es un dato que
 * recepción necesita ver antes de presupuestar: define cuánto termina pagando
 * el paciente de cada prestación.
 */
function ConvenioDelPaciente({
  clinicId,
  patientId,
  convenioId,
  convenioNombre,
  afiliado,
  puedeEditar,
}: {
  clinicId: string;
  patientId: string;
  convenioId: string | null;
  /** Nombre que ya trae la ficha: se muestra sin esperar la lista de convenios. */
  convenioNombre: string | null;
  afiliado: string | null;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const fetchAgreements = useServerFn(listAgreements);
  const setFn = useServerFn(setPatientAgreement);
  const [editando, setEditando] = useState(false);
  const [seleccion, setSeleccion] = useState(convenioId ?? "");
  const [nroAfiliado, setNroAfiliado] = useState(afiliado ?? "");

  const { data: convenios = [], isLoading: cargandoConvenios } = useQuery({
    queryKey: ["agreements", clinicId],
    queryFn: () => fetchAgreements({ data: { clinicId } }),
  });

  const guardar = useMutation({
    mutationFn: () =>
      setFn({
        data: {
          clinicId,
          patientId,
          agreementId: seleccion || null,
          memberId: nroAfiliado.trim() || null,
        },
      }),
    onSuccess: () => {
      // El convenio viene del loader de la ruta, no de React Query — mismo
      // motivo por el que el saldo usa router.invalidate() y no invalidateQueries.
      void router.invalidate();
      setEditando(false);
      toast.success("Convenio actualizado");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const actual = convenios.find((c) => c.id === convenioId);
  // Sin el nombre en la ficha y con la lista cargando, todavía no se sabe
  // cuál es: "Particular" de entrada y el convenio después confundía.
  const nombre = actual?.name ?? convenioNombre ?? (convenioId ? null : "Particular");

  if (editando) {
    return (
      <div className="space-y-1.5">
        <p className="kicker" aria-hidden="true">
          Convenio
        </p>
        <Select
          value={seleccion || "particular"}
          onValueChange={(v) => setSeleccion(v === "particular" ? "" : v)}
        >
          <SelectTrigger aria-label="Convenio del paciente" className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="particular">Particular</SelectItem>
            {convenios.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {seleccion && (
          <input
            value={nroAfiliado}
            onChange={(e) => setNroAfiliado(e.target.value)}
            placeholder="Nº de afiliado"
            aria-label="Número de afiliado"
            className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
          />
        )}
        <div className="flex gap-1">
          <button
            onClick={() => guardar.mutate()}
            disabled={guardar.isPending}
            className="min-h-9 rounded px-1.5 text-xs font-medium text-brand-700 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            Guardar
          </button>
          <button
            onClick={() => setEditando(false)}
            className="min-h-9 rounded px-1.5 text-xs text-muted-foreground outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[13px] font-semibold text-muted-foreground" aria-hidden="true">
        Convenio
      </p>
      <p className="mt-1 truncate font-display text-2xl leading-tight font-medium">
        {nombre ?? (cargandoConvenios ? <Esqueleto className="mt-1 h-5 w-32" /> : "Convenio")}
      </p>
      {afiliado && <p className="text-xs text-muted-foreground">Afiliado {afiliado}</p>}
      {puedeEditar && (
        <button
          onClick={() => {
            setSeleccion(convenioId ?? "");
            setNroAfiliado(afiliado ?? "");
            setEditando(true);
          }}
          className="inline-flex min-h-9 items-center gap-1 rounded border border-dashed border-brand/40 px-1.5 text-xs font-medium text-brand-700 outline-none hover:bg-brand-soft focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Pencil className="size-3" /> Cambiar
        </button>
      )}
    </div>
  );
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-display text-2xl leading-tight font-medium">{children}</dd>
    </div>
  );
}

function PacienteDetalle() {
  const { access } = Route.useRouteContext();
  const { paciente } = Route.useLoaderData() as { paciente: Paciente };
  const currency = access.clinic?.currency ?? "CLP";
  const puedeVerClinico = hasPermission(access, "clinical:view");
  const puedeEscribirClinico = hasPermission(access, "clinical:write");
  const clinicId = access.clinic?.id;
  const puedeFacturar = hasPermission(access, "patients:manage");
  // La pestaña activa vive en la URL (`?pestana=`): recargar, volver atrás o
  // compartir el link abre la misma pestaña. `replace` para no llenar el
  // historial con un paso por pestaña, y sin resetear el scroll.
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const pestana = pestanaVisible(parsePestana(search.pestana), puedeVerClinico);
  const setPestana = (p: PestanaFicha) =>
    void navigate({
      search: (prev) => busquedaConPestana(prev, p),
      replace: true,
      resetScroll: false,
    });
  // FIC-17: la pestaña Exámenes filtrada por pieza (desde el odontograma o
  // desde una pieza de un examen). `null` quita el filtro.
  const verExamenesDePieza = (pieza: number | null) =>
    void navigate({
      search: (prev) => ({
        ...busquedaConPestana(prev, "examenes"),
        ...(pieza ? { pieza } : {}),
      }),
      replace: true,
      resetScroll: false,
    });

  // Puente odontograma → presupuesto (G-1). Ahora viven en pestañas
  // distintas: presupuestar una pieza lleva a "Presupuestos y pagos", donde
  // FinanceSection monta y consume la semilla. El `nonce` hace que clickear
  // dos veces la misma pieza vuelva a abrir el diálogo.
  const [piezaSeed, setPiezaSeed] = useState<PiezaSeed | null>(null);
  const [abrirPago, setAbrirPago] = useState(false);
  // `?cobrar=1` (botón "Cobrar" del popover de la agenda): abre el pago una
  // sola vez y se limpia de la URL, así recargar no lo vuelve a abrir. Sin
  // permiso de facturar solo se limpia: el botón de la agenda ya no se ofrece
  // a ese rol, pero el link se puede escribir a mano.
  useEffect(() => {
    if (!search.cobrar) return;
    if (puedeFacturar) setAbrirPago(true);
    // Una sola navegación: limpia `cobrar` y, si corresponde, pasa a la
    // pestaña de pagos (busquedaConPestana descarta `cobrar` siempre).
    void navigate({
      search: (prev) =>
        busquedaConPestana(prev, puedeFacturar ? "finanzas" : parsePestana(prev.pestana)),
      replace: true,
      resetScroll: false,
    });
  }, [search.cobrar, puedeFacturar, navigate]);

  // PR 11 (A+): al guardar una marca "por realizar", el odontograma ofrece
  // sumarla al presupuesto en borrador (además del botón "Presupuestar" de G-1).
  const sugerenciaPresupuesto = puedeFacturar
    ? { currency, onVerPresupuesto: () => setPestana("finanzas") }
    : undefined;

  const presupuestarPieza = puedeFacturar
    ? (pieza: Omit<PiezaSeed, "nonce">) => {
        setPiezaSeed({ ...pieza, nonce: Date.now() });
        setPestana("finanzas");
      }
    : undefined;

  const fetchMedicalHistory = useServerFn(getMedicalHistory);
  const medicalHistoryQuery = useQuery({
    queryKey: ["medical-history", clinicId, paciente.id],
    queryFn: () => fetchMedicalHistory({ data: { clinicId: clinicId!, patientId: paciente.id } }),
    enabled: Boolean(clinicId) && puedeVerClinico,
  });
  // Alertas de la anamnesis (CLI-10): las críticas (alergias, anticoagulantes,
  // embarazo) van en la cabecera, que queda fija al bajar por las pestañas.
  // CLI-06: las alergias de una ficha fusionada en esta también se avisan acá.
  const alergiasFusionadas = unirSinRepetir(
    ...(medicalHistoryQuery.data?.deFichasFusionadas ?? []).map((f) => f.allergies),
  ).filter(
    (n) =>
      !(medicalHistoryQuery.data?.allergyDetails ?? []).some(
        (a) => a.name.toLocaleLowerCase("es") === n.toLocaleLowerCase("es"),
      ),
  );
  // UX-14: lo que ya dicen los antecedentes también alerta, aunque el
  // cuestionario no se haya completado.
  const alertas = medicalHistoryQuery.data
    ? alertasDeAnamnesis({
        alergias: [
          ...medicalHistoryQuery.data.allergyDetails,
          ...alergiasFusionadas.map((name) => ({ name, severity: "unknown" as const })),
        ],
        cuestionario: conciliarCuestionario(
          medicalHistoryQuery.data.riskQuestionnaire,
          riesgosDesdeAntecedentes({
            antecedentes: medicalHistoryQuery.data.conditions,
            medicacion: medicalHistoryQuery.data.chronicMedications,
          }),
        ).efectivo,
      })
    : [];
  const alertasCriticas = alertas.filter((a) => a.nivel === "critica");
  const precauciones = alertas.filter((a) => a.nivel === "precaucion");

  // Menor de edad (CLI-11): la cabecera dice quién responde por él.
  const timezone = access.clinic?.timezone ?? undefined;
  const esMenor = esMenorDeEdad(paciente.fechaNacimiento, hoyISO(timezone));
  const guardiansQuery = useGuardians(clinicId ?? "", paciente.id);
  const tutor = tutorPrincipal(guardiansQuery.data?.items ?? []);

  // Gate del portal del paciente (día 1 del trial, no día 15 como los
  // informes) — ver requiereLlamadaOSuscripcion en billing.ts.
  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  const portalBloqueado = requiereLlamadaOSuscripcion(
    sub ?? null,
    access.clinic?.onboardingCallAt ?? null,
  );

  // "Revocar acceso" solo cuando puede haber un link vigente. Si la lectura
  // falla (`vigente: null`), el botón se muestra igual: cortar un link
  // filtrado nunca depende de esta consulta.
  const queryClient = useQueryClient();
  const puedeGestionarPortal = hasPermission(access, "patients:manage");
  const fetchPortalState = useServerFn(getPortalAccessState);
  const portalQuery = useQuery({
    queryKey: ["portal-access", clinicId, paciente.id],
    queryFn: () => fetchPortalState({ data: { clinicId: clinicId!, patientId: paciente.id } }),
    enabled: Boolean(clinicId) && puedeGestionarPortal && pestana === "mensajes",
  });
  const portalVigente = portalQuery.data ? portalQuery.data.vigente !== false : false;
  const refrescarPortal = () =>
    void queryClient.invalidateQueries({ queryKey: ["portal-access", clinicId, paciente.id] });

  // Ola 1 · Frente Pacientes: previsión (FIC-02), ficha completa (SEG-08) y GES (MKT-01).
  const esChile = (access.clinic?.country ?? "").toUpperCase() === "CL";
  const soloLectura = useSoloLectura();
  const [completando, setCompletando] = useState(false);
  const embarazada = medicalHistoryQuery.data ? alertas.some((a) => a.clave === "pregnancy") : null;
  const motivosDeGes = motivosGes({
    pais: access.clinic?.country,
    fechaNacimiento: paciente.fechaNacimiento,
    hoy: hoyISO(timezone),
    embarazada,
  });
  const faltantes = faltantesDeLaFicha(
    {
      prevision: paciente.prevision ?? null,
      documento: paciente.documento,
      fechaNacimiento: paciente.fechaNacimiento ?? null,
      direccion: paciente.direccion ?? null,
      comuna: paciente.comuna ?? null,
      // Solo cuenta cuando se sabe: sin acceso clínico o cargando, no se acusa.
      tieneAnamnesis:
        puedeVerClinico && medicalHistoryQuery.data
          ? medicalHistoryQuery.data.updatedAt != null
          : null,
    },
    esChile,
  );
  const puedeCompletar = Boolean(clinicId) && puedeEditarPaciente(access.role);
  const motivoSinPermiso = !puedeCompletar
    ? "Tu rol no puede editar los datos del paciente."
    : soloLectura
      ? EXPLICACION_BOTON_SOLO_LECTURA
      : null;
  const irALaAnamnesis = () => {
    setPestana("resumen");
    window.setTimeout(
      () => document.getElementById("anamnesis")?.scrollIntoView({ behavior: "smooth" }),
      50,
    );
  };

  const lineaPrevision = esChile
    ? textoPrevision({
        plan: paciente.prevision ?? null,
        tramo: paciente.previsionTramo ?? null,
        institucion: paciente.previsionInstitucion ?? null,
      })
    : null;

  // "Agregar adenda" y "Ver en notas" de la nota SOAP de la pestaña de
  // entrada abren la pestaña Notas con esa nota (y la adenda lista). El
  // `nonce` hace que pedir dos veces la misma nota vuelva a abrirla.
  const [notaPedida, setNotaPedida] = useState<{
    noteId: string;
    adenda: boolean;
    nonce: number;
  } | null>(null);
  const abrirNotas = (destino?: { noteId: string; adenda: boolean }) => {
    setNotaPedida(destino ? { ...destino, nonce: Date.now() } : null);
    setPestana("notas");
  };
  const puedeVerFinanzas = hasPermission(access, "finance:view");

  // Alerta crítica en la barra de pestañas fija: se sigue viendo al bajar.
  const alertaFija = puedeVerClinico ? alertasCriticas : [];

  return (
    <AppShell title="Ficha del paciente" access={access}>
      {/* Calma de recepción (A+): texto base de 16 px en toda la ficha. */}
      <div className="mx-auto max-w-[1180px] text-base">
        <EncabezadoPaciente
          access={access}
          paciente={paciente}
          lineaPrevision={lineaPrevision}
          puedeVerClinico={puedeVerClinico}
          cargandoAlertas={puedeVerClinico && medicalHistoryQuery.isLoading}
          alertasCriticas={alertasCriticas}
          precauciones={precauciones}
          motivosGes={motivosDeGes}
          menor={
            esMenor === true && guardiansQuery.data?.disponible
              ? { tutor: tutor ? `${tutor.fullName} (${parentescoLegible(tutor)})` : null }
              : null
          }
          onCobrar={() => {
            setPestana("finanzas");
            setAbrirPago(true);
          }}
        />

        {paciente.archivadaEl && (
          <p className="mt-4 rounded-lg border border-hairline bg-secondary/60 px-4 py-2.5 text-sm text-muted-foreground">
            Ficha archivada el {formatoFecha(paciente.archivadaEl.slice(0, 10))}
            {paciente.motivoArchivo ? ` (${paciente.motivoArchivo})` : ""}. No aparece en los
            listados ni en la búsqueda; su historia clínica se conserva completa.
          </p>
        )}

        {/* PAC-07: etiquetas de la ficha (se editan desde la lista). */}
        {clinicId && <EtiquetasDeLaFicha clinicId={clinicId} patientId={paciente.id} />}

        {clinicId && (
          <SelloImportado
            clinicId={clinicId}
            patientId={paciente.id}
            zona={access.clinic?.timezone}
          />
        )}

        <CompletitudDeLaFicha
          faltantes={faltantes}
          onCompletarDatos={() => setCompletando(true)}
          onCompletarAnamnesis={irALaAnamnesis}
          motivoSinPermiso={motivoSinPermiso}
        />
        {clinicId && puedeCompletar && (
          <EditarPacienteDialog
            clinicId={clinicId}
            country={access.clinic?.country ?? null}
            paciente={paciente}
            abierto={completando}
            onAbiertoChange={setCompletando}
          />
        )}

        {/* Datos clave y contadores de citas (Ola 2), en una franja con filetes. */}
        <section
          aria-label="Datos clave del paciente"
          className="mt-4 rounded-panel border border-border bg-card px-5 py-4"
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4 lg:divide-x lg:divide-border lg:[&>*]:pl-6 lg:[&>*:first-child]:pl-0">
            <Dato label="Próxima cita">{paciente.proximoControl ?? "Sin agendar"}</Dato>
            <Dato label="Saldo">
              {paciente.saldo == null
                ? "Sin movimientos"
                : paciente.saldo > 0
                  ? `${formatMoney(paciente.saldo, currency)} por cobrar`
                  : paciente.saldo < 0
                    ? `${formatMoney(-paciente.saldo, currency)} a favor`
                    : "Al día"}
            </Dato>
            <div className="min-w-0">
              <dt className="sr-only">Convenio</dt>
              <dd>
                {clinicId ? (
                  <ConvenioDelPaciente
                    clinicId={clinicId}
                    patientId={paciente.id}
                    convenioId={paciente.convenioId ?? null}
                    convenioNombre={paciente.convenioNombre ?? null}
                    afiliado={paciente.convenioAfiliado ?? null}
                    puedeEditar={puedeFacturar}
                  />
                ) : null}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[13px] font-semibold text-muted-foreground">
                Contacto de emergencia
              </dt>
              <dd className="mt-1 text-sm">
                <ContactoDeEmergencia contacto={paciente.contactoEmergencia} />
              </dd>
            </div>
          </dl>
          {clinicId && (
            <ContadoresDeCitasFicha
              clinicId={clinicId}
              patientId={paciente.id}
              timezone={timezone}
              className="mt-4 border-t border-border pt-4"
            />
          )}
        </section>

        <Tabs value={pestana} onValueChange={(v) => setPestana(v as PestanaFicha)} className="mt-5">
          {/* Barra de pestañas fija (desde lg), con la alerta crítica a la vista
              al bajar por cualquier pestaña, como antes hacía la cabecera. */}
          <div className="z-[5] flex items-end justify-between gap-4 border-b border-border bg-background/95 backdrop-blur-sm lg:sticky lg:top-16">
            <TabsList className="w-full justify-start gap-1 border-b-0">
              <TabsTrigger value="resumen" className={CLASE_PESTANA}>
                {puedeVerClinico ? "Odontograma" : "Resumen"}
              </TabsTrigger>
              {puedeVerClinico && (
                <TabsTrigger value="periodontograma" className={CLASE_PESTANA}>
                  Periodontograma
                </TabsTrigger>
              )}
              {puedeVerClinico && (
                <TabsTrigger value="notas" className={CLASE_PESTANA}>
                  Notas
                </TabsTrigger>
              )}
              <TabsTrigger value="finanzas" className={CLASE_PESTANA}>
                Presupuesto y pagos
              </TabsTrigger>
              <TabsTrigger value="anamnesis" className={CLASE_PESTANA}>
                {puedeVerClinico ? "Anamnesis y datos" : "Datos"}
              </TabsTrigger>
              {puedeVerClinico && (
                <TabsTrigger value="documentos" className={CLASE_PESTANA}>
                  Documentos
                </TabsTrigger>
              )}
              {puedeVerClinico && (
                <TabsTrigger value="examenes" className={CLASE_PESTANA}>
                  Exámenes
                </TabsTrigger>
              )}
              <TabsTrigger value="mensajes" className={CLASE_PESTANA}>
                Mensajes
              </TabsTrigger>
            </TabsList>
            {alertaFija.length > 0 && (
              <p
                className="mb-2 hidden max-w-xs shrink-0 items-center gap-1.5 rounded-full border border-destructive-border bg-destructive-soft px-3 py-1 text-xs font-semibold text-destructive xl:inline-flex"
                title={alertaFija.map((a) => a.texto).join(" · ")}
              >
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{alertaFija.map((a) => a.texto).join(" · ")}</span>
              </p>
            )}
          </div>

          <TabsContent value="resumen" className="mt-5 space-y-[18px]">
            {puedeVerClinico && clinicId && (
              <Odontogram
                clinicId={clinicId}
                patientId={paciente.id}
                puedeEditar={puedeEscribirClinico}
                userId={access.userId}
                onPresupuestarPieza={presupuestarPieza}
                sugerenciaPresupuesto={sugerenciaPresupuesto}
                // `edad` es 0 cuando no hay fecha de nacimiento: se trata como desconocida.
                edad={paciente.edad > 0 ? paciente.edad : null}
                extraDePieza={(pieza) => (
                  <ExamenesDeLaPieza
                    clinicId={clinicId}
                    patientId={paciente.id}
                    pieza={pieza}
                    onVer={verExamenesDePieza}
                  />
                )}
              />
            )}
            {clinicId && (puedeVerClinico || puedeVerFinanzas) && (
              <div
                className={cn(
                  "grid items-start gap-[18px]",
                  puedeVerClinico && puedeVerFinanzas && "xl:grid-cols-[1.1fr_1fr]",
                )}
              >
                {puedeVerClinico && (
                  <NotaSoapReciente
                    clinicId={clinicId}
                    patientId={paciente.id}
                    puedeEditar={puedeEscribirClinico}
                    onAbrirNotas={abrirNotas}
                  />
                )}
                {puedeVerFinanzas && (
                  <PresupuestoPorFases
                    clinicId={clinicId}
                    patientId={paciente.id}
                    onVerFinanzas={() => setPestana("finanzas")}
                  />
                )}
              </div>
            )}
            {puedeVerClinico && clinicId && (
              <OrtodonciaEnLaFicha
                clinicId={clinicId}
                patientId={paciente.id}
                hoy={hoyISO(timezone ?? undefined)}
                puedeEditar={puedeEscribirClinico}
              />
            )}
            {!puedeVerClinico && (
              <section
                aria-labelledby="timeline-resumen"
                className="rounded-panel border border-border bg-card p-5"
              >
                <h3 id="timeline-resumen" className="mb-4 font-display text-2xl font-medium">
                  Línea de tiempo
                </h3>
                <PacienteTimeline paciente={paciente} conEncabezado={false} />
              </section>
            )}
          </TabsContent>

          {puedeVerClinico && clinicId && (
            <TabsContent value="periodontograma">
              <PeriodontalChart
                clinicId={clinicId}
                patientId={paciente.id}
                puedeEditar={puedeEscribirClinico}
                userId={access.userId}
              />
            </TabsContent>
          )}

          {puedeVerClinico && (
            <TabsContent value="notas" className="space-y-[18px]">
              <NotasClinicas
                paciente={paciente}
                clinicId={clinicId ?? null}
                clinicaNombre={access.clinic?.name ?? "Esmalia"}
                puedeEditar={puedeEscribirClinico}
                userId={access.userId}
                rol={access.role}
                abrir={notaPedida}
              />
              {/* Ola 9 · frente B: interconsultas (FIC-14) e implantes (MKT-09). */}
              {clinicId && (
                <div className="grid items-start gap-[18px] xl:grid-cols-2">
                  <InterconsultasCard
                    clinicId={clinicId}
                    patientId={paciente.id}
                    puedeEditar={puedeEscribirClinico}
                    puedeEmitir={
                      puedeEscribirClinico &&
                      (access.role === "owner" ||
                        access.role === "admin" ||
                        access.role === "dentist")
                    }
                    timezone={timezone ?? "America/Santiago"}
                  />
                  <ImplantesCard
                    clinicId={clinicId}
                    patientId={paciente.id}
                    puedeEditar={puedeEscribirClinico}
                    timezone={timezone ?? "America/Santiago"}
                  />
                </div>
              )}
            </TabsContent>
          )}

          <TabsContent value="finanzas">
            {clinicId && (
              <EmpresaYMembresiaFicha
                clinicId={clinicId}
                patientId={paciente.id}
                patientName={paciente.nombre}
                timezone={access.clinic?.timezone ?? "America/Santiago"}
                rol={access}
              />
            )}
            {clinicId && access.clinic && (
              <FinanceSection
                clinicId={clinicId}
                clinicaNombre={access.clinic.name}
                currency={currency}
                patientId={paciente.id}
                puedeEditar={puedeFacturar}
                puedeReversarPagos={hasPermission(access, "payments:reverse")}
                userId={access.userId}
                piezaSeed={piezaSeed}
                onPiezaSeedConsumido={() => setPiezaSeed(null)}
                abrirPago={abrirPago}
                onPagoAbierto={() => setAbrirPago(false)}
              />
            )}
          </TabsContent>

          <TabsContent value="anamnesis">
            <div className="grid gap-[18px] lg:grid-cols-[1.4fr_1fr]">
              <div className="min-w-0 space-y-[18px]">
                {puedeVerClinico && clinicId ? (
                  <>
                    <FormularioPrevioPendiente
                      clinicId={clinicId}
                      patientId={paciente.id}
                      puedeRevisar={puedeEscribirClinico}
                      timezone={timezone ?? "America/Santiago"}
                    />
                    <div id="anamnesis" className="scroll-mt-48">
                      <MedicalHistoryCard
                        clinicId={clinicId}
                        patientId={paciente.id}
                        puedeEditar={puedeEscribirClinico}
                        userId={access.userId}
                      />
                    </div>
                    <VitalSignsCard
                      clinicId={clinicId}
                      patientId={paciente.id}
                      puedeEditar={puedeEscribirClinico}
                      timezone={timezone}
                    />
                  </>
                ) : (
                  <p className="flex items-center gap-3 rounded-panel border border-border p-6 text-sm text-muted-foreground">
                    <ShieldAlert className="size-4 shrink-0" aria-hidden />
                    Tu rol no tiene acceso a la historia clínica de este paciente.
                  </p>
                )}
              </div>
              <aside className="min-w-0 space-y-[18px]">
                {clinicId && (
                  <PatientGuardiansCard
                    clinicId={clinicId}
                    patientId={paciente.id}
                    esMenor={esMenor}
                    puedeEditar={hasPermission(access, "patients:manage")}
                  />
                )}
                <section
                  aria-labelledby="timeline"
                  className="rounded-panel border border-border bg-card p-5"
                >
                  <h3 id="timeline" className="mb-4 font-display text-2xl font-medium">
                    Línea de tiempo
                  </h3>
                  <PacienteTimeline paciente={paciente} conEncabezado={false} />
                </section>
                <section className="space-y-3 rounded-panel border border-border bg-card p-5 text-sm">
                  <p className="flex items-start gap-2">
                    <CalendarClock
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span>
                      <span className="block text-muted-foreground">Última visita</span>
                      {paciente.ultimaVisita || "Sin visitas registradas"}
                    </span>
                  </p>
                  {clinicId && puedeGestionarPortal && paciente.referralCode && (
                    <div className="flex items-start gap-2">
                      <Gift className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <ReferralCodeCard
                        clinicId={clinicId}
                        clinicCountry={access.clinic?.country ?? null}
                        patientName={paciente.nombre}
                        referralCode={paciente.referralCode}
                        variante="dato"
                      />
                    </div>
                  )}
                  {paciente.origen && (
                    <p className="text-sm text-muted-foreground">
                      Llegó por: {paciente.origen}
                      {paciente.origenDetalle ? ` · ${paciente.origenDetalle}` : ""}
                    </p>
                  )}
                  {paciente.etiquetas.length > 0 && (
                    <p className="flex items-start gap-2">
                      <Tag className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="flex flex-wrap gap-1">
                        {paciente.etiquetas.map((t) => (
                          <Badge key={t} variant="secondary">
                            {t}
                          </Badge>
                        ))}
                      </span>
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Riesgo de ausencia:{" "}
                    {paciente.riesgoAusencia == null
                      ? "sin calcular"
                      : `${paciente.riesgoAusencia}%`}
                    {" · "}
                    {paciente.waOptIn
                      ? "acepta mensajes de seguimiento por WhatsApp."
                      : "solo recibe recordatorios de cita."}
                  </p>
                </section>
              </aside>
            </div>
          </TabsContent>

          {puedeVerClinico && clinicId && (
            <TabsContent value="documentos" className="space-y-6">
              <DocumentosEmitidosCard
                clinicId={clinicId}
                patientId={paciente.id}
                timezone={access.clinic?.timezone ?? "America/Santiago"}
                puedeEmitir={
                  puedeEscribirClinico &&
                  (access.role === "owner" || access.role === "admin" || access.role === "dentist")
                }
                esAdministrador={access.role === "owner" || access.role === "admin"}
              />
              <FirmasADistanciaCard
                clinicId={clinicId}
                timezone={access.clinic?.timezone ?? "America/Santiago"}
                filtro={{ patientId: paciente.id }}
                mostrarTitulos
                titulo="Firmas a distancia"
                descripcion="Documentos y presupuestos que el paciente firmó, o tiene por firmar, desde su celular. Se piden desde cada documento o presupuesto."
                puedeGestionar={(tipo) =>
                  tipo === "documento"
                    ? puedeEscribirClinico &&
                      (access.role === "owner" ||
                        access.role === "admin" ||
                        access.role === "dentist")
                    : hasPermission(access, "patients:manage")
                }
              />
              <PatientDocumentsCard
                clinicId={clinicId}
                patientId={paciente.id}
                puedeEditar={puedeEscribirClinico}
              />
              <PatientConsentsCard
                clinicId={clinicId}
                patientId={paciente.id}
                patientName={paciente.nombre}
                fechaNacimiento={paciente.fechaNacimiento}
                timezone={timezone}
                myProfessionalId={access.myProfessionalId ?? null}
                puedeEditar={puedeEscribirClinico}
                puedeGestionar={hasPermission(access, "patients:manage")}
              />
              <PatientPrescriptionsCard
                clinicId={clinicId}
                patientId={paciente.id}
                patientDocument={paciente.documento || null}
                timezone={access.clinic?.timezone ?? "America/Santiago"}
                puedeEmitir={
                  puedeEscribirClinico &&
                  (access.role === "owner" || access.role === "admin" || access.role === "dentist")
                }
                esAdministrador={access.role === "owner" || access.role === "admin"}
              />
            </TabsContent>
          )}

          {/* Ola 13 · FIC-17: exámenes e imágenes (IMG-01) y sesiones de fotos (IMG-02). */}
          {puedeVerClinico && clinicId && (
            <TabsContent value="examenes">
              <ExamenesDelPaciente
                clinicId={clinicId}
                patientId={paciente.id}
                timezone={timezone ?? undefined}
                puedeEditar={puedeEscribirClinico}
                puedeRestaurar={access.role === "owner" || access.role === "admin"}
                myProfessionalId={access.myProfessionalId ?? null}
                pieza={search.pieza ?? null}
                onCambiarPieza={verExamenesDePieza}
              />
            </TabsContent>
          )}

          <TabsContent value="mensajes" className="space-y-6">
            {clinicId && access.clinic && (
              <>
                <div className="space-y-2">
                  <WhatsAppOptInToggle
                    clinicId={clinicId}
                    patientId={paciente.id}
                    initialOptIn={paciente.waOptIn}
                  />
                  <MessagesHistory clinicId={clinicId} patientId={paciente.id} />
                </div>

                {puedeGestionarPortal && (
                  <section className="rounded-lg border border-border p-6">
                    <div className="mb-3">
                      <h3 className="font-display text-xl font-semibold">Portal del paciente</h3>
                      <p className="text-sm text-muted-foreground">
                        Genera un link firmado (7 días) y compártelo por WhatsApp. Sin login.
                      </p>
                    </div>
                    {portalBloqueado ? (
                      // Sin bloque de venta dentro de la ficha clínica: solo el
                      // estado, sin botones de agendar ni suscribirse.
                      <p className="text-sm text-muted-foreground">
                        El portal se activa con la puesta en marcha de la clínica o al suscribirse.
                      </p>
                    ) : (
                      <PortalLinkButton
                        clinicId={clinicId}
                        patientId={paciente.id}
                        onCambio={refrescarPortal}
                      />
                    )}
                    {/* Revocar nunca se gatea por suscripción: cortar un link
                        filtrado tiene que funcionar siempre. Se muestra cuando
                        puede haber un link vigente. */}
                    <div className="mt-3">
                      {portalQuery.isLoading ? (
                        <Esqueleto className="h-8 w-48" />
                      ) : portalVigente ? (
                        <RevokePortalAccessButton
                          clinicId={clinicId}
                          patientId={paciente.id}
                          onCambio={refrescarPortal}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No hay links del portal vigentes para este paciente.
                        </p>
                      )}
                    </div>
                  </section>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
