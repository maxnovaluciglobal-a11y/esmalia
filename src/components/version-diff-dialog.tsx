import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, GitCompare, X } from "lucide-react";
import { diffLineas, resumenDiff } from "@/lib/clinical/note-diff";
import { formatoFechaHora, type ClinicalNoteVersionMeta } from "@/lib/clinical/clinical-notes";
import { getNoteVersionContents } from "@/lib/clinical/clinical-notes.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

interface Props {
  clinicId: string;
  noteId: string;
  /** Historial de la nota (metadatos): alimenta los selectores. */
  versiones: ClinicalNoteVersionMeta[];
  desde?: number | null;
  hasta?: number | null;
  onClose: () => void;
}

/**
 * Comparador de contenido entre dos versiones de la nota clínica. El
 * contenido completo de las versiones se pide recién acá: la ficha solo
 * carga metadatos (auditoría de rendimiento, 20-oct-2026).
 */
export function VersionDiffDialog({ clinicId, noteId, versiones, desde, hasta, onClose }: Props) {
  const ordenadas = useMemo(
    () => [...versiones].sort((a, b) => a.version - b.version),
    [versiones],
  );
  const ultima = ordenadas[ordenadas.length - 1]?.version ?? 1;
  const penultima = ordenadas[ordenadas.length - 2]?.version ?? ultima;

  const [a, setA] = useState<number>(desde ?? penultima);
  const [b, setB] = useState<number>(hasta ?? ultima);

  // La última versión va en la clave: si se guarda una nueva, no se reusa un
  // contenido cacheado que todavía no la tiene.
  const fetchContenidos = useServerFn(getNoteVersionContents);
  const contenidos = useQuery({
    queryKey: ["clinical-note-version-contents", clinicId, noteId, ultima],
    queryFn: () => fetchContenidos({ data: { clinicId, noteId } }),
  });
  const contenidoPorVersion = useMemo(
    () => new Map((contenidos.data ?? []).map((v) => [v.version, v.content])),
    [contenidos.data],
  );

  const contenidoA = contenidoPorVersion.get(a) ?? "";
  const contenidoB = contenidoPorVersion.get(b) ?? "";
  const lineas = useMemo(() => diffLineas(contenidoA, contenidoB), [contenidoA, contenidoB]);
  const conteo = resumenDiff(lineas);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-hairline bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <GitCompare className="size-4 text-brand" /> Comparar versiones
          </p>
          <button onClick={onClose} aria-label="Cerrar" className="rounded p-1 hover:bg-secondary">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-3 text-xs">
          <select
            value={a}
            onChange={(e) => setA(Number(e.target.value))}
            className="rounded-lg border border-hairline bg-background px-2 py-1.5"
          >
            {ordenadas.map((v) => (
              <option key={v.id} value={v.version}>
                v{v.version} · {formatoFechaHora(v.createdAt)}
              </option>
            ))}
          </select>
          <ArrowRight className="size-3.5 text-muted-foreground" />
          <select
            value={b}
            onChange={(e) => setB(Number(e.target.value))}
            className="rounded-lg border border-hairline bg-background px-2 py-1.5"
          >
            {ordenadas.map((v) => (
              <option key={v.id} value={v.version}>
                v{v.version} · {formatoFechaHora(v.createdAt)}
              </option>
            ))}
          </select>
          <span className="ml-auto text-xs text-muted-foreground">
            <span className="text-brand-700">+{conteo.agregadas}</span> ·{" "}
            <span className="text-destructive">−{conteo.eliminadas}</span> líneas
          </span>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {contenidos.isLoading ? (
            <p className="text-xs text-muted-foreground">Cargando el contenido de las versiones…</p>
          ) : contenidos.isError ? (
            <p className="text-xs text-destructive">{mensajeDeError(contenidos.error)}</p>
          ) : conteo.agregadas === 0 && conteo.eliminadas === 0 ? (
            <p className="text-xs text-muted-foreground">
              No hay diferencias de contenido entre estas dos versiones.
            </p>
          ) : (
            <div className="space-y-0.5 font-mono text-xs leading-relaxed">
              {lineas.map((l, i) => (
                <div
                  key={i}
                  className={`whitespace-pre-wrap rounded px-2 py-0.5 ${
                    l.kind === "added"
                      ? "bg-brand-soft text-foreground"
                      : l.kind === "removed"
                        ? "bg-destructive/10 text-muted-foreground line-through"
                        : "text-muted-foreground"
                  }`}
                >
                  <span className="mr-2 select-none opacity-60">
                    {l.kind === "added" ? "+" : l.kind === "removed" ? "−" : " "}
                  </span>
                  {l.text || " "}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-hairline px-5 py-3 text-[11px] text-muted-foreground">
          Comparación de contenido clínico. Las versiones son inmutables y quedan registradas en la
          auditoría.
        </div>
      </div>
    </div>
  );
}
