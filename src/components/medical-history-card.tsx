import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";

import {
  PREGUNTAS_RIESGO,
  SEVERIDADES_ALERGIA,
  conciliarCuestionario,
  etiquetaSeveridad,
  preguntasPorGrupo,
  preguntasRespondidas,
  riesgosDesdeAntecedentes,
  type AlergiaDetallada,
  type ClavePregunta,
  type CuestionarioRiesgo,
  type SeveridadAlergia,
} from "@/lib/clinical/anamnesis";
import {
  getMedicalHistory,
  setMedicalHistory,
  type AnamnesisDeFichaFusionada,
} from "@/lib/clinical/medical-history.functions";
import { unirSinRepetir } from "@/lib/patients/fusion";
import { useOfflineMutation } from "@/hooks/use-offline-mutation";
import { cn } from "@/lib/utils";

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
        <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      ) : (
        <label htmlFor={inputId} className="block text-sm font-semibold text-muted-foreground">
          {label}
        </label>
      )}
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 && (
          <span className="text-sm text-muted-foreground">Sin registrar.</span>
        )}
        {items.map((item) => (
          <span
            key={item}
            className={
              tone === "destructive"
                ? "flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive"
                : "flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-sm"
            }
          >
            {item}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(items.filter((i) => i !== item))}
                aria-label={`Quitar ${item}`}
                className="relative -my-1 -mr-1.5 grid size-6 shrink-0 place-items-center rounded-full hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:-my-2.5 pointer-coarse:-mr-3 pointer-coarse:size-11"
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

const tonoSeveridad: Record<SeveridadAlergia, string> = {
  severe: "bg-destructive text-destructive-foreground",
  moderate: "bg-destructive/15 text-destructive",
  mild: "bg-destructive/10 text-destructive",
  unknown: "bg-destructive/10 text-destructive",
};

/** Alergias con severidad y reacción (CLI-10). */
function AllergyEditor({
  items,
  onChange,
  disabled,
}: {
  items: AlergiaDetallada[];
  onChange: (next: AlergiaDetallada[]) => void;
  disabled: boolean;
}) {
  const [nombre, setNombre] = useState("");
  const [severidad, setSeveridad] = useState<SeveridadAlergia>("unknown");
  const [reaccion, setReaccion] = useState("");
  const inputId = useId();

  function agregar() {
    const name = nombre.trim();
    if (!name) return;
    const igual = (a: AlergiaDetallada) =>
      a.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es");
    const nueva: AlergiaDetallada = {
      name,
      severity: severidad,
      ...(reaccion.trim() ? { reaction: reaccion.trim() } : {}),
    };
    // Repetir un nombre actualiza su severidad en vez de duplicarlo.
    onChange(items.some(igual) ? items.map((a) => (igual(a) ? nueva : a)) : [...items, nueva]);
    setNombre("");
    setReaccion("");
    setSeveridad("unknown");
  }

  return (
    <div className="space-y-1.5">
      {disabled ? (
        <p className="text-sm font-semibold text-muted-foreground">Alergias</p>
      ) : (
        <label htmlFor={inputId} className="block text-sm font-semibold text-muted-foreground">
          Alergias
        </label>
      )}
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 && (
          <span className="text-sm text-muted-foreground">Sin registrar.</span>
        )}
        {items.map((a) => (
          <span
            key={a.name}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
              tonoSeveridad[a.severity],
            )}
            title={a.reaction ? `Reacción: ${a.reaction}` : undefined}
          >
            {a.name}
            <span className="font-normal">· {etiquetaSeveridad[a.severity].toLowerCase()}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(items.filter((i) => i.name !== a.name))}
                aria-label={`Quitar ${a.name}`}
                className="relative -my-1 -mr-1.5 grid size-6 shrink-0 place-items-center rounded-full hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:-my-2.5 pointer-coarse:-mr-3 pointer-coarse:size-11"
              >
                <X aria-hidden className="size-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                agregar();
              }
            }}
            placeholder="Ej. Penicilina"
            className="w-full max-w-[12rem] rounded-lg border border-input bg-transparent px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
          />
          <select
            aria-label="Severidad de la alergia"
            value={severidad}
            onChange={(e) => setSeveridad(e.target.value as SeveridadAlergia)}
            className="rounded-lg border border-input bg-transparent px-2 py-1.5 text-xs pointer-coarse:text-base"
          >
            {SEVERIDADES_ALERGIA.map((s) => (
              <option key={s} value={s}>
                {etiquetaSeveridad[s]}
              </option>
            ))}
          </select>
          <input
            aria-label="Reacción (opcional)"
            value={reaccion}
            onChange={(e) => setReaccion(e.target.value)}
            placeholder="Reacción (opcional)"
            className="w-full max-w-[12rem] rounded-lg border border-input bg-transparent px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
          />
          <button
            type="button"
            onClick={agregar}
            disabled={!nombre.trim()}
            aria-label="Agregar alergia"
            className="rounded-lg border border-hairline px-2.5 text-xs text-muted-foreground hover:bg-secondary disabled:opacity-40"
          >
            <Plus aria-hidden className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Cuestionario de riesgo: Sí / No / sin responder, con detalle cuando es Sí.
 * UX-14: lo que ya dicen los antecedentes o la medicación aparece como "Sí,
 * según antecedentes" (sin guardarse hasta que alguien lo confirme).
 */
