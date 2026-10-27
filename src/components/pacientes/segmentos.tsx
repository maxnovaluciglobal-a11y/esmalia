import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Layers, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buttonVariants } from "@/components/ui/button";
import {
  deletePatientSegment,
  listPatientSegments,
  savePatientSegment,
  type Segmento,
} from "@/lib/patients/segmentos.functions";
import {
  contarQuienesPasan,
  describirFiltros,
  hayFiltros,
  usaFinanzas,
  type ContextoDeFiltro,
  type FilaFiltrable,
  type FiltrosDePacientes,
} from "@/lib/patients/filtros-pacientes";
import { numero } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Segmentos guardados (PAC-06): una combinación de filtros con nombre. Se
 * aplican a la lista con un toque y los reutilizan las campañas (frente B,
 * `resolverSegmento`). La cifra de cada uno se calcula acá, con las fichas
 * ya cargadas y la misma regla que la lista (`pasaFiltros`).
 */

type Nombres = Parameters<typeof describirFiltros>[1];

export function MenuSegmentos({
  clinicId,
  userId,
  filtrosActuales,
  filas,
  ctx,
  nombres,
  veFinanzas,
  puedeGuardar,
  puedeBorrarTodos,
  abierto,
  onAbiertoChange,
  onAplicar,
}: {
  clinicId: string;
  userId: string;
  filtrosActuales: FiltrosDePacientes;
  filas: readonly FilaFiltrable[];
  ctx: ContextoDeFiltro;
  nombres: Nombres;
  veFinanzas: boolean;
  /** `patients:manage`: crear segmentos. */
  puedeGuardar: boolean;
  /** owner/admin: borrar cualquiera (los demás, solo los suyos). */
  puedeBorrarTodos: boolean;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  onAplicar: (segmento: Segmento) => void;
}) {
  const queryClient = useQueryClient();
  const listar = useServerFn(listPatientSegments);
  const guardarFn = useServerFn(savePatientSegment);
  const borrarFn = useServerFn(deletePatientSegment);
  const { data: segmentos = [], isLoading } = useQuery({
    queryKey: ["patient-segments", clinicId],
    queryFn: () => listar({ data: { clinicId } }),
    staleTime: 60_000,
  });
  const [guardando, setGuardando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [confirmarBorrar, setConfirmarBorrar] = useState<string | null>(null);
  const idNombre = useId();

  const hay = hayFiltros(filtrosActuales);
  const descripcionActual = describirFiltros(filtrosActuales, nombres);

  const guardar = useMutation({
    mutationFn: () =>
      guardarFn({
        data: {
          clinicId,
          nombre,
          descripcion: descripcionActual.join(" · ").slice(0, 200),
          filtros: filtrosActuales,
        },
      }),
    onSuccess: async () => {
      setGuardando(false);
      setNombre("");
      toast.success("Segmento guardado");
      await queryClient.invalidateQueries({ queryKey: ["patient-segments", clinicId] });
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  const borrar = useMutation({
    mutationFn: (segmentId: string) => borrarFn({ data: { clinicId, segmentId } }),
    onSuccess: async () => {
      setConfirmarBorrar(null);
      toast.success("Segmento borrado");
      await queryClient.invalidateQueries({ queryKey: ["patient-segments", clinicId] });
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  return (
    <Popover open={abierto} onOpenChange={onAbiertoChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-control bg-card px-3.5 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
        >
          <Layers className="size-3.5" aria-hidden />
          Segmentos
          {segmentos.length > 0 && (
            <span className="cifra text-[12px] text-muted-foreground">{segmentos.length}</span>
          )}
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="border-b border-hairline px-4 py-3">
          <p className="text-sm font-semibold">Segmentos guardados</p>
          <p className="text-xs text-muted-foreground">
            Filtros con nombre. Los usan también las campañas.
          </p>
        </div>
        <div className="max-h-[50dvh] overflow-y-auto">
          {isLoading && <p className="px-4 py-3 text-sm text-muted-foreground">Cargando…</p>}
          {!isLoading && segmentos.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Todavía no hay segmentos. Elige filtros en la lista y guárdalos acá.
            </p>
          )}
          <ul className="divide-y divide-hairline">
            {segmentos.map((s) => {
              const bloqueado = usaFinanzas(s.filtros) && !veFinanzas;
              const cifra = bloqueado ? null : contarQuienesPasan(filas, s.filtros, ctx);
              const puedeBorrar = puedeBorrarTodos || (puedeGuardar && s.creadoPor === userId);
              const resumen = describirFiltros(s.filtros, nombres).join(" · ");
              return (
                <li key={s.id} className="flex items-stretch">
                  <button
                    type="button"
                    disabled={bloqueado}
                    onClick={() => {
                      onAplicar(s);
                      onAbiertoChange(false);
                    }}
                    className="min-w-0 flex-1 px-4 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-medium">{s.nombre}</span>
                      {cifra != null ? (
                        <span className="cifra shrink-0 text-sm">{numero(cifra)}</span>
                      ) : (
                        <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {bloqueado ? "Filtra por saldo: necesitas permiso de finanzas" : resumen}
                    </span>
                  </button>
                  {puedeBorrar &&
                    (confirmarBorrar === s.id ? (
                      <button
                        type="button"
                        onClick={() => borrar.mutate(s.id)}
                        disabled={borrar.isPending}
                        className="shrink-0 px-3 text-xs font-semibold text-destructive outline-none hover:bg-destructive-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      >
                        {borrar.isPending ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          "¿Borrar?"
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmarBorrar(s.id)}
                        aria-label={`Borrar el segmento ${s.nombre}`}
                        title="Borrar"
                        className="shrink-0 px-3 text-muted-foreground outline-none hover:text-destructive focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring pointer-coarse:px-4"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    ))}
                </li>
              );
            })}
          </ul>
        </div>
        {puedeGuardar && (
          <div className="border-t border-hairline p-3">
            {guardando ? (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  guardar.mutate();
                }}
              >
                <label htmlFor={idNombre} className="text-sm font-medium">
                  Nombre del segmento
                </label>
                <input
                  id={idNombre}
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  maxLength={60}
                  autoFocus
                  placeholder="Ej.: Fonasa sin control"
                  className="block h-10 w-full rounded-lg border border-control bg-card px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                <p className="text-xs text-muted-foreground">
                  {descripcionActual.join(" · ")} ·{" "}
                  <span className="cifra">
                    {numero(contarQuienesPasan(filas, filtrosActuales, ctx))}
                  </span>{" "}
                  hoy
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setGuardando(false)}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={guardar.isPending || nombre.trim().length < 2}
                    className={buttonVariants({ size: "sm" })}
                  >
                    {guardar.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                    Guardar segmento
                  </button>
                </div>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!hay}
                  onClick={() => setGuardando(true)}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
                >
                  <Plus aria-hidden /> Guardar los filtros actuales
                </button>
                {!hay && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Elige al menos un filtro en la lista para guardarlo como segmento.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
