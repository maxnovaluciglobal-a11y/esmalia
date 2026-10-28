// Visor 3D de escaneos intraorales y modelos (IMG-03). Entra con React.lazy
// desde visor-de-examen.tsx: este archivo y three.js viven en un chunk aparte.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { esEquipoChico, limitesDelEquipo } from "@/lib/visores/limites";
import { cajaDe, type FormatoMalla, type Malla } from "@/lib/visores/malla";
import { ejecutarEnTrabajador } from "@/lib/visores/trabajador";
import type { Cargador } from "@/lib/visores/descarga";
import { formatoMm, type Punto3 } from "@/lib/visores/medida";
import { cn } from "@/lib/utils";

import {
  Chip,
  Deslizador,
  EstadoCargando,
  EstadoError,
  DISPOSICION,
  ESCENARIO,
  FOCO,
  GrupoChips,
  LATERAL,
  PanelDatos,
  useCargaDeExamen,
  type ContextoDePreparacion,
} from "./controles";
import { crearEscena, type Escena3D, type Vista } from "./escena-3d";
import { numero } from "@/lib/formato-fecha";

// Colores del material: son del render 3D, no de la interfaz (los tokens
// de styles.css no tienen un "yeso"). Se eligieron para leerse en claro y
// en oscuro sobre fondo transparente.
const COLORES = [
  { id: "yeso", label: "Yeso", hex: "#e9e4d8" },
  { id: "marfil", label: "Marfil", hex: "#f1dfb8" },
  { id: "gris", label: "Gris", hex: "#a9adb5" },
  { id: "encia", label: "Encía", hex: "#d79b93" },
] as const;

const VISTAS: { id: Vista; label: string; tecla: string }[] = [
  { id: "superior", label: "Superior", tecla: "1" },
  { id: "inferior", label: "Inferior", tecla: "2" },
  { id: "frontal", label: "Frontal", tecla: "3" },
  { id: "inicial", label: "Restablecer", tecla: "0" },
];

const NOMBRE_FORMATO: Record<FormatoMalla, string> = {
  stl: "STL",
  ply: "PLY",
  obj: "OBJ",
};

function leerToken(nombre: string, respaldo: string): string {
  if (typeof window === "undefined") return respaldo;
  const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  return v || respaldo;
}

export default function Visor3D({
  cargar,
  formato,
  intento,
  onReintentar,
}: {
  cargar: Cargador;
  formato: FormatoMalla;
  intento: number;
  onReintentar: () => void;
}) {
  const preparar = useCallback(
    async (archivos: Uint8Array[], { senal, alProgreso }: ContextoDePreparacion) => {
      const limites = limitesDelEquipo(esEquipoChico());
      const r = await ejecutarEnTrabajador(
        {
          tipo: "malla",
          formato,
          bytes: archivos[0],
          topes: {
            bytes: limites.bytesMalla,
            bytesTexto: limites.bytesMallaTexto,
            triangulos: limites.triangulos,
          },
        },
        senal,
        alProgreso,
      );
      if (r.tipo !== "malla") throw new Error("Respuesta inesperada del procesador.");
      return r.malla;
    },
    [formato],
  );
  const estado = useCargaDeExamen(cargar, preparar, intento);

  if (estado.fase === "cargando") return <EstadoCargando {...estado} que="el modelo 3D" />;
  if (estado.fase === "error")
    return <EstadoError mensaje={estado.mensaje} onReintentar={onReintentar} />;
  return <Visor3DListo malla={estado.datos} formato={formato} />;
}

