import { useEffect, useId, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Ban, CalendarPlus, Loader2, Trash2, UserX, Users } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { BloqueoDialog, type ModoBloqueo } from "@/components/agenda-bloqueo-dialog";
import { ReprogramarAusenciaDialog } from "@/components/agenda-reprogramar-ausencia";
import { CLASE_CAMPO, GrupoDeChips } from "@/components/cita-formulario";
import { ErrorDeCarga } from "@/components/estado-error";
import { BloqueoEscritura } from "@/components/solo-lectura";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  claveAjustesAgenda,
  claveExcepciones,
  claveHorarioSucursales,
  useAjustesAgenda,
} from "@/hooks/use-disponibilidad-agenda";
import { hasPermission } from "@/lib/access/access";
import { requirePermission } from "@/lib/access/route-guards";
import { addDaysISO } from "@/lib/clinic-operations/agenda-fechas";
import { listBranchesDetailed } from "@/lib/clinic-operations/branches.functions";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { listProfessionals } from "@/lib/clinic-operations/clinic-catalog.functions";
import {
  cuandoAplica,
  DIAS_SEMANA,
  etiquetaExcepcion,
  INTERVALOS_GRILLA,
  MOTIVOS_DE_AUSENCIA,
  type BloqueSemanal,
  type ExcepcionAgenda,
  type IntervaloGrilla,
} from "@/lib/clinic-operations/disponibilidad";
import {
  deleteAgendaException,
  listAgendaExceptions,
  listBranchHours,
  saveAgendaSettings,
  setBranchHours,
} from "@/lib/clinic-operations/disponibilidad.functions";
import { fecha as fechaFmt } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Configuración de la agenda (Ola 2 · frente Disponibilidad):
 *
 * - AGE-10: intervalo de la grilla, duración por defecto de una cita nueva,
 *   sobrecupos, y horario de atención por día de cada sucursal.
 * - AGE-07 y AGE-08: lista de bloqueos y aperturas vigentes, para crearlos y
 *   quitarlos.
 * - MKT-02: desde una ausencia, "Citas afectadas" abre la reprogramación.
 *
 * Solo owner y admin (`settings:manage`); la RLS de las tablas exige lo mismo
 * (`can_manage_clinic`).
 */
export const Route = createFileRoute("/_authenticated/_clinic/configuracion-de-agenda")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Configuración de la agenda | Esmalia" },
      {
        name: "description",
        content:
          "Intervalo de la grilla, duración de las citas, sobrecupos, horario de atención y bloqueos de la agenda.",
      },
    ],
  }),
  component: ConfiguracionDeAgendaPage,
});

function ConfiguracionDeAgendaPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  return (
    <AppShell title="Configuración de la agenda" access={access}>
      {clinicId ? (
        <div className="space-y-8">
          <AjustesDeLaGrilla clinicId={clinicId} />
          <HorarioDeAtencion clinicId={clinicId} />
          <BloqueosYAperturas
            clinicId={clinicId}
            clinicName={access.clinic?.name}
            hoy={hoyISO(access.clinic?.timezone)}
            puedeMover={hasPermission(access, "agenda:manage")}
          />
        </div>
      ) : null}
    </AppShell>
  );
}

// ─── Grilla y citas ──────────────────────────────────────────────────────

