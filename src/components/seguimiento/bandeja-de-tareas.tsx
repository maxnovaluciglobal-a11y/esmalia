import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Clock, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { ChipFiltro } from "@/components/a-plus/lista";
import { BloqueoEscritura } from "@/components/solo-lectura";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BOTON_FILA, Chip, PanelLista, Vacio } from "@/components/seguimiento/piezas";
import type { MiembroAsignable } from "@/components/seguimiento/nueva-tarea-dialog";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import type { PresupuestoSinRespuesta } from "@/lib/messaging/presupuestos-sin-respuesta";
import { diasEntre } from "@/lib/seguimiento/controles";
import { actualizarTarea, crearTarea } from "@/lib/seguimiento/seguimiento.functions";
import {
  agruparBandeja,
  ETIQUETA_TIPO_TAREA,
  fechaAlPosponer,
  filtrarPorPersona,
  OPCIONES_POSPONER,
  type CambioDeTarea,
  type FiltroPersona,
  type OpcionPosponer,
  type Tarea,
} from "@/lib/seguimiento/tareas";
import { cn } from "@/lib/utils";

/**
 * CRM-02 · Bandeja de tareas por persona: vencidas, hoy y próximas, con
 * completar, posponer, asignar y descartar. Abajo, las sugerencias que ya
 * calcula Esmalia (presupuestos sin respuesta) para volverlas tarea con un
 * clic: lo mismo que /recordatorios, sin duplicar la regla.
 */
