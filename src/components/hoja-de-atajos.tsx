import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EVENTO_ABRIR_ATAJOS, esAtajoAyuda, gruposDeAtajos, hayDialogoAbierto } from "@/lib/atajos";

/**
 * Hoja de atajos (NAV-05). Se abre con `?`, desde Ayuda → "Atajos de
 * teclado" o desde el ⌘K ("atajos"). Ola 8: suma los sinónimos del buscador
 * y los atajos de Pacientes. La monta una sola vez el buscador que escucha ⌘K
 * (`GlobalSearch` con `atajo`), así no hay dos copias escuchando la tecla.
 */
export function HojaDeAtajos({ esMac }: { esMac: boolean }) {
  const [abierta, setAbierta] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!esAtajoAyuda(e, hayDialogoAbierto())) return;
      e.preventDefault();
      setAbierta(true);
    }
    function onPedido() {
      setAbierta(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(EVENTO_ABRIR_ATAJOS, onPedido);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(EVENTO_ABRIR_ATAJOS, onPedido);
    };
  }, []);

  const grupos = gruposDeAtajos(esMac ? "⌘" : "Ctrl");

  return (
    <Dialog open={abierta} onOpenChange={setAbierta}>
      <DialogContent className="max-h-[85dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Atajos de teclado</DialogTitle>
          <DialogDescription>
            Las teclas sueltas no funcionan mientras escribes en un campo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {grupos.map((g) => (
            <section key={g.titulo} className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.titulo}
              </h3>
              <dl className="divide-y divide-hairline rounded-lg border border-hairline">
                {g.atajos.map((a) => (
                  <div
                    key={a.descripcion}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <dt>{a.descripcion}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {a.teclas.map((t) => (
                        <kbd
                          key={t}
                          className="rounded-sm border border-hairline bg-secondary px-1.5 font-mono text-[11px] leading-5"
                        >
                          {t}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
