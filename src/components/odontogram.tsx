import { Fragment, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  History,
  Info,
  List,
  LayoutGrid,
  ListChecks,
  Loader2,
  Receipt,
  RotateCcw,
  Stethoscope,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useConnectivity } from "@/hooks/use-connectivity";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMovimiento } from "@/hooks/use-movimiento";
import { useOfflineMutation } from "@/hooks/use-offline-mutation";
import { useSoloLectura } from "@/hooks/use-solo-lectura";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CONDITION_CATALOG,
  CONDITION_LABELS,
  FDI_LOWER_LEFT,
  FDI_LOWER_LEFT_PRIMARY,
  FDI_LOWER_RIGHT,
  FDI_LOWER_RIGHT_PRIMARY,
  FDI_UPPER_LEFT,
  FDI_UPPER_LEFT_PRIMARY,
  FDI_UPPER_RIGHT,
  FDI_UPPER_RIGHT_PRIMARY,
  MARK_STATUS_LABELS,
  SURFACE_LABELS,
  TOOTH_SURFACES,
  marksByTooth,
  separarObservaciones,
  toothCommonName,
  type MarkConservation,
  type MarkStatus,
  type OdontogramMark,
  type ToothCondition,
  type ToothState,
  type ToothSurface,
} from "@/lib/clinical/odontogram";
import {
  COLORES_SIMBOLOGIA,
  LEYENDA_SIMBOLOGIA,
  OPACIDAD_PLANIFICADO,
  aplicaConservacion,
  colorDeMarca,
  condicionesDisponibles,
  denticionPorEdad,
  hexDeMarca,
  marcaParaPintar,
  marcasQueReemplaza,
  type Denticion,
} from "@/lib/clinical/odontograma-reglas";
import {
  piezasDelSextante,
  resumenPorSextante,
  type Sextante,
} from "@/lib/clinical/odontograma-sextantes";
import {
  seleccionConClic,
  type MarcaDelLote,
  type Modificadores,
} from "@/lib/clinical/odontograma-seleccion";
import { hallazgosPorTratar, presupuestoPorPieza } from "@/lib/clinical/odontograma-presupuesto";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { mensajeDeError } from "@/lib/mensaje-error";
// Foco de teclado consistente con el patrón usado en app-shell.tsx
// (focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring).
const FOCUS_RING_CLASS =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
import {
  listOdontogramHistory,
  listOdontogramMarks,
  setOdontogramMark,
  setOdontogramMarks,
} from "@/lib/clinical/odontogram.functions";
import { piezasConHallazgos } from "@/components/odontograma-hallazgos";
import {
  SugerenciaPresupuesto,
  type MarcaSugerida,
} from "@/components/odontograma-sugerencia-presupuesto";
import { listProcedures, listQuotes } from "@/lib/finance/finance.functions";
import { debeSugerir, marcasYaPresupuestadas } from "@/lib/finance/sugerencia-presupuesto";
import { DienteAnatomico, type ModificadoresDeClic } from "@/components/diente-anatomico";
import { Muestra } from "@/components/odontograma-muestra";
import { describirMarca } from "@/lib/clinical/odontograma-texto";
import { ResumenSextantes } from "@/components/odontograma-sextantes";
import { EditorVariasPiezas } from "@/components/odontograma-varias";
import { ObservacionDePieza } from "@/components/odontograma-observacion";
import { VistaPresupuesto } from "@/components/odontograma-vista-presupuesto";
import { HallazgosPorTratar } from "@/components/odontograma-por-tratar";
import { cn } from "@/lib/utils";
import { useZonaClinica } from "@/hooks/use-zona-clinica";
import { fechaHora } from "@/lib/formato-fecha";

/** Colores del esquema de superficies (tokens con modo oscuro, ver styles.css). */
const ESQUEMA: Record<ReturnType<typeof colorDeMarca>, string> = {
  azul: "var(--odonto-azul)",
  rojo: "var(--odonto-rojo)",
  neutro: "var(--odonto-neutro)",
};

const TOOTH_SIZE = 40;
const TOOTH_GAP = 4;
// Target táctil mínimo WCAG 2.5.8 (24x24px) para la zona oclusal. El dibujo
// visual del cuadrado central sigue siendo `inner` (~11.2px) para no romper
// el layout del diagrama FDI; solo el área que capta el click/tap se agranda.
const OCLUSAL_HIT_MIN = 24;

type ToothClick = { tooth: number; surface: ToothSurface; mods?: Modificadores };

/** Ctrl/Cmd alterna la pieza en la selección múltiple; Shift suma un rango (ODO-05). */
function modificadores(e?: ModificadoresDeClic): Modificadores | undefined {
  if (!e) return undefined;
  const mods = { alternar: e.ctrlKey || e.metaKey, rango: e.shiftKey };
  return mods.alternar || mods.rango ? mods : undefined;
}

/** Condiciones de pieza que tapan el esquema de cinco superficies. */
const CUBREN_ESQUEMA: readonly ToothCondition[] = [
  "ausente",
  "implante",
  "corona",
  "protesis",
  "puente",
  "extraccion_indicada",
  "restos_radiculares",
];

/**
 * Pieza dental estilizada: cuadrado dividido en cuatro triángulos periféricos
 * (M/D/V/L) + un cuadrado central (O). El "whole" no tiene zona visible; la
 * elige el popover cuando la condición aplica a la pieza entera. Debajo del
 * número, las siglas de lo registrado en la pieza completa (TC, CO, IMP…):
 * una pieza puede tener varias a la vez (CLI-01).
 */
