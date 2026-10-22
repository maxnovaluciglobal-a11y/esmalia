import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, FileImage, Loader2, ScanLine, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  archivePatientDocument,
  listPatientDocuments,
  uploadPatientDocument,
  type PatientDocument,
} from "@/lib/clinical/clinical-documents.functions";
import { useZonaClinica } from "@/hooks/use-zona-clinica";
import { fecha } from "@/lib/formato-fecha";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatFecha(iso: string, zona?: string): string {
  return fecha(iso, zona);
}

export function PatientDocumentsCard({
  clinicId,
  patientId,
  puedeEditar,
}: {
  clinicId: string;
  patientId: string;
  puedeEditar: boolean;
}) {
  const queryClient = useQueryClient();
  const zona = useZonaClinica();
  const fetchDocuments = useServerFn(listPatientDocuments);
  const uploadDocument = useServerFn(uploadPatientDocument);
  const archiveDocument = useServerFn(archivePatientDocument);
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<"image" | "radiograph">("image");
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const queryKey = ["patient-documents", clinicId, patientId];

  const documentsQuery = useQuery({
    queryKey,
    queryFn: () => fetchDocuments({ data: { clinicId, patientId } }),
  });

  const uploadMutation = useMutation({
    mutationFn: (params: { filename: string; dataUrl: string; kind: "image" | "radiograph" }) =>
      uploadDocument({
        data: {
          clinicId,
          patientId,
          kind: params.kind,
          filename: params.filename,
          dataUrl: params.dataUrl,
        },
      }),
    onSuccess: () => {
      toast.success("Documento subido.");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo subir."),
  });

  const archiveMutation = useMutation({
    mutationFn: (documentId: string) => archiveDocument({ data: { clinicId, documentId } }),
    onSuccess: () => {
      toast.success("Documento archivado.");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo archivar."),
    onSettled: () => setConfirmArchiveId(null),
  });

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error("El archivo supera el máximo de 15MB.");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    uploadMutation.mutate({ filename: file.name, dataUrl, kind });
  }

  const documentos = (documentsQuery.data ?? []).filter((d) => !d.archivedAt);

  return (
    <div className="card-clinical p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Documentos clínicos</h3>
          <p className="text-xs text-muted-foreground">
            Fotos intraorales y radiografías del paciente.
          </p>
        </div>
        {puedeEditar && (
          <div className="flex items-center gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "image" | "radiograph")}
              className="rounded-lg border border-hairline bg-transparent px-2 py-1.5 text-xs outline-none"
            >
              <option value="image">Foto</option>
              <option value="radiograph">Radiografía</option>
            </select>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={handleFileSelected}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              Subir
            </Button>
          </div>
        )}
      </div>

      {documentsQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : documentos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin documentos todavía.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {documentos.map((doc: PatientDocument) => (
            <div
              key={doc.id}
              className="group relative overflow-hidden rounded-xl border border-hairline"
            >
              {doc.url && doc.filename.match(/\.(jpe?g|png|webp)$/i) ? (
                <a href={doc.url} target="_blank" rel="noreferrer">
                  <img
                    src={doc.url}
                    alt={doc.filename}
                    className="aspect-square w-full object-cover"
                  />
                </a>
              ) : (
                <a
                  href={doc.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-secondary/40 text-muted-foreground"
                >
                  {doc.kind === "radiograph" ? (
                    <ScanLine className="size-6" />
                  ) : (
                    <FileImage className="size-6" />
                  )}
                  <span className="px-2 text-center text-[11px]">{doc.filename}</span>
                </a>
              )}
              <div className="flex items-center justify-between gap-1 bg-surface/90 px-2 py-1.5 text-[11px] text-muted-foreground">
                <span>{formatFecha(doc.createdAt, zona)}</span>
                {puedeEditar && (
                  <button
                    type="button"
                    title="Archivar"
                    aria-label={`Archivar documento ${doc.filename}`}
                    onClick={() => setConfirmArchiveId(doc.id)}
                    className="opacity-100 transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                  >
                    <Archive className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={confirmArchiveId !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmArchiveId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archivar documento</AlertDialogTitle>
            <AlertDialogDescription>
              El documento deja de verse en esta ficha. No se elimina, pero deja de tenerlo a la
              vista para el trabajo diario. ¿Confirmas archivarlo?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmArchiveId) archiveMutation.mutate(confirmArchiveId);
              }}
            >
              {archiveMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Archivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
