import { useEffect, useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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
import { mensajeDeError } from "@/lib/mensaje-error";
import { buscarPacientes } from "@/lib/patients/buscar-pacientes.functions";
import { crearTarea } from "@/lib/seguimiento/seguimiento.functions";
import { ETIQUETA_TIPO_TAREA, TIPOS_DE_TAREA, type TipoDeTarea } from "@/lib/seguimiento/tareas";

export interface MiembroAsignable {
  userId: string;
  nombre: string;
}

const CAMPO =
  "h-10 w-full rounded-lg border border-control bg-card px-3 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11";

/** CRM-02: crear una tarea a mano (llamada, mensaje, otra) para alguien del equipo. */
export function NuevaTareaDialog({
  clinicId,
  hoy,
  userId,
  miembros,
  abierto,
  onAbiertoChange,
  onCreada,
  inicial,
}: {
  clinicId: string;
  hoy: string;
  userId: string;
  miembros: readonly MiembroAsignable[];
  abierto: boolean;
  onAbiertoChange: (v: boolean) => void;
  onCreada: () => void;
  inicial?: { patientId: string; patientName: string } | null;
}) {
  const fid = useId();
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<TipoDeTarea>("llamada");
  const [fecha, setFecha] = useState(hoy);
  const [asignada, setAsignada] = useState<string>(userId);
  const [notas, setNotas] = useState("");
  const [paciente, setPaciente] = useState<{ id: string; nombre: string } | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [termino, setTermino] = useState("");

  useEffect(() => {
    if (!abierto) return;
    setTitulo("");
    setTipo("llamada");
    setFecha(hoy);
    setAsignada(userId);
    setNotas("");
    setPaciente(inicial ? { id: inicial.patientId, nombre: inicial.patientName } : null);
    setBusqueda("");
    setTermino("");
  }, [abierto, hoy, userId, inicial]);

  useEffect(() => {
    const t = setTimeout(() => setTermino(busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const buscar = useServerFn(buscarPacientes);
  const resultados = useQuery({
    queryKey: ["seguimiento-buscar-paciente", clinicId, termino],
    queryFn: () => buscar({ data: { clinicId, q: termino } }),
    enabled: abierto && termino.length >= 2 && !paciente,
  });

  const crear = useServerFn(crearTarea);
  const mutacion = useMutation({
    mutationFn: () =>
      crear({
        data: {
          clinicId,
          titulo,
          notas: notas.trim() || null,
          tipo,
          patientId: paciente?.id ?? null,
          quoteId: null,
          controlId: null,
          asignarA: asignada || null,
          fecha,
        },
      }),
    onSuccess: () => {
      toast.success("Tarea creada.");
      onCreada();
      onAbiertoChange(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const puedeGuardar = titulo.trim().length >= 2 && Boolean(fecha);

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva tarea</DialogTitle>
          <DialogDescription>Qué hay que hacer, para quién y para cuándo.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (puedeGuardar) mutacion.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-titulo`}>Qué hay que hacer</Label>
            <Input
              id={`${fid}-titulo`}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={160}
              placeholder="Ej.: Llamar para confirmar la próxima sesión"
              autoFocus
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-tipo`}>Tipo</Label>
              <select
                id={`${fid}-tipo`}
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoDeTarea)}
                className={CAMPO}
              >
                {TIPOS_DE_TAREA.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_TIPO_TAREA[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-fecha`}>Para cuándo</Label>
              <input
                id={`${fid}-fecha`}
                type="date"
                value={fecha}
                min={hoy}
                onChange={(e) => setFecha(e.target.value)}
                className={CAMPO}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-asignada`}>Asignada a</Label>
            <select
              id={`${fid}-asignada`}
              value={asignada}
              onChange={(e) => setAsignada(e.target.value)}
              className={CAMPO}
            >
              <option value="">Sin asignar</option>
              {miembros.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === userId ? `${m.nombre} (tú)` : m.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-paciente`}>Paciente (opcional)</Label>
            {paciente ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-control px-3 py-2 text-[15px]">
                <span className="truncate font-medium">{paciente.nombre}</span>
                <button
                  type="button"
                  onClick={() => setPaciente(null)}
                  className="text-sm font-semibold text-brand-700 underline-offset-4 hover:underline"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <>
                <Input
                  id={`${fid}-paciente`}
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Busca por nombre o RUT"
                  autoComplete="off"
                />
                {termino.length >= 2 && (
                  <ul className="max-h-44 overflow-y-auto rounded-lg border border-hairline">
                    {resultados.isFetching && (
                      <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Buscando…
                      </li>
                    )}
                    {!resultados.isFetching && (resultados.data ?? []).length === 0 && (
                      <li className="px-3 py-2 text-sm text-muted-foreground">Sin resultados.</li>
                    )}
                    {(resultados.data ?? []).slice(0, 8).map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setPaciente({ id: p.id, nombre: p.nombre })}
                          className="block w-full px-3 py-2 text-left text-[15px] hover:bg-secondary pointer-coarse:min-h-11"
                        >
                          {p.nombre}
                          {p.telefono && (
                            <span className="ml-2 text-sm text-muted-foreground">{p.telefono}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-notas`}>Notas (opcional)</Label>
            <textarea
              id={`${fid}-notas`}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              maxLength={1000}
              rows={3}
              className="w-full rounded-lg border border-control bg-card px-3 py-2 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onAbiertoChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!puedeGuardar || mutacion.isPending}>
              {mutacion.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Crear tarea
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
