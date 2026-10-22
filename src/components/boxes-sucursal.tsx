import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  addOperatory,
  reorderOperatories,
  updateOperatory,
  type BoxDeSucursal,
} from "@/lib/clinic-operations/branches.functions";
import { moverEnLista, nombreDeBoxValido, nombreRepetido } from "@/lib/clinic-operations/boxes";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

const CAMPO =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";

/**
 * Administración de los boxes de una sucursal (ADM-06): crear, renombrar,
 * desactivar, reactivar y ordenar. El orden es el de la agenda por box y el
 * del selector de la cita. Cada acción se guarda al momento. Los permisos
 * los decide la RLS de `operatories` (owner y admin); la pantalla ya pide
 * `settings:manage`.
 */
export function BoxesSucursalDialog({
  clinicId,
  branchId,
  branchName,
  boxes,
}: {
  clinicId: string;
  branchId: string;
  branchName: string;
  boxes: BoxDeSucursal[];
}) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null);

  const queryClient = useQueryClient();
  const addFn = useServerFn(addOperatory);
  const updateFn = useServerFn(updateOperatory);
  const reorderFn = useServerFn(reorderOperatories);

  const activos = boxes.filter((b) => b.isActive);
  const inactivos = boxes.filter((b) => !b.isActive);

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: ["branches-detailed", clinicId] });
    void queryClient.invalidateQueries({ queryKey: ["operatories", clinicId] });
    void queryClient.invalidateQueries({ queryKey: ["professionals", clinicId] });
  };

  const agregar = useMutation({
    mutationFn: (name: string) => addFn({ data: { clinicId, branchId, name } }),
    onSuccess: () => {
      invalidar();
      setNuevo("");
      toast.success("Box agregado.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const actualizar = useMutation({
    mutationFn: (cambio: { operatoryId: string; name?: string; isActive?: boolean }) =>
      updateFn({ data: { clinicId, ...cambio } }),
    onSuccess: (_r, cambio) => {
      invalidar();
      setEditando(null);
      toast.success(
        cambio.isActive === false
          ? "Box desactivado. Las citas que ya lo tienen lo conservan."
          : cambio.isActive === true
            ? "Box reactivado."
            : "Box renombrado.",
      );
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const ordenar = useMutation({
    mutationFn: (orden: string[]) => reorderFn({ data: { clinicId, branchId, orden } }),
    onSuccess: invalidar,
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const nombreNuevo = nombreDeBoxValido(nuevo);
  const motivoNuevo = !nuevo.trim()
    ? null
    : !nombreNuevo
      ? "Usa hasta 60 caracteres."
      : nombreRepetido(nombreNuevo, boxes)
        ? "Ya hay un box con ese nombre en esta sucursal."
        : null;

  const nombreEditado = editando ? nombreDeBoxValido(editando.nombre) : null;
  const motivoEditado = !editando
    ? null
    : !nombreEditado
      ? "Escribe un nombre de hasta 60 caracteres."
      : nombreRepetido(nombreEditado, boxes, editando.id)
        ? "Ya hay un box con ese nombre en esta sucursal."
        : null;

  function mover(indice: number, direccion: -1 | 1) {
    // El orden guardado incluye a los desactivados al final: así, al
    // reactivarlos, vuelven después de los activos.
    const ids = moverEnLista(
      activos.map((b) => b.id),
      indice,
      direccion,
    );
    ordenar.mutate([...ids, ...inactivos.map((b) => b.id)]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setNuevo("");
          setEditando(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Boxes ({activos.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Boxes de {branchName}</DialogTitle>
          <DialogDescription>
            El orden es el de la agenda por box y el del formulario de cita. Los cambios se guardan
            al momento.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <ol aria-label="Boxes activos" className="divide-y divide-hairline rounded-lg border">
            {activos.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                Sin boxes activos. Agrega uno abajo.
              </li>
            )}
            {activos.map((b, i) => {
              const enEdicion = editando?.id === b.id;
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="w-6 cifra text-xs text-muted-foreground">{i + 1}.</span>
                  {enEdicion ? (
                    <form
                      className="flex min-w-0 flex-1 flex-wrap items-start gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!motivoEditado && nombreEditado) {
                          actualizar.mutate({ operatoryId: b.id, name: nombreEditado });
                        }
                      }}
                    >
                      <Label htmlFor={`${fid}-${b.id}`} className="sr-only">
                        Nuevo nombre de {b.name}
                      </Label>
                      <input
                        id={`${fid}-${b.id}`}
                        autoFocus
                        value={editando.nombre}
                        onChange={(e) => setEditando({ id: b.id, nombre: e.target.value })}
                        onKeyDown={(e) =>
                          e.key === "Escape" && (e.stopPropagation(), setEditando(null))
                        }
                        maxLength={80}
                        className={cn(CAMPO, "min-w-0 flex-1 py-1.5")}
                      />
                      <AccionDeshabilitada motivo={motivoEditado}>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={actualizar.isPending}
                          aria-label={`Guardar el nombre de ${b.name}`}
                        >
                          <Check aria-hidden /> Guardar
                        </Button>
                      </AccionDeshabilitada>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditando(null)}
                        aria-label="Cancelar el cambio de nombre"
                      >
                        <X aria-hidden />
                      </Button>
                    </form>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.name}</span>
                      <div className="flex items-center gap-1">
                        <BloqueoEscritura>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-8 pointer-coarse:size-11"
                            disabled={i === 0 || ordenar.isPending}
                            onClick={() => mover(i, -1)}
                            aria-label={`Subir ${b.name}`}
                          >
                            <ArrowUp aria-hidden />
                          </Button>
                        </BloqueoEscritura>
                        <BloqueoEscritura>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-8 pointer-coarse:size-11"
                            disabled={i === activos.length - 1 || ordenar.isPending}
                            onClick={() => mover(i, 1)}
                            aria-label={`Bajar ${b.name}`}
                          >
                            <ArrowDown aria-hidden />
                          </Button>
                        </BloqueoEscritura>
                        <BloqueoEscritura>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditando({ id: b.id, nombre: b.name })}
                            aria-label={`Renombrar ${b.name}`}
                          >
                            <Pencil aria-hidden /> Renombrar
                          </Button>
                        </BloqueoEscritura>
                        <BloqueoEscritura>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={actualizar.isPending}
                            onClick={() =>
                              actualizar.mutate({ operatoryId: b.id, isActive: false })
                            }
                            aria-label={`Desactivar ${b.name}`}
                          >
                            Desactivar
                          </Button>
                        </BloqueoEscritura>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ol>

          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (nombreNuevo && !motivoNuevo) agregar.mutate(nombreNuevo);
            }}
          >
            <Label htmlFor={`${fid}-nuevo`}>Box nuevo</Label>
            <div className="flex items-start gap-2">
              <input
                id={`${fid}-nuevo`}
                value={nuevo}
                onChange={(e) => setNuevo(e.target.value)}
                maxLength={80}
                placeholder="Ej: Box 3"
                className={CAMPO}
              />
              <BloqueoEscritura
                otroMotivo={!nuevo.trim() ? "Escribe el nombre del box." : motivoNuevo}
              >
                <Button type="submit" variant="outline" disabled={agregar.isPending}>
                  {agregar.isPending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Plus aria-hidden />
                  )}
                  Agregar
                </Button>
              </BloqueoEscritura>
            </div>
          </form>

          {inactivos.length > 0 && (
            <section aria-labelledby={`${fid}-inactivos`} className="space-y-1.5">
              <h3 id={`${fid}-inactivos`} className="text-sm font-medium text-muted-foreground">
                Desactivados
              </h3>
              <ul className="divide-y divide-hairline rounded-lg border">
                {inactivos.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="truncate text-sm text-muted-foreground">{b.name}</span>
                    <BloqueoEscritura>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={actualizar.isPending}
                        onClick={() => actualizar.mutate({ operatoryId: b.id, isActive: true })}
                        aria-label={`Reactivar ${b.name}`}
                      >
                        Reactivar
                      </Button>
                    </BloqueoEscritura>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Un box desactivado no se ofrece al agendar ni aparece en la agenda por box. Las
                citas que ya lo tienen lo conservan.
              </p>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
