import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

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
import { requirePermission } from "@/lib/access/route-guards";
import {
  listAppointmentStatuses,
  setAppointmentStatusActive,
  upsertAppointmentStatus,
  type AppointmentStatusOption,
} from "@/lib/clinic-operations/clinic-operations.functions";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";

export const Route = createFileRoute("/_authenticated/_clinic/estados-de-cita")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Estados de cita | Esmalia" },
      {
        name: "description",
        content:
          "Etiquetas y colores propios para los estados de la agenda, sin cambiar cómo funciona el sistema por debajo.",
      },
    ],
  }),
  component: EstadosDeCitaPage,
});

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Los seis estados canónicos del sistema. La clínica puede tener muchas
 * etiquetas propias, pero cada una tiene que decir a cuál de estos seis
 * equivale: es lo que hace que agregar vocabulario no rompa ningún filtro,
 * reporte ni recordatorio existente.
 */
const CANONICOS = [
  { value: "tentativa", label: "Tentativa", ayuda: "Agendada, nadie confirmó todavía" },
  { value: "confirmada", label: "Confirmada", ayuda: "El paciente dijo que viene" },
  { value: "en-sala", label: "En sala", ayuda: "Ya llegó o se está atendiendo" },
  { value: "finalizada", label: "Finalizada", ayuda: "Se atendió y terminó" },
  { value: "ausente", label: "Ausente", ayuda: "No vino" },
  { value: "cancelada", label: "Cancelada", ayuda: "Se anuló" },
] as const;

type Canonico = (typeof CANONICOS)[number]["value"];

function EstadoDialog({
  clinicId,
  estado,
}: {
  clinicId: string;
  estado?: AppointmentStatusOption;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(estado?.label ?? "");
  const [canonical, setCanonical] = useState<Canonico>(
    (estado?.canonical as Canonico) ?? "tentativa",
  );
  const [color, setColor] = useState(estado?.color ?? "#8e8984");
  const queryClient = useQueryClient();
  const upsertFn = useServerFn(upsertAppointmentStatus);

  const guardar = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          clinicId,
          statusId: estado?.id ?? null,
          label: label.trim(),
          canonical,
          color,
          position: estado?.position ?? 99,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointment-statuses", clinicId] });
      toast.success(estado ? "Estado actualizado" : "Estado creado");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && estado) {
          setLabel(estado.label);
          setCanonical(estado.canonical as Canonico);
          setColor(estado.color);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        {estado ? (
          <Button variant="ghost" size="sm">
            <Pencil className="size-3.5" /> Editar
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="size-4" /> Nuevo estado
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{estado ? "Editar estado" : "Nuevo estado"}</DialogTitle>
          <DialogDescription>
            La etiqueta es lo que ve tu equipo en la agenda. El estado del sistema es lo que usan
            los filtros, los reportes y los recordatorios.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="e-label">Etiqueta</Label>
            <input
              id="e-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej: Confirmada por WhatsApp"
              className={INPUT}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="e-canon">Equivale al estado del sistema</Label>
            <select
              id="e-canon"
              value={canonical}
              onChange={(e) => setCanonical(e.target.value as Canonico)}
              className={INPUT}
            >
              {CANONICOS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label} — {c.ayuda}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="e-color">Color en la agenda</Label>
            <div className="flex items-center gap-3">
              <input
                id="e-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="size-10 cursor-pointer rounded border border-hairline bg-transparent"
              />
              <span
                className="inline-flex items-center gap-2 rounded px-2 py-1 text-xs font-medium"
                style={{ backgroundColor: `${color}22`, color }}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
                {label.trim() || "Vista previa"}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => guardar.mutate()} disabled={!label.trim() || guardar.isPending}>
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {estado ? "Guardar cambios" : "Crear estado"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EstadosDeCitaPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const queryClient = useQueryClient();

  const fetchStatuses = useServerFn(listAppointmentStatuses);
  const setActiveFn = useServerFn(setAppointmentStatusActive);

  const {
    data: estados = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["appointment-statuses", clinicId, "todos"],
    enabled: Boolean(clinicId),
    queryFn: () => fetchStatuses({ data: { clinicId: clinicId!, incluirInactivos: true } }),
  });

  const setActive = useMutation({
    mutationFn: (v: { statusId: string; isActive: boolean }) =>
      setActiveFn({ data: { clinicId: clinicId!, ...v } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointment-statuses", clinicId] });
      toast.success("Estado actualizado");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <AppShell title="Estados de cita" access={access}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Puedes tener «Confirmada por WhatsApp» y «Confirmada por email» como dos estados
            distintos en la agenda: para el sistema los dos son «confirmada», así que los filtros y
            los recordatorios siguen funcionando igual.
          </p>
          <EstadoDialog clinicId={clinicId!} />
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Cargando estados…</p>}

        {isError && (
          <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar los estados de cita." />
        )}

        {!isLoading && !isError && (
          <section className="card-clinical overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Etiqueta</th>
                    <th className="px-3 py-2 text-left font-medium">Estado del sistema</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {estados.map((e) => (
                    <tr
                      key={e.id}
                      className={cn(
                        "border-b border-hairline last:border-0",
                        !e.isActive && "opacity-50",
                      )}
                    >
                      <td className="px-4 py-2">
                        <span
                          className="inline-flex items-center gap-2 rounded px-2 py-1 text-xs font-medium"
                          style={{ backgroundColor: `${e.color}22`, color: e.color }}
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: e.color }}
                            aria-hidden
                          />
                          {e.label}
                        </span>
                        {!e.isActive && (
                          <span className="ml-2 text-[11px] text-muted-foreground">
                            Deshabilitado
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {CANONICOS.find((c) => c.value === e.canonical)?.label ?? e.canonical}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <EstadoDialog clinicId={clinicId!} estado={e} />
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={setActive.isPending}
                            onClick={() =>
                              setActive.mutate({ statusId: e.id, isActive: !e.isActive })
                            }
                          >
                            {e.isActive ? "Deshabilitar" : "Habilitar"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="text-xs text-muted-foreground">
          Deshabilitar un estado lo saca del selector de la agenda, pero las citas que ya lo tienen
          lo conservan.
        </p>
      </div>
    </AppShell>
  );
}
