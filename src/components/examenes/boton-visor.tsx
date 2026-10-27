/**
 * "Ver en 3D" / "Ver DICOM": punto de integración con el visor del frente B
 * (ver `contrato-visor.ts`). Sin el visor todavía, el botón queda
 * deshabilitado con el motivo a la vista.
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Box, Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { urlDeExamen } from "@/lib/examenes/examenes.functions";
import type { FormatoVisor } from "@/lib/examenes/tipos";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

import { cargarVisor, MOTIVO_VISOR_PENDIENTE } from "./contrato-visor";

const CLASE_BOTON =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-control px-3 text-[13px] font-semibold pointer-coarse:h-11";

const VisorPerezoso = cargarVisor
  ? lazy(async () => {
      const m = await cargarVisor!();
      if (!m.VisorDeExamen) throw new Error("El visor no exporta VisorDeExamen.");
      return { default: m.VisorDeExamen };
    })
  : null;

export function BotonVisor({
  clinicId,
  examId,
  formato,
  nombre,
}: {
  clinicId: string;
  examId: string;
  formato: FormatoVisor;
  nombre: string;
}) {
  const pedir = useServerFn(urlDeExamen);
  const [url, setUrl] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const etiqueta = formato === "dicom" ? "Ver DICOM" : "Ver en 3D";
  const Icono = formato === "dicom" ? ScanLine : Box;
  const pedirUrl = useMemo(
    () => async () => (await pedir({ data: { clinicId, examId } })).url,
    [pedir, clinicId, examId],
  );

  if (!VisorPerezoso) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <button
          type="button"
          disabled
          aria-describedby={`visor-pendiente-${examId}`}
          className={cn(CLASE_BOTON, "cursor-not-allowed text-muted-foreground opacity-70")}
        >
          <Icono className="size-3.5" aria-hidden /> {etiqueta}
        </button>
        <span id={`visor-pendiente-${examId}`} className="text-xs text-muted-foreground">
          {MOTIVO_VISOR_PENDIENTE}
        </span>
      </span>
    );
  }

  async function abrir() {
    setCargando(true);
    try {
      setUrl(await pedirUrl());
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        disabled={cargando}
        className={cn(CLASE_BOTON, "hover:border-foreground")}
      >
        {cargando ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Icono className="size-3.5" aria-hidden />
        )}
        {etiqueta}
      </button>
      <Dialog open={url !== null} onOpenChange={(abierto) => !abierto && setUrl(null)}>
        <DialogContent className="h-[90dvh] max-w-[min(1200px,96vw)] p-3 sm:p-4">
          <DialogTitle className="sr-only">
            {etiqueta}: {nombre}
          </DialogTitle>
          {url && (
            <Suspense
              fallback={
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando el visor…
                </p>
              }
            >
              <VisorPerezoso
                tipo={formato}
                url={url}
                nombre={nombre}
                onCerrar={() => setUrl(null)}
                pedirUrl={pedirUrl}
              />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
