import { useEffect, useId, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, Loader2, Percent, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AtiendePacientes } from "@/components/atiende-pacientes";
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
import { SelectorColorProfesional } from "@/components/selector-color-profesional";
import {
  colorProfesional,
  PALETA_PROFESIONALES,
  colorDePaleta,
  COLOR_PROFESIONAL_POR_DEFECTO,
} from "@/lib/clinic-operations/color-profesional";
import { listBranches, listSpecialties } from "@/lib/clinic-operations/clinic-catalog.functions";
import {
  createProfessional,
  getProfessionalSchedule,
  listProfessionalsDetailed,
  setProfessionalSchedule,
  updateProfessional,
  type ProfessionalDetail,
  type ScheduleBlock,
} from "@/lib/clinic-operations/professionals.functions";
import {
  listCommissionRules,
  removeCommissionRule,
  setCommissionRule,
  type CommissionKind,
} from "@/lib/finance/commissions.functions";
import { formatMoney, fromCents, toCents } from "@/lib/finance/finance";
import { requirePermission } from "@/lib/access/route-guards";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

function inputClass() {
  return "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";
}

/** Orden de despliegue lunes→domingo. El value es el day_of_week real
 * (0=domingo…6=sábado, igual que Date.getDay()) — solo el orden visual
 * cambia, no el dato. */
const DAYS = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

type ProfessionalFormState = {
  fullName: string;
  email: string;
  phone: string;
  licenseNumber: string;
  color: string;
  branchId: string | null;
  specialtyId: string | null;
};

const EMPTY_FORM: ProfessionalFormState = {
  fullName: "",
  email: "",
  phone: "",
  licenseNumber: "",
  color: COLOR_PROFESIONAL_POR_DEFECTO,
  branchId: null,
  specialtyId: null,
};

