import { useEffect, useId, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BloqueoEscritura } from "@/components/solo-lectura";
import type { Paciente } from "@/lib/clinic-operations/clinic-data";
import {
  avisoDeTelefono,
  cambiosDeDatosBasicos,
  datosBasicosDe,
  validarDatosBasicos,
  type CampoBasico,
  type DatosBasicos,
} from "@/lib/patients/editar-paciente";
import { updatePatient } from "@/lib/patients/patients.functions";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";
import { CamposFicha } from "@/components/campos-ficha";
import { useOpcionesDeFicha } from "@/hooks/use-opciones-ficha";
import {
  cambiosDeFicha,
  erroresDeCamposFicha,
  estadoCamposDe,
  type CampoFicha,
  type EstadoCamposFicha,
} from "@/lib/patients/datos-ficha";
import {
  ETIQUETA_TIPO_DOCUMENTO,
  formatearRut,
  TIPOS_DOCUMENTO,
  tipoDocumentoPorDefecto,
  type TipoDocumento,
} from "@/lib/patients/rut";

/**
 * "Editar datos" de la ficha: nombre, documento, fecha de nacimiento,
 * teléfono y email, con los mismos campos y reglas que el alta. Solo manda
 * lo que cambió (ver `cambiosDeDatosBasicos`). Quién lo ve lo decide la
 * ficha con `puedeEditarPaciente`; el servidor lo vuelve a verificar.
 */
