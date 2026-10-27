import { PlayCircle, Video as IconoVideo } from "lucide-react";

import type { Video } from "@/content/ayuda/tipos";
import { cn } from "@/lib/utils";

/**
 * Espacio de video de la ayuda (ONB-01, ONB-02, ONB-04). Los videos los graba
 * o aprueba Walter: mientras no existan, el espacio queda vacío y marcado
 * "Video pendiente" (nunca un video de relleno ni un enlace inventado).
 * Cuando el video exista, `estado: "listo"` con su URL: se reproduce acá
 * mismo (`<video>` del bucket público `videos-ayuda`, permitido en la CSP con
 * `media-src`) y, en la versión compacta, queda como botón que lo abre en
 * otra pestaña.
 */
export function EspacioVideo({
  video,
  titulo,
  compacto = false,
  className,
}: {
  video: Video;
  /** De qué trata, para el lector de pantalla. */
  titulo: string;
  compacto?: boolean;
  className?: string;
}) {
  if (video.estado === "listo" && !compacto) {
    return (
      <figure
        className={cn("w-full overflow-hidden rounded-[12px] border border-border", className)}
      >
        <video
          controls
          preload="metadata"
          playsInline
          src={video.url}
          aria-label={titulo}
          className="aspect-video w-full bg-foreground"
        />
        <figcaption className="px-3 py-2 text-[13px] text-muted-foreground">
          Video · <span className="cifra">{video.duracion}</span> · con subtítulos
        </figcaption>
      </figure>
    );
  }

  if (video.estado === "listo") {
    return (
      <a
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
      >
        <PlayCircle aria-hidden className="size-4 text-brand-700" />
        Ver el video ({video.duracion})<span className="sr-only">: {titulo}</span>
      </a>
    );
  }

  if (compacto) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-dashed border-control px-2.5 py-0.5 text-[12px] font-semibold text-muted-foreground",
          className,
        )}
      >
        <IconoVideo aria-hidden className="size-3.5" />
        Video pendiente
        <span className="sr-only">: {titulo}</span>
      </span>
    );
  }

  return (
    <figure
      className={cn(
        "grid aspect-video w-full place-items-center rounded-[12px] border border-dashed border-control bg-secondary/50 p-4 text-center",
        className,
      )}
    >
      <div>
        <IconoVideo aria-hidden className="mx-auto size-7 text-muted-foreground" />
        <figcaption className="mt-2 text-sm font-semibold text-foreground/80">
          Video pendiente
          <span className="sr-only">: {titulo}</span>
        </figcaption>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Lo estamos preparando · <span className="cifra">{video.duracion}</span>
        </p>
      </div>
    </figure>
  );
}
