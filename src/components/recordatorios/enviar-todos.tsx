import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Loader2, Mail, MessageCircle, Send } from "lucide-react";
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
import { useSoloLectura } from "@/hooks/use-solo-lectura";
import type { MessageTemplateKind } from "@/lib/messaging/messaging";
import {
  sendEmailFromTemplate,
  sendWhatsAppFromTemplate,
} from "@/lib/messaging/messaging.functions";
import { despacharEnSerie } from "@/lib/messaging/recordatorios-agrupados";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/** Lo que necesita el servidor para mandar un mensaje por un canal. */
export interface EnvioPorCanal {
  templateKind: MessageTemplateKind;
  variables: Record<string, string>;
  appointmentId?: string;
  quoteId?: string;
}

/** Un destinatario de la tanda: una fila de la sección (un paciente). */
export interface PasoDeEnvio {
  clave: string;
  patientId: string;
  patientName: string;
  /** Qué se le manda, en una línea ("Limpieza · jueves 23 a las 10:00"). */
  detalle: string;
  whatsapp: EnvioPorCanal | null;
  email: EnvioPorCanal | null;
}

type Canal = "whatsapp" | "email";
type Fase = "vista-previa" | "cola" | "tanda" | "fin";

/**
 * "Enviar todos (n)": vista previa con destinatarios y canal, y después el
 * despacho de a uno.
 *
 * - **WhatsApp** (wa.me manual) no admite tanda: cada mensaje lo manda una
 *   persona desde su WhatsApp. Se abre una cola guiada: un clic por
 *   paciente, con anterior/siguiente y "k de n".
 * - **Email** sale en tanda por el mismo `sendEmailFromTemplate`, de a uno y
 *   con pausa entre envíos.
 *
 * El servidor sigue cortando la baja de WhatsApp y la demo en cada envío:
 * esto solo ahorra clics, no saltea ningún control.
 */
