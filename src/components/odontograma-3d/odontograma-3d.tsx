// Odontograma 3D (ODO-10): vista opcional, de solo lectura, del odontograma
// de la ficha. Entra con React.lazy desde odontogram.tsx: este archivo y
// three.js viven en un chunk aparte que solo se baja al tocar "Ver en 3D".
//
// El 2D sigue siendo la vista principal y el único lugar donde se marca. Acá
// se pintan las mismas marcas vigentes, por superficie, con los mismos colores
// y la misma leyenda; tocar una pieza abre su panel (el mismo del 2D).
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Minus, Plus, RotateCcw, RotateCw } from "lucide-react";

import type { OdontogramMark } from "@/lib/clinical/odontogram";
import { toothCommonName } from "@/lib/clinical/odontogram";
import { describirVista3D } from "@/lib/clinical/odontograma-3d";
import type { Denticion } from "@/lib/clinical/odontograma-reglas";
import { cn } from "@/lib/utils";

import { Chip, FOCO } from "@/components/visores/controles";
import { crearEscenaOdonto, type EscenaOdonto, type VistaOdonto } from "./escena";

const VISTAS: { id: VistaOdonto; label: string; tecla: string }[] = [
  { id: "frontal", label: "Frontal", tecla: "1" },
  { id: "superior", label: "Arcada superior", tecla: "2" },
  { id: "inferior", label: "Arcada inferior", tecla: "3" },
  { id: "inicial", label: "Restablecer", tecla: "0" },
];

function leerToken(nombre: string, respaldo: string): string {
  if (typeof window === "undefined") return respaldo;
  const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  return /^#[0-9a-f]{3,8}$/i.test(v) ? v : respaldo;
}

