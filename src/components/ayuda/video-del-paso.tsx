import { PlayCircle } from "lucide-react";

import { EspacioVideo } from "@/components/ayuda/espacio-video";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AYUDA_PUESTA_EN_MARCHA,
  type IdPasoPuestaEnMarcha,
} from "@/content/ayuda/puesta-en-marcha";

/**
 * ONB-01: el espacio de video de un paso del checklist "Activa tu clínica".
 * Un botón chico al lado del paso abre el texto y el video (o "Video
 * pendiente" mientras Walter no lo grabe).
 */
export function VideoDelPaso({ id }: { id: IdPasoPuestaEnMarcha }) {
  const ayuda = AYUDA_PUESTA_EN_MARCHA[id];
  return (
    <Dialog>
      <DialogTrigger
        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-8"
        aria-label={`Cómo se hace: ${ayuda.titulo}`}
      >
        <PlayCircle aria-hidden className="size-3.5" />
        <span className="hidden sm:inline">Ver cómo</span>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-medium">{ayuda.titulo}</DialogTitle>
          <DialogDescription className="text-[15px]">{ayuda.texto}</DialogDescription>
        </DialogHeader>
        <EspacioVideo video={ayuda.video} titulo={ayuda.titulo} />
      </DialogContent>
    </Dialog>
  );
}
