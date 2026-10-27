import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ChipFiltro } from "@/components/a-plus/lista";
import { Chip } from "@/components/seguimiento/piezas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { ETIQUETA_ESTADO_CONTROL, MESES_DE_CONTROL, sumarMeses } from "@/lib/seguimiento/controles";
import {
  listControlesDelPaciente,
  programarControl,
} from "@/lib/seguimiento/seguimiento.functions";

/**
 * FIC-13 · Programar un control desde la ficha: "volver en N meses por X".
 * Queda en los controles pendientes de Seguimiento (REC-08) y, si se pide,
 * como tarea para el día que vence.
 */
export function ProgramarControlDialog({
  clinicId,
  patientId,
  patientName,
  hoy,
  zona,
  userId,
  abierto,
  onAbiertoChange,
}: {
  clinicId: string;
  patientId: string;
  patientName: string;
  hoy: string;
  zona: string;
  userId: string;
  abierto: boolean;
  onAbiertoChange: (v: boolean) => void;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const [meses, setMeses] = useState<number | null>(6);
  const [fechaExacta, setFechaExacta] = useState("");
  const [crearTarea, setCrearTarea] = useState(true);

  useEffect(() => {
    if (!abierto) return;
    setMotivo("");
    setMeses(6);
    setFechaExacta("");
    setCrearTarea(true);
  }, [abierto]);

  const listar = useServerFn(listControlesDelPaciente);
  const previos = useQuery({
    queryKey: ["controles-del-paciente", clinicId, patientId],
    queryFn: () => listar({ data: { clinicId, patientId } }),
    enabled: abierto,
  });

  const programar = useServerFn(programarControl);
  const mutacion = useMutation({
    mutationFn: () =>
      programar({
        data: {
          clinicId,
          patientId,
          motivo,
          meses: fechaExacta ? null : meses,
          fecha: fechaExacta || null,
          crearTarea,
          asignarA: crearTarea ? userId : null,
        },
      }),
    onSuccess: (r) => {
      toast.success(`Control programado para el ${fecha(r.dueOn, zona)}.`);
      queryClient.invalidateQueries({ queryKey: ["controles-del-paciente", clinicId, patientId] });
      queryClient.invalidateQueries({ queryKey: ["seguimiento-controles", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["seguimiento-tareas", clinicId] });
      onAbiertoChange(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const vence = fechaExacta || (meses ? sumarMeses(hoy, meses) : "");
  const valido = motivo.trim().length >= 2 && Boolean(vence) && vence >= hoy;
  const pendientes = (previos.data ?? []).filter((c) => c.status === "pendiente");

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Programar control</DialogTitle>
          <DialogDescription>
            Para que {patientName} vuelva a tiempo. Aparece en Seguimiento cuando se acerca la
            fecha.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valido) mutacion.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-motivo`}>Motivo</Label>
            <Input
              id={`${fid}-motivo`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={200}
              placeholder="Ej.: control de la endodoncia de la pieza 36"
              autoFocus
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Volver en</legend>
            <div className="flex flex-wrap gap-1.5">
              {MESES_DE_CONTROL.map((m) => (
                <ChipFiltro
                  key={m}
                  activo={!fechaExacta && meses === m}
                  onClick={() => {
                    setMeses(m);
                    setFechaExacta("");
                  }}
                >
                  {m === 1 ? "1 mes" : m === 12 ? "1 año" : `${m} meses`}
                </ChipFiltro>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-fecha`} className="text-sm font-normal text-muted-foreground">
                o una fecha exacta
              </Label>
              <input
                id={`${fid}-fecha`}
                type="date"
                min={hoy}
                value={fechaExacta}
                onChange={(e) => setFechaExacta(e.target.value)}
                className="h-10 w-full rounded-lg border border-control bg-card px-3 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
              />
            </div>
            {vence && (
              <p className="text-sm">
                Vence el <b className="font-semibold">{fecha(vence, zona)}</b>.
              </p>
            )}
          </fieldset>
          <label className="flex items-start gap-2 text-[15px]">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={crearTarea}
              onChange={(e) => setCrearTarea(e.target.checked)}
            />
            <span>Crear también una tarea para agendarlo ese día (asignada a ti)</span>
          </label>

          {pendientes.length > 0 && (
            <div className="rounded-lg border border-hairline px-3 py-2">
              <p className="mb-1 text-sm font-medium">Controles ya programados</p>
              <ul className="space-y-1 text-sm">
                {pendientes.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <span className="cifra">{fecha(c.dueOn, zona)}</span>
                    <span className="text-muted-foreground">{c.reason}</span>
                    <Chip tono="tenue">{ETIQUETA_ESTADO_CONTROL[c.status]}</Chip>
                  </li>
                ))}
              </ul>
              <Link
                to="/seguimiento"
                search={{ vista: "controles" }}
                className="mt-1 inline-block text-sm font-semibold text-brand-700 underline-offset-4 hover:underline"
              >
                Ver en Seguimiento
              </Link>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onAbiertoChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!valido || mutacion.isPending}>
              {mutacion.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Programar control
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
