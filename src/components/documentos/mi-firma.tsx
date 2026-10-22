import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, PenLine, Upload } from "lucide-react";
import { toast } from "sonner";

import { ErrorDeCarga } from "@/components/estado-error";
import { SignaturePad } from "@/components/signature-pad";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMiFirma, guardarMiFirma } from "@/lib/documentos/documentos.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

export const MI_FIRMA_QUERY_KEY = "mi-firma-documentos";

/**
 * El trazo del lienzo usa el color del texto (claro en modo oscuro). La firma
 * se imprime sobre papel blanco, así que se guarda con tinta oscura: se
 * recolorea cada píxel visible conservando su transparencia.
 */
async function conTintaOscura(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  const datos = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < datos.data.length; i += 4) {
    if (datos.data[i + 3] === 0) continue;
    datos.data[i] = 24;
    datos.data[i + 1] = 22;
    datos.data[i + 2] = 20;
  }
  ctx.putImageData(datos, 0, 0);
  return canvas.toDataURL("image/png");
}

function leerArchivo(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("No pudimos leer la imagen."));
    reader.onerror = () => reject(new Error("No pudimos leer la imagen."));
    reader.readAsDataURL(archivo);
  });
}

/**
 * DOC-06: firma del profesional para los documentos que emite. Imagen de la
 * firma (dibujada o subida) y número de la Superintendencia de Salud. Firma
 * simple (Ley 19.799): no es firma electrónica avanzada.
 */
export function MiFirmaCard({ clinicId, esDemo }: { clinicId: string; esDemo: boolean }) {
  const fid = useId();
  const queryClient = useQueryClient();
  const cargar = useServerFn(getMiFirma);
  const guardarFn = useServerFn(guardarMiFirma);
  const consulta = useQuery({
    queryKey: [MI_FIRMA_QUERY_KEY, clinicId],
    queryFn: () => cargar({ data: { clinicId } }),
  });
  const profesional = consulta.data?.profesional ?? null;

  const [modo, setModo] = useState<"ver" | "dibujar" | "subir">("ver");
  const [trazo, setTrazo] = useState<string | null>(null);
  const [archivo, setArchivo] = useState<string | null>(null);
  const [registro, setRegistro] = useState("");
  useEffect(() => {
    setRegistro(profesional?.registroSis ?? "");
  }, [profesional?.registroSis]);

  const firmaNueva = modo === "dibujar" ? trazo : modo === "subir" ? archivo : null;
  const cambioRegistro = registro.trim() !== (profesional?.registroSis ?? "");

  const guardar = useMutation({
    mutationFn: async () => {
      const firmaDataUrl =
        modo === "dibujar" && trazo ? await conTintaOscura(trazo) : (firmaNueva ?? undefined);
      return guardarFn({
        data: { clinicId, firmaDataUrl, registroSis: registro.trim() },
      });
    },
    onSuccess: async () => {
      toast.success("Firma guardada.");
      setModo("ver");
      setTrazo(null);
      setArchivo(null);
      await queryClient.invalidateQueries({ queryKey: [MI_FIRMA_QUERY_KEY, clinicId] });
      await queryClient.invalidateQueries({ queryKey: ["datos-para-emitir"] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <section
      aria-labelledby={`${fid}-titulo`}
      className="rounded-lg border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <PenLine className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id={`${fid}-titulo`} className="font-display text-xl font-semibold">
            Tu firma para documentos
          </h2>
          <p className="text-sm text-muted-foreground">
            Se estampa, con tu nombre y tu registro, en los certificados, informes y formularios que
            emites. Es una firma simple (Ley 19.799), no una firma electrónica avanzada.
          </p>
        </div>
      </div>

      {consulta.isError ? (
        <div className="mt-4">
          <ErrorDeCarga
            onReintentar={() => consulta.refetch()}
            reintentando={consulta.isFetching}
            mensaje="No pudimos cargar tu firma."
          />
        </div>
      ) : consulta.isLoading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
        </p>
      ) : !profesional ? (
        <p className="mt-4 rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Tu usuario no tiene una ficha de profesional en esta clínica. Pídele a un administrador
          que la vincule en Profesionales para poder firmar documentos.
        </p>
      ) : (
        <form
          className="mt-5 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (firmaNueva || cambioRegistro) guardar.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Nombre que se imprime</p>
              <p className="flex h-9 items-center rounded-md border border-dashed border-border px-3 text-sm">
                {profesional.nombre}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-sis`}>Registro en la Superintendencia de Salud</Label>
              <Input
                id={`${fid}-sis`}
                value={registro}
                onChange={(e) => setRegistro(e.target.value)}
                maxLength={40}
                inputMode="numeric"
                className="cifra"
                placeholder={profesional.registroGeneral ?? "Ej. 123456"}
              />
              {!profesional.registroSis && profesional.registroGeneral && (
                <p className="text-xs text-muted-foreground">
                  Mientras no lo cargues, los documentos usan tu registro profesional (
                  {profesional.registroGeneral}).
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Imagen de la firma</p>
            {modo === "ver" && (
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex h-24 w-64 items-center justify-center rounded-md border border-hairline bg-secondary/20">
                  {profesional.firmaUrl ? (
                    <img
                      src={profesional.firmaUrl}
                      alt="Tu firma actual"
                      className="max-h-20 max-w-[220px] object-contain dark:invert"
                    />
                  ) : (
                    <span className="px-3 text-center text-xs text-muted-foreground">
                      Sin firma: el documento sale con una línea para firmar a mano.
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setModo("dibujar")}
                  >
                    <PenLine aria-hidden /> Dibujar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setModo("subir")}
                  >
                    <Upload aria-hidden /> Subir imagen
                  </Button>
                </div>
              </div>
            )}
            {modo === "dibujar" && (
              <div className="max-w-md space-y-2">
                <SignaturePad label="Dibuja tu firma" onChange={setTrazo} />
                <Button type="button" variant="ghost" size="sm" onClick={() => setModo("ver")}>
                  Cancelar
                </Button>
              </div>
            )}
            {modo === "subir" && (
              <div className="max-w-md space-y-2">
                <Label htmlFor={`${fid}-archivo`}>
                  Imagen de tu firma (PNG, JPG o WebP, hasta 1 MB)
                </Label>
                <Input
                  id={`${fid}-archivo`}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return setArchivo(null);
                    if (f.size > 1024 * 1024) {
                      toast.error("La imagen supera 1 MB.");
                      e.target.value = "";
                      return;
                    }
                    try {
                      setArchivo(await leerArchivo(f));
                    } catch (err) {
                      toast.error(mensajeDeError(err));
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Lo mejor es una foto o un escaneo de tu firma en tinta oscura sobre papel blanco.
                </p>
                {archivo && (
                  <img
                    src={archivo}
                    alt="Vista previa de la firma"
                    className="max-h-20 rounded border border-hairline object-contain"
                  />
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => setModo("ver")}>
                  Cancelar
                </Button>
              </div>
            )}
          </div>

          <BloqueoEscritura otroMotivo={esDemo ? "La clínica demo es de solo lectura." : null}>
            <Button
              type="submit"
              disabled={esDemo || guardar.isPending || (!firmaNueva && !cambioRegistro)}
            >
              {guardar.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Guardar firma
            </Button>
          </BloqueoEscritura>
        </form>
      )}
    </section>
  );
}
