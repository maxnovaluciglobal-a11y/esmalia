import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import {
  countPatientLabelUses,
  createPatientLabel,
  deletePatientLabel,
  listPatientLabels,
  setPatientsLabels,
  updatePatientLabel,
} from "@/lib/patients/etiquetas.functions";
import {
  CLASES_COLOR_ETIQUETA,
  CLASES_PUNTO_ETIQUETA,
  COLORES_ETIQUETA,
  errorDeNombreEtiqueta,
  estadoDeEtiquetas,
  LARGO_MAXIMO_ETIQUETA,
  NOMBRE_COLOR_ETIQUETA,
  type ColorEtiqueta,
  type Etiqueta,
} from "@/lib/patients/etiquetas";
import { numero } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Etiquetas de pacientes (PAC-07): pastilla, diálogo para etiquetar una o
 * varias fichas y gestión del catálogo. El color sale de una paleta cerrada
 * traducida a tokens (`CLASES_COLOR_ETIQUETA`). Los permisos reales los pone
 * la RLS; acá solo se esconde lo que el rol no puede hacer.
 */

export const CLAVE_ETIQUETAS = (clinicId: string | undefined) => ["patient-labels", clinicId];

/** Catálogo de etiquetas de la clínica (compartido por la lista y la ficha). */
export function useEtiquetas(clinicId: string | undefined) {
  const listar = useServerFn(listPatientLabels);
  return useQuery({
    queryKey: CLAVE_ETIQUETAS(clinicId),
    enabled: Boolean(clinicId),
    queryFn: () => listar({ data: { clinicId: clinicId! } }),
    staleTime: 60_000,
  });
}

export function EtiquetaPastilla({
  etiqueta,
  className,
}: {
  etiqueta: Pick<Etiqueta, "nombre" | "color">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] max-w-[12rem] items-center truncate rounded-full border px-2 text-[11.5px] font-semibold leading-none",
        CLASES_COLOR_ETIQUETA[etiqueta.color],
        className,
      )}
    >
      <span className="truncate">{etiqueta.nombre}</span>
    </span>
  );
}

/** Pastillas de las etiquetas de una ficha (en el orden del catálogo). */
export function EtiquetasDeFila({
  ids,
  catalogo,
  max = 3,
}: {
  ids: readonly string[] | undefined;
  catalogo: readonly Etiqueta[];
  max?: number;
}) {
  if (!ids || ids.length === 0) return null;
  const propias = catalogo.filter((e) => ids.includes(e.id));
  if (propias.length === 0) return null;
  const visibles = propias.slice(0, max);
  const resto = propias.length - visibles.length;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      <span className="sr-only">Etiquetas: </span>
      {visibles.map((e) => (
        <EtiquetaPastilla key={e.id} etiqueta={e} />
      ))}
      {resto > 0 && (
        <span
          className="text-[11.5px] font-semibold text-muted-foreground"
          title={propias
            .slice(max)
            .map((e) => e.nombre)
            .join(", ")}
        >
          +{resto}
        </span>
      )}
    </span>
  );
}

