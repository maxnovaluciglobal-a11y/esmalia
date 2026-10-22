import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Ban, BookOpen, Download, FileJson, Loader2, Pill } from "lucide-react";
import { toast } from "sonner";

import { EmitirRecetaDialog } from "@/components/recetas/emitir-receta-dialog";
import { VademecumDialog } from "@/components/recetas/vademecum-dialog";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { TituloSeccion } from "@/components/titulo-seccion";
import { Badge } from "@/components/ui/badge";
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
import {
  getRecetaFhir,
  listPatientPrescriptions,
  voidPrescription,
  type RecetaDeFicha,
} from "@/lib/clinical/prescriptions.functions";
import {
  edadEnAnios,
  folioReceta,
  lineaDePosologia,
  nombreConPresentacion,
} from "@/lib/clinical/recetas";
import { getDocumentoEmitido } from "@/lib/documentos/documentos.functions";
import { folioDocumento } from "@/lib/documentos/motor";
import { diaISO, fecha, fechaHora } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

function inputClass() {
  return "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";
}

/** El folio con el que se imprimió: el del documento (MKT-05) o el propio (recetas anteriores). */
function folioDe(r: RecetaDeFicha): string {
  return r.documento
    ? folioDocumento(r.documento.year, r.documento.number)
    : folioReceta(r.year, r.number);
}

/**
 * Recetas del paciente (CLI-13 + MKT-05), en la pestaña Documentos de la
 * ficha. Desde MKT-05 una receta se emite con el motor de documentos
 * (plantilla "Receta", vademécum, alergias, RUT y registro SIS): se abre,
 * se imprime y se descarga como cualquier documento, y además queda
 * estructurada para FHIR. Las recetas anteriores conservan su PDF propio.
 */
