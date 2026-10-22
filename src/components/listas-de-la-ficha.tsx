import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import { useOpcionesDeFicha } from "@/hooks/use-opciones-ficha";
import {
  agregarOpcionDeFicha,
  cambiarOpcionDeFicha,
  type TipoOpcion,
} from "@/lib/patients/datos-ficha.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

const TITULOS: Record<TipoOpcion, { titulo: string; detalle: string }> = {
  acquisition_source: {
    titulo: "Origen del paciente",
    detalle: "La misma lista en el alta, la ficha y los informes.",
  },
  isapre: {
    titulo: "Isapres",
    detalle: "Las que aparecen al elegir la previsión Isapre.",
  },
};

/**
 * Listas editables de la ficha (Ola 1: FIC-02 isapres y FIC-04 origen).
 * Desactivar una opción la saca de los formularios; las fichas que ya la
 * tienen la conservan (guardan el texto). Solo dueño y administrador
 * (la página ya exige `settings:manage` y el servidor lo vuelve a revisar).
 */
export function ListasDeLaFicha({ clinicId }: { clinicId: string }) {
  return (
    <section aria-labelledby="listas-ficha" className="space-y-4">
      <div>
        <h2 id="listas-ficha" className="font-display text-2xl font-semibold">
          Listas de la ficha
        </h2>
        <p className="text-sm text-muted-foreground">
          Opciones que el equipo elige al crear o editar un paciente.
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <Lista clinicId={clinicId} tipo="acquisition_source" />
        <Lista clinicId={clinicId} tipo="isapre" />
      </div>
    </section>
  );
}

function Lista({ clinicId, tipo }: { clinicId: string; tipo: TipoOpcion }) {
  const fid = useId();
  const queryClient = useQueryClient();
  const opciones = useOpcionesDeFicha(clinicId);
  const agregarFn = useServerFn(agregarOpcionDeFicha);
  const cambiarFn = useServerFn(cambiarOpcionDeFicha);
  const [nueva, setNueva] = useState("");
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ["opciones-ficha", clinicId] });

  const agregar = useMutation({
    mutationFn: () => agregarFn({ data: { clinicId, tipo, texto: nueva.trim() } }),
    onSuccess: async () => {
      setNueva("");
      await refrescar();
      toast.success("Opción agregada");
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });
  const cambiar = useMutation({
    mutationFn: (v: { id: string; activa: boolean }) =>
      cambiarFn({ data: { clinicId, id: v.id, activa: v.activa } }),
    onSuccess: () => refrescar(),
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  const items = opciones.todas.filter((o) => o.tipo === tipo);
  const { titulo, detalle } = TITULOS[tipo];

  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="font-medium">{titulo}</h3>
      <p className="text-xs text-muted-foreground">{detalle}</p>
      {opciones.isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-hairline">
          {items.map((o) => (
            <li key={o.id} className="flex min-h-11 items-center justify-between gap-3 text-sm">
              <span className={o.activa ? "" : "text-muted-foreground line-through"}>
                {o.texto}
              </span>
              <BloqueoEscritura>
                <button
                  type="button"
                  onClick={() => cambiar.mutate({ id: o.id, activa: !o.activa })}
                  disabled={cambiar.isPending}
                  className="min-h-9 rounded px-2 text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                >
                  {o.activa ? "Desactivar" : "Activar"}
                </button>
              </BloqueoEscritura>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (nueva.trim()) agregar.mutate();
        }}
      >
        <label htmlFor={`${fid}-nueva`} className="sr-only">
          Nueva opción para {titulo.toLowerCase()}
        </label>
        <input
          id={`${fid}-nueva`}
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          maxLength={80}
          placeholder="Agregar opción"
          className="min-w-0 flex-1 rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
        />
        <BloqueoEscritura>
          <Button type="submit" variant="outline" disabled={agregar.isPending || !nueva.trim()}>
            {agregar.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Plus aria-hidden />
            )}
            Agregar
          </Button>
        </BloqueoEscritura>
      </form>
    </div>
  );
}
