import { Fragment, useMemo, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  History,
  Info,
  List,
  LayoutGrid,
  Loader2,
  Receipt,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useOfflineMutation } from "@/hooks/use-offline-mutation";
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
  MARK_CONSERVATION_LABELS,
  MARK_STATUS_LABELS,
  SURFACE_LABELS,
  TOOTH_SURFACES,
  marksByTooth,
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
  condicionesDisponibles,
  denticionPorEdad,
  hexDeMarca,
  marcaParaPintar,
  marcasQueReemplaza,
  type Denticion,
} from "@/lib/clinical/odontograma-reglas";
// Foco de teclado consistente con el patrón usado en app-shell.tsx
// (focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring).
const FOCUS_RING_CLASS =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
import {
  listOdontogramHistory,
  listOdontogramMarks,
  setOdontogramMark,
} from "@/lib/clinical/odontogram.functions";
import { piezasConHallazgos } from "@/components/odontograma-hallazgos";
import { DienteAnatomico } from "@/components/diente-anatomico";
import { cn } from "@/lib/utils";

const TOOTH_SIZE = 40;
const TOOTH_GAP = 4;
// Target táctil mínimo WCAG 2.5.8 (24x24px) para la zona oclusal. El dibujo
// visual del cuadrado central sigue siendo `inner` (~11.2px) para no romper
// el layout del diagrama FDI; solo el área que capta el click/tap se agranda.
const OCLUSAL_HIT_MIN = 24;

type ToothClick = { tooth: number; surface: ToothSurface };

/** Una marca en texto: "Obturación · por realizar", "Corona · mal estado". */
function describirMarca(m: Pick<OdontogramMark, "condition" | "status" | "conservation">): string {
  const partes = [CONDITION_LABELS[m.condition]];
  if (m.status === "planificado") partes.push(MARK_STATUS_LABELS.planificado.toLowerCase());
  else if (m.conservation) partes.push(MARK_CONSERVATION_LABELS[m.conservation].toLowerCase());
  return partes.join(" · ");
}

