import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Loader2, Mail, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

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
import { LARGO_MAXIMO_ASUNTO, LARGO_MAXIMO_MENSAJE } from "@/lib/documentos/correo";
import {
  reactivarCorreosDelPaciente,
  type ResultadoDeEnvio,
  type VistaDeEnvio,
} from "@/lib/documentos/envios.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

const CAMPO =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";

/**
 * Envío por correo al paciente de un PDF (PLA-09 presupuesto, DOC-07 copia
 * de un documento). Muestra a quién le llega (paciente o tutor), si la
 * clínica tiene el correo en modo de prueba (y adónde llega entonces), y el
 * texto editable. El servidor repite cada freno: baja del paciente, sin
 * correo, sandbox, solo lectura.
 */
export function EnviarPorCorreoDialog({
  abierto,
  onCerrar,
  titulo,
  adjunto,
  clinicId,
  patientId,
  queryKey,
  cargarVista,
  enviar,
  onEnviado,
  puedeReactivar,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  /** Qué va adjunto ("PDF del presupuesto P-12"). */
  adjunto: string;
  clinicId: string;
  /** Para reactivar los correos si el paciente se había dado de baja. */
  patientId: string | null;
  queryKey: readonly unknown[];
  cargarVista: () => Promise<VistaDeEnvio>;
  enviar: (texto: { asunto: string; mensaje: string }) => Promise<ResultadoDeEnvio>;
  onEnviado?: () => Promise<unknown> | void;
  /** Quien gestiona pacientes puede deshacer la baja a pedido del paciente. */
  puedeReactivar: boolean;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const vista = useQuery({ queryKey, queryFn: cargarVista, enabled: abierto, staleTime: 0 });
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("");

  // El texto por defecto llega con la vista; se carga una vez por apertura.
  const textoInicial = vista.data?.texto;
  useEffect(() => {
    if (abierto && textoInicial) {
      setAsunto(textoInicial.asunto);
      setMensaje(textoInicial.mensaje);
    }
  }, [abierto, textoInicial]);

  const mut = useMutation({
    mutationFn: () => enviar({ asunto: asunto.trim(), mensaje: mensaje.trim() }),
    onSuccess: async (r) => {
      if (!r.enviado) {
        toast.error(
          `No se envió: ${r.motivo ?? "error desconocido"}. Quedó registrado el intento.`,
        );
      } else if (r.redirigidoA) {
        toast.success(`Enviado en modo de prueba: llegó a ${r.redirigidoA}, no al paciente.`);
      } else {
        toast.success(`Enviado a ${r.destinatario}.`);
      }
      await onEnviado?.();
      if (r.enviado) onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const reactivarFn = useServerFn(reactivarCorreosDelPaciente);
  const reactivar = useMutation({
    mutationFn: () => reactivarFn({ data: { clinicId, patientId: patientId! } }),
    onSuccess: async () => {
      toast.success("Listo: el paciente vuelve a recibir correos de la clínica.");
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const v = vista.data;
  const bloqueado = v?.bloqueo ?? (v?.modo.tipo === "prueba_bloqueo" ? v.modo.motivo : null);
  const valido = asunto.trim().length >= 3 && mensaje.trim().length >= 3;

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && !mut.isPending && onCerrar()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            El correo lleva el PDF adjunto. En el cuerpo no van datos clínicos: solo tu mensaje.
          </DialogDescription>
        </DialogHeader>

        {vista.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Revisando a quién le llega…
          </p>
        ) : vista.isError || !v ? (
          <p className="text-sm text-destructive">{mensajeDeError(vista.error)}</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (valido && !bloqueado) mut.mutate();
            }}
          >
            <dl className="space-y-1 rounded-md border border-hairline bg-secondary/30 px-3 py-2 text-sm">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">Para:</dt>
                <dd className="min-w-0 break-all font-medium">
                  {v.destinatario ?? "Sin correo"}
                  {v.nombreDestinatario && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {v.nombreDestinatario}
                      {v.para === "tutor" ? " (tutor)" : ""}
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex flex-wrap items-center gap-x-2">
                <dt className="text-muted-foreground">Adjunto:</dt>
                <dd className="inline-flex items-center gap-1">
                  <FileText className="size-3.5" aria-hidden /> {adjunto}
                </dd>
              </div>
            </dl>

            {v.modo.tipo === "prueba_desvio" && !v.bloqueo && (
              <p
                role="status"
                className="flex gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  El correo de tu clínica está en modo de prueba: este envío llegará a{" "}
                  <strong className="break-all">{v.modo.llegaA}</strong>, no al paciente.
                </span>
              </p>
            )}

            {bloqueado && (
              <div
                role="alert"
                className="space-y-2 rounded-md border border-destructive-border bg-destructive-soft px-3 py-2 text-sm text-destructive"
              >
                <p>{bloqueado}</p>
                {v.bajaEn && puedeReactivar && patientId && (
                  <BloqueoEscritura>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => reactivar.mutate()}
                      disabled={reactivar.isPending}
                    >
                      {reactivar.isPending && <Loader2 className="animate-spin" aria-hidden />}
                      El paciente pidió volver a recibir correos
                    </Button>
                  </BloqueoEscritura>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-asunto`}>Asunto</Label>
              <input
                id={`${fid}-asunto`}
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
                maxLength={LARGO_MAXIMO_ASUNTO}
                required
                className={CAMPO}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-mensaje`}>Mensaje</Label>
              <textarea
                id={`${fid}-mensaje`}
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                rows={9}
                maxLength={LARGO_MAXIMO_MENSAJE}
                required
                className={CAMPO}
              />
              <p className="text-xs text-muted-foreground">
                Una línea en blanco separa párrafos. El pie del correo trae el enlace para que el
                paciente se dé de baja.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCerrar} disabled={mut.isPending}>
                Cancelar
              </Button>
              <BloqueoEscritura otroMotivo={bloqueado ? "No se puede enviar." : null}>
                <Button type="submit" disabled={!valido || mut.isPending || Boolean(bloqueado)}>
                  {mut.isPending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Mail aria-hidden />
                  )}
                  Enviar correo
                </Button>
              </BloqueoEscritura>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