function Visor3DListo({ malla, formato }: { malla: Malla; formato: FormatoMalla }) {
  const uid = useId();
  const lienzoRef = useRef<HTMLDivElement>(null);
  const escenaRef = useRef<Escena3D | null>(null);
  const [color, setColor] = useState<string>(malla.colores ? "archivo" : "yeso");
  const [opacidad, setOpacidad] = useState(100);
  const [midiendo, setMidiendo] = useState(false);
  const [medida, setMedida] = useState<{ puntos: Punto3[]; mm: number | null }>({
    puntos: [],
    mm: null,
  });
  const [errorWebgl, setErrorWebgl] = useState(false);

  const dimensiones = useMemo(() => {
    const { min, max } = cajaDe(malla.posiciones);
    return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  }, [malla]);

  useEffect(() => {
    const el = lienzoRef.current;
    if (!el) return;
    try {
      escenaRef.current = crearEscena(el, malla, {
        colorMedida: leerToken("--cobalt", "#2e4bff"),
        alMedir: (puntos, mm) => setMedida({ puntos, mm }),
      });
    } catch (e) {
      console.error(e);
      setErrorWebgl(true);
    }
    return () => {
      escenaRef.current?.destruir();
      escenaRef.current = null;
    };
  }, [malla]);

  useEffect(() => {
    const hex = color === "archivo" ? null : (COLORES.find((c) => c.id === color)?.hex ?? null);
    escenaRef.current?.color(hex);
  }, [color, malla]);
  useEffect(() => escenaRef.current?.opacidad(opacidad / 100), [opacidad, malla]);
  useEffect(() => escenaRef.current?.modoMedir(midiendo), [midiendo, malla]);

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
      m: () => setMidiendo((v) => !v),
      M: () => setMidiendo((v) => !v),
    };
    for (const v of VISTAS) acciones[v.tecla] = () => esc.vista(v.id);
    const accion = acciones[e.key];
    if (accion) {
      e.preventDefault();
      accion();
    }
  };

  const fmt = (n: number) => numero(n, { maximumFractionDigits: 1 });
  const textoMedida =
    medida.mm !== null
      ? formatoMm(medida.mm)
      : medida.puntos.length === 1
        ? "Toca el segundo punto"
        : midiendo
          ? "Toca dos puntos del modelo"
          : "Sin medida";

  return (
    <div className={DISPOSICION}>
      <div className={ESCENARIO}>
        <div
          ref={lienzoRef}
          tabIndex={0}
          role="application"
          aria-roledescription="visor 3D"
          aria-label={`Modelo 3D ${NOMBRE_FORMATO[formato]}. Flechas para girar, más y menos para acercar, 1 superior, 2 inferior, 3 frontal, 0 restablecer, M para medir.`}
          aria-describedby={`${uid}-datos`}
          onKeyDown={alTeclear}
          className={cn("absolute inset-0", FOCO, "focus-visible:outline-offset-[-3px]")}
        />
        {errorWebgl && (
          <p
            role="alert"
            className="absolute inset-x-4 top-4 rounded-md bg-card p-3 text-[14px] shadow-md"
          >
            Este navegador no pudo iniciar el 3D (WebGL). Prueba con otro navegador o descarga el
            archivo para abrirlo en el software del escáner.
          </p>
        )}
        {midiendo && (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-night px-3 py-1 text-[12.5px] font-medium text-on-night">
            Medir: toca dos puntos del modelo
          </p>
        )}
      </div>

      <aside className={LATERAL}>
        <GrupoChips etiqueta="Vista">
          {VISTAS.map((v) => (
            <Chip
              key={v.id}
              onClick={() => escenaRef.current?.vista(v.id)}
              titulo={`Tecla ${v.tecla}`}
            >
              {v.label}
            </Chip>
          ))}
        </GrupoChips>

        <GrupoChips etiqueta="Medir distancia">
          <Chip activo={midiendo} onClick={() => setMidiendo((v) => !v)} titulo="Tecla M">
            Medir
          </Chip>
          <Chip
            onClick={() => escenaRef.current?.limpiarMedida()}
            disabled={medida.puntos.length === 0}
          >
            Borrar medida
          </Chip>
          <Chip onClick={() => escenaRef.current?.acercar(1.25)}>Acercar</Chip>
          <Chip onClick={() => escenaRef.current?.acercar(1 / 1.25)}>Alejar</Chip>
        </GrupoChips>

        <GrupoChips etiqueta="Color">
          {malla.colores && (
            <Chip activo={color === "archivo"} onClick={() => setColor("archivo")}>
              Del archivo
            </Chip>
          )}
          {COLORES.map((c) => (
            <Chip key={c.id} activo={color === c.id} onClick={() => setColor(c.id)}>
              <span
                aria-hidden
                className="size-3 rounded-full border border-control"
                style={{ backgroundColor: c.hex }}
              />
              {c.label}
            </Chip>
          ))}
        </GrupoChips>

        <Deslizador
          etiqueta="Opacidad"
          valor={opacidad}
          min={15}
          max={100}
          paso={5}
          onCambiar={setOpacidad}
          textoValor={`${opacidad} %`}
        />

        <PanelDatos
          id={`${uid}-datos`}
          titulo="Datos del modelo"
          filas={[
            { termino: "Formato", valor: NOMBRE_FORMATO[formato] },
            {
              termino: "Triángulos",
              valor: <span className="cifra">{numero(malla.triangulos)}</span>,
            },
            {
              termino: "Tamaño",
              valor: (
                <span className="cifra text-cobalt-on-night">
                  {fmt(dimensiones[0])} × {fmt(dimensiones[1])} × {fmt(dimensiones[2])} mm
                </span>
              ),
            },
            {
              termino: "Medida",
              valor: (
                <span
                  aria-live="polite"
                  className={cn(
                    medida.mm !== null
                      ? "cifra text-[18px] text-cobalt-on-night"
                      : "text-on-night-2",
                  )}
                >
                  {textoMedida}
                </span>
              ),
            },
          ]}
        >
          <p className="mt-3 text-[12.5px] leading-relaxed text-on-night-2">
            Las medidas usan las unidades del archivo; los escáneres y Exocad exportan en
            milímetros. Gira con un dedo o el clic, acerca con la pinza o la rueda y desplaza con
            dos dedos o el clic derecho.
          </p>
        </PanelDatos>
      </aside>
    </div>
  );
}
