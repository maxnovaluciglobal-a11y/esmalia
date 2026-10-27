import { Link } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  CalendarPlus,
  FileText,
  MessageCircle,
  MoreVertical,
  Tags,
  Wallet,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EXPLICACION_BOTON_SOLO_LECTURA } from "@/lib/solo-lectura";

/**
 * Menú ⋮ de una fila de /pacientes (PAC-14): los atajos de la ficha sin
 * abrirla. Cada opción respeta el permiso del rol (y el servidor tiene su
 * par): agendar (`agenda:manage`), cobrar (`patients:manage`, como en la
 * ficha), WhatsApp asistido (la bandeja respeta la baja y cae a wa.me),
 * etiquetar (`patients:manage`) y archivar (owner/admin). En solo lectura,
 * lo que escribe se muestra deshabilitado con el motivo.
 */
export interface PermisosDeFila {
  agendar: boolean;
  cobrar: boolean;
  escribir: boolean;
  etiquetar: boolean;
  archivar: boolean;
}

export function MenuFilaPaciente({
  paciente,
  permisos,
  soloLectura,
  onEtiquetar,
  onArchivar,
}: {
  paciente: { id: string; nombre: string; telefono: string; archivadaEl?: string | null };
  permisos: PermisosDeFila;
  soloLectura: boolean;
  onEtiquetar: () => void;
  onArchivar: () => void;
}) {
  const archivada = Boolean(paciente.archivadaEl);
  const motivo = soloLectura ? (
    <span className="block text-xs text-muted-foreground">{EXPLICACION_BOTON_SOLO_LECTURA}</span>
  ) : null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`Acciones de ${paciente.nombre}`}
        title="Acciones"
        className="relative z-10 grid size-9 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:bg-secondary data-[state=open]:text-foreground pointer-coarse:size-11"
      >
        <MoreVertical className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="truncate text-xs font-medium text-muted-foreground">
          {paciente.nombre}
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/pacientes/$pacienteId" params={{ pacienteId: paciente.id }}>
            <FileText aria-hidden /> Ver ficha
          </Link>
        </DropdownMenuItem>
        {permisos.agendar &&
          !archivada &&
          (soloLectura ? (
            <DropdownMenuItem disabled className="items-start">
              <CalendarPlus aria-hidden />
              <span>
                Agendar
                {motivo}
              </span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem asChild>
              <Link
                to="/agenda"
                search={{
                  q: "",
                  fecha: "",
                  sucursal: "",
                  profesional: "",
                  estado: "",
                  page: 1,
                  nueva: paciente.id,
                }}
              >
                <CalendarPlus aria-hidden /> Agendar
              </Link>
            </DropdownMenuItem>
          ))}
        {permisos.cobrar &&
          (soloLectura ? (
            <DropdownMenuItem disabled className="items-start">
              <Wallet aria-hidden />
              <span>
                Cobrar
                {motivo}
              </span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem asChild>
              <Link
                to="/pacientes/$pacienteId"
                params={{ pacienteId: paciente.id }}
                search={{ cobrar: 1 }}
              >
                <Wallet aria-hidden /> Cobrar
              </Link>
            </DropdownMenuItem>
          ))}
        {permisos.escribir &&
          (paciente.telefono ? (
            <DropdownMenuItem asChild>
              <Link to="/conversaciones" search={{ paciente: paciente.id }}>
                <MessageCircle aria-hidden /> WhatsApp asistido
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled className="items-start">
              <MessageCircle aria-hidden />
              <span>
                WhatsApp asistido
                <span className="block text-xs text-muted-foreground">
                  Sin teléfono en la ficha
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        {permisos.etiquetar && (
          <DropdownMenuItem disabled={soloLectura} onSelect={onEtiquetar} className="items-start">
            <Tags aria-hidden />
            <span>
              Etiquetar
              {motivo}
            </span>
          </DropdownMenuItem>
        )}
        {permisos.archivar && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={soloLectura} onSelect={onArchivar} className="items-start">
              {archivada ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              <span>
                {archivada ? "Restaurar ficha" : "Archivar ficha"}
                {motivo}
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
