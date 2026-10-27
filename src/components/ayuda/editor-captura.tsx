import { useEffect, useRef, useState } from "react";
import { Droplets, Square, Trash2, Undo2 } from "lucide-react";

import { cn } from "@/lib/utils";

/** Una zona tapada, en coordenadas de la imagen original (0..1). */
type Tapa = { x: number; y: number; w: number; h: number };

const ANCHO_MAX = 1600;

/** Carga una data URL en una imagen. */
function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No pudimos leer la imagen."));
    img.src = src;
  });
}

/** Dibuja la captura con sus tapas (y difuminada, si se pidió) en un canvas. */
function dibujar(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  tapas: readonly Tapa[],
  difuminar: boolean,
  ancho: number,
) {
  const escala = Math.min(1, ancho / img.naturalWidth);
  const w = Math.round(img.naturalWidth * escala);
  const h = Math.round(img.naturalHeight * escala);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (difuminar) {
    // Pixelado: se reduce a 1/24 y se vuelve a agrandar sin suavizar. El
    // texto deja de leerse y la forma de la pantalla se mantiene.
    const pw = Math.max(1, Math.round(w / 24));
    const ph = Math.max(1, Math.round(h / 24));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, pw, ph);
    ctx.drawImage(canvas, 0, 0, pw, ph, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }
  // Tapas en tinta. El color sale del token de la página.
  const tinta =
    getComputedStyle(document.documentElement).getPropertyValue("--night").trim() || "black";
  ctx.fillStyle = tinta;
  for (const t of tapas) ctx.fillRect(t.x * w, t.y * h, t.w * w, t.h * h);
}

/** Exporta la captura final (con las tapas) a JPEG de hasta ~1,5 MB. */
export async function exportarCaptura(
  src: string,
  tapas: readonly Tapa[],
  difuminar: boolean,
): Promise<string> {
  const img = await cargarImagen(src);
  const canvas = document.createElement("canvas");
  dibujar(canvas, img, tapas, difuminar, ANCHO_MAX);
  for (const calidad of [0.8, 0.65, 0.5, 0.35]) {
    const url = canvas.toDataURL("image/jpeg", calidad);
    // base64 ≈ 4/3 de los bytes reales.
    if (url.length * 0.75 < 1_400_000) return url;
  }
  throw new Error("La captura es muy grande. Tapa más zonas o súbela más chica.");
}

export type EstadoCaptura = { src: string; tapas: Tapa[]; difuminar: boolean };

/**
 * Editor de la captura (ONB-09): la persona tapa lo que no quiere mostrar
 * arrastrando sobre la imagen. Para teclado y lector de pantalla hay
 * botones que no dependen del puntero: «Difuminar todo» (el texto deja de
 * leerse) y «Tapar todo».
 */
export function EditorCaptura({
  estado,
  onCambiar,
  onQuitar,
}: {
  estado: EstadoCaptura;
  onCambiar: (estado: EstadoCaptura) => void;
  onQuitar: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [arrastre, setArrastre] = useState<{ x0: number; y0: number; x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    let vivo = true;
    void cargarImagen(estado.src).then((i) => vivo && setImg(i));
    return () => {
      vivo = false;
    };
  }, [estado.src]);

  useEffect(() => {
    if (!img || !canvas.current || !caja.current) return;
    const tapas = arrastre
      ? [
          ...estado.tapas,
          {
            x: Math.min(arrastre.x0, arrastre.x),
            y: Math.min(arrastre.y0, arrastre.y),
            w: Math.abs(arrastre.x - arrastre.x0),
            h: Math.abs(arrastre.y - arrastre.y0),
          },
        ]
      : estado.tapas;
    dibujar(canvas.current, img, tapas, estado.difuminar, caja.current.clientWidth * 2);
  }, [img, estado, arrastre]);

  function punto(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  const BOTON =
    "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] font-semibold hover:border-foreground disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9";

  return (
    <div className="space-y-2.5">
      <div ref={caja} className="overflow-hidden rounded-[10px] border border-hairline">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Captura de la pantalla${estado.tapas.length ? `, con ${estado.tapas.length} zona${estado.tapas.length === 1 ? "" : "s"} tapada${estado.tapas.length === 1 ? "" : "s"}` : ""}${estado.difuminar ? ", difuminada" : ""}`}
          className="block h-auto w-full cursor-crosshair touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = punto(e);
            setArrastre({ x0: p.x, y0: p.y, x: p.x, y: p.y });
          }}
          onPointerMove={(e) => {
            if (!arrastre) return;
            const p = punto(e);
            setArrastre({ ...arrastre, x: p.x, y: p.y });
          }}
          onPointerUp={(e) => {
            if (!arrastre) return;
            // El punto final sale del propio evento (puede no haber habido
            // un pointermove justo antes de soltar).
            const fin = punto(e);
            const t: Tapa = {
              x: Math.min(arrastre.x0, fin.x),
              y: Math.min(arrastre.y0, fin.y),
              w: Math.abs(fin.x - arrastre.x0),
              h: Math.abs(fin.y - arrastre.y0),
            };
            setArrastre(null);
            // Un toque sin arrastrar no tapa nada.
            if (t.w > 0.01 && t.h > 0.01) onCambiar({ ...estado, tapas: [...estado.tapas, t] });
          }}
          onPointerCancel={() => setArrastre(null)}
        />
      </div>
      <p className="text-[13px] text-muted-foreground">
        Arrastra sobre la imagen para tapar una zona.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BOTON}
          disabled={estado.tapas.length === 0}
          onClick={() => onCambiar({ ...estado, tapas: estado.tapas.slice(0, -1) })}
        >
          <Undo2 aria-hidden className="size-3.5" /> Deshacer
        </button>
        <button
          type="button"
          aria-pressed={estado.difuminar}
          className={cn(
            BOTON,
            estado.difuminar && "border-foreground bg-foreground text-background",
          )}
          onClick={() => onCambiar({ ...estado, difuminar: !estado.difuminar })}
        >
          <Droplets aria-hidden className="size-3.5" /> Difuminar todo
        </button>
        <button
          type="button"
          className={BOTON}
          onClick={() => onCambiar({ ...estado, tapas: [{ x: 0, y: 0, w: 1, h: 1 }] })}
        >
          <Square aria-hidden className="size-3.5" /> Tapar todo
        </button>
        <button type="button" className={BOTON} onClick={onQuitar}>
          <Trash2 aria-hidden className="size-3.5" /> Quitar captura
        </button>
      </div>
    </div>
  );
}
