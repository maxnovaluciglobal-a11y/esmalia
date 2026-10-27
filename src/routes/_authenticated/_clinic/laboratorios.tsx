import { useId, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Hourglass,
  Loader2,
  PackageCheck,
  Plus,
  RotateCcw,
  Send,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
import { Button } from "@/components/ui/button";
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
import {
  BarraApilada,
  Chips,
  CifraEnTinta,
  Destacado,
  EncabezadoEditorial,
  EtiquetaTinta,
  FILA,
  PANEL,
  Pastilla,
  SinDatos,
  TablaAPlus,
  TINTA,
  TITULO_PANEL,
  TintaCargando,
  celda,
  type ColumnaTabla,
} from "@/components/reportes/aplus";
import {
  clasePastilla,
  claseTexto,
  type TonoEstado,
} from "@/lib/clinic-operations/estado-cita-tono";
import {
  DIAS_POR_VENCER,
  diasEntre,
  ordenPorVencer,
  resumenLaboratorio,
} from "@/lib/clinic-operations/operacion-resumen";
import { fecha, fechaCorta } from "@/lib/formato-fecha";
import { PatientCombobox } from "@/components/patient-combobox";
import { MoneyInput } from "@/components/money-input";
import { requirePermission } from "@/lib/access/route-guards";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import {
  LAB_ORDER_STATUSES,
  LAB_ORDER_STATUS_LABELS,
  formatMoney,
  ordenAtrasada,
  type LabOrder,
  type LabOrderStatus,
} from "@/lib/finance/finance";
import {
  createLab,
  createLabOrder,
  listLabOrders,
  listLabs,
  setLabOrderStatus,
} from "@/lib/clinic-operations/clinic-operations.functions";
import {
  generateLabPortalLink,
  revokeLabPortalAccess,
} from "@/lib/clinic-operations/lab-portal.functions";
import {
  ROLES_EMITEN_LINK_LABORATORIO,
  ROLES_REVOCAN_LINK_LABORATORIO,
} from "@/lib/clinic-operations/lab-portal-roles";
import type { ClinicRole } from "@/lib/access/access";
import { listPatients } from "@/lib/patients/patients.functions";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { fechaPlanilla, montoPlanilla, type ColumnaLista } from "@/lib/exportacion/listas-csv";
import { str } from "@/lib/search";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";
import { AccionDeshabilitada } from "@/components/accion-deshabilitada";

interface LabSearch {
  estado: string;
}

export const Route = createFileRoute("/_authenticated/_clinic/laboratorios")({
  validateSearch: (search: Record<string, unknown>): LabSearch => ({
    estado: str(search.estado),
  }),
  beforeLoad: requirePermission("treatments:view"),
  head: () => ({
    meta: [
      { title: "Laboratorios | Esmalia" },
      {
        name: "description",
        content:
          "Órdenes de laboratorio con estado, fecha comprometida y costo, para dejar de llevar el cuaderno aparte.",
      },
    ],
  }),
  component: LaboratoriosPage,
});

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Estado de la orden: tono + ícono; la etiqueta siempre va escrita. */
const ESTADO_ORDEN: Record<LabOrderStatus, { tono: TonoEstado; icono: LucideIcon }> = {
  enviado: { tono: "info", icono: Send },
  en_proceso: { tono: "warning", icono: Hourglass },
  recibido: { tono: "success", icono: PackageCheck },
  reprocesar: { tono: "danger", icono: RotateCcw },
  cancelado: { tono: "neutral", icono: X },
};

type FiltroOrden = LabOrderStatus | "" | "atrasadas";

function NuevoLaboratorioDialog({ clinicId }: { clinicId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const queryClient = useQueryClient();
  const createFn = useServerFn(createLab);

  const crear = useMutation({
    mutationFn: () =>
      createFn({ data: { clinicId, name: name.trim(), contactPhone: phone.trim() || null } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labs", clinicId] });
      toast.success("Laboratorio creado");
      setOpen(false);
      setName("");
      setPhone("");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" /> Nuevo laboratorio
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nuevo laboratorio</DialogTitle>
          <DialogDescription>
            Con el nombre alcanza para empezar a mandarle trabajos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="l-name">Nombre</Label>
            <input
              id="l-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Laboratorio Dental Sur"
              className={INPUT}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="l-phone">Teléfono</Label>
            <input
              id="l-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Opcional"
              className={INPUT}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => crear.mutate()} disabled={!name.trim() || crear.isPending}>
            {crear.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Crear laboratorio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NuevaOrdenDialog({
  clinicId,
  currency,
  timezone,
}: {
  clinicId: string;
  currency: string;
  timezone?: string;
}) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [labId, setLabId] = useState("");
  const [description, setDescription] = useState("");
  const [piezas, setPiezas] = useState("");
  const [sentOn, setSentOn] = useState(hoyISO(timezone));
  const [dueOn, setDueOn] = useState("");
  const [cost, setCost] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const createFn = useServerFn(createLabOrder);
  const fetchLabs = useServerFn(listLabs);
  const fetchPatients = useServerFn(listPatients);

  const { data: labs = [] } = useQuery({
    queryKey: ["labs", clinicId],
    enabled: open,
    queryFn: () => fetchLabs({ data: { clinicId } }),
  });
  const { data: pacientesRes } = useQuery({
    queryKey: ["patients", clinicId],
    enabled: open,
    queryFn: () => fetchPatients({ data: { clinicId } }),
  });

  const crear = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          clinicId,
          patientId,
          labId: labId || null,
          description: description.trim(),
          // "24, 25" → [24, 25]. Se descarta lo que no sea número en vez de
          // rechazar la orden entera por un separador raro.
          toothNumbers:
            piezas
              .split(/[\s,;]+/)
              .map((t) => Number(t))
              .filter((n) => Number.isInteger(n) && n > 0) || null,
          sentOn,
          dueOn: dueOn || null,
          costCents: cost,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-orders", clinicId] });
      toast.success("Orden registrada");
      setOpen(false);
      setPatientId("");
      setDescription("");
      setPiezas("");
      setDueOn("");
      setCost(null);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const listo = patientId && description.trim() && !crear.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Nueva orden
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva orden de laboratorio</DialogTitle>
          <DialogDescription>
            Lo que se manda al taller, para quién y cuándo lo prometieron.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-paciente`}>Paciente</Label>
            <PatientCombobox
              id={`${fid}-paciente`}
              value={patientId}
              onChange={setPatientId}
              pacientes={(pacientesRes?.items ?? []).map((p) => ({
                id: p.id,
                nombre: p.nombre,
              }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="o-lab">Laboratorio</Label>
              <select
                id="o-lab"
                value={labId}
                onChange={(e) => setLabId(e.target.value)}
                className={INPUT}
              >
                <option value="">Sin especificar</option>
                {labs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-piezas">Piezas</Label>
              <input
                id="o-piezas"
                value={piezas}
                onChange={(e) => setPiezas(e.target.value)}
                placeholder="Ej: 24, 25"
                className={INPUT}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="o-desc">Trabajo</Label>
            <input
              id="o-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: Corona metal-porcelana"
              className={INPUT}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="o-sent">Enviado</Label>
              <input
                id="o-sent"
                type="date"
                value={sentOn}
                onChange={(e) => setSentOn(e.target.value)}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-due">Comprometido</Label>
              <input
                id="o-due"
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-cost">Costo</Label>
              <MoneyInput
                id="o-cost"
                currency={currency}
                min={0}
                valueCents={cost}
                onValueChange={setCost}
                placeholder="Opcional"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <AccionDeshabilitada
            motivo={
              !crear.isPending &&
              !listo &&
              `Falta ${[!patientId && "paciente", !description.trim() && "descripción"]
                .filter(Boolean)
                .join(" y ")}.`
            }
          >
            <Button onClick={() => crear.mutate()} disabled={!listo}>
              {crear.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Registrar orden
            </Button>
          </AccionDeshabilitada>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Portal externo de laboratorio: cada laboratorio activo tiene su propio
 * link firmado para ver y actualizar el estado de sus órdenes sin cuenta de
 * staff en Esmalia. Self-contained (fetch propio de `listLabs`) para no
 * meterle otra query al estado de `LaboratoriosPage`.
 */
function LabPortalSection({ clinicId, role }: { clinicId: string; role: ClinicRole | null }) {
  const fetchLabs = useServerFn(listLabs);
  const generateLink = useServerFn(generateLabPortalLink);
  const revokeLink = useServerFn(revokeLabPortalAccess);
  const [generando, setGenerando] = useState<string | null>(null);
  const [revocando, setRevocando] = useState<string | null>(null);
  // Par de UI de los chequeos de rol de lab-portal.functions.ts (regla 15).
  const puedeEmitir = role !== null && ROLES_EMITEN_LINK_LABORATORIO.includes(role);
  const puedeRevocar = role !== null && ROLES_REVOCAN_LINK_LABORATORIO.includes(role);

  const { data: labs = [] } = useQuery({
    queryKey: ["labs", clinicId],
    queryFn: () => fetchLabs({ data: { clinicId } }),
  });

  const copiarLink = async (labId: string) => {
    setGenerando(labId);
    try {
      const { url } = await generateLink({
        data: { clinicId, labId },
      });
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado. Compártelo con el laboratorio (WhatsApp, email).");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No pudimos generar el link.");
    } finally {
      setGenerando(null);
    }
  };

  const revocar = async (labId: string, nombre: string) => {
    if (
      !window.confirm(
        `¿Revocar el acceso de ${nombre} al portal? Los links que ya compartiste dejan de funcionar; puedes generar uno nuevo cuando quieras.`,
      )
    ) {
      return;
    }
    setRevocando(labId);
    try {
      await revokeLink({ data: { clinicId, labId } });
      toast.success(`Listo: los links anteriores de ${nombre} ya no funcionan.`);
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setRevocando(null);
    }
  };

  if (labs.length === 0 || !puedeEmitir) return null;

  return (
    <section aria-labelledby="lab-portal" className={cn(PANEL, "space-y-2 p-5")}>
      <h2 id="lab-portal" className={TITULO_PANEL}>
        Portal del <Destacado>laboratorio</Destacado>
      </h2>
      <p className="text-sm text-muted-foreground">
        Cada link deja ver y actualizar solo las órdenes de ese laboratorio, sin login. Tócalo para
        copiarlo.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        {labs.map((l) => (
          <Button
            key={l.id}
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={generando === l.id}
            onClick={() => copiarLink(l.id)}
          >
            {generando === l.id ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ExternalLink className="size-3.5" />
            )}
            {l.name} <Copy className="size-3 opacity-60" />
          </Button>
        ))}
      </div>
      {puedeRevocar && (
        <div className="flex flex-wrap gap-2 pt-1">
          {labs.map((l) => (
            <Button
              key={l.id}
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={revocando === l.id}
              onClick={() => revocar(l.id, l.name)}
            >
              {revocando === l.id && <Loader2 className="size-3.5 animate-spin" />}
              Revocar acceso al portal: {l.name}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

function LaboratoriosPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const clinicId = access.clinic?.id;
  const currency = access.clinic?.currency ?? "CLP";
  const timezone = access.clinic?.timezone;
  const hoy = hoyISO(timezone);
  const queryClient = useQueryClient();

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  const fetchOrders = useServerFn(listLabOrders);
  const setStatusFn = useServerFn(setLabOrderStatus);

  // Se traen todas y se filtra acá: la tarjeta de arriba resume la clínica
  // entera (atrasadas, por vencer, por estado) sea cual sea el chip elegido.
  const {
    data: ordenes = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["lab-orders", clinicId, "todas"],
    enabled: Boolean(clinicId) && !bloqueado,
    queryFn: () => fetchOrders({ data: { clinicId: clinicId!, estado: null } }),
  });

  const cambiarEstado = useMutation({
    mutationFn: (v: { orderId: string; status: LabOrderStatus }) =>
      setStatusFn({
        data: {
          clinicId: clinicId!,
          ...v,
          receivedOn: v.status === "recibido" ? hoy : null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-orders", clinicId] });
      toast.success("Estado actualizado");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const resumen = useMemo(
    () => resumenLaboratorio(ordenes, hoy, LAB_ORDER_STATUSES),
    [ordenes, hoy],
  );
  const filtro = (
    search.estado === "atrasadas" || LAB_ORDER_STATUSES.includes(search.estado as LabOrderStatus)
      ? search.estado
      : ""
  ) as FiltroOrden;
  const visibles =
    filtro === ""
      ? ordenes
      : filtro === "atrasadas"
        ? ordenes.filter((o) => ordenAtrasada(o, hoy))
        : ordenes.filter((o) => o.status === filtro);

  const columnasCsv: ColumnaLista<LabOrder>[] = [
    { header: "Enviado", value: (o) => fechaPlanilla(o.sentOn, timezone) },
    { header: "Paciente", value: (o) => o.patientName },
    { header: "Laboratorio", value: (o) => o.labNameSnapshot },
    { header: "Trabajo", value: (o) => o.description },
    { header: "Piezas", value: (o) => o.toothNumbers?.join(" ") ?? null },
    { header: "Estado", value: (o) => LAB_ORDER_STATUS_LABELS[o.status] },
    { header: "Comprometido", value: (o) => fechaPlanilla(o.dueOn, timezone) },
    { header: "Recibido", value: (o) => fechaPlanilla(o.receivedOn, timezone) },
    { header: "Costo", value: (o) => montoPlanilla(o.costCents, currency), dinero: true },
    { header: "Moneda", value: () => currency, dinero: true },
  ];

  const set = (patch: Partial<LabSearch>) =>
    navigate({ search: (prev: LabSearch) => ({ ...prev, ...patch }) });

  const atrasadas = resumen.atrasadas.length;
  const porVencer = resumen.porVencer.length;
  const conclusion = isLoading ? undefined : ordenes.length === 0 ? (
    "Todavía no hay órdenes. Registra acá lo que mandas al taller: qué, para quién y cuándo lo prometieron."
  ) : atrasadas === 0 && porVencer === 0 ? (
    <>
      <b className="font-semibold text-foreground">Nada atrasado.</b>{" "}
      {resumen.enCurso === 0
        ? "No hay órdenes en curso."
        : `${resumen.enCurso} ${resumen.enCurso === 1 ? "orden sigue" : "órdenes siguen"} en curso y ninguna vence esta semana.`}
    </>
  ) : (
    <>
      <b className="font-semibold text-foreground">
        {atrasadas === 0
          ? "Ninguna orden atrasada."
          : `${atrasadas} ${atrasadas === 1 ? "orden está atrasada" : "órdenes están atrasadas"}.`}
      </b>{" "}
      {porVencer > 0 &&
        `${porVencer} ${porVencer === 1 ? "vence" : "vencen"} en los próximos ${DIAS_POR_VENCER} días.`}
    </>
  );

  const columnas: ColumnaTabla[] = [
    { label: "Paciente y trabajo" },
    { label: "Laboratorio", className: "hidden lg:table-cell" },
    { label: "Enviado", className: "hidden md:table-cell" },
    { label: "Comprometido" },
    { label: "Costo", derecha: true, className: "hidden sm:table-cell" },
    { label: "Estado" },
  ];

  return (
    <AppShell title="Laboratorios" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Laboratorios" sub={sub ?? null} />
      ) : (
        <div className="mx-auto max-w-[84rem] space-y-[18px]">
          <div className="pb-2">
            <EncabezadoEditorial
              seccion="Operación"
              pagina="Laboratorios"
              titulo={
                <>
                  Órdenes de <Destacado>laboratorio</Destacado>
                </>
              }
              conclusion={conclusion}
              acciones={
                <>
                  <ExportarCsvLista<LabOrder>
                    clinicId={clinicId!}
                    rol={access.role}
                    lista="laboratorio"
                    filas={visibles}
                    columnas={columnasCsv}
                    timezone={timezone ?? "America/Santiago"}
                    filtros={{ estado: filtro }}
                  />
                  <NuevoLaboratorioDialog clinicId={clinicId!} />
                  <NuevaOrdenDialog clinicId={clinicId!} currency={currency} timezone={timezone} />
                </>
              }
            />
          </div>

          {isError ? (
            <ErrorDeCarga
              onReintentar={refetch}
              mensaje="No pudimos cargar las órdenes de laboratorio."
            />
          ) : isLoading ? (
            <TintaCargando texto="Cargando órdenes…" />
          ) : (
            <section
              aria-label="Lo que requiere acción"
              className={cn(TINTA, "grid gap-7 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")}
            >
              <div className="min-w-0">
                <EtiquetaTinta>Atrasadas</EtiquetaTinta>
                <CifraEnTinta
                  valor={String(atrasadas)}
                  sufijo={atrasadas === 1 ? " orden" : " órdenes"}
                />
                <p className="mt-3.5 text-sm font-medium text-on-night-2">
                  {porVencer === 0 ? (
                    `ninguna vence en los próximos ${DIAS_POR_VENCER} días`
                  ) : (
                    <>
                      y{" "}
                      <b className="font-semibold text-on-night">
                        {porVencer} {porVencer === 1 ? "vence" : "vencen"}
                      </b>{" "}
                      en los próximos {DIAS_POR_VENCER} días
                    </>
                  )}
                </p>
                {atrasadas + porVencer > 0 && (
                  <ul className="mt-5 grid gap-2.5">
                    {[...resumen.atrasadas, ...resumen.porVencer].slice(0, 5).map((o) => {
                      const tarde = ordenAtrasada(o, hoy);
                      const dias = diasEntre(hoy, o.dueOn!);
                      return (
                        <li
                          key={o.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2.5 border-b border-night-line pb-2.5 text-sm"
                        >
                          <span className="min-w-0">
                            <span className="block truncate">
                              {o.patientName} · {o.description}
                            </span>
                            <span className="text-xs text-on-night-2">
                              {o.labNameSnapshot ?? "Sin laboratorio"} · comprometido{" "}
                              {fecha(o.dueOn)}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap",
                              tarde ? "text-brand-on-night" : "text-on-night",
                            )}
                          >
                            {tarde ? (
                              <TriangleAlert className="size-3.5" aria-hidden />
                            ) : (
                              <CalendarClock className="size-3.5" aria-hidden />
                            )}
                            {tarde
                              ? `${Math.abs(dias)} ${Math.abs(dias) === 1 ? "día" : "días"} tarde`
                              : dias === 0
                                ? "Vence hoy"
                                : `En ${dias} ${dias === 1 ? "día" : "días"}`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="min-w-0">
                <EtiquetaTinta>Órdenes por estado</EtiquetaTinta>
                <BarraApilada
                  sobre="tinta"
                  sinPorcentaje
                  vacio="Sin órdenes todavía."
                  partes={resumen.porEstado.map((e) => ({
                    clave: e.status,
                    etiqueta: LAB_ORDER_STATUS_LABELS[e.status],
                    valor: e.cantidad,
                    texto: String(e.cantidad),
                  }))}
                />
                <p className="mt-4 text-xs leading-relaxed text-on-night-2">
                  Una orden solo cuenta como atrasada si el laboratorio comprometió una fecha y
                  todavía no llegó: sin plazo pactado no se inventa uno.
                </p>
              </div>
            </section>
          )}

          <section aria-labelledby="lab-lista" className={cn(PANEL, "overflow-hidden")}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-[18px] pb-3">
              <h2 id="lab-lista" className={TITULO_PANEL}>
                Órdenes
              </h2>
              {ordenes.length > 0 && (
                <Chips<FiltroOrden>
                  etiqueta="Filtrar por estado"
                  valor={filtro}
                  onCambiar={(estado) => set({ estado })}
                  opciones={[
                    { valor: "", label: "Todas", cuenta: ordenes.length },
                    ...(atrasadas > 0
                      ? [
                          {
                            valor: "atrasadas" as FiltroOrden,
                            label: "Atrasadas",
                            cuenta: atrasadas,
                          },
                        ]
                      : []),
                    ...resumen.porEstado
                      .filter((e) => e.cantidad > 0)
                      .map((e) => ({
                        valor: e.status as FiltroOrden,
                        label: LAB_ORDER_STATUS_LABELS[e.status],
                        cuenta: e.cantidad,
                      })),
                  ]}
                />
              )}
            </div>

            {!isLoading && !isError && ordenes.length === 0 && (
              <SinDatos
                className="border-t border-hairline"
                titulo="Sin órdenes de laboratorio"
                detalle="Registra aquí lo que mandas al taller: qué, para quién y cuándo lo prometieron. Es lo que hoy vive en un cuaderno aparte."
              />
            )}
            {ordenes.length > 0 && visibles.length === 0 && (
              <SinDatos
                className="border-t border-hairline"
                titulo="Ninguna orden en este estado."
                accion={
                  <Button variant="outline" size="sm" onClick={() => set({ estado: "" })}>
                    Ver todas
                  </Button>
                }
              />
            )}
            {visibles.length > 0 && (
              <TablaAPlus columnas={columnas}>
                {visibles.map((o) => {
                  const atrasada = ordenAtrasada(o, hoy);
                  const vence = ordenPorVencer(o, hoy);
                  const estilo = ESTADO_ORDEN[o.status];
                  const Icono = estilo.icono;
                  return (
                    <tr key={o.id} className={FILA}>
                      <td className={celda(0, 6, "min-w-[11rem]")}>
                        <span className="font-medium">{o.patientName}</span>
                        <span className="mt-0.5 block text-[13px] text-muted-foreground">
                          {o.description}
                          {o.toothNumbers?.length ? (
                            <span className="cifra ml-1.5 text-xs">
                              {o.toothNumbers.join(" · ")}
                            </span>
                          ) : null}
                          <span className="lg:hidden">
                            {" "}
                            · {o.labNameSnapshot ?? "Sin laboratorio"}
                          </span>
                        </span>
                      </td>
                      <td className={celda(1, 6, "hidden text-muted-foreground lg:table-cell")}>
                        {o.labNameSnapshot ?? "—"}
                      </td>
                      <td
                        className={celda(
                          2,
                          6,
                          "cifra hidden whitespace-nowrap text-[13px] text-muted-foreground md:table-cell",
                        )}
                      >
                        {fechaCorta(o.sentOn)}
                      </td>
                      <td className={celda(3, 6, "whitespace-nowrap")}>
                        {o.dueOn ? (
                          <span className="cifra text-[13px]">{fechaCorta(o.dueOn)}</span>
                        ) : (
                          <span className="text-[13px] text-muted-foreground">Sin plazo</span>
                        )}
                        {atrasada && (
                          <Pastilla tono="danger" icono={TriangleAlert} className="mt-1 flex w-fit">
                            Atrasada
                          </Pastilla>
                        )}
                        {vence && (
                          <Pastilla
                            tono="warning"
                            icono={CalendarClock}
                            className="mt-1 flex w-fit"
                          >
                            Por vencer
                          </Pastilla>
                        )}
                      </td>
                      <td
                        className={celda(
                          4,
                          6,
                          "cifra hidden text-right whitespace-nowrap text-muted-foreground sm:table-cell",
                        )}
                      >
                        {o.costCents === null ? "—" : formatMoney(o.costCents, o.currency)}
                      </td>
                      <td className={celda(5, 6)}>
                        <span className="relative inline-flex">
                          <Icono
                            aria-hidden
                            className={cn(
                              "pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2",
                              claseTexto[estilo.tono],
                            )}
                          />
                          <select
                            value={o.status}
                            aria-label={`Estado de la orden de ${o.patientName}`}
                            onChange={(e) =>
                              cambiarEstado.mutate({
                                orderId: o.id,
                                status: e.target.value as LabOrderStatus,
                              })
                            }
                            className={cn(
                              "h-7 appearance-none rounded-full border py-0 pr-6 pl-7 text-xs font-semibold outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11",
                              clasePastilla[estilo.tono],
                            )}
                          >
                            {LAB_ORDER_STATUSES.map((e) => (
                              <option key={e} value={e}>
                                {LAB_ORDER_STATUS_LABELS[e]}
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            aria-hidden
                            className={cn(
                              "pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2",
                              claseTexto[estilo.tono],
                            )}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </TablaAPlus>
            )}
          </section>

          <LabPortalSection clinicId={clinicId!} role={access.role} />
        </div>
      )}
    </AppShell>
  );
}