export default function Odontograma3D({
  piezas,
  porPieza,
  denticion,
  seleccionada,
  onElegir,
  bajoElModelo,
}: {
  piezas: readonly number[];
  porPieza: ReadonlyMap<number, readonly OdontogramMark[]>;
  denticion: Denticion;
  seleccionada: number | null;
  onElegir: (tooth: number) => void;
  /** Lo que va pegado al modelo (el popover de la pieza elegida en pantallas sin panel). */
  bajoElModelo?: ReactNode;
}) {
  const uid = useId();
  const lienzoRef = useRef<HTMLDivElement>(null);
  const escenaRef = useRef<EscenaOdonto | null>(null);
  const elegirRef = useRef(onElegir);
  elegirRef.current = onElegir;
  const [errorWebgl, setErrorWebgl] = useState(false);
  const [sobre, setSobre] = useState<number | null>(null);

  useEffect(() => {
    const el = lienzoRef.current;
    if (!el) return;
    try {
      escenaRef.current = crearEscenaOdonto(el, {
        colorSeleccion: leerToken("--color-brand-600", "#9a5b1e"),
        alElegir: (t) => elegirRef.current(t),
        alSobrevolar: setSobre,
      });
    } catch (e) {
      console.error(e);
      setErrorWebgl(true);
    }
    return () => {
      escenaRef.current?.destruir();
      escenaRef.current = null;
    };
  }, []);

  useEffect(() => {
    escenaRef.current?.actualizar(piezas, porPieza);
  }, [piezas, porPieza]);
  useEffect(() => {
    escenaRef.current?.seleccionar(seleccionada);
  }, [seleccionada, piezas, porPieza]);

  const descripcion = useMemo(
    () => describirVista3D(piezas, porPieza, denticion),
    [piezas, porPieza, denticion],
  );

  const alTeclear = (e: React.KeyboardEvent) => {
    const esc = escenaRef.current;
    if (!esc) return;
    const paso = e.shiftKey ? Math.PI / 4 : Math.PI / 18;
    const acciones: Record<string, () => void> = {
      ArrowLeft: () => esc.rotar(-paso, 0),
      ArrowRight: () => esc.rotar(paso, 0),
      ArrowUp: () => esc.rotar(0, -paso),
      ArrowDown: () => esc.rotar(0, paso),
      "+": () => esc.acercar(1.2),
      "=": () => esc.acercar(1.2),
      "-": () => esc.acercar(1 / 1.2),
    };
    for (const v of VISTAS) acciones[v.tecla] = () => esc.vista(v.id);
    const accion = acciones[e.key];
    if (accion) {
      e.preventDefault();
      accion();
    }
  };

  const etiquetaFlotante = sobre ?? seleccionada;

  return (
    <div className="space-y-3">
      <div className="relative h-[340px] overflow-hidden rounded-xl border border-hairline bg-muted/40 sm:h-[440px]">
        <div
          ref={lienzoRef}
          tabIndex={0}
          role="application"
          aria-roledescription="odontograma 3D"
          aria-label="Odontograma 3D. Flechas para girar, más y menos para acercar, 1 frontal, 2 arcada superior, 3 arcada inferior, 0 restablecer. Para elegir una pieza usa la lista de abajo."
          aria-describedby={`${uid}-resumen`}
          onKeyDown={alTeclear}
          className={cn("absolute inset-0", FOCO, "focus-visible:outline-offset-[-3px]")}
        />
        {etiquetaFlotante !== null && !errorWebgl && (
          <p
            aria-hidden
            className="pointer-events-none absolute top-3 left-3 rounded-full bg-night px-3 py-1 text-[12.5px] font-medium text-on-night"
          >
            <span className="cifra">{etiquetaFlotante}</span>
            {toothCommonName(etiquetaFlotante) ? ` · ${toothCommonName(etiquetaFlotante)}` : ""}
          </p>
        )}
        {errorWebgl && (
          <p
            role="alert"
            className="absolute inset-x-4 top-4 rounded-md bg-card p-3 text-[14px] shadow-md"
          >
            Este navegador no pudo iniciar el 3D (WebGL). La descripción de abajo y el diagrama 2D
            tienen la misma información.
          </p>
        )}
        <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-end gap-1">
          <Chip
            onClick={() => escenaRef.current?.rotar(-Math.PI / 8, 0)}
            titulo="Girar a la izquierda (flecha izquierda)"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            <span className="sr-only">Girar a la izquierda</span>
          </Chip>
          <Chip
            onClick={() => escenaRef.current?.rotar(Math.PI / 8, 0)}
            titulo="Girar a la derecha (flecha derecha)"
          >
            <RotateCw className="size-3.5" aria-hidden />
            <span className="sr-only">Girar a la derecha</span>
          </Chip>
          <Chip onClick={() => escenaRef.current?.acercar(1.25)} titulo="Acercar (tecla +)">
            <Plus className="size-3.5" aria-hidden />
            <span className="sr-only">Acercar</span>
          </Chip>
          <Chip onClick={() => escenaRef.current?.acercar(1 / 1.25)} titulo="Alejar (tecla −)">
            <Minus className="size-3.5" aria-hidden />
            <span className="sr-only">Alejar</span>
          </Chip>
        </div>
      </div>

      {bajoElModelo}

      <div role="group" aria-label="Vista del modelo" className="flex flex-wrap gap-1">
        {VISTAS.map((v) => (
          <Chip
            key={v.id}
            onClick={() => escenaRef.current?.vista(v.id)}
            titulo={`Tecla ${v.tecla}`}
          >
            {v.label}
          </Chip>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Solo lectura: gira con un dedo o el clic, acerca con la pinza o la rueda y toca una pieza
        para ver sus condiciones. Las marcas se registran en el diagrama.
      </p>

      {/* Alternativa textual: lo mismo que pinta el modelo, dicho en palabras. */}
      <section
        aria-labelledby={`${uid}-titulo`}
        className="rounded-[14px] border border-night-line bg-night p-5 text-on-night"
      >
        <h4 id={`${uid}-titulo`} className="font-display text-[22px] leading-tight font-medium">
          Qué muestra el <em className="text-ochre-on-night italic">modelo</em>
        </h4>
        <p id={`${uid}-resumen`} className="mt-2 text-[14px] leading-relaxed text-on-night-2">
          {descripcion.resumen}
        </p>
        {descripcion.piezas.length > 0 && (
          <ul className="mt-3 grid gap-1.5" aria-label="Piezas con hallazgos">
            {descripcion.piezas.map((p) => (
              <li key={p.tooth}>
                <button
                  type="button"
                  onClick={() => onElegir(p.tooth)}
                  aria-pressed={seleccionada === p.tooth}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left text-[13.5px] leading-snug hover:bg-white/8 pointer-coarse:min-h-11",
                    seleccionada === p.tooth && "bg-white/10",
                    FOCO,
                  )}
                >
                  {p.texto}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