function RiskQuestionnaire({
  value,
  onChange,
  disabled,
  antecedentes,
  medicacion,
}: {
  value: CuestionarioRiesgo;
  onChange: (next: CuestionarioRiesgo) => void;
  disabled: boolean;
  antecedentes: string[];
  medicacion: string[];
}) {
  const { efectivo, desdeAntecedentes, contradicciones } = conciliarCuestionario(
    value,
    riesgosDesdeAntecedentes({ antecedentes, medicacion }),
  );

  function responder(key: ClavePregunta, answer: "yes" | "no" | null) {
    const next = { ...value };
    if (answer === null) delete next[key];
    // Confirmar una inferida deja como detalle de dónde salió ("Hipertensión").
    else
      next[key] = {
        answer,
        detail: answer === "yes" ? (value[key]?.detail ?? efectivo[key]?.detail) : undefined,
      };
    onChange(next);
  }

  function detallar(key: ClavePregunta, detail: string) {
    const actual = value[key];
    if (!actual) return;
    onChange({ ...value, [key]: { ...actual, detail } });
  }

  const grupos = preguntasPorGrupo();
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold text-muted-foreground">
        Antecedentes · <span className="cifra">{preguntasRespondidas(efectivo)}</span> de{" "}
        <span className="cifra">{PREGUNTAS_RIESGO.length}</span> respondidos
        {desdeAntecedentes.length > 0 &&
          ` (${desdeAntecedentes.length} según antecedentes, sin confirmar)`}
      </legend>
      {grupos.map((g) => {
        const respondidas = g.preguntas.filter((p) => efectivo[p.key]).length;
        const positivas = g.preguntas.filter((p) => efectivo[p.key]?.answer === "yes").length;
        return (
          <section key={g.key} aria-labelledby={`antecedentes-${g.key}`} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 id={`antecedentes-${g.key}`} className="font-display text-xl font-semibold">
                {g.label}
              </h4>
              <span className="text-[13px] text-muted-foreground">
                <span className="cifra">{respondidas}</span>/
                <span className="cifra">{g.preguntas.length}</span>
                {positivas > 0 && (
                  <span className="ml-2 inline-flex h-6 items-center rounded-full border border-destructive-border bg-destructive-soft px-2 text-[12px] font-semibold text-destructive">
                    {positivas === 1 ? "1 positivo" : `${positivas} positivos`}
                  </span>
                )}
              </span>
            </div>
            <ul className="divide-y divide-hairline rounded-[14px] border border-hairline">
              {g.preguntas.map((p) => {
                const guardada = value[p.key];
                const inferida = desdeAntecedentes.includes(p.key);
                const contradice = contradicciones.includes(p.key);
                const r = guardada ?? efectivo[p.key];
                return (
                  <li key={p.key} className="space-y-1.5 px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={cn(
                          "min-w-0 text-[15px]",
                          r?.answer === "yes" && p.critica && "font-semibold text-destructive",
                          r?.answer === "yes" && !p.critica && "font-semibold",
                        )}
                      >
                        {p.label}
                        {p.critica && <span className="sr-only"> (riesgo crítico)</span>}
                      </span>
                      {disabled ? (
                        <span className="text-sm text-muted-foreground">
                          {r ? (r.answer === "yes" ? "Sí" : "No") : "Sin responder"}
                          {inferida && " · según antecedentes"}
                        </span>
                      ) : (
                        <div role="radiogroup" aria-label={p.label} className="flex gap-1">
                          {(
                            [
                              ["yes", "Sí"],
                              ["no", "No"],
                            ] as const
                          ).map(([answer, texto]) => (
                            <button
                              key={answer}
                              type="button"
                              role="radio"
                              aria-checked={guardada?.answer === answer}
                              onClick={() =>
                                responder(p.key, guardada?.answer === answer ? null : answer)
                              }
                              className={cn(
                                "h-8 min-w-11 rounded-full border px-3 text-sm font-semibold pointer-coarse:h-11",
                                inferida && answer === "yes"
                                  ? "border-dashed border-destructive/60 text-destructive"
                                  : guardada?.answer === answer
                                    ? answer === "yes"
                                      ? "border-destructive bg-destructive-soft text-destructive"
                                      : "border-foreground bg-foreground text-background"
                                    : "border-control text-muted-foreground hover:border-foreground",
                              )}
                            >
                              {texto}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {inferida && (
                      <p className="text-[13px] text-muted-foreground">
                        Según antecedentes: {r?.detail}.{" "}
                        {!disabled && "Toca «Sí» para confirmarla o «No» si ya no aplica."}
                      </p>
                    )}
                    {contradice && (
                      <p className="flex items-center gap-1 text-[13px] text-warning">
                        <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
                        Respondida «No», pero los antecedentes la mencionan. Revísalo con el
                        paciente.
                      </p>
                    )}
                    {guardada?.answer === "yes" &&
                      (disabled ? (
                        guardada.detail && (
                          <p className="text-sm text-muted-foreground">{guardada.detail}</p>
                        )
                      ) : (
                        <input
                          aria-label={`Detalle: ${p.label}`}
                          value={guardada.detail ?? ""}
                          onChange={(e) => detallar(p.key, e.target.value)}
                          placeholder={p.ayuda ?? "Detalle (opcional)"}
                          maxLength={300}
                          className="w-full rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
                        />
                      ))}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!disabled && (
        <p className="text-[13px] text-muted-foreground">
          Toca de nuevo una respuesta para dejarla sin responder.
        </p>
      )}
    </fieldset>
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

  const [allergies, setAllergies] = useState<AlergiaDetallada[]>([]);
  const [medications, setMedications] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [cuestionario, setCuestionario] = useState<CuestionarioRiesgo>({});

  useEffect(() => {
    if (!historyQuery.data) return;
    setAllergies(historyQuery.data.allergyDetails);
    setMedications(historyQuery.data.chronicMedications);
    setConditions(historyQuery.data.conditions);
    setNotes(historyQuery.data.notes ?? "");
    setCuestionario(historyQuery.data.riskQuestionnaire);
  }, [historyQuery.data]);
  const estructurada = historyQuery.data?.estructuradaDisponible ?? true;

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
    onExito: (resultado) => {
      if ((resultado as { estructuradaPendiente?: boolean } | undefined)?.estructuradaPendiente) {
        toast.warning(
          "Guardamos las alergias por nombre. La severidad y el cuestionario todavía no están habilitados.",
        );
      } else {
        toast.success("Antecedentes médicos guardados.");
      }
    },
  });

  function guardar() {
    guardarOffline.mutar({
      clinicId,
      patientId,
      allergies: allergies.map((a) => a.name),
      chronicMedications: medications,
      conditions,
      notes,
      ...(estructurada ? { allergyDetails: allergies, riskQuestionnaire: cuestionario } : {}),
    });
  }

  const dirty =
    historyQuery.data &&
    (JSON.stringify(allergies) !== JSON.stringify(historyQuery.data.allergyDetails) ||
      JSON.stringify(medications) !== JSON.stringify(historyQuery.data.chronicMedications) ||
      JSON.stringify(conditions) !== JSON.stringify(historyQuery.data.conditions) ||
      notes !== (historyQuery.data.notes ?? "") ||
      JSON.stringify(cuestionario) !== JSON.stringify(historyQuery.data.riskQuestionnaire));

  return (
    <section
      aria-labelledby="anamnesis-titulo"
      className="rounded-panel border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="anamnesis-titulo"
            className="font-display text-[30px] leading-none font-medium tracking-[-0.01em]"
          >
            Anamnesis y <em className="text-brand-600">antecedentes</em>
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Mórbidos, quirúrgicos, alergias, medicamentos, hábitos, familiares, embarazo y
            odontológicos. Es lo mismo que responde el paciente en el formulario antes de la cita.
          </p>
        </div>
        {puedeEditar && dirty && (
          <button
            type="button"
            onClick={guardar}
            disabled={guardarOffline.enCurso}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-foreground bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60 pointer-coarse:h-11"
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
                setAllergies((a) => {
                  const nombres = unirSinRepetir(
                    a.map((x) => x.name),
                    f.allergies,
                  );
                  return nombres.map(
                    (name) =>
                      a.find((x) => x.name === name) ?? { name, severity: "unknown" as const },
                  );
                });
                setMedications((m) => unirSinRepetir(m, f.chronicMedications));
                setConditions((c) => unirSinRepetir(c, f.conditions));
                toast.info("Revisa los antecedentes sumados y guarda para dejarlos en esta ficha.");
              }}
            />
          ))}
          <AllergyEditor items={allergies} onChange={setAllergies} disabled={!puedeEditar} />
          <ChipListEditor
            label="Medicación crónica"
            placeholder="Ej. Losartán 50mg"
            items={medications}
            onChange={setMedications}
            disabled={!puedeEditar}
          />
          <ChipListEditor
            label="Otros antecedentes o patologías (texto libre)"
            placeholder="Ej. Diabetes tipo 2"
            items={conditions}
            onChange={setConditions}
            disabled={!puedeEditar}
          />
          {estructurada && (
            <RiskQuestionnaire
              value={cuestionario}
              onChange={setCuestionario}
              disabled={!puedeEditar}
              antecedentes={conditions}
              medicacion={medications}
            />
          )}
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-muted-foreground">Notas adicionales</p>
            {puedeEditar ? (
              <textarea
                aria-label="Notas adicionales"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Ej. precauciones al anestesiar…"
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
