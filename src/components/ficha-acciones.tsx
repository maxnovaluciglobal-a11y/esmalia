import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  CalendarPlus,
  Download,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Wallet,
} from "lucide-react";

import { ArchivarFichaButton } from "@/components/archivar-ficha";
import { EditarPacienteDialog } from "@/components/editar-paciente-dialog";
import { ExportarFichaPaciente } from "@/components/exportar-ficha-paciente";
import { BloqueoEscritura, SegunSoloLectura } from "@/components/solo-lectura";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSoloLectura } from "@/hooks/use-solo-lectura";
import { hasPermission, type ClinicAccess } from "@/lib/access/access";
import type { Paciente } from "@/lib/clinic-operations/clinic-data";
import { puedeExportarPaciente } from "@/lib/exportacion/exportacion-clinica";
import { puedeEditarPaciente } from "@/lib/patients/editar-paciente";
import { EXPLICACION_BOTON_SOLO_LECTURA } from "@/lib/solo-lectura";
import { cn } from "@/lib/utils";

type DialogoAbierto = "editar" | "exportar" | "archivar" | null;

/**
 * Acciones de la cabecera de la ficha (UX-10). Antes eran cinco botones del
 * mismo peso, con "Archivar ficha" pegado a "Cobrar", que en el celular
 * ocupaban tres filas. Ahora: "Agendar" (primaria), "Cobrar" y "WhatsApp"
 * a la vista, y lo ocasional (editar datos, exportar, archivar) en "Más
 * acciones". Archivar conserva su confirmación. Los diálogos viven fuera del
 * menú (controlados), así no se desmontan cuando el menú se cierra.
 */
export function AccionesDeLaFicha({
  access,
  paciente,
  onCobrar,
}: {
  access: ClinicAccess;
  paciente: Paciente;
  onCobrar: () => void;
}) {
  const [dialogo, setDialogo] = useState<DialogoAbierto>(null);
  const soloLectura = useSoloLectura();
  const clinic = access.clinic;
  const clinicId = clinic?.id;

  const puedeAgendar = hasPermission(access.role, "agenda:manage");
  const puedeCobrar = hasPermission(access.role, "patients:manage");
  // La bandeja de conversaciones respeta la baja de WhatsApp y cae a wa.me
  // cuando la clínica no tiene la API conectada (replyToConversation).
  const puedeEscribir = puedeAgendar && Boolean(paciente.telefono);
  const puedeEditar = Boolean(clinicId) && puedeEditarPaciente(access.role);
  const puedeArchivar = Boolean(clinicId) && hasPermission(access.role, "settings:manage");
  const puedeExportar = Boolean(clinic) && puedeExportarPaciente(access.role);
  const hayMas = puedeEditar || puedeArchivar || puedeExportar;
  const archivada = Boolean(paciente.archivadaEl);

  const cerrar = (abierto: boolean) => {
    if (!abierto) setDialogo(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {puedeAgendar && (
        <SegunSoloLectura
          bloqueado={
            <BloqueoEscritura>
              <button type="button" className={buttonVariants()}>
                <CalendarPlus aria-hidden /> Agendar
              </button>
            </BloqueoEscritura>
          }
        >
          <Link
            to="/agenda"
            search={{
              q: "",
              fecha: "",
              vista: "dia",
              sucursal: "",
              profesional: "",
              estado: "",
              page: 1,
              nueva: paciente.id,
            }}
            className={buttonVariants()}
          >
            <CalendarPlus aria-hidden /> Agendar
          </Link>
        </SegunSoloLectura>
      )}
      {puedeCobrar && (
        <BloqueoEscritura>
          <button
            type="button"
            onClick={onCobrar}
            className={buttonVariants({ variant: "outline" })}
          >
            <Wallet aria-hidden /> Cobrar
          </button>
        </BloqueoEscritura>
      )}
      {puedeEscribir && (
        <Link
          to="/conversaciones"
          search={{ paciente: paciente.id }}
          className={buttonVariants({ variant: "outline" })}
        >
          <MessageCircle aria-hidden /> WhatsApp
        </Link>
      )}

      {hayMas && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            // En el celular es solo el ícono: con borde, para que se lea como botón.
            className={cn(
              buttonVariants({ variant: "outline" }),
              "px-3 sm:border-transparent sm:bg-transparent sm:shadow-none",
            )}
            aria-label="Más acciones"
          >
            <MoreHorizontal aria-hidden />
            <span className="hidden sm:inline">Más acciones</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-60">
            {puedeEditar && (
              <ItemDeMenu
                icono={<Pencil aria-hidden />}
                texto="Editar datos"
                bloqueado={soloLectura}
                onSelect={() => setDialogo("editar")}
              />
            )}
            {puedeExportar && (
              <ItemDeMenu
                icono={<Download aria-hidden />}
                texto="Exportar ficha"
                bloqueado={false}
                onSelect={() => setDialogo("exportar")}
              />
            )}
            {puedeArchivar && (
              <>
                <DropdownMenuSeparator />
                <ItemDeMenu
                  icono={archivada ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                  texto={archivada ? "Restaurar ficha" : "Archivar ficha"}
                  bloqueado={soloLectura}
                  onSelect={() => setDialogo("archivar")}
                />
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {clinicId && puedeEditar && (
        <EditarPacienteDialog
          clinicId={clinicId}
          country={clinic?.country ?? null}
          paciente={paciente}
          abierto={dialogo === "editar"}
          onAbiertoChange={cerrar}
        />
      )}
      {clinic && puedeExportar && (
        <ExportarFichaPaciente
          clinicId={clinic.id}
          clinicName={clinic.name}
          timezone={clinic.timezone}
          isDemo={clinic.isDemo}
          patientId={paciente.id}
          patientName={paciente.nombre}
          generadoPor={access.fullName ?? access.email ?? "Usuario de la clínica"}
          incluirFinanzas={hasPermission(access.role, "finance:view")}
          abierto={dialogo === "exportar"}
          onAbiertoChange={cerrar}
        />
      )}
      {clinicId && puedeArchivar && (
        <ArchivarFichaButton
          clinicId={clinicId}
          patientId={paciente.id}
          patientName={paciente.nombre}
          archivadaEl={paciente.archivadaEl ?? null}
          abierto={dialogo === "archivar"}
          onAbiertoChange={cerrar}
        />
      )}
    </div>
  );
}

/** Ítem del menú; bloqueado en solo lectura, con el motivo a la vista (no solo en un tooltip). */
function ItemDeMenu({
  icono,
  texto,
  bloqueado,
  onSelect,
}: {
  icono: React.ReactNode;
  texto: string;
  bloqueado: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={bloqueado}
      onSelect={onSelect}
      className="items-start [&_svg]:mt-0.5"
    >
      {icono}
      <span className="flex flex-col">
        {texto}
        {bloqueado && (
          <span className="text-xs text-muted-foreground">{EXPLICACION_BOTON_SOLO_LECTURA}</span>
        )}
      </span>
    </DropdownMenuItem>
  );
}
