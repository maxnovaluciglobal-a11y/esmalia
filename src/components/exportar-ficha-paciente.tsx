import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
import { buttonVariants } from "@/components/ui/button";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { descargarBytes, generadoAhora, guardarZip } from "@/lib/exportacion/descarga-navegador";
import { nombreZipPaciente } from "@/lib/exportacion/exportacion-clinica";
import {
  firmarArchivosExportacionPaciente,
  iniciarExportacionPaciente,
  leerTablaExportacionPaciente,
} from "@/lib/exportacion/exportacion-clinica.functions";
import {
  generarExportacionPaciente,
  type AvanceExportacion,
} from "@/lib/exportacion/generar-exportacion";

interface Props {
  clinicId: string;
  clinicName: string;
  timezone: string;
  isDemo: boolean;
  patientId: string;
  patientName: string;
  generadoPor: string;
  /** Presupuestos y pagos: solo con `finance:view`. El servidor lo vuelve a exigir. */
  incluirFinanzas: boolean;
}

/**
 * "Exportar ficha" (derecho de acceso del paciente, CON-01): un ZIP con la
 * ficha en PDF y sus datos en CSV, para entregarle al paciente. Se monta
 * para owner/admin/dentist; el servidor verifica el rol en cada llamada y la
 * exportación queda registrada.
 */
export function ExportarFichaPaciente({
  clinicId,
  clinicName,
  timezone,
  isDemo,
  patientId,
  patientName,
  generadoPor,
  incluirFinanzas,
}: Props) {
  const iniciar = useServerFn(iniciarExportacionPaciente);
  const leer = useServerFn(leerTablaExportacionPaciente);
  const firmar = useServerFn(firmarArchivosExportacionPaciente);
  const [abierto, setAbierto] = useState(false);
  const [avance, setAvance] = useState<AvanceExportacion | null>(null);
  const enCurso = avance !== null;

  async function exportar() {
    setAvance({ etapa: "registrando", detalle: "Registrando la exportación", hecho: 0, total: 1 });
    try {
      const { zip } = await generarExportacionPaciente(
        {
          iniciar: (args) => iniciar({ data: args }),
          leer: (args) => leer({ data: args }),
          firmar: (args) => firmar({ data: { ...args, patientId } }),
          descargar: descargarBytes,
        },
        {
          clinicId,
          patientId,
          pacienteNombre: patientName,
          clinicaNombre: clinicName,
          generadoPor,
          generadoEn: generadoAhora(timezone),
          zonaHoraria: timezone,
          incluirFinanzas,
          onAvance: setAvance,
        },
      );
      guardarZip(zip, nombreZipPaciente(patientName, hoyISO(timezone)));
      setAbierto(false);
      toast.success("Ficha exportada", {
        description: "Revisa tu carpeta de descargas. El PDF está en la carpeta pacientes/.",
      });
    } catch (e) {
      toast.error("No pudimos exportar la ficha", {
        description: e instanceof Error ? e.message : "Intenta de nuevo en unos minutos.",
      });
    } finally {
      setAvance(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={buttonVariants({ variant: "outline" })}
      >
        <Download aria-hidden /> Exportar ficha
      </button>

      <AlertDialog open={abierto} onOpenChange={(next) => !enCurso && setAbierto(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exportar la ficha de {patientName}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Descarga un ZIP con la ficha completa en PDF (datos, anamnesis y alertas, tutores,
                  odontograma, periodontograma, notas firmadas con sus adendas, consentimientos,
                  recetas
                  {incluirFinanzas ? ", presupuestos y pagos" : ""}), los mismos datos en planillas
                  CSV y sus documentos y radiografías. Sirve para entregarle al paciente la copia
                  que pide.
                </p>
                {!incluirFinanzas && (
                  <p>
                    Los presupuestos y pagos no van en esta copia: los exporta el propietario o un
                    administrador de la clínica.
                  </p>
                )}
                <p>
                  Son datos de salud: entrégalos solo al paciente o a su representante legal. La
                  exportación queda registrada con tu nombre y la fecha.
                </p>
                {isDemo && <p>La clínica demo no se puede exportar.</p>}
                {avance && (
                  <p role="status" aria-live="polite">
                    {avance.detalle}
                    {avance.total > 1 ? ` (${avance.hecho} de ${avance.total})` : ""}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enCurso}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={enCurso || isDemo}
              onClick={(e) => {
                e.preventDefault();
                void exportar();
              }}
            >
              {enCurso && <Loader2 className="size-3.5 animate-spin" />}
              {enCurso ? "Preparando…" : "Exportar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
