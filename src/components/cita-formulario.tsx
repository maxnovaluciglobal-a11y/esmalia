import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { EyeOff, Star } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  DURACION_MAX,
  DURACION_MIN,
  DURACIONES_PRESET,
  esDuracionPreset,
} from "@/lib/clinic-operations/cita-formulario";
import { cn } from "@/lib/utils";

/**
 * Piezas visuales del formulario de cita (Ola 1 · frente cita). Las comparten
 * Nueva cita, Editar cita y Agendar solicitud (agenda.tsx). La lógica pura
 * vive en `src/lib/clinic-operations/cita-formulario.ts`.
 */

export const CLASE_CAMPO =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";

const CLASE_CHIP =
  "inline-flex min-h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 pointer-coarse:min-h-11 pointer-coarse:px-4 pointer-coarse:text-sm";

function claseChip(activo: boolean) {
  return cn(
    CLASE_CHIP,
    activo
      ? "border-brand-700 bg-brand-soft text-brand-700"
      : "border-hairline text-muted-foreground hover:border-brand-300 hover:text-foreground",
  );
}

export type OpcionChip = { value: string; label: string; icono?: ReactNode };

/**
 * Grupo de botones de una sola elección, con la semántica de radio:
 * una sola parada de Tab para todo el grupo y las flechas para moverse (el
 * foco elige, como un radio nativo). `permitirVacio`: tocar la opción
 * elegida la quita (el tipo de cita es opcional).
 */
