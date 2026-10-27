// Visor de exámenes (IMG-03 y IMG-04, Ola 13): contrato con el frente A
// (exámenes y fotos). Recibe una URL firmada y la muestra en un diálogo a
// pantalla completa; no sube ni guarda nada.
//
//   <VisorDeExamen tipo="stl" url={firmada} nombre="Arcada superior.stl" onCerrar={…} />
//
// Este archivo es liviano a propósito: el visor 3D (con three.js) y el de
// DICOM entran con React.lazy en chunks aparte, solo cuando se abre uno.
import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Expand, Shrink, X } from "lucide-react";

import { useDevolverFoco } from "@/hooks/use-devolver-foco";
import { descargar, type Cargador } from "@/lib/visores/descarga";
import { MAX_BYTES_DICOM, MAX_BYTES_MALLA } from "@/lib/visores/limites";
import { cn } from "@/lib/utils";

export type TipoExamen = "stl" | "ply" | "obj" | "dicom";

const Visor3D = lazy(() => import("./visor-3d"));
const VisorDicom = lazy(() => import("./visor-dicom"));

const DESCRIPCION: Record<TipoExamen, string> = {
  stl: "Modelo 3D · STL",
  ply: "Modelo 3D · PLY",
  obj: "Modelo 3D · OBJ",
  dicom: "Imagen DICOM",
};

const FOCO =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const BOTON =
  "inline-flex h-[30px] items-center gap-1.5 rounded-full border border-control px-[11px] text-[12.5px] font-semibold text-foreground/80 hover:border-foreground pointer-coarse:h-11 pointer-coarse:px-3.5";

export function VisorDeExamen(props: {
  tipo: "stl" | "ply" | "obj" | "dicom";
  url: string;
  nombre: string;
  onCerrar?: () => void;
}) {
  const { tipo, url } = props;
  const cargar = useCallback<Cargador>(
    async (alProgreso, senal) => [
      await descargar(url, tipo === "dicom" ? MAX_BYTES_DICOM : MAX_BYTES_MALLA, alProgreso, senal),
    ],
    [url, tipo],
  );
  return (
    <VisorConCargador tipo={tipo} nombre={props.nombre} cargar={cargar} onCerrar={props.onCerrar} />
  );
}

/**
 * Lo mismo que `VisorDeExamen` pero con los bytes ya resueltos por quien
 * llama (varios archivos DICOM sueltos, archivos locales en la página de
 * prueba). El contrato con el frente A es `VisorDeExamen`.
 */
export function VisorConCargador({
  tipo,
  nombre,
  cargar,
  onCerrar,
}: {
  tipo: TipoExamen;
  nombre: string;
  cargar: Cargador;
  onCerrar?: () => void;
}) {
  const [abierto, setAbierto] = useState(true);
  const [intento, setIntento] = useState(0);
  const contenidoRef = useRef<HTMLDivElement>(null);
  const [completa, setCompleta] = useState(false);
  const [puedeCompleta, setPuedeCompleta] = useState(false);
  const { marcador, alCerrar } = useDevolverFoco();

  useEffect(() => {
    setPuedeCompleta(Boolean(document.fullscreenEnabled));
    const alCambiar = () => setCompleta(document.fullscreenElement === contenidoRef.current);
    document.addEventListener("fullscreenchange", alCambiar);
    return () => document.removeEventListener("fullscreenchange", alCambiar);
  }, []);

  const cerrar = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setAbierto(false);
    onCerrar?.();
  };

  const alternarCompleta = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void contenidoRef.current?.requestFullscreen().catch(() => {});
  };

  const reintentar = () => setIntento((n) => n + 1);

  return (
    <DialogPrimitive.Root open={abierto} onOpenChange={(o) => !o && cerrar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <DialogPrimitive.Content
          ref={contenidoRef}
          onCloseAutoFocus={alCerrar()}
          className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none lg:inset-4 lg:overflow-hidden lg:rounded-[14px] lg:border lg:border-hairline"
        >
          {marcador}
          <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-muted-foreground">
                <b className="font-semibold text-foreground/85">Examen</b>
                <span aria-hidden> · </span>
                {DESCRIPCION[tipo]}
              </p>
              <DialogPrimitive.Title className="truncate font-display text-[24px] font-medium leading-tight sm:text-[28px]">
                {nombre}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                {tipo === "dicom"
                  ? "Visor de cortes DICOM con ventana, zoom y medición en milímetros."
                  : "Visor 3D con rotación, zoom, vistas, color, transparencia y medición en milímetros."}
              </DialogPrimitive.Description>
            </div>
            {puedeCompleta && (
              <button type="button" onClick={alternarCompleta} className={cn(BOTON, FOCO)}>
                {completa ? (
                  <Shrink aria-hidden className="size-3.5" />
                ) : (
                  <Expand aria-hidden className="size-3.5" />
                )}
                <span className="max-sm:sr-only">
                  {completa ? "Salir de pantalla completa" : "Pantalla completa"}
                </span>
              </button>
            )}
            <DialogPrimitive.Close className={cn(BOTON, FOCO)}>
              <X aria-hidden className="size-3.5" />
              <span className="max-sm:sr-only">Cerrar</span>
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1">
            <BarreraDeCarga onReintentar={reintentar} intento={intento}>
              <Suspense fallback={<Preparando />}>
                {tipo === "dicom" ? (
                  <VisorDicom cargar={cargar} intento={intento} onReintentar={reintentar} />
                ) : (
                  <Visor3D
                    cargar={cargar}
                    formato={tipo}
                    intento={intento}
                    onReintentar={reintentar}
                  />
                )}
              </Suspense>
            </BarreraDeCarga>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Preparando() {
  return (
    <p
      role="status"
      className="grid h-full place-items-center p-6 text-[15px] text-muted-foreground"
    >
      Abriendo el visor…
    </p>
  );
}

/** Si el chunk del visor no carga (deploy nuevo, sin conexión), se explica. */
class BarreraDeCarga extends Component<
  { children: ReactNode; onReintentar: () => void; intento: number },
  { fallo: boolean; intento: number }
> {
  state = { fallo: false, intento: this.props.intento };
  static getDerivedStateFromError() {
    return { fallo: true };
  }
  static getDerivedStateFromProps(
    props: { intento: number },
    state: { fallo: boolean; intento: number },
  ) {
    return props.intento !== state.intento ? { fallo: false, intento: props.intento } : null;
  }
  componentDidCatch(error: unknown) {
    console.error(error);
  }
  render() {
    if (!this.state.fallo) return this.props.children;
    return (
      <div role="alert" className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-md space-y-3">
          <p className="font-display text-[22px] font-medium">No se pudo abrir el visor</p>
          <p className="text-[15px] text-foreground/80">
            Revisa la conexión. Si Esmalia se actualizó mientras trabajabas, recarga la página.
          </p>
          <button type="button" onClick={this.props.onReintentar} className={cn(BOTON, FOCO)}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}
