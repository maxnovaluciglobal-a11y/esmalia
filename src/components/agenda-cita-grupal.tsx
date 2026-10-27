import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, Check, Loader2, UserMinus, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";

import { PatientCombobox } from "@/components/patient-combobox";
import { BloqueoEscritura } from "@/components/solo-lectura";
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
import {
  CUPO_MAXIMO,
  CUPO_MINIMO,
  ETIQUETA_ASISTENCIA,
  TEXTO_SIN_INSCRIPCION,
  cuposLibres,
  etiquetaCupo,
  motivoParaNoInscribir,
  ordenarParticipantes,
  puedeMarcarAsistencia,
  resumenAsistencia,
  validarGrupo,
  type Asistencia,
} from "@/lib/clinic-operations/citas-grupales";
import {
  convertirEnGrupal,
  editarGrupal,
  inscribirEnGrupal,
  listarParticipantes,
  anotarAvisoDeInscrito,
  marcarAsistenciaGrupal,
  retirarDeGrupal,
} from "@/lib/clinic-operations/citas-grupales.functions";
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import { HORA_INICIO, type Cita } from "@/lib/clinic-operations/clinic-data";
import { listPatients } from "@/lib/patients/patients.functions";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Cita grupal en el cajón de la agenda (AGE-22): convertir una cita en
 * grupal, ver el cupo, inscribir y retirar pacientes y pasar lista uno por
 * uno. Cada acción la repite la base (cupo, retiro del último, asistencia
 * desde que empieza la cita, permisos de agenda).
 */

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:text-base";

/** Instante de inicio de la cita (fecha + minutos desde la hora de apertura) en la zona dada. */
function inicioDeCita(c: Pick<Cita, "fecha" | "inicio">, zona: string): string {
  const total = HORA_INICIO * 60 + c.inicio;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return wallTimeInTzToUtc(`${c.fecha}T${hh}:${mm}`, zona).toISOString();
}

function useInvalidarGrupal(clinicId: string, appointmentId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["cita-grupal", clinicId, appointmentId] });
    void qc.invalidateQueries({ queryKey: ["appointments", clinicId] });
  };
}

