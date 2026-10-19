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
import { descargarBytes, generadoAhora, guardarZip } from "@/lib/exportacion/descarga-navegador";
import { generarExportacion, type AvanceExportacion } from "@/lib/exportacion/generar-exportacion";

interface Props {
  clinicId: string;
  clinicName: string;
  timezone: string;
  isDemo: boolean;
  generadoPor: string;
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
      const generadoEn = generadoAhora(timezone);
      const { zip } = await generarExportacion(
        {
          iniciar: (id) => iniciar({ data: { clinicId: id } }),
          leer: (args) => leer({ data: args }),
          firmar: (args) => firmar({ data: args }),
          descargar: descargarBytes,
        },
        {
          clinicId,
          clinicaNombre: clinicName,
          generadoPor,
          generadoEn,
          zonaHoraria: timezone,
          onAvance: setAvance,
        },
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
          anamnesis, tutores y signos vitales, profesionales, citas, notas clínicas con todas sus
          versiones, odontogramas, periodontogramas, ortodoncia, consentimientos, recetas,
          presupuestos, planes de tratamiento, pagos, cajas, gastos, convenios, aranceles,
          comisiones, mensajes, documentos y radiografías, laboratorios, inventario y los registros
          de auditoría. Son planillas CSV que se abren en Excel, con un LEEME.txt que explica cada
          archivo, y una ficha en PDF por paciente, lista para imprimir o entregar.
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
