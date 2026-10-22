import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { BloqueoEscritura } from "@/components/solo-lectura";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  guardarMedicamentoClinica,
  listVademecumClinica,
  setMedicamentoClinicaActivo,
  type MedicamentoDeLaClinica,
} from "@/lib/clinical/prescriptions.functions";
import {
  buscarEnVademecum,
  ETIQUETA_GRUPO_FARMACOLOGICO,
  ETIQUETA_VIA,
  etiquetaMedicamento,
  GRUPOS_FARMACOLOGICOS,
  VADEMECUM_BASE,
  VIAS,
  type GrupoFarmacologico,
  type ViaAdministracion,
} from "@/lib/clinical/vademecum";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

const SELECT =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";

type Formulario = {
  id?: string;
  principioActivo: string;
  concentracion: string;
  forma: string;
  grupo: GrupoFarmacologico | "";
  via: ViaAdministracion;
  atc: string;
  dosis: string;
  frecuencia: string;
  duracion: string;
  indicaciones: string;
};

const VACIO: Formulario = {
  principioActivo: "",
  concentracion: "",
  forma: "",
  grupo: "",
  via: "oral",
  atc: "",
  dosis: "",
  frecuencia: "",
  duracion: "",
  indicaciones: "",
};

function desde(m: MedicamentoDeLaClinica): Formulario {
  return {
    id: m.id,
    principioActivo: m.principioActivo,
    concentracion: m.concentracion ?? "",
    forma: m.forma ?? "",
    grupo: m.grupo ?? "",
    via: m.via,
    atc: m.atc ?? "",
    dosis: m.dosis,
    frecuencia: m.frecuencia,
    duracion: m.duracion,
    indicaciones: m.indicaciones ?? "",
  };
}

/**
 * Vademécum (MKT-05): el base de Esmalia (solo lectura) y el de la clínica,
 * que agregan y editan quienes recetan. Un medicamento de la clínica no se
 * borra: se desactiva (las recetas emitidas guardan su propia copia).
 */
