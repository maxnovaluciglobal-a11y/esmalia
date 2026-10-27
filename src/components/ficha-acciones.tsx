import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
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
import { ProgramarControlDialog } from "@/components/seguimiento/programar-control-dialog";
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
import { hoyISO, type Paciente } from "@/lib/clinic-operations/clinic-data";
import { puedeExportarPaciente } from "@/lib/exportacion/exportacion-clinica";
import { puedeEditarPaciente } from "@/lib/patients/editar-paciente";
import { EXPLICACION_BOTON_SOLO_LECTURA } from "@/lib/solo-lectura";
import { cn } from "@/lib/utils";

type DialogoAbierto = "editar" | "exportar" | "archivar" | "control" | null;

/**
 * Botones sobre el encabezado en tinta de la ficha (A+): píldoras de 44 px,
 * la principal en ocre y las demás con el filete de la tinta. Va dentro de
 * un contenedor `.dark`, así que `brand` es el ocre claro (9:1 sobre tinta).
 */
const EN_NOCHE = {
  principal:
    "h-11 rounded-full border-brand bg-brand px-5 text-[15px] font-semibold text-brand-foreground hover:bg-brand/88 active:bg-brand/80",
  secundario:
    "h-11 rounded-full border-night-line bg-transparent px-5 text-[15px] font-semibold text-on-night hover:border-on-night hover:bg-transparent active:bg-on-night/10",
} as const;

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
  tono = "pagina",
}: {
  access: ClinicAccess;
  paciente: Paciente;
  onCobrar: () => void;
  /** "noche": sobre el encabezado en tinta de la ficha. */
  tono?: "pagina" | "noche";
}) {
  const noche = tono === "noche";
  const principal = cn(buttonVariants(), noche && EN_NOCHE.principal);
  const secundario = cn(buttonVariants({ variant: "outline" }), noche && EN_NOCHE.secundario);
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
  // FIC-13 (Ola 8): programar un control; mismos roles que la agenda.
  const puedeProgramarControl = Boolean(clinicId) && puedeAgendar;
  const hayMas = puedeEditar || puedeArchivar || puedeExportar || puedeProgramarControl;
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
              <button type="button" className={principal}>
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
              sucursal: "",
              profesional: "",
              estado: "",
              page: 1,
              nueva: paciente.id,
            }}
            className={principal}
          >
            <CalendarPlus aria-hidden /> Agendar
          </Link>
        </SegunSoloLectura>
      )}
      {puedeCobrar && (
        <BloqueoEscritura>
          <button type="button" onClick={onCobrar} className={secundario}>
            <Wallet aria-hidden /> Cobrar
          </button>
        </BloqueoEscritura>
      )}
      {puedeEscribir && (
        <Link to="/conversaciones" search={{ paciente: paciente.id }} className={secundario}>
          <MessageCircle aria-hidden /> WhatsApp
        </Link>
      )}

      {hayMas && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            // En el celular es solo el ícono: con borde, para que se lea como botón.
            className={cn(
              noche
                ? cn(secundario, "w-11 px-0")
                : cn(
                    buttonVariants({ variant: "outline" }),
                    "px-3 sm:border-transparent sm:bg-transparent sm:shadow-none",
                  ),
            )}
            aria-label="Más acciones"
            title="Más acciones"
          >
            <MoreHorizontal aria-hidden />
            <span className={noche ? "sr-only" : "hidden sm:inline"}>Más acciones</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-60">
            {puedeProgramarControl && (
              <ItemDeMenu
                icono={<CalendarClock aria-hidden />}
                texto="Programar control"
                bloqueado={soloLectura}
                onSelect={() => setDialogo("control")}
              />
            )}
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
      {clinic && puedeProgramarControl && (
        <ProgramarControlDialog
          clinicId={clinic.id}
          patientId={paciente.id}
          patientName={paciente.nombre}
          hoy={hoyISO(clinic.timezone)}
          zona={clinic.timezone}
          userId={access.userId}
          abierto={dialogo === "control"}
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