function ProfessionalFields({
  form,
  onChange,
  branches,
  specialties,
  idPrefix,
  coloresUsados,
}: {
  form: ProfessionalFormState;
  onChange: (next: ProfessionalFormState) => void;
  branches: { id: string; nombre: string }[];
  specialties: { id: string; name: string }[];
  idPrefix: string;
  /** Colores de los otros profesionales activos (AGE-06). */
  coloresUsados: readonly string[];
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-nombre`}>Nombre completo</Label>
        <input
          id={`${idPrefix}-nombre`}
          value={form.fullName}
          onChange={(e) => onChange({ ...form, fullName: e.target.value })}
          className={inputClass()}
          placeholder="Dra. Carolina Rodríguez"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-email`}>Email</Label>
          <input
            id={`${idPrefix}-email`}
            type="email"
            value={form.email}
            onChange={(e) => onChange({ ...form, email: e.target.value })}
            className={inputClass()}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-telefono`}>Teléfono</Label>
          <input
            id={`${idPrefix}-telefono`}
            value={form.phone}
            onChange={(e) => onChange({ ...form, phone: e.target.value })}
            className={inputClass()}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-matricula`}>Matrícula (opcional)</Label>
        <input
          id={`${idPrefix}-matricula`}
          value={form.licenseNumber}
          onChange={(e) => onChange({ ...form, licenseNumber: e.target.value })}
          className={inputClass()}
        />
      </div>
      <SelectorColorProfesional
        id={`${idPrefix}-color`}
        value={form.color}
        onChange={(color) => onChange({ ...form, color })}
        usados={coloresUsados}
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-sucursal`}>Sucursal</Label>
          <select
            id={`${idPrefix}-sucursal`}
            value={form.branchId ?? ""}
            onChange={(e) => onChange({ ...form, branchId: e.target.value || null })}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <option value="">Sin asignar</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-especialidad`}>Especialidad</Label>
          <select
            id={`${idPrefix}-especialidad`}
            value={form.specialtyId ?? ""}
            onChange={(e) => onChange({ ...form, specialtyId: e.target.value || null })}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <option value="">Sin asignar</option>
            {specialties.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/** Primer color de la paleta que nadie usa (o el por defecto si están todos). */
function colorLibre(usados: readonly string[]): string {
  const tokens = new Set(usados.map((u) => colorDePaleta(u).token));
  return (
    PALETA_PROFESIONALES.find((c) => !tokens.has(c.token))?.claro ?? COLOR_PROFESIONAL_POR_DEFECTO
  );
}

function NuevoProfesionalDialog({
  clinicId,
  branches,
  specialties,
  coloresUsados,
}: {
  clinicId: string;
  branches: { id: string; nombre: string }[];
  specialties: { id: string; name: string }[];
  coloresUsados: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProfessionalFormState>(EMPTY_FORM);
  const formVacio = () => ({ ...EMPTY_FORM, color: colorLibre(coloresUsados) });

  const queryClient = useQueryClient();
  const createFn = useServerFn(createProfessional);

  const crear = useMutation({
    mutationFn: () => createFn({ data: { clinicId, professional: form } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["professionals-detailed", clinicId] });
      toast.success("Profesional agregado.");
      setOpen(false);
      setForm(formVacio());
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => (setOpen(v), setForm(formVacio()))}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Nuevo profesional
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo profesional</DialogTitle>
          <DialogDescription>
            El horario de atención se configura después, desde "Horario" en la lista.
          </DialogDescription>
        </DialogHeader>
        <ProfessionalFields
          form={form}
          onChange={setForm}
          branches={branches}
          specialties={specialties}
          idPrefix="np"
          coloresUsados={coloresUsados}
        />
        <DialogFooter>
          <Button
            onClick={() => crear.mutate()}
            disabled={crear.isPending || form.fullName.trim().length < 2}
          >
            {crear.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Crear profesional
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarProfesionalDialog({
  clinicId,
  professional,
  branches,
  specialties,
  coloresUsados,
}: {
  clinicId: string;
  professional: ProfessionalDetail;
  branches: { id: string; nombre: string }[];
  specialties: { id: string; name: string }[];
  coloresUsados: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProfessionalFormState>({
    fullName: professional.fullName,
    email: professional.email ?? "",
    phone: professional.phone ?? "",
    licenseNumber: professional.licenseNumber ?? "",
    color: professional.color,
    branchId: professional.branchId,
    specialtyId: professional.specialtyId,
  });
  const [isActive, setIsActive] = useState(professional.isActive);

  const queryClient = useQueryClient();
  const updateFn = useServerFn(updateProfessional);

  const guardar = useMutation({
    mutationFn: () =>
      updateFn({
        data: { clinicId, professionalId: professional.id, professional: form, isActive },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["professionals-detailed", clinicId] });
      toast.success("Profesional actualizado.");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar {professional.fullName}</DialogTitle>
        </DialogHeader>
        <ProfessionalFields
          form={form}
          onChange={setForm}
          branches={branches}
          specialties={specialties}
          idPrefix={`ep-${professional.id}`}
          coloresUsados={coloresUsados}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Profesional activo (desmarcar = dar de baja, no borra su historial)
        </label>
        <DialogFooter>
          <Button
            onClick={() => guardar.mutate()}
            disabled={guardar.isPending || form.fullName.trim().length < 2}
          >
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ComisionDialog({
  clinicId,
  professional,
  currency,
}: {
  clinicId: string;
  professional: ProfessionalDetail;
  currency: string;
}) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CommissionKind>("percent");
  const [percent, setPercent] = useState(""); // en %, ej "40"
  const [fixed, setFixed] = useState(""); // en unidad monetaria

  const fetchRules = useServerFn(listCommissionRules);
  const rulesQuery = useQuery({
    queryKey: ["commission-rules", clinicId],
    queryFn: () => fetchRules({ data: { clinicId } }),
    enabled: open,
  });

  useEffect(() => {
    const rule = rulesQuery.data?.find((r) => r.professionalId === professional.id);
    if (rule) {
      setKind(rule.kind);
      setPercent(rule.percentBps ? String(rule.percentBps / 100) : "");
      setFixed(rule.fixedCents ? String(fromCents(rule.fixedCents, currency)) : "");
    }
  }, [rulesQuery.data, professional.id, currency]);

  const queryClient = useQueryClient();
  const saveFn = useServerFn(setCommissionRule);
  const removeFn = useServerFn(removeCommissionRule);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["commission-rules", clinicId] });
    queryClient.invalidateQueries({ queryKey: ["commission-report", clinicId] });
  };

  const guardar = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          clinicId,
          professionalId: professional.id,
          kind,
          percentBps: kind === "percent" ? Math.round(Number(percent || 0) * 100) : 0,
          fixedCents: kind === "fixed" ? toCents(Number(fixed || 0), currency) : 0,
        },
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Comisión actualizada.");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const quitar = useMutation({
    mutationFn: () => removeFn({ data: { clinicId, professionalId: professional.id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Comisión quitada.");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const tieneRegla = Boolean(rulesQuery.data?.some((r) => r.professionalId === professional.id));
  const percentInvalido = kind === "percent" && (Number(percent) < 0 || Number(percent) > 100);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Percent className="size-3.5" /> Comisión
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Comisión — {professional.fullName}</DialogTitle>
          <DialogDescription>
            Se calcula sobre los procedimientos completados en el período (ver Comisiones).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-tipo`}>Tipo de comisión</Label>
            <select
              id={`${fid}-tipo`}
              value={kind}
              onChange={(e) => setKind(e.target.value as CommissionKind)}
              className={inputClass()}
            >
              <option value="percent">% sobre producción</option>
              <option value="fixed">Monto fijo por procedimiento</option>
            </select>
          </div>
          {kind === "percent" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-porcentaje`}>Porcentaje (%)</Label>
              <input
                id={`${fid}-porcentaje`}
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                className={inputClass()}
                placeholder="Ej: 40"
              />
              <p className="text-xs text-muted-foreground">
                Comisión = {percent || 0}% de lo producido (procedimientos completados) en el
                período.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-monto`}>Monto por procedimiento ({currency})</Label>
              <input
                id={`${fid}-monto`}
                type="number"
                min={0}
                step="0.01"
                value={fixed}
                onChange={(e) => setFixed(e.target.value)}
                className={inputClass()}
              />
              <p className="text-xs text-muted-foreground">
                Comisión = {formatMoney(toCents(Number(fixed || 0), currency), currency)} × cantidad
                de procedimientos completados.
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          {tieneRegla ? (
            <Button variant="ghost" onClick={() => quitar.mutate()} disabled={quitar.isPending}>
              Quitar comisión
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={() => guardar.mutate()} disabled={guardar.isPending || percentInvalido}>
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TramoEditable = { start: string; end: string; branchId: string };

/**
 * Horario semanal del profesional. Cada día puede tener varios tramos (mañana
 * y tarde: entre los dos está la colación) y, desde la Ola 2 (AGE-23), cada
 * tramo dice en qué sucursal atiende. "Cualquier sucursal" es lo de antes.
 */
function HorarioDialog({
  clinicId,
  professional,
  sucursales,
}: {
  clinicId: string;
  professional: ProfessionalDetail;
  sucursales: { id: string; nombre: string }[];
}) {
  const [open, setOpen] = useState(false);
  // Día → tramos (vacío = no atiende ese día).
  const [dias, setDias] = useState<Record<number, TramoEditable[]>>({});
  const conSucursal = sucursales.length > 1;

  const fetchSchedule = useServerFn(getProfessionalSchedule);
  const scheduleQuery = useQuery({
    queryKey: ["professional-schedule", clinicId, professional.id],
    queryFn: () => fetchSchedule({ data: { clinicId, professionalId: professional.id } }),
    enabled: open,
  });

  useEffect(() => {
    if (!scheduleQuery.data) return;
    const next: Record<number, TramoEditable[]> = {};
    for (const d of DAYS) next[d.value] = [];
    for (const block of scheduleQuery.data as ScheduleBlock[]) {
      next[block.dayOfWeek].push({
        start: block.startTime,
        end: block.endTime,
        branchId: block.branchId ?? "",
      });
    }
    setDias(next);
  }, [scheduleQuery.data]);

  const queryClient = useQueryClient();
  const saveFn = useServerFn(setProfessionalSchedule);

  const guardar = useMutation({
    mutationFn: () => {
      const blocks = DAYS.flatMap((d) =>
        (dias[d.value] ?? []).map((t) => ({
          dayOfWeek: d.value,
          startTime: t.start,
          endTime: t.end,
          branchId: t.branchId || null,
        })),
      );
      return saveFn({ data: { clinicId, professionalId: professional.id, blocks } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["professional-schedule", clinicId, professional.id],
      });
      // La agenda y el formulario de cita leen todos los horarios juntos.
      queryClient.invalidateQueries({ queryKey: ["professional-schedules", clinicId] });
      toast.success("Horario actualizado.");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const invalido = DAYS.some((d) =>
    (dias[d.value] ?? []).some((t) => !t.start || t.start >= t.end),
  );

  function cambiarTramo(dia: number, i: number, cambio: Partial<TramoEditable>) {
    setDias((prev) => ({
      ...prev,
      [dia]: (prev[dia] ?? []).map((t, j) => (j === i ? { ...t, ...cambio } : t)),
    }));
  }

  function agregarTramo(dia: number) {
    setDias((prev) => {
      const actuales = prev[dia] ?? [];
      const ultimo = actuales[actuales.length - 1];
      const nuevo: TramoEditable = ultimo
        ? { start: ultimo.end, end: ultimo.end < "18:00" ? "18:00" : "20:00", branchId: "" }
        : { start: "09:00", end: "18:00", branchId: professional.branchId ?? "" };
      return { ...prev, [dia]: [...actuales, nuevo] };
    });
  }

  function quitarTramo(dia: number, i: number) {
    setDias((prev) => ({ ...prev, [dia]: (prev[dia] ?? []).filter((_, j) => j !== i) }));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Clock className="size-3.5" /> Horario
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Horario — {professional.fullName}</DialogTitle>
          <DialogDescription>
            Sin ningún día marcado, no hay restricción: se puede agendar cualquier día y hora, como
            hasta ahora. Un día sin marcar significa que no atiende ese día.
            {conSucursal &&
              " Si atiende en varias sucursales, elige en cuál está cada tramo: el formulario de cita lo mostrará en esa sucursal."}
          </DialogDescription>
        </DialogHeader>
        {scheduleQuery.isLoading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando horario…
          </p>
        ) : (
          <ul className="space-y-3">
            {DAYS.map((d) => {
              const tramos = dias[d.value] ?? [];
              return (
                <li key={d.value} className="space-y-1.5">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={tramos.length > 0}
                      onChange={(e) =>
                        e.target.checked
                          ? agregarTramo(d.value)
                          : setDias((prev) => ({ ...prev, [d.value]: [] }))
                      }
                    />
                    {d.label}
                  </label>
                  {tramos.map((t, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 pl-6">
                      <input
                        type="time"
                        aria-label={`${d.label}, tramo ${i + 1}: desde`}
                        value={t.start}
                        onChange={(e) => cambiarTramo(d.value, i, { start: e.target.value })}
                        className={cn(inputClass(), "w-32")}
                      />
                      <span className="text-xs text-muted-foreground">a</span>
                      <input
                        type="time"
                        aria-label={`${d.label}, tramo ${i + 1}: hasta`}
                        value={t.end}
                        onChange={(e) => cambiarTramo(d.value, i, { end: e.target.value })}
                        className={cn(inputClass(), "w-32")}
                      />
                      {conSucursal && (
                        <select
                          aria-label={`${d.label}, tramo ${i + 1}: sucursal`}
                          value={t.branchId}
                          onChange={(e) => cambiarTramo(d.value, i, { branchId: e.target.value })}
                          className={cn(inputClass(), "w-auto min-w-0 flex-1 basis-40")}
                        >
                          <option value="">Cualquier sucursal</option>
                          {sucursales.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.nombre}
                            </option>
                          ))}
                        </select>
                      )}
                      {tramos.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => quitarTramo(d.value, i)}
                          aria-label={`Quitar el tramo ${i + 1} del ${d.label.toLowerCase()}`}
                        >
                          Quitar
                        </Button>
                      )}
                    </div>
                  ))}
                  {tramos.length > 0 && tramos.length < 4 && (
                    <button
                      type="button"
                      onClick={() => agregarTramo(d.value)}
                      className="ml-6 text-xs font-medium text-brand-700 hover:underline"
                    >
                      + Otro tramo el {d.label.toLowerCase()}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button onClick={() => guardar.mutate()} disabled={guardar.isPending || invalido}>
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Guardar horario
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const Route = createFileRoute("/_authenticated/_clinic/profesionales")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Profesionales | Esmalia" },
      {
        name: "description",
        content: "Administra los profesionales de la clínica y su horario de atención.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProfesionalesPage,
});

function ProfesionalesPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic!.id;

  const fetchProfessionals = useServerFn(listProfessionalsDetailed);
  const professionalsQuery = useQuery({
    queryKey: ["professionals-detailed", clinicId],
    queryFn: () => fetchProfessionals({ data: { clinicId } }),
  });

  const fetchBranches = useServerFn(listBranches);
  const branchesQuery = useQuery({
    queryKey: ["branches", clinicId],
    queryFn: () => fetchBranches({ data: { clinicId } }),
  });

  const fetchSpecialties = useServerFn(listSpecialties);
  const specialtiesQuery = useQuery({
    queryKey: ["specialties", clinicId],
    queryFn: () => fetchSpecialties({ data: { clinicId } }),
  });

  const professionals = professionalsQuery.data ?? [];
  const activeProfessionals = professionals.filter((p) => p.isActive);
  const inactiveProfessionals = professionals.filter((p) => !p.isActive);
  // Colores en uso (AGE-06): el selector avisa si se repite uno.
  const coloresDeOtros = (id?: string) =>
    activeProfessionals.filter((p) => p.id !== id).map((p) => p.color);
  const branches = branchesQuery.data ?? [];
  const specialties = specialtiesQuery.data ?? [];

  return (
    <AppShell title="Profesionales" access={access}>
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold">
              Profesionales de {access.clinic!.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {activeProfessionals.length} activo{activeProfessionals.length === 1 ? "" : "s"}.
            </p>
          </div>
          <NuevoProfesionalDialog
            clinicId={clinicId}
            branches={branches}
            specialties={specialties}
            coloresUsados={coloresDeOtros()}
          />
        </div>

        <section className="card-clinical divide-y divide-hairline">
          {professionalsQuery.isLoading && (
            <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando profesionales…
            </p>
          )}
          {professionalsQuery.isError && (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No pudimos cargar los profesionales.
            </p>
          )}
          {professionalsQuery.data && activeProfessionals.length === 0 && (
            <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
              <UserRound className="size-4" /> Todavía no hay profesionales cargados.
            </p>
          )}
          {activeProfessionals.map((professional) => (
            <div
              key={professional.id}
              className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"
            >
              <div className="flex items-start gap-3">
                <span
                  className="mt-1 size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: colorProfesional(professional.color) }}
                />
                <div>
                  <p className="font-medium">{professional.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {professional.specialtyName ?? "Sin especialidad"}
                    {professional.branchName ? ` · ${professional.branchName}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <AtiendePacientes clinicId={clinicId} professional={professional} />
                <HorarioDialog
                  clinicId={clinicId}
                  professional={professional}
                  sucursales={branches.map((b) => ({ id: b.id, nombre: b.nombre }))}
                />
                <ComisionDialog
                  clinicId={clinicId}
                  professional={professional}
                  currency={access.clinic!.currency}
                />
                <EditarProfesionalDialog
                  clinicId={clinicId}
                  professional={professional}
                  branches={branches}
                  specialties={specialties}
                  coloresUsados={coloresDeOtros(professional.id)}
                />
              </div>
            </div>
          ))}
        </section>

        {inactiveProfessionals.length > 0 && (
          <section className="space-y-3">
            <h3 className="font-display text-sm font-semibold text-muted-foreground">
              Profesionales dados de baja
            </h3>
            <div className="card-clinical divide-y divide-hairline">
              {inactiveProfessionals.map((professional) => (
                <div
                  key={professional.id}
                  className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"
                >
                  <p className="text-muted-foreground">{professional.fullName}</p>
                  <EditarProfesionalDialog
                    clinicId={clinicId}
                    professional={professional}
                    branches={branches}
                    specialties={specialties}
                    coloresUsados={coloresDeOtros(professional.id)}
                  />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
