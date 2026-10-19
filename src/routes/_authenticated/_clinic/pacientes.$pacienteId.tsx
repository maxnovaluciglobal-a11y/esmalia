import { useEffect, useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CalendarPlus,
  Pencil,
  ShieldAlert,
  Tag,
  Wallet,
} from "lucide-react";

import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
import { MedicalHistoryCard } from "@/components/medical-history-card";
import { getMedicalHistory } from "@/lib/clinical/medical-history.functions";
import { listAgreements, setPatientAgreement } from "@/lib/finance/clinic-finance.functions";
import { PatientDocumentsCard } from "@/components/patient-documents-card";
import { PatientConsentsCard } from "@/components/patient-consents-card";
import { Odontogram, OdontogramResumen } from "@/components/odontogram";
import { PeriodontalChart } from "@/components/periodontal-chart";
import { FinanceSection, type PiezaSeed } from "@/components/finance-section";
import { MessagesHistory } from "@/components/messages-history";
import { WhatsAppOptInToggle } from "@/components/whatsapp-opt-in-toggle";
import { PortalLinkButton, RevokePortalAccessButton } from "@/components/portal-link-button";
import { ReferralCodeCard } from "@/components/referral-code-card";
import { hasPermission } from "@/lib/access/access";
import { getMySubscription } from "@/lib/billing.functions";
import { requiereLlamadaOSuscripcion } from "@/lib/billing";
import type { Paciente } from "@/lib/clinic-operations/clinic-data";
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
  afiliado,
  puedeEditar,
}: {
  clinicId: string;
  patientId: string;
  convenioId: string | null;
  afiliado: string | null;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const fetchAgreements = useServerFn(listAgreements);
  const setFn = useServerFn(setPatientAgreement);
  const [editando, setEditando] = useState(false);
  const [seleccion, setSeleccion] = useState(convenioId ?? "");
  const [nroAfiliado, setNroAfiliado] = useState(afiliado ?? "");

  const { data: convenios = [] } = useQuery({
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

  if (editando) {
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Convenio</p>
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
      <p className="kicker">Convenio</p>
      <p className="mt-1 truncate font-display text-xl font-semibold leading-tight">
        {actual?.name ?? "Particular"}
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
      <dt className="kicker">{label}</dt>
      <dd className="mt-1 truncate font-display text-xl font-semibold leading-tight">{children}</dd>
    </div>
  );
}

function iniciales(nombre: string) {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function PacienteDetalle() {
  const { access } = Route.useRouteContext();
  const { paciente } = Route.useLoaderData() as { paciente: Paciente };
  const currency = access.clinic?.currency ?? "CLP";
  const puedeVerClinico = hasPermission(access.role, "clinical:view");
  const puedeEscribirClinico = hasPermission(access.role, "clinical:write");
  const clinicId = access.clinic?.id;
  const puedeFacturar = hasPermission(access.role, "patients:manage");
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
  const alergias = medicalHistoryQuery.data?.allergies ?? [];

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

  const lineaDatos = [
    paciente.edad ? `${paciente.edad} años` : null,
    paciente.telefono || "Sin teléfono",
    paciente.convenioNombre ?? null,
    paciente.documento ? `Doc. ${paciente.documento}` : null,
  ].filter(Boolean);

  const alertaMedica = !puedeVerClinico
    ? "Sin acceso"
    : medicalHistoryQuery.isLoading
      ? "…"
      : alergias.length > 0
        ? `Alergia: ${alergias.join(", ")}`
        : "Sin alergias registradas";

  return (
    <AppShell title="Ficha del paciente" access={access}>
      <div className="mx-auto max-w-6xl">
        {/* Cabecera fija: identidad, acciones y los 4 datos que se consultan
            en cada atención. Se queda visible al bajar por cualquier pestaña (desde lg: en el
            celular ocuparía media pantalla). */}
        <header className="-mx-5 lg:sticky lg:top-16 lg:z-[5] border-b border-border bg-background/95 px-5 pt-2 pb-5 backdrop-blur-sm sm:-mx-8 sm:px-8">
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
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Pacientes
          </Link>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              {paciente.foto ? (
                <img
                  src={paciente.foto}
                  alt=""
                  width={512}
                  height={512}
                  className="size-14 shrink-0 rounded-full object-cover outline outline-1 outline-border"
                />
              ) : (
                <span
                  aria-hidden
                  className="grid size-14 shrink-0 place-items-center rounded-full border border-brand/50 font-display text-xl font-semibold text-brand-700"
                >
                  {iniciales(paciente.nombre)}
                </span>
              )}
              <div className="min-w-0">
                <h2 className="truncate font-display text-3xl font-semibold leading-tight sm:text-[40px]">
                  {paciente.nombre}
                </h2>
                <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                  {lineaDatos.join(" · ")}
                  {paciente.telefono && paciente.telefonoValido === false && (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <AlertTriangle className="size-3.5 shrink-0" aria-hidden /> formato dudoso
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {puedeFacturar && (
                <button
                  type="button"
                  onClick={() => {
                    setPestana("finanzas");
                    setAbrirPago(true);
                  }}
                  className={buttonVariants({ variant: "outline" })}
                >
                  <Wallet aria-hidden /> Cobrar
                </button>
              )}
              {hasPermission(access.role, "agenda:manage") && (
                <Link
                  to="/agenda"
                  search={{
                    q: "",
                    fecha: "",
                    vista: "dia",
                    sucursal: "",
                    profesional: "",
                    estado: "",
                    page: 1,
                    nueva: paciente.id,
                  }}
                  className={buttonVariants()}
                >
                  <CalendarPlus aria-hidden /> Agendar
                </Link>
              )}
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
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
              {clinicId ? (
                <ConvenioDelPaciente
                  clinicId={clinicId}
                  patientId={paciente.id}
                  convenioId={paciente.convenioId ?? null}
                  afiliado={paciente.convenioAfiliado ?? null}
                  puedeEditar={puedeFacturar}
                />
              ) : null}
            </div>
            <div className="min-w-0">
              <dt className="kicker">Alerta médica</dt>
              <dd
                className={cn(
                  "mt-1 flex items-start gap-1.5 font-display text-xl font-semibold leading-tight",
                  alergias.length > 0 && "text-destructive",
                )}
              >
                {alergias.length > 0 && (
                  <AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden />
                )}
                <span className="line-clamp-2">{alertaMedica}</span>
              </dd>
            </div>
          </dl>
        </header>

        <Tabs value={pestana} onValueChange={(v) => setPestana(v as PestanaFicha)} className="mt-4">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="resumen">Resumen</TabsTrigger>
            {puedeVerClinico && <TabsTrigger value="odontograma">Odontograma</TabsTrigger>}
            {puedeVerClinico && <TabsTrigger value="notas">Notas clínicas</TabsTrigger>}
            <TabsTrigger value="finanzas">Presupuestos y pagos</TabsTrigger>
            {puedeVerClinico && <TabsTrigger value="documentos">Documentos</TabsTrigger>}
            <TabsTrigger value="mensajes">Mensajes</TabsTrigger>
          </TabsList>

          <TabsContent value="resumen">
            <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
              <div className="min-w-0 space-y-6">
                {puedeVerClinico && clinicId ? (
                  <>
                    <OdontogramResumen
                      clinicId={clinicId}
                      patientId={paciente.id}
                      onVerOdontograma={() => setPestana("odontograma")}
                    />
                    <MedicalHistoryCard
                      clinicId={clinicId}
                      patientId={paciente.id}
                      puedeEditar={puedeEscribirClinico}
                      userId={access.userId}
                    />
                  </>
                ) : (
                  <p className="flex items-center gap-3 rounded-lg border border-border p-6 text-sm text-muted-foreground">
                    <ShieldAlert className="size-4 shrink-0" aria-hidden />
                    Tu rol no tiene acceso a la historia clínica de este paciente.
                  </p>
                )}
              </div>
              <aside className="min-w-0 space-y-6">
                <section aria-labelledby="timeline" className="rounded-lg border border-border p-5">
                  <h3 id="timeline" className="mb-4 font-display text-xl font-semibold">
                    Línea de tiempo
                  </h3>
                  <PacienteTimeline paciente={paciente} conEncabezado={false} />
                </section>
                <section className="space-y-3 rounded-lg border border-border p-5 text-sm">
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
                  <p className="text-xs text-muted-foreground">
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
            <TabsContent value="odontograma" className="space-y-6">
              <Odontogram
                clinicId={clinicId}
                patientId={paciente.id}
                puedeEditar={puedeEscribirClinico}
                userId={access.userId}
                onPresupuestarPieza={presupuestarPieza}
                // `edad` es 0 cuando no hay fecha de nacimiento: se trata como desconocida.
                edad={paciente.edad > 0 ? paciente.edad : null}
              />
              <PeriodontalChart
                clinicId={clinicId}
                patientId={paciente.id}
                puedeEditar={puedeEscribirClinico}
                userId={access.userId}
              />
            </TabsContent>
          )}

          {puedeVerClinico && (
            <TabsContent value="notas">
              <NotasClinicas
                paciente={paciente}
                clinicId={clinicId ?? null}
                clinicaNombre={access.clinic?.name ?? "Esmalia"}
                puedeEditar={puedeEscribirClinico}
                userId={access.userId}
                rol={access.role}
              />
            </TabsContent>
          )}

          <TabsContent value="finanzas">
            {clinicId && access.clinic && (
              <FinanceSection
                clinicId={clinicId}
                clinicaNombre={access.clinic.name}
                currency={currency}
                patientId={paciente.id}
                puedeEditar={puedeFacturar}
                puedeReversarPagos={hasPermission(access.role, "payments:reverse")}
                userId={access.userId}
                piezaSeed={piezaSeed}
                onPiezaSeedConsumido={() => setPiezaSeed(null)}
                abrirPago={abrirPago}
                onPagoAbierto={() => setAbrirPago(false)}
              />
            )}
          </TabsContent>

          {puedeVerClinico && clinicId && (
            <TabsContent value="documentos" className="space-y-6">
              <PatientDocumentsCard
                clinicId={clinicId}
                patientId={paciente.id}
                puedeEditar={puedeEscribirClinico}
              />
              <PatientConsentsCard
                clinicId={clinicId}
                patientId={paciente.id}
                patientName={paciente.nombre}
                puedeEditar={puedeEscribirClinico}
                puedeGestionar={hasPermission(access.role, "patients:manage")}
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

                {hasPermission(access.role, "patients:manage") && (
                  <section className="rounded-lg border border-border p-6">
                    <div className="mb-3">
                      <h3 className="font-display text-xl font-semibold">Portal del paciente</h3>
                      <p className="text-sm text-muted-foreground">
                        Genera un link firmado (7 días) y compártelo por WhatsApp. Sin login.
                      </p>
                    </div>
                    <div
                      className={
                        portalBloqueado
                          ? "flex flex-col items-stretch gap-2"
                          : "flex flex-wrap items-start gap-2"
                      }
                    >
                      <PortalLinkButton
                        clinicId={clinicId}
                        patientId={paciente.id}
                        bloqueado={
                          portalBloqueado
                            ? {
                                feature: "El portal del paciente",
                                descripcion:
                                  "Tus pacientes pueden ver sus próximas citas y pedir hora sin login, por un link que tú generas. Se activa con tu puesta en marcha o al suscribirte.",
                                clinicName: access.clinic.name,
                                clinicEmail: access.email,
                              }
                            : undefined
                        }
                      />
                      {/* Revocar acceso NUNCA se gatea — cortar un link filtrado
                          tiene que funcionar aunque la clínica no haya agendado
                          su llamada ni se haya suscrito todavía. */}
                      <RevokePortalAccessButton clinicId={clinicId} patientId={paciente.id} />
                    </div>
                    <div className="mt-3">
                      <ReferralCodeCard
                        clinicId={clinicId}
                        clinicCountry={access.clinic?.country ?? null}
                        patientName={paciente.nombre}
                        referralCode={paciente.referralCode}
                      />
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
