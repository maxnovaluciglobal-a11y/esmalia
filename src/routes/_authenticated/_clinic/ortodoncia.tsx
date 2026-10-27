import { useId, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  AvatarIniciales,
  ChipFiltro,
  EncabezadoEditorial,
  PANEL_LISTA,
} from "@/components/a-plus/lista";
import { AppShell } from "@/components/app-shell";
import { CifraEnTinta, EtiquetaTinta, TINTA } from "@/components/reportes/aplus";
import {
  ChipEtapa,
  ProgresoOrto,
  SeguimientoDialog,
} from "@/components/ortodoncia/seguimiento-ortodoncia";
import { nombreDelSistema, textoCambioAlineador } from "@/lib/clinical/ortho-vistas";
import { hasPermission } from "@/lib/access/access";
import { ErrorDeCarga } from "@/components/estado-error";
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
import { PatientCombobox } from "@/components/patient-combobox";
import { MoneyInput } from "@/components/money-input";
import { requirePermission } from "@/lib/access/route-guards";
import { hoyISO, formatoFecha } from "@/lib/clinic-operations/clinic-data";
import { formatMoney } from "@/lib/finance/finance";
import {
  ORTHO_CASE_KIND_LABELS,
  ORTHO_CASE_STATUSES,
  ORTHO_CASE_STATUS_LABELS,
  ORTHO_STAGES,
  ORTHO_STAGE_LABELS,
  ORTHO_SYSTEMS,
  ORTHO_SYSTEM_LABELS,
  controlAtrasado,
  kindDelSistema,
  type OrthoCase,
  type OrthoStage,
  type OrthoSystem,
} from "@/lib/clinical/ortho";
import {
  addOrthoControl,
  createOrthoCase,
  listOrthoCases,
  listOrthoControls,
  setOrthoCaseStatus,
} from "@/lib/clinical/ortho.functions";
import { listPatients } from "@/lib/patients/patients.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

