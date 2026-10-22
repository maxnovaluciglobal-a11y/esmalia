import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Label } from "@/components/ui/label";
import { anularDocumentoEmitido } from "@/lib/documentos/documentos.functions";
import { mensajeDeError } from "@/lib/mensaje-error";

/**
 * DOC-08: un documento emitido no se edita ni se borra. Se anula con el
 * motivo; queda visible como anulado, con quién y cuándo, y se conserva con
 * la ficha (Decreto 41).
 */
export function AnularDocumentoDialog({
  abierto,
  onCerrar,
  clinicId,
  documento,
}: {
  abierto: boolean;
  onCerrar: () => void;
  clinicId: string;
  documento: { id: string; title: string; folio: string };
}) {
  const fid = useId();
  const [motivo, setMotivo] = useState("");
  const queryClient = useQueryClient();
  const anular = useServerFn(anularDocumentoEmitido);
  const mut = useMutation({
    mutationFn: () =>
      anular({ data: { clinicId, documentId: documento.id, motivo: motivo.trim() } }),
    onSuccess: async () => {
      toast.success("Documento anulado.");
      setMotivo("");
      onCerrar();
      await queryClient.invalidateQueries({ queryKey: ["documentos-emitidos"] });
      await queryClient.invalidateQueries({
        queryKey: ["documento-emitido", clinicId, documento.id],
      });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const valido = motivo.trim().length >= 3;

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && !mut.isPending && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Anular documento</DialogTitle>
          <DialogDescription>
            {documento.title} {documento.folio}. Un documento emitido no se borra: queda en la ficha
            marcado como anulado, con el motivo, quién lo anuló y cuándo. Si había un error, emite
            uno nuevo.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valido) mut.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-motivo`}>Motivo de la anulación</Label>
            <textarea
              id={`${fid}-motivo`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={300}
              required
              placeholder="Ej. Fecha de reposo equivocada"
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCerrar} disabled={mut.isPending}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={!valido || mut.isPending}>
              {mut.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Anular documento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