function ToothCell({
  tooth,
  marcas,
  inferior,
  seleccionado,
  conObservacion = false,
  onClick,
  pop = false,
}: {
  tooth: number;
  marcas: ToothState;
  /** La pieza tiene una observación vigente (ODO-08): se avisa con "OBS". */
  conObservacion?: boolean;
  /** Arcada inferior: el dibujo va debajo del esquema, espejado. */
  inferior: boolean;
  seleccionado: boolean;
  onClick: (click: ToothClick) => void;
  /** Recién marcada: un "pop" corto (solo si el movimiento está permitido). */
  pop?: boolean;
}) {
  const s = TOOTH_SIZE;
  const c = s / 2;
  const inner = s * 0.28;
  const deLaPieza = marcas.filter((m) => m.surface === "whole" && m.condition !== "sano");
  const cubre = marcaParaPintar(
    deLaPieza.filter((m) => m.status === "existente" && CUBREN_ESQUEMA.includes(m.condition)),
  );
  // El esquema se pinta sobre la tarjeta (no sobre el marfil del diente):
  // usa los tokens --odonto-*, que en oscuro pasan a tonos legibles sobre tinta.
  const wholeColor = cubre ? ESQUEMA[colorDeMarca(cubre)] : null;

  // Activa la misma acción que el click: usada tanto por onClick (mouse/touch)
  // como por onKeyDown (Enter/Space) de cada superficie enfocable.
  function activate(click: ToothClick, e?: ModificadoresDeClic) {
    onClick({ ...click, mods: modificadores(e) });
  }

  function handleKeyDown(e: KeyboardEvent<SVGElement>, click: ToothClick) {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      e.stopPropagation();
      activate(click, e);
    }
  }

  const nombreComun = toothCommonName(tooth);
  const piezaLabel =
    (nombreComun ? `Diente ${tooth} (${nombreComun})` : `Diente ${tooth}`) +
    (seleccionado ? ", seleccionado" : "") +
    (conObservacion ? ", con observación" : "");

  function enSuperficie(surface: ToothSurface) {
    return marcas.filter((m) => m.surface === surface);
  }

  function surfaceLabel(surface: Exclude<ToothSurface, "whole">) {
    const lista = enSuperficie(surface).filter((m) => m.condition !== "sano");
    const texto = lista.length ? lista.map(describirMarca).join(", ") : CONDITION_LABELS.sano;
    return `${piezaLabel}, superficie ${SURFACE_LABELS[surface]}, ${texto}`;
  }

  const wholeLabel = deLaPieza.length
    ? `${piezaLabel}, pieza completa: ${deLaPieza.map(describirMarca).join(", ")}`
    : `${piezaLabel}, marcar condición de la pieza completa`;

  function pinturaDe(surface: ToothSurface): { fill: string; opacity: number } {
    const m = marcaParaPintar(enSuperficie(surface));
    if (!m) return { fill: ESQUEMA.neutro, opacity: 1 };
    return {
      fill: ESQUEMA[colorDeMarca(m)],
      opacity: m.status === "planificado" ? OPACIDAD_PLANIFICADO : 1,
    };
  }

  const zones: {
    surface: ToothSurface;
    points: string;
  }[] = [
    {
      surface: "vestibular",
      points: `0,0 ${s},0 ${c + inner / 2},${c - inner / 2} ${c - inner / 2},${c - inner / 2}`,
    },
    {
      surface: "distal",
      points: `${s},0 ${s},${s} ${c + inner / 2},${c + inner / 2} ${c + inner / 2},${c - inner / 2}`,
    },
    {
      surface: "lingual",
      points: `0,${s} ${s},${s} ${c + inner / 2},${c + inner / 2} ${c - inner / 2},${c + inner / 2}`,
    },
    {
      surface: "mesial",
      points: `0,0 0,${s} ${c - inner / 2},${c + inner / 2} ${c - inner / 2},${c - inner / 2}`,
    },
  ];

  const oclusal = pinturaDe("oclusal");
  // Clampeado a `s` (40px) para no salirse del viewBox del diente.
  const oclusalHitSize = Math.min(OCLUSAL_HIT_MIN, s);

  const siglas = deLaPieza
    .filter((m) => CONDITION_CATALOG[m.condition].sigla)
    .map((m) => ({ id: m.id, sigla: CONDITION_CATALOG[m.condition].sigla, marca: m }));

  const numero = (
    <span className="flex flex-col items-center">
      <span
        className={cn(
          "cifra text-[11px] text-muted-foreground",
          seleccionado && "font-semibold text-brand-700",
        )}
        title={nombreComun ? `${tooth} · ${nombreComun}` : undefined}
      >
        {tooth}
      </span>
      {/* Alto fijo: con o sin siglas, las filas de piezas quedan alineadas. */}
      <span
        aria-hidden
        className="flex h-3 max-w-10 items-center gap-0.5 overflow-hidden text-[8px] font-semibold leading-none"
        title={deLaPieza.map(describirMarca).join(", ") || undefined}
      >
        {siglas.map(({ id, sigla, marca }) => (
          <span
            key={id}
            style={{
              color: hexDeMarca(marca),
              opacity: marca.status === "planificado" ? 0.7 : 1,
            }}
            className={cn(marca.status === "planificado" && "underline decoration-dotted")}
          >
            {sigla}
          </span>
        ))}
        {conObservacion && (
          <span className="text-muted-foreground">{CONDITION_CATALOG.observacion.sigla}</span>
        )}
      </span>
    </span>
  );
  const dibujo = (
    <DienteAnatomico
      tooth={tooth}
      marcas={marcas}
      inferior={inferior}
      seleccionado={seleccionado}
      onClick={(surface, e) => activate({ tooth, surface }, e)}
    />
  );

  return (
    <div
      className={cn(
        "flex items-center gap-1",
        inferior ? "flex-col-reverse" : "flex-col",
        pop && "animate-in zoom-in-90 duration-300 ease-out",
      )}
    >
      {numero}
      {dibujo}
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        className="cursor-pointer overflow-visible rounded-sm border border-hairline transition-colors hover:border-brand"
        role="group"
        aria-label={piezaLabel}
      >
        {wholeColor && (
          <rect
            x={0}
            y={0}
            width={s}
            height={s}
            style={{ fill: wholeColor }}
            opacity={0.85}
            tabIndex={0}
            role="button"
            aria-label={wholeLabel}
            className={FOCUS_RING_CLASS}
            onClick={(e) => activate({ tooth, surface: "whole" }, e)}
            onKeyDown={(e) => handleKeyDown(e, { tooth, surface: "whole" })}
          />
        )}
        {!wholeColor &&
          zones.map((z) => {
            const p = pinturaDe(z.surface);
            return (
              <polygon
                key={z.surface}
                points={z.points}
                style={{ fill: p.fill, stroke: "var(--odonto-trazo)" }}
                fillOpacity={p.opacity}
                strokeWidth={0.5}
                tabIndex={0}
                role="button"
                aria-label={surfaceLabel(z.surface as Exclude<ToothSurface, "whole">)}
                className={FOCUS_RING_CLASS}
                onClick={(e) => {
                  e.stopPropagation();
                  activate({ tooth, surface: z.surface }, e);
                }}
                onKeyDown={(e) => handleKeyDown(e, { tooth, surface: z.surface })}
              />
            );
          })}
        {!wholeColor && (
          <rect
            x={c - inner / 2}
            y={c - inner / 2}
            width={inner}
            height={inner}
            style={{ fill: oclusal.fill, stroke: "var(--odonto-trazo)" }}
            fillOpacity={oclusal.opacity}
            strokeWidth={0.5}
            pointerEvents="none"
          />
        )}
        {/* Hit-area invisible de la zona oclusal, agrandada a 24x24px mínimo
            (WCAG 2.5.8) por encima del cuadrado visual sin modificarlo. Es el
            elemento enfocable real de la superficie oclusal (el cuadrado
            visual de arriba es puramente decorativo, pointerEvents none). */}
        {!wholeColor && (
          <rect
            x={c - oclusalHitSize / 2}
            y={c - oclusalHitSize / 2}
            width={oclusalHitSize}
            height={oclusalHitSize}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={surfaceLabel("oclusal")}
            className={FOCUS_RING_CLASS}
            onClick={(e) => {
              e.stopPropagation();
              activate({ tooth, surface: "oclusal" }, e);
            }}
            onKeyDown={(e) => handleKeyDown(e, { tooth, surface: "oclusal" })}
          />
        )}
        {/* Zona invisible para marcar "whole" cuando aún no hay override — click en borde superior.
            También el punto de entrada por teclado a "pieza completa": el foco visible puede
            recortarse por overflow del layout de la fila (overflow-x: auto en el contenedor
            padre), es una limitación conocida documentada en el reporte de esta tarea. */}
        {!wholeColor && (
          <rect
            x={0}
            y={-6}
            width={s}
            height={6}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={wholeLabel}
            className={FOCUS_RING_CLASS}
            onClick={(e) => activate({ tooth, surface: "whole" }, e)}
            onKeyDown={(e) => handleKeyDown(e, { tooth, surface: "whole" })}
          />
        )}
      </svg>
    </div>
  );
}

