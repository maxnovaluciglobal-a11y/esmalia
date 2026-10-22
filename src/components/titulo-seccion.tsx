import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Título de una sección de tarjeta (UX-12/Ola 0): un solo tamaño y una sola
 * familia para todas las tarjetas de la ficha y de las pantallas internas.
 * Antes convivían "Anamnesis" en sans chica, "Odontograma" en serif grande
 * y "Responsable" todavía más grande. Cormorant 600 a 18 px, como pide el
 * sistema visual para títulos.
 */
export function TituloSeccion({
  children,
  icono,
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { icono?: ReactNode }) {
  return (
    <h3
      className={cn(
        "font-display text-lg font-semibold leading-tight",
        icono && "flex items-center gap-2",
        className,
      )}
      {...props}
    >
      {icono}
      {children}
    </h3>
  );
}
