import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CalendarClock, CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { EstadoCitaPastilla } from "@/components/estado-cita-pastilla";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSoloLectura } from "@/hooks/use-solo-lectura";
import {
  MAX_CIERRE_POR_TANDA,
  opcionesDeCierre,
  resumenDeCierre,
  textoAvisoCitasPasadas,
  type CambioDeCierre,
  type EstadoDeCierre,
} from "@/lib/clinic-operations/citas-pasadas";
import {
  cerrarCitasPasadas,
  listCitasPasadasSinCerrar,
  type CitaPasadaSinCerrar,
} from "@/lib/clinic-operations/citas-pasadas.functions";
import { listAppointmentStatuses } from "@/lib/clinic-operations/clinic-operations.functions";
import { fechaCortaHora } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { EXPLICACION_BOTON_SOLO_LECTURA } from "@/lib/solo-lectura";
import { cn } from "@/lib/utils";

/** Raíz de las query keys: invalidarla refresca el aviso y la lista. */
const CLAVE = "citas-pasadas";

/**
 * Aviso "Tienes N citas pasadas sin cerrar" (PAN-05, Ola 2) para Hoy y para
 * la Agenda. Es un componente aparte: no toca la grilla. Se muestra solo a
 * quien gestiona la agenda (`agenda:manage`); el servidor vuelve a exigir el
 * mismo permiso.
 *
 * Abre una lista con, por cita, los tres cierres posibles con el nombre que
 * la clínica les dio en "Estados y tipos de cita", más "Marcar todas como
 * atendidas" con vista previa y confirmación (mismo patrón que "Enviar
 * todos" de Recordatorios: nada cambia hasta confirmar).
 */
export function AvisoCitasPasadas({
  clinicId,
  timezone,
  className,
}: {
  clinicId: string;
  timezone: string | undefined;
  className?: string;
}) {
  const fetchTotal = useServerFn(listCitasPasadasSinCerrar);
  const [abierto, setAbierto] = useState(false);
  const { data } = useQuery({
    queryKey: [CLAVE, clinicId, "total"],
    queryFn: () => fetchTotal({ data: { clinicId, soloTotal: true } }),
    // Una cita "pasa" sola con el reloj: se vuelve a contar cada 5 minutos.
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });
  const total = data?.total ?? 0;
  if (total === 0 && !abierto) return null;

  return (
    <>
      <div
        role="status"
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-warning-border bg-warning-soft px-4 py-2.5 text-sm text-warning",
          className,
        )}
      >
        <p className="flex min-w-0 items-center gap-2 font-medium">
          <CalendarClock className="size-4 shrink-0" aria-hidden />
          <span>{textoAvisoCitasPasadas(total)}</span>
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-warning-border bg-background text-foreground"
          onClick={() => setAbierto(true)}
        >
          Revisar y cerrar
        </Button>
      </div>
      <CerrarCitasPasadasDialog
        clinicId={clinicId}
        timezone={timezone}
        abierto={abierto}
        onAbiertoChange={setAbierto}
      />
    </>
  );
}

type Fase = "lista" | "vista-previa";