export function VademecumDialog({
  abierto,
  onCerrar,
  clinicId,
  puedeEditar,
}: {
  abierto: boolean;
  onCerrar: () => void;
  clinicId: string;
  puedeEditar: boolean;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const listar = useServerFn(listVademecumClinica);
  const guardar = useServerFn(guardarMedicamentoClinica);
  const activar = useServerFn(setMedicamentoClinicaActivo);
  const consulta = useQuery({
    queryKey: ["vademecum-clinica", clinicId],
    queryFn: () => listar({ data: { clinicId } }),
    enabled: abierto,
  });
  const [form, setForm] = useState<Formulario | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const base = useMemo(
    () => (busqueda.trim() ? buscarEnVademecum(VADEMECUM_BASE, busqueda, 50) : VADEMECUM_BASE),
    [busqueda],
  );

  async function refrescar() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["vademecum-clinica", clinicId] }),
      queryClient.invalidateQueries({ queryKey: ["datos-para-receta", clinicId] }),
    ]);
  }

  const guardarMut = useMutation({
    mutationFn: (f: Formulario) =>
      guardar({ data: { clinicId, ...f, grupo: f.grupo || null, id: f.id } }),
    onSuccess: async () => {
      toast.success("Vademécum actualizado.");
      setForm(null);
      await refrescar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const activarMut = useMutation({
    mutationFn: (p: { id: string; activo: boolean }) => activar({ data: { clinicId, ...p } }),
    onSuccess: refrescar,
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const campo = (
    nombre: keyof Formulario,
    etiqueta: string,
    opciones: { placeholder?: string; max?: number } = {},
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`${fid}-${nombre}`}>{etiqueta}</Label>
      <Input
        id={`${fid}-${nombre}`}
        value={(form?.[nombre] as string | undefined) ?? ""}
        maxLength={opciones.max ?? 120}
        placeholder={opciones.placeholder}
        onChange={(e) => setForm((f) => (f ? { ...f, [nombre]: e.target.value } : f))}
      />
    </div>
  );

  const propios = consulta.data ?? [];

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vademécum</DialogTitle>
          <DialogDescription>
            Al recetar, el nombre se autocompleta con estos medicamentos y su posología sugerida,
            que siempre puedes cambiar. Las dosis son sugerencias para un adulto: la decisión es del
            profesional para cada paciente.
          </DialogDescription>
        </DialogHeader>

        <section aria-labelledby={`${fid}-propios`} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`${fid}-propios`} className="font-display text-lg font-semibold">
              De la clínica
            </h3>
            {puedeEditar && !form && (
              <BloqueoEscritura>
                <Button size="sm" variant="outline" onClick={() => setForm({ ...VACIO })}>
                  <Plus aria-hidden /> Agregar medicamento
                </Button>
              </BloqueoEscritura>
            )}
          </div>

          {form && (
            <form
              className="space-y-3 rounded-lg border border-hairline p-3"
              onSubmit={(e) => {
                e.preventDefault();
                guardarMut.mutate(form);
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {campo("principioActivo", "Principio activo", { placeholder: "Ej. Amoxicilina" })}
                {campo("concentracion", "Concentración", { placeholder: "Ej. 500 mg", max: 60 })}
                {campo("forma", "Forma", { placeholder: "Ej. cápsulas", max: 60 })}
                <div className="space-y-1">
                  <Label htmlFor={`${fid}-via`}>Vía</Label>
                  <select
                    id={`${fid}-via`}
                    className={SELECT}
                    value={form.via}
                    onChange={(e) => setForm({ ...form, via: e.target.value as ViaAdministracion })}
                  >
                    {VIAS.map((v) => (
                      <option key={v} value={v}>
                        {ETIQUETA_VIA[v]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${fid}-grupo`}>Familia (para el aviso de alergias)</Label>
                  <select
                    id={`${fid}-grupo`}
                    className={SELECT}
                    value={form.grupo}
                    onChange={(e) =>
                      setForm({ ...form, grupo: e.target.value as GrupoFarmacologico | "" })
                    }
                  >
                    <option value="">Sin familia</option>
                    {GRUPOS_FARMACOLOGICOS.map((g) => (
                      <option key={g} value={g}>
                        {ETIQUETA_GRUPO_FARMACOLOGICO[g]}
                      </option>
                    ))}
                  </select>
                </div>
                {campo("atc", "Código ATC (opcional)", { placeholder: "Ej. J01CA04", max: 7 })}
                {campo("dosis", "Dosis sugerida", { placeholder: "Ej. 1 cápsula" })}
                {campo("frecuencia", "Frecuencia sugerida", { placeholder: "Ej. cada 8 horas" })}
                {campo("duracion", "Duración sugerida", { placeholder: "Ej. por 7 días" })}
                {campo("indicaciones", "Indicaciones", { max: 500 })}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setForm(null)}>
                  Cancelar
                </Button>
                <BloqueoEscritura
                  otroMotivo={
                    form.principioActivo.trim().length < 2 ? "Escribe el principio activo." : null
                  }
                >
                  <Button
                    type="submit"
                    size="sm"
                    disabled={guardarMut.isPending || form.principioActivo.trim().length < 2}
                  >
                    {guardarMut.isPending && <Loader2 className="animate-spin" aria-hidden />}
                    Guardar
                  </Button>
                </BloqueoEscritura>
              </div>
            </form>
          )}

          {consulta.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
            </p>
          ) : consulta.isError ? (
            <p className="text-sm text-destructive">
              No pudimos cargar el vademécum de la clínica.
            </p>
          ) : propios.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              La clínica todavía no agregó medicamentos propios. También puedes guardarlos desde una
              receta, con «Guardar en el vademécum de la clínica».
            </p>
          ) : (
            <ul className="divide-y divide-hairline border-y border-border">
              {propios.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <div className={cn("min-w-0 flex-1", !m.activo && "text-muted-foreground")}>
                    <p className="text-sm font-medium">
                      {etiquetaMedicamento(m)}
                      {!m.activo && (
                        <Badge variant="outline" className="ml-2">
                          Desactivado
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ETIQUETA_VIA[m.via]}
                      {m.dosis ? ` · ${m.dosis}, ${m.frecuencia}, ${m.duracion}` : ""}
                    </p>
                  </div>
                  {puedeEditar && (
                    <div className="flex gap-1.5">
                      <BloqueoEscritura>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setForm(desde(m))}
                          aria-label={`Editar ${etiquetaMedicamento(m)}`}
                        >
                          <Pencil aria-hidden /> Editar
                        </Button>
                      </BloqueoEscritura>
                      <BloqueoEscritura>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={activarMut.isPending}
                          onClick={() => activarMut.mutate({ id: m.id, activo: !m.activo })}
                        >
                          {m.activo ? "Desactivar" : "Activar"}
                        </Button>
                      </BloqueoEscritura>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby={`${fid}-base`} className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h3 id={`${fid}-base`} className="font-display text-lg font-semibold">
              Base de Esmalia{" "}
              <span className="cifra text-sm font-normal text-muted-foreground">
                ({VADEMECUM_BASE.length})
              </span>
            </h3>
            <div className="w-full max-w-60 space-y-1">
              <Label htmlFor={`${fid}-buscar`} className="sr-only">
                Buscar en el vademécum base
              </Label>
              <Input
                id={`${fid}-buscar`}
                placeholder="Buscar"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
          </div>
          <ul className="divide-y divide-hairline border-y border-border">
            {base.map((m) => (
              <li key={m.codigo} className="py-2">
                <p className="text-sm font-medium">{etiquetaMedicamento(m)}</p>
                <p className="text-xs text-muted-foreground">
                  {ETIQUETA_VIA[m.via]}
                  {m.grupo ? ` · ${ETIQUETA_GRUPO_FARMACOLOGICO[m.grupo]}` : ""}
                  {m.dosis
                    ? ` · ${m.dosis}, ${m.frecuencia}, ${m.duracion}`
                    : ` · dosis según peso, ${m.frecuencia}, ${m.duracion}`}
                  {m.atc ? ` · ATC ${m.atc}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}