export function GrupoDeChips({
  id,
  etiqueta,
  opciones,
  value,
  onChange,
  permitirVacio = false,
  className,
}: {
  id: string;
  etiqueta: string;
  opciones: readonly OpcionChip[];
  value: string | null;
  onChange: (value: string | null) => void;
  permitirVacio?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const indiceActivo = opciones.findIndex((o) => o.value === value);
  // Sin nada elegido, la primera opción recibe el Tab.
  const indiceTab = indiceActivo >= 0 ? indiceActivo : 0;

  function mover(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const ultimo = opciones.length - 1;
    let destino: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") destino = i === ultimo ? 0 : i + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") destino = i === 0 ? ultimo : i - 1;
    else if (e.key === "Home") destino = 0;
    else if (e.key === "End") destino = ultimo;
    if (destino === null) return;
    e.preventDefault();
    refs.current[destino]?.focus();
    onChange(opciones[destino].value);
  }

  if (opciones.length === 0) return null;
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={etiqueta}
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {opciones.map((o, i) => {
        const activo = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={activo}
            tabIndex={i === indiceTab ? 0 : -1}
            onKeyDown={(e) => mover(e, i)}
            onClick={() => onChange(activo && permitirVacio ? null : o.value)}
            className={claseChip(activo)}
          >
            {o.icono}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Duración con un toque (AGE-13): 15, 30, 45, 60, 90, 120 y "Otra", que
 * muestra el campo libre. Lo que se elige a mano se respeta: el formulario
 * avisa con `onEditadaAMano` para que un procedimiento elegido después no la
 * pise.
 */
export function SelectorDuracion({
  id,
  value,
  onChange,
  onEditadaAMano,
  personalizada,
  onPersonalizada,
}: {
  id: string;
  value: number;
  onChange: (minutos: number) => void;
  onEditadaAMano: () => void;
  /** "Otra" elegida: se ve el campo de minutos aunque el valor sea de la lista. */
  personalizada: boolean;
  onPersonalizada: (v: boolean) => void;
}) {
  const libre = personalizada || !esDuracionPreset(value);
  const opciones: OpcionChip[] = [
    ...DURACIONES_PRESET.map((m) => ({ value: String(m), label: `${m} min` })),
    { value: "otra", label: "Otra" },
  ];
  return (
    <div className="space-y-1.5">
      <Label id={`${id}-etiqueta`} htmlFor={`${id}-libre`}>
        Duración
      </Label>
      <GrupoDeChips
        id={id}
        etiqueta="Duración"
        opciones={opciones}
        value={libre ? "otra" : String(value)}
        onChange={(v) => {
          onEditadaAMano();
          if (v === "otra") {
            onPersonalizada(true);
            return;
          }
          onPersonalizada(false);
          if (v) onChange(Number(v));
        }}
      />
      {libre && (
        <div className="flex items-center gap-2">
          <input
            id={`${id}-libre`}
            type="number"
            inputMode="numeric"
            min={DURACION_MIN}
            max={DURACION_MAX}
            step={5}
            value={value}
            onChange={(e) => {
              onEditadaAMano();
              onChange(Number(e.target.value));
            }}
            className={cn(CLASE_CAMPO, "w-28")}
          />
          <span className="text-xs text-muted-foreground">minutos</span>
        </div>
      )}
    </div>
  );
}

/** Procedimientos frecuentes (AGE-12): un toque completa el tratamiento y su duración. */
export function ChipsProcedimientos({
  id,
  procedimientos,
  seleccionadoId,
  favoritos,
  onElegir,
}: {
  id: string;
  procedimientos: readonly { id: string; name: string }[];
  seleccionadoId: string | null;
  favoritos: ReadonlySet<string>;
  onElegir: (procedureId: string) => void;
}) {
  if (procedimientos.length === 0) return null;
  return (
    <GrupoDeChips
      id={id}
      etiqueta="Procedimientos frecuentes"
      opciones={procedimientos.map((p) => ({
        value: p.id,
        label: p.name,
        icono: favoritos.has(p.id) ? (
          <Star className="size-3 fill-current" aria-label="Favorito" />
        ) : undefined,
      }))}
      value={seleccionadoId}
      onChange={(v) => v && onElegir(v)}
    />
  );
}

/**
 * Box de la sucursal (AGE-14). Sin boxes cargados en la sucursal no se
 * muestra: no hay nada que elegir.
 */
export function SelectorBox({
  id,
  boxes,
  sucursalId,
  value,
  onChange,
}: {
  id: string;
  boxes: readonly { id: string; nombre: string; sucursalId: string }[];
  sucursalId: string;
  value: string;
  onChange: (boxId: string) => void;
}) {
  const deLaSucursal = boxes.filter((b) => b.sucursalId === sucursalId);
  if (!sucursalId || deLaSucursal.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        Box <span className="font-normal text-muted-foreground">(opcional)</span>
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={CLASE_CAMPO}
      >
        <option value="">Sin box</option>
        {deLaSucursal.map((b) => (
          <option key={b.id} value={b.id}>
            {b.nombre}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Observaciones internas (AGE-15): solo para el equipo. */
export function CampoObservaciones({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Observaciones internas</Label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={1000}
        rows={2}
        aria-describedby={`${id}-ayuda`}
        placeholder="Ej: viene con su mamá, prefiere la tarde…"
        className={cn(CLASE_CAMPO, "resize-y")}
      />
      <p id={`${id}-ayuda`} className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <EyeOff className="size-3" aria-hidden /> El paciente no ve esto.
      </p>
    </div>
  );
}

/**
 * Ayuda bajo el selector de profesional (AGE-17): solo se listan quienes
 * atienden pacientes. Quien administra ve el atajo para sumar a alguien.
 */
export function AyudaProfesionales({ puedeAdministrar }: { puedeAdministrar: boolean }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      Solo aparecen quienes atienden pacientes.{" "}
      {puedeAdministrar ? (
        <>
          ¿Falta alguien?{" "}
          <Link to="/profesionales" className="font-medium text-brand-700 underline">
            Agrégalo en Profesionales
          </Link>
          .
        </>
      ) : (
        "¿Falta alguien? Pídele a quien administra la clínica que lo agregue en Profesionales."
      )}
    </p>
  );
}

/**
 * "Falta completar: …" bajo el botón de guardar (AGE-16). El botón sigue
 * habilitado: al apretarlo con algo pendiente, el formulario lleva el foco al
 * primer campo que falta en vez de dejar un botón gris sin explicación. El
 * texto se anuncia en vivo y queda enlazado al botón por `aria-describedby`
 * (mismo criterio que AccionDeshabilitada).
 */
export function FaltaCompletar({ id, texto }: { id: string; texto: string | null }) {
  return (
    <p
      id={id}
      aria-live="polite"
      className={cn("text-xs text-muted-foreground", !texto && "sr-only")}
    >
      {texto ?? ""}
    </p>
  );
}
