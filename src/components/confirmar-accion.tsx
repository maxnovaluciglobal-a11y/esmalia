import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

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
import { cn } from "@/lib/utils";

/**
 * Confirmación de una acción con efecto (ONB-07, Ola 12): dice qué va a
 * pasar ANTES de hacerlo y, si es masiva o mueve dinero, la cifra afectada.
 * Mismo patrón que el archivo masivo de fichas y "Registrar en N piezas"
 * del odontograma (la cifra va también en el botón), extraído para no
 * repetirlo en cada pantalla:
 *
 * - controlado (`abierto` / `onAbiertoChange`): la pantalla decide cuándo se
 *   abre (un botón, un ítem de menú, un select);
 * - mientras `pendiente`, no se cierra y el botón muestra que está
 *   trabajando; el error lo sigue mostrando la pantalla (toast);
 * - `cifra` va destacada en el texto (cuántas citas, cuánto dinero…).
 */
export function ConfirmarAccion({
  abierto,
  onAbiertoChange,
  titulo,
  consecuencias,
  cifra,
  etiquetaAccion,
  onConfirmar,
  pendiente = false,
  destructiva = false,
  children,
}: {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  titulo: ReactNode;
  /** Qué pasa al confirmar, en frases cortas (la primera es la principal). */
  consecuencias: ReactNode[];
  /** La cifra afectada ("12 citas", "$ 45.000"), si la hay. */
  cifra?: { etiqueta: string; valor: ReactNode } | null;
  /** Texto del botón: el verbo con la cifra ("Cerrar con diferencia"). */
  etiquetaAccion: ReactNode;
  onConfirmar: () => void;
  pendiente?: boolean;
  /** Pinta el botón como destructivo (borrar, cancelar, quitar). */
  destructiva?: boolean;
  /** Algo más dentro del diálogo (un campo de motivo, una lista). */
  children?: ReactNode;
}) {
  return (
    <AlertDialog open={abierto} onOpenChange={(next) => !pendiente && onAbiertoChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-[15px]">
              {cifra && (
                <p className="flex flex-wrap items-baseline gap-x-2 rounded-[10px] border border-hairline bg-secondary/60 px-3 py-2 text-foreground">
                  <span className="text-sm text-muted-foreground">{cifra.etiqueta}</span>
                  <span className="cifra text-base font-semibold">{cifra.valor}</span>
                </p>
              )}
              {consecuencias.map((c, i) => (
                <p key={i}>{c}</p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pendiente}>Volver</AlertDialogCancel>
          <AlertDialogAction
            disabled={pendiente}
            className={cn(
              destructiva &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-destructive",
            )}
            onClick={(e) => {
              e.preventDefault();
              onConfirmar();
            }}
          >
            {pendiente && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
            {etiquetaAccion}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