/** Diálogo para crear o editar la parte grupal de una cita. */
export function DialogoCitaGrupal({
  clinicId,
  cita,
  abierto,
  onCambio,
  inscritos = 1,
}: {
  clinicId: string;
  cita: Cita;
  abierto: boolean;
  onCambio: (v: boolean) => void;
  inscritos?: number;
}) {
  const fid = useId();
  const editando = Boolean(cita.grupal);
  const [titulo, setTitulo] = useState(cita.grupal?.titulo ?? cita.tratamiento ?? "");
  const [cupo, setCupo] = useState(String(cita.grupal?.cupo ?? 10));
  const invalidar = useInvalidarGrupal(clinicId, cita.id);
  const convertirFn = useServerFn(convertirEnGrupal);
  const editarFn = useServerFn(editarGrupal);
  const cupoNum = Number(cupo);
  const error = validarGrupo(titulo, cupoNum, cita.grupal?.inscritos ?? inscritos);

  const guardar = useMutation({
    mutationFn: () => {
      const datos = { clinicId, appointmentId: cita.id, titulo: titulo.trim(), cupo: cupoNum };
      return editando ? editarFn({ data: datos }) : convertirFn({ data: datos });
    },
    onSuccess: () => {
      invalidar();
      toast.success(editando ? "Cita grupal actualizada" : "La cita ahora es grupal");
      onCambio(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={abierto} onOpenChange={onCambio}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar cita grupal" : "Hacer grupal esta cita"}</DialogTitle>
          <DialogDescription>
            {editando
              ? "Cambia el nombre de la actividad o el cupo."
              : "Varios pacientes en el mismo horario, con un solo profesional y un solo box. El paciente de la cita queda como primer inscrito."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-titulo`}>Actividad</Label>
            <input
              id={`${fid}-titulo`}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ej: Charla de higiene"
              className={INPUT}
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-cupo`}>Cupo máximo</Label>
            <input
              id={`${fid}-cupo`}
              type="number"
              inputMode="numeric"
              min={CUPO_MINIMO}
              max={CUPO_MAXIMO}
              value={cupo}
              onChange={(e) => setCupo(e.target.value)}
              className={cn(INPUT, "cifra")}
            />
          </div>
          {error && (titulo || cupo) && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => guardar.mutate()} disabled={Boolean(error) || guardar.isPending}>
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {editando ? "Guardar" : "Hacer grupal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Botón "Hacer grupal" para una cita individual. */
export function BotonHacerGrupal({
  clinicId,
  cita,
  className,
}: {
  clinicId: string;
  cita: Cita;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <BloqueoEscritura>
        <button type="button" onClick={() => setAbierto(true)} className={className}>
          <Users aria-hidden className="size-4" />
          Hacer grupal
        </button>
      </BloqueoEscritura>
      {abierto && (
        <DialogoCitaGrupal
          clinicId={clinicId}
          cita={cita}
          abierto={abierto}
          onCambio={setAbierto}
        />
      )}
    </>
  );
}

const CHIP_ASISTENCIA =
  "inline-flex h-[30px] shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12.5px] font-semibold outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 pointer-coarse:h-11";

/** Participantes de una cita grupal: cupo, lista, asistencia, inscribir y retirar. */
export function SeccionCitaGrupal({
  clinicId,
  cita,
  zona,
  puedeGestionar,
}: {
  clinicId: string;
  cita: Cita;
  zona: string;
  puedeGestionar: boolean;
}) {
  const fid = useId();
  const [nuevo, setNuevo] = useState("");
  const [editar, setEditar] = useState(false);
  const invalidar = useInvalidarGrupal(clinicId, cita.id);

  const fetchParticipantes = useServerFn(listarParticipantes);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["cita-grupal", clinicId, cita.id],
    queryFn: () => fetchParticipantes({ data: { clinicId, appointmentId: cita.id } }),
  });
  const fetchPacientes = useServerFn(listPatients);
  const { data: pacientesRes } = useQuery({
    queryKey: ["patients", clinicId],
    enabled: puedeGestionar,
    queryFn: () => fetchPacientes({ data: { clinicId } }),
  });

  const inscribirFn = useServerFn(inscribirEnGrupal);
  const retirarFn = useServerFn(retirarDeGrupal);
  const asistenciaFn = useServerFn(marcarAsistenciaGrupal);
  const avisoFn = useServerFn(anotarAvisoDeInscrito);

  const inscribir = useMutation({
    mutationFn: (patientId: string) =>
      inscribirFn({ data: { clinicId, appointmentId: cita.id, patientId } }),
    onSuccess: () => {
      invalidar();
      setNuevo("");
      toast.success("Paciente inscrito");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const retirar = useMutation({
    mutationFn: (participanteId: string) => retirarFn({ data: { clinicId, participanteId } }),
    onSuccess: () => {
      invalidar();
      toast.success("Paciente retirado de la cita");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const avisar = useMutation({
    mutationFn: (v: { participanteId: string; avisado: boolean }) =>
      avisoFn({ data: { clinicId, ...v } }),
    onSuccess: () => invalidar(),
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const marcar = useMutation({
    mutationFn: (v: { participanteId: string; asistencia: Asistencia }) =>
      asistenciaFn({ data: { clinicId, ...v } }),
    onSuccess: () => invalidar(),
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const grupo =
    data?.grupo ?? (cita.grupal ? { titulo: cita.grupal.titulo, cupo: cita.grupal.cupo } : null);
  const participantes = ordenarParticipantes(data?.participantes ?? []);
  const resumen = resumenAsistencia(participantes);
  const vigentes = participantes.filter((p) => !p.retiradoEn).map((p) => p.pacienteId);
  const inscritos = data ? resumen.vigentes : (cita.grupal?.inscritos ?? 0);
  const cupo = grupo?.cupo ?? 0;
  const listaPasable = puedeMarcarAsistencia(inicioDeCita(cita, zona));
  const motivo = motivoParaNoInscribir({
    cupo,
    inscritos,
    estadoCita: cita.estado,
    pacienteId: nuevo || undefined,
    vigentes,
  });
  const opciones = (pacientesRes?.items ?? [])
    .filter((p) => !vigentes.includes(p.id))
    .map((p) => ({ id: p.id, nombre: p.nombre }));

  return (
    <section aria-labelledby={`${fid}-titulo`} className="border-t border-border py-3.5">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 id={`${fid}-titulo`} className="font-sans text-xs font-semibold text-muted-foreground">
          Inscritos
        </h3>
        <span className="text-[13px] font-medium">
          <span className="cifra">{etiquetaCupo({ cupo, inscritos })}</span> ·{" "}
          {cuposLibres(cupo, inscritos) === 0
            ? "llena"
            : `${cuposLibres(cupo, inscritos)} ${cuposLibres(cupo, inscritos) === 1 ? "cupo libre" : "cupos libres"}`}
        </span>
      </div>

      {listaPasable && resumen.vigentes > 0 && (
        <p className="mb-2.5 text-[13px] text-muted-foreground">
          <span className="cifra">{resumen.asistieron}</span>{" "}
          {resumen.asistieron === 1 ? "asistió" : "asistieron"} ·{" "}
          <span className="cifra">{resumen.ausentes}</span>{" "}
          {resumen.ausentes === 1 ? "ausente" : "ausentes"} ·{" "}
          <span className="cifra">{resumen.sinMarcar}</span> sin marcar
        </p>
      )}

      {isError ? (
        <p className="text-sm text-muted-foreground">No pudimos cargar los inscritos.</p>
      ) : isLoading ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-3.5 animate-spin" /> Cargando inscritos…
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {participantes.map((p) => {
            const retirado = Boolean(p.retiradoEn);
            return (
              <li
                key={p.id}
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] border border-hairline px-2.5 py-2",
                  retirado && "opacity-60",
                )}
              >
                <div className="min-w-0">
                  <Link
                    to="/pacientes/$pacienteId"
                    params={{ pacienteId: p.pacienteId }}
                    className="inline-flex max-w-full items-center gap-1 truncate text-[14px] font-medium underline-offset-4 hover:underline"
                  >
                    <span className="truncate">{p.paciente}</span>
                    <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {retirado
                      ? `Retirado${p.motivoRetiro ? ` · ${p.motivoRetiro}` : ""}`
                      : ETIQUETA_ASISTENCIA[p.asistencia]}
                    {!retirado && p.avisoEl && (
                      <span className="ml-1.5 inline-flex items-center gap-1 font-medium text-success">
                        · <Check aria-hidden className="size-3" /> Avisó que viene
                      </span>
                    )}
                  </span>
                </div>
                {puedeGestionar && !retirado && (
                  <div className="flex items-center gap-1">
                    {listaPasable &&
                      (["asistio", "ausente"] as const).map((a) => {
                        const activo = p.asistencia === a;
                        return (
                          <button
                            key={a}
                            type="button"
                            aria-pressed={activo}
                            disabled={marcar.isPending}
                            onClick={() =>
                              marcar.mutate({
                                participanteId: p.id,
                                asistencia: activo ? "pendiente" : a,
                              })
                            }
                            aria-label={`${ETIQUETA_ASISTENCIA[a]}: ${p.paciente}`}
                            className={cn(
                              CHIP_ASISTENCIA,
                              activo
                                ? a === "asistio"
                                  ? "border-success-border bg-success-soft text-success"
                                  : "border-destructive-border bg-destructive-soft text-destructive"
                                : "border-control text-foreground/80 hover:border-foreground",
                            )}
                          >
                            {a === "asistio" ? (
                              <Check aria-hidden className="size-3.5" />
                            ) : (
                              <X aria-hidden className="size-3.5" />
                            )}
                            <span className="hidden sm:inline">{ETIQUETA_ASISTENCIA[a]}</span>
                          </button>
                        );
                      })}
                    {!listaPasable && (
                      <button
                        type="button"
                        aria-pressed={Boolean(p.avisoEl)}
                        disabled={avisar.isPending}
                        onClick={() => avisar.mutate({ participanteId: p.id, avisado: !p.avisoEl })}
                        aria-label={
                          p.avisoEl
                            ? `Quitar el aviso de ${p.paciente}`
                            : `Anotar que ${p.paciente} avisó que viene`
                        }
                        title={p.avisoEl ? "Quitar el aviso" : "Anotar que avisó que viene"}
                        className={cn(
                          CHIP_ASISTENCIA,
                          p.avisoEl
                            ? "border-success-border bg-success-soft text-success"
                            : "border-control text-foreground/80 hover:border-foreground",
                        )}
                      >
                        <Check aria-hidden className="size-3.5" />
                        <span className="hidden sm:inline">Avisó</span>
                      </button>
                    )}
                    {resumen.vigentes > 1 && (
                      <button
                        type="button"
                        disabled={retirar.isPending}
                        onClick={() => retirar.mutate(p.id)}
                        aria-label={`Retirar a ${p.paciente} de la cita`}
                        title="Retirar de la cita"
                        className={cn(
                          CHIP_ASISTENCIA,
                          "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <UserMinus aria-hidden className="size-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {puedeGestionar && (
        <BloqueoEscritura>
          <div className="mt-3 space-y-2">
            <Label htmlFor={`${fid}-paciente`} className="text-xs text-muted-foreground">
              Inscribir paciente
            </Label>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <PatientCombobox
                id={`${fid}-paciente`}
                value={nuevo}
                onChange={setNuevo}
                pacientes={opciones}
              />
              <Button
                size="sm"
                className="h-auto"
                disabled={!nuevo || motivo !== null || inscribir.isPending}
                onClick={() => inscribir.mutate(nuevo)}
              >
                {inscribir.isPending ? (
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <UserPlus aria-hidden className="size-3.5" />
                )}
                Inscribir
              </Button>
            </div>
            {motivo && motivo !== "ya_inscrito" && (
              <p className="text-xs text-muted-foreground">{TEXTO_SIN_INSCRIPCION[motivo]}</p>
            )}
            <button
              type="button"
              onClick={() => setEditar(true)}
              className="text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
            >
              Cambiar nombre o cupo
            </button>
          </div>
        </BloqueoEscritura>
      )}
      {!listaPasable && (
        <p className="mt-2 text-xs text-muted-foreground">
          La asistencia de cada paciente se marca desde que empieza la cita.
        </p>
      )}
      {editar && (
        <DialogoCitaGrupal
          clinicId={clinicId}
          cita={cita}
          abierto={editar}
          onCambio={setEditar}
          inscritos={inscritos}
        />
      )}
    </section>
  );
}
