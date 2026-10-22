import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Ban, Download, Loader2, Printer, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { AnularDocumentoDialog } from "@/components/documentos/anular-documento-dialog";
import documentoImpresionCss from "@/components/documentos/documento-impresion.css?url";
import { HojaDocumento } from "@/components/documentos/hoja-documento";
import { ErrorDeCarga } from "@/components/estado-error";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/access/access";
import { requirePermission } from "@/lib/access/route-guards";
import {
  getDocumentoEmitido,
  type DocumentoEmitidoCompleto,
} from "@/lib/documentos/documentos.functions";
import { huellaCorta, huellaDocumento } from "@/lib/documentos/huella";
import { bloquesAHtml, folioDocumento } from "@/lib/documentos/motor";
import { fechaDocumento, fechaHora } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";

/**
 * Documento emitido (DOC-01, DOC-07, DOC-08): la hoja tal como quedó, para
 * ver, imprimir o guardar como PDF con el navegador, descargar el PDF o
 * anular. Verifica la integridad en el navegador: recalcula la huella
 * sha256 y la compara con la que guardó la base al emitir.
 */
export const Route = createFileRoute("/_authenticated/_clinic/documentos/$documentoId")({
  beforeLoad: requirePermission("clinical:view"),
  head: () => ({
    meta: [{ title: "Documento | Esmalia" }, { name: "robots", content: "noindex" }],
    links: [{ rel: "stylesheet", href: documentoImpresionCss }],
  }),
  component: DocumentoPage,
});

/** El modo oscuro no se imprime: se apaga solo mientras dura la impresión. */
function useImpresionEnClaro() {
  useEffect(() => {
    const raiz = document.documentElement;
    let estabaOscuro = false;
    const antes = () => {
      estabaOscuro = raiz.classList.contains("dark");
      raiz.classList.remove("dark");
    };
    const despues = () => {
      if (estabaOscuro) raiz.classList.add("dark");
    };
    window.addEventListener("beforeprint", antes);
    window.addEventListener("afterprint", despues);
    return () => {
      window.removeEventListener("beforeprint", antes);
      window.removeEventListener("afterprint", despues);
    };
  }, []);
}

type Integridad = "verificando" | "ok" | "alterado";

/** Recalcula la huella y comprueba que el HTML guardado sea el de los bloques. */
function useIntegridad(d: DocumentoEmitidoCompleto | undefined): Integridad {
  const [estado, setEstado] = useState<Integridad>("verificando");
  useEffect(() => {
    if (!d) return;
    let vivo = true;
    void huellaDocumento(d.contentHtml, d.signatureSha256).then((h) => {
      if (!vivo) return;
      const coincideHtml = d.bloques !== null && bloquesAHtml(d.bloques) === d.contentHtml;
      setEstado(h === d.contentSha256 && coincideHtml ? "ok" : "alterado");
    });
    return () => {
      vivo = false;
    };
  }, [d]);
  return estado;
}