export function EditarPacienteDialog({
  clinicId,
  country,
  paciente,
  abierto: abiertoControlado,
  onAbiertoChange,
}: {
  clinicId: string;
  /** País de la clínica, para mostrar cómo queda guardado el teléfono. */
  country: string | null;
  paciente: Pick<
    Paciente,
    | "id"
    | "nombre"
    | "documento"
    | "fechaNacimiento"
    | "telefono"
    | "email"
    | "documentoTipo"
    | "prevision"
    | "previsionTramo"
    | "previsionInstitucion"
    | "contactoEmergencia"
    | "origen"
    | "origenDetalle"
    | "direccion"
    | "comuna"
    | "sexo"
  >;
  /**
   * Modo controlado (menú "Más acciones" de la ficha): el padre abre y cierra
   * el diálogo y no se dibuja el botón propio.
   */
  abierto?: boolean;
  onAbiertoChange?: (abierto: boolean) => void;
}) {
  const fid = useId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const updateFn = useServerFn(updatePatient);

  const controlado = abiertoControlado !== undefined;
  const [abiertoInterno, setAbiertoInterno] = useState(false);
  const abierto = controlado ? abiertoControlado : abiertoInterno;
  const setAbierto = (v: boolean) => (controlado ? onAbiertoChange?.(v) : setAbiertoInterno(v));
  const [original, setOriginal] = useState<DatosBasicos>(() => datosBasicosDe(paciente));
  const [datos, setDatos] = useState<DatosBasicos>(original);
  const [errores, setErrores] = useState<Partial<Record<CampoBasico, string>>>({});
  // Ola 1: tipo de documento, previsión, contacto de emergencia, origen y domicilio.
  const esChile = (country ?? "").toUpperCase() === "CL";
  const tipoPorDefecto = tipoDocumentoPorDefecto(country);
  const [fichaOriginal, setFichaOriginal] = useState<EstadoCamposFicha>(() =>
    estadoCamposDe(paciente, tipoPorDefecto),
  );
  const [ficha, setFicha] = useState<EstadoCamposFicha>(fichaOriginal);
  const [erroresFicha, setErroresFicha] = useState<Partial<Record<CampoFicha, string>>>({});
  const opciones = useOpcionesDeFicha(abierto ? clinicId : null);

  const cambios = {
    ...cambiosDeFicha(fichaOriginal, ficha),
    ...cambiosDeDatosBasicos(original, datos),
  };
  const hayCambios = Object.keys(cambios).length > 0;
  const avisoTelefono = avisoDeTelefono(datos.telefono, country);

  const guardar = useMutation({
    mutationFn: () => updateFn({ data: { clinicId, patientId: paciente.id, ...cambios } }),
    onSuccess: async () => {
      setAbierto(false);
      toast.success("Datos del paciente actualizados");
      // La ficha viene del loader de la ruta (router.invalidate); el listado
      // y los buscadores, de React Query.
      await queryClient.invalidateQueries({ queryKey: ["patients", clinicId] });
      void router.invalidate();
    },
    onError: (e) => toast.error(mensajeDeError(e)),
  });

  function prepararDesdeLaFicha() {
    // Siempre desde lo que muestra la ficha ahora, no desde un borrador viejo.
    const actuales = datosBasicosDe(paciente);
    setOriginal(actuales);
    setDatos(actuales);
    setErrores({});
    const fichaActual = estadoCamposDe(paciente, tipoPorDefecto);
    setFichaOriginal(fichaActual);
    setFicha(fichaActual);
    setErroresFicha({});
  }

  function abrir() {
    prepararDesdeLaFicha();
    setAbierto(true);
  }

  // En modo controlado lo abre el padre: se prepara al abrirse.
  useEffect(() => {
    if (controlado && abiertoControlado) prepararDesdeLaFicha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlado, abiertoControlado]);

  function enviar() {
    const encontrados = validarDatosBasicos(datos);
    const deFicha = erroresDeCamposFicha(
      { ...ficha, documento: datos.documento },
      { previsionObligatoria: false, pais: country },
    );
    // El documento tiene un solo mensaje: el del RUT si corresponde.
    if (deFicha.documento) encontrados.documento = deFicha.documento;
    delete deFicha.documento;
    setErrores(encontrados);
    setErroresFicha(deFicha);
    const primero = [...Object.keys(encontrados), ...Object.keys(deFicha)][0];
    if (primero) {
      document.getElementById(`${fid}-${primero}`)?.focus();
      return;
    }
    if (!hayCambios) {
      setAbierto(false);
      return;
    }
    guardar.mutate();
  }

  function campo(nombre: CampoBasico) {
    const error = errores[nombre];
    return {
      id: `${fid}-${nombre}`,
      value: datos[nombre],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const valor = e.target.value;
        setDatos((d) => ({ ...d, [nombre]: valor }));
        if (error) setErrores((er) => ({ ...er, [nombre]: undefined }));
      },
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${fid}-${nombre}-error` : undefined,
      className: cn(error && "border-destructive"),
    };
  }

  function errorDe(nombre: CampoBasico) {
    const error = errores[nombre];
    return error ? (
      <p id={`${fid}-${nombre}-error`} role="alert" className="text-xs text-destructive">
        {error}
      </p>
    ) : null;
  }

  return (
    <>
      {!controlado && (
        <BloqueoEscritura>
          <button type="button" onClick={abrir} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden /> Editar datos
          </button>
        </BloqueoEscritura>
      )}

      <Dialog open={abierto} onOpenChange={(next) => !guardar.isPending && setAbierto(next)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar datos del paciente</DialogTitle>
            <DialogDescription>
              Corrige los datos de contacto e identificación. La historia clínica no cambia.
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              enviar();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-nombre`}>Nombre completo</Label>
              <Input {...campo("nombre")} autoComplete="off" maxLength={200} required />
              {errorDe("nombre")}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-documento`}>Documento</Label>
                <div className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-2">
                  <select
                    aria-label="Tipo de documento"
                    value={ficha.documentoTipo}
                    onChange={(e) => {
                      setFicha((f) => ({ ...f, documentoTipo: e.target.value as TipoDocumento }));
                      setErrores((er) => ({ ...er, documento: undefined }));
                    }}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
                  >
                    {TIPOS_DOCUMENTO.map((t) => (
                      <option key={t} value={t}>
                        {ETIQUETA_TIPO_DOCUMENTO[t]}
                      </option>
                    ))}
                  </select>
                  <Input
                    {...campo("documento")}
                    onBlur={() => {
                      // FIC-01: el RUT queda con puntos y guion al salir del campo.
                      if (ficha.documentoTipo === "rut" && datos.documento.trim()) {
                        const f = formatearRut(datos.documento);
                        if (f !== datos.documento) setDatos((d) => ({ ...d, documento: f }));
                      }
                    }}
                    autoComplete="off"
                    maxLength={40}
                  />
                </div>
                {errorDe("documento")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-fechaNacimiento`}>Fecha de nacimiento</Label>
                <Input {...campo("fechaNacimiento")} type="date" />
                {errorDe("fechaNacimiento")}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-telefono`}>Teléfono</Label>
                <Input
                  {...campo("telefono")}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  maxLength={40}
                  aria-describedby={
                    [
                      errores.telefono ? `${fid}-telefono-error` : null,
                      avisoTelefono ? `${fid}-telefono-aviso` : null,
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                />
                {errorDe("telefono")}
                {avisoTelefono && (
                  <p
                    id={`${fid}-telefono-aviso`}
                    aria-live="polite"
                    className={cn(
                      "text-xs",
                      avisoTelefono.tipo === "ok" ? "text-muted-foreground" : "text-warning",
                    )}
                  >
                    {avisoTelefono.texto}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-email`}>Email</Label>
                <Input {...campo("email")} type="email" autoComplete="off" maxLength={254} />
                {errorDe("email")}
              </div>
            </div>
            <div className="border-t border-hairline pt-4">
              <CamposFicha
                idBase={fid}
                valor={ficha}
                onChange={(cambio) => {
                  setFicha((f) => ({ ...f, ...cambio }));
                  setErroresFicha({});
                }}
                errores={erroresFicha}
                esChile={esChile}
                previsionObligatoria={false}
                isapres={opciones.isapres}
                origenes={opciones.origenes}
                conDocumento={false}
              />
            </div>
            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAbierto(false)}
                disabled={guardar.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={guardar.isPending || !hayCambios}>
                {guardar.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Guardar cambios
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