function AjustesDeLaGrilla({ clinicId }: { clinicId: string }) {
  const fid = useId();
  const ajustes = useAjustesAgenda(clinicId);
  const [paso, setPaso] = useState<IntervaloGrilla>(ajustes.pasoMin);
  const [duracion, setDuracion] = useState(String(ajustes.duracionPorDefecto));
  const [sobrecupos, setSobrecupos] = useState(ajustes.permiteSobrecupos);

  // Cuando llegan los ajustes guardados, el formulario los muestra.
  useEffect(() => {
    setPaso(ajustes.pasoMin);
    setDuracion(String(ajustes.duracionPorDefecto));
    setSobrecupos(ajustes.permiteSobrecupos);
  }, [ajustes]);

  const queryClient = useQueryClient();
  const guardarFn = useServerFn(saveAgendaSettings);
  const guardar = useMutation({
    mutationFn: () =>
      guardarFn({
        data: {
          clinicId,
          pasoMin: paso,
          duracionPorDefecto: Number(duracion),
          permiteSobrecupos: sobrecupos,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: claveAjustesAgenda(clinicId) });
      toast.success("Configuración de la agenda guardada.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const n = Number(duracion);
  const problema =
    !Number.isInteger(n) || n < 5 || n > 480
      ? "La duración tiene que ser de 5 a 480 minutos."
      : null;

  return (
    <section aria-labelledby={`${fid}-titulo`} className="space-y-4">
      <div>
        <h2 id={`${fid}-titulo`} className="kicker">
          Grilla y citas
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cómo se ve la agenda y con qué valores arranca una cita nueva.
        </p>
      </div>
      <div className="card-clinical space-y-5 p-4 md:p-5">
        <div className="space-y-1.5">
          <p id={`${fid}-paso-etiqueta`} className="text-sm font-medium leading-none">
            Intervalo de la grilla
          </p>
          <GrupoDeChips
            id={`${fid}-paso`}
            etiqueta="Intervalo de la grilla"
            opciones={INTERVALOS_GRILLA.map((m) => ({ value: String(m), label: `${m} min` }))}
            value={String(paso)}
            onChange={(v) => v && setPaso(Number(v) as IntervaloGrilla)}
          />
          <p className="text-xs text-muted-foreground">
            Cada cuántos minutos la grilla del día ofrece un espacio para agendar con un clic.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-duracion`}>Duración por defecto de una cita</Label>
          <div className="flex items-center gap-2">
            <input
              id={`${fid}-duracion`}
              type="number"
              inputMode="numeric"
              min={5}
              max={480}
              step={5}
              value={duracion}
              onChange={(e) => setDuracion(e.target.value)}
              className={cn(CLASE_CAMPO, "w-28")}
            />
            <span className="text-xs text-muted-foreground">minutos</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Si eliges un procedimiento con duración en el arancel, manda la del procedimiento.
          </p>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={sobrecupos}
            onChange={(e) => setSobrecupos(e.target.checked)}
          />
          <span>
            <span className="font-medium">Permitir sobrecupos</span>
            <span className="block text-xs text-muted-foreground">
              Dos citas del mismo profesional a la misma hora. Si lo apagas, la agenda no deja
              guardar una cita que choque con otra del mismo profesional.
            </span>
          </span>
        </label>

        <div className="flex justify-end">
          <BloqueoEscritura otroMotivo={problema}>
            <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
              {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Guardar
            </Button>
          </BloqueoEscritura>
        </div>
      </div>
    </section>
  );
}

// ─── Horario de atención por sucursal ────────────────────────────────────

type DiaEditable = { abre: string; cierra: string } | null;

function HorarioDeAtencion({ clinicId }: { clinicId: string }) {
  const fid = useId();
  const fetchSucursales = useServerFn(listBranchesDetailed);
  const sucursalesQ = useQuery({
    queryKey: ["branches-detailed", clinicId],
    queryFn: () => fetchSucursales({ data: { clinicId } }),
  });
  const sucursales = (sucursalesQ.data ?? []).filter((s) => s.isActive);
  const fetchHorario = useServerFn(listBranchHours);
  const horarioQ = useQuery({
    queryKey: claveHorarioSucursales(clinicId),
    queryFn: () => fetchHorario({ data: { clinicId } }),
  });

  const [sucursalId, setSucursalId] = useState("");
  const elegida = sucursales.find((s) => s.id === sucursalId) ?? sucursales[0];
  const [dias, setDias] = useState<Record<number, DiaEditable>>({});

  // Al cambiar de sucursal (o al llegar los datos), se carga su horario.
  useEffect(() => {
    if (!elegida || !horarioQ.data) return;
    const guardado: BloqueSemanal[] = horarioQ.data[elegida.id] ?? [];
    const next: Record<number, DiaEditable> = {};
    for (const d of DIAS_SEMANA) {
      const b = guardado.find((x) => x.dayOfWeek === d.value);
      next[d.value] = b ? { abre: b.startTime, cierra: b.endTime } : null;
    }
    setDias(next);
  }, [elegida, horarioQ.data]);

  const queryClient = useQueryClient();
  const guardarFn = useServerFn(setBranchHours);
  const guardar = useMutation({
    mutationFn: () =>
      guardarFn({
        data: {
          clinicId,
          branchId: elegida!.id,
          bloques: DIAS_SEMANA.filter((d) => dias[d.value]).map((d) => ({
            dayOfWeek: d.value,
            startTime: dias[d.value]!.abre,
            endTime: dias[d.value]!.cierra,
          })),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: claveHorarioSucursales(clinicId) });
      toast.success("Horario de atención guardado.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const hayInvalido = DIAS_SEMANA.some((d) => {
    const b = dias[d.value];
    return b && (!b.abre || !b.cierra || b.abre >= b.cierra);
  });
  const sinDeclarar = DIAS_SEMANA.every((d) => !dias[d.value]);

  return (
    <section aria-labelledby={`${fid}-titulo`} className="space-y-4">
      <div>
        <h2 id={`${fid}-titulo`} className="kicker">
          Horario de atención
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Qué días y a qué hora abre cada sucursal. Fuera de este horario la grilla se ve apagada y
          no ofrece agendar. Sin ningún día marcado, la grilla no sombrea nada.
        </p>
      </div>
      <div className="card-clinical space-y-4 p-4 md:p-5">
        {sucursalesQ.isError || horarioQ.isError ? (
          <ErrorDeCarga
            onReintentar={() => {
              void sucursalesQ.refetch();
              void horarioQ.refetch();
            }}
            mensaje="No pudimos cargar el horario de las sucursales."
          />
        ) : !elegida ? (
          <p className="text-sm text-muted-foreground">Cargando sucursales…</p>
        ) : (
          <>
            {sucursales.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-sucursal`}>Sucursal</Label>
                <select
                  id={`${fid}-sucursal`}
                  value={elegida.id}
                  onChange={(e) => setSucursalId(e.target.value)}
                  className={cn(CLASE_CAMPO, "block max-w-sm")}
                >
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <ul className="space-y-2">
              {DIAS_SEMANA.map((d) => {
                const b = dias[d.value] ?? null;
                return (
                  <li key={d.value} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <label className="flex w-28 shrink-0 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(b)}
                        onChange={(e) =>
                          setDias({
                            ...dias,
                            [d.value]: e.target.checked
                              ? {
                                  abre: elegida.opensAt?.slice(0, 5) || "09:00",
                                  cierra: elegida.closesAt?.slice(0, 5) || "19:00",
                                }
                              : null,
                          })
                        }
                      />
                      {d.label}
                    </label>
                    {b ? (
                      <span className="flex items-center gap-2">
                        <input
                          type="time"
                          aria-label={`${d.label}: abre`}
                          value={b.abre}
                          onChange={(e) =>
                            setDias({ ...dias, [d.value]: { ...b, abre: e.target.value } })
                          }
                          className={cn(CLASE_CAMPO, "w-32")}
                        />
                        <span className="text-xs text-muted-foreground">a</span>
                        <input
                          type="time"
                          aria-label={`${d.label}: cierra`}
                          value={b.cierra}
                          onChange={(e) =>
                            setDias({ ...dias, [d.value]: { ...b, cierra: e.target.value } })
                          }
                          className={cn(CLASE_CAMPO, "w-32")}
                        />
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Cerrado</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {sinDeclarar
                  ? "Sin horario declarado: la agenda no sombrea nada en esta sucursal."
                  : "El horario de cada profesional se configura en Profesionales."}
              </p>
              <BloqueoEscritura
                otroMotivo={
                  hayInvalido ? "Revisa los días: la apertura va antes del cierre." : null
                }
              >
                <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
                  {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Guardar horario
                </Button>
              </BloqueoEscritura>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ─── Bloqueos y aperturas ────────────────────────────────────────────────

function textoCuando(e: ExcepcionAgenda): string {
  const c = cuandoAplica(e);
  if (!c) return "";
  if (c.tipo === "semanal") {
    const hasta = c.hasta ? ` hasta el ${fechaFmt(c.hasta)}` : "";
    return `Cada ${c.dia.toLowerCase()}, ${c.desdeHora}–${c.hastaHora}, desde el ${fechaFmt(c.desde)}${hasta}`;
  }
  if (c.todoElDia) {
    return c.desdeFecha === c.hastaFecha
      ? `${fechaFmt(c.desdeFecha)}, todo el día`
      : `Del ${fechaFmt(c.desdeFecha)} al ${fechaFmt(c.hastaFecha)}, todo el día`;
  }
  return c.desdeFecha === c.hastaFecha
    ? `${fechaFmt(c.desdeFecha)}, ${c.desdeHora}–${c.hastaHora}`
    : `${fechaFmt(c.desdeFecha)} ${c.desdeHora} – ${fechaFmt(c.hastaFecha)} ${c.hastaHora}`;
}

function BloqueosYAperturas({
  clinicId,
  clinicName,
  hoy,
  puedeMover,
}: {
  clinicId: string;
  clinicName: string | undefined;
  hoy: string;
  puedeMover: boolean;
}) {
  const fid = useId();
  const desde = addDaysISO(hoy, -1);
  // Sin `hasta`: todas las vigentes. La consulta comparte la clave base con
  // la agenda, así que crear o quitar acá refresca la grilla.
  const fetchVigentes = useServerFn(listAgendaExceptions);
  const lista = useQuery({
    queryKey: [...claveExcepciones(clinicId), desde, "vigentes"],
    queryFn: () => fetchVigentes({ data: { clinicId, desde } }),
  });

  const fetchProfesionales = useServerFn(listProfessionals);
  const { data: profesionales = [] } = useQuery({
    queryKey: ["professionals", clinicId],
    queryFn: () => fetchProfesionales({ data: { clinicId } }),
  });
  const fetchSucursales = useServerFn(listBranchesDetailed);
  const { data: sucursalesDetalle = [] } = useQuery({
    queryKey: ["branches-detailed", clinicId],
    queryFn: () => fetchSucursales({ data: { clinicId } }),
  });
  const sucursales = sucursalesDetalle
    .filter((s) => s.isActive)
    .map((s) => ({ id: s.id, nombre: s.name }));

  const [modo, setModo] = useState<ModoBloqueo | null>(null);
  const [ausencia, setAusencia] = useState<ExcepcionAgenda | null>(null);

  const queryClient = useQueryClient();
  const quitarFn = useServerFn(deleteAgendaException);
  const quitar = useMutation({
    mutationFn: (exceptionId: string) => quitarFn({ data: { clinicId, exceptionId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: claveExcepciones(clinicId) });
      toast.success("Listo, ya no está en la agenda.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const nombreProfesional = (id: string) =>
    profesionales.find((p) => p.id === id)?.nombre ?? "Profesional";
  const nombreSucursal = (id: string) => sucursales.find((s) => s.id === id)?.nombre ?? "Sucursal";
  const aQuien = (e: ExcepcionAgenda) =>
    e.profesionalId
      ? nombreProfesional(e.profesionalId)
      : e.boxId
        ? `${e.boxNombre ?? "Box"}${e.sucursalId ? ` · ${nombreSucursal(e.sucursalId)}` : ""}`
        : e.sucursalId
          ? `Toda la sucursal ${nombreSucursal(e.sucursalId)}`
          : "Toda la clínica";

  const filas = lista.data ?? [];

  return (
    <section aria-labelledby={`${fid}-titulo`} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`${fid}-titulo`} className="kicker">
            Bloqueos y horarios excepcionales
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Almuerzos, capacitaciones, vacaciones y días que se abren fuera de lo habitual. También
            se crean desde la agenda, con el botón Disponibilidad.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <BloqueoEscritura>
            <Button variant="outline" size="sm" onClick={() => setModo("bloqueo")}>
              <Ban aria-hidden /> Bloquear horario
            </Button>
          </BloqueoEscritura>
          <BloqueoEscritura>
            <Button variant="outline" size="sm" onClick={() => setModo("apertura")}>
              <CalendarPlus aria-hidden /> Abrir horario
            </Button>
          </BloqueoEscritura>
          <BloqueoEscritura>
            <Button variant="outline" size="sm" onClick={() => setModo("ausencia")}>
              <UserX aria-hidden /> Ausencia
            </Button>
          </BloqueoEscritura>
        </div>
      </div>

      <div className="card-clinical overflow-hidden">
        {lista.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
        ) : lista.isError ? (
          <div className="p-4">
            <ErrorDeCarga onReintentar={lista.refetch} mensaje="No pudimos cargar los bloqueos." />
          </div>
        ) : filas.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No hay bloqueos ni horarios excepcionales vigentes.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {filas.map((e) => {
              const esAusencia =
                e.tipo === "bloqueo" &&
                Boolean(e.profesionalId) &&
                Boolean(e.motivo && MOTIVOS_DE_AUSENCIA.has(e.motivo));
              return (
                <li key={e.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="flex items-center gap-1.5 font-medium">
                      {e.tipo === "apertura" ? (
                        <CalendarPlus className="size-3.5 shrink-0 text-brand-700" aria-hidden />
                      ) : (
                        <Ban className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <span className="truncate">{etiquetaExcepcion(e)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {aQuien(e)} · {textoCuando(e)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {esAusencia && (
                      <Button variant="outline" size="sm" onClick={() => setAusencia(e)}>
                        <Users aria-hidden /> Citas afectadas
                      </Button>
                    )}
                    <QuitarExcepcion
                      etiqueta={etiquetaExcepcion(e)}
                      enCurso={quitar.isPending && quitar.variables === e.id}
                      onQuitar={() => quitar.mutate(e.id)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <BloqueoDialog
        clinicId={clinicId}
        modo={modo ?? "bloqueo"}
        open={modo !== null}
        onOpenChange={(o) => !o && setModo(null)}
        sucursales={sucursales}
        profesionales={profesionales.filter((p) => p.atiende !== false)}
        fechaInicial={hoy}
        onAusenciaCreada={setAusencia}
      />
      <ReprogramarAusenciaDialog
        clinicId={clinicId}
        clinicName={clinicName}
        excepcion={ausencia}
        hoy={hoy}
        profesionales={profesionales}
        puedeMover={puedeMover}
        onClose={() => setAusencia(null)}
      />
    </section>
  );
}

function QuitarExcepcion({
  etiqueta,
  enCurso,
  onQuitar,
}: {
  etiqueta: string;
  enCurso: boolean;
  onQuitar: () => void;
}) {
  return (
    <AlertDialog>
      <BloqueoEscritura>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" disabled={enCurso}>
            {enCurso ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Trash2 aria-hidden />
            )}
            Quitar
          </Button>
        </AlertDialogTrigger>
      </BloqueoEscritura>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Quitar «{etiqueta}»?</AlertDialogTitle>
          <AlertDialogDescription>
            La agenda vuelve a mostrar ese horario como antes. Las citas no se tocan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onQuitar}>Quitar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
