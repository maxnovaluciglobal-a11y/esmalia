import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";

import {
  getMedicalHistory,
  setMedicalHistory,
  type AnamnesisDeFichaFusionada,
} from "@/lib/clinical/medical-history.functions";
import { unirSinRepetir } from "@/lib/patients/fusion";
import { useOfflineMutation } from "@/hooks/use-offline-mutation";

function ChipListEditor({
  label,
  placeholder,
  items,
  onChange,
  disabled,
  tone,
}: {
  label: string;
  placeholder: string;
  items: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
  tone?: "destructive";
}) {
  const [draft, setDraft] = useState("");
  const inputId = useId();

  function agregar() {
    const value = draft.trim();
    if (!value || items.includes(value)) return;
    onChange([...items, value]);
    setDraft("");
  }

  return (
    <div className="space-y-1.5">
      {disabled ? (
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      ) : (
        <label htmlFor={inputId} className="block text-xs font-medium text-muted-foreground">
          {label}
        </label>
      )}
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 && (
          <span className="text-xs text-muted-foreground">Sin registrar.</span>
        )}
        {items.map((item) => (
          <span
            key={item}
            className={
              tone === "destructive"
                ? "flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive"
                : "flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs"
            }
          >
            {item}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(items.filter((i) => i !== item))}
                aria-label={`Quitar ${item}`}
                className="opacity-60 hover:opacity-100"
              >
                <X aria-hidden className="size-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <input
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                agregar();
              }
            }}
            placeholder={placeholder}
            className="w-full max-w-xs rounded-lg border border-input bg-transparent px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
          />
          <button
            type="button"
            onClick={agregar}
            disabled={!draft.trim()}
            aria-label={`Agregar a ${label.toLowerCase()}`}
            className="rounded-lg border border-hairline px-2.5 text-xs text-muted-foreground hover:bg-secondary disabled:opacity-40"
          >
            <Plus aria-hidden className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function MedicalHistoryCard({
  clinicId,
  patientId,
  puedeEditar,
  userId,
}: {
  clinicId: string;
  patientId: string;
  puedeEditar: boolean;
  /** Dueño de lo que quede en la cola offline (ver `offline-queue.ts`). */
  userId: string;
}) {
  const fetchFn = useServerFn(getMedicalHistory);
  const historyQuery = useQuery({
    queryKey: ["medical-history", clinicId, patientId],
    queryFn: () => fetchFn({ data: { clinicId, patientId } }),
  });

  const [allergies, setAllergies] = useState<string[]>([]);
  const [medications, setMedications] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!historyQuery.data) return;
    setAllergies(historyQuery.data.allergies);
    setMedications(historyQuery.data.chronicMedications);
    setConditions(historyQuery.data.conditions);
    setNotes(historyQuery.data.notes ?? "");
  }, [historyQuery.data]);

  const saveFn = useServerFn(setMedicalHistory);
  const guardarOffline = useOfflineMutation<Record<string, unknown>>({
    kind: "actualizar-anamnesis",
    userId,
    ejecutar: (payload) => saveFn({ data: payload as never }),
    invalidar: [["medical-history", clinicId, patientId]],
    resumen: () => "Antecedentes médicos",
    // 1 fila por paciente (no versionada): una segunda edición offline
    // seguida reemplaza la pendiente anterior en vez de acumular dos
    // capturas para el mismo registro.
    identidad: () => patientId,
    onExito: () => toast.success("Antecedentes médicos guardados."),
  });

  function guardar() {
    guardarOffline.mutar({
      clinicId,
      patientId,
      allergies,
      chronicMedications: medications,
      conditions,
      notes,
    });
  }

  const dirty =
    historyQuery.data &&
    (JSON.stringify(allergies) !== JSON.stringify(historyQuery.data.allergies) ||
      JSON.stringify(medications) !== JSON.stringify(historyQuery.data.chronicMedications) ||
      JSON.stringify(conditions) !== JSON.stringify(historyQuery.data.conditions) ||
      notes !== (historyQuery.data.notes ?? ""));

  return (
    <section className="card-clinical p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-sm font-semibold">Anamnesis</h3>
        {puedeEditar && dirty && (
          <button
            type="button"
            onClick={guardar}
            disabled={guardarOffline.enCurso}
            className="flex items-center gap-1.5 rounded-lg border border-brand bg-transparent px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand/12 disabled:opacity-60"
          >
            {guardarOffline.enCurso ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Guardar
          </button>
        )}
      </div>

      {historyQuery.isLoading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Cargando antecedentes…
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {(historyQuery.data?.deFichasFusionadas ?? []).map((f) => (
            <AnamnesisFusionadaAlerta
              key={f.patientId}
              ficha={f}
              puedeEditar={puedeEditar}
              onSumar={() => {
                setAllergies((a) => unirSinRepetir(a, f.allergies));
                setMedications((m) => unirSinRepetir(m, f.chronicMedications));
                setConditions((c) => unirSinRepetir(c, f.conditions));
                toast.info("Revisa los antecedentes sumados y guarda para dejarlos en esta ficha.");
              }}
            />
          ))}
          <ChipListEditor
            label="Alergias"
            placeholder="Ej. Penicilina"
            items={allergies}
            onChange={setAllergies}
            disabled={!puedeEditar}
            tone="destructive"
          />
          <ChipListEditor
            label="Medicación crónica"
            placeholder="Ej. Losartán 50mg"
            items={medications}
            onChange={setMedications}
            disabled={!puedeEditar}
          />
          <ChipListEditor
            label="Antecedentes / patologías"
            placeholder="Ej. Diabetes tipo 2"
            items={conditions}
            onChange={setConditions}
            disabled={!puedeEditar}
          />
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Notas adicionales</p>
            {puedeEditar ? (
              <textarea
                aria-label="Notas adicionales"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Ej. embarazo, precauciones al anestesiar…"
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
              />
            ) : (
              <p className="text-xs text-muted-foreground">{notes || "Sin notas."}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * CLI-06: la anamnesis de una ficha que se fusionó en esta. No se combina
 * sola (nadie la revisó), pero tampoco puede quedar escondida en la ficha
 * vieja: una alergia que no se ve es la que se receta. Quien puede editar la
 * suma a esta ficha con un toque y la revisa antes de guardar.
 */
function AnamnesisFusionadaAlerta({
  ficha,
  puedeEditar,
  onSumar,
}: {
  ficha: AnamnesisDeFichaFusionada;
  puedeEditar: boolean;
  onSumar: () => void;
}) {
  const partes = [
    ficha.allergies.length ? `Alergias: ${ficha.allergies.join(", ")}` : null,
    ficha.chronicMedications.length
      ? `Medicación crónica: ${ficha.chronicMedications.join(", ")}`
      : null,
    ficha.conditions.length ? `Antecedentes: ${ficha.conditions.join(", ")}` : null,
    ficha.notes?.trim() ? `Notas: ${ficha.notes.trim()}` : null,
  ].filter(Boolean);
  const tieneAlergias = ficha.allergies.length > 0;
  return (
    <div
      role="alert"
      className={
        tieneAlergias
          ? "rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          : "rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs text-warning"
      }
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
        Antecedentes de la ficha fusionada «{ficha.nombre}»
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {partes.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="mt-1.5 text-foreground/80">
        No se combinaron solos al fusionar las fichas. Revísalos y súmalos a esta ficha si
        corresponden.
      </p>
      {puedeEditar && (
        <button
          type="button"
          onClick={onSumar}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-current px-2.5 py-1 text-xs font-medium"
        >
          <Plus aria-hidden className="size-3" /> Sumar a esta ficha para revisar
        </button>
      )}
    </div>
  );
}

/** Banner compacto para el header de la ficha — solo se muestra si hay
 * alergias cargadas. Separado del resto de la anamnesis a propósito: es lo
 * único que el staff necesita ver de un vistazo antes de tratar al
 * paciente, no algo que deba ir a buscar dentro de una sección. */
export function AllergyAlertBanner({ allergies }: { allergies: string[] }) {
  if (allergies.length === 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
      <AlertTriangle className="size-3.5 shrink-0" />
      Alergias: {allergies.join(", ")}
    </div>
  );
}

/** Ícono + tooltip nativo (`title`) para listas densas (agenda) donde un
 * banner de línea completa no entra — mismo dato que `AllergyAlertBanner`,
 * solo que en el espacio de un ícono. `null` si no hay alergias cargadas,
 * igual que el banner: la ausencia de ícono no implica "sin alergias
 * confirmadas", solo que no hay antecedentes cargados (regla #11). */
export function AllergyAlertIcon({ allergies }: { allergies: string[] | undefined }) {
  if (!allergies || allergies.length === 0) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center text-destructive"
      title={`Alergias: ${allergies.join(", ")}`}
    >
      <AlertTriangle className="size-3.5" />
    </span>
  );
}
