import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Las etiquetas llevan siempre texto: el tono acompaña, nunca informa solo
// (auditoría de accesibilidad del 04-sep).
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium tabular-nums transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700",
  {
    variants: {
      variant: {
        default: "border-brand/45 bg-brand-100 text-brand-800",
        secondary: "border-border bg-muted text-foreground",
        destructive: "border-destructive-border bg-destructive-soft text-destructive",
        success: "border-success-border bg-success-soft text-success",
        // Punteado: la advertencia no depende solo del tono (siena vs. ocre).
        warning: "border-dashed border-warning-border bg-warning-soft text-warning",
        info: "border-info-border bg-info-soft text-info",
        neutral: "border-neutral-border bg-neutral-soft text-neutral",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

// eslint-disable-next-line react-refresh/only-export-components -- shadcn/ui convention: the cva variants live next to the component
export { Badge, badgeVariants };