export function EnviarTodos({
  clinicId,
  titulo,
  pasos,
  onSent,
}: {
  clinicId: string;
  titulo: string;
  pasos: PasoDeEnvio[];
  onSent: () => void;
}) {
  const soloLectura = useSoloLectura();
  const [open, setOpen] = useState(false);
  // La lista se congela al abrir: los recordatorios se refrescan cada minuto
  // y la cola no puede correrse debajo del dedo.
  const [instantanea, setInstantanea] = useState<PasoDeEnvio[]>([]);
  const lista = open ? instantanea : pasos;
  const conWhatsApp = lista.filter((p) => p.whatsapp);
  const conEmail = lista.filter((p) => p.email);
  const canalesDisponibles: Canal[] = [
    ...(conWhatsApp.length > 0 ? (["whatsapp"] as const) : []),
    ...(conEmail.length > 0 ? (["email"] as const) : []),
  ];
  const total = Math.max(conWhatsApp.length, conEmail.length);

  const [canal, setCanal] = useState<Canal>(canalesDisponibles[0] ?? "whatsapp");
  const [fase, setFase] = useState<Fase>("vista-previa");
  const [indice, setIndice] = useState(0);
  const [hechos, setHechos] = useState<Set<string>>(new Set());
  const [errores, setErrores] = useState<Map<string, string>>(new Map());
  const [enviando, setEnviando] = useState(false);
  const cancelar = useRef(false);
  const huboEnvios = useRef(false);

  const queryClient = useQueryClient();
  const sendWhatsApp = useServerFn(sendWhatsAppFromTemplate);
  const sendEmail = useServerFn(sendEmailFromTemplate);

  const destinatarios = canal === "whatsapp" ? conWhatsApp : conEmail;
  const sinCanal = lista.filter((p) => !(canal === "whatsapp" ? p.whatsapp : p.email));

  if (canalesDisponibles.length === 0) return null;

  function abrir() {
    setInstantanea(pasos);
    setCanal(canalesDisponibles[0]);
    setFase("vista-previa");
    setIndice(0);
    setHechos(new Set());
    setErrores(new Map());
    cancelar.current = false;
    huboEnvios.current = false;
    setOpen(true);
  }

  function cerrar(o: boolean) {
    if (o) return;
    cancelar.current = true;
    setOpen(false);
    if (huboEnvios.current) onSent();
  }

  function registrar(paso: PasoDeEnvio, error: string | null) {
    if (error) {
      setErrores((prev) => new Map(prev).set(paso.clave, error));
      return;
    }
    huboEnvios.current = true;
    setHechos((prev) => new Set(prev).add(paso.clave));
    setErrores((prev) => {
      const sig = new Map(prev);
      sig.delete(paso.clave);
      return sig;
    });
    queryClient.invalidateQueries({ queryKey: ["messages", clinicId, paso.patientId] });
  }

  /** Cola guiada: manda el actual y avanza al siguiente sin hacer. */
  async function enviarActualPorWhatsApp() {
    const paso = destinatarios[indice];
    if (!paso?.whatsapp) return;
    setEnviando(true);
    try {
      const r = await sendWhatsApp({
        data: { clinicId, patientId: paso.patientId, ...paso.whatsapp },
      });
      if (!r.viaApi) {
        if (!r.waUrl) throw new Error("No pudimos construir el link de WhatsApp.");
        window.open(r.waUrl, "_blank", "noopener,noreferrer");
      }
      registrar(paso, null);
      const siguiente = destinatarios.findIndex((p, i) => i > indice && !hechos.has(p.clave));
      if (siguiente === -1) setFase("fin");
      else setIndice(siguiente);
    } catch (e) {
      const msg = mensajeDeError(e as Error);
      registrar(paso, msg);
      toast.error(msg);
    } finally {
      setEnviando(false);
    }
  }

  async function enviarTandaDeEmails() {
    setFase("tanda");
    setEnviando(true);
    cancelar.current = false;
    const resultado = await despacharEnSerie(
      destinatarios,
      async (paso) => {
        const r = await sendEmail({
          data: { clinicId, patientId: paso.patientId, ...paso.email! },
        });
        if (!r.sent) throw new Error(r.reason ?? "No se pudo enviar el email.");
        return r;
      },
      {
        cancelado: () => cancelar.current,
        alAvanzar: (n, paso, res) => {
          setIndice(n);
          registrar(paso, res.ok ? null : res.error);
        },
      },
    );
    setEnviando(false);
    setFase("fin");
    if (resultado.enviados > 0) {
      toast.success(
        resultado.enviados === 1 ? "1 email enviado." : `${resultado.enviados} emails enviados.`,
      );
    }
  }

  const actual = destinatarios[indice];
  const enviadosCount = hechos.size;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={abrir}
        disabled={soloLectura}
        className="shrink-0"
      >
        <Send className="size-3.5" aria-hidden />
        Enviar todos ({total})
      </Button>

      <Dialog open={open} onOpenChange={cerrar}>
        <DialogContent className="max-w-lg grid-cols-[minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription>
              {fase === "vista-previa"
                ? "Revisa a quién le escribes y por qué canal. Nada sale hasta que lo confirmes."
                : canal === "whatsapp"
                  ? "Un clic por paciente: se abre WhatsApp con el mensaje listo y tú lo mandas."
                  : "Los emails salen de a uno, con una pausa entre cada envío."}
            </DialogDescription>
          </DialogHeader>

          {fase === "vista-previa" && (
            <div className="space-y-4">
              {canalesDisponibles.length > 1 && (
                <div
                  role="radiogroup"
                  aria-label="Canal"
                  className="inline-flex rounded-md border border-border p-0.5 text-sm"
                >
                  {canalesDisponibles.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={canal === c}
                      onClick={() => setCanal(c)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5",
                        canal === c
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {c === "whatsapp" ? (
                        <MessageCircle className="size-3.5" aria-hidden />
                      ) : (
                        <Mail className="size-3.5" aria-hidden />
                      )}
                      {c === "whatsapp"
                        ? `WhatsApp (${conWhatsApp.length})`
                        : `Email (${conEmail.length})`}
                    </button>
                  ))}
                </div>
              )}
              <ul className="max-h-72 divide-y divide-hairline overflow-y-auto rounded-md border border-hairline">
                {destinatarios.map((p) => (
                  <li key={p.clave} className="flex items-start gap-3 px-3 py-2.5">
                    {canal === "whatsapp" ? (
                      <MessageCircle
                        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                        aria-label="WhatsApp"
                      />
                    ) : (
                      <Mail
                        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                        aria-label="Email"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.patientName}</p>
                      <p className="truncate text-xs text-muted-foreground">{p.detalle}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {sinCanal.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {sinCanal.length === 1
                    ? "1 paciente queda"
                    : `${sinCanal.length} pacientes quedan`}{" "}
                  fuera por no tener{" "}
                  {canal === "whatsapp" ? "WhatsApp disponible" : "email cargado"}:{" "}
                  {sinCanal.map((p) => p.patientName).join(", ")}.
                </p>
              )}
            </div>
          )}

          {fase === "cola" && actual && (
            <div className="space-y-4">
              <Progreso hechos={enviadosCount} total={destinatarios.length} />
              <div className="rounded-md border border-hairline p-4">
                <p className="text-xs text-muted-foreground">
                  {indice + 1} de {destinatarios.length}
                </p>
                <p className="mt-1 text-base font-medium">{actual.patientName}</p>
                <p className="text-sm text-muted-foreground">{actual.detalle}</p>
                {hechos.has(actual.clave) && (
                  <p className="mt-2 text-xs font-medium text-success">Ya lo abriste.</p>
                )}
                {errores.get(actual.clave) && (
                  <p className="mt-2 text-xs text-destructive">{errores.get(actual.clave)}</p>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIndice((i) => Math.max(0, i - 1))}
                  disabled={indice === 0 || enviando}
                >
                  <ChevronLeft className="size-4" aria-hidden /> Anterior
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIndice((i) => Math.min(destinatarios.length - 1, i + 1))}
                  disabled={indice >= destinatarios.length - 1 || enviando}
                >
                  Siguiente <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          )}

          {(fase === "tanda" || fase === "fin") && (
            <div className="space-y-3">
              <Progreso
                hechos={fase === "tanda" ? indice : enviadosCount}
                total={destinatarios.length}
                etiqueta={fase === "tanda" ? "procesados" : "enviados"}
              />
              {fase === "fin" && (
                <p className="text-sm">
                  {enviadosCount === destinatarios.length
                    ? "Listo: todos despachados."
                    : `${enviadosCount} de ${destinatarios.length} despachados.`}
                </p>
              )}
              {errores.size > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-destructive">
                  {destinatarios
                    .filter((p) => errores.has(p.clave))
                    .map((p) => (
                      <li key={p.clave}>
                        {p.patientName}: {errores.get(p.clave)}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          <DialogFooter>
            {fase === "vista-previa" && (
              <Button
                type="button"
                disabled={destinatarios.length === 0}
                onClick={() => {
                  if (canal === "whatsapp") {
                    setIndice(0);
                    setFase("cola");
                  } else {
                    void enviarTandaDeEmails();
                  }
                }}
              >
                {canal === "whatsapp"
                  ? `Empezar (${destinatarios.length})`
                  : `Enviar ${destinatarios.length} ${destinatarios.length === 1 ? "email" : "emails"}`}
              </Button>
            )}
            {fase === "cola" && actual && (
              <>
                <Button type="button" variant="outline" onClick={() => setFase("fin")}>
                  Terminar
                </Button>
                <Button
                  type="button"
                  onClick={() => void enviarActualPorWhatsApp()}
                  disabled={enviando || hechos.has(actual.clave)}
                >
                  {enviando ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <MessageCircle className="size-4" aria-hidden />
                  )}
                  Abrir WhatsApp de {actual.patientName.split(" ")[0]}
                </Button>
              </>
            )}
            {fase === "tanda" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  cancelar.current = true;
                }}
              >
                Detener
              </Button>
            )}
            {fase === "fin" && (
              <Button type="button" onClick={() => cerrar(false)}>
                Cerrar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Progreso({
  hechos,
  total,
  etiqueta = "enviados",
}: {
  hechos: number;
  total: number;
  etiqueta?: string;
}) {
  const pct = total === 0 ? 0 : Math.round((hechos / total) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          {hechos} de {total} {etiqueta}
        </span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={hechos}
        aria-label={`${hechos} de ${total} ${etiqueta}`}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-brand transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