function DocumentoPage() {
  const { access } = Route.useRouteContext();
  const { documentoId } = Route.useParams();
  const clinicId = access.clinic!.id;
  const cargar = useServerFn(getDocumentoEmitido);
  const consulta = useQuery({
    queryKey: ["documento-emitido", clinicId, documentoId],
    queryFn: () => cargar({ data: { clinicId, documentId: documentoId } }),
  });
  const d = consulta.data;
  const integridad = useIntegridad(d);
  const [anulando, setAnulando] = useState(false);
  const [descargando, setDescargando] = useState(false);
  useImpresionEnClaro();

  // La base vuelve a exigirlo: quien lo emitió, o un administrador.
  const puedeAnular =
    hasPermission(access.role, "clinical:write") &&
    (access.role === "owner" ||
      access.role === "admin" ||
      (access.role === "dentist" && Boolean(d?.emitidoPorMi)));

  async function descargarPdf() {
    if (!d?.bloques) return;
    setDescargando(true);
    try {
      const { descargarDocumentoPdf } = await import("@/lib/documentos/pdf");
      await descargarDocumentoPdf({ ...d, bloques: d.bloques, timezone: d.timezone });
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setDescargando(false);
    }
  }

  return (
    <AppShell title={d ? d.title : "Documento"} access={access}>
      <div className="documento-emitido mx-auto max-w-4xl space-y-5">
        <div className="no-imprimir flex flex-wrap items-center gap-2">
          {d && (
            <Link
              to="/pacientes/$pacienteId"
              params={{ pacienteId: d.patientId }}
              search={{ pestana: "documentos" }}
              className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
            >
              <ArrowLeft className="size-4" aria-hidden /> Ficha de {d.patientName}
            </Link>
          )}
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!d}>
            <Printer aria-hidden /> Imprimir o guardar como PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void descargarPdf()}
            disabled={!d?.bloques || descargando}
          >
            {descargando ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            Descargar PDF
          </Button>
          {d && !d.voidedAt && puedeAnular && (
            <BloqueoEscritura>
              <Button variant="outline" size="sm" onClick={() => setAnulando(true)}>
                <Ban aria-hidden /> Anular
              </Button>
            </BloqueoEscritura>
          )}
        </div>

        {consulta.isError ? (
          <ErrorDeCarga
            onReintentar={() => consulta.refetch()}
            reintentando={consulta.isFetching}
            mensaje={mensajeDeError(consulta.error)}
          />
        ) : !d ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
          </p>
        ) : (
          <>
            {d.voidedAt && (
              <div
                role="status"
                className="rounded-md border border-destructive-border bg-destructive-soft px-4 py-3 text-sm text-destructive"
              >
                <p className="font-semibold">
                  Documento anulado el {fechaHora(d.voidedAt, d.timezone)}
                  {d.voidedByName ? ` por ${d.voidedByName}` : ""}.
                </p>
                {d.voidReason && <p>Motivo: {d.voidReason}</p>}
              </div>
            )}
            {d.bloques ? (
              <HojaDocumento
                bloques={d.bloques}
                firmaUrl={d.signatureUrl}
                encabezado={<Encabezado d={d} />}
                pie={<Pie d={d} integridad={integridad} />}
              />
            ) : (
              <p className="rounded-md border border-destructive-border bg-destructive-soft px-4 py-3 text-sm text-destructive">
                No podemos mostrar este documento: su contenido guardado no tiene la forma esperada.
              </p>
            )}
            <AnularDocumentoDialog
              abierto={anulando}
              onCerrar={() => setAnulando(false)}
              clinicId={clinicId}
              documento={{ id: d.id, title: d.title, folio: folioDocumento(d.year, d.number) }}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

function Encabezado({ d }: { d: DocumentoEmitidoCompleto }) {
  const fiscal = [d.clinicLegalName, d.clinicTaxId ? `RUT ${d.clinicTaxId}` : null]
    .filter(Boolean)
    .join(" · ");
  const contacto = [d.clinicAddress, d.clinicPhone].filter(Boolean).join(" · ");
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div className="min-w-0">
        <p className="font-display text-xl font-semibold leading-tight">{d.clinicName}</p>
        {fiscal && <p className="text-xs text-muted-foreground">{fiscal}</p>}
        {contacto && <p className="text-xs text-muted-foreground">{contacto}</p>}
      </div>
      <div className="text-xs text-muted-foreground sm:text-right">
        <p className="cifra font-semibold text-foreground">{folioDocumento(d.year, d.number)}</p>
        <p>{fechaDocumento(d.issuedAt, d.timezone)}</p>
        {d.voidedAt && <p className="font-semibold uppercase text-destructive">Anulado</p>}
      </div>
    </header>
  );
}

function Pie({ d, integridad }: { d: DocumentoEmitidoCompleto; integridad: Integridad }) {
  return (
    <footer className="mt-10 space-y-1 border-t border-hairline pt-3 text-[11px] text-muted-foreground">
      <p>
        Emitido el {fechaHora(d.issuedAt, d.timezone)} por {d.professionalName}. Firma simple (Ley
        19.799). Huella SHA-256{" "}
        <span className="cifra break-all">{huellaCorta(d.contentSha256, 32)}</span>
      </p>
      <p className="no-imprimir flex items-center gap-1.5" role="status">
        {integridad === "verificando" ? (
          <>
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Verificando la integridad…
          </>
        ) : integridad === "ok" ? (
          <>
            <ShieldCheck className="size-3.5 text-success" aria-hidden /> Integridad verificada: el
            contenido es el mismo que se emitió.
          </>
        ) : (
          <>
            <ShieldAlert className="size-3.5 text-destructive" aria-hidden />
            <span className="text-destructive">
              La huella no coincide: el contenido guardado no es el que se emitió. Avísanos desde
              Ayuda.
            </span>
          </>
        )}
      </p>
    </footer>
  );
}
