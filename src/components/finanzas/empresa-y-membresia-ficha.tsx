/**
 * Empresa con convenio y membresía del paciente, en la pestaña Finanzas de su
 * ficha (Ola 10 · frente A: FIC-05, FIC-06). Bloque mínimo: muestra y edita la
 * afiliación y la inscripción, y deja cobrar a mano una cuota pendiente.
 *
 * Lo ve el equipo que atiende y cobra (owner, admin, dentist, reception,
 * accounting); assistant no (regla 2). El servidor repite el chequeo.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Loader2, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { DialogoCobrar } from "@/components/finanzas/cobrar-cuota-dialog";
import { INPUT } from "@/components/finanzas/piezas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { hasPermission, type ClinicRole } from "@/lib/access/access";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { ROLES_AFILIACION, describirDescuento } from "@/lib/finance/empresas-convenio";
import {
  getEmpresaDelPaciente,
  listEmpresasConvenio,
  setEmpresaDelPaciente,
} from "@/lib/finance/empresas-convenio.functions";
import { formatMoney } from "@/lib/finance/finance";
import { mesDe } from "@/lib/finance/gastos-fijos";
import {
  ETIQUETA_INSCRIPCION,
  etiquetaCuota,
  etiquetaPeriodoCuota,
} from "@/lib/finance/membresias";
import {
  cambiarEstadoMembresia,
  getMembresiaDelPaciente,
  inscribirEnMembresia,
  listPlanesMembresia,
  type CuotaMembresia,
} from "@/lib/finance/membresias.functions";
import { mesAnio } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";

interface Props {
  clinicId: string;
  patientId: string;
  patientName: string;
  timezone: string;
  rol: ClinicRole | null | undefined;
}

const TARJETA = "min-w-0 rounded-[14px] border border-hairline bg-card p-4";

export function EmpresaYMembresiaFicha(props: Props) {
  if (!props.rol || !ROLES_AFILIACION.includes(props.rol)) return null;
  return (
    <div className="mb-[18px] grid gap-3 md:grid-cols-2">
      <BloqueEmpresa {...props} />
      <BloqueMembresia {...props} />
    </div>
  );
}

function BloqueEmpresa({ clinicId, patientId, timezone }: Props) {
  const fetchEmpresas = useServerFn(listEmpresasConvenio);
  const fetchAfiliacion = useServerFn(getEmpresaDelPaciente);
  const empresas = useQuery({
    queryKey: ["empresas-convenio", clinicId],
    queryFn: () => fetchEmpresas({ data: { clinicId } }),
  });
  const afiliacion = useQuery({
    queryKey: ["empresa-paciente", clinicId, patientId],
    queryFn: () => fetchAfiliacion({ data: { clinicId, patientId } }),
  });
  const [editando, setEditando] = useState(false);
  const empresa = (empresas.data ?? []).find((e) => e.id === afiliacion.data?.companyId) ?? null;

  return (
    <section aria-labelledby="ficha-empresa" className={TARJETA}>
      <div className="flex items-start justify-between gap-2">
        <h3 id="ficha-empresa" className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-muted-foreground" aria-hidden /> Empresa con convenio
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditando(true)}
          disabled={!afiliacion.isSuccess}
          aria-label="Editar empresa del paciente"
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
      {afiliacion.isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">Cargando…</p>
      ) : empresa ? (
        <div className="mt-1.5">
          <p className="text-[15px] font-semibold">{empresa.name}</p>
          <p className="text-[13px] text-muted-foreground">
            {describirDescuento(empresa)}
            {empresa.payrollDeduction ? " · paga por planilla" : ""}
            {afiliacion.data?.employeeCode ? ` · código ${afiliacion.data.employeeCode}` : ""}
            {!empresa.active && " · empresa desactivada"}
          </p>
        </div>
      ) : (
        <p className="mt-1.5 text-sm text-muted-foreground">
          Sin empresa. Si trabaja en una empresa con convenio, afílialo para aplicar su descuento.
        </p>
      )}
      {editando && afiliacion.isSuccess && (
        <DialogoEmpresa
          clinicId={clinicId}
          patientId={patientId}
          timezone={timezone}
          empresas={empresas.data ?? []}
          actual={afiliacion.data}
          onCerrar={() => setEditando(false)}
        />
      )}
    </section>
  );
}

function DialogoEmpresa({
  clinicId,
  patientId,
  timezone,
  empresas,
  actual,
  onCerrar,
}: {
  clinicId: string;
  patientId: string;
  timezone: string;
  empresas: Awaited<ReturnType<typeof listEmpresasConvenio>>;
  actual: Awaited<ReturnType<typeof getEmpresaDelPaciente>>;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState(actual?.companyId ?? "");
  const [codigo, setCodigo] = useState(actual?.employeeCode ?? "");
  const fn = useServerFn(setEmpresaDelPaciente);
  const guardar = useMutation({
    mutationFn: () =>
      fn({
        data: {
          clinicId,
          patientId,
          companyId: companyId || null,
          employeeCode: codigo.trim() || null,
          since: actual?.since ?? (companyId ? hoyISO(timezone) : null),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["empresa-paciente", clinicId, patientId] });
      void qc.invalidateQueries({ queryKey: ["empresas-convenio", clinicId] });
      toast.success(companyId ? "Empresa guardada" : "Empresa quitada");
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const opciones = empresas.filter((e) => e.active || e.id === actual?.companyId);
  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Empresa con convenio</DialogTitle>
          <DialogDescription>
            Un paciente puede estar afiliado a una sola empresa. Las empresas se administran en{" "}
            <Link to="/empresas-con-convenio" className="underline underline-offset-4">
              Empresas con convenio
            </Link>
            .
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fe-empresa">Empresa</Label>
            <select
              id="fe-empresa"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={INPUT}
            >
              <option value="">Sin empresa</option>
              {opciones.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {describirDescuento(e)}
                </option>
              ))}
            </select>
            {opciones.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Todavía no hay empresas con convenio en la clínica.
              </p>
            )}
          </div>
          {companyId && (
            <div className="space-y-1.5">
              <Label htmlFor="fe-codigo">Código o RUT de trabajador</Label>
              <input
                id="fe-codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Lo que pide la empresa para la planilla (opcional)"
                className={INPUT}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
            {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BloqueMembresia({ clinicId, patientId, patientName, timezone, rol }: Props) {
  const qc = useQueryClient();
  const fetchMembresia = useServerFn(getMembresiaDelPaciente);
  const membresia = useQuery({
    queryKey: ["membresia-paciente", clinicId, patientId],
    queryFn: () => fetchMembresia({ data: { clinicId, patientId } }),
  });
  const [inscribiendo, setInscribiendo] = useState(false);
  const [cobrando, setCobrando] = useState<CuotaMembresia | null>(null);
  const puedeCobrar = hasPermission(rol, "cash:manage");
  const estadoFn = useServerFn(cambiarEstadoMembresia);
  const cambiar = useMutation({
    mutationFn: (status: "active" | "paused" | "cancelled") =>
      estadoFn({ data: { clinicId, id: membresia.data!.id, status } }),
    onSuccess: (_d, status) => {
      void qc.invalidateQueries({ queryKey: ["membresia-paciente", clinicId, patientId] });
      toast.success(
        status === "cancelled"
          ? "Membresía cancelada"
          : status === "paused"
            ? "Membresía pausada"
            : "Membresía reanudada",
      );
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const m = membresia.data;
  const pendientes = (m?.cuotas ?? []).filter((c) => c.status === "pending");

  return (
    <section aria-labelledby="ficha-membresia" className={TARJETA}>
      <div className="flex items-start justify-between gap-2">
        <h3 id="ficha-membresia" className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-muted-foreground" aria-hidden /> Membresía
        </h3>
        {m && m.status !== "cancelled" && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={cambiar.isPending}
              onClick={() => cambiar.mutate(m.status === "paused" ? "active" : "paused")}
            >
              {m.status === "paused" ? "Reanudar" : "Pausar"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={cambiar.isPending}
              onClick={() => {
                if (window.confirm(`¿Cancelar la membresía ${m.planName} de ${patientName}?`))
                  cambiar.mutate("cancelled");
              }}
            >
              Cancelar
            </Button>
          </div>
        )}
      </div>
      {membresia.isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">Cargando…</p>
      ) : m ? (
        <div className="mt-1.5 space-y-2">
          <div>
            <p className="text-[15px] font-semibold">{m.planName}</p>
            <p className="text-[13px] text-muted-foreground">
              {etiquetaCuota(m.feeCents, m.billingPeriod, m.currency)} · desde {mesAnio(m.startsOn)}{" "}
              · {ETIQUETA_INSCRIPCION[m.status]}
              {m.treatmentDiscountPercent !== null &&
                ` · ${String(m.treatmentDiscountPercent).replace(".", ",")} % en tratamientos`}
            </p>
          </div>
          {m.benefits.length > 0 && (
            <ul className="list-disc pl-5 text-[13px] text-foreground/80">
              {m.benefits.slice(0, 4).map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {pendientes.length > 0 && (
            <ul className="space-y-1.5 border-t border-hairline pt-2">
              {pendientes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    Cuota {etiquetaPeriodoCuota(c.periodStart, c.periodEnd)} ·{" "}
                    <span className="cifra">{formatMoney(c.amountCents, c.currency)}</span>
                  </span>
                  {puedeCobrar && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCobrando({ ...c, patientName })}
                    >
                      Cobrar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Sin membresía.</p>
          <Button size="sm" variant="outline" onClick={() => setInscribiendo(true)}>
            Inscribir en un plan
          </Button>
        </div>
      )}
      {inscribiendo && (
        <DialogoInscribir
          clinicId={clinicId}
          patientId={patientId}
          timezone={timezone}
          onCerrar={() => setInscribiendo(false)}
        />
      )}
      {cobrando && (
        <DialogoCobrar
          clinicId={clinicId}
          cuota={cobrando}
          onCerrar={() => {
            setCobrando(null);
            void qc.invalidateQueries({ queryKey: ["membresia-paciente", clinicId, patientId] });
          }}
        />
      )}
    </section>
  );
}

function DialogoInscribir({
  clinicId,
  patientId,
  timezone,
  onCerrar,
}: {
  clinicId: string;
  patientId: string;
  timezone: string;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const fetchPlanes = useServerFn(listPlanesMembresia);
  const planes = useQuery({
    queryKey: ["membresias-planes", clinicId],
    queryFn: () => fetchPlanes({ data: { clinicId } }),
  });
  const activos = (planes.data ?? []).filter((p) => p.active);
  const [planId, setPlanId] = useState("");
  const [desde, setDesde] = useState(mesDe(hoyISO(timezone)).slice(0, 7));
  const fn = useServerFn(inscribirEnMembresia);
  const inscribir = useMutation({
    mutationFn: () =>
      fn({ data: { clinicId, patientId, planId, startsOn: `${desde}-01`, notes: null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["membresia-paciente", clinicId, patientId] });
      void qc.invalidateQueries({ queryKey: ["membresias-planes", clinicId] });
      toast.success("Paciente inscrito");
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const elegido = activos.find((p) => p.id === planId);
  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Inscribir en una membresía</DialogTitle>
          <DialogDescription>
            La cuota queda pactada con el valor de hoy. No se cobra sola: cada mes se genera la
            cuota y se cobra a mano.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fi-plan">Plan</Label>
            <select
              id="fi-plan"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className={INPUT}
            >
              <option value="">Elige un plan</option>
              {activos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {etiquetaCuota(p.feeCents, p.billingPeriod, p.currency)}
                </option>
              ))}
            </select>
            {planes.isSuccess && activos.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay planes activos: créalos en{" "}
                <Link
                  to="/membresias"
                  search={{ mes: "" }}
                  className="underline underline-offset-4"
                >
                  Membresías
                </Link>
                .
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fi-desde">Desde</Label>
            <input
              id="fi-desde"
              type="month"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className={INPUT}
            />
          </div>
          {elegido && elegido.benefits.length > 0 && (
            <ul className="list-disc pl-5 text-[13px] text-foreground/80">
              {elegido.benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter className="flex-col items-end gap-1.5 sm:flex-row sm:items-center">
          {!planId && (
            <p id="fi-motivo" className="text-xs text-muted-foreground">
              Elige un plan.
            </p>
          )}
          <Button
            onClick={() => inscribir.mutate()}
            disabled={!planId || !desde || inscribir.isPending}
            aria-describedby={!planId ? "fi-motivo" : undefined}
          >
            {inscribir.isPending && <Loader2 className="size-4 animate-spin" />}
            Inscribir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