/**
 * Equivalente textual/tabular del diagrama FDI (WCAG 1.3.1/2.4.6 — el
 * gráfico no tenía ninguna alternativa de resumen: la única forma de saber
 * qué piezas tienen algo marcado era pasar foco por las 160 celdas
 * individuales del SVG, una por una). Una fila por pieza CON al menos una
 * marca distinta de "sano"; las piezas sanas no suman filas — sería puro
 * ruido para escanear.
 */
function ordenSuperficie(surface: ToothSurface): number {
  return surface === "whole" ? -1 : TOOTH_SURFACES.indexOf(surface);
}

function TablaOdontograma({
  teeth,
  byTooth,
  observaciones,
}: {
  teeth: readonly number[];
  byTooth: Map<number, ToothState>;
  observaciones: Map<number, OdontogramMark>;
}) {
  const filas = teeth
    .map((tooth) => {
      const marcas = (byTooth.get(tooth) ?? [])
        .filter((m) => m.condition !== "sano")
        // La pieza completa primero, después las superficies en orden M-D-O-V-L.
        .sort((x, y) => ordenSuperficie(x.surface) - ordenSuperficie(y.surface));
      return { tooth, marcas, observacion: observaciones.get(tooth) ?? null };
    })
    .filter((f) => f.marcas.length > 0 || f.observacion);

  if (filas.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Sin condiciones registradas todavía — todas las piezas figuran sanas.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">
          Piezas con al menos una condición distinta de sano, con su superficie, diagnóstico y
          estado
        </caption>
        <thead>
          <tr className="border-b border-hairline text-[11px] text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-semibold">
              Pieza
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              Nombre común
            </th>
            <th scope="col" className="py-2 font-semibold">
              Condiciones
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {filas.map(({ tooth, marcas, observacion }) => (
            <tr key={tooth}>
              <th scope="row" className="py-2 pr-3 cifra font-medium">
                {tooth}
              </th>
              <td className="py-2 pr-3 text-muted-foreground">{toothCommonName(tooth) ?? "—"}</td>
              <td className="py-2">
                <ul className="flex flex-wrap gap-x-3 gap-y-1">
                  {marcas.map((m) => (
                    <li key={m.id} className="inline-flex items-center gap-1">
                      <Muestra marca={m} className="size-2.5" />
                      <span className="text-muted-foreground">
                        {SURFACE_LABELS[m.surface]}:
                      </span>{" "}
                      <span className="font-medium">{describirMarca(m)}</span>
                      {m.notes && <span className="text-muted-foreground">({m.notes})</span>}
                    </li>
                  ))}
                  {observacion && (
                    <li className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground">Observación:</span>{" "}
                      <span>{observacion.notes}</span>
                    </li>
                  )}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ToothRow({
  teeth,
  byTooth,
  inferior = false,
  seleccionadas,
  observaciones,
  onClick,
  animar = false,
  entrada = false,
  recienMarcada = null,
}: {
  teeth: readonly number[];
  byTooth: Map<number, ToothState>;
  inferior?: boolean;
  /** Pieza abierta o piezas de la selección múltiple. */
  seleccionadas: ReadonlySet<number>;
  observaciones: ReadonlyMap<number, unknown>;
  onClick: (click: ToothClick) => void;
  /** Movimiento permitido (reduced-motion y "Pausar movimiento"). */
  animar?: boolean;
  /** Entrada de la arcada (al abrir o cambiar de dentición). */
  entrada?: boolean;
  /** Pieza que se acaba de marcar; `nonce` reinicia el "pop" si se repite. */
  recienMarcada?: { tooth: number; nonce: number } | null;
}) {
  return (
    <div
      className={cn(
        "flex items-stretch",
        animar &&
          entrada &&
          cn(
            "animate-in fade-in-50 duration-500 ease-out",
            inferior ? "slide-in-from-bottom-2" : "slide-in-from-top-2",
          ),
      )}
      style={{ gap: TOOTH_GAP }}
    >
      {teeth.map((t, i) => (
        <Fragment key={t}>
          <ToothCell
            // La clave cambia con el nonce para que el "pop" vuelva a correr.
            key={recienMarcada?.tooth === t ? `${t}-${recienMarcada.nonce}` : t}
            tooth={t}
            marcas={byTooth.get(t) ?? []}
            inferior={inferior}
            seleccionado={seleccionadas.has(t)}
            conObservacion={observaciones.has(t)}
            onClick={onClick}
            pop={animar && recienMarcada?.tooth === t}
          />
          {i === teeth.length / 2 - 1 && <div className="mx-1 w-px self-stretch bg-border" />}
        </Fragment>
      ))}
    </div>
  );
}

const PERMANENTE_SUPERIOR = [...FDI_UPPER_RIGHT, ...FDI_UPPER_LEFT];
const PERMANENTE_INFERIOR = [...FDI_LOWER_RIGHT, ...FDI_LOWER_LEFT];
const TEMPORAL_SUPERIOR = [...FDI_UPPER_RIGHT_PRIMARY, ...FDI_UPPER_LEFT_PRIMARY];
const TEMPORAL_INFERIOR = [...FDI_LOWER_RIGHT_PRIMARY, ...FDI_LOWER_LEFT_PRIMARY];

/**
 * Filas del diagrama por dentición, de arriba hacia abajo. La mixta (6-12
 * años, CLI-04) muestra las 52 piezas: permanentes afuera y temporales
 * adentro, como el odontograma impreso de la región.
 */
const FILAS_POR_DENTICION: Record<Denticion, { teeth: readonly number[]; inferior: boolean }[]> = {
  permanente: [
    { teeth: PERMANENTE_SUPERIOR, inferior: false },
    { teeth: PERMANENTE_INFERIOR, inferior: true },
  ],
  temporal: [
    { teeth: TEMPORAL_SUPERIOR, inferior: false },
    { teeth: TEMPORAL_INFERIOR, inferior: true },
  ],
  mixta: [
    { teeth: PERMANENTE_SUPERIOR, inferior: false },
    { teeth: TEMPORAL_SUPERIOR, inferior: false },
    { teeth: TEMPORAL_INFERIOR, inferior: true },
    { teeth: PERMANENTE_INFERIOR, inferior: true },
  ],
};

const AYUDA_POR_DENTICION: Record<Denticion, string> = {
  permanente: "Arriba: piezas 18→11 · 21→28. Abajo: 48→41 · 31→38.",
  temporal: "Arriba: piezas 55→51 · 61→65. Abajo: 85→81 · 71→75 (cuadrantes 5-8, notación FDI).",
  mixta: "Permanentes afuera (18→28, 48→38) y temporales adentro (55→65, 85→75).",
};

interface Props {
  clinicId: string;
  patientId: string;
  puedeEditar: boolean;
  userId: string;
  /**
   * Manda la pieza seleccionada al presupuesto (G-1). Cuando está presente, el
   * popover ofrece "Presupuestar" además de las condiciones clínicas — es el
   * puente entre registrar qué le pasa a un diente y cobrarlo, que hasta ahora
   * eran dos pantallas sin conexión pese a que `quote_items` ya guardaba pieza
   * y superficie.
   */
  onPresupuestarPieza?: (pieza: { tooth: number; surface: ToothSurface }) => void;
  /**
   * Sugerencia "por realizar → presupuesto" (PR 11 del rediseño A+). El
   * padre la pasa solo con permiso de facturar; sin ella el odontograma no
   * sugiere nada (queda el botón "Presupuestar" de G-1).
   */
  sugerenciaPresupuesto?: { currency: string; onVerPresupuesto?: () => void };
  /** Edad del paciente: elige la dentición con la que abre (CLI-04). `null` = desconocida. */
  edad?: number | null;
}

export function Odontogram({
  clinicId,
  patientId,
  puedeEditar,
  userId,
  onPresupuestarPieza,
  sugerenciaPresupuesto,
  edad = null,
}: Props) {
  const queryClient = useQueryClient();
  const { animar } = useMovimiento();
  // Las arcadas entran al abrir el odontograma o al cambiar de dentición. Si
  // la ficha llegó renderizada del servidor, en la hidratación `animar` es
  // false y la entrada se salta: el diagrama ya estaba a la vista y animarlo
  // después sería un salto.
  const [entrada, setEntrada] = useState(animar);
  const soloLectura = useSoloLectura();
  const zona = useZonaClinica();
  const fetchQuotes = useServerFn(listQuotes);
  const fetchProcedures = useServerFn(listProcedures);
  const fetchMarks = useServerFn(listOdontogramMarks);
  const fetchHistory = useServerFn(listOdontogramHistory);
  const saveFn = useServerFn(setOdontogramMark);
  const saveLoteFn = useServerFn(setOdontogramMarks);
  const { online } = useConnectivity();

  const [selection, setSelection] = useState<ToothClick | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [denticion, setDenticion] = useState<Denticion>(() => denticionPorEdad(edad));
  const [vista, setVista] = useState<"grafico" | "tabla">("grafico");
  // ODO-06: modo del odontograma. "presupuesto" muestra lo presupuestado sobre las piezas.
  const [modo, setModo] = useState<"clinico" | "presupuesto">("clinico");
  // ODO-05: selección múltiple. `modoVarias` es el interruptor táctil
  // ("Seleccionar varias"); con mouse alcanza Ctrl/Cmd o Shift + clic.
  const [varias, setVarias] = useState<Set<number>>(() => new Set());
  const [modoVarias, setModoVarias] = useState(false);
  const [ancla, setAncla] = useState<number | null>(null);
  // Opciones del popover: se conservan entre piezas para registrar varias
  // seguidas con el mismo criterio (ej. un plan entero "por realizar").
  const [estado, setEstado] = useState<MarkStatus>("existente");
  const [conservacion, setConservacion] = useState<MarkConservation>("bueno");
  const [nota, setNota] = useState("");
  // Sugerencia en curso (PR 11) y la pieza que se acaba de marcar (pop).
  const [sugerencia, setSugerencia] = useState<MarcaSugerida | null>(null);
  const [recienMarcada, setRecienMarcada] = useState<{ tooth: number; nonce: number } | null>(null);
  // La marca que se está guardando, si corresponde sugerirla. Se confirma en
  // `onExito` con el id que devuelve el servidor: una marca que quedó en la
  // cola offline o en Conflictos no existe todavía y no se puede presupuestar.
  const candidato = useRef<MarcaSugerida | null>(null);

  const marksKey = ["odontogram-marks", clinicId, patientId];
  const historyKey = ["odontogram-history", clinicId, patientId];

  const { data: marks = [], isLoading } = useQuery({
    queryKey: marksKey,
    queryFn: () => fetchMarks({ data: { clinicId, patientId } }),
  });

  const { data: history = [] } = useQuery({
    queryKey: historyKey,
    enabled: showHistory,
    queryFn: () => fetchHistory({ data: { clinicId, patientId } }),
  });

  // ODO-08: las observaciones viajan como marcas, pero el dibujo, la tabla y
  // los resúmenes trabajan solo con las condiciones clínicas.
  const { clinicas, observaciones } = useMemo(() => separarObservaciones(marks), [marks]);
  const byTooth = useMemo(() => marksByTooth(clinicas), [clinicas]);
  const piezas = useMemo(() => piezasConHallazgos(clinicas), [clinicas]);
  const filas = FILAS_POR_DENTICION[denticion];
  const visibles = useMemo(() => filas.flatMap((f) => f.teeth), [filas]);
  const sextantes = useMemo(() => resumenPorSextante(clinicas, visibles), [clinicas, visibles]);
  // A+: con espacio, la pieza elegida se trabaja en un panel al costado (como
  // en el prototipo) en vez de un popover. Con menos ancho, el popover de siempre.
  const panelLateral = useMediaQuery("(min-width: 1400px)");

  // Mismas claves que la pestaña de Finanzas: comparten la caché.
  const conSugerencia = Boolean(sugerenciaPresupuesto);
  const { data: quotes = [] } = useQuery({
    queryKey: ["quotes", clinicId, patientId],
    queryFn: () => fetchQuotes({ data: { clinicId, patientId } }),
    enabled: conSugerencia,
  });
  const { data: procedures = [] } = useQuery({
    queryKey: ["procedures", clinicId],
    queryFn: () => fetchProcedures({ data: { clinicId } }),
    enabled: conSugerencia,
  });
  const yaPresupuestadas = useMemo(() => marcasYaPresupuestadas(quotes), [quotes]);
  // ODO-06/07: lo presupuestado por pieza y lo que falta presupuestar.
  const presupuesto = useMemo(() => presupuestoPorPieza(quotes, hoyISO(zona)), [quotes, zona]);
  const porTratar = useMemo(
    () => (conSugerencia ? hallazgosPorTratar(clinicas, presupuesto) : []),
    [conSugerencia, clinicas, presupuesto],
  );
  const piezasPorTratar = useMemo(
    () => new Set(porTratar.map((h) => h.marca.toothNumber)),
    [porTratar],
  );

  const save = useOfflineMutation<Record<string, unknown>>({
    kind: "marcar-odontograma",
    userId,
    ejecutar: (payload) => saveFn({ data: payload as never }),
    invalidar: [marksKey, historyKey],
    resumen: (payload) => {
      const p = payload as {
        toothNumber: number;
        surface: ToothSurface;
        condition: ToothCondition;
        status?: MarkStatus;
        conservation?: MarkConservation | null;
      };
      return `Pieza ${p.toothNumber} · ${SURFACE_LABELS[p.surface]} · ${describirMarca({
        condition: p.condition,
        status: p.status ?? "existente",
        conservation: p.conservation ?? null,
      })}`;
    },
    // Dos capturas offline se funden en una sola solo si la segunda habría
    // reemplazado a la primera: misma zona, mismo grupo y mismo estado. Una
    // endodoncia y una corona de la misma pieza viajan las dos (CLI-01).
    identidad: (payload) => {
      const p = payload as {
        toothNumber: number;
        surface: ToothSurface;
        condition: ToothCondition;
        status?: MarkStatus;
      };
      const grupo = CONDITION_CATALOG[p.condition]?.grupo ?? p.condition;
      return `${patientId}:${p.toothNumber}:${p.surface}:${grupo}:${p.status ?? "existente"}`;
    },
    esConflicto: (r) =>
      Boolean(r && typeof r === "object" && (r as { conflict?: boolean }).conflict),
    onExito: (resultado) => {
      const guardada = (resultado as { id?: string } | null)?.id;
      const sugerir = candidato.current;
      candidato.current = null;
      setNota("");
      toast.success("Marca guardada");
      if (sugerir && guardada === sugerir.id) {
        setRecienMarcada({ tooth: sugerir.tooth, nonce: Date.now() });
        // El popover queda abierto con la sugerencia en lugar del editor.
        setSugerencia(sugerir);
        return;
      }
      if (selection) setRecienMarcada({ tooth: selection.tooth, nonce: Date.now() });
      setSelection(null);
    },
  });

  // ODO-08: la observación usa la misma escritura (y la misma cola offline)
  // que una marca: condición "observacion" en la pieza completa.
  const guardarObservacion = useOfflineMutation<Record<string, unknown>>({
    kind: "marcar-odontograma",
    userId,
    ejecutar: (payload) => saveFn({ data: payload as never }),
    invalidar: [marksKey, historyKey],
    resumen: (payload) => `Pieza ${(payload as { toothNumber: number }).toothNumber} · Observación`,
    identidad: (payload) =>
      `${patientId}:${(payload as { toothNumber: number }).toothNumber}:whole:observacion:existente`,
    esConflicto: (r) =>
      Boolean(r && typeof r === "object" && (r as { conflict?: boolean }).conflict),
    onExito: () => toast.success("Observación guardada"),
  });

  function guardarObs(tooth: number, texto: string | null) {
    const nueva = {
      id: crypto.randomUUID(),
      toothNumber: tooth,
      surface: "whole" as const,
      condition: "observacion" as const,
      status: "existente" as const,
    };
    guardarObservacion.mutar({
      ...nueva,
      clinicId,
      patientId,
      conservation: null,
      notes: texto ?? undefined,
      baseMarkIds: marcasQueReemplaza(
        marks.filter((m) => m.toothNumber === tooth),
        nueva,
      ),
    });
  }

  // ODO-05: varias piezas en una sola escritura (todas o ninguna).
  const lote = useMutation({
    mutationFn: (marcas: MarcaDelLote[]) => saveLoteFn({ data: { clinicId, patientId, marcas } }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: marksKey });
      void queryClient.invalidateQueries({ queryKey: historyKey });
      if (r.conflict) {
        toast.error(
          `La pieza ${r.piezas.join(", ")} cambió mientras tanto. Revisa el odontograma y vuelve a confirmar.`,
        );
        return;
      }
      toast.success(
        r.ids.length === 1 ? "Registrado en 1 pieza" : `Registrado en ${r.ids.length} piezas`,
      );
    },
    onError: (e: Error) => toast.error(mensajeDeError(e, "No pudimos guardar las marcas.")),
  });

  function marcar(condition: ToothCondition) {
    if (!selection) return;
    const nueva = {
      id: crypto.randomUUID(),
      toothNumber: selection.tooth,
      surface: selection.surface,
      condition,
      status: estado,
      conservation: aplicaConservacion(condition, estado) ? conservacion : null,
    };
    const vigentes = byTooth.get(selection.tooth) ?? [];
    // Lo que esta marca va a cerrar según lo que se ve en pantalla; el
    // servidor lo recalcula y, si no coincide, lo manda a Conflictos.
    const baseMarkIds = marcasQueReemplaza(vigentes, nueva);
    const sugerir =
      conSugerencia &&
      debeSugerir({
        puedeFacturar: true,
        soloLectura,
        marca: { id: nueva.id, condition, status: estado },
        yaPresupuestadas,
        reemplaza: vigentes.filter((m) => baseMarkIds.includes(m.id)),
      });
    candidato.current = sugerir
      ? { id: nueva.id, tooth: selection.tooth, surface: selection.surface, condition }
      : null;
    save.mutar({
      ...nueva,
      clinicId,
      patientId,
      notes: nota.trim() || undefined,
      baseMarkIds,
    });
  }

  function cerrarPopover() {
    setSelection(null);
    setSugerencia(null);
  }

  function elegirPieza(click: ToothClick) {
    setSugerencia(null);
    if (modoVarias || click.mods) {
      // Con Ctrl/Cmd o Shift sobre una pieza ya abierta, la abierta entra a la selección.
      const base = varias.size === 0 && selection ? new Set([selection.tooth]) : varias;
      const ancloDe = ancla ?? selection?.tooth ?? null;
      setVarias(
        seleccionConClic({
          seleccion: base,
          tooth: click.tooth,
          mods: click.mods ?? { alternar: true },
          ancla: ancloDe,
          filas: filas.map((f) => f.teeth),
        }),
      );
      setAncla(click.tooth);
      setSelection(null);
      return;
    }
    setVarias(new Set());
    setAncla(click.tooth);
    setSelection(click);
  }

  function terminarVarias() {
    setVarias(new Set());
    setModoVarias(false);
  }

  function elegirSextante(sextante: Sextante) {
    setSelection(null);
    setSugerencia(null);
    setModoVarias(true);
    setVarias(new Set(piezasDelSextante(sextante, visibles)));
  }

  // ODO-07: "Sumar al presupuesto" abre la sugerencia del PR 11 sobre esa marca.
  function sugerirDesdeLista(m: OdontogramMark) {
    terminarVarias();
    setSelection({ tooth: m.toothNumber, surface: m.surface });
    setSugerencia({ id: m.id, tooth: m.toothNumber, surface: m.surface, condition: m.condition });
  }

  const enVarias = modoVarias || varias.size > 0;
  const seleccionadas = useMemo(
    () => (enVarias ? varias : new Set(selection ? [selection.tooth] : [])),
    [enVarias, varias, selection],
  );
  const bloqueoLote = soloLectura
    ? "Modo solo lectura: no se pueden registrar marcas."
    : !online
      ? "Sin conexión: marcar varias piezas a la vez necesita internet. Puedes marcarlas una por una."
      : null;

  const editorVarias = (
    <EditorVariasPiezas
      piezas={[...varias]}
      vigentesPorPieza={byTooth}
      puedeEditar={puedeEditar}
      enCurso={lote.isPending}
      bloqueo={bloqueoLote}
      onQuitar={(t) => {
        const nueva = new Set(varias);
        nueva.delete(t);
        setVarias(nueva);
      }}
      onLimpiar={terminarVarias}
      onAplicar={(m) => lote.mutate(m)}
    />
  );

  const availableConditions = selection ? condicionesDisponibles(selection.surface, estado) : [];
  const marcasDeLaZona = selection
    ? (byTooth.get(selection.tooth) ?? []).filter(
        (m) =>
          m.condition !== "sano" &&
          (selection.surface === "whole" ||
            m.surface === selection.surface ||
            m.surface === "whole"),
      )
    : [];

  const cuerpoSeleccion = selection ? (
    <>
      {sugerencia && sugerenciaPresupuesto ? (
        <SugerenciaPresupuesto
          clinicId={clinicId}
          patientId={patientId}
          currency={sugerenciaPresupuesto.currency}
          marca={sugerencia}
          quotes={quotes}
          procedures={procedures}
          animar={animar}
          onCerrar={cerrarPopover}
          onVerPresupuesto={
            sugerenciaPresupuesto.onVerPresupuesto
              ? () => {
                  cerrarPopover();
                  sugerenciaPresupuesto.onVerPresupuesto?.();
                }
              : undefined
          }
        />
      ) : (
        <>
          {onPresupuestarPieza && (
            <button
              onClick={() => {
                onPresupuestarPieza({ tooth: selection.tooth, surface: selection.surface });
                setSelection(null);
              }}
              className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-brand bg-transparent px-2 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand/12"
            >
              <Receipt className="size-3.5" /> Presupuestar esta pieza
            </button>
          )}
          {marcasDeLaZona.length > 0 && (
            <ul className="mb-2 space-y-1 border-b border-hairline pb-2" aria-label="Vigente">
              {marcasDeLaZona.map((m) => (
                <li key={m.id} className="flex items-center gap-1.5 text-xs">
                  <Muestra marca={m} className="size-2.5" />
                  {m.surface !== selection.surface && (
                    <span className="text-muted-foreground">{SURFACE_LABELS[m.surface]}:</span>
                  )}
                  <span className="font-medium">{describirMarca(m)}</span>
                  {conSugerencia && yaPresupuestadas.has(m.id) && (
                    <span className="text-[11px] text-muted-foreground">· en presupuesto</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!puedeEditar ? (
            <p className="text-xs text-muted-foreground">
              Tu rol no puede modificar el odontograma.
            </p>
          ) : (
            <div className="space-y-2">
              <div
                className="flex rounded-lg border border-hairline p-0.5 text-xs"
                role="group"
                aria-label="Estado de la marca"
              >
                {(["existente", "planificado"] as const).map((e) => (
                  <button
                    key={e}
                    onClick={() => setEstado(e)}
                    aria-pressed={estado === e}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1 font-medium",
                      estado === e
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {MARK_STATUS_LABELS[e]}
                  </button>
                ))}
              </div>
              {estado === "existente" && (
                <div
                  className="flex items-center gap-1 text-[11px] text-muted-foreground"
                  role="group"
                  aria-label="Estado de conservación del tratamiento"
                >
                  <span>Tratamiento en</span>
                  {(["bueno", "malo"] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => setConservacion(c)}
                      aria-pressed={conservacion === c}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium",
                        conservacion === c
                          ? "border-foreground/30 bg-secondary text-foreground"
                          : "border-hairline hover:text-foreground",
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{
                          backgroundColor:
                            c === "bueno" ? COLORES_SIMBOLOGIA.azul : COLORES_SIMBOLOGIA.rojo,
                        }}
                      />
                      {c === "bueno" ? "buen estado" : "mal estado"}
                    </button>
                  ))}
                </div>
              )}
              <input
                type="text"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                maxLength={500}
                placeholder="Especificación (opcional): material, detalle…"
                aria-label="Especificación de la marca"
                className="w-full rounded-md border border-hairline bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground"
              />
              <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto">
                {availableConditions.map((cond) => {
                  const muestra = {
                    condition: cond,
                    status: estado,
                    conservation: aplicaConservacion(cond, estado) ? conservacion : null,
                  };
                  return (
                    <button
                      key={cond}
                      onClick={() => marcar(cond)}
                      disabled={save.enCurso}
                      className="flex items-center gap-1.5 rounded-md border border-hairline px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-secondary/60 disabled:opacity-50"
                    >
                      {cond === "sano" ? (
                        <span
                          aria-hidden
                          className="size-3 shrink-0 rounded-sm border border-hairline"
                          style={{ backgroundColor: COLORES_SIMBOLOGIA.neutro }}
                        />
                      ) : (
                        <Muestra marca={muestra} />
                      )}
                      {CONDITION_LABELS[cond]}
                    </button>
                  );
                })}
              </div>
              {estado === "planificado" && (
                <p className="text-[11px] text-muted-foreground">
                  Solo los tratamientos se pueden dejar por realizar. Cuando se hagan, márcalos como
                  existentes y lo planificado se cierra solo.
                </p>
              )}
              {save.enCurso && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Guardando…
                </span>
              )}
            </div>
          )}
          <ObservacionDePieza
            key={`${selection.tooth}-${observaciones.get(selection.tooth)?.id ?? "sin"}`}
            tooth={selection.tooth}
            actual={observaciones.get(selection.tooth) ?? null}
            puedeEditar={puedeEditar && !soloLectura}
            enCurso={guardarObservacion.enCurso}
            zona={zona}
            onGuardar={(texto) => guardarObs(selection.tooth, texto)}
          />
        </>
      )}
    </>
  ) : null;

  return (
    <section
      aria-labelledby="odontograma-titulo"
      className="rounded-panel border border-border bg-card px-5 pt-5 pb-4"
    >
      {/* Encabezado A+: título en Cormorant con la numeración en mono, la
          leyenda azul/rojo arriba y el porqué de la convención. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3
          id="odontograma-titulo"
          className="font-display text-[30px] leading-none font-medium tracking-[-0.01em]"
        >
          Odontograma
          <span className="cifra ml-2 align-middle text-[12.5px] font-normal tracking-normal text-muted-foreground">
            FDI · {denticion}
          </span>
        </h3>
        <ul
          className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs font-medium text-muted-foreground"
          aria-label="Leyenda del odontograma"
        >
          {LEYENDA_SIMBOLOGIA.map((l) => (
            <li key={l.clave} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-3 rounded-[3px] border border-hairline"
                style={{
                  backgroundColor: COLORES_SIMBOLOGIA[l.color],
                  opacity: l.planificado ? OPACIDAD_PLANIFICADO : 1,
                }}
              />
              {l.texto}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2.5 max-w-[80ch] text-[15px] leading-relaxed text-muted-foreground">
        <b className="font-semibold text-foreground">Por qué azul y rojo:</b> es la convención con
        la que se llena la ficha en papel. Esmalia la respeta para que nadie tenga que reaprender a
        leer una boca.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Toca una zona del diente o del esquema para marcar esa superficie; la raíz o el borde
        superior del esquema marcan la pieza entera.
      </p>
      <div className="mt-3 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-hairline p-0.5 text-xs">
            {(["permanente", "mixta", "temporal"] as const).map((d) => (
              <button
                key={d}
                onClick={() => {
                  setEntrada(true);
                  setDenticion(d);
                }}
                aria-pressed={denticion === d}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium",
                  denticion === d
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {d === "permanente" ? "Permanente" : d === "mixta" ? "Mixta" : "Temporal"}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-hairline p-0.5 text-xs">
            <button
              onClick={() => setVista("grafico")}
              aria-pressed={vista === "grafico"}
              title="Diagrama visual"
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium",
                vista === "grafico"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="size-3" /> Diagrama
            </button>
            <button
              onClick={() => setVista("tabla")}
              aria-pressed={vista === "tabla"}
              title="Lista de condiciones registradas — alternativa accesible al diagrama"
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium",
                vista === "tabla"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="size-3" /> Tabla
            </button>
          </div>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium hover:bg-secondary/60"
          >
            <History className="size-3" /> {showHistory ? "Ocultar historia" : "Ver historia"}
          </button>
          {puedeEditar && modo === "clinico" && vista === "grafico" && (
            <button
              type="button"
              onClick={() => {
                if (enVarias) terminarVarias();
                else {
                  setModoVarias(true);
                  setVarias(new Set(selection ? [selection.tooth] : []));
                  setSelection(null);
                  setSugerencia(null);
                }
              }}
              aria-pressed={enVarias}
              title="También con Ctrl o Cmd + clic (alternar) y Shift + clic (rango)"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium pointer-coarse:min-h-11",
                enVarias
                  ? "border-foreground bg-foreground text-background"
                  : "border-hairline hover:bg-secondary/60",
              )}
            >
              <ListChecks className="size-3" /> Seleccionar varias
            </button>
          )}
        </div>
        {conSugerencia && (
          <div
            className="flex rounded-lg border border-hairline p-0.5 text-xs"
            role="group"
            aria-label="Qué muestra el odontograma"
          >
            <button
              type="button"
              onClick={() => setModo("clinico")}
              aria-pressed={modo === "clinico"}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium pointer-coarse:min-h-11",
                modo === "clinico"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Stethoscope className="size-3" /> Clínico
            </button>
            <button
              type="button"
              onClick={() => {
                setModo("presupuesto");
                terminarVarias();
                cerrarPopover();
              }}
              aria-pressed={modo === "presupuesto"}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium pointer-coarse:min-h-11",
                modo === "presupuesto"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Receipt className="size-3" /> Presupuesto
            </button>
          </div>
        )}
      </div>

      <div
        className={cn(
          panelLateral &&
            modo === "clinico" &&
            "grid grid-cols-[minmax(0,1fr)_320px] items-start gap-[18px]",
        )}
      >
        <div className="min-w-0">
          {isLoading && <p className="text-xs text-muted-foreground">Cargando odontograma…</p>}

          {!isLoading && modo === "presupuesto" && sugerenciaPresupuesto && (
            <VistaPresupuesto
              filas={filas}
              presupuesto={presupuesto}
              porPresupuestar={piezasPorTratar}
              currency={sugerenciaPresupuesto.currency}
              onVerPresupuesto={sugerenciaPresupuesto.onVerPresupuesto}
            />
          )}

          {!isLoading && modo === "clinico" && vista === "tabla" && (
            <TablaOdontograma teeth={visibles} byTooth={byTooth} observaciones={observaciones} />
          )}

          {!isLoading && modo === "clinico" && vista === "grafico" && (
            <div className="space-y-4 overflow-x-auto">
              {/* `w-max mx-auto` y no `items-center` en el contenedor con scroll:
              centrar con flex deja lo que desborda por la izquierda fuera de
              alcance (en el celular no se podía llegar a las piezas 18 o 55). */}
              <div className="mx-auto flex w-max flex-col items-center gap-3">
                {filas.map((fila) => (
                  <ToothRow
                    // Con la dentición en la clave, cambiarla vuelve a entrar las arcadas.
                    key={`${denticion}-${fila.teeth[0]}`}
                    teeth={fila.teeth}
                    byTooth={byTooth}
                    inferior={fila.inferior}
                    seleccionadas={seleccionadas}
                    observaciones={observaciones}
                    onClick={elegirPieza}
                    animar={animar}
                    entrada={entrada}
                    recienMarcada={recienMarcada}
                  />
                ))}
              </div>

              <p className="flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
                <Info className="size-3" />
                {AYUDA_POR_DENTICION[denticion]} Pasa el mouse sobre el número, o abre una pieza,
                para ver su nombre común.
              </p>

              {/* La leyenda de colores (CLI-02) va arriba, junto al título. */}
              <p className="text-xs text-muted-foreground">
                Siglas bajo el número: lo registrado en la pieza completa (TC, CO, IMP…). OBS: la
                pieza tiene una observación.
              </p>
            </div>
          )}

          {/* Sin panel lateral, la selección múltiple se trabaja debajo del diagrama. */}
          {!isLoading && modo === "clinico" && enVarias && !panelLateral && (
            <div className="mt-4 rounded-xl border border-border bg-background p-4">
              {editorVarias}
            </div>
          )}

          {!isLoading && modo === "clinico" && (
            <ResumenSextantes
              resumen={sextantes}
              visibles={visibles}
              seleccionables={puedeEditar && vista === "grafico"}
              onElegir={elegirSextante}
            />
          )}

          {!isLoading && conSugerencia && (
            <HallazgosPorTratar
              hallazgos={porTratar}
              puedePresupuestar={Boolean(onPresupuestarPieza) && !soloLectura}
              onSugerir={sugerirDesdeLista}
              onPresupuestar={(m) =>
                onPresupuestarPieza?.({ tooth: m.toothNumber, surface: m.surface })
              }
            />
          )}

          {selection && !panelLateral && modo === "clinico" && (
            <Popover open onOpenChange={(o) => !o && cerrarPopover()}>
              <PopoverTrigger asChild>
                <span className="sr-only">Selección abierta</span>
              </PopoverTrigger>
              <PopoverContent className={cn(sugerencia ? "w-80" : "w-72")} side="top">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Pieza {selection.tooth}</p>
                    <p className="text-xs text-muted-foreground">
                      {toothCommonName(selection.tooth)
                        ? `${toothCommonName(selection.tooth)} · `
                        : ""}
                      {SURFACE_LABELS[selection.surface]}
                    </p>
                  </div>
                  <button
                    onClick={cerrarPopover}
                    aria-label="Cerrar"
                    className="rounded p-1 text-muted-foreground hover:bg-secondary"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                {cuerpoSeleccion}
              </PopoverContent>
            </Popover>
          )}

          {showHistory && (
            <div className="mt-6 space-y-1.5 border-t border-hairline pt-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <RotateCcw className="size-3" /> Historia de marcas
              </p>
              {history.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Sin cambios registrados aún. Cuando una marca reemplaza a otra, la anterior queda
                  archivada acá.
                </p>
              )}
              {history.map((h) => (
                <div
                  key={h.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border border-hairline px-3 py-2 text-xs",
                    h.supersededAt && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Muestra marca={h} />
                    <span className="cifra">{h.toothNumber}</span>
                    {toothCommonName(h.toothNumber) && (
                      <span className="text-muted-foreground">
                        {toothCommonName(h.toothNumber)}
                      </span>
                    )}
                    <span className="text-muted-foreground">{SURFACE_LABELS[h.surface]}</span>
                    <span className="font-medium">{describirMarca(h)}</span>
                    {h.condition === "observacion" && (
                      <span className="text-muted-foreground">
                        {h.notes ? `«${h.notes}»` : "(quitada)"}
                      </span>
                    )}
                    {h.supersededAt && (
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        · archivada
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground">
                    {h.recordedByName ?? "—"} · {fechaHora(h.recordedAt, zona)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {panelLateral && modo === "clinico" && (
          <aside
            aria-label={enVarias ? "Piezas seleccionadas" : "Pieza seleccionada"}
            className="sticky top-32 rounded-xl border border-border bg-background p-4"
          >
            {enVarias ? (
              editorVarias
            ) : selection ? (
              <>
                <div className="flex items-start justify-between gap-2" aria-live="polite">
                  <div className="min-w-0">
                    <p className="font-display text-[56px] leading-[0.9] font-medium text-brand-600">
                      {selection.tooth}
                    </p>
                    <p className="mt-1.5 text-[15px] font-semibold">
                      {toothCommonName(selection.tooth) ?? `Pieza ${selection.tooth}`}
                    </p>
                    <p className="cifra mt-1 text-xs text-muted-foreground">
                      {SURFACE_LABELS[selection.surface]}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={cerrarPopover}
                    aria-label="Cerrar la pieza"
                    className={cn(
                      "grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary",
                      FOCUS_RING_CLASS,
                    )}
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="mt-3 border-t border-border pt-3">{cuerpoSeleccion}</div>
              </>
            ) : (
              <>
                <p className="font-display text-2xl leading-tight font-medium">Elige una pieza</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Toca un diente o una zona del esquema para ver sus condiciones y agregar otra.
                </p>
                {piezas.length > 0 && (
                  <ul
                    className="mt-3 grid gap-1.5 border-t border-border pt-3"
                    aria-label="Piezas con hallazgos"
                  >
                    {piezas.map((p) => (
                      <li
                        key={p.tooth}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                      >
                        <span className="cifra w-7 font-semibold text-brand-700">{p.tooth}</span>
                        {p.condiciones.map((c) => (
                          <span
                            key={`${c.condition}-${c.status}`}
                            className="inline-flex items-center gap-1 text-muted-foreground"
                          >
                            <Muestra marca={c} className="size-2 rounded-full border-0" />
                            {describirMarca(c)}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
