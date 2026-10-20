import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Sistema "Classical", ajustado tras la auditoría del 07-oct-2026: el
// primario va relleno en ocre 700 con texto blanco (6,7:1), para que cada
// pantalla tenga un lugar donde el ojo cae primero. El contorno ocre queda
// como variante `brand` (énfasis secundario); outline y secondary llevan el
// borde de control (≥ 3:1). En táctil los botones crecen a 44px.
// Tipografía: la de cuerpo (Instrument Sans 500 desde A+, 19-oct-2026). Hasta
// el 08-oct era Cormorant 600 a 15px, pero su altura x (0,386 em) da 5,8px a
// ese tamaño: Cormorant queda solo para títulos de 20px o más.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border font-sans text-sm font-medium leading-none cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 pointer-coarse:min-h-11 disabled:pointer-events-none disabled:opacity-45 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:bg-primary/88 active:bg-primary/80",
        brand: "border-brand bg-transparent text-brand-700 hover:bg-brand/12 active:bg-brand/22",
        destructive:
          "border-destructive bg-transparent text-destructive hover:bg-destructive/10 active:bg-destructive/18",
        outline:
          "border-control bg-transparent text-foreground hover:bg-foreground/7 active:bg-foreground/14",
        secondary:
          "border-control bg-transparent text-foreground hover:bg-foreground/7 active:bg-foreground/14",
        ghost: "border-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        link: "h-auto border-transparent px-0 text-brand-700 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-sm",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9 pointer-coarse:min-w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

// eslint-disable-next-line react-refresh/only-export-components -- shadcn/ui convention: the cva variants live next to the component
export { Button, buttonVariants };