export function CerrarCitasPasadasDialog({
  clinicId,
  timezone,
  abierto,
  onAbiertoChange,
}: {
  clinicId: string;
  timezone: string | undefined;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const soloLectura = useSoloLectura();
  const fetchLista = useServerFn(listCitasPasadasSinCerrar);
  const fetchEstados = useServerFn(listAppointmentStatuses);
  const cerrar = useServerFn(cerrarCitasPasadas);
  const [fase, setFase] = useState<Fase>("lista");
  // Las que ya se cerraron en esta sesión del diálogo se ocultan al instante,
  // sin esperar a que vuelva la lista.
  const [cerradas, setCerradas] = useState<Set<string>>(new Set());

  const lista = useQuery({
    queryKey: [CLAVE, clinicId, "lista"],
    queryFn: () => fetchLista({ data: { clinicId } }),
    enabled: abierto,
  });
  // Bajo la misma raíz que "Estados y tipos de cita": al editar un estado
  // allá, esto se invalida solo.
  const estados = useQuery({
    queryKey: ["appointment-statuses", clinicId, "activos"],
    queryFn: () => fetchEstados({ data: { clinicId, incluirInactivos: false } }),
    enabled: abierto,
    staleTime: 5 * 60 * 1000,
  });
  const opciones = useMemo(() => opcionesDeCierre(estados.data ?? []), [estados.data]);
  const etiqueta = (estado: EstadoDeCierre) =>
    opciones.find((o) => o.estado === estado)?.etiqueta ?? estado;

  const pendientes = (lista.data?.citas ?? []).filter((c) => !cerradas.has(c.id));
  const totalReal = Math.max(0, (lista.data?.total ?? 0) - cerradas.size);

  const mutacion = useMutation({
    mutationFn: (cambios: CambioDeCierre[]) => cerrar({ data: { clinicId, cambios } }),
    onSuccess: (resultado, cambios) => {
      setCerradas((prev) => {
        const sig = new Set(prev);
        for (const c of cambios) sig.add(c.appointmentId);
        return sig;
      });
      toast.success(resumenDeCierre(resultado.porEstado, resultado.omitidas, opciones));
      void queryClient.invalidateQueries({ queryKey: ["appointments", clinicId] });
      void queryClient.invalidateQueries({ queryKey: [CLAVE, clinicId, "total"] });
      setFase("lista");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  function cambiarAbierto(o: boolean) {
    onAbiertoChange(o);
    if (!o) {
      setFase("lista");
      setCerradas(new Set());
      void queryClient.invalidateQueries({ queryKey: [CLAVE, clinicId] });
    }
  }

  const motivoSoloLectura = soloLectura ? EXPLICACION_BOTON_SOLO_LECTURA : null;
  const atendida = etiqueta("finalizada");

  return (
    <Dialog open={abierto} onOpenChange={cambiarAbierto}>
      <DialogContent className="max-w-2xl grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>
            {fase === "lista" ? "Citas pasadas sin cerrar" : `Marcar todas como «${atendida}»`}
          </DialogTitle>
          <DialogDescription>
            {fase === "lista"
              ? "Ya terminaron y siguen sin respuesta, confirmadas o en sala. Indica qué pasó con cada una para que la asistencia y los reportes cuenten bien."
              : "Revisa la lista antes de confirmar. Nada cambia hasta que lo confirmes."}
          </DialogDescription>
        </DialogHeader>

        {lista.isLoading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando citas…
          </p>
        ) : lista.isError ? (
          <p className="py-6 text-sm text-destructive">{mensajeDeError(lista.error as Error)}</p>
        ) : pendientes.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No quedan citas pasadas sin cerrar. Buen trabajo.
          </p>
        ) : fase === "lista" ? (
          <div className="space-y-2">
            <ul className="max-h-[min(60vh,28rem)] divide-y divide-hairline overflow-y-auto rounded-md border border-hairline">
              {pendientes.map((c) => (
                <FilaCitaPasada
                  key={c.id}
                  cita={c}
                  timezone={timezone}
                  opciones={opciones}
                  ocupada={
                    mutacion.isPending &&
                    (mutacion.variables ?? []).some((v) => v.appointmentId === c.id)
                  }
                  deshabilitada={mutacion.isPending}
                  motivoSoloLectura={motivoSoloLectura}
                  onCerrar={(estado) => mutacion.mutate([{ appointmentId: c.id, estado }])}
                />
              ))}
            </ul>
            {totalReal > pendientes.length && (
              <p className="text-xs text-muted-foreground">
                Se muestran las {MAX_CIERRE_POR_TANDA} más antiguas de {totalReal}. Al cerrarlas
                aparecen las siguientes.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              {pendientes.length === 1
                ? `1 cita pasa a «${atendida}».`
                : `${pendientes.length} citas pasan a «${atendida}».`}{" "}
              Si alguien faltó o se canceló, vuelve atrás y márcalo en su fila.
            </p>
            <ul className="max-h-[min(50vh,22rem)] divide-y divide-hairline overflow-y-auto rounded-md border border-hairline">
              {pendientes.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate text-sm font-medium">{c.paciente}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {fechaCortaHora(c.inicio, timezone)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {fase === "lista" ? (
            <>
              <Button type="button" variant="ghost" onClick={() => cambiarAbierto(false)}>
                Cerrar
              </Button>
              {pendientes.length > 0 && (
                <AccionDeshabilitada motivo={motivoSoloLectura} como="globo">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={mutacion.isPending}
                    onClick={() => setFase("vista-previa")}
                  >
                    <CheckCheck aria-hidden />
                    Marcar todas como «{atendida}» ({pendientes.length})
                  </Button>
                </AccionDeshabilitada>
              )}
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={mutacion.isPending}
                onClick={() => setFase("lista")}
              >
                <ArrowLeft aria-hidden /> Volver
              </Button>
              <AccionDeshabilitada motivo={motivoSoloLectura} como="globo">
                <Button
                  type="button"
                  disabled={mutacion.isPending || pendientes.length === 0}
                  onClick={() =>
                    mutacion.mutate(
                      pendientes.map((c) => ({
                        appointmentId: c.id,
                        estado: "finalizada" as const,
                      })),
                    )
                  }
                >
                  {mutacion.isPending && <Loader2 className="animate-spin" aria-hidden />}
                  Confirmar ({pendientes.length})
                </Button>
              </AccionDeshabilitada>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilaCitaPasada({
  cita,
  timezone,
  opciones,
  ocupada,
  deshabilitada,
  motivoSoloLectura,
  onCerrar,
}: {
  cita: CitaPasadaSinCerrar;
  timezone: string | undefined;
  opciones: ReturnType<typeof opcionesDeCierre>;
  ocupada: boolean;
  deshabilitada: boolean;
  motivoSoloLectura: string | null;
  onCerrar: (estado: EstadoDeCierre) => void;
}) {
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link
          to="/pacientes/$pacienteId"
          params={{ pacienteId: cita.pacienteId }}
          className="block truncate text-sm font-medium hover:text-brand-700"
        >
          {cita.paciente}
        </Link>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{fechaCortaHora(cita.inicio, timezone)}</span>
          <span aria-hidden>·</span>
          <span className="truncate">
            {cita.tratamiento}
            {cita.profesional ? ` · ${cita.profesional}` : ""}
          </span>
          <EstadoCitaPastilla cita={{ estado: cita.estado }} />
        </p>
      </div>
      <div
        role="group"
        aria-label={`Cerrar la cita de ${cita.paciente}`}
        className="flex shrink-0 flex-wrap gap-1.5"
      >
        {ocupada ? (
          <span className="flex h-8 items-center gap-2 px-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Guardando…
          </span>
        ) : (
          opciones.map((o) => (
            <AccionDeshabilitada key={o.estado} motivo={motivoSoloLectura} como="globo">
              <Button
                type="button"
                size="sm"
                variant={o.estado === "finalizada" ? "outline" : "ghost"}
                className={cn(
                  o.estado === "ausente" && "text-destructive",
                  o.estado === "cancelada" && "text-muted-foreground",
                )}
                disabled={deshabilitada}
                onClick={() => onCerrar(o.estado)}
              >
                {o.etiqueta}
              </Button>
            </AccionDeshabilitada>
          ))
        )}
      </div>
    </li>
  );
}
