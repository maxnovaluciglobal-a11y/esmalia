import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { toast } from "sonner";

import { BOTON_FILA, Chip, PanelLista, Vacio, type Tono } from "@/components/seguimiento/piezas";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fechaHora } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import {
  abrirWhatsAppDeCampana,
  cerrarCampana,
  enviarTandaDeCampana,
  listDestinatariosDeCampana,
  omitirDestinatario,
  type Campana,
  type DestinatarioDeCampana,
} from "@/lib/seguimiento/campanas.functions";
import {
  ETIQUETA_ESTADO_CAMPANA,
  ETIQUETA_ESTADO_DESTINATARIO,
  type EstadoDeDestinatario,
} from "@/lib/seguimiento/campanas";

const TONO_DESTINATARIO: Record<EstadoDeDestinatario, Tono> = {
  pendiente: "neutro",
  enviando: "aviso",
  enviado: "bien",
  abierto: "bien",
  fallido: "alerta",
  omitido: "tenue",
};

/**
 * Una campaña confirmada: avance, envío del correo por tandas (con su
 * progreso) o la cola de WhatsApp para despachar de a uno. Cerrar la campaña
 * (terminarla o cancelarla) deja de ofrecer lo pendiente.
 */
export function DetalleDeCampana({
  clinicId,
  zona,
  campana,
  esPropietario,
  onCerrar,
  onCambio,
}: {
  clinicId: string;
  zona: string;
  campana: Campana;
  esPropietario: boolean;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const [progreso, setProgreso] = useState<{ enviados: number; fallidos: number } | null>(null);
  const [cerrar, setCerrar] = useState<"terminada" | "cancelada" | null>(null);

  const listar = useServerFn(listDestinatariosDeCampana);
  const destinatarios = useQuery({
    queryKey: ["campana-destinatarios", clinicId, campana.id],
    queryFn: () => listar({ data: { clinicId, campaignId: campana.id } }),
    enabled: campana.status !== "borrador",
  });
  const refrescar = () => {
    destinatarios.refetch();
    onCambio();
  };

  const enviar = useServerFn(enviarTandaDeCampana);
  const envio = useMutation({
    mutationFn: async () => {
      let enviados = 0;
      let fallidos = 0;
      setProgreso({ enviados, fallidos });
      // Tandas hasta vaciar la cola; cada tanda la reclama la base, así que
      // dos pestañas a la vez se reparten la cola sin repetir correos.
      for (let i = 0; i < 200; i++) {
        const r = await enviar({ data: { clinicId, campaignId: campana.id } });
        enviados += r.enviados;
        fallidos += r.fallidos;
        setProgreso({ enviados, fallidos });
        if (!r.quedan) return { enviados, fallidos, terminada: r.terminada };
      }
      return { enviados, fallidos, terminada: false };
    },
    onSuccess: (r) => {
      toast.success(
        `Listo: ${r.enviados} ${r.enviados === 1 ? "correo enviado" : "correos enviados"}${r.fallidos ? `, ${r.fallidos} no salieron (mira el motivo en la lista)` : ""}.`,
      );
      refrescar();
    },
    onError: (e: Error) => {
      toast.error(mensajeDeError(e));
      refrescar();
    },
  });

  const abrir = useServerFn(abrirWhatsAppDeCampana);
  const whatsapp = useMutation({
    mutationFn: (d: DestinatarioDeCampana) => abrir({ data: { clinicId, recipientId: d.id } }),
    onSuccess: (r) => {
      window.open(r.waUrl, "_blank", "noopener,noreferrer");
      toast.success("Mensaje abierto en WhatsApp. Revísalo y envíalo desde ahí.");
      refrescar();
    },
    onError: (e: Error) => {
      toast.error(mensajeDeError(e));
      refrescar();
    },
  });

  const omitir = useServerFn(omitirDestinatario);
  const omision = useMutation({
    mutationFn: (d: DestinatarioDeCampana) =>
      omitir({ data: { clinicId, recipientId: d.id, motivo: "Omitido a mano" } }),
    onSuccess: () => {
      toast.success("Destinatario omitido.");
      refrescar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const fCerrar = useServerFn(cerrarCampana);
  const cierre = useMutation({
    mutationFn: (estado: "terminada" | "cancelada") =>
      fCerrar({ data: { clinicId, campaignId: campana.id, estado } }),
    onSuccess: (_r, estado) => {
      toast.success(estado === "terminada" ? "Campaña terminada." : "Campaña cancelada.");
      setCerrar(null);
      onCambio();
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const lista = destinatarios.data ?? [];
  const c = campana.conteo;
  const pendientes = c.pendiente;
  const enCurso = campana.status === "confirmada";
  const esCorreo = campana.channel === "correo";
  const cola = lista.filter((d) => d.status === "pendiente" || d.status === "abierto");

  return (
    <Dialog open onOpenChange={(v) => !v && !envio.isPending && onCerrar()}>
      <DialogContent className="max-h-[94dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {campana.name}
            <Chip tono={enCurso ? "tinta" : "tenue"}>
              {ETIQUETA_ESTADO_CAMPANA[campana.status]}
            </Chip>
          </DialogTitle>
          <DialogDescription>
            {esCorreo ? "Correo" : "WhatsApp asistido"} ·{" "}
            {campana.segmentLabel ?? "Grupo de pacientes"}
            {campana.confirmedAt && ` · confirmada el ${fechaHora(campana.confirmedAt, zona)}`}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-3 gap-3 rounded-[14px] border border-hairline p-4 sm:grid-cols-5">
          {(
            [
              ["Destinatarios", campana.recipientsCount],
              [esCorreo ? "Enviados" : "Abiertos", esCorreo ? c.enviado : c.abierto],
              ["Pendientes", c.pendiente + c.enviando],
              ["No salieron", c.fallido],
              ["Omitidos", c.omitido],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="truncate text-[12.5px] font-semibold text-muted-foreground">{k}</dt>
              <dd className="mt-1 font-display text-[28px] font-medium leading-none [font-variant-numeric:lining-nums]">
                {v}
              </dd>
            </div>
          ))}
        </dl>

        <div className="rounded-lg border border-hairline bg-secondary/60 px-3 py-2.5">
          {campana.subject && <p className="mb-1 text-sm font-semibold">{campana.subject}</p>}
          <p className="whitespace-pre-line text-sm">{campana.body}</p>
        </div>

        {enCurso && esCorreo && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Los correos respetan el modo de prueba de tu correo: mientras esté en prueba se
              bloquean o llegan a tu casilla de pruebas, nunca a un paciente.
              {esPropietario && (
                <>
                  {" "}
                  <Link
                    to="/sandbox-email"
                    className="font-semibold text-brand-700 underline-offset-4 hover:underline"
                  >
                    Revisar el modo de prueba
                  </Link>
                </>
              )}
            </p>
            <BloqueoEscritura>
              <Button
                type="button"
                onClick={() => envio.mutate()}
                disabled={envio.isPending || pendientes === 0}
              >
                {envio.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
                {envio.isPending
                  ? `Enviando… ${progreso?.enviados ?? 0} listos`
                  : pendientes === 0
                    ? "No queda nada por enviar"
                    : `Enviar ${pendientes} ${pendientes === 1 ? "correo" : "correos"}`}
              </Button>
            </BloqueoEscritura>
            {c.enviando > 0 && !envio.isPending && (
              <p className="text-sm text-warning">
                {c.enviando} quedaron a medio enviar (se cortó la conexión). No se reintentan solos
                para no repetir un correo: revisa el historial de esos pacientes.
              </p>
            )}
          </div>
        )}

        {enCurso && !esCorreo && (
          <PanelLista
            titulo="Cola de WhatsApp"
            conteo={cola.filter((d) => d.status === "pendiente").length}
            descripcion="Abre cada mensaje en tu WhatsApp y envíalo desde ahí. Nada sale solo."
          >
            {destinatarios.isPending ? (
              <Vacio>Cargando…</Vacio>
            ) : cola.length === 0 ? (
              <Vacio>No queda nadie en la cola. Puedes terminar la campaña.</Vacio>
            ) : (
              <ul className="divide-y divide-hairline">
                {cola.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                        {d.patientName}
                        {d.status === "abierto" && <Chip tono="bien">Abierto</Chip>}
                        {d.recipientFor === "tutor" && <Chip tono="tenue">A su tutor</Chip>}
                      </p>
                      <p className="cifra text-sm text-muted-foreground">{d.destination}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <BloqueoEscritura>
                        <button
                          type="button"
                          className={BOTON_FILA}
                          disabled={whatsapp.isPending}
                          onClick={() => whatsapp.mutate(d)}
                        >
                          {whatsapp.isPending && whatsapp.variables?.id === d.id ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <MessageCircle className="size-3.5" aria-hidden />
                          )}
                          {d.status === "abierto" ? "Abrir otra vez" : "Abrir en WhatsApp"}
                        </button>
                      </BloqueoEscritura>
                      {d.status === "pendiente" && (
                        <BloqueoEscritura>
                          <button
                            type="button"
                            className={BOTON_FILA}
                            disabled={omision.isPending}
                            onClick={() => omision.mutate(d)}
                            aria-label={`Omitir a ${d.patientName}`}
                          >
                            <X className="size-3.5" aria-hidden /> Omitir
                          </button>
                        </BloqueoEscritura>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PanelLista>
        )}

        {lista.length > 0 && (
          <details className="rounded-[14px] border border-hairline">
            <summary className="cursor-pointer px-4 py-3 text-[15px] font-semibold">
              Todos los destinatarios ({lista.length})
            </summary>
            <ul className="divide-y divide-hairline border-t border-hairline">
              {lista.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{d.patientName}</p>
                    <p className="cifra text-xs text-muted-foreground">
                      {d.destination}
                      {d.reason ? ` · ${d.reason}` : ""}
                    </p>
                  </div>
                  <Chip tono={TONO_DESTINATARIO[d.status]}>
                    {ETIQUETA_ESTADO_DESTINATARIO[d.status]}
                  </Chip>
                </li>
              ))}
            </ul>
          </details>
        )}

        {enCurso && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-hairline pt-3">
            <BloqueoEscritura>
              <Button type="button" variant="outline" onClick={() => setCerrar("cancelada")}>
                Cancelar campaña
              </Button>
            </BloqueoEscritura>
            {!esCorreo && (
              <BloqueoEscritura>
                <Button type="button" variant="outline" onClick={() => setCerrar("terminada")}>
                  Terminar campaña
                </Button>
              </BloqueoEscritura>
            )}
          </div>
        )}

        <AlertDialog open={cerrar !== null} onOpenChange={(v) => !v && setCerrar(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {cerrar === "cancelada" ? "¿Cancelas la campaña?" : "¿Terminas la campaña?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendientes > 0
                  ? `Quedan ${pendientes} ${pendientes === 1 ? "destinatario pendiente" : "destinatarios pendientes"}: ya no se les escribirá. Lo enviado queda en el historial.`
                  : "Lo enviado queda en el historial y en la medición de quién volvió."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Volver</AlertDialogCancel>
              <AlertDialogAction
                disabled={cierre.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  if (cerrar) cierre.mutate(cerrar);
                }}
              >
                {cerrar === "cancelada" ? "Cancelar campaña" : "Terminar campaña"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
