import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, CheckCircle2, ImageUp, Loader2, ShieldAlert } from "lucide-react";

import { ChipFiltro } from "@/components/a-plus/lista";
import {
  EditorCaptura,
  exportarCaptura,
  type EstadoCaptura,
} from "@/components/ayuda/editor-captura";
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
import { ETIQUETA_TIPO_REPORTE, TIPOS_REPORTE, type TipoReporte } from "@/lib/ayuda/reportes";
import { enviarReporte } from "@/lib/ayuda/reportes.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

/** ¿El navegador deja capturar la pantalla? (no en celulares). */
function puedeCapturar(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

const esperar = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** Un cuadro de la pantalla elegida, con la API nativa del navegador. */
async function capturarPantalla(): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "browser" },
    audio: false,
    // Chrome: ofrece primero la pestaña actual.
    preferCurrentTab: true,
  } as DisplayMediaStreamOptions);
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // Que el selector del navegador termine de cerrarse antes del cuadro.
    await esperar(350);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    for (const t of stream.getTracks()) t.stop();
  }
}

function leerArchivo(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!archivo.type.startsWith("image/")) {
      reject(new Error("Elige una imagen (PNG o JPG)."));
      return;
    }
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(new Error("No pudimos leer la imagen."));
    lector.readAsDataURL(archivo);
  });
}

/**
 * Reportar un problema o sugerir algo (ONB-09). Llega al equipo de Esmalia
 * (no a la clínica). La captura es opcional y viene apagada; antes de
 * agregarla se avisa que puede mostrar datos de pacientes y se puede tapar
 * o difuminar lo que se quiera. Solo viaja la ruta de la pantalla, sin lo
 * que haya en la barra de direcciones después del "?".
 */
