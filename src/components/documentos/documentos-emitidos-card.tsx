import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Ban, Download, FileText, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { AnularDocumentoDialog } from "@/components/documentos/anular-documento-dialog";
import { EmitirDocumentoDialog } from "@/components/documentos/emitir-documento-dialog";
import { ErrorDeCarga } from "@/components/estado-error";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getDocumentoEmitido,
  listDocumentosDelPaciente,
  type DocumentoEmitidoResumen,
} from "@/lib/documentos/documentos.functions";
import { folioDocumento } from "@/lib/documentos/motor";
import { TIPOS_CON_FLUJO_PROPIO } from "@/lib/documentos/tipos";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Documentos emitidos del paciente (DOC-01, DOC-07, DOC-08), en la pestaña
 * Documentos de la ficha: emitir, abrir (imprimir), descargar el PDF y
 * anular. Los anulados quedan en la lista, tachados y con el motivo.
 *
 * Copia al paciente: por ahora se descarga o se imprime. El portal de
 * pacientes todavía no sirve documentos, así que no hay link para mandar por
 * WhatsApp; el envío por correo llega en la tanda siguiente.
 */
export function DocumentosEmitidosCard({
  clinicId,
  patientId,
  timezone,
  puedeEmitir,
  esAdministrador,
}: {
  clinicId: string;
  patientId: string;
  timezone: string;
  /** owner, admin o dentist con escritura clínica (la base lo vuelve a exigir). */
  puedeEmitir: boolean;
  /** owner o admin: anulan cualquier documento; el resto, solo los propios (lo exige la base). */
  esAdministrador: boolean;
}) {
  const listar = useServerFn(listDocumentosDelPaciente);
  const cargarDocumento = useServerFn(getDocumentoEmitido);
  const queryClient = useQueryClient();
  const consulta = useQuery({
    queryKey: ["documentos-emitidos", clinicId, patientId],
    queryFn: () => listar({ data: { clinicId, patientId } }),
  });
  const [emitiendo, setEmitiendo] = useState(false);
  const [anulando, setAnulando] = useState<DocumentoEmitidoResumen | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);

  async function descargar(id: string) {
    setDescargando(id);
    try {
      const d = await queryClient.fetchQuery({
        queryKey: ["documento-emitido", clinicId, id],
        queryFn: () => cargarDocumento({ data: { clinicId, documentId: id } }),
      });
      if (!d.bloques) throw new Error("No podemos generar el PDF de este documento.");
      const { descargarDocumentoPdf } = await import("@/lib/documentos/pdf");
      await descargarDocumentoPdf({ ...d, bloques: d.bloques });
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setDescargando(null);
    }
  }

  // MKT-05: las recetas se listan (y se emiten) en su propia tarjeta.
  const documentos = (consulta.data ?? []).filter((d) => !TIPOS_CON_FLUJO_PROPIO.includes(d.kind));

  return (
    <section aria-labelledby="documentos-emitidos" className="rounded-lg border border-border p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="documentos-emitidos" className="font-display text-xl font-semibold">
            Certificados e informes
          </h3>
          <p className="text-sm text-muted-foreground">
            Certificados, reposos, derivaciones, altas, informes y el detalle para el reembolso del
            seguro, con los datos de la ficha y tu firma.
          </p>
        </div>
        {puedeEmitir && (
          <BloqueoEscritura>
            <Button size="sm" onClick={() => setEmitiendo(true)}>
              <Plus aria-hidden /> Emitir documento
            </Button>
          </BloqueoEscritura>
        )}
      </div>

      {consulta.isError ? (
        <ErrorDeCarga
          onReintentar={() => consulta.refetch()}
          reintentando={consulta.isFetching}
          mensaje="No pudimos cargar los documentos emitidos."
        />
      ) : consulta.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
        </p>
      ) : documentos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay documentos emitidos.</p>
      ) : (
        <ul className="divide-y divide-hairline border-y border-border">
          {documentos.map((d) => {
            const folio = folioDocumento(d.year, d.number);
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Link
                    to="/documentos/$documentoId"
                    params={{ documentoId: d.id }}
                    className={cn(
                      "font-medium hover:underline",
                      d.voidedAt && "text-muted-foreground line-through",
                    )}
                  >
                    {d.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    <span className="cifra">{folio}</span> · {fecha(d.issuedAt, timezone)} ·{" "}
                    {d.professionalName}
                    {d.deOtraFicha ? " · de una ficha fusionada" : ""}
                  </p>
                  {d.voidedAt && (
                    <p className="text-xs text-destructive">
                      Anulado el {fecha(d.voidedAt, timezone)}
                      {d.voidReason ? `: ${d.voidReason}` : ""}
                    </p>
                  )}
                </div>
                {d.voidedAt && <Badge variant="outline">Anulado</Badge>}
                <div className="flex flex-wrap gap-1.5">
                  <Button asChild variant="outline" size="sm">
                    <Link to="/documentos/$documentoId" params={{ documentoId: d.id }}>
                      Ver e imprimir
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void descargar(d.id)}
                    disabled={descargando === d.id}
                    aria-label={`Descargar PDF de ${d.title} ${folio}`}
                  >
                    {descargando === d.id ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Download aria-hidden />
                    )}
                    PDF
                  </Button>
                  {puedeEmitir && !d.voidedAt && (esAdministrador || d.emitidoPorMi) && (
                    <BloqueoEscritura>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAnulando(d)}
                        aria-label={`Anular ${d.title} ${folio}`}
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

      <p className="mt-3 text-xs text-muted-foreground">
        Para darle una copia al paciente, descárgala o imprímela. Un documento emitido no se borra:
        se anula con el motivo y queda en la ficha.
      </p>

      {puedeEmitir && (
        <EmitirDocumentoDialog
          abierto={emitiendo}
          onCerrar={() => setEmitiendo(false)}
          clinicId={clinicId}
          patientId={patientId}
          timezone={timezone}
        />
      )}
      {anulando && (
        <AnularDocumentoDialog
          abierto
          onCerrar={() => setAnulando(null)}
          clinicId={clinicId}
          documento={{
            id: anulando.id,
            title: anulando.title,
            folio: folioDocumento(anulando.year, anulando.number),
          }}
        />
      )}
    </section>
  );
}
