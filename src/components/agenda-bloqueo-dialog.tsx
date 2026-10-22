import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { CLASE_CAMPO, GrupoDeChips } from "@/components/cita-formulario";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { claveExcepciones } from "@/hooks/use-disponibilidad-agenda";
import { addDaysISO } from "@/lib/clinic-operations/agenda-fechas";
import { listOperatories } from "@/lib/clinic-operations/cita-formulario.functions";
import {
  ETIQUETA_MOTIVO,
  MOTIVOS_BLOQUEO,
  MOTIVOS_DE_AUSENCIA,
  problemaDeExcepcion,
  type ExcepcionAgenda,
  type MotivoBloqueo,
  type TipoExcepcion,
} from "@/lib/clinic-operations/disponibilidad";
import { createAgendaException } from "@/lib/clinic-operations/disponibilidad.functions";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Bloquear horario (AGE-07), abrir un horario excepcional (AGE-08) y
 * "Ausencia del profesional" (atajo de MKT-02: un bloqueo de ausencia que,
 * al guardarse, ofrece reprogramar las citas que pisa).
 *
 * Las horas son de pared de la sucursal, igual que las de una cita: el
 * `<input type="datetime-local">` viaja crudo y la base lo guarda sin huso.
 */

export type ModoBloqueo = "bloqueo" | "apertura" | "ausencia";

const TITULO: Record<ModoBloqueo, string> = {
  bloqueo: "Bloquear horario",
  apertura: "Abrir horario excepcional",
  ausencia: "Ausencia del profesional",
};

const DESCRIPCION: Record<ModoBloqueo, string> = {
  bloqueo:
    "El rango se ve rayado en la agenda y no ofrece agendar. Si alguien agenda encima, se le avisa.",
  apertura:
    "Habilita un rango fuera del horario habitual del profesional (por ejemplo, un sábado). La agenda lo muestra disponible.",
  ausencia:
    "Bloquea la agenda del profesional y, al guardar, te muestra las citas que hay que mover o avisar.",
};

export interface SucursalOpcion {
  id: string;
  nombre: string;
}
export interface ProfesionalOpcion {
  id: string;
  nombre: string;
  sucursalId: string;
}