export function PatientPrescriptionsCard({
  clinicId,
  patientId,
  patientDocument,
  timezone,
  puedeEmitir,
  esAdministrador,
}: {
  clinicId: string;
  patientId: string;
  patientDocument: string | null;
  timezone: string;
  /** owner/admin/dentist con escritura clínica (el servidor y la base lo vuelven a exigir). */
  puedeEmitir: boolean;
  /** owner o admin: anulan cualquier receta; el resto, solo las propias (lo exige la base). */
  esAdministrador: boolean;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const fetchRecetas = useServerFn(listPatientPrescriptions);
  const cargarDocumento = useServerFn(getDocumentoEmitido);
  const cargarFhir = useServerFn(getRecetaFhir);
  const doVoid = useServerFn(voidPrescription);

  const [emitiendo, setEmitiendo] = useState(false);
  const [viendoVademecum, setViendoVademecum] = useState(false);
  const [anular, setAnular] = useState<RecetaDeFicha | null>(null);
  const [motivo, setMotivo] = useState("");
  const [descargando, setDescargando] = useState<string | null>(null);

  const queryKey = ["patient-prescriptions", clinicId, patientId];
  const recetasQuery = useQuery({
    queryKey,
    queryFn: () => fetchRecetas({ data: { clinicId, patientId } }),
  });

  const voidMutation = useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      doVoid({ data: { clinicId, prescriptionId: params.id, reason: params.reason } }),
    onSuccess: async () => {
      toast.success("Receta anulada.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ["documentos-emitidos", clinicId] }),
      ]);
      setAnular(null);
      setMotivo("");
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  async function descargar(r: RecetaDeFicha) {
    setDescargando(r.id);
    try {
      if (r.documento) {
        const documentId = r.documento.id;
        const d = await queryClient.fetchQuery({
          queryKey: ["documento-emitido", clinicId, documentId],
          queryFn: () => cargarDocumento({ data: { clinicId, documentId } }),
        });
        if (!d.bloques) throw new Error("No podemos generar el PDF de esta receta.");
        const { descargarDocumentoPdf } = await import("@/lib/documentos/pdf");
        await descargarDocumentoPdf({ ...d, bloques: d.bloques });
        return;
      }
      // Receta anterior a MKT-05: su PDF propio.
      const { descargarRecetaPdf } = await import("@/lib/clinical/receta-pdf");
      await descargarRecetaPdf({
        receta: r,
        fecha: fecha(r.issuedAt, timezone),
        edad: edadEnAnios(r.patientBirthDate, diaISO(r.issuedAt, timezone) ?? ""),
        documentoPaciente: r.patientDocument ?? patientDocument,
        firmaUrl: r.signatureUrl,
      });
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setDescargando(null);
    }
  }

  async function descargarFhir(r: RecetaDeFicha) {
    try {
      const { nombre, json } = await cargarFhir({ data: { clinicId, prescriptionId: r.id } });
      const url = URL.createObjectURL(new Blob([json], { type: "application/fhir+json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(mensajeDeError(e));
    }
  }

  const data = recetasQuery.data;
  const recetas = data?.recetas ?? [];

  return (
    <section className="card-clinical p-6" aria-labelledby={`${fid}-titulo`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <TituloSeccion id={`${fid}-titulo`}>Recetas</TituloSeccion>
          <p className="text-xs text-muted-foreground">
            Con el vademécum, el aviso de alergias y tu registro de la Superintendencia de Salud.
            Una receta emitida no se edita: si hay un error, se anula y se emite otra.
          </p>
        </div>
        {data?.disponible && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setViendoVademecum(true)}>
              <BookOpen aria-hidden /> Vademécum
            </Button>
            {puedeEmitir && (
              <BloqueoEscritura>
                <Button size="sm" onClick={() => setEmitiendo(true)}>
                  <Pill aria-hidden /> Nueva receta
                </Button>
              </BloqueoEscritura>
            )}
          </div>
        )}
      </div>

      {recetasQuery.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
        </p>
      ) : recetasQuery.isError ? (
        <p className="text-sm text-destructive">No pudimos cargar las recetas.</p>
      ) : data && !data.disponible ? (
        <p className="text-sm text-muted-foreground">
          Las recetas se activan cuando se aplique la actualización de la base de datos.
        </p>
      ) : recetas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin recetas emitidas todavía.</p>
      ) : (
        <ul className="divide-y divide-hairline border-y border-border">
          {recetas.map((r) => {
            const folio = folioDe(r);
            return (
              <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
                <Pill className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {r.documento ? (
                      <Link
                        to="/documentos/$documentoId"
                        params={{ documentoId: r.documento.id }}
                        className={cn(
                          "hover:underline",
                          r.voidedAt && "text-muted-foreground line-through",
                        )}
                      >
                        Receta <span className="cifra">{folio}</span>
                      </Link>
                    ) : (
                      <span className={cn(r.voidedAt && "text-muted-foreground line-through")}>
                        Receta <span className="cifra">{folio}</span>
                      </span>
                    )}
                    {r.voidedAt && <Badge variant="outline">Anulada</Badge>}
                    {r.allergyAlerts.length > 0 && (
                      <Badge variant="outline" title={r.allergyAlerts.join("\n")}>
                        Alergia confirmada
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fechaHora(r.issuedAt, timezone)} · {r.professionalName} ·{" "}
                    {r.professionalSis
                      ? `Reg. SIS ${r.professionalSis}`
                      : `Reg. ${r.professionalLicense}`}
                    {r.deOtraFicha ? " · de una ficha fusionada" : ""}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {r.items.map((it, i) => (
                      <li key={i}>
                        <span className="font-medium">{nombreConPresentacion(it)}</span>:{" "}
                        {lineaDePosologia(it)}
                      </li>
                    ))}
                  </ul>
                  {r.voidedAt && (
                    <p className="mt-1 text-xs text-destructive">
                      Anulada el {fecha(r.voidedAt, timezone)}
                      {r.voidReason ? `: ${r.voidReason}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.documento && (
                    <Button asChild variant="outline" size="sm">
                      <Link to="/documentos/$documentoId" params={{ documentoId: r.documento.id }}>
                        Ver e imprimir
                      </Link>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void descargar(r)}
                    disabled={descargando === r.id}
                    aria-label={`Descargar PDF de la receta ${folio}`}
                  >
                    {descargando === r.id ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Download aria-hidden />
                    )}
                    PDF
                  </Button>
                  {r.documento && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void descargarFhir(r)}
                      aria-label={`Descargar la receta ${folio} en formato FHIR`}
                    >
                      <FileJson aria-hidden /> FHIR
                    </Button>
                  )}
                  {puedeEmitir && !r.voidedAt && (esAdministrador || r.emitidaPorMi) && (
                    <BloqueoEscritura>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAnular(r)}
                        aria-label={`Anular la receta ${folio}`}
                      >
                        <Ban aria-hidden /> Anular
                      </Button>
                    </BloqueoEscritura>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {puedeEmitir && (
        <EmitirRecetaDialog
          abierto={emitiendo}
          onCerrar={() => setEmitiendo(false)}
          clinicId={clinicId}
          patientId={patientId}
        />
      )}
      <VademecumDialog
        abierto={viendoVademecum}
        onCerrar={() => setViendoVademecum(false)}
        clinicId={clinicId}
        puedeEditar={puedeEmitir}
      />

      <Dialog
        open={anular !== null}
        onOpenChange={(next) => {
          if (!next) {
            setAnular(null);
            setMotivo("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular receta {anular ? folioDe(anular) : ""}</DialogTitle>
            <DialogDescription>
              La receta queda en la ficha marcada como anulada, con el motivo, y su documento
              también. No se borra.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-motivo`}>Motivo</Label>
            <input
              id={`${fid}-motivo`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className={inputClass()}
              placeholder="Ej. Error en la dosis"
              maxLength={300}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={voidMutation.isPending || motivo.trim().length < 3}
              onClick={() => anular && voidMutation.mutate({ id: anular.id, reason: motivo })}
            >
              {voidMutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Anular receta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