/** Selector de color en pastillas (radio). */
function SelectorColor({
  valor,
  onChange,
  etiqueta,
}: {
  valor: ColorEtiqueta;
  onChange: (c: ColorEtiqueta) => void;
  etiqueta: string;
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="flex flex-wrap gap-1.5">
      {COLORES_ETIQUETA.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={valor === c}
          aria-label={NOMBRE_COLOR_ETIQUETA[c]}
          title={NOMBRE_COLOR_ETIQUETA[c]}
          onClick={() => onChange(c)}
          className={cn(
            "grid size-8 place-items-center rounded-full border outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:size-11",
            valor === c ? "border-foreground" : "border-transparent hover:border-control",
          )}
        >
          <span
            aria-hidden
            className={cn("grid size-5 place-items-center rounded-full", CLASES_PUNTO_ETIQUETA[c])}
          >
            {valor === c && <Check className="size-3 text-background" strokeWidth={3} />}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Casilla con estado indeterminado (etiqueta en algunas de las fichas elegidas). */
function Casilla({
  estado,
  onChange,
  id,
}: {
  estado: "todas" | "algunas" | "ninguna";
  onChange: () => void;
  id: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = estado === "algunas";
  }, [estado]);
  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={estado === "todas"}
      onChange={onChange}
      className="size-4 shrink-0 accent-foreground pointer-coarse:size-5"
    />
  );
}

/** Formulario chico de etiqueta nueva (o renombrar). */
function FormularioEtiqueta({
  inicial,
  existentes,
  guardando,
  onGuardar,
  onCancelar,
  textoGuardar,
}: {
  inicial?: { nombre: string; color: ColorEtiqueta };
  existentes: readonly string[];
  guardando: boolean;
  onGuardar: (v: { nombre: string; color: ColorEtiqueta }) => void;
  onCancelar?: () => void;
  textoGuardar: string;
}) {
  const id = useId();
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [color, setColor] = useState<ColorEtiqueta>(inicial?.color ?? "ocre");
  const [intento, setIntento] = useState(false);
  const error = errorDeNombreEtiqueta(nombre, existentes);
  return (
    <form
      className="space-y-2.5 rounded-lg border border-hairline p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setIntento(true);
        if (!error) onGuardar({ nombre, color });
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        Nombre de la etiqueta
      </label>
      <input
        id={id}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        maxLength={LARGO_MAXIMO_ETIQUETA + 10}
        autoFocus
        aria-invalid={intento && Boolean(error)}
        aria-describedby={intento && error ? `${id}-error` : undefined}
        placeholder="Ej.: Prefiere la tarde"
        className="block h-10 w-full rounded-lg border border-control bg-card px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      {intento && error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
      <SelectorColor valor={color} onChange={setColor} etiqueta="Color de la etiqueta" />
      <div className="flex items-center justify-between gap-2">
        <EtiquetaPastilla etiqueta={{ nombre: nombre.trim() || "Vista previa", color }} />
        <div className="flex gap-2">
          {onCancelar && (
            <button
              type="button"
              onClick={onCancelar}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Cancelar
            </button>
          )}
          <button type="submit" disabled={guardando} className={buttonVariants({ size: "sm" })}>
            {guardando && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {textoGuardar}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Etiquetar una o varias fichas. Cada etiqueta muestra si la tienen todas,
 * algunas (casilla indeterminada) o ninguna de las fichas elegidas; al
 * guardar se ponen y se sacan solo las que cambiaron.
 */
export function EtiquetarDialog({
  clinicId,
  pacientes,
  abierto,
  onAbiertoChange,
  puedeCrear,
}: {
  clinicId: string;
  /** Fichas a etiquetar, con las etiquetas que ya tienen. */
  pacientes: readonly { id: string; nombre?: string; etiquetaIds?: readonly string[] }[];
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  puedeCrear: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: catalogo = [], isLoading } = useEtiquetas(clinicId);
  const crearFn = useServerFn(createPatientLabel);
  const aplicarFn = useServerFn(setPatientsLabels);
  const [creando, setCreando] = useState(false);
  /** Cambios pedidos por etiqueta: true = poner a todas, false = sacar a todas. */
  const [cambios, setCambios] = useState<Record<string, boolean>>({});
  const baseId = useId();

  useEffect(() => {
    if (abierto) {
      setCambios({});
      setCreando(false);
    }
  }, [abierto]);

  const asignadas = useMemo(() => pacientes.map((p) => p.etiquetaIds ?? []), [pacientes]);
  const estadoBase = useMemo(
    () =>
      estadoDeEtiquetas(
        catalogo.map((e) => e.id),
        asignadas,
      ),
    [catalogo, asignadas],
  );
  const estado = (id: string) =>
    id in cambios ? (cambios[id] ? "todas" : "ninguna") : (estadoBase[id] ?? "ninguna");

  const crear = useMutation({
    mutationFn: (v: { nombre: string; color: ColorEtiqueta }) =>
      crearFn({ data: { clinicId, nombre: v.nombre, color: v.color } }),
    onSuccess: async (nueva) => {
      setCreando(false);
      setCambios((c) => ({ ...c, [nueva.id]: true }));
      await queryClient.invalidateQueries({ queryKey: CLAVE_ETIQUETAS(clinicId) });
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  const agregar = Object.entries(cambios)
    .filter(([id, poner]) => poner && estadoBase[id] !== "todas")
    .map(([id]) => id);
  const quitar = Object.entries(cambios)
    .filter(([id, poner]) => !poner && estadoBase[id] !== "ninguna")
    .map(([id]) => id);

  const aplicar = useMutation({
    mutationFn: () =>
      aplicarFn({
        data: { clinicId, patientIds: pacientes.map((p) => p.id), agregar, quitar },
      }),
    onSuccess: async () => {
      onAbiertoChange(false);
      toast.success(
        pacientes.length === 1
          ? "Etiquetas actualizadas"
          : `Etiquetas actualizadas en ${numero(pacientes.length)} fichas`,
      );
      await queryClient.invalidateQueries({ queryKey: ["patients", clinicId] });
      await queryClient.invalidateQueries({ queryKey: ["patient-labels-of", clinicId] });
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  const varias = pacientes.length > 1;
  const titulo = varias
    ? `Etiquetar ${numero(pacientes.length)} fichas`
    : `Etiquetas de ${pacientes[0]?.nombre ?? "la ficha"}`;

  return (
    <Dialog open={abierto} onOpenChange={(v) => !aplicar.isPending && onAbiertoChange(v)}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {varias
              ? "Marca para ponerla en todas; desmarca para sacarla de todas. La raya indica que solo algunas la tienen."
              : "Marca las etiquetas de esta ficha."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando etiquetas…</p>
        ) : catalogo.length === 0 && !creando ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay etiquetas en tu clínica.
            {puedeCrear ? " Crea la primera." : ""}
          </p>
        ) : (
          <ul className="divide-y divide-hairline rounded-lg border border-hairline">
            {catalogo.map((e) => {
              const id = `${baseId}-${e.id}`;
              return (
                <li key={e.id}>
                  <label
                    htmlFor={id}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/40 pointer-coarse:py-3"
                  >
                    <Casilla
                      id={id}
                      estado={estado(e.id)}
                      onChange={() =>
                        setCambios((c) => ({ ...c, [e.id]: estado(e.id) !== "todas" }))
                      }
                    />
                    <EtiquetaPastilla etiqueta={e} />
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {puedeCrear &&
          (creando ? (
            <FormularioEtiqueta
              existentes={catalogo.map((e) => e.nombre)}
              guardando={crear.isPending}
              onGuardar={(v) => crear.mutate(v)}
              onCancelar={() => setCreando(false)}
              textoGuardar="Crear y marcar"
            />
          ) : (
            <button
              type="button"
              onClick={() => setCreando(true)}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
            >
              <Plus aria-hidden /> Nueva etiqueta
            </button>
          ))}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onAbiertoChange(false)}
            className={buttonVariants({ variant: "outline" })}
            disabled={aplicar.isPending}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => aplicar.mutate()}
            disabled={aplicar.isPending || (agregar.length === 0 && quitar.length === 0)}
            className={buttonVariants()}
          >
            {aplicar.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {varias ? `Aplicar a ${numero(pacientes.length)} fichas` : "Guardar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Catálogo de etiquetas: crear, renombrar, cambiar el color y borrar
 * (borrar la saca de todas las fichas: solo owner/admin, con la cifra).
 */
export function GestionarEtiquetasDialog({
  clinicId,
  abierto,
  onAbiertoChange,
  puedeBorrar,
}: {
  clinicId: string;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  puedeBorrar: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: catalogo = [], isLoading } = useEtiquetas(clinicId);
  const contarFn = useServerFn(countPatientLabelUses);
  const { data: usos = {} } = useQuery({
    queryKey: ["patient-label-uses", clinicId],
    enabled: abierto,
    queryFn: () => contarFn({ data: { clinicId } }),
  });
  const crearFn = useServerFn(createPatientLabel);
  const editarFn = useServerFn(updatePatientLabel);
  const borrarFn = useServerFn(deletePatientLabel);
  const [editando, setEditando] = useState<string | "nueva" | null>(null);
  const [borrando, setBorrando] = useState<Etiqueta | null>(null);

  const refrescar = async () => {
    await queryClient.invalidateQueries({ queryKey: CLAVE_ETIQUETAS(clinicId) });
    await queryClient.invalidateQueries({ queryKey: ["patient-label-uses", clinicId] });
    await queryClient.invalidateQueries({ queryKey: ["patients", clinicId] });
  };

  const guardar = useMutation({
    mutationFn: async (v: { id?: string; nombre: string; color: ColorEtiqueta }) => {
      if (v.id)
        await editarFn({ data: { clinicId, labelId: v.id, nombre: v.nombre, color: v.color } });
      else await crearFn({ data: { clinicId, nombre: v.nombre, color: v.color } });
    },
    onSuccess: async () => {
      setEditando(null);
      await refrescar();
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  const borrar = useMutation({
    mutationFn: (id: string) => borrarFn({ data: { clinicId, labelId: id } }),
    onSuccess: async () => {
      setBorrando(null);
      toast.success("Etiqueta borrada");
      await refrescar();
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Etiquetas de pacientes</DialogTitle>
          <DialogDescription>
            Sirven para filtrar la lista y armar segmentos. Las ve todo el equipo.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Cargando etiquetas…</p>}
        {!isLoading && catalogo.length === 0 && editando !== "nueva" && (
          <p className="text-sm text-muted-foreground">Todavía no hay etiquetas.</p>
        )}

        {catalogo.length > 0 && (
          <ul className="divide-y divide-hairline rounded-lg border border-hairline">
            {catalogo.map((e) =>
              editando === e.id ? (
                <li key={e.id} className="p-2">
                  <FormularioEtiqueta
                    inicial={{ nombre: e.nombre, color: e.color }}
                    existentes={catalogo.filter((o) => o.id !== e.id).map((o) => o.nombre)}
                    guardando={guardar.isPending}
                    onGuardar={(v) => guardar.mutate({ id: e.id, ...v })}
                    onCancelar={() => setEditando(null)}
                    textoGuardar="Guardar"
                  />
                </li>
              ) : (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                  <EtiquetaPastilla etiqueta={e} />
                  <span className="cifra flex-1 text-xs text-muted-foreground">
                    {numero(usos[e.id] ?? 0)}{" "}
                    <span className="font-sans">
                      {(usos[e.id] ?? 0) === 1 ? "ficha" : "fichas"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditando(e.id)}
                    className={buttonVariants({ variant: "ghost", size: "icon" })}
                    aria-label={`Editar ${e.nombre}`}
                    title="Editar"
                  >
                    <Pencil aria-hidden />
                  </button>
                  {puedeBorrar && (
                    <button
                      type="button"
                      onClick={() => setBorrando(e)}
                      className={buttonVariants({ variant: "ghost", size: "icon" })}
                      aria-label={`Borrar ${e.nombre}`}
                      title="Borrar"
                    >
                      <Trash2 aria-hidden />
                    </button>
                  )}
                </li>
              ),
            )}
          </ul>
        )}

        {borrando && (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-destructive-border bg-destructive-soft p-3 text-sm"
          >
            <p className="font-medium text-destructive">
              ¿Borrar «{borrando.nombre}»?{" "}
              {(usos[borrando.id] ?? 0) > 0
                ? `Se quita de ${numero(usos[borrando.id] ?? 0)} ${(usos[borrando.id] ?? 0) === 1 ? "ficha" : "fichas"}.`
                : "Ninguna ficha la tiene."}{" "}
              Las fichas no cambian en nada más.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBorrando(null)}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                <X aria-hidden /> No borrar
              </button>
              <button
                type="button"
                onClick={() => borrar.mutate(borrando.id)}
                disabled={borrar.isPending}
                className={buttonVariants({ variant: "destructive", size: "sm" })}
              >
                {borrar.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Borrar etiqueta
              </button>
            </div>
          </div>
        )}

        {editando === "nueva" ? (
          <FormularioEtiqueta
            existentes={catalogo.map((e) => e.nombre)}
            guardando={guardar.isPending}
            onGuardar={(v) => guardar.mutate(v)}
            onCancelar={() => setEditando(null)}
            textoGuardar="Crear etiqueta"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditando("nueva")}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
          >
            <Plus aria-hidden /> Nueva etiqueta
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
