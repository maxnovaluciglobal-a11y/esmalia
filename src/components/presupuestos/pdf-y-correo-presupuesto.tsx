import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

import { EnviarPorCorreoDialog } from "@/components/documentos/enviar-por-correo-dialog";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import {
  enviarPresupuestoPorCorreo,
  getCorreoDePresupuesto,
  getPresupuestoParaPdf,
} from "@/lib/documentos/envios.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

/**
 * PLA-08: descarga el PDF del presupuesto. El servidor arma la hoja con la
 * plantilla "Presupuesto" de la clínica (motor de documentos) y el navegador
 * dibuja el PDF con jsPDF, que se carga recién al hacer clic.
 */
export function DescargarPdfPresupuestoBoton({
  clinicId,
  quoteId,
  size = "sm",
  variant = "outline",
}: {
  clinicId: string;
  quoteId: string;
  size?: "sm" | "default";
  variant?: "outline" | "ghost";
}) {
  const cargar = useServerFn(getPresupuestoParaPdf);
  const [descargando, setDescargando] = useState(false);

  async function descargar() {
    setDescargando(true);
    try {
      const [{ hoja, nombreArchivo }, { construirHojaPdf }] = await Promise.all([
        cargar({ data: { clinicId, quoteId } }),
        import("@/lib/documentos/pdf"),
      ]);
      const doc = await construirHojaPdf(hoja);
      doc.save(nombreArchivo);
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setDescargando(false);
    }
  }

  return (
    <Button size={size} variant={variant} onClick={() => void descargar()} disabled={descargando}>
      {descargando ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Download className="size-3.5" aria-hidden />
      )}
      Descargar PDF
    </Button>
  );
}

/** PLA-09: envía el presupuesto por correo al paciente, con el PDF adjunto. */
export function EnviarPresupuestoCorreoBoton({
  clinicId,
  quoteId,
  patientId,
  numero,
  puedeReactivar,
  size = "sm",
  variant = "outline",
}: {
  clinicId: string;
  quoteId: string;
  patientId: string;
  numero: string;
  puedeReactivar: boolean;
  size?: "sm" | "default";
  variant?: "outline" | "ghost";
}) {
  const [abierto, setAbierto] = useState(false);
  const queryClient = useQueryClient();
  const vista = useServerFn(getCorreoDePresupuesto);
  const enviar = useServerFn(enviarPresupuestoPorCorreo);

  return (
    <>
      <BloqueoEscritura>
        <Button size={size} variant={variant} onClick={() => setAbierto(true)}>
          <Mail className="size-3.5" aria-hidden /> Enviar por correo
        </Button>
      </BloqueoEscritura>
      <EnviarPorCorreoDialog
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo={`Enviar el presupuesto ${numero} por correo`}
        adjunto={`PDF del presupuesto ${numero}`}
        clinicId={clinicId}
        patientId={patientId}
        puedeReactivar={puedeReactivar}
        queryKey={["correo-presupuesto", clinicId, quoteId]}
        cargarVista={() => vista({ data: { clinicId, quoteId } })}
        enviar={(texto) => enviar({ data: { clinicId, quoteId, ...texto } })}
        onEnviado={() =>
          Promise.all([
            queryClient.invalidateQueries({ queryKey: ["presupuesto-detalle", clinicId, quoteId] }),
            queryClient.invalidateQueries({ queryKey: ["presupuestos-clinica", clinicId] }),
            queryClient.invalidateQueries({ queryKey: ["quotes", clinicId, patientId] }),
          ])
        }
      />
    </>
  );
}
