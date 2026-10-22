import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  claveHorarioSucursales,
  useAjustesAgenda,
  useExcepcionesAgenda,
  useHorariosProfesionales,
} from "@/hooks/use-disponibilidad-agenda";
import { addDaysISO } from "@/lib/clinic-operations/agenda-fechas";
import { listAppointments, moveAppointment } from "@/lib/clinic-operations/appointments.functions";
import {
  formatoFechaLarga,
  type Cita,
  type Profesional,
} from "@/lib/clinic-operations/clinic-data";
import {
  citasAfectadas,
  etiquetaExcepcion,
  hhmmDeMinutos,
  rangoDeExcepcion,
  startsAtDeSugerencia,
  sucursalesPorProfesional,
  sugerirReprogramaciones,
  type ExcepcionAgenda,
  type Sugerencia,
} from "@/lib/clinic-operations/disponibilidad";
import { listBranchHours } from "@/lib/clinic-operations/disponibilidad.functions";
import { sendWhatsAppFromTemplate } from "@/lib/messaging/messaging.functions";
import { fecha as fechaFmt } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Reprogramación masiva por ausencia (MKT-02).
 *
 * Cuando un profesional se ausenta (bloqueo de vacaciones o ausencia), lista
 * las citas por confirmar y confirmadas que pisa y, para cada una, propone
 * dónde moverla (`sugerirReprogramaciones`: otro profesional libre a la misma
 * hora, o el primer horario libre del mismo profesional). Quien despacha:
 *
 * - revisa la vista previa y elige cuáles mover; al confirmar, cada una pasa
 *   por `moveAppointment` (las mismas validaciones del arrastre);
 * - por cada paciente, aprieta el botón de WhatsApp: con la cita movida va
 *   la plantilla de reprogramación con la hora nueva; sin mover, un mensaje
 *   pidiéndole que elija otro horario. Nada sale solo: cada mensaje es un
 *   clic, y el servidor respeta la baja del paciente.
 */

/** Ventana de búsqueda de horarios libres después de la ausencia. */
const DIAS_DE_BUSQUEDA = 14;

type EstadoFila =
  { estado: "movida"; sugerencia: Sugerencia } | { estado: "error"; mensaje: string };

