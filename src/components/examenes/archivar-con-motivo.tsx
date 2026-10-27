/**
 * Archivar con motivo (Decreto 41): un examen o una sesión con valor clínico
 * no se borra; se archiva y queda quién, cuándo y por qué.
 */
import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { CLASE_CAMPO } from "@/components/cita-formulario";
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
import { Label } from "@/components/ui/label";
import { mensajeDeError } from "@/lib/mensaje-error";

export function ArchivarConMotivo({
  abierto,
  titulo,
  descripcion,
  onCerrar,
  onConfirmar,
}: {
  abierto: boolean;
  titulo: string;
  descripcion: string;
  onCerrar: () => void;
  onConfirmar: (motivo: string) => Promise<void>;
}) {
  const id = useId();
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    if (abierto) setMotivo("");
  }, [abierto]);
  const valido = motivo.trim().length >= 3;

  return (
    <AlertDialog open={abierto} onOpenChange={(v) => !v && !enviando && onCerrar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{descripcion}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-motivo`}>Motivo</Label>
          <textarea
            id={`${id}-motivo`}
            rows={2}
            maxLength={500}
            placeholder="Ej.: subido en la ficha equivocada"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className={CLASE_CAMPO}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={enviando}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={!valido || enviando}
            onClick={async (e) => {
              e.preventDefault();
              setEnviando(true);
              try {
                await onConfirmar(motivo.trim());
                onCerrar();
              } catch (err) {
                toast.error(mensajeDeError(err));
              } finally {
                setEnviando(false);
              }
            }}
          >
            {enviando && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Archivar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