export function BandejaDeTareas({
  clinicId,
  userId,
  hoy,
  zona,
  tareas,
  miembros,
  presupuestos,
  onCambio,
  onNueva,
}: {
  clinicId: string;
  userId: string;
  hoy: string;
  zona: string;
  tareas: readonly Tarea[];
  miembros: readonly MiembroAsignable[];
  presupuestos: readonly PresupuestoSinRespuesta[];
  onCambio: () => void;
  onNueva: () => void;
}) {
  const [persona, setPersona] = useState<FiltroPersona>("mias");
  const visibles = useMemo(
    () => filtrarPorPersona(tareas, persona, userId),
    [tareas, persona, userId],
  );
  const grupos = useMemo(() => agruparBandeja(visibles, hoy), [visibles, hoy]);
  const cerradas = visibles.filter((t) => t.status !== "pendiente");
  const conteoPersona = (f: FiltroPersona) =>
    filtrarPorPersona(tareas, f, userId).filter((t) => t.status === "pendiente").length;

  const cambiar = useServerFn(actualizarTarea);
  const mutacion = useMutation({
    mutationFn: (v: { tareaId: string; cambio: CambioDeTarea }) =>
      cambiar({ data: { clinicId, tareaId: v.tareaId, cambio: v.cambio } }),
    onSuccess: (_r, v) => {
      const textos: Record<string, string> = {
        completar: "Tarea hecha.",
        descartar: "Tarea descartada.",
        reabrir: "Tarea reabierta.",
        posponer: "Tarea pospuesta.",
        asignar: "Tarea asignada.",
      };
      toast.success(textos[v.cambio.accion] ?? "Listo.");
      onCambio();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const nombres = new Map(miembros.map((m) => [m.userId, m.nombre]));
  const conTarea = new Set(tareas.filter((t) => t.status === "pendiente").map((t) => t.quoteId));
  const sugerencias = presupuestos.filter((p) => !conTarea.has(p.quoteId));

  const fila = (t: Tarea) => (
    <FilaTarea
      key={t.id}
      tarea={t}
      hoy={hoy}
      zona={zona}
      userId={userId}
      miembros={miembros}
      nombreAsignada={t.assignedTo ? (nombres.get(t.assignedTo) ?? t.assignedName) : null}
      ocupado={mutacion.isPending && mutacion.variables?.tareaId === t.id}
      onAccion={(cambio) => mutacion.mutate({ tareaId: t.id, cambio })}
    />
  );

  return (
    <div className="space-y-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="De quién" className="flex flex-wrap gap-1.5">
          {(
            [
              ["mias", "Mías"],
              ["todas", "Todo el equipo"],
              ["sin_asignar", "Sin asignar"],
            ] as const
          ).map(([id, label]) => (
            <ChipFiltro key={id} activo={persona === id} onClick={() => setPersona(id)}>
              {label}
              <span className="cifra text-[11px] opacity-75">{conteoPersona(id)}</span>
            </ChipFiltro>
          ))}
        </div>
        <BloqueoEscritura>
          <button type="button" onClick={onNueva} className={BOTON_FILA}>
            <Plus className="size-3.5" aria-hidden /> Nueva tarea
          </button>
        </BloqueoEscritura>
      </div>

      {grupos.vencidas.length + grupos.hoy.length + grupos.proximas.length === 0 && (
        <p className="rounded-[14px] border border-hairline bg-card px-5 py-6 text-sm text-muted-foreground">
          {persona === "mias"
            ? "No tienes tareas pendientes. Mira «Todo el equipo» o crea una."
            : "No hay tareas pendientes en esta vista."}
        </p>
      )}

      {grupos.vencidas.length > 0 && (
        <PanelLista titulo="Vencidas" conteo={grupos.vencidas.length}>
          <ul className="divide-y divide-hairline">{grupos.vencidas.map(fila)}</ul>
        </PanelLista>
      )}
      {grupos.hoy.length > 0 && (
        <PanelLista titulo="Para hoy" conteo={grupos.hoy.length}>
          <ul className="divide-y divide-hairline">{grupos.hoy.map(fila)}</ul>
        </PanelLista>
      )}
      {grupos.proximas.length > 0 && (
        <PanelLista titulo="Próximas" conteo={grupos.proximas.length}>
          <ul className="divide-y divide-hairline">{grupos.proximas.map(fila)}</ul>
        </PanelLista>
      )}

      <SugerenciasDePresupuestos
        clinicId={clinicId}
        hoy={hoy}
        userId={userId}
        sugerencias={sugerencias}
        onCreada={onCambio}
      />

      {cerradas.length > 0 && (
        <PanelLista titulo="Cerradas esta semana" conteo={cerradas.length}>
          <ul className="divide-y divide-hairline">{cerradas.map(fila)}</ul>
        </PanelLista>
      )}
    </div>
  );
}

function FilaTarea({
  tarea: t,
  hoy,
  zona,
  userId,
  miembros,
  nombreAsignada,
  ocupado,
  onAccion,
}: {
  tarea: Tarea;
  hoy: string;
  zona: string;
  userId: string;
  miembros: readonly MiembroAsignable[];
  nombreAsignada: string | null;
  ocupado: boolean;
  onAccion: (cambio: CambioDeTarea) => void;
}) {
  const pendiente = t.status === "pendiente";
  const atraso = diasEntre(t.dueOn, hoy);
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        {pendiente ? (
          <BloqueoEscritura>
            <button
              type="button"
              onClick={() => onAccion({ accion: "completar" })}
              disabled={ocupado}
              aria-label={`Marcar hecha: ${t.title}`}
              title="Marcar hecha"
              className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border-2 border-control outline-none hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:size-11"
            >
              {ocupado ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="size-3.5 opacity-0 hover:opacity-60" aria-hidden />
              )}
            </button>
          </BloqueoEscritura>
        ) : (
          <span
            aria-hidden
            className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-foreground text-background"
          >
            {t.status === "hecha" ? <Check className="size-3.5" /> : <X className="size-3.5" />}
          </span>
        )}
        <div className="min-w-0">
          <p
            className={cn(
              "text-[15px] font-semibold leading-snug",
              !pendiente && "text-muted-foreground line-through",
            )}
          >
            {t.title}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <Chip tono="tenue">{ETIQUETA_TIPO_TAREA[t.kind]}</Chip>
            {t.patientId && t.patientName && (
              <Link
                to="/pacientes/$pacienteId"
                params={{ pacienteId: t.patientId }}
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                {t.patientName}
              </Link>
            )}
            {t.patientPhone && <span className="cifra">{t.patientPhone}</span>}
            {pendiente ? (
              <span className={cn(atraso > 0 && "font-semibold text-destructive")}>
                {atraso > 0
                  ? `Venció hace ${atraso} ${atraso === 1 ? "día" : "días"}`
                  : atraso === 0
                    ? "Vence hoy"
                    : `Vence el ${fecha(t.dueOn, zona)}`}
              </span>
            ) : (
              <span>{t.status === "hecha" ? "Hecha" : "Descartada"}</span>
            )}
            <span>· {nombreAsignada ? `Asignada a ${nombreAsignada}` : "Sin asignar"}</span>
            {t.postponedCount > 0 && (
              <span>
                · pospuesta {t.postponedCount} {t.postponedCount === 1 ? "vez" : "veces"}
              </span>
            )}
          </p>
          {t.notes && <p className="mt-1 text-sm">{t.notes}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-10 sm:pl-0">
        {pendiente ? (
          <>
            <DropdownMenu modal={false}>
              <BloqueoEscritura>
                <DropdownMenuTrigger className={BOTON_FILA} disabled={ocupado}>
                  <Clock className="size-3.5" aria-hidden /> Posponer
                </DropdownMenuTrigger>
              </BloqueoEscritura>
              <DropdownMenuContent align="end">
                {OPCIONES_POSPONER.map((o) => (
                  <DropdownMenuItem
                    key={o.id}
                    onSelect={() =>
                      onAccion({
                        accion: "posponer",
                        fecha: fechaAlPosponer(t.dueOn, hoy, o.id as OpcionPosponer),
                      })
                    }
                  >
                    {o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu modal={false}>
              <BloqueoEscritura>
                <DropdownMenuTrigger className={BOTON_FILA} disabled={ocupado}>
                  Asignar
                </DropdownMenuTrigger>
              </BloqueoEscritura>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuLabel>Asignar a</DropdownMenuLabel>
                {miembros.map((m) => (
                  <DropdownMenuItem
                    key={m.userId}
                    onSelect={() => onAccion({ accion: "asignar", userId: m.userId })}
                  >
                    {m.userId === userId ? `${m.nombre} (tú)` : m.nombre}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onAccion({ accion: "asignar", userId: null })}>
                  Sin asignar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <BloqueoEscritura>
              <button
                type="button"
                onClick={() => onAccion({ accion: "descartar" })}
                disabled={ocupado}
                className={BOTON_FILA}
                aria-label={`Descartar: ${t.title}`}
              >
                <X className="size-3.5" aria-hidden /> Descartar
              </button>
            </BloqueoEscritura>
          </>
        ) : (
          <BloqueoEscritura>
            <button
              type="button"
              onClick={() => onAccion({ accion: "reabrir" })}
              disabled={ocupado}
              className={BOTON_FILA}
            >
              <RotateCcw className="size-3.5" aria-hidden /> Reabrir
            </button>
          </BloqueoEscritura>
        )}
      </div>
    </li>
  );
}

function SugerenciasDePresupuestos({
  clinicId,
  hoy,
  userId,
  sugerencias,
  onCreada,
}: {
  clinicId: string;
  hoy: string;
  userId: string;
  sugerencias: readonly PresupuestoSinRespuesta[];
  onCreada: () => void;
}) {
  const crear = useServerFn(crearTarea);
  const mutacion = useMutation({
    mutationFn: (p: PresupuestoSinRespuesta) =>
      crear({
        data: {
          clinicId,
          titulo: `Seguimiento del presupuesto ${p.quoteNumber}`,
          notas: null,
          tipo: "presupuesto",
          patientId: p.patientId,
          quoteId: p.quoteId,
          controlId: null,
          asignarA: userId,
          fecha: hoy,
        },
      }),
    onSuccess: (r) => {
      toast.success(r.yaExistia ? "Ese presupuesto ya tenía una tarea abierta." : "Tarea creada.");
      onCreada();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (sugerencias.length === 0) return null;
  return (
    <PanelLista
      titulo="Presupuestos sin respuesta"
      conteo={sugerencias.length}
      descripcion="Sugeridos por Esmalia. Vuélvelos tarea para que alguien los llame, o escríbeles desde Recordatorios."
      acciones={
        <Link to="/recordatorios" className={BOTON_FILA}>
          Ir a Recordatorios
        </Link>
      }
    >
      {sugerencias.length === 0 ? (
        <Vacio>Nada por ahora.</Vacio>
      ) : (
        <ul className="divide-y divide-hairline">
          {sugerencias.slice(0, 20).map((p) => (
            <li
              key={p.quoteId}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
            >
              <div className="min-w-0">
                <Link
                  to="/pacientes/$pacienteId"
                  params={{ pacienteId: p.patientId }}
                  className="text-[15px] font-semibold underline-offset-2 hover:underline"
                >
                  {p.patientName}
                </Link>
                <p className="text-sm text-muted-foreground">
                  Presupuesto <span className="cifra">{p.quoteNumber}</span> · {p.diasSinRespuesta}{" "}
                  días sin respuesta
                </p>
              </div>
              <BloqueoEscritura>
                <button
                  type="button"
                  onClick={() => mutacion.mutate(p)}
                  disabled={mutacion.isPending}
                  className={BOTON_FILA}
                >
                  <Plus className="size-3.5" aria-hidden /> Crear tarea
                </button>
              </BloqueoEscritura>
            </li>
          ))}
        </ul>
      )}
    </PanelLista>
  );
}