export function ReportarDialog({
  abierto,
  onAbiertoChange,
  clinicId,
  pantalla,
  esDemo,
}: {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  clinicId: string;
  pantalla: string | null;
  esDemo: boolean;
}) {
  const id = useId();
  const enviar = useServerFn(enviarReporte);
  const [tipo, setTipo] = useState<TipoReporte>("problema");
  const [mensaje, setMensaje] = useState("");
  const [captura, setCaptura] = useState<EstadoCaptura | null>(null);
  const [capturando, setCapturando] = useState(false);
  const [errorCaptura, setErrorCaptura] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);

  const mutacion = useMutation({
    mutationFn: async () => {
      const capturaFinal = captura
        ? await exportarCaptura(captura.src, captura.tapas, captura.difuminar)
        : undefined;
      return enviar({
        data: {
          clinicId,
          tipo,
          mensaje: mensaje.trim(),
          ruta: window.location.pathname,
          pantalla: pantalla ?? undefined,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          captura: capturaFinal,
        },
      });
    },
    onSuccess: () => setEnviado(true),
  });

  function reiniciar() {
    setTipo("problema");
    setMensaje("");
    setCaptura(null);
    setErrorCaptura(null);
    setEnviado(false);
    mutacion.reset();
  }

  async function tomarCaptura() {
    setErrorCaptura(null);
    setCapturando(true);
    try {
      const src = await capturarPantalla();
      setCaptura({ src, tapas: [], difuminar: false });
    } catch (e) {
      // Cancelar el selector no es un error que haya que mostrar.
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) {
        setErrorCaptura("No pudimos capturar la pantalla. Puedes subir una imagen.");
      }
    } finally {
      setCapturando(false);
    }
  }

  const mensajeValido = mensaje.trim().length >= 5;

  return (
    <Dialog
      open={abierto && !capturando}
      onOpenChange={(next) => {
        if (mutacion.isPending || capturando) return;
        onAbiertoChange(next);
        if (!next) reiniciar();
      }}
    >
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-[26px] font-medium">
            Cuéntale al <em className="text-brand-600">equipo de Esmalia</em>
          </DialogTitle>
          <DialogDescription className="text-[15px]">
            Lo lee el equipo de Esmalia, no tu clínica. Te respondemos por correo o WhatsApp.
          </DialogDescription>
        </DialogHeader>

        {enviado ? (
          <div role="status" className="space-y-3 py-2">
            <p className="flex items-center gap-2 text-base font-semibold">
              <CheckCircle2 aria-hidden className="size-5 text-success" /> Gracias, ya nos llegó.
            </p>
            <p className="text-[15px] text-muted-foreground">
              Lo revisamos y te escribimos si necesitamos algo más.
            </p>
            <DialogFooter>
              <Button
                onClick={() => {
                  onAbiertoChange(false);
                  reiniciar();
                }}
              >
                Cerrar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (mensajeValido && !esDemo) mutacion.mutate();
            }}
          >
            <fieldset>
              <legend className="mb-2 text-sm font-medium">¿Qué nos quieres contar?</legend>
              <div className="flex flex-wrap gap-2">
                {TIPOS_REPORTE.map((t) => (
                  <ChipFiltro key={t} activo={tipo === t} onClick={() => setTipo(t)}>
                    {ETIQUETA_TIPO_REPORTE[t]}
                  </ChipFiltro>
                ))}
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor={`${id}-mensaje`}>
                {tipo === "problema"
                  ? "¿Qué pasó y qué esperabas que pasara?"
                  : "¿Qué te gustaría?"}
              </Label>
              <textarea
                id={`${id}-mensaje`}
                required
                rows={4}
                maxLength={4000}
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                aria-describedby={`${id}-mensaje-ayuda`}
                className="block w-full rounded-lg border border-control bg-card px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                placeholder={
                  tipo === "problema"
                    ? "Ej.: al cerrar la caja me aparece un error."
                    : "Ej.: me gustaría ver los cumpleaños de la semana en Hoy."
                }
              />
              <p id={`${id}-mensaje-ayuda`} className="text-[13px] text-muted-foreground">
                No escribas nombres, RUT ni datos clínicos de pacientes.
                {pantalla ? ` Va con la pantalla en que estás: ${pantalla}.` : ""}
              </p>
            </div>

            <section aria-labelledby={`${id}-captura`} className="space-y-2.5">
              <h3 id={`${id}-captura`} className="text-sm font-medium">
                Captura de pantalla <span className="text-muted-foreground">(opcional)</span>
              </h3>
              {captura ? (
                <>
                  <p className="flex gap-2 rounded-[10px] border border-warning/40 bg-warning-soft px-3 py-2 text-[13px] text-foreground">
                    <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                    Revisa la captura: puede mostrar datos de pacientes. Tapa o difumina lo que no
                    haga falta antes de enviarla.
                  </p>
                  <EditorCaptura
                    estado={captura}
                    onCambiar={setCaptura}
                    onQuitar={() => setCaptura(null)}
                  />
                </>
              ) : (
                <>
                  <p className="text-[13px] text-muted-foreground">
                    Ayuda a entender el problema. Puede mostrar datos de pacientes: antes de
                    enviarla vas a poder tapar lo que quieras.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {puedeCapturar() && (
                      <Button type="button" variant="outline" onClick={() => void tomarCaptura()}>
                        <Camera aria-hidden /> Capturar esta pantalla
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => archivo.current?.click()}
                    >
                      <ImageUp aria-hidden /> Subir una imagen
                    </Button>
                    <input
                      ref={archivo}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        leerArchivo(f)
                          .then((src) => setCaptura({ src, tapas: [], difuminar: false }))
                          .catch((err: Error) => setErrorCaptura(err.message));
                      }}
                    />
                  </div>
                </>
              )}
              {errorCaptura && (
                <p role="alert" className="text-sm text-destructive">
                  {errorCaptura}
                </p>
              )}
            </section>

            {mutacion.isError && (
              <p role="alert" className="text-sm text-destructive">
                {mensajeDeError(mutacion.error, "No pudimos enviar tu mensaje.")}
              </p>
            )}
            {esDemo && (
              <p className="text-sm text-muted-foreground">
                En la demo no se envían reportes. Escríbenos por WhatsApp o correo.
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={mutacion.isPending}
                onClick={() => {
                  onAbiertoChange(false);
                  reiniciar();
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={!mensajeValido || mutacion.isPending || esDemo}>
                {mutacion.isPending && <Loader2 aria-hidden className="animate-spin" />}
                Enviar al equipo
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
