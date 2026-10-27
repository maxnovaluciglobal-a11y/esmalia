/**
 * IMG-02 · Antes y después: dos fotos clínicas lado a lado o superpuestas con
 * un deslizador. Por defecto, la primera foto de la sesión "antes" (o de la
 * más antigua) contra la última de la sesión "después" (o de la más nueva).
 * Las imágenes se piden en resolución completa recién al abrir.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { CLASE_CAMPO } from "@/components/cita-formulario";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  urlDeExamen,
  type ExamenDeFicha,
  type SesionDeFotos,
} from "@/lib/examenes/examenes.functions";
import { parPorDefecto } from "@/lib/examenes/antes-despues";
import { ETIQUETA_ETAPA } from "@/lib/examenes/tipos";
import { fecha } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

type Modo = "lado" | "deslizador";

function etiquetaFoto(f: ExamenDeFicha, sesiones: Map<string, SesionDeFotos>): string {
  const s = f.photoSessionId ? sesiones.get(f.photoSessionId) : undefined;
  const etapa = s?.stage ? ` · ${ETIQUETA_ETAPA[s.stage]}` : "";
  return `${fecha(f.takenOn)}${s ? ` · ${s.reason}` : ""}${etapa} · ${f.filename}`;
}

export function CompararAntesDespues({
  abierto,
  onCerrar,
  clinicId,
  fotos,
  sesiones,
}: {
  abierto: boolean;
  onCerrar: () => void;
  clinicId: string;
  fotos: ExamenDeFicha[];
  sesiones: SesionDeFotos[];
}) {
  const id = useId();
  const pedir = useServerFn(urlDeExamen);
  const porSesion = useMemo(() => new Map(sesiones.map((s) => [s.id, s])), [sesiones]);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [modo, setModo] = useState<Modo>("lado");
  const [corte, setCorte] = useState(50);

  useEffect(() => {
    if (!abierto) return;
    const par = parPorDefecto(fotos, sesiones);
    if (par) {
      setAId(par[0]);
      setBId(par[1]);
    }
    setCorte(50);
  }, [abierto, fotos, sesiones]);

  const urlDe = (examId: string) => ({
    queryKey: ["examen-url", clinicId, examId],
    queryFn: async () => (await pedir({ data: { clinicId, examId } })).url,
    enabled: abierto && Boolean(examId),
    staleTime: 4 * 60 * 1000,
  });
  const urlA = useQuery(urlDe(aId));
  const urlB = useQuery(urlDe(bId));
  const fotoA = fotos.find((f) => f.id === aId);
  const fotoB = fotos.find((f) => f.id === bId);

  const imagen = (url: string | undefined, alt: string, extra?: string) =>
    url ? (
      <img
        src={url}
        alt={alt}
        className={cn("h-full w-full object-contain", extra)}
        draggable={false}
      />
    ) : (
      <span className="grid h-full place-items-center text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-label="Cargando foto" />
      </span>
    );

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-medium">
            Antes <em className="text-brand-600">y después</em>
          </DialogTitle>
          <DialogDescription>Elige dos fotos clínicas para compararlas.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-a`}>Antes</Label>
            <select
              id={`${id}-a`}
              value={aId}
              onChange={(e) => setAId(e.target.value)}
              className={CLASE_CAMPO}
            >
              {fotos.map((f) => (
                <option key={f.id} value={f.id}>
                  {etiquetaFoto(f, porSesion)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-b`}>Después</Label>
            <select
              id={`${id}-b`}
              value={bId}
              onChange={(e) => setBId(e.target.value)}
              className={CLASE_CAMPO}
            >
              {fotos.map((f) => (
                <option key={f.id} value={f.id}>
                  {etiquetaFoto(f, porSesion)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          role="radiogroup"
          aria-label="Forma de comparar"
          className="flex w-fit rounded-full border border-control p-0.5 text-sm"
        >
          {(
            [
              ["lado", "Lado a lado"],
              ["deslizador", "Deslizador"],
            ] as const
          ).map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={modo === valor}
              onClick={() => setModo(valor)}
              className={cn(
                "h-8 rounded-full px-3.5 font-semibold pointer-coarse:h-10",
                modo === valor ? "bg-foreground text-background" : "text-muted-foreground",
              )}
            >
              {texto}
            </button>
          ))}
        </div>

        {modo === "lado" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { f: fotoA, url: urlA.data, rotulo: "Antes" },
              { f: fotoB, url: urlB.data, rotulo: "Después" },
            ].map(({ f, url, rotulo }) => (
              <figure
                key={rotulo}
                className="overflow-hidden rounded-[14px] border border-border bg-muted/40"
              >
                <div className="aspect-[4/3]">{imagen(url, `${rotulo}: ${f?.filename ?? ""}`)}</div>
                <figcaption className="border-t border-border px-3 py-2 text-sm">
                  <span className="font-semibold">{rotulo}</span>
                  {f && <span className="text-muted-foreground"> · {fecha(f.takenOn)}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative mx-auto aspect-[4/3] w-full max-w-[calc(62dvh*4/3)] overflow-hidden rounded-[14px] border border-border bg-muted/40 select-none">
              <div className="absolute inset-0">
                {imagen(urlB.data, `Después: ${fotoB?.filename ?? ""}`)}
              </div>
              <div
                className="absolute inset-0"
                style={{ clipPath: `inset(0 ${100 - corte}% 0 0)` }}
              >
                {imagen(urlA.data, `Antes: ${fotoA?.filename ?? ""}`)}
              </div>
              <div
                aria-hidden
                className="absolute inset-y-0 w-0.5 bg-background shadow-[0_0_0_1px_var(--color-foreground)]"
                style={{ left: `${corte}%` }}
              />
              <span className="absolute top-2 left-2 rounded-full bg-foreground/80 px-2 py-0.5 text-xs font-semibold text-background">
                Antes
              </span>
              <span className="absolute top-2 right-2 rounded-full bg-foreground/80 px-2 py-0.5 text-xs font-semibold text-background">
                Después
              </span>
            </div>
            <label className="block text-sm">
              <span className="sr-only">Mover el corte entre antes y después</span>
              <input
                type="range"
                min={0}
                max={100}
                value={corte}
                onChange={(e) => setCorte(Number(e.target.value))}
                className="w-full accent-[var(--color-foreground)]"
                aria-valuetext={`${corte} % antes`}
              />
            </label>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
