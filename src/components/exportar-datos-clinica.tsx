import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { nombreZip } from "@/lib/exportacion/exportacion-clinica";
import {
  firmarArchivosExportacion,
  iniciarExportacionClinica,
  leerTablaExportacion,
} from "@/lib/exportacion/exportacion-clinica.functions";
import { generarExportacion, type AvanceExportacion } from "@/lib/exportacion/generar-exportacion";

interface Props {
  clinicId: string;
  clinicName: string;
  timezone: string;
  isDemo: boolean;
  generadoPor: string;
}

async function descargarBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function guardarZip(zip: Uint8Array, nombre: string) {
  const blob = new Blob([zip as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * "Exportar todos los datos" (CS-04/CON-01). Solo se monta para owner/admin;
 * el servidor vuelve a verificar el rol en cada llamada.
 */
export function ExportarDatosClinica({
  clinicId,
  clinicName,
  timezone,
  isDemo,
  generadoPor,
}: Props) {
  const iniciar = useServerFn(iniciarExportacionClinica);
  const leer = useServerFn(leerTablaExportacion);
  const firmar = useServerFn(firmarArchivosExportacion);
  const [avance, setAvance] = useState<AvanceExportacion | null>(null);
  const enCurso = avance !== null;

  async function exportar() {
    setAvance({ etapa: "registrando", detalle: "Registrando la exportación", hecho: 0, total: 1 });
    try {
      const generadoEn = new Intl.DateTimeFormat("es", {
        timeZone: timezone,
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date());
      const { zip } = await generarExportacion(
        {
          iniciar: (id) => iniciar({ data: { clinicId: id } }),
          leer: (args) => leer({ data: args }),
          firmar: (args) => firmar({ data: args }),
          descargar: descargarBytes,
        },
        { clinicId, clinicaNombre: clinicName, generadoPor, generadoEn, onAvance: setAvance },
      );
      guardarZip(zip, nombreZip(clinicName, hoyISO(timezone)));
      toast.success("Exportación lista", {
        description: "Revisa tu carpeta de descargas. El LEEME.txt explica cada archivo.",
      });
    } catch (e) {
      toast.error("No pudimos generar la exportación", {
        description: e instanceof Error ? e.message : "Intenta de nuevo en unos minutos.",
      });
    } finally {
      setAvance(null);
    }
  }

  return (
    <div className="space-y-3 border-y border-border py-4">
      <div>
        <p className="font-display text-lg font-semibold leading-tight">Exportar todos los datos</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Descarga un archivo ZIP con todo lo que tu clínica guardó en Esmalia: pacientes con su
          anamnesis, profesionales, citas, notas clínicas con todas sus versiones, odontogramas,
          periodontogramas, presupuestos, planes de tratamiento, pagos y cajas, consentimientos,
          documentos y radiografías, laboratorios e inventario. Son planillas CSV que se abren en
          Excel, con un LEEME.txt que explica cada archivo.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Contiene datos de salud de tus pacientes: guárdalo en un lugar seguro. Cada exportación
          queda registrada con tu nombre y la fecha. Si tu clínica tiene muchos datos o radiografías
          puede tardar unos minutos; no cierres esta pestaña mientras se prepara.
        </p>
      </div>

      {isDemo ? (
        <p className="text-sm text-muted-foreground">
          La clínica demo no se puede exportar. Crea tu clínica para usar esta función.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void exportar()} disabled={enCurso}>
            {enCurso ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Download className="size-4" aria-hidden />
            )}
            {enCurso ? "Preparando…" : "Exportar todos los datos"}
          </Button>
          {avance ? (
            <span className="text-sm text-muted-foreground" role="status" aria-live="polite">
              {avance.detalle}
              {avance.total > 1 ? ` (${avance.hecho} de ${avance.total})` : ""}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
