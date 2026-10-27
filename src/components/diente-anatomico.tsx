import { useId } from "react";

import {
  CONDITION_CATALOG,
  type OdontogramMark,
  type ToothCondition,
  type ToothSurface,
} from "@/lib/clinical/odontogram";
import {
  COLORES_SIMBOLOGIA,
  OPACIDAD_PLANIFICADO,
  hexDeMarca,
  marcaParaPintar,
} from "@/lib/clinical/odontograma-reglas";
import { cn } from "@/lib/utils";

/**
 * Pieza dental dibujada como diente real (vista vestibular): corona con la
 * forma de su tipo y raíces según arcada. Acompaña al esquema de cinco
 * superficies del odontograma, no lo reemplaza: el esquema sigue siendo el
 * control accesible (foco, lector de pantalla) y este dibujo es la lectura
 * rápida de un vistazo, que además se puede tocar para marcar.
 *
 * Se dibuja siempre en orientación superior (raíz arriba, corona abajo) en un
 * viewBox de 40×84; la arcada inferior se espeja en vertical.
 */

type Tipo = "incisivo-central" | "incisivo-lateral" | "canino" | "premolar" | "molar";

export const ANCHO_DIENTE = 40;
export const ALTO_DIENTE = 84;

/** Línea amelocementaria: dónde termina la raíz y empieza la corona. */
const CUELLO = 46;
/** Desde acá hacia el borde es la superficie oclusal / incisal. */
const BORDE_OCLUSAL = 74;
const TERCIO_MESIAL_DISTAL = 13;

const ESMALTE = "#f4f0e7";
const TRAZO = "#8c7f69";
/**
 * Volumen suave (elegido en vivo el 09-oct-2026 entre línea editorial,
 * volumen y realista): degradado con luz arriba a la izquierda, contorno
 * apenas insinuado y sin línea de brillo. El volumen lo da el degradado, no
 * el trazo; las piezas con condición conservan su color plano y su contorno.
 */
const CONTORNO_VOLUMEN = "#a39578";
const OPACIDAD_CONTORNO = 0.2;

function tipoDePieza(tooth: number): Tipo {
  const cuadrante = Math.floor(tooth / 10);
  const pos = tooth % 10;
  const temporal = cuadrante >= 5;
  if (pos === 1) return "incisivo-central";
  if (pos === 2) return "incisivo-lateral";
  if (pos === 3) return "canino";
  // En la dentición temporal 4 y 5 son molares (no hay premolares).
  if (temporal) return "molar";
  return pos <= 5 ? "premolar" : "molar";
}

const CORONAS: Record<Tipo, string> = {
  "incisivo-central": "M9 46 C8 60 9 74 11 82 Q20 85.5 29 82 C31 74 32 60 31 46 Z",
  "incisivo-lateral": "M11 46 C10 60 11 73 13 81 Q20 84 27 81 C29 73 30 60 29 46 Z",
  canino: "M9 46 C8 60 10 71 14 78 L20 84 L26 78 C30 71 32 60 31 46 Z",
  premolar: "M8 46 C6 60 8 74 11 81 Q20 85 29 81 C32 74 34 60 32 46 Z",
  molar: "M4 46 C2 60 4 75 8 81 Q14 85 20 82 Q26 85 32 81 C36 75 38 60 36 46 Z",
};

