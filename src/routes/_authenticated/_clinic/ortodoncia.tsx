import { useId, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AvatarIniciales, EncabezadoEditorial, PANEL_LISTA } from "@/components/a-plus/lista";
import { AppShell } from "@/components/app-shell";
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
  ORTHO_CASE_KINDS,
  ORTHO_CASE_KIND_LABELS,
  ORTHO_CASE_STATUSES,
  ORTHO_CASE_STATUS_LABELS,
  controlAtrasado,
  type OrthoCase,
  type OrthoCaseKind,
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

function NuevoCasoDialog({ clinicId }: { clinicId: string }) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [kind, setKind] = useState<OrthoCaseKind>("brackets");
  const [startedOn, setStartedOn] = useState(hoyISO());
  const [monthlyFee, setMonthlyFee] = useState<number | null>(null);
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
          kind,
          startedOn,
          monthlyFeeCents: monthlyFee,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ortho-cases", clinicId] });
      toast.success("Caso de ortodoncia creado.");
      setOpen(false);
      setPatientId("");
      setMonthlyFee(null);
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
      <DialogContent>
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
              <Label htmlFor="oc-kind">Tipo</Label>
              <select
                id="oc-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as OrthoCaseKind)}
                className={INPUT}
              >
                {ORTHO_CASE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ORTHO_CASE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-cuota`}>Cuota mensual (opcional)</Label>
            <MoneyInput
              id={`${fid}-cuota`}
              valueCents={monthlyFee}
              onValueChange={setMonthlyFee}
              currency="CLP"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => crear.mutate()} disabled={!patientId || crear.isPending}>
            {crear.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Crear caso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ControlesDialog({ clinicId, caso }: { clinicId: string; caso: OrthoCase }) {
  const [open, setOpen] = useState(false);
  const [controlDate, setControlDate] = useState(hoyISO());
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
  const queryClient = useQueryClient();
  const hoy = hoyISO(access.clinic?.timezone);

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
          acciones={<NuevoCasoDialog clinicId={clinicId} />}
        />

        {isLoading && <p className="text-sm text-muted-foreground">Cargando casos…</p>}

        {isError && <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar los casos." />}

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
          <section className={cn(PANEL_LISTA, "divide-y divide-hairline")}>
            {casos.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
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
                    <p className="text-xs text-muted-foreground">
                      {ORTHO_CASE_KIND_LABELS[c.kind]} · Desde {formatoFecha(c.startedOn)}
                      {c.monthlyFeeCents !== null &&
                        ` · ${formatMoney(c.monthlyFeeCents, c.currency)}/mes`}
                      {c.lastControlOn
                        ? ` · Último control ${formatoFecha(c.lastControlOn)}`
                        : " · Sin controles"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={c.status}
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
                  <ControlesDialog clinicId={clinicId} caso={c} />
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </AppShell>
  );
}
