import { Link } from "@tanstack/react-router";
import { BookOpen, Mail, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EMAIL_SOPORTE, enlaceWhatsAppSoporte } from "@/lib/marketing/contacto";

/**
 * Menú "Ayuda" de la app (auditoría 360, CS-06). Antes era un `mailto` que
 * caía en el Gmail de la empresa y que en un celular sin cliente de correo no
 * abre; el público de Esmalia (recepción de clínicas) resuelve todo por
 * WhatsApp. Tres salidas: WhatsApp (con el nombre de la clínica prellenado,
 * solo si el número está cargado), centro de ayuda y correo.
 *
 * El botón lo pone quien lo usa (`children` + `className`) porque la ayuda
 * aparece en tres sitios con tres estilos: barra lateral, hoja "Más" del
 * celular y barra de tablet.
 */
export function AyudaMenu({
  clinicName,
  className,
  children,
}: {
  clinicName?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const whatsapp = enlaceWhatsAppSoporte(clinicName);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={className}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {whatsapp && (
          <DropdownMenuItem asChild>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-2 size-4" /> Escribir por WhatsApp
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/docs" target="_blank">
            <BookOpen className="mr-2 size-4" /> Centro de ayuda
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`mailto:${EMAIL_SOPORTE}`}>
            <Mail className="mr-2 size-4" /> {EMAIL_SOPORTE}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