/** Raíces por tipo y arcada. Cada string es una raíz (un path). */
function raices(tooth: number, tipo: Tipo): string[] {
  const superior = [1, 2, 5, 6].includes(Math.floor(tooth / 10));
  const pos = tooth % 10;
  switch (tipo) {
    case "incisivo-central":
    case "incisivo-lateral":
      return ["M12 47 C13 30 17 12 20 3 C23 12 27 30 28 47 Z"];
    case "canino":
      return ["M12 47 C13 28 17 8 20 0 C23 8 27 28 28 47 Z"];
    case "premolar":
      // El primer premolar superior suele tener dos raíces.
      return superior && pos === 4
        ? [
            "M10 47 C10 32 12 16 15 7 C18 16 19 32 19 47 Z",
            "M21 47 C21 32 22 16 25 7 C28 16 30 32 30 47 Z",
          ]
        : ["M11 47 C12 30 16 12 20 5 C24 12 28 30 29 47 Z"];
    case "molar":
      return superior
        ? [
            "M6 47 C5 30 7 15 10 6 C13 16 15 30 16 47 Z",
            "M16 47 C17 32 19 20 20 14 C21 20 23 32 24 47 Z",
            "M24 47 C25 30 27 16 30 6 C33 15 35 30 34 47 Z",
          ]
        : [
            "M7 47 C6 30 9 14 13 5 C16 16 17 30 18 47 Z",
            "M22 47 C23 30 24 16 27 5 C31 14 34 30 33 47 Z",
          ];
  }
}

/** Centro de cada raíz (x, punta) para dibujar el conducto de la endodoncia. */
function conductos(tooth: number, tipo: Tipo): { x: number; punta: number }[] {
  const superior = [1, 2, 5, 6].includes(Math.floor(tooth / 10));
  if (tipo === "molar") {
    return superior
      ? [
          { x: 10.5, punta: 12 },
          { x: 20, punta: 19 },
          { x: 29.5, punta: 12 },
        ]
      : [
          { x: 12.5, punta: 11 },
          { x: 27.5, punta: 11 },
        ];
  }
  if (tipo === "premolar" && superior && tooth % 10 === 4) {
    return [
      { x: 15, punta: 13 },
      { x: 25.5, punta: 13 },
    ];
  }
  return [{ x: 20, punta: tipo === "canino" ? 6 : 9 }];
}

/** Cuadrantes que se dibujan a la izquierda del observador: su mesial mira a la derecha. */
function mesialALaDerecha(tooth: number) {
  return [1, 4, 5, 8].includes(Math.floor(tooth / 10));
}

type Zona = {
  surface: Exclude<ToothSurface, "whole" | "lingual">;
  x: number;
  y: number;
  w: number;
  h: number;
};

function zonasDeCorona(tooth: number): Zona[] {
  const izq = TERCIO_MESIAL_DISTAL;
  const der = ANCHO_DIENTE - TERCIO_MESIAL_DISTAL;
  const alto = BORDE_OCLUSAL - CUELLO;
  const lateralIzq = mesialALaDerecha(tooth) ? "distal" : "mesial";
  const lateralDer = mesialALaDerecha(tooth) ? "mesial" : "distal";
  return [
    { surface: lateralIzq, x: 0, y: CUELLO, w: izq, h: alto },
    { surface: "vestibular", x: izq, y: CUELLO, w: der - izq, h: alto },
    { surface: lateralDer, x: der, y: CUELLO, w: ANCHO_DIENTE - der, h: alto },
    { surface: "oclusal", x: 0, y: BORDE_OCLUSAL, w: ANCHO_DIENTE, h: ALTO_DIENTE - BORDE_OCLUSAL },
  ];
}

/** Marca que pinta una zona: la existente manda, lo planificado va más claro. */
function pintura(marcas: readonly OdontogramMark[]): { color: string; opacidad: number } | null {
  const m = marcaParaPintar(marcas);
  if (!m) return null;
  return { color: hexDeMarca(m), opacidad: m.status === "planificado" ? OPACIDAD_PLANIFICADO : 1 };
}

/** Teclas modificadoras del clic (lo que el odontograma necesita del evento). */
export type ModificadoresDeClic = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

/** Condiciones de pieza que cubren la corona entera en el dibujo. */
const CUBREN_CORONA: readonly ToothCondition[] = ["corona", "puente", "protesis"];