export const Route = createFileRoute("/_authenticated/_clinic/ortodoncia")({
  beforeLoad: requirePermission("clinical:write"),
  head: () => ({
    meta: [
      { title: "Ortodoncia | Esmalia" },
      {
        name: "description",
        content: "Casos de brackets y alineadores, con seguimiento de controles.",
      },
    ],
  }),
  component: OrtodonciaPage,
});

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function NuevoCasoDialog({
  clinicId,
  currency,
  hoy,
}: {
  clinicId: string;
  currency: string;
  hoy: string;
}) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [system, setSystem] = useState<OrthoSystem>("metalicos");
  const [startedOn, setStartedOn] = useState(hoy);
  const [expectedEnd, setExpectedEnd] = useState("");
  const [stage, setStage] = useState<OrthoStage | "">("alineacion");
  const [alignerTotal, setAlignerTotal] = useState("");
  const [alignerDays, setAlignerDays] = useState("14");
  const [monthlyFee, setMonthlyFee] = useState<number | null>(null);
  const esAlineadores = system === "alineadores";
  const nTotal = alignerTotal.trim() === "" ? null : Number(alignerTotal);
  const nDias = alignerDays.trim() === "" ? null : Number(alignerDays);
  const alineadoresValidos =
    !esAlineadores ||
    ((nTotal === null || (Number.isInteger(nTotal) && nTotal >= 1 && nTotal <= 200)) &&
      (nDias === null || (Number.isInteger(nDias) && nDias >= 1 && nDias <= 60)));
  const queryClient = useQueryClient();
  const createFn = useServerFn(createOrthoCase);
  const fetchPatients = useServerFn(listPatients);

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
          kind: kindDelSistema(system),
          system,
          startedOn,
          expectedEndOn: expectedEnd || null,
          monthlyFeeCents: monthlyFee,
          stage: stage || null,
          alineadores: esAlineadores
            ? {
                alignerCurrent: 1,
                alignerTotal: nTotal,
                alignerChangeDays: nDias,
                alignerChangedOn: startedOn,
              }
            : undefined,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ortho-cases", clinicId] });
      toast.success("Caso de ortodoncia creado.");
      setOpen(false);
      setPatientId("");
      setMonthlyFee(null);
      setExpectedEnd("");
      setAlignerTotal("");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Nuevo caso
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo caso de ortodoncia</DialogTitle>
          <DialogDescription>Brackets o alineadores, con su seguimiento aparte.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-paciente`}>Paciente</Label>
            <PatientCombobox
              id={`${fid}-paciente`}
              value={patientId}
              onChange={setPatientId}
              pacientes={(pacientesRes?.items ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-sistema`}>Sistema</Label>
              <select
                id={`${fid}-sistema`}
                value={system}
                onChange={(e) => setSystem(e.target.value as OrthoSystem)}
                className={INPUT}
              >
                {ORTHO_SYSTEMS.map((s) => (
                  <option key={s} value={s}>
                    {ORTHO_SYSTEM_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-etapa`}>Etapa inicial</Label>
              <select
                id={`${fid}-etapa`}
                value={stage}
                onChange={(e) => setStage(e.target.value as OrthoStage | "")}
                className={INPUT}
              >
                <option value="">Sin etapa</option>
                {ORTHO_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {ORTHO_STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="oc-inicio">Inicio</Label>
              <input
                id="oc-inicio"
                type="date"
                value={startedOn}
                onChange={(e) => setStartedOn(e.target.value)}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-termino`}>Término estimado</Label>
              <input
                id={`${fid}-termino`}
                type="date"
                value={expectedEnd}
                min={startedOn}
                onChange={(e) => setExpectedEnd(e.target.value)}
                className={INPUT}
              />
            </div>
          </div>
          {esAlineadores && (
            <div className="grid grid-cols-2 gap-3 rounded-[12px] border border-hairline p-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-total`}>Alineadores en total</Label>
                <input
                  id={`${fid}-total`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={200}
                  value={alignerTotal}
                  onChange={(e) => setAlignerTotal(e.target.value)}
                  placeholder="Ej: 24"
                  className={`${INPUT} cifra`}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-cada`}>Cambio cada (días)</Label>
                <input
                  id={`${fid}-cada`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={60}
                  value={alignerDays}
                  onChange={(e) => setAlignerDays(e.target.value)}
                  className={`${INPUT} cifra`}
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                Empieza con el alineador 1 el día de inicio.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-cuota`}>Cuota mensual (opcional)</Label>
            <MoneyInput
              id={`${fid}-cuota`}
              valueCents={monthlyFee}
              onValueChange={setMonthlyFee}
              currency={currency}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => crear.mutate()}
            disabled={!patientId || !alineadoresValidos || crear.isPending}
          >
            {crear.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Crear caso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ControlesDialog({
  clinicId,
  caso,
  hoy,
}: {
  clinicId: string;
  caso: OrthoCase;
  hoy: string;
}) {
  const [open, setOpen] = useState(false);
  const [controlDate, setControlDate] = useState(hoy);
  const [attended, setAttended] = useState(true);
  const queryClient = useQueryClient();
  const fetchControls = useServerFn(listOrthoControls);
  const addFn = useServerFn(addOrthoControl);

  const {
    data: controles = [],
    isError: controlesConError,
    refetch: reintentarControles,
  } = useQuery({
    queryKey: ["ortho-controls", caso.id],
    enabled: open,
    queryFn: () => fetchControls({ data: { clinicId, orthoCaseId: caso.id } }),
  });

  const agregar = useMutation({
    mutationFn: () => addFn({ data: { clinicId, orthoCaseId: caso.id, controlDate, attended } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ortho-controls", caso.id] });
      queryClient.invalidateQueries({ queryKey: ["ortho-cases", clinicId] });
      toast.success("Control registrado.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Controles
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Controles — {caso.patientName}</DialogTitle>
          <DialogDescription>
            {ORTHO_CASE_KIND_LABELS[caso.kind]}
            {caso.monthlyFeeCents !== null &&
              ` · Cuota ${formatMoney(caso.monthlyFeeCents, caso.currency)}/mes`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="ctl-fecha">Fecha</Label>
            <input
              id="ctl-fecha"
              type="date"
              value={controlDate}
              onChange={(e) => setControlDate(e.target.value)}
              className={INPUT}
            />
          </div>
          <label className="flex items-center gap-1.5 pb-2 text-sm">
            <input
              type="checkbox"
              checked={attended}
              onChange={(e) => setAttended(e.target.checked)}
            />
            Vino
          </label>
          <Button size="sm" onClick={() => agregar.mutate()} disabled={agregar.isPending}>
            {agregar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Agregar
          </Button>
        </div>
        <div className="max-h-64 space-y-1.5 overflow-y-auto pt-2">
          {controlesConError && (
            <ErrorDeCarga
              onReintentar={reintentarControles}
              mensaje="No pudimos cargar los controles."
            />
          )}
          {!controlesConError && controles.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin controles registrados todavía.</p>
          )}
          {controles.map((c) => (
            <div
              key={c.id}
              className="flex justify-between rounded-lg border border-hairline px-3 py-2 text-sm"
            >
              <span>{formatoFecha(c.controlDate)}</span>
              <span className={c.attended ? "text-success" : "text-destructive"}>
                {c.attended ? "Vino" : "No vino"}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OrtodonciaPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const currency = access.clinic?.currency ?? "CLP";
  const queryClient = useQueryClient();
  const hoy = hoyISO(access.clinic?.timezone);
  const puedeEditar = hasPermission(access.role, "clinical:write");
  const [etapa, setEtapa] = useState<OrthoStage | "sin" | "">("");

  const fetchCases = useServerFn(listOrthoCases);
  const setStatusFn = useServerFn(setOrthoCaseStatus);

  const {
    data: casos = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["ortho-cases", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchCases({ data: { clinicId: clinicId! } }),
  });

  const cambiarEstado = useMutation({
    mutationFn: (v: { caseId: string; status: OrthoCase["status"] }) =>
      setStatusFn({ data: { clinicId: clinicId!, ...v } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ortho-cases", clinicId] });
      toast.success("Estado actualizado.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (!clinicId) return null;

  const activos = casos.filter((c) => c.status === "active");
  const atrasados = activos.filter((c) => controlAtrasado(c, hoy));
  // ORT-03: alineadores con el cambio vencido o para hoy.
  const cambios = activos
    .map((c) => ({ caso: c, cambio: textoCambioAlineador(c, hoy) }))
    .filter((x) => x.cambio?.vencido);
  const requierenAccion = [
    ...atrasados.map((c) => ({
      caso: c,
      texto: c.lastControlOn
        ? `Último control ${formatoFecha(c.lastControlOn)}`
        : "Sin controles desde el inicio",
    })),
    ...cambios
      .filter((x) => !atrasados.includes(x.caso))
      .map((x) => ({ caso: x.caso, texto: x.cambio!.texto })),
  ];
  const visibles =
    etapa === ""
      ? casos
      : etapa === "sin"
        ? casos.filter((c) => c.stage === null)
        : casos.filter((c) => c.stage === etapa);

  return (
    <AppShell title="Ortodoncia" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-6 text-base">
        <EncabezadoEditorial
          contexto={[
            access.clinic?.name,
            atrasados.length > 0 && (
              <span key="atrasados" className="inline-flex items-center gap-1 text-destructive">
                <AlertTriangle className="size-3.5" aria-hidden />
                {atrasados.length} sin control hace 45+ días
              </span>
            ),
          ]}
          titulo={
            isError || isLoading
              ? "Casos"
              : `${activos.length} ${activos.length === 1 ? "caso" : "casos"}`
          }
          enfasis={
            isError || isLoading
              ? "de ortodoncia"
              : `${activos.length === 1 ? "activo" : "activos"} de ortodoncia`
          }
          acciones={<NuevoCasoDialog clinicId={clinicId} currency={currency} hoy={hoy} />}
        />

        {isLoading && <p className="text-sm text-muted-foreground">Cargando casos…</p>}

        {isError && <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar los casos." />}

        {!isLoading && !isError && requierenAccion.length > 0 && (
          <section
            aria-label="Lo que requiere acción"
            className={cn(TINTA, "grid gap-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]")}
          >
            <div className="min-w-0">
              <EtiquetaTinta>Requieren acción</EtiquetaTinta>
              <CifraEnTinta
                valor={String(requierenAccion.length)}
                sufijo={requierenAccion.length === 1 ? " caso" : " casos"}
              />
              <p className="mt-3.5 text-sm font-medium text-on-night-2">
                {atrasados.length} sin control hace 45 días o más · {cambios.length} con cambio de
                alineador vencido o para hoy
              </p>
            </div>
            <ul className="grid content-start gap-2.5">
              {requierenAccion.slice(0, 6).map(({ caso, texto }) => (
                <li
                  key={caso.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2.5 border-b border-night-line pb-2.5 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{caso.patientName}</span>
                    <span className="text-xs text-on-night-2">
                      {nombreDelSistema(caso)}
                      {caso.stage ? ` · ${ORTHO_STAGE_LABELS[caso.stage]}` : ""}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-right text-xs font-semibold text-brand-on-night">
                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                    {texto}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!isLoading && !isError && casos.length === 0 && (
          <div className={cn(PANEL_LISTA, "p-8 text-center")}>
            <p className="mb-1 font-display text-2xl font-medium">Sin casos de ortodoncia</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Registra aquí los tratamientos largos — brackets o alineadores — con su control y su
              cuota mensual, para que no se pierdan entre las citas del día a día.
            </p>
          </div>
        )}

        {!isLoading && casos.length > 0 && (
          <div
            role="group"
            aria-label="Filtrar por etapa"
            className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
          >
            <ChipFiltro activo={etapa === ""} onClick={() => setEtapa("")}>
              Todas las etapas <span className="cifra text-[11px] opacity-70">{casos.length}</span>
            </ChipFiltro>
            {ORTHO_STAGES.filter((s) => casos.some((c) => c.stage === s)).map((s) => (
              <ChipFiltro key={s} activo={etapa === s} onClick={() => setEtapa(s)}>
                {ORTHO_STAGE_LABELS[s]}{" "}
                <span className="cifra text-[11px] opacity-70">
                  {casos.filter((c) => c.stage === s).length}
                </span>
              </ChipFiltro>
            ))}
            {casos.some((c) => c.stage === null) && (
              <ChipFiltro activo={etapa === "sin"} onClick={() => setEtapa("sin")}>
                Sin etapa
              </ChipFiltro>
            )}
          </div>
        )}

        {!isLoading && visibles.length > 0 && (
          <section className={cn(PANEL_LISTA, "divide-y divide-hairline")}>
            {visibles.map((c) => {
              const cambio = c.status === "active" ? textoCambioAlineador(c, hoy) : null;
              return (
                <div
                  key={c.id}
                  className="grid gap-x-6 gap-y-3 px-5 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(12rem,1fr)_auto] lg:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <AvatarIniciales nombre={c.patientName} className="size-10" />
                    <div className="min-w-0">
                      <p className="font-display text-[19px] font-medium leading-tight">
                        {c.patientName}
                        {controlAtrasado(c, hoy) && (
                          <span className="ml-2 inline-flex items-center gap-1 align-middle font-sans text-xs font-semibold text-destructive">
                            <AlertTriangle className="size-3.5" aria-hidden /> Control atrasado
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/80">
                          {nombreDelSistema(c)}
                        </span>
                        <ChipEtapa stage={c.stage} />
                        <span>
                          Desde {formatoFecha(c.startedOn)}
                          {c.monthlyFeeCents !== null &&
                            ` · ${formatMoney(c.monthlyFeeCents, c.currency)}/mes`}
                          {c.lastControlOn
                            ? ` · Último control ${formatoFecha(c.lastControlOn)}`
                            : " · Sin controles"}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <ProgresoOrto caso={c} hoy={hoy} />
                    {cambio && (
                      <p
                        className={cn(
                          "mt-1 text-xs",
                          cambio.vencido
                            ? "font-semibold text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {cambio.texto}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={c.status}
                      aria-label={`Estado del caso de ${c.patientName}`}
                      onChange={(e) =>
                        cambiarEstado.mutate({
                          caseId: c.id,
                          status: e.target.value as OrthoCase["status"],
                        })
                      }
                      className={`${INPUT} w-auto`}
                    >
                      {ORTHO_CASE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {ORTHO_CASE_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                    <SeguimientoDialog
                      clinicId={clinicId}
                      caso={c}
                      hoy={hoy}
                      puedeEditar={puedeEditar}
                    />
                    <ControlesDialog clinicId={clinicId} caso={c} hoy={hoy} />
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>
    </AppShell>
  );
}