export function ReprogramarAusenciaDialog({
  clinicId,
  clinicName,
  excepcion,
  hoy,
  profesionales,
  puedeMover,
  onClose,
}: {
  clinicId: string;
  clinicName: string | undefined;
  /** null = cerrado. */
  excepcion: ExcepcionAgenda | null;
  /** Hoy de la clínica (`hoyISO(timezone)`): no se reprograma lo que ya pasó. */
  hoy: string;
  profesionales: readonly Profesional[];
  /** `agenda:manage`: el servidor lo repite en `moveAppointment`. */
  puedeMover: boolean;
  onClose: () => void;
}) {
  const open = Boolean(excepcion);
  const rango = excepcion ? rangoDeExcepcion(excepcion, hoy) : null;
  const desde = rango?.[0] ?? "";
  const hastaVentana = rango ? addDaysISO(rango[1], DIAS_DE_BUSQUEDA) : "";

  const fetchCitas = useServerFn(listAppointments);
  const citasQ = useQuery({
    queryKey: ["appointments-rango", clinicId, desde, hastaVentana],
    enabled: open && Boolean(rango),
    // Foto fija mientras el diálogo está abierto: después de mover, las citas
    // tienen que seguir en la lista para ofrecer "Avisar el cambio". Al
    // cerrar se descarta (ver `cerrar`).
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: () => fetchCitas({ data: { clinicId, desde, hasta: hastaVentana } }),
  });
  const horarios = useHorariosProfesionales(clinicId, open);
  const excepciones = useExcepcionesAgenda(clinicId, desde, hastaVentana, open && Boolean(rango));
  const ajustes = useAjustesAgenda(clinicId);
  const fetchHorarioSucursales = useServerFn(listBranchHours);
  const { data: horarioSucursal } = useQuery({
    queryKey: claveHorarioSucursales(clinicId),
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: () => fetchHorarioSucursales({ data: { clinicId } }),
  });

  const nombre = (id: string) => profesionales.find((p) => p.id === id)?.nombre ?? "Profesional";

  const { afectadas, sugerencias } = useMemo(() => {
    if (!excepcion || !citasQ.data) {
      return { afectadas: [] as Cita[], sugerencias: new Map<string, Sugerencia | null>() };
    }
    const citas = citasQ.data.items;
    // La excepción recién creada puede no estar todavía en la consulta.
    const todas = excepciones.some((e) => e.id === excepcion.id)
      ? excepciones
      : [...excepciones, excepcion];
    const sucursales = sucursalesPorProfesional(horarios ?? {});
    const lista = citasAfectadas(excepcion, citas, sucursales).filter((c) => c.fecha >= hoy);
    return {
      afectadas: lista,
      sugerencias: sugerirReprogramaciones(lista, {
        profesionales,
        horarios: horarios ?? {},
        horarioSucursal: horarioSucursal ?? {},
        citas,
        excepciones: todas,
        paso: ajustes.pasoMin,
        diasHaciaAdelante: DIAS_DE_BUSQUEDA,
      }),
    };
  }, [excepcion, citasQ.data, excepciones, horarios, horarioSucursal, profesionales, ajustes, hoy]);

  const [seleccion, setSeleccion] = useState<Set<string> | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [resultados, setResultados] = useState<Map<string, EstadoFila>>(new Map());

  // Por defecto, todas las que tienen sugerencia.
  const elegidas =
    seleccion ?? new Set(afectadas.filter((c) => sugerencias.get(c.id)).map((c) => c.id));
  const aMover = afectadas.filter(
    (c) => elegidas.has(c.id) && sugerencias.get(c.id) && resultados.get(c.id)?.estado !== "movida",
  );

  const queryClient = useQueryClient();
  const moverFn = useServerFn(moveAppointment);
  const mover = useMutation({
    mutationFn: async () => {
      const nuevos = new Map(resultados);
      // De a una, en orden: cada movimiento pasa por las mismas validaciones
      // que el arrastre y un rechazo no frena a las demás.
      for (const c of aMover) {
        const s = sugerencias.get(c.id)!;
        try {
          await moverFn({
            data: {
              appointmentId: c.id,
              clinicId,
              professionalId: s.profesionalId,
              startsAt: startsAtDeSugerencia(s),
            },
          });
          nuevos.set(c.id, { estado: "movida", sugerencia: s });
        } catch (e) {
          nuevos.set(c.id, { estado: "error", mensaje: mensajeDeError(e) });
        }
        setResultados(new Map(nuevos));
      }
      return nuevos;
    },
    onSuccess: (nuevos) => {
      const ok = [...nuevos.values()].filter((r) => r.estado === "movida").length;
      const fallidas = aMover.filter((c) => nuevos.get(c.id)?.estado === "error").length;
      void queryClient.invalidateQueries({ queryKey: ["appointments", clinicId] });
      setConfirmando(false);
      if (fallidas > 0) toast.warning(`Se movieron ${ok} citas; ${fallidas} no se pudieron mover.`);
      else toast.success(`Se movieron ${ok} citas. Ahora puedes avisar a cada paciente.`);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  function cerrar() {
    queryClient.removeQueries({ queryKey: ["appointments-rango", clinicId] });
    setSeleccion(null);
    setConfirmando(false);
    setResultados(new Map());
    onClose();
  }

  function alternar(id: string) {
    const nueva = new Set(elegidas);
    if (nueva.has(id)) nueva.delete(id);
    else nueva.add(id);
    setSeleccion(nueva);
  }

  const motivoMover = !puedeMover
    ? "Mover citas requiere permiso para gestionar la agenda."
    : aMover.length === 0
      ? "Elige al menos una cita con horario sugerido."
      : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && cerrar()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Citas afectadas por la ausencia</DialogTitle>
          <DialogDescription>
            {excepcion
              ? `${nombre(excepcion.profesionalId ?? "")} · ${etiquetaExcepcion(excepcion)}. `
              : ""}
            Revisa la propuesta, mueve las que quieras y avisa a cada paciente por WhatsApp. Nada se
            envía solo.
          </DialogDescription>
        </DialogHeader>

        {citasQ.isLoading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Buscando citas afectadas…
          </p>
        ) : citasQ.isError ? (
          <p className="py-6 text-sm text-destructive">No pudimos cargar las citas.</p>
        ) : afectadas.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No hay citas por confirmar ni confirmadas en ese horario. No hay nada que mover.
          </p>
        ) : (
          <ul className="divide-y divide-hairline rounded-lg border border-hairline">
            {afectadas.map((c) => {
              const s = sugerencias.get(c.id) ?? null;
              const r = resultados.get(c.id);
              const movida = r?.estado === "movida" ? r.sugerencia : null;
              const idCheck = `reprogramar-${c.id}`;
              return (
                <li key={c.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <input
                      id={idCheck}
                      type="checkbox"
                      className="mt-1"
                      checked={elegidas.has(c.id) && Boolean(s)}
                      disabled={!s || Boolean(movida) || mover.isPending}
                      onChange={() => alternar(c.id)}
                    />
                    <label htmlFor={idCheck} className="min-w-0 text-sm">
                      <span className="block truncate font-medium">{c.paciente}</span>
                      <span className="block text-xs text-muted-foreground">
                        <span className="cifra">
                          {fechaFmt(c.fecha)} · {hhmmDeMinutos(c.inicio)}
                        </span>{" "}
                        · {c.tratamiento}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 flex items-center gap-1 text-xs",
                          movida ? "text-success" : s ? "text-foreground" : "text-warning",
                        )}
                      >
                        {movida ? (
                          <Check className="size-3 shrink-0" aria-hidden />
                        ) : (
                          s && <ArrowRight className="size-3 shrink-0" aria-hidden />
                        )}
                        {movida
                          ? `Movida: ${fechaFmt(movida.fecha)} ${hhmmDeMinutos(movida.inicio)} con ${nombre(movida.profesionalId)}`
                          : s
                            ? `${s.tipo === "otro-profesional" ? "Misma hora con" : "Con"} ${nombre(s.profesionalId)}, ${fechaFmt(s.fecha)} ${hhmmDeMinutos(s.inicio)}`
                            : "Sin horario libre cerca: coordínalo con el paciente."}
                      </span>
                      {r?.estado === "error" && (
                        <span className="mt-0.5 block text-xs text-destructive">{r.mensaje}</span>
                      )}
                    </label>
                  </div>
                  <div className="shrink-0 sm:pl-2">
                    {movida && clinicName ? (
                      <WhatsAppButton
                        variant="full"
                        label="Avisar el cambio"
                        clinicId={clinicId}
                        patientId={c.pacienteId}
                        appointmentId={c.id}
                        templateKind="appointment_rescheduled"
                        variables={{
                          clinica: clinicName,
                          fecha_larga: formatoFechaLarga(movida.fecha),
                          hora: hhmmDeMinutos(movida.inicio),
                          profesional: nombre(movida.profesionalId),
                        }}
                      />
                    ) : (
                      !movida && (
                        <PedirReagendar
                          clinicId={clinicId}
                          clinicName={clinicName}
                          cita={c}
                          profesional={nombre(c.profesionalId)}
                        />
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {confirmando && aMover.length > 0 && (
          <div
            role="alert"
            className="rounded-lg border border-warning-border/60 bg-warning-soft px-3 py-2 text-xs text-warning"
          >
            <p className="font-semibold">
              Se van a mover {aMover.length} {aMover.length === 1 ? "cita" : "citas"}.
            </p>
            <p className="mt-0.5 text-foreground/80">
              Los pacientes no reciben ningún mensaje automático: después de moverlas, avísale a
              cada uno con su botón de WhatsApp.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={cerrar}>
            Cerrar
          </Button>
          {confirmando ? (
            <Button onClick={() => mover.mutate()} disabled={mover.isPending}>
              {mover.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Confirmar y mover
            </Button>
          ) : (
            afectadas.some(
              (c) => sugerencias.get(c.id) && resultados.get(c.id)?.estado !== "movida",
            ) && (
              <AccionDeshabilitada motivo={motivoMover}>
                <Button onClick={() => setConfirmando(true)}>
                  Mover {aMover.length > 0 ? aMover.length : ""} a lo sugerido
                </Button>
              </AccionDeshabilitada>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * WhatsApp para una cita que no se movió: le pide al paciente que elija otro
 * horario. Va como texto libre por wa.me (no hay plantilla aprobada para
 * esto); el servidor respeta la baja y lo deja en el historial de mensajes.
 */
function PedirReagendar({
  clinicId,
  clinicName,
  cita,
  profesional,
}: {
  clinicId: string;
  clinicName: string | undefined;
  cita: Cita;
  profesional: string;
}) {
  const queryClient = useQueryClient();
  const enviarFn = useServerFn(sendWhatsAppFromTemplate);
  const enviar = useMutation({
    mutationFn: () =>
      enviarFn({
        data: {
          clinicId,
          patientId: cita.pacienteId,
          appointmentId: cita.id,
          rawBody:
            `Hola {paciente}, ${profesional} no podrá atenderte el ${formatoFechaLarga(cita.fecha)} ` +
            `a las ${hhmmDeMinutos(cita.inicio)}. ¿Qué otro día y hora te acomodan? ` +
            `Respóndenos por acá y te reagendamos.${clinicName ? ` — ${clinicName}` : ""}`,
        },
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["messages", clinicId, cita.pacienteId] });
      if (r.viaApi) {
        toast.success("Mensaje enviado por WhatsApp.");
        return;
      }
      if (!r.waUrl) {
        toast.error("No pudimos armar el link (¿el paciente tiene teléfono válido?).");
        return;
      }
      window.open(r.waUrl, "_blank", "noopener,noreferrer");
      toast.success("Mensaje registrado y abierto en WhatsApp.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  return (
    <button
      type="button"
      onClick={() => enviar.mutate()}
      disabled={enviar.isPending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium transition-colors hover:border-brand hover:text-brand-700 disabled:opacity-50 pointer-coarse:min-h-11"
    >
      {enviar.isPending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <MessageCircle className="size-3.5" aria-hidden />
      )}
      Pedir reagendar
    </button>
  );
}
