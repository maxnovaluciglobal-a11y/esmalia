import { useEffect, useId, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CalendarPlus, FileText, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { CampoDocumento, CamposFicha } from "@/components/campos-ficha";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useOpcionesDeFicha } from "@/hooks/use-opciones-ficha";
import { useSoloLectura } from "@/hooks/use-solo-lectura";
import { mensajeDeError } from "@/lib/mensaje-error";
import {
  contactoDeEstado,
  erroresDeCamposFicha,
  estadoCamposVacio,
  guardarSalidaAlta,
  leerSalidaAlta,
  origenPorReferido,
  previsionDeEstado,
  type CampoFicha,
  type EstadoCamposFicha,
  type SalidaAlta,
} from "@/lib/patients/datos-ficha";
import {
  buscarFichasConMismoDocumento,
  buscarReferente,
  type FichaConMismoDocumento,
} from "@/lib/patients/datos-ficha.functions";
import { createPatient } from "@/lib/patients/patients.functions";
import { normalizarDocumento, tipoDocumentoPorDefecto } from "@/lib/patients/rut";
import { cn } from "@/lib/utils";

const CAMPO =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";

function almacenLocal(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * "Nuevo paciente" (PAC-11) con dos salidas: "Guardar y abrir ficha" y
 * "Guardar y agendar cita" (abre la Nueva cita de la agenda con el paciente
 * elegido, por `?nueva=<id>`). La última salida elegida queda primero.
 *
 * Incluye los datos de Chile de la Ola 1: RUT validado (FIC-01), previsión
 * obligatoria en clínicas de Chile (FIC-02), contacto de emergencia (FIC-03),
 * origen o código de referido (FIC-04) y aviso de ficha duplicada (PAC-03).
 */
export function NuevoPacienteDialog({
  clinicId,
  pais,
  abrirAhora = false,
  onAbierto,
}: {
  clinicId: string;
  /** País de la clínica (ISO-2): define RUT por defecto y previsión obligatoria. */
  pais: string | null | undefined;
  abrirAhora?: boolean;
  onAbierto?: () => void;
}) {
  const fid = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const soloLectura = useSoloLectura();
  const esChile = (pais ?? "").toUpperCase() === "CL";
  const [open, setOpen] = useState(false);

  // Pedido del ⌘K (`?nuevo=1`): abre una vez y la página borra el pedido.
  useEffect(() => {
    if (!abrirAhora) return;
    if (!soloLectura) setOpen(true);
    onAbierto?.();
  }, [abrirAhora, soloLectura, onAbierto]);

  const [nombre, setNombre] = useState("");
  const [fechaNacimiento, setFechaNacimiento] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [ficha, setFicha] = useState<EstadoCamposFicha>(() =>
    estadoCamposVacio(tipoDocumentoPorDefecto(pais)),
  );
  const [codigoReferido, setCodigoReferido] = useState("");
  const [referente, setReferente] = useState<{ id: string; nombre: string } | null>(null);
  const [errorReferido, setErrorReferido] = useState<string | null>(null);
  const [errores, setErrores] = useState<
    Partial<Record<CampoFicha | "nombre" | "fechaNacimiento", string>>
  >({});
  const [duplicados, setDuplicados] = useState<FichaConMismoDocumento[]>([]);
  const [confirmaDuplicado, setConfirmaDuplicado] = useState(false);
  const [salidaPreferida, setSalidaPreferida] = useState<SalidaAlta>("ficha");

  useEffect(() => {
    if (open) setSalidaPreferida(leerSalidaAlta(almacenLocal()));
  }, [open]);

  const opciones = useOpcionesDeFicha(open ? clinicId : null);
  const createFn = useServerFn(createPatient);
  const duplicadosFn = useServerFn(buscarFichasConMismoDocumento);
  const referenteFn = useServerFn(buscarReferente);

  function reset() {
    setNombre("");
    setFechaNacimiento("");
    setTelefono("");
    setEmail("");
    setFicha(estadoCamposVacio(tipoDocumentoPorDefecto(pais)));
    setCodigoReferido("");
    setReferente(null);
    setErrorReferido(null);
    setErrores({});
    setDuplicados([]);
    setConfirmaDuplicado(false);
  }

  function cambiar(cambio: Partial<EstadoCamposFicha>) {
    setFicha((f) => ({ ...f, ...cambio }));
    if (cambio.documento !== undefined || cambio.documentoTipo !== undefined) {
      setDuplicados([]);
      setConfirmaDuplicado(false);
    }
    setErrores((e) => {
      const limpio = { ...e };
      for (const k of Object.keys(cambio)) {
        if (k === "documento" || k === "documentoTipo") delete limpio.documento;
        if (k === "plan" || k === "tramo" || k === "institucion") delete limpio.prevision;
        if (k === "contactoNombre") delete limpio.contactoNombre;
        if (k === "contactoRelacion") delete limpio.contactoRelacion;
        if (k === "contactoTelefono") delete limpio.contactoTelefono;
        if (k === "origen" || k === "origenDetalle") delete limpio.origen;
      }
      return limpio;
    });
  }

  async function revisarDuplicados(documento: string) {
    if (!normalizarDocumento(documento)) return;
    try {
      setDuplicados(await duplicadosFn({ data: { clinicId, documento } }));
    } catch {
      // Es un aviso: si falla, el servidor vuelve a revisar al guardar.
    }
  }

  async function revisarReferido() {
    setErrorReferido(null);
    setReferente(null);
    if (!codigoReferido.trim()) return;
    try {
      const r = await referenteFn({ data: { clinicId, codigo: codigoReferido } });
      if (r) setReferente(r);
      else setErrorReferido("No encontramos ese código de referido en la clínica.");
    } catch (e) {
      setErrorReferido(mensajeDeError(e));
    }
  }

  const crear = useMutation({
    mutationFn: (salida: SalidaAlta) =>
      createFn({
        data: {
          clinicId,
          nombre: nombre.trim(),
          documento: ficha.documento,
          documentoTipo: ficha.documentoTipo,
          fechaNacimiento,
          telefono,
          email,
          ...(esChile
            ? {
                prevision: previsionDeEstado(ficha),
                direccion: ficha.direccion,
                comuna: ficha.comuna,
              }
            : {}),
          contactoEmergencia: contactoDeEstado(ficha),
          sexo: ficha.sexo || null,
          origen: { fuente: ficha.origen, detalle: ficha.origenDetalle },
          codigoReferido: codigoReferido.trim() || undefined,
          permitirDuplicado: confirmaDuplicado,
        },
      }).then((r) => ({ ...r, salida })),
    onSuccess: ({ id, salida }) => {
      guardarSalidaAlta(almacenLocal(), salida);
      void queryClient.invalidateQueries({ queryKey: ["patients", clinicId] });
      toast.success("Paciente creado");
      setOpen(false);
      reset();
      if (salida === "agendar") {
        void navigate({
          to: "/agenda",
          search: {
            q: "",
            fecha: "",
            sucursal: "",
            profesional: "",
            estado: "",
            page: 1,
            nueva: id,
          },
        });
      } else {
        void navigate({ to: "/pacientes/$pacienteId", params: { pacienteId: id } });
      }
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  function guardar(salida: SalidaAlta) {
    const encontrados: typeof errores = {
      ...erroresDeCamposFicha(ficha, { previsionObligatoria: esChile, pais }),
    };
    if (!nombre.trim()) encontrados.nombre = "El nombre es obligatorio.";
    if (!fechaNacimiento) encontrados.fechaNacimiento = "La fecha de nacimiento es obligatoria.";
    setErrores(encontrados);
    const primero = Object.keys(encontrados)[0];
    if (primero) {
      document.getElementById(`${fid}-${primero}`)?.focus();
      return;
    }
    crear.mutate(salida);
  }

  const motivo = !nombre.trim()
    ? "Escribe el nombre del paciente."
    : !fechaNacimiento
      ? "Falta la fecha de nacimiento."
      : duplicados.length > 0 && !confirmaDuplicado
        ? "Ya hay una ficha con este documento: ábrela o confirma que es otra persona."
        : errorReferido
          ? "Revisa el código de referido o bórralo."
          : null;

  const origenBloqueado = referente
    ? `${origenPorReferido(referente)!.origen} · ${origenPorReferido(referente)!.detalle}`
    : null;

  const salidas: { salida: SalidaAlta; texto: string; icono: React.ReactNode }[] = [
    { salida: "ficha", texto: "Guardar y abrir ficha", icono: <FileText aria-hidden /> },
    { salida: "agendar", texto: "Guardar y agendar cita", icono: <CalendarPlus aria-hidden /> },
  ];
  // La última salida elegida va primero (botón principal, y Enter la usa).
  const ordenadas = salidaPreferida === "agendar" ? [salidas[1], salidas[0]] : salidas;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (crear.isPending) return;
        setOpen(o);
      }}
    >
      <BloqueoEscritura>
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus className="size-4" /> Nuevo paciente
          </Button>
        </DialogTrigger>
      </BloqueoEscritura>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo paciente</DialogTitle>
          <DialogDescription>
            Datos para crear la ficha. Lo que falte lo puedes completar después desde la ficha.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            guardar(salidaPreferida);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-nombre`}>
              Nombre completo <span className="text-destructive">*</span>
            </Label>
            <input
              id={`${fid}-nombre`}
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value);
                setErrores((er) => ({ ...er, nombre: undefined }));
              }}
              className={cn(CAMPO, errores.nombre && "border-destructive")}
              placeholder="Nombre y apellidos"
              autoComplete="off"
              maxLength={200}
              aria-invalid={errores.nombre ? true : undefined}
              aria-describedby={errores.nombre ? `${fid}-nombre-error` : undefined}
            />
            {errores.nombre && (
              <p id={`${fid}-nombre-error`} role="alert" className="text-xs text-destructive">
                {errores.nombre}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CampoDocumento
              idBase={fid}
              tipo={ficha.documentoTipo}
              documento={ficha.documento}
              error={errores.documento}
              onChange={cambiar}
              onSalir={(d) => void revisarDuplicados(d)}
            />
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-fechaNacimiento`}>
                Fecha de nacimiento <span className="text-destructive">*</span>
              </Label>
              <input
                id={`${fid}-fechaNacimiento`}
                type="date"
                value={fechaNacimiento}
                onChange={(e) => {
                  setFechaNacimiento(e.target.value);
                  setErrores((er) => ({ ...er, fechaNacimiento: undefined }));
                }}
                className={cn(CAMPO, errores.fechaNacimiento && "border-destructive")}
                aria-invalid={errores.fechaNacimiento ? true : undefined}
              />
            </div>
          </div>

          {duplicados.length > 0 && (
            <div
              role="status"
              className="space-y-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm"
            >
              <p className="flex items-start gap-2 font-medium text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                Ya hay {duplicados.length === 1 ? "una ficha" : `${duplicados.length} fichas`} con
                este documento.
              </p>
              <ul className="space-y-1">
                {duplicados.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-foreground">{d.nombre}</span>
                    {d.archivada && (
                      <span className="text-xs text-muted-foreground">archivada</span>
                    )}
                    <Link
                      to="/pacientes/$pacienteId"
                      params={{ pacienteId: d.id }}
                      className="inline-flex min-h-9 items-center text-xs font-medium text-brand-700 underline underline-offset-2"
                    >
                      Abrir ficha
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Si es la misma persona cargada dos veces, ábrela o{" "}
                <Link
                  to="/fusionar-fichas"
                  className="font-medium text-brand-700 underline underline-offset-2"
                >
                  fusiona las fichas
                </Link>
                .
              </p>
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmaDuplicado}
                  onChange={(e) => setConfirmaDuplicado(e.target.checked)}
                  className="size-4 accent-brand-700"
                />
                Es otra persona: crear la ficha igual
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-telefono`}>Teléfono</Label>
              <input
                id={`${fid}-telefono`}
                type="tel"
                inputMode="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                className={CAMPO}
                autoComplete="off"
                maxLength={40}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-email`}>Email</Label>
              <input
                id={`${fid}-email`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={CAMPO}
                autoComplete="off"
                maxLength={254}
              />
            </div>
          </div>

          <CamposFicha
            idBase={fid}
            valor={ficha}
            onChange={cambiar}
            errores={errores}
            esChile={esChile}
            previsionObligatoria={esChile}
            isapres={opciones.isapres}
            origenes={opciones.origenes}
            origenBloqueado={origenBloqueado}
            conDocumento={false}
          />

          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-referido`}>
              Código de referido{" "}
              <span className="font-normal text-muted-foreground">(si lo trae)</span>
            </Label>
            <input
              id={`${fid}-referido`}
              value={codigoReferido}
              onChange={(e) => {
                setCodigoReferido(e.target.value);
                setReferente(null);
                setErrorReferido(null);
              }}
              onBlur={() => void revisarReferido()}
              className={cn(
                CAMPO,
                "block max-w-48 uppercase",
                errorReferido && "border-destructive",
              )}
              autoComplete="off"
              maxLength={20}
              aria-invalid={errorReferido ? true : undefined}
              aria-describedby={errorReferido ? `${fid}-referido-error` : undefined}
            />
            {errorReferido && (
              <p id={`${fid}-referido-error`} role="alert" className="text-xs text-destructive">
                {errorReferido}
              </p>
            )}
            {referente && (
              <p className="text-xs text-muted-foreground">
                Lo recomendó {referente.nombre}: el origen queda como Recomendación.
              </p>
            )}
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            {ordenadas.map(({ salida, texto, icono }, i) => (
              <AccionDeshabilitada key={salida} motivo={motivo} como={i === 0 ? "texto" : "globo"}>
                <Button
                  type={i === 0 ? "submit" : "button"}
                  variant={i === 0 ? "default" : "outline"}
                  onClick={i === 0 ? undefined : () => guardar(salida)}
                  disabled={crear.isPending}
                >
                  {crear.isPending && crear.variables === salida ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    icono
                  )}
                  {texto}
                </Button>
              </AccionDeshabilitada>
            ))}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