export function DienteAnatomico({
  tooth,
  marcas,
  inferior = false,
  seleccionado = false,
  onClick,
}: {
  tooth: number;
  /** Todas las marcas vigentes de la pieza (pueden ser varias, CLI-01). */
  marcas: readonly OdontogramMark[];
  /** Arcada inferior: se espeja en vertical (raíz abajo, corona arriba). */
  inferior?: boolean;
  seleccionado?: boolean;
  /** El evento viaja para leer Ctrl/Cmd/Shift (marcar varias piezas, ODO-05). */
  onClick: (surface: ToothSurface, e?: ModificadoresDeClic) => void;
}) {
  const clipId = useId();
  const coronaGradId = useId();
  const raizGradId = useId();
  const tipo = tipoDePieza(tooth);
  const corona = CORONAS[tipo];
  const listaRaices = raices(tooth, tipo);

  const deLaPieza = marcas.filter((m) => m.surface === "whole");
  const existente = (c: ToothCondition) =>
    deLaPieza.find((m) => m.condition === c && m.status === "existente");
  const ausente = Boolean(existente("ausente"));
  const extraccion = deLaPieza.find((m) => m.condition === "extraccion_indicada");
  const implanteMarca = existente("implante") ?? deLaPieza.find((m) => m.condition === "implante");
  const implante = Boolean(implanteMarca);
  const implanteColor = implanteMarca ? hexDeMarca(implanteMarca) : COLORES_SIMBOLOGIA.azul;
  const implanteOpacidad = implanteMarca?.status === "planificado" ? OPACIDAD_PLANIFICADO : 1;
  // Corona, puente o prótesis tiñen la corona entera; si no hay, una
  // condición de superficie que quedó en la pieza completa (marcas viejas,
  // ej. caries "whole") o una patología de pieza (restos radiculares).
  const cubre =
    pintura(deLaPieza.filter((m) => CUBREN_CORONA.includes(m.condition))) ??
    pintura(
      deLaPieza.filter((m) => {
        const def = CONDITION_CATALOG[m.condition];
        return def.alcance !== "pieza" || m.condition === "restos_radiculares";
      }),
    );
  const coronaColor = cubre?.color ?? null;
  const coronaOpacidad = cubre?.opacidad ?? 1;
  const endodonciaMarca =
    marcas.find((m) => m.condition === "endodoncia" && m.status === "existente") ??
    marcas.find((m) => m.condition === "endodoncia");
  const endodoncia = Boolean(endodonciaMarca);
  const lingual = pintura(marcas.filter((m) => m.surface === "lingual"));
  const trazo = seleccionado ? "var(--color-brand-700)" : TRAZO;
  const grosor = seleccionado ? 1.6 : 0.9;
  // Contorno del diente sano en volumen: tenue salvo cuando está seleccionado.
  const trazoVolumen = seleccionado ? "var(--color-brand-700)" : CONTORNO_VOLUMEN;
  const opacidadVolumen = seleccionado ? 1 : OPACIDAD_CONTORNO;

  return (
    <svg
      width={ANCHO_DIENTE}
      height={ALTO_DIENTE}
      viewBox={`0 0 ${ANCHO_DIENTE} ${ALTO_DIENTE}`}
      // El esquema de superficies de al lado es el control accesible de esta
      // misma pieza; el dibujo duplica la acción con el puntero.
      aria-hidden="true"
      focusable="false"
      className={cn(
        "group/diente cursor-pointer overflow-visible transition-opacity",
        ausente && "opacity-70",
      )}
    >
      <g transform={inferior ? `translate(0 ${ALTO_DIENTE}) scale(1 -1)` : undefined}>
        <defs>
          <clipPath id={clipId}>
            <path d={corona} />
          </clipPath>
          <linearGradient id={coronaGradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fdfbf6" />
            <stop offset="0.55" stopColor="#f2ebde" />
            <stop offset="1" stopColor="#d9ccb2" />
          </linearGradient>
          <linearGradient id={raizGradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ecdfc5" />
            <stop offset="0.5" stopColor="#e2d2b2" />
            <stop offset="1" stopColor="#c8b38c" />
          </linearGradient>
        </defs>

        {/* Raíz: un clic en la raíz marca la pieza completa. */}
        <g onClick={(e) => onClick("whole", e)}>
          {implante ? (
            <g opacity={implanteOpacidad}>
              <rect
                x={15}
                y={6}
                width={10}
                height={41}
                rx={3}
                fill="#b9cdd1"
                stroke={implanteColor}
                strokeWidth={1}
              />
              {[13, 19, 25, 31, 37, 43].map((y) => (
                <path key={y} d={`M15 ${y} L25 ${y - 2}`} stroke={implanteColor} strokeWidth={1} />
              ))}
            </g>
          ) : (
            listaRaices.map((d) => (
              <path
                key={d}
                d={d}
                fill={ausente ? "none" : `url(#${raizGradId})`}
                stroke={ausente ? "#8a8a8a" : trazoVolumen}
                strokeOpacity={ausente ? 1 : opacidadVolumen}
                strokeWidth={ausente ? grosor : seleccionado ? grosor : 0.7}
                strokeDasharray={ausente ? "2.5 2" : undefined}
                strokeLinejoin="round"
              />
            ))
          )}
          {endodoncia &&
            !implante &&
            !ausente &&
            conductos(tooth, tipo).map((c) => (
              <path
                key={c.x}
                d={`M${c.x} ${c.punta} L${c.x} ${CUELLO + 6}`}
                stroke={hexDeMarca(endodonciaMarca!)}
                strokeOpacity={endodonciaMarca!.status === "planificado" ? OPACIDAD_PLANIFICADO : 1}
                strokeWidth={2.4}
                strokeLinecap="round"
              />
            ))}
        </g>

        {/* Corona */}
        <path
          d={corona}
          fill={ausente ? "none" : (coronaColor ?? `url(#${coronaGradId})`)}
          fillOpacity={coronaColor ? coronaOpacidad : 1}
          stroke={ausente ? "#8a8a8a" : coronaColor ? trazo : trazoVolumen}
          strokeOpacity={ausente || coronaColor ? 1 : opacidadVolumen}
          strokeWidth={ausente || coronaColor || seleccionado ? grosor + 0.3 : 0.8}
          strokeDasharray={ausente ? "2.5 2" : undefined}
          strokeLinejoin="round"
          pointerEvents="none"
        />

        {!ausente && (
          <g clipPath={`url(#${clipId})`}>
            {zonasDeCorona(tooth).map((z) => {
              const p = coronaColor ? null : pintura(marcas.filter((m) => m.surface === z.surface));
              return (
                <rect
                  key={z.surface}
                  x={z.x}
                  y={z.y}
                  width={z.w}
                  height={z.h}
                  fill={p?.color ?? "transparent"}
                  fillOpacity={p ? 0.88 * p.opacidad : 1}
                  className={cn(!p && "hover:fill-brand/15")}
                  onClick={(e) => onClick(z.surface, e)}
                />
              );
            })}
            {lingual && !coronaColor && (
              // La cara lingual no se ve de frente: se marca como un punto
              // con anillo en el centro de la corona.
              <circle
                cx={20}
                cy={(CUELLO + BORDE_OCLUSAL) / 2}
                r={3.6}
                fill={lingual.color}
                fillOpacity={lingual.opacidad}
                stroke={ESMALTE}
                strokeWidth={1.2}
                pointerEvents="none"
              />
            )}
          </g>
        )}

        {/* Aspa: azul si la pieza está ausente, roja si hay que extraerla. */}
        {(ausente || extraccion) && (
          <path
            d="M10 52 L30 80 M30 52 L10 80"
            stroke={ausente ? COLORES_SIMBOLOGIA.azul : COLORES_SIMBOLOGIA.rojo}
            strokeWidth={2.4}
            strokeLinecap="round"
            onClick={(e) => onClick("whole", e)}
          />
        )}
      </g>
    </svg>
  );
}