export function BloqueoDialog({
  clinicId,
  modo,
  open,
  onOpenChange,
  sucursales,
  profesionales,
  fechaInicial,
  profesionalInicial,
  onAusenciaCreada,
}: {
  clinicId: string;
  modo: ModoBloqueo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sucursales: readonly SucursalOpcion[];
  profesionales: readonly ProfesionalOpcion[];
  /** "YYYY-MM-DD" con que arranca el formulario (la fecha que mira la agenda). */
  fechaInicial: string;
  profesionalInicial?: string;
  /** Se creó un bloqueo de ausencia o vacaciones de un profesional: ofrecer reprogramar (MKT-02). */
  onAusenciaCreada?: (excepcion: ExcepcionAgenda) => void;
}) {
  const fid = useId();
  const tipo: TipoExcepcion = modo === "apertura" ? "apertura" : "bloqueo";
  const [motivo, setMotivo] = useState<MotivoBloqueo | null>(null);
  const [profesionalId, setProfesionalId] = useState("");
  const [sucursalId, setSucursalId] = useState("");
  const [boxId, setBoxId] = useState("");
  const [todoElDia, setTodoElDia] = useState(false);
  const [desdeFecha, setDesdeFecha] = useState(fechaInicial);
  const [hastaFecha, setHastaFecha] = useState(fechaInicial);
  const [desdeHora, setDesdeHora] = useState("13:00");
  const [hastaHora, setHastaHora] = useState("14:00");
  const [repetir, setRepetir] = useState(false);
  const [repetirHasta, setRepetirHasta] = useState("");
  const [nota, setNota] = useState("");

  // Cada vez que se abre, arranca limpio con lo que trae la agenda.
  useEffect(() => {
    if (!open) return;
    setMotivo(modo === "ausencia" ? "ausencia" : null);
    setProfesionalId(profesionalInicial ?? (profesionales.length === 1 ? profesionales[0].id : ""));
    setSucursalId(sucursales.length === 1 ? sucursales[0].id : "");
    setBoxId("");
    setTodoElDia(modo === "ausencia");
    setDesdeFecha(fechaInicial);
    setHastaFecha(fechaInicial);
    setDesdeHora(modo === "apertura" ? "09:00" : "13:00");
    setHastaHora(modo === "apertura" ? "13:00" : "14:00");
    setRepetir(false);
    setRepetirHasta("");
    setNota("");
    // Solo al abrir: después manda lo que la persona edita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchBoxes = useServerFn(listOperatories);
  const { data: boxes = [] } = useQuery({
    queryKey: ["operatories", clinicId],
    enabled: open && tipo === "bloqueo",
    staleTime: 5 * 60_000,
    queryFn: () => fetchBoxes({ data: { clinicId } }),
  });

  const inicio = `${desdeFecha}T${todoElDia ? "00:00" : desdeHora}`;
  // "Todo el día" termina a las 00:00 del día siguiente al último.
  const fin = todoElDia
    ? `${hastaFecha ? addDaysISO(hastaFecha, 1) : ""}T00:00`
    : `${repetir ? desdeFecha : hastaFecha}T${hastaHora}`;

  const problema =
    (!desdeFecha || (!repetir && !hastaFecha) ? "Completa las fechas." : null) ??
    (modo === "ausencia" && !profesionalId ? "Elige el profesional que se ausenta." : null) ??
    problemaDeExcepcion({
      tipo,
      motivo: tipo === "bloqueo" ? motivo : null,
      profesionalId: profesionalId || null,
      inicio,
      fin,
      repetirSemanal: repetir,
      repetirHasta: repetir && repetirHasta ? repetirHasta : null,
    });

  const queryClient = useQueryClient();
  const crearFn = useServerFn(createAgendaException);
  const crear = useMutation({
    mutationFn: () =>
      crearFn({
        data: {
          clinicId,
          tipo,
          motivo: tipo === "bloqueo" ? motivo : null,
          nota: nota.trim() || null,
          profesionalId: profesionalId || null,
          sucursalId: profesionalId ? null : sucursalId || null,
          boxId: profesionalId ? null : boxId || null,
          inicio,
          fin,
          repetirSemanal: repetir,
          repetirHasta: repetir && repetirHasta ? repetirHasta : null,
        },
      }),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: claveExcepciones(clinicId) });
      toast.success(tipo === "apertura" ? "Horario excepcional abierto." : "Horario bloqueado.");
      onOpenChange(false);
      if (tipo === "bloqueo" && motivo && MOTIVOS_DE_AUSENCIA.has(motivo) && profesionalId) {
        onAusenciaCreada?.({
          id,
          tipo,
          motivo,
          nota: nota.trim() || null,
          profesionalId,
          sucursalId: null,
          boxId: null,
          boxNombre: null,
          inicio,
          fin,
          repetirSemanal: repetir,
          repetirHasta: repetir && repetirHasta ? repetirHasta : null,
        });
      }
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const boxesDeLaSucursal = boxes.filter((b) => !sucursalId || b.sucursalId === sucursalId);
  const profesionalObligatorio = tipo === "apertura" || modo === "ausencia";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{TITULO[modo]}</DialogTitle>
          <DialogDescription>{DESCRIPCION[modo]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {tipo === "bloqueo" && (
            <div className="space-y-1.5">
              <p id={`${fid}-motivo-etiqueta`} className="text-sm font-medium leading-none">
                Motivo
              </p>
              <GrupoDeChips
                id={`${fid}-motivo`}
                etiqueta="Motivo"
                opciones={(modo === "ausencia"
                  ? MOTIVOS_BLOQUEO.filter((m) => MOTIVOS_DE_AUSENCIA.has(m))
                  : MOTIVOS_BLOQUEO
                ).map((m) => ({ value: m, label: ETIQUETA_MOTIVO[m] }))}
                value={motivo}
                onChange={(v) => setMotivo((v as MotivoBloqueo | null) ?? null)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-profesional`}>Profesional</Label>
            <select
              id={`${fid}-profesional`}
              value={profesionalId}
              onChange={(e) => setProfesionalId(e.target.value)}
              className={CLASE_CAMPO}
            >
              <option value="">
                {profesionalObligatorio ? "Elegir profesional…" : "Todos (sucursal o box)"}
              </option>
              {profesionales.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>

          {modo === "bloqueo" && !profesionalId && (
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              {sucursales.length > 1 && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${fid}-sucursal`}>Sucursal</Label>
                  <select
                    id={`${fid}-sucursal`}
                    value={sucursalId}
                    onChange={(e) => {
                      setSucursalId(e.target.value);
                      setBoxId("");
                    }}
                    className={CLASE_CAMPO}
                  >
                    <option value="">Todas las sucursales</option>
                    {sucursales.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {boxesDeLaSucursal.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${fid}-box`}>
                    Box <span className="font-normal text-muted-foreground">(opcional)</span>
                  </Label>
                  <select
                    id={`${fid}-box`}
                    value={boxId}
                    onChange={(e) => setBoxId(e.target.value)}
                    className={CLASE_CAMPO}
                  >
                    <option value="">Todos los boxes</option>
                    {boxesDeLaSucursal.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={todoElDia}
              onChange={(e) => {
                setTodoElDia(e.target.checked);
                if (e.target.checked) setRepetir(false);
              }}
            />
            Todo el día
          </label>

          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-desde`}>{repetir ? "Primer día" : "Desde"}</Label>
              <div className="flex gap-2">
                <input
                  id={`${fid}-desde`}
                  type="date"
                  value={desdeFecha}
                  onChange={(e) => {
                    setDesdeFecha(e.target.value);
                    if (!hastaFecha || hastaFecha < e.target.value) setHastaFecha(e.target.value);
                  }}
                  className={CLASE_CAMPO}
                />
                {!todoElDia && (
                  <input
                    type="time"
                    aria-label="Hora de inicio"
                    value={desdeHora}
                    onChange={(e) => setDesdeHora(e.target.value)}
                    className={cn(CLASE_CAMPO, "w-32 shrink-0")}
                  />
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-hasta`}>{repetir ? "Hasta las" : "Hasta"}</Label>
              <div className="flex gap-2">
                {!repetir && (
                  <input
                    id={`${fid}-hasta`}
                    type="date"
                    value={hastaFecha}
                    min={desdeFecha}
                    onChange={(e) => setHastaFecha(e.target.value)}
                    className={CLASE_CAMPO}
                  />
                )}
                {!todoElDia && (
                  <input
                    id={repetir ? `${fid}-hasta` : undefined}
                    type="time"
                    aria-label="Hora de término"
                    value={hastaHora}
                    onChange={(e) => setHastaHora(e.target.value)}
                    className={cn(CLASE_CAMPO, !repetir && "w-32 shrink-0")}
                  />
                )}
              </div>
            </div>
          </div>

          {!todoElDia && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={repetir}
                  onChange={(e) => setRepetir(e.target.checked)}
                />
                Repetir cada semana
              </label>
              {repetir && (
                <div className="space-y-1.5 pl-6">
                  <Label htmlFor={`${fid}-repetir-hasta`}>
                    Hasta el{" "}
                    <span className="font-normal text-muted-foreground">
                      (opcional; vacío = sin fin)
                    </span>
                  </Label>
                  <input
                    id={`${fid}-repetir-hasta`}
                    type="date"
                    value={repetirHasta}
                    min={desdeFecha}
                    onChange={(e) => setRepetirHasta(e.target.value)}
                    className={cn(CLASE_CAMPO, "w-48")}
                  />
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-nota`}>
              Nota <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <input
              id={`${fid}-nota`}
              value={nota}
              maxLength={200}
              onChange={(e) => setNota(e.target.value)}
              placeholder={tipo === "apertura" ? "Ej: operativo de sábado" : "Ej: congreso en Lima"}
              className={CLASE_CAMPO}
            />
          </div>
        </div>

        <DialogFooter>
          <AccionDeshabilitada motivo={problema}>
            <Button onClick={() => crear.mutate()} disabled={crear.isPending}>
              {crear.isPending && <Loader2 className="size-3.5 animate-spin" />}
              {tipo === "apertura" ? "Abrir horario" : "Bloquear"}
            </Button>
          </AccionDeshabilitada>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
