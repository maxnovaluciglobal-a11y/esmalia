import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus, Check, Loader2, MessageCircle, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { BloqueoEscritura } from "@/components/solo-lectura";
import { BOTON_FILA, Chip, PanelLista, Vacio } from "@/components/seguimiento/piezas";
import { mensajeDeError } from "@/lib/mensaje-error";
import { sendWhatsAppFromTemplate } from "@/lib/messaging/messaging.functions";
import { fecha } from "@/lib/formato-fecha";
import {
  crearTarea,
  resolverControl,
  type ControlPendienteConMensaje,
} from "@/lib/seguimiento/seguimiento.functions";

const BUSQUEDA_AGENDA = {
  q: "",
  fecha: "",
  sucursal: "",
  profesional: "",
  estado: "",
  page: 1,
} as const;

/**
 * REC-08 · Controles pendientes: los programados a mano desde la ficha
 * (FIC-13) y el recall automático, vencidos arriba. Por cada uno: escribirle
 * por WhatsApp (asistido, con el link de reserva de la Ola 7 si está
 * encendida), agendar, crear una tarea o, si es manual, marcarlo agendado o
 * descartarlo. Nada sale solo.
 */
export function ControlesPendientes({
  clinicId,
  userId,
  hoy,
  zona,
  controles,
  reservaEncendida,
  conTarea,
  onCambio,
}: {
  clinicId: string;
  userId: string;
  hoy: string;
  zona: string;
  controles: readonly ControlPendienteConMensaje[];
  reservaEncendida: boolean;
  /** Controles (id) y pacientes (id) que ya tienen una tarea de control abierta. */
  conTarea: { controles: ReadonlySet<string>; pacientes: ReadonlySet<string> };
  onCambio: () => void;
}) {
  const queryClient = useQueryClient();
  const enviar = useServerFn(sendWhatsAppFromTemplate);
  const whatsapp = useMutation({
    mutationFn: (c: ControlPendienteConMensaje) =>
      enviar({
        data: {
          clinicId,
          patientId: c.patientId,
          // Mismo tipo que el recall de /recordatorios: cuenta para su
          // enfriamiento y para medir quién volvió (CRM-05).
          templateKind: "hygiene_recall",
          rawBody: c.mensaje,
          variables: {},
        },
      }),
    onSuccess: (r, c) => {
      queryClient.invalidateQueries({ queryKey: ["messages", clinicId, c.patientId] });
      if (r.viaApi) toast.success("Mensaje enviado por WhatsApp.");
      else if (r.waUrl) {
        window.open(r.waUrl, "_blank", "noopener,noreferrer");
        toast.success("Mensaje registrado y abierto en WhatsApp.");
      }
      onCambio();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const resolver = useServerFn(resolverControl);
  const resolucion = useMutation({
    mutationFn: (v: { controlId: string; estado: "agendado" | "descartado" }) =>
      resolver({ data: { clinicId, controlId: v.controlId, estado: v.estado } }),
    onSuccess: (_r, v) => {
      toast.success(
        v.estado === "agendado" ? "Control marcado como agendado." : "Control descartado.",
      );
      onCambio();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const crear = useServerFn(crearTarea);
  const tarea = useMutation({
    mutationFn: (c: ControlPendienteConMensaje) =>
      crear({
        data: {
          clinicId,
          titulo: `Agendar control: ${c.motivo}`.slice(0, 160),
          notas: null,
          tipo: "control",
          patientId: c.patientId,
          quoteId: null,
          controlId: c.controlId,
          asignarA: userId,
          fecha: hoy,
        },
      }),
    onSuccess: (r) => {
      toast.success(r.yaExistia ? "Ese control ya tenía una tarea abierta." : "Tarea creada.");
      onCambio();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const sinCita = controles.filter((c) => !c.tieneCita);
  const yaConCita = controles.filter((c) => c.tieneCita);

  const fila = (c: ControlPendienteConMensaje) => {
    const tieneTarea = c.controlId
      ? conTarea.controles.has(c.controlId)
      : conTarea.pacientes.has(c.patientId);
    const ocupado =
      (whatsapp.isPending && whatsapp.variables?.clave === c.clave) ||
      (tarea.isPending && tarea.variables?.clave === c.clave) ||
      (resolucion.isPending && resolucion.variables?.controlId === c.controlId);
    return (
      <li
        key={c.clave}
        className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/pacientes/$pacienteId"
              params={{ pacienteId: c.patientId }}
              className="text-[15px] font-semibold underline-offset-2 hover:underline"
            >
              {c.patientName}
            </Link>
            {c.origen === "automatico" ? (
              <Chip tono="tenue">Control periódico automático</Chip>
            ) : c.vencimiento === "vencido" ? (
              <Chip tono="alerta">
                Vencido hace {c.diasDeAtraso} {c.diasDeAtraso === 1 ? "día" : "días"}
              </Chip>
            ) : (
              <Chip tono="aviso">Vence el {fecha(c.venceEl, zona)}</Chip>
            )}
            {c.tieneCita && <Chip tono="bien">Ya tiene cita</Chip>}
            {tieneTarea && <Chip tono="tenue">Con tarea</Chip>}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {c.motivo}
            {c.patientPhone && <span className="cifra"> · {c.patientPhone}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {c.patientPhone && !c.tieneCita && (
            <BloqueoEscritura>
              <button
                type="button"
                onClick={() => whatsapp.mutate(c)}
                disabled={ocupado}
                className={BOTON_FILA}
              >
                {whatsapp.isPending && whatsapp.variables?.clave === c.clave ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <MessageCircle className="size-3.5" aria-hidden />
                )}
                WhatsApp
              </button>
            </BloqueoEscritura>
          )}
          {!c.tieneCita && (
            <Link
              to="/agenda"
              search={{ ...BUSQUEDA_AGENDA, nueva: c.patientId }}
              className={BOTON_FILA}
            >
              <CalendarPlus className="size-3.5" aria-hidden /> Agendar
            </Link>
          )}
          {!tieneTarea && !c.tieneCita && (
            <BloqueoEscritura>
              <button
                type="button"
                onClick={() => tarea.mutate(c)}
                disabled={ocupado}
                className={BOTON_FILA}
              >
                <Plus className="size-3.5" aria-hidden /> Tarea
              </button>
            </BloqueoEscritura>
          )}
          {c.controlId && (
            <>
              <BloqueoEscritura>
                <button
                  type="button"
                  onClick={() => resolucion.mutate({ controlId: c.controlId!, estado: "agendado" })}
                  disabled={ocupado}
                  className={BOTON_FILA}
                >
                  <Check className="size-3.5" aria-hidden /> Agendado
                </button>
              </BloqueoEscritura>
              <BloqueoEscritura>
                <button
                  type="button"
                  onClick={() =>
                    resolucion.mutate({ controlId: c.controlId!, estado: "descartado" })
                  }
                  disabled={ocupado}
                  className={BOTON_FILA}
                  aria-label={`Descartar el control de ${c.patientName}`}
                >
                  <X className="size-3.5" aria-hidden /> Descartar
                </button>
              </BloqueoEscritura>
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-[18px]">
      <p className="max-w-[70ch] text-[15px] text-muted-foreground">
        Controles programados desde la ficha que vencieron o vencen en los próximos 30 días, y
        pacientes para el control periódico (6 meses sin visita y sin cita). El mensaje de WhatsApp
        se abre en tu WhatsApp para que lo revises antes de enviarlo
        {reservaEncendida ? " y lleva el link de reserva en línea." : "."}
        {!reservaEncendida && (
          <>
            {" "}
            Con la{" "}
            <Link
              to="/reserva-en-linea"
              className="font-semibold text-brand-700 underline-offset-4 hover:underline"
            >
              reserva en línea
            </Link>{" "}
            encendida, el mensaje lleva el link para que el paciente elija su hora.
          </>
        )}
      </p>
      <PanelLista titulo="Por contactar" conteo={sinCita.length}>
        {sinCita.length === 0 ? (
          <Vacio>No hay controles pendientes por contactar.</Vacio>
        ) : (
          <ul className="divide-y divide-hairline">{sinCita.map(fila)}</ul>
        )}
      </PanelLista>
      {yaConCita.length > 0 && (
        <PanelLista
          titulo="Ya tienen cita"
          conteo={yaConCita.length}
          descripcion="Tienen una cita agendada. Si es la del control, márcalo como agendado."
        >
          <ul className="divide-y divide-hairline">{yaConCita.map(fila)}</ul>
        </PanelLista>
      )}
    </div>
  );
}
