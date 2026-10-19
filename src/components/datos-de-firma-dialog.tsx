import { useEffect, useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveMySignatureData } from "@/lib/clinical/clinical-notes.functions";
import { validarDatosDeFirma } from "@/lib/clinical/clinical-notes";
import { mensajeDeError } from "@/lib/mensaje-error";

/**
 * CLI-08: firmar una nota exige nombre completo y número de registro o
 * colegiatura. Si a quien firma le faltan, se los pide acá (una sola vez por
 * clínica) y después firma. Los datos quedan en la nota como foto: si mañana
 * cambian, las firmas anteriores no cambian.
 */
export function DatosDeFirmaDialog({
  abierto,
  clinicId,
  nombreSugerido,
  onCerrar,
  onGuardado,
}: {
  abierto: boolean;
  clinicId: string;
  nombreSugerido: string | null;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const fid = useId();
  const [nombre, setNombre] = useState(nombreSugerido ?? "");
  const [registro, setRegistro] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const guardarFn = useServerFn(saveMySignatureData);

  useEffect(() => {
    if (abierto) {
      setNombre(nombreSugerido ?? "");
      setAviso(null);
    }
  }, [abierto, nombreSugerido]);

  const guardar = useMutation({
    mutationFn: () =>
      guardarFn({ data: { clinicId, nombre: nombre.trim(), registro: registro.trim() } }),
    onSuccess: () => {
      toast.success("Datos de firma guardados");
      onGuardado();
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  function enviar() {
    const error = validarDatosDeFirma({ nombre, registro });
    setAviso(error);
    if (!error) guardar.mutate();
  }

  return (
    <Dialog open={abierto} onOpenChange={(next) => !next && !guardar.isPending && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tus datos para firmar</DialogTitle>
          <DialogDescription>
            Una nota clínica se firma con el nombre completo y el número de registro o colegiatura
            del profesional. Quedan impresos en la nota y en el PDF, con la fecha de la firma.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-nombre`}>Nombre completo</Label>
            <Input
              id={`${fid}-nombre`}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoComplete="name"
              maxLength={160}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-registro`}>Número de registro o colegiatura</Label>
            <Input
              id={`${fid}-registro`}
              value={registro}
              onChange={(e) => setRegistro(e.target.value)}
              maxLength={60}
              placeholder="Ej. registro de la Superintendencia de Salud o cédula profesional"
            />
          </div>
          {aviso && (
            <p role="alert" className="text-xs text-destructive">
              {aviso}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCerrar} disabled={guardar.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardar.isPending}>
              {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Guardar y firmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
