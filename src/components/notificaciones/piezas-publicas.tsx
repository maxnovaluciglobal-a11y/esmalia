/**
 * Piezas compartidas de las páginas públicas del paciente (Ola 7 · frente B):
 * `/formulario/:token` y `/encuesta/:token`. Lenguaje A+: encabezado
 * editorial en Cormorant con la itálica en ocre, tarjetas de 14 px.
 */
import type { ReactNode } from "react";

export const PANEL_PUBLICO = "rounded-[14px] border border-hairline bg-card";

export function EncabezadoPublico({
  antetitulo,
  titulo,
  enfasis,
  children,
}: {
  antetitulo: string;
  titulo: string;
  /** La parte del título en itálica ocre (el nombre de la clínica). */
  enfasis: string | null;
  children?: ReactNode;
}) {
  return (
    <header className="space-y-3 pb-2">
      <p className="text-sm font-medium text-muted-foreground">{antetitulo}</p>
      <h1 className="font-display text-[clamp(2.1rem,7vw,3.25rem)] font-medium leading-[1.02] tracking-[-0.02em] text-balance">
        {titulo}
        {enfasis && (
          <>
            {" "}
            <em className="text-brand-600">{enfasis}</em>
          </>
        )}
      </h1>
      {children && <div className="text-base text-muted-foreground">{children}</div>}
    </header>
  );
}

export function AvisoPublico({
  icono,
  titulo,
  children,
}: {
  icono: ReactNode;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`${PANEL_PUBLICO} mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-12 text-center`}
    >
      {icono}
      <h1 className="font-display text-3xl font-medium leading-tight">{titulo}</h1>
      <div className="space-y-2 text-base text-muted-foreground">{children}</div>
    </section>
  );
}
