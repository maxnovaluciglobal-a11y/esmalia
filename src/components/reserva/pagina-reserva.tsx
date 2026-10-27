import type { ReactNode } from "react";

import { EsmaliaLogo } from "@/components/esmalia-logo";
import { PublicPageShell } from "@/components/site-chrome";

/**
 * Marco de las páginas públicas de la reserva y de la cita: `PublicPageShell`
 * (como toda página pública) o, embebida en el sitio de la clínica
 * (`?embed=1`), una versión sin encabezado ni pie del sitio de Esmalia.
 */
export function PaginaReserva({ embebida, children }: { embebida: boolean; children: ReactNode }) {
  if (embebida) {
    return (
      <div className="min-h-dvh bg-background px-4 py-6 text-foreground">
        {children}
        <p className="mx-auto mt-10 flex max-w-xl items-center justify-center gap-1.5 text-xs text-muted-foreground">
          Reservas con <EsmaliaLogo size={14} variant="icon" /> Esmalia
        </p>
      </div>
    );
  }
  return (
    <PublicPageShell mainClassName="max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      {children}
    </PublicPageShell>
  );
}
