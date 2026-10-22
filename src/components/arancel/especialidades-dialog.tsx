import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { actualizarEspecialidad, crearEspecialidad } from "@/lib/arancel/arancel.functions";
import type { Especialidad } from "@/lib/arancel/especialidades";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Una fila editable. Guarda al salir del campo o al cambiar el interruptor. */
function FilaEspecialidad({
  clinicId,
  especialidad,
  cantidad,
}: {
  clinicId: string;
  especialidad: Especialidad;
  cantidad: number;
}) {
  const [nombre, setNombre] = useState(especialidad.name);
  const [duracion, setDuracion] = useState<number | null>(especialidad.defaultDurationMin);
  const queryClient = useQueryClient();
  const actualizarFn = useServerFn(actualizarEspecialidad);

  const guardar = useMutation({
    mutationFn: (cambios: Partial<{ name: string; isActive: boolean; duracion: number }>) =>
      actualizarFn({
        data: {
          clinicId,
          specialtyId: especialidad.id,
          name: cambios.name ?? nombre.trim(),
          isActive: cambios.isActive ?? especialidad.isActive,
          defaultDurationMin: cambios.duracion ?? duracion ?? especialidad.defaultDurationMin,
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["especialidades", clinicId] }),
    onError: (e: Error) => {
      toast.error(mensajeDeError(e));
      setNombre(especialidad.name);
      setDuracion(especialidad.defaultDurationMin);
    },
  });

  const idNombre = `esp-nombre-${especialidad.id}`;
  const idDuracion = `esp-dur-${especialidad.id}`;

  return (
    <li
      className={cn(
        "grid grid-cols-[1fr_auto] items-end gap-2 rounded-lg border border-hairline p-2.5 sm:grid-cols-[1fr_6rem_auto]",
        !especialidad.isActive && "opacity-60",
      )}
    >
      <div className="space-y-1">
        <Label htmlFor={idNombre} className="text-xs text-muted-foreground">
          Nombre{" "}
          <span className="font-normal">
            · {cantidad} {cantidad === 1 ? "prestación" : "prestaciones"}
          </span>
        </Label>
        <input
          id={idNombre}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onBlur={() => {
            const n = nombre.trim();
            if (n.length >= 2 && n !== especialidad.name) guardar.mutate({ name: n });
            else setNombre(especialidad.name);
          }}
          className={INPUT}
        />
      </div>
      <div className="hidden space-y-1 sm:block">
        <Label htmlFor={idDuracion} className="text-xs text-muted-foreground">
          Duración (min)
        </Label>
        <input
          id={idDuracion}
          type="number"
          min={5}
          max={600}
          value={duracion ?? ""}
          onChange={(e) => setDuracion(e.target.value === "" ? null : Number(e.target.value))}
          onBlur={() => {
            if (duracion && duracion >= 5 && duracion !== especialidad.defaultDurationMin)
              guardar.mutate({ duracion });
            else setDuracion(especialidad.defaultDurationMin);
          }}
          className={INPUT}
        />
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={guardar.isPending}
        onClick={() => guardar.mutate({ isActive: !especialidad.isActive })}
      >
        {especialidad.isActive ? "Desactivar" : "Activar"}
      </Button>
    </li>
  );
}

/**
 * Lista editable de especialidades de la clínica (ADM-02). Las doce estándar
 * las siembra Esmalia; la clínica las renombra, desactiva o agrega otras.
 * Desactivar no saca a las prestaciones de su grupo: solo deja de ofrecerla
 * al crear o editar una prestación.
 */
export function EspecialidadesDialog({
  clinicId,
  especialidades,
  conteo,
  open,
  onOpenChange,
}: {
  clinicId: string;
  especialidades: Especialidad[];
  /** Prestaciones por especialidad, para que se vea qué se está tocando. */
  conteo: Map<string, number>;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [nueva, setNueva] = useState("");
  const queryClient = useQueryClient();
  const crearFn = useServerFn(crearEspecialidad);
  const crear = useMutation({
    mutationFn: () => crearFn({ data: { clinicId, name: nueva.trim() } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["especialidades", clinicId] });
      toast.success("Especialidad agregada");
      setNueva("");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const ordenadas = [...especialidades].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name, "es"),
  );
  const motivoAgregar = nueva.trim().length < 2 ? "Escribe un nombre de al menos 2 letras." : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Especialidades</DialogTitle>
          <DialogDescription>
            Cada prestación del arancel pertenece a una especialidad, y el arancel se agrupa por
            ellas. Los cambios se guardan al salir de cada campo.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {ordenadas.map((e) => (
            <FilaEspecialidad
              key={`${e.id}-${e.name}-${e.defaultDurationMin}`}
              clinicId={clinicId}
              especialidad={e}
              cantidad={conteo.get(e.id) ?? 0}
            />
          ))}
        </ul>

        <form
          className="flex items-end gap-2 border-t border-hairline pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!motivoAgregar) crear.mutate();
          }}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="esp-nueva">Nueva especialidad</Label>
            <input
              id="esp-nueva"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              placeholder="Ej: Trastornos temporomandibulares"
              className={INPUT}
            />
          </div>
          <AccionDeshabilitada motivo={nueva ? motivoAgregar : null} como="globo">
            <Button type="submit" size="sm" disabled={!nueva.trim() || crear.isPending}>
              {crear.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Agregar
            </Button>
          </AccionDeshabilitada>
        </form>
      </DialogContent>
    </Dialog>
  );
}
