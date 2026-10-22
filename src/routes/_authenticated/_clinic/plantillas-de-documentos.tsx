import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, FileText, History, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { HojaDocumento } from "@/components/documentos/hoja-documento";
import { ErrorDeCarga } from "@/components/estado-error";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requirePermission } from "@/lib/access/route-guards";
import {
  crearPlantillaDocumento,
  guardarVersionPlantilla,
  listPlantillasDocumento,
  listVersionesPlantilla,
  setPlantillaDocumentoActiva,
  type PlantillaDocumento,
} from "@/lib/documentos/documentos.functions";
import { analizarPlantilla, bloqueDeFirma, renderPlantilla } from "@/lib/documentos/motor";
import {
  ETIQUETA_TIPO_DE_DOCUMENTO,
  TIPOS_DE_DOCUMENTO,
  type TipoDeDocumento,
} from "@/lib/documentos/tipos";
import {
  CAMPOS,
  ETIQUETA_GRUPO,
  PREFIJO_CAMPO,
  VARIABLES,
  contextoDeEjemplo,
  definicionCampo,
  type GrupoVariable,
} from "@/lib/documentos/variables";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Editor de plantillas de documentos por clínica (DOC-09): texto con
 * variables, lista de variables insertables, aviso de variables inválidas y
 * vista previa en vivo con datos de ejemplo. Guardar crea una versión nueva:
 * los documentos ya emitidos siguen apuntando a la suya.
 */
export const Route = createFileRoute("/_authenticated/_clinic/plantillas-de-documentos")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [{ title: "Plantillas de documentos | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: PlantillasDocumentosPage,
});

const AVISO_MODELO_DOCUMENTO =
  "Texto modelo de Esmalia: revísalo y adáptalo con tu equipo antes de usarlo. No reemplaza la revisión de tu asesor legal.";

const PLANTILLA_NUEVA = `# Título del documento

{{clinica.nombre}}, {{fecha}}

Certifico que **{{paciente.nombre}}**, {{paciente.tipo_documento}} {{paciente.rut}}, …
`;

const GRUPOS: GrupoVariable[] = ["paciente", "clinica", "profesional", "documento", "reembolso"];
/** Las variables del presupuesto solo tienen dato en la plantilla del presupuesto (PLA-08). */
const GRUPOS_PRESUPUESTO: GrupoVariable[] = ["paciente", "clinica", "documento", "presupuesto"];

function inputClass() {
  return "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";
}

type Borrador = {
  title: string;
  kind: TipoDeDocumento;
  description: string;
  body: string;
};

function PlantillasDocumentosPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic!.id;
  const esDemo = access.clinic!.isDemo;
  const timezone = access.clinic!.timezone;
  const listar = useServerFn(listPlantillasDocumento);
  const consulta = useQuery({
    queryKey: ["plantillas-documento", clinicId],
    queryFn: () => listar({ data: { clinicId } }),
  });
  const plantillas = useMemo(() => consulta.data ?? [], [consulta.data]);
  const [seleccion, setSeleccion] = useState<string | "nueva" | null>(null);
  const actual = plantillas.find((p) => p.id === seleccion) ?? null;

  useEffect(() => {
    if (seleccion === null && plantillas.length) setSeleccion(plantillas[0].id);
  }, [plantillas, seleccion]);

  /** En pantallas angostas el editor queda debajo de la lista: se lleva a la vista. */
  function elegir(id: string) {
    setSeleccion(id);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() =>
        document.getElementById("editor-plantilla")?.scrollIntoView({ block: "start" }),
      );
    }
  }

  return (
    <AppShell title="Plantillas de documentos" access={access}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Certificados, informes y formularios que se emiten desde la ficha de cada paciente, con
            sus datos y tu firma. Editar una plantilla crea una versión nueva: lo que ya emitiste no
            cambia.
          </p>
          <BloqueoEscritura otroMotivo={esDemo ? "La clínica demo es de solo lectura." : null}>
            <Button size="sm" onClick={() => elegir("nueva")} disabled={esDemo}>
              <Plus aria-hidden /> Nueva plantilla
            </Button>
          </BloqueoEscritura>
        </div>

        {consulta.isError ? (
          <ErrorDeCarga
            onReintentar={() => consulta.refetch()}
            reintentando={consulta.isFetching}
            mensaje="No pudimos cargar las plantillas."
          />
        ) : consulta.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <nav aria-label="Plantillas" className="min-w-0">
              <ul className="divide-y divide-hairline border-y border-border">
                {plantillas.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => elegir(p.id)}
                      aria-current={p.id === seleccion ? "true" : undefined}
                      className={cn(
                        "flex w-full items-start gap-3 px-2 py-3 text-left transition-colors hover:bg-secondary/40",
                        p.id === seleccion && "bg-brand-soft",
                      )}
                    >
                      <FileText
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {ETIQUETA_TIPO_DE_DOCUMENTO[p.kind]}
                          {p.version ? ` · v${p.version.numero}` : ""}
                          {!p.active ? " · Desactivada" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div id="editor-plantilla" className="min-w-0 scroll-mt-20">
              {seleccion === "nueva" ? (
                <EditorPlantilla
                  key="nueva"
                  clinicId={clinicId}
                  esDemo={esDemo}
                  timezone={timezone}
                  plantilla={null}
                  onCreada={(id) => setSeleccion(id)}
                />
              ) : actual ? (
                <EditorPlantilla
                  key={`${actual.id}-${actual.version?.id ?? ""}`}
                  clinicId={clinicId}
                  esDemo={esDemo}
                  timezone={timezone}
                  plantilla={actual}
                  onCreada={(id) => setSeleccion(id)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Elige una plantilla para editarla.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function EditorPlantilla({
  clinicId,
  esDemo,
  timezone,
  plantilla,
  onCreada,
}: {
  clinicId: string;
  esDemo: boolean;
  timezone: string;
  plantilla: PlantillaDocumento | null;
  onCreada: (id: string) => void;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const crearFn = useServerFn(crearPlantillaDocumento);
  const guardarFn = useServerFn(guardarVersionPlantilla);
  const activaFn = useServerFn(setPlantillaDocumentoActiva);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const original: Borrador = {
    title: plantilla?.title ?? "",
    kind: plantilla?.kind ?? "otro",
    description: plantilla?.description ?? "",
    body: plantilla?.version?.body ?? PLANTILLA_NUEVA,
  };
  const [borrador, setBorrador] = useState<Borrador>(original);
  const cambio =
    !plantilla ||
    borrador.title.trim() !== original.title ||
    borrador.kind !== original.kind ||
    borrador.description.trim() !== original.description ||
    borrador.body !== original.body;

  const analisis = useMemo(() => analizarPlantilla(borrador.body), [borrador.body]);
  const vista = useMemo(() => {
    const ejemplo = contextoDeEjemplo();
    // Campos propios de esta plantilla: un valor de ejemplo para que la vista
    // previa no los muestre como faltantes.
    for (const c of analisis.campos) {
      const clave = `${PREFIJO_CAMPO}${c}`;
      if (!ejemplo.valores[clave]) ejemplo.valores[clave] = `(${definicionCampo(c).etiqueta})`;
    }
    return renderPlantilla(borrador.body, ejemplo, {
      firma: bloqueDeFirma({
        nombre: "Dra. Carolina Rodríguez",
        registroSis: "123456",
        especialidad: "Endodoncia",
      }),
    });
  }, [borrador.body, analisis.campos]);

  const invalidar = () =>
    queryClient.invalidateQueries({ queryKey: ["plantillas-documento", clinicId] });

  const guardar = useMutation({
    mutationFn: async () => {
      const base = {
        clinicId,
        title: borrador.title,
        kind: borrador.kind,
        description: borrador.description,
        body: borrador.body,
      };
      if (!plantilla) return { creada: (await crearFn({ data: base })).id };
      const v = await guardarFn({ data: { ...base, templateId: plantilla.id } });
      return { numero: v.numero };
    },
    onSuccess: async (r) => {
      await invalidar();
      await queryClient.invalidateQueries({ queryKey: ["versiones-plantilla"] });
      if ("creada" in r && r.creada) {
        toast.success("Plantilla creada.");
        onCreada(r.creada);
      } else {
        toast.success(`Guardada como versión ${"numero" in r ? r.numero : ""}.`);
      }
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const activa = useMutation({
    mutationFn: (active: boolean) =>
      activaFn({ data: { clinicId, templateId: plantilla!.id, active } }),
    onSuccess: async (_r, active) => {
      await invalidar();
      toast.success(active ? "Plantilla activada." : "Plantilla desactivada.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  function insertar(variable: string) {
    const el = textarea.current;
    const texto = `{{${variable}}}`;
    if (!el) {
      setBorrador((b) => ({ ...b, body: b.body + texto }));
      return;
    }
    const inicio = el.selectionStart ?? el.value.length;
    const fin = el.selectionEnd ?? inicio;
    const nuevo = el.value.slice(0, inicio) + texto + el.value.slice(fin);
    setBorrador((b) => ({ ...b, body: nuevo }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(inicio + texto.length, inicio + texto.length);
    });
  }

  const motivoNoGuardar = esDemo
    ? "La clínica demo es de solo lectura."
    : analisis.problemas.length
      ? "Corrige los avisos de la plantilla para guardarla."
      : borrador.title.trim().length < 2
        ? "Escribe un título."
        : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-display text-2xl font-semibold">
          {plantilla ? plantilla.title : "Nueva plantilla"}
        </h2>
        {plantilla?.source === "esmalia_model" && (
          <Badge variant="outline">Modelo de Esmalia</Badge>
        )}
        {plantilla?.version && (
          <Badge variant="secondary" className="cifra">
            v{plantilla.version.numero}
          </Badge>
        )}
        {plantilla && !plantilla.active && <Badge variant="outline">Desactivada</Badge>}
      </div>
      {plantilla?.source === "esmalia_model" && (
        <p className="rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm">
          {AVISO_MODELO_DOCUMENTO}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <form
          className="min-w-0 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!motivoNoGuardar && cambio) guardar.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`${fid}-titulo`}>Título</Label>
              <Input
                id={`${fid}-titulo`}
                value={borrador.title}
                onChange={(e) => setBorrador((b) => ({ ...b, title: e.target.value }))}
                maxLength={120}
                placeholder="Ej. Certificado de atención"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-tipo`}>Tipo</Label>
              <select
                id={`${fid}-tipo`}
                value={borrador.kind}
                onChange={(e) =>
                  setBorrador((b) => ({ ...b, kind: e.target.value as TipoDeDocumento }))
                }
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              >
                {TIPOS_DE_DOCUMENTO.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_TIPO_DE_DOCUMENTO[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-descripcion`}>Para qué sirve (opcional)</Label>
              <Input
                id={`${fid}-descripcion`}
                value={borrador.description}
                onChange={(e) => setBorrador((b) => ({ ...b, description: e.target.value }))}
                maxLength={300}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-cuerpo`}>Texto</Label>
            <textarea
              id={`${fid}-cuerpo`}
              ref={textarea}
              value={borrador.body}
              onChange={(e) => setBorrador((b) => ({ ...b, body: e.target.value }))}
              rows={18}
              spellCheck
              aria-describedby={`${fid}-ayuda ${fid}-avisos`}
              className={cn(inputClass(), "font-mono text-[13px] leading-relaxed")}
            />
            <p id={`${fid}-ayuda`} className="text-xs text-muted-foreground">
              <code># Título</code> y <code>## Subtítulo</code> en su propia línea,{" "}
              <code>**negrita**</code>, <code>- </code> para listas y una línea en blanco entre
              párrafos. Los datos van entre llaves dobles; para pedir algo al emitir, escribe{" "}
              <code>{"{{campo.nombre}}"}</code>.
            </p>
          </div>

          <div id={`${fid}-avisos`} aria-live="polite">
            {analisis.problemas.length > 0 ? (
              <ul className="space-y-1 rounded-md border border-destructive-border bg-destructive-soft px-3 py-2 text-sm text-destructive">
                {analisis.problemas.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{p.mensaje}</span>
                  </li>
                ))}
              </ul>
            ) : analisis.campos.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Al emitir se pedirá:{" "}
                {analisis.campos.map((c) => definicionCampo(c).etiqueta).join(", ")}.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <BloqueoEscritura otroMotivo={cambio ? motivoNoGuardar : null}>
              <Button
                type="submit"
                disabled={!cambio || Boolean(motivoNoGuardar) || guardar.isPending}
              >
                {guardar.isPending && <Loader2 className="animate-spin" aria-hidden />}
                {plantilla
                  ? `Guardar como versión ${(plantilla.version?.numero ?? 0) + 1}`
                  : "Crear plantilla"}
              </Button>
            </BloqueoEscritura>
            {plantilla && cambio && (
              <Button type="button" variant="ghost" onClick={() => setBorrador(original)}>
                Descartar cambios
              </Button>
            )}
            {plantilla && (
              <BloqueoEscritura>
                <Button
                  type="button"
                  variant="outline"
                  disabled={esDemo || activa.isPending}
                  onClick={() => activa.mutate(!plantilla.active)}
                >
                  {plantilla.active ? "Desactivar" : "Activar"}
                </Button>
              </BloqueoEscritura>
            )}
          </div>

          <VariablesInsertables onInsertar={insertar} kind={borrador.kind} />
        </form>

        <div className="min-w-0 space-y-2">
          <p className="kicker">Vista previa con datos de ejemplo</p>
          <HojaDocumento bloques={vista.bloques} resaltar className="text-sm" />
        </div>
      </div>

      {plantilla && (
        <HistorialDeVersiones clinicId={clinicId} templateId={plantilla.id} timezone={timezone} />
      )}
    </div>
  );
}

function VariablesInsertables({
  onInsertar,
  kind,
}: {
  onInsertar: (v: string) => void;
  kind: TipoDeDocumento;
}) {
  const esPresupuesto = kind === "presupuesto";
  return (
    <details className="rounded-md border border-border" open>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Variables para insertar
      </summary>
      <div className="space-y-4 border-t border-border px-3 py-3">
        {(esPresupuesto ? GRUPOS_PRESUPUESTO : GRUPOS).map((g) => (
          <div key={g} className="space-y-1.5">
            <p className="kicker">{ETIQUETA_GRUPO[g]}</p>
            <div className="flex flex-wrap gap-1.5">
              {VARIABLES.filter((v) => v.grupo === g).map((v) => (
                <button
                  key={v.clave}
                  type="button"
                  onClick={() => onInsertar(v.clave)}
                  title={`{{${v.clave}}}`}
                  className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-secondary/50 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {v.etiqueta}
                </button>
              ))}
            </div>
          </div>
        ))}
        {/* El presupuesto no pide campos: se arma solo con sus datos. */}
        {!esPresupuesto && (
          <div className="space-y-1.5">
            <p className="kicker">{ETIQUETA_GRUPO.campo}</p>
            <div className="flex flex-wrap gap-1.5">
              {CAMPOS.map((c) => (
                <button
                  key={c.nombre}
                  type="button"
                  onClick={() => onInsertar(`${PREFIJO_CAMPO}${c.nombre}`)}
                  title={`{{${PREFIJO_CAMPO}${c.nombre}}}`}
                  className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs hover:bg-secondary/50 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {c.etiqueta}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function HistorialDeVersiones({
  clinicId,
  templateId,
  timezone,
}: {
  clinicId: string;
  templateId: string;
  timezone: string;
}) {
  const listar = useServerFn(listVersionesPlantilla);
  const consulta = useQuery({
    queryKey: ["versiones-plantilla", clinicId, templateId],
    queryFn: () => listar({ data: { clinicId, templateId } }),
  });
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <section aria-labelledby="historial-versiones" className="space-y-2">
      <h3 id="historial-versiones" className="kicker flex items-center gap-1.5">
        <History className="size-3.5" aria-hidden /> Versiones
      </h3>
      {consulta.isError ? (
        <p className="text-sm text-muted-foreground">No pudimos cargar las versiones.</p>
      ) : (
        <ul className="divide-y divide-hairline border-y border-border text-sm">
          {(consulta.data ?? []).map((v) => (
            <li key={v.id} className="py-2">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left"
                onClick={() => setAbierta(abierta === v.id ? null : v.id)}
                aria-expanded={abierta === v.id}
              >
                <span className="cifra font-medium">v{v.numero}</span>
                <span className="text-muted-foreground">{fecha(v.createdAt, timezone)}</span>
                <span className="text-muted-foreground">{v.autor ?? "Esmalia"}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {v.usos === 0
                    ? "Sin documentos emitidos"
                    : `${v.usos} documento${v.usos === 1 ? "" : "s"} emitido${v.usos === 1 ? "" : "s"}`}
                </span>
              </button>
              {abierta === v.id && (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/30 p-3 font-mono text-xs">
                  {v.body}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