/** Muestra de color de una marca (cuadradito de la leyenda, la tabla y la historia). */
function Muestra({
  marca,
  className,
}: {
  marca: Pick<OdontogramMark, "condition" | "status" | "conservation">;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("size-3 shrink-0 rounded-sm border border-hairline", className)}
      style={{
        backgroundColor: hexDeMarca(marca),
        opacity: marca.status === "planificado" ? OPACIDAD_PLANIFICADO : 1,
      }}
    />
  );
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
  onClick,
}: {
  tooth: number;
  marcas: ToothState;
  /** Arcada inferior: el dibujo va debajo del esquema, espejado. */
  inferior: boolean;
  seleccionado: boolean;
  onClick: (click: ToothClick) => void;
}) {
  const s = TOOTH_SIZE;
  const c = s / 2;
  const inner = s * 0.28;
  const deLaPieza = marcas.filter((m) => m.surface === "whole" && m.condition !== "sano");
  const cubre = marcaParaPintar(
    deLaPieza.filter((m) => m.status === "existente" && CUBREN_ESQUEMA.includes(m.condition)),
  );
  const wholeColor = cubre ? hexDeMarca(cubre) : null;

  // Activa la misma acción que el click: usada tanto por onClick (mouse/touch)
  // como por onKeyDown (Enter/Space) de cada superficie enfocable.
  function activate(click: ToothClick) {
    onClick(click);
  }

  function handleKeyDown(e: KeyboardEvent<SVGElement>, click: ToothClick) {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      e.stopPropagation();
      activate(click);
    }
  }

  const nombreComun = toothCommonName(tooth);
  const piezaLabel = nombreComun ? `Diente ${tooth} (${nombreComun})` : `Diente ${tooth}`;

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
    if (!m) return { fill: COLORES_SIMBOLOGIA.neutro, opacity: 1 };
    return { fill: hexDeMarca(m), opacity: m.status === "planificado" ? OPACIDAD_PLANIFICADO : 1 };
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
          "tabular-nums text-[11px] text-muted-foreground",
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
      </span>
    </span>
  );
  const dibujo = (
    <DienteAnatomico
      tooth={tooth}
      marcas={marcas}
      inferior={inferior}
      seleccionado={seleccionado}
      onClick={(surface) => activate({ tooth, surface })}
    />
  );

  return (
    <div className={cn("flex items-center gap-1", inferior ? "flex-col-reverse" : "flex-col")}>
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
            fill={wholeColor}
            opacity={0.85}
            tabIndex={0}
            role="button"
            aria-label={wholeLabel}
            className={FOCUS_RING_CLASS}
            onClick={() => activate({ tooth, surface: "whole" })}
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
                fill={p.fill}
                fillOpacity={p.opacity}
                stroke="rgba(0,0,0,0.08)"
                strokeWidth={0.5}
                tabIndex={0}
                role="button"
                aria-label={surfaceLabel(z.surface as Exclude<ToothSurface, "whole">)}
                className={FOCUS_RING_CLASS}
                onClick={(e) => {
                  e.stopPropagation();
                  activate({ tooth, surface: z.surface });
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
            fill={oclusal.fill}
            fillOpacity={oclusal.opacity}
            stroke="rgba(0,0,0,0.12)"
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
              activate({ tooth, surface: "oclusal" });
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
            onClick={() => activate({ tooth, surface: "whole" })}
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
}: {
  teeth: readonly number[];
  byTooth: Map<number, ToothState>;
}) {
  const filas = teeth
    .map((tooth) => {
      const marcas = (byTooth.get(tooth) ?? [])
        .filter((m) => m.condition !== "sano")
        // La pieza completa primero, después las superficies en orden M-D-O-V-L.
        .sort((x, y) => ordenSuperficie(x.surface) - ordenSuperficie(y.surface));
      return { tooth, marcas };
    })
    .filter((f) => f.marcas.length > 0);

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
          <tr className="border-b border-hairline text-[11px] uppercase tracking-wider text-muted-foreground">
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
          {filas.map(({ tooth, marcas }) => (
            <tr key={tooth}>
              <th scope="row" className="py-2 pr-3 tabular-nums font-medium">
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
  seleccionada,
  onClick,
}: {
  teeth: readonly number[];
  byTooth: Map<number, ToothState>;
  inferior?: boolean;
  seleccionada: number | null;
  onClick: (click: ToothClick) => void;
}) {
  return (
    <div className="flex items-stretch" style={{ gap: TOOTH_GAP }}>
      {teeth.map((t, i) => (
        <Fragment key={t}>
          <ToothCell
            tooth={t}
            marcas={byTooth.get(t) ?? []}
            inferior={inferior}
            seleccionado={seleccionada === t}
            onClick={onClick}
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
  /** Edad del paciente: elige la dentición con la que abre (CLI-04). `null` = desconocida. */
  edad?: number | null;
}

export function Odontogram({
  clinicId,
  patientId,
  puedeEditar,
  userId,
  onPresupuestarPieza,
  edad = null,
}: Props) {
  const queryClient = useQueryClient();
  const fetchMarks = useServerFn(listOdontogramMarks);
  const fetchHistory = useServerFn(listOdontogramHistory);
  const saveFn = useServerFn(setOdontogramMark);

  const [selection, setSelection] = useState<ToothClick | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [denticion, setDenticion] = useState<Denticion>(() => denticionPorEdad(edad));
  const [vista, setVista] = useState<"grafico" | "tabla">("grafico");
  // Opciones del popover: se conservan entre piezas para registrar varias
  // seguidas con el mismo criterio (ej. un plan entero "por realizar").
  const [estado, setEstado] = useState<MarkStatus>("existente");
  const [conservacion, setConservacion] = useState<MarkConservation>("bueno");
  const [nota, setNota] = useState("");

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

  const byTooth = useMemo(() => marksByTooth(marks), [marks]);

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
    onExito: () => {
      setSelection(null);
      setNota("");
      toast.success("Marca guardada");
    },
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
    save.mutar({
      ...nueva,
      clinicId,
      patientId,
      notes: nota.trim() || undefined,
      // Lo que esta marca va a cerrar según lo que se ve en pantalla; el
      // servidor lo recalcula y, si no coincide, lo manda a Conflictos.
      baseMarkIds: marcasQueReemplaza(byTooth.get(selection.tooth) ?? [], nueva),
    });
  }

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

  return (
    <div className="card-clinical p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Odontograma</h3>
          <p className="text-xs text-muted-foreground">
            Numeración FDI · toca una zona del diente o del esquema para marcar esa superficie; la
            raíz o el borde superior del esquema marcan la pieza entera.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-hairline p-0.5 text-xs">
            {(["permanente", "mixta", "temporal"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDenticion(d)}
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
        </div>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Cargando odontograma…</p>}

      {!isLoading && vista === "tabla" && (
        <TablaOdontograma
          teeth={FILAS_POR_DENTICION[denticion].flatMap((f) => f.teeth)}
          byTooth={byTooth}
        />
      )}

      {!isLoading && vista === "grafico" && (
        <div className="space-y-4 overflow-x-auto">
          {/* `w-max mx-auto` y no `items-center` en el contenedor con scroll:
              centrar con flex deja lo que desborda por la izquierda fuera de
              alcance (en el celular no se podía llegar a las piezas 18 o 55). */}
          <div className="mx-auto flex w-max flex-col items-center gap-3">
            {FILAS_POR_DENTICION[denticion].map((fila) => (
              <ToothRow
                key={fila.teeth[0]}
                teeth={fila.teeth}
                byTooth={byTooth}
                inferior={fila.inferior}
                seleccionada={selection?.tooth ?? null}
                onClick={setSelection}
              />
            ))}
          </div>

          <p className="flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
            <Info className="size-3" />
            {AYUDA_POR_DENTICION[denticion]} Pasa el mouse sobre el número, o abre una pieza, para
            ver su nombre común.
          </p>

          {/* Leyenda de la simbología (CLI-02): azul / rojo / rojo claro, más
              las siglas de la pieza completa. */}
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11px] text-muted-foreground"
            aria-label="Leyenda del odontograma"
          >
            {LEYENDA_SIMBOLOGIA.map((l) => (
              <span key={l.clave} className="inline-flex items-center gap-1">
                <span
                  aria-hidden
                  className="size-3 rounded-sm border border-hairline"
                  style={{
                    backgroundColor: COLORES_SIMBOLOGIA[l.color],
                    opacity: l.planificado ? OPACIDAD_PLANIFICADO : 1,
                  }}
                />
                {l.texto}
              </span>
            ))}
            <span>Siglas bajo el número: lo registrado en la pieza completa (TC, CO, IMP…).</span>
          </div>
        </div>
      )}

      {selection && (
        <Popover open onOpenChange={(o) => !o && setSelection(null)}>
          <PopoverTrigger asChild>
            <span className="sr-only">Selección abierta</span>
          </PopoverTrigger>
          <PopoverContent className="w-72" side="top">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Pieza {selection.tooth}</p>
                <p className="text-xs text-muted-foreground">
                  {toothCommonName(selection.tooth) ? `${toothCommonName(selection.tooth)} · ` : ""}
                  {SURFACE_LABELS[selection.surface]}
                </p>
              </div>
              <button
                onClick={() => setSelection(null)}
                aria-label="Cerrar"
                className="rounded p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="size-3.5" />
              </button>
            </div>
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
                    Solo los tratamientos se pueden dejar por realizar. Cuando se hagan, márcalos
                    como existentes y lo planificado se cierra solo.
                  </p>
                )}
                {save.enCurso && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Guardando…
                  </span>
                )}
              </div>
            )}
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
                <span className="tabular-nums">{h.toothNumber}</span>
                {toothCommonName(h.toothNumber) && (
                  <span className="text-muted-foreground">{toothCommonName(h.toothNumber)}</span>
                )}
                <span className="text-muted-foreground">{SURFACE_LABELS[h.surface]}</span>
                <span className="font-medium">{describirMarca(h)}</span>
                {h.supersededAt && (
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    · archivada
                  </span>
                )}
              </div>
              <span className="text-muted-foreground">
                {h.recordedByName ?? "—"} · {new Date(h.recordedAt).toLocaleString("es-CL")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Resumen del odontograma para la pestaña "Resumen" de la ficha: qué piezas
 * tienen hallazgos y un acceso a la pestaña completa. Antes la ficha montaba
 * el `<Odontogram>` entero dos veces (Resumen y Odontograma, auditoría 360 del
 * 07-oct-2026); ahora el editor vive solo en su pestaña y acá queda una vista
 * de lectura. Comparte la query (`odontogram-marks`) con el editor, así que
 * pasar de una pestaña a la otra no vuelve a pedir las marcas.
 */
export function OdontogramResumen({
  clinicId,
  patientId,
  onVerOdontograma,
}: {
  clinicId: string;
  patientId: string;
  onVerOdontograma: () => void;
}) {
  const fetchMarks = useServerFn(listOdontogramMarks);
  const { data: marks = [], isLoading } = useQuery({
    queryKey: ["odontogram-marks", clinicId, patientId],
    queryFn: () => fetchMarks({ data: { clinicId, patientId } }),
  });
  const piezas = useMemo(() => piezasConHallazgos(marks), [marks]);

  return (
    <section aria-labelledby="odontograma-resumen" className="card-clinical p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="odontograma-resumen" className="font-display text-lg font-semibold">
            Odontograma
          </h3>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? "Cargando…"
              : piezas.length === 0
                ? "Sin hallazgos registrados."
                : `${piezas.length} ${piezas.length === 1 ? "pieza" : "piezas"} con hallazgos`}
          </p>
        </div>
        <button
          type="button"
          onClick={onVerOdontograma}
          className={cn(
            "inline-flex items-center gap-1 rounded-md text-sm font-medium text-brand-700 hover:underline",
            FOCUS_RING_CLASS,
          )}
        >
          Ver odontograma <ArrowRight className="size-3.5" aria-hidden />
        </button>
      </div>
      {piezas.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {piezas.map((p) => (
            <li
              key={p.tooth}
              className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-2 py-1 text-xs"
            >
              <span className="font-semibold tabular-nums">{p.tooth}</span>
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
    </section>
  );
}
