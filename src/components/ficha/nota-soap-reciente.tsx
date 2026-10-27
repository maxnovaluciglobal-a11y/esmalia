import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, FilePlus2, NotebookPen, ShieldCheck } from "lucide-react";

import { PattyChecklist } from "@/components/ficha/patty-checklist";
import { SoapLectura } from "@/components/ficha/soap-lectura";
import { useZonaClinica } from "@/hooks/use-zona-clinica";
import { getEstadoIa } from "@/lib/ai/estado.functions";
import { getNoteVersionContents, getPatientNotes } from "@/lib/clinical/clinical-notes.functions";
import { fechaCorta, fechaCortaHora } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

/**
 * Última nota clínica en la pestaña de entrada de la ficha (A+): la nota con
 * la jerarquía SOAP del prototipo, sus versiones (v1, v2, v3 firmada), la
 * firma, las adendas y "Agregar adenda". Es una vista de lectura: escribir,
 * firmar y agregar la adenda se hacen en la pestaña "Notas", a la que llevan
 * los botones. Comparte la query de `NotasClinicas` (`clinical-notes`), así
 * que pasar de una pestaña a la otra no vuelve a pedir las notas.
 */
export function NotaSoapReciente({
  clinicId,
  patientId,
  puedeEditar,
  onAbrirNotas,
}: {
  clinicId: string;
  patientId: string;
  puedeEditar: boolean;
  /** Lleva a la pestaña Notas; con `adenda`, deja lista una adenda a esa nota. */
  onAbrirNotas: (destino?: { noteId: string; adenda: boolean }) => void;
}) {
  const zona = useZonaClinica();
  const fetchNotes = useServerFn(getPatientNotes);
  const fetchContenidos = useServerFn(getNoteVersionContents);
  const estadoIaFn = useServerFn(getEstadoIa);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["clinical-notes", clinicId, patientId],
    queryFn: () => fetchNotes({ data: { clinicId, patientRef: patientId } }),
  });
  const { data: estadoIa } = useQuery({
    queryKey: ["estado-ia"],
    queryFn: () => estadoIaFn(),
    staleTime: 5 * 60_000,
  });

  // La nota más reciente que no es una adenda (llegan por última modificación).
  const nota = useMemo(() => (data?.notes ?? []).find((n) => !n.addendumOf) ?? null, [data]);
  const adendas = useMemo(
    () =>
      nota
        ? (data?.notes ?? [])
            .filter((n) => n.addendumOf === nota.id)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : [],
    [data, nota],
  );
  const versiones = useMemo(
    () =>
      nota
        ? (data?.versions ?? [])
            .filter((v) => v.noteId === nota.id)
            .sort((a, b) => a.version - b.version)
        : [],
    [data, nota],
  );
  const [versionVista, setVersionVista] = useState<number | null>(null);
  const vigente = nota?.version ?? null;
  const mirandoAnterior = versionVista != null && versionVista !== vigente;
  const contenidos = useQuery({
    queryKey: ["clinical-note-version-contents", clinicId, nota?.id, vigente],
    queryFn: () => fetchContenidos({ data: { clinicId, noteId: nota!.id } }),
    enabled: Boolean(nota) && mirandoAnterior,
  });
  const contenidoVisto = mirandoAnterior
    ? (contenidos.data?.find((v) => v.version === versionVista)?.content ?? null)
    : (nota?.content ?? null);

  const firmada = nota?.status === "signed";
  const fechaNota = nota ? (nota.signedAt ?? nota.updatedAt) : null;

  return (
    <section
      aria-labelledby="nota-soap-titulo"
      className="rounded-panel border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h3
          id="nota-soap-titulo"
          className="font-display text-[30px] leading-none font-medium tracking-[-0.01em]"
        >
          Nota SOAP{fechaNota ? ` · ${fechaCorta(fechaNota, zona)}` : ""}
        </h3>
        {versiones.length > 1 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Versiones de la nota">
            {versiones.map((v) => {
              const actual = (versionVista ?? vigente) === v.version;
              const esVigente = v.version === vigente;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={actual}
                  onClick={() => setVersionVista(v.version)}
                  className={cn(
                    "cifra h-8 rounded-full border px-3 text-xs",
                    actual
                      ? "border-foreground bg-foreground text-background"
                      : "border-control text-muted-foreground hover:text-foreground",
                  )}
                >
                  v{v.version}
                  {esVigente && firmada ? " firmada" : ""}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-5 pt-3 pb-5">
        {isLoading ? (
          <div className="space-y-2" aria-hidden>
            <span className="block h-4 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <span className="block h-4 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <span className="block h-4 w-5/6 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">No pudimos cargar las notas clínicas.</p>
        ) : !nota ? (
          <div className="space-y-3">
            <p className="text-base text-muted-foreground">
              Este paciente todavía no tiene notas clínicas.
            </p>
            {puedeEditar && (
              <button
                type="button"
                onClick={() => onAbrirNotas()}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-control px-4 text-sm font-semibold hover:border-foreground"
              >
                <NotebookPen className="size-4" aria-hidden /> Escribir la primera nota
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="pb-3 text-sm font-medium">
              {firmada ? (
                <span className="inline-flex items-start gap-1.5 text-success">
                  <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    {nota.signerName ? `Firmada por ${nota.signerName}` : "Firmada"}
                    {nota.signedAt ? ` · ${fechaCortaHora(nota.signedAt, zona)}` : ""} · no se puede
                    sobrescribir
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Borrador · v{nota.version} · {nota.title}
                </span>
              )}
            </p>
            {mirandoAnterior && (
              <p className="mb-3 rounded-lg border border-hairline bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
                Estás viendo la versión {versionVista}, anterior a la vigente. Solo lectura.
              </p>
            )}
            {contenidoVisto == null ? (
              <span className="block h-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            ) : (
              <SoapLectura contenido={contenidoVisto} />
            )}

            {adendas.map((a) => (
              <div
                key={a.id}
                className="mt-4 rounded-xl border border-control/40 bg-background px-4 py-3"
              >
                <p className="text-[13px] font-semibold">
                  Adenda · {fechaCortaHora(a.signedAt ?? a.createdAt, zona)}
                  {a.signerName ? ` · ${a.signerName}` : ""}
                  {a.status !== "signed" ? " · borrador" : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {a.content}
                </p>
              </div>
            ))}

            <div className="mt-4 flex flex-wrap gap-2">
              {puedeEditar && firmada && (
                <button
                  type="button"
                  onClick={() => onAbrirNotas({ noteId: nota.id, adenda: true })}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-control px-4 text-sm font-semibold hover:border-foreground"
                >
                  <FilePlus2 className="size-4" aria-hidden /> Agregar adenda
                </button>
              )}
              <button
                type="button"
                onClick={() => onAbrirNotas({ noteId: nota.id, adenda: false })}
                className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-brand-700 hover:underline"
              >
                {firmada ? (
                  <ShieldCheck className="size-4" aria-hidden />
                ) : (
                  <NotebookPen className="size-4" aria-hidden />
                )}
                {firmada ? "Ver en notas" : "Seguir editando"}
              </button>
            </div>
          </>
        )}

        {puedeEditar && estadoIa?.habilitada !== true && <PattyChecklist className="mt-4" />}
      </div>
    </section>
  );
}
