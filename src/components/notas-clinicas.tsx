import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  CornerDownRight,
  FilePlus2,
  FileText,
  GitCompare,
  History,
  ListTree,
  Loader2,
  MessageSquare,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  TextQuote,
  Download,
  Trash2,
  UserCheck,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  confirmNoteEntity,
  deleteNoteEntity,
  extractNoteEntities,
  generateNoteText,
  getPatientNotes,
  listNoteReviewers,
  requestNoteReview,
  resolveNoteReview,
  restoreNoteVersion,
  saveClinicalNote,
  signClinicalNote,
  type SaveNoteResult,
} from "@/lib/clinical/clinical-notes.functions";
import { useOfflineMutation } from "@/hooks/use-offline-mutation";
import {
  AI_ACTION_LABELS,
  AUDIT_LABELS,
  ENTITY_KIND_LABELS,
  ENTITY_KIND_ORDER,
  REVIEW_ACTION_LABELS,
  REVIEW_STATUS_LABELS,
  formatoFechaHora,
  lineaDeFirma,
  ordenarConAdendas,
  tituloDeAdenda,
  type ClinicalNoteEntity,
  type NoteReviewStatus,
} from "@/lib/clinical/clinical-notes";
import {
  NOTE_TEMPLATES,
  NOTE_TEMPLATE_SPECIALTIES,
  getNoteTemplate,
} from "@/lib/clinical/note-templates";
import { PattyCara } from "@/components/patty-cara";
import { VersionDiffDialog } from "@/components/version-diff-dialog";
import { DevDiagnosticsPanel } from "@/components/dev-diagnostics-panel";
import { estadoNota, reportarBloqueo } from "@/lib/block-diagnostics";
import type { NoteAction } from "@/lib/clinical/note-permissions";
import { leerRolSimulado } from "@/lib/access/role-simulation";
import { exportarNotaPdf } from "@/lib/clinical/note-pdf";
import { construirContextoPaciente } from "@/lib/ai/minimizacion";
import { getEstadoIa } from "@/lib/ai/estado.functions";
import { MENSAJE_IA_PAUSADA, esErrorIaPausada } from "@/lib/ai/estado";
import { DatosDeFirmaDialog } from "@/components/datos-de-firma-dialog";

import type { ClinicRole } from "@/lib/access/access";
import type { Paciente } from "@/lib/clinic-operations/clinic-data";
import { mensajeDeError } from "@/lib/mensaje-error";
import { useSoloLectura } from "@/hooks/use-solo-lectura";

const REVIEW_BADGE: Record<NoteReviewStatus, string> = {
  none: "border-hairline text-muted-foreground",
  pending: "border-info-border bg-info-soft text-info",
  approved: "border-brand/30 bg-brand-soft text-brand-700",
  changes_requested: "border-destructive/30 bg-destructive/10 text-destructive",
};

/** Acciones de Patty: el violeta del token `ai` marca lo que hace la IA. */
const BOTON_PATTY =
  "inline-flex items-center gap-1.5 rounded-lg border border-ai-border bg-ai-soft px-3 py-1.5 text-xs font-medium text-ai disabled:opacity-50";

type Props = {
  paciente: Paciente;
  clinicId: string | null;
  clinicaNombre?: string;
  puedeEditar: boolean;
  userId?: string | null;
  rol?: ClinicRole | null;
};

export function NotasClinicas({
  paciente,
  clinicId,
  clinicaNombre = "Esmalia",
  puedeEditar,
  userId = null,
  rol = null,
}: Props) {
  const soloLectura = useSoloLectura();
  const queryClient = useQueryClient();
  const fetchNotes = useServerFn(getPatientNotes);
  const saveFn = useServerFn(saveClinicalNote);
  const aiFn = useServerFn(generateNoteText);
  const restoreFn = useServerFn(restoreNoteVersion);
  const signFn = useServerFn(signClinicalNote);
  const structureFn = useServerFn(extractNoteEntities);
  const confirmFn = useServerFn(confirmNoteEntity);
  const deleteEntityFn = useServerFn(deleteNoteEntity);
  const reviewersFn = useServerFn(listNoteReviewers);
  const requestReviewFn = useServerFn(requestNoteReview);
  const resolveReviewFn = useServerFn(resolveNoteReview);
  const estadoIaFn = useServerFn(getEstadoIa);

  // Patty pausada (docs/IA.md): mientras el servidor no tenga AI_ENABLED=true,
  // la sección de Patty muestra "en habilitación" en vez de botones. Si la
  // consulta falla o no llegó, se trata como apagada.
  const { data: estadoIa } = useQuery({
    queryKey: ["estado-ia"],
    queryFn: () => estadoIaFn(),
    staleTime: 5 * 60_000,
  });
  const pattyActiva = estadoIa?.habilitada === true;

  const [noteId, setNoteId] = useState<string | null>(null);
  // CLI-07: adenda en preparación (todavía sin guardar) a esta nota firmada.
  const [adendaDe, setAdendaDe] = useState<string | null>(null);
  // CLI-08: a quien firma le faltan nombre o registro → se le piden.
  const [pedirDatosDeFirma, setPedirDatosDeFirma] = useState<{
    nombreSugerido: string | null;
  } | null>(null);
  // Versión vigente vista al empezar a editar. Viaja en cada guardado offline
  // para que el servidor detecte si alguien más cambió la nota mientras tanto.
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [titulo, setTitulo] = useState("Nota clínica");
  const [contenido, setContenido] = useState("");
  const [resumen, setResumen] = useState<string | null>(null);
  const [aiUsada, setAiUsada] = useState(false);
  const [panel, setPanel] = useState<"versiones" | "auditoria" | "revision">("versiones");
  const [comparar, setComparar] = useState<{
    noteId: string;
    desde: number | null;
    hasta: number | null;
  } | null>(null);
  const [especialidad, setEspecialidad] = useState(NOTE_TEMPLATE_SPECIALTIES[0]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [revisorId, setRevisorId] = useState("");
  const [comentarioRevision, setComentarioRevision] = useState("");

  const queryKey = ["clinical-notes", clinicId, paciente.id];

  const { data, isLoading } = useQuery({
    queryKey,
    enabled: Boolean(clinicId),
    queryFn: () => fetchNotes({ data: { clinicId: clinicId!, patientRef: paciente.id } }),
  });

  const notas = useMemo(() => ordenarConAdendas(data?.notes ?? []), [data]);
  const versiones = useMemo(
    () => (data?.versions ?? []).filter((v) => (noteId ? v.noteId === noteId : true)),
    [data, noteId],
  );
  const entidades = useMemo(
    () => (data?.entities ?? []).filter((e) => (noteId ? e.noteId === noteId : true)),
    [data, noteId],
  );
  const entidadesPorTipo = useMemo(() => {
    const mapa = new Map<string, ClinicalNoteEntity[]>();
    for (const e of entidades) mapa.set(e.kind, [...(mapa.get(e.kind) ?? []), e]);
    return mapa;
  }, [entidades]);
  const auditoria = data?.audit ?? [];
  const notaActual = notas.find((n) => n.id === noteId) ?? null;
  // Nota firmada a la que pertenece la adenda abierta o en preparación.
  const notaCorregida = notas.find((n) => n.id === (notaActual?.addendumOf ?? adendaDe)) ?? null;
  const revisiones = useMemo(
    () => (data?.reviews ?? []).filter((r) => (noteId ? r.noteId === noteId : false)),
    [data, noteId],
  );
  const esSupervisor = rol === "owner" || rol === "admin";
  const esProfesional = esSupervisor || rol === "dentist";
  const esRevisorAsignado = Boolean(userId && notaActual?.reviewerId === userId);
  const esSolicitante = Boolean(userId && notaActual?.reviewRequestedBy === userId);
  const revisionPendiente = notaActual?.reviewStatus === "pending";
  const puedeResolver = revisionPendiente && (esRevisorAsignado || esSupervisor);
  // Firmar queda reservado a doctores/as y administración (regla replicada en la base de datos).
  // Una nota firmada no se reabre: se corrige con una adenda (CLI-07).
  const puedeFirmar = puedeEditar && esProfesional;
  const puedeSolicitarRevision = puedeEditar && esProfesional;

  // Diagnóstico (solo desarrollo): explica un bloqueo con el estado real de la nota.
  const rolSimulado = typeof window !== "undefined" ? leerRolSimulado() : null;
  const autorNota =
    (data?.versions ?? []).find((v) => v.noteId === noteId && v.version === 1)?.authorId ?? null;
  const diagError = (accion: NoteAction) => (e: Error) => {
    toast.error(mensajeDeError(e));
    reportarBloqueo({
      accion,
      estado: estadoNota(notaActual?.status ?? "draft", notaActual?.reviewStatus ?? "none"),
      rolReal: rol,
      rolSimulado,
      esAutor: autorNota ? autorNota === userId : null,
      esRevisor: notaActual ? esRevisorAsignado : null,
      error: e,
    });
  };

  async function exportarPdf() {
    if (!notaActual) {
      toast.error("Guarda la nota antes de exportarla.");
      return;
    }
    try {
      await exportarNotaPdf({
        clinicaNombre,
        pacienteNombre: paciente.nombre,
        pacienteDocumento: paciente.documento,
        nota: notaActual,
        versiones,
        auditoria: auditoria.filter((a) => !a.noteId || a.noteId === notaActual.id),
        entidades,
        adendas: notas.filter((n) => n.addendumOf === notaActual.id),
        notaOriginal: notaCorregida,
      });
      toast.success("PDF generado con versiones y auditoría.");
    } catch {
      toast.error("No pudimos generar el PDF.");
    }
  }

  // Sin nombre ni edad exacta (IA-02): tramo etario, etiquetas y antecedentes.
  const contextoPaciente = construirContextoPaciente({
    edad: paciente.edad,
    etiquetas: paciente.etiquetas,
    ultimaVisita: paciente.ultimaVisita,
    timeline: paciente.timeline,
  });

  /** Error de Patty: si el servidor dice que está pausada, la UI se entera y cambia. */
  const errorDePatty = (e: Error) => {
    if (esErrorIaPausada(e)) {
      queryClient.setQueryData(["estado-ia"], { habilitada: false });
      toast.info(MENSAJE_IA_PAUSADA);
      return;
    }
    diagError("edit")(e);
  };

  function nuevaNota() {
    if (
      contenido.trim() &&
      !confirm(
        "¿Descartar el contenido actual y empezar una nota nueva? Se perderán los apuntes no guardados.",
      )
    ) {
      return;
    }
    setNoteId(null);
    setAdendaDe(null);
    setBaseVersion(null);
    setTitulo("Nota clínica");
    setContenido("");
    setResumen(null);
    setAiUsada(false);
    setTemplateId(null);
  }

  /** CLI-07: empieza una adenda a la nota firmada que está abierta. */
  function nuevaAdenda() {
    if (!notaActual || notaActual.status !== "signed") return;
    setAdendaDe(notaActual.id);
    setNoteId(null);
    setBaseVersion(null);
    setTitulo(tituloDeAdenda(notaActual.title));
    setContenido("");
    setResumen(null);
    setAiUsada(false);
    setTemplateId(null);
  }

  function aplicarPlantilla(id: string) {
    const plantilla = getNoteTemplate(id);
    if (!plantilla) return;
    setTemplateId(id);
    if (!contenido.trim()) {
      setContenido(plantilla.scaffold);
      setTitulo(plantilla.title);
    } else if (
      confirm(
        "¿Reemplazar el contenido actual por la plantilla? Se perderán los apuntes no guardados.",
      )
    ) {
      setContenido(plantilla.scaffold);
      setTitulo(plantilla.title);
    }
  }

  function abrirNota(id: string) {
    const nota = notas.find((n) => n.id === id);
    if (!nota) return;
    if (
      id !== noteId &&
      contenido.trim() &&
      !confirm(
        "¿Abrir esta nota y descartar el contenido actual? Se perderán los apuntes no guardados.",
      )
    ) {
      return;
    }
    setNoteId(nota.id);
    setAdendaDe(null);
    setBaseVersion(nota.version);
    setTitulo(nota.title);
    setContenido(nota.content);
    setResumen(nota.summary);
    setAiUsada(false);
  }

  const guardarOffline = useOfflineMutation<Record<string, unknown>>({
    kind: "guardar-nota",
    userId: userId ?? "",
    ejecutar: (payload) => saveFn({ data: payload as never }),
    invalidar: [queryKey],
    resumen: (payload) => `Nota: ${(payload as { title: string }).title}`,
    identidad: (payload) => (payload as { noteId?: string }).noteId,
    esConflicto: (r) =>
      Boolean(r && typeof r === "object" && (r as { conflict?: boolean }).conflict),
    onExito: (r) => {
      const res = r as SaveNoteResult;
      if (res.conflict) return; // esConflicto ya lo filtra, esto es solo por tipos
      setBaseVersion(res.version);
      setAiUsada(false);
      toast.success(`Nota guardada como v${res.version}`);
    },
  });

  // Sella noteId (generado en el equipo si es alta nueva, para que retomar la
  // edición offline no cree una segunda nota) y baseVersion ANTES de mandar,
  // igual que agendar()/pagar() en la cola de Tanda 3.
  function guardar(aiAction: "draft" | "summary" | "polish" | null) {
    const id = noteId ?? crypto.randomUUID();
    if (!noteId) setNoteId(id);
    guardarOffline.mutar({
      clinicId: clinicId!,
      // Una nota (o adenda) de una ficha fusionada en esta conserva su
      // paciente original (CLI-06): se guarda con el `patient_ref` de la nota.
      patientRef: notaActual?.patientRef ?? notaCorregida?.patientRef ?? paciente.id,
      patientName: paciente.nombre,
      noteId: id,
      addendumOf: noteId ? null : adendaDe,
      title: titulo.trim() || "Nota clínica",
      content: contenido,
      summary: resumen,
      aiAssisted: aiUsada,
      aiAction,
      baseVersion,
    });
  }

  const ia = useMutation({
    mutationFn: (action: "draft" | "summary" | "polish") =>
      aiFn({
        data: {
          clinicId: clinicId!,
          patientRef: paciente.id,
          noteId,
          action,
          input: contenido.trim(),
          context: contextoPaciente,
          templateId,
        },
      }).then((r) => ({ ...r, action })),
    onSuccess: (res) => {
      if (res.action === "summary") setResumen(res.text);
      else setContenido(res.text);
      setAiUsada(true);
      queryClient.invalidateQueries({ queryKey });
      toast.success("Listo. Revisa y ajusta antes de guardar.");
    },
    onError: errorDePatty,
  });

  const restaurar = useMutation({
    mutationFn: (versionId: string) => restoreFn({ data: { versionId } }),
    onSuccess: async (res) => {
      setTitulo(res.title);
      setContenido(res.content);
      setResumen(res.summary ?? "");
      setBaseVersion(res.version);
      await queryClient.invalidateQueries({ queryKey });
      toast.success(`Revertida como borrador v${res.version}`);
    },
    onError: diagError("version"),
  });

  const firmar = useMutation({
    mutationFn: () => signFn({ data: { noteId: noteId! } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setPedirDatosDeFirma({ nombreSugerido: res.nombreSugerido });
        return;
      }
      setPedirDatosDeFirma(null);
      queryClient.invalidateQueries({ queryKey });
      toast.success("Nota firmada");
    },
    onError: diagError("sign"),
  });

  const estructurar = useMutation({
    mutationFn: async () => {
      let id = noteId;
      if (!id) {
        const res = await saveFn({
          data: {
            clinicId: clinicId!,
            patientRef: paciente.id,
            patientName: paciente.nombre,
            noteId: null,
            title: titulo.trim() || "Nota clínica",
            content: contenido,
            summary: resumen,
            aiAssisted: aiUsada,
            aiAction: null,
          },
        });
        id = res.noteId;
        setNoteId(id);
      }
      return structureFn({
        data: {
          clinicId: clinicId!,
          patientRef: paciente.id,
          noteId: id,
          content: contenido,
          replace: true,
        },
      });
    },
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey });
      toast.success(
        res.entities.length
          ? `${res.entities.length} campos estructurados extraídos`
          : "Patty no encontró campos estructurables en la nota.",
      );
    },
    onError: errorDePatty,
  });

  const validar = useMutation({
    mutationFn: (args: { entityId: string; confirmed: boolean }) => confirmFn({ data: args }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: diagError("edit"),
  });

  const borrarCampo = useMutation({
    mutationFn: (entityId: string) => deleteEntityFn({ data: { entityId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: diagError("edit"),
  });

  const { data: revisores = [] } = useQuery({
    queryKey: ["note-reviewers", clinicId],
    enabled: Boolean(clinicId) && puedeEditar,
    queryFn: () => reviewersFn({ data: { clinicId: clinicId! } }),
  });

  const solicitarRevision = useMutation({
    mutationFn: () =>
      requestReviewFn({
        data: {
          noteId: noteId!,
          reviewerId: revisorId,
          comment: comentarioRevision.trim() || null,
        },
      }),
    onSuccess: async () => {
      setComentarioRevision("");
      setPanel("revision");
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Nota enviada a revisión");
    },
    onError: diagError("request_review"),
  });

  const resolverRevision = useMutation({
    mutationFn: (action: "approved" | "changes_requested" | "comment" | "cancelled") =>
      resolveReviewFn({
        data: { noteId: noteId!, action, comment: comentarioRevision.trim() || null },
      }).then((r) => ({ ...r, action })),
    onSuccess: async (res) => {
      setComentarioRevision("");
      await queryClient.invalidateQueries({ queryKey });
      const mensajes: Record<string, string> = {
        approved: "Nota aprobada por el revisor",
        changes_requested: "Se solicitaron cambios: el autor los agrega con una adenda",
        comment: "Comentario registrado",
        cancelled: "Solicitud de revisión cancelada",
      };
      toast.success(mensajes[res.action]);
    },
    onError: diagError("resolve_review"),
  });

  const ocupado =
    ia.isPending || guardarOffline.enCurso || restaurar.isPending || estructurar.isPending;
  // Bloqueada para edición: firmada o en revisión pendiente (también validado por la base de datos).
  const firmada = notaActual?.status === "signed";
  const bloqueada = firmada || revisionPendiente;

  if (!clinicId) {
    return (
      <div className="card-clinical p-6 text-sm text-muted-foreground">
        Configura tu clínica para registrar notas clínicas.
      </div>
    );
  }

  return (
    <div className="card-clinical p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Notas clínicas</h3>
          <p className="text-xs text-muted-foreground">
            {pattyActiva
              ? "Patty (IA) redacta y resume; tú revisas y firmas. Con versiones y auditoría."
              : "Tú escribes y firmas. Con versiones y auditoría."}
          </p>
          {soloLectura && (
            <p className="mt-1 text-xs text-destructive">
              Modo solo lectura: solo puedes registrar y firmar la nota de una cita en curso (desde
              30 minutos antes hasta 2 horas después).
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportarPdf}
            disabled={!notaActual}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium hover:bg-secondary/60 disabled:opacity-50"
          >
            <Download className="size-3" /> Exportar PDF
          </button>
          {puedeEditar && (
            <button
              onClick={nuevaNota}
              className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium hover:bg-secondary/60"
            >
              Nueva nota
            </button>
          )}
        </div>
      </div>

      {notas.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {notas.map((n) => (
            <button
              key={n.id}
              onClick={() => abrirNota(n.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                n.id === noteId
                  ? "border-brand/40 bg-brand-soft text-brand-700"
                  : "border-hairline text-muted-foreground hover:bg-secondary/60"
              }`}
            >
              {n.addendumOf ? (
                <CornerDownRight className="size-3" aria-label="Adenda" />
              ) : (
                <FileText className="size-3" />
              )}
              {n.title}
              <span className="text-[11px] opacity-70">v{n.version}</span>
              {n.patientRef !== paciente.id && (
                <span className="text-[11px] opacity-70">· ficha fusionada</span>
              )}
              {n.status === "signed" && <ShieldCheck className="size-3" />}
              {n.reviewStatus !== "none" && (
                <span
                  className={`rounded-full border px-1.5 text-[11px] ${REVIEW_BADGE[n.reviewStatus]}`}
                >
                  {REVIEW_STATUS_LABELS[n.reviewStatus]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          {puedeEditar && !bloqueada && (
            <div className="rounded-lg border border-hairline p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Plantilla
                </span>
                <select
                  aria-label="Especialidad de la plantilla"
                  value={especialidad}
                  onChange={(e) => setEspecialidad(e.target.value)}
                  className="rounded-lg border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
                >
                  {NOTE_TEMPLATE_SPECIALTIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {templateId && (
                  <button
                    onClick={() => setTemplateId(null)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Quitar plantilla
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {NOTE_TEMPLATES.filter((t) => t.specialty === especialidad).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => aplicarPlantilla(t.id)}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      t.id === templateId
                        ? "border-brand/40 bg-brand-soft text-brand-700"
                        : "border-hairline text-muted-foreground hover:bg-secondary/60"
                    }`}
                  >
                    {t.motivo}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {templateId
                  ? "Patty seguirá esta estructura al redactar o pulir la nota."
                  : "Elige un motivo de consulta para partir desde un formato predefinido."}
              </p>
            </div>
          )}

          {notaCorregida && (
            <p className="rounded-lg border border-info-border bg-info-soft px-3 py-2 text-xs text-info">
              {notaActual ? "Adenda" : "Nueva adenda"} a «{notaCorregida.title}»
              {notaCorregida.signedAt
                ? `, firmada el ${formatoFechaHora(notaCorregida.signedAt)}`
                : ""}
              . La nota original no cambia: esta adenda queda vinculada, con su autor, su fecha y su
              propia firma.
            </p>
          )}
          {firmada && notaActual && (
            <p className="flex items-start gap-1.5 rounded-lg border border-hairline px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3 shrink-0" />
              <span>
                {lineaDeFirma(notaActual)}. Una nota firmada no se edita ni se reabre: para
                corregirla o completarla, agrega una adenda.
              </span>
            </p>
          )}

          <input
            aria-label="Título de la nota"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            disabled={!puedeEditar || bloqueada}
            placeholder="Título de la nota"
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base disabled:opacity-60"
          />
          <textarea
            aria-label="Contenido de la nota"
            value={contenido}
            onChange={(e) => setContenido(e.target.value)}
            disabled={!puedeEditar || bloqueada}
            rows={12}
            placeholder={
              pattyActiva
                ? "Escribe apuntes rápidos (ej: molestia molar 36, sensibilidad al frío, se realiza obturación) y deja que Patty los convierta en una nota SOAP."
                : "Escribe la nota clínica (ej: molestia molar 36, sensibilidad al frío, se realiza obturación)."
            }
            className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base disabled:opacity-60"
          />

          {puedeEditar && !pattyActiva && (
            <p
              role="status"
              className="flex items-center gap-2.5 rounded-xl border border-hairline p-3 text-xs text-muted-foreground"
            >
              <PattyCara px={28} decorativa />
              <span>{MENSAJE_IA_PAUSADA}</span>
            </p>
          )}

          {puedeEditar && pattyActiva && (
            <section
              aria-labelledby="patty-nota-titulo"
              className="rounded-xl border border-hairline p-3"
            >
              <p
                id="patty-nota-titulo"
                className="mb-2.5 flex items-center gap-2.5 text-xs text-muted-foreground"
              >
                <PattyCara px={28} decorativa />
                <span>
                  <span className="font-display text-[1.15em] italic text-ai">Patty</span> puede
                  ayudarte con esta nota
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => ia.mutate("draft")}
                  disabled={ocupado || bloqueada || !contenido.trim()}
                  className={BOTON_PATTY}
                >
                  {ia.isPending && ia.variables === "draft" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <FileText className="size-3" />
                  )}
                  Redactar nota SOAP
                </button>
                <button
                  onClick={() => ia.mutate("polish")}
                  disabled={ocupado || bloqueada || !contenido.trim()}
                  className={BOTON_PATTY}
                >
                  {ia.isPending && ia.variables === "polish" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Wand2 className="size-3" />
                  )}
                  Pulir redacción
                </button>
                <button
                  onClick={() => ia.mutate("summary")}
                  disabled={ocupado || !contenido.trim()}
                  className={BOTON_PATTY}
                >
                  {ia.isPending && ia.variables === "summary" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <TextQuote className="size-3" />
                  )}
                  Resumir
                </button>
                <button
                  onClick={() => estructurar.mutate()}
                  disabled={ocupado || contenido.trim().length < 10}
                  className={BOTON_PATTY}
                >
                  {estructurar.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <ListTree className="size-3" />
                  )}
                  Estructurar campos
                </button>
              </div>
              {aiUsada && (
                <p className="mt-2.5 text-xs text-muted-foreground">
                  Borrador de Patty (IA), sin guardar. Revísalo antes de firmar: la versión quedará
                  marcada como asistida.
                </p>
              )}
            </section>
          )}

          {puedeEditar && (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={() => guardar(aiUsada ? "draft" : null)}
                disabled={ocupado || bloqueada || !contenido.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand bg-transparent px-3 py-1.5 text-xs font-medium text-brand-700 disabled:opacity-50"
              >
                {guardarOffline.enCurso ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Save className="size-3" />
                )}
                Guardar versión
              </button>
              {noteId && !firmada && (
                <button
                  onClick={() => firmar.mutate()}
                  disabled={firmar.isPending || !puedeFirmar}
                  title={
                    !esProfesional
                      ? "Solo un doctor/a o administrador puede firmar la nota"
                      : "Firmada, la nota ya no se edita: las correcciones van en una adenda"
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  {firmar.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-3" />
                  )}
                  Firmar
                </button>
              )}
              {firmada && !notaActual?.addendumOf && (
                <button
                  onClick={nuevaAdenda}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium hover:bg-secondary/60"
                >
                  <FilePlus2 className="size-3" /> Agregar adenda
                </button>
              )}
            </div>
          )}

          {notaActual && (
            <div className="rounded-xl border border-hairline p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <UserCheck className="size-3" /> Revisión y aprobación
                </p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${REVIEW_BADGE[notaActual.reviewStatus]}`}
                >
                  {REVIEW_STATUS_LABELS[notaActual.reviewStatus]}
                </span>
              </div>

              {notaActual.reviewStatus !== "none" && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Revisor: {notaActual.reviewerName ?? "sin asignar"}
                  {notaActual.reviewRequestedByName
                    ? ` · Solicitada por ${notaActual.reviewRequestedByName}`
                    : ""}
                  {notaActual.reviewRequestedAt
                    ? ` · ${formatoFechaHora(notaActual.reviewRequestedAt)}`
                    : ""}
                  {notaActual.reviewedAt
                    ? ` · Resuelta ${formatoFechaHora(notaActual.reviewedAt)}`
                    : ""}
                </p>
              )}

              {puedeSolicitarRevision && !revisionPendiente && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Revisor"
                    value={revisorId}
                    onChange={(e) => setRevisorId(e.target.value)}
                    className="rounded-lg border border-input bg-transparent px-2 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
                  >
                    <option value="">Elegir revisor…</option>
                    {revisores.map((r) => (
                      <option key={r.userId} value={r.userId}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => solicitarRevision.mutate()}
                    disabled={
                      !revisorId || solicitarRevision.isPending || notaActual.status !== "signed"
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium hover:bg-secondary/60 disabled:opacity-50"
                    title={
                      notaActual.status !== "signed"
                        ? "Firma la nota antes de enviarla a revisión"
                        : undefined
                    }
                  >
                    {solicitarRevision.isPending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Send className="size-3" />
                    )}
                    Enviar a revisión
                  </button>
                  {notaActual.status !== "signed" && (
                    <span className="text-xs text-muted-foreground">
                      Firma la nota para poder solicitar aprobación.
                    </span>
                  )}
                  {revisores.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      No hay otros profesionales habilitados como revisores.
                    </span>
                  )}
                </div>
              )}

              {(puedeResolver || esSolicitante || puedeEditar) && (
                <textarea
                  aria-label={revisionPendiente ? "Comentario del revisor" : "Nota para el revisor"}
                  value={comentarioRevision}
                  onChange={(e) => setComentarioRevision(e.target.value)}
                  rows={2}
                  placeholder={
                    revisionPendiente
                      ? "Comentario del revisor (obligatorio al solicitar cambios)"
                      : "Nota para el revisor (opcional)"
                  }
                  className="mt-2 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base"
                />
              )}

              {revisionPendiente && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {puedeResolver && (
                    <>
                      <button
                        onClick={() => resolverRevision.mutate("approved")}
                        disabled={resolverRevision.isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-brand bg-transparent px-3 py-1.5 text-xs font-medium text-brand-700 disabled:opacity-50"
                      >
                        <ShieldCheck className="size-3" /> Aprobar
                      </button>
                      <button
                        onClick={() => resolverRevision.mutate("changes_requested")}
                        disabled={resolverRevision.isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive disabled:opacity-50"
                      >
                        <RotateCcw className="size-3" /> Solicitar cambios
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => resolverRevision.mutate("comment")}
                    disabled={resolverRevision.isPending || !comentarioRevision.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  >
                    <MessageSquare className="size-3" /> Comentar
                  </button>
                  {(esSolicitante || esRevisorAsignado || esSupervisor) && (
                    <button
                      onClick={() => resolverRevision.mutate("cancelled")}
                      disabled={resolverRevision.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground disabled:opacity-50"
                    >
                      <X className="size-3" /> Cancelar solicitud
                    </button>
                  )}
                </div>
              )}

              {notaActual.reviewStatus === "changes_requested" && firmada && (
                <p className="mt-2 text-xs text-muted-foreground">
                  El revisor pidió cambios. La nota firmada no se modifica: agrega los cambios como
                  adenda y envía la adenda a revisión.
                </p>
              )}

              {revisionPendiente && !puedeResolver && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Esperando la aprobación de {notaActual.reviewerName ?? "el revisor asignado"}.
                </p>
              )}
            </div>
          )}

          {resumen && (
            <div className="rounded-xl border border-ai-border/60 bg-ai-soft p-4">
              <p className="mb-2 flex items-center gap-2.5 text-xs font-semibold text-ai">
                <PattyCara px={28} decorativa />
                <span>
                  Resumen de <span className="font-display text-[1.15em] italic">Patty</span>
                </span>
              </p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {resumen}
              </p>
            </div>
          )}

          {entidades.length > 0 && (
            <div className="rounded-xl border border-hairline p-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <ListTree className="size-3" /> Historia clínica estructurada
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {ENTITY_KIND_ORDER.filter((k) => entidadesPorTipo.get(k)?.length).map((kind) => (
                  <div key={kind}>
                    <p className="mb-1.5 text-xs font-medium">{ENTITY_KIND_LABELS[kind]}</p>
                    <ul className="space-y-1.5">
                      {(entidadesPorTipo.get(kind) ?? []).map((e) => (
                        <li
                          key={e.id}
                          className={`group rounded-lg border px-2.5 py-2 text-xs ${
                            e.confirmed ? "border-brand/30 bg-brand-soft" : "border-hairline"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-foreground">
                                {e.term}
                                {e.tooth ? ` · pieza ${e.tooth}` : ""}
                              </p>
                              <p className="text-muted-foreground">
                                {[
                                  e.code ? `Código ${e.code}` : null,
                                  e.dosage,
                                  e.quantity ? `${e.quantity} u.` : null,
                                  e.severity,
                                  e.status,
                                  e.confidence != null
                                    ? `IA ${Math.round(e.confidence * 100)}%`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "Sin detalles adicionales"}
                              </p>
                            </div>
                            {puedeEditar && (
                              <div className="flex shrink-0 gap-1">
                                <button
                                  title={e.confirmed ? "Quitar validación" : "Validar"}
                                  onClick={() =>
                                    validar.mutate({ entityId: e.id, confirmed: !e.confirmed })
                                  }
                                  className={`rounded p-1 hover:bg-secondary ${
                                    e.confirmed ? "text-brand-700" : "text-muted-foreground"
                                  }`}
                                >
                                  <Check className="size-3" />
                                </button>
                                <button
                                  title="Eliminar"
                                  onClick={() => borrarCampo.mutate(e.id)}
                                  className="rounded p-1 text-muted-foreground hover:bg-secondary"
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Campos que extrajo Patty (IA) para búsqueda y facturación. Valídalos antes de
                usarlos en un cobro.
              </p>
            </div>
          )}
        </div>

        <aside className="lg:col-span-2">
          <div className="mb-3 flex gap-1 rounded-lg bg-secondary/60 p-1 text-xs">
            <button
              onClick={() => setPanel("versiones")}
              className={`flex-1 rounded-md px-2 py-1 ${panel === "versiones" ? "bg-background font-medium" : "text-muted-foreground"}`}
            >
              Versiones
            </button>
            <button
              onClick={() => setPanel("revision")}
              className={`flex-1 rounded-md px-2 py-1 ${panel === "revision" ? "bg-background font-medium" : "text-muted-foreground"}`}
            >
              Revisión
            </button>
            <button
              onClick={() => setPanel("auditoria")}
              className={`flex-1 rounded-md px-2 py-1 ${panel === "auditoria" ? "bg-background font-medium" : "text-muted-foreground"}`}
            >
              Auditoría
            </button>
          </div>

          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {isLoading && <p className="text-xs text-muted-foreground">Cargando…</p>}

            {panel === "versiones" &&
              !isLoading &&
              (versiones.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aún no hay versiones guardadas.</p>
              ) : (
                versiones.map((v) => (
                  <div key={v.id} className="rounded-lg border border-hairline p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium">
                        v{v.version} · {v.title}
                      </p>
                      {v.aiAssisted && (
                        <span className="rounded bg-ai-soft px-1.5 py-0.5 text-[11px] text-ai">
                          {AI_ACTION_LABELS[v.aiAction ?? ""] ?? "Patty (IA)"}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {v.authorName ?? "Usuario"} · {formatoFechaHora(v.createdAt)}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{v.preview}</p>
                    <div className="mt-2 flex items-center gap-3">
                      {v.version > 1 && (
                        <button
                          onClick={() =>
                            setComparar({
                              noteId: v.noteId,
                              desde: v.version - 1,
                              hasta: v.version,
                            })
                          }
                          className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                        >
                          <GitCompare className="size-3" /> Comparar con v{v.version - 1}
                        </button>
                      )}
                      {puedeEditar &&
                        notas.find((n) => n.id === v.noteId)?.status !== "signed" &&
                        v.version !== notaActual?.version && (
                          <button
                            onClick={() => {
                              if (
                                window.confirm(
                                  `¿Revertir el contenido a la v${v.version}? Se creará un nuevo borrador y quedará registrado en auditoría.`,
                                )
                              )
                                restaurar.mutate(v.id);
                            }}
                            disabled={restaurar.isPending || revisionPendiente}
                            title={
                              revisionPendiente
                                ? "Resuelve la revisión pendiente antes de revertir"
                                : `Revertir a v${v.version} como nuevo borrador`
                            }
                            className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline disabled:opacity-50"
                          >
                            <RotateCcw className="size-3" /> Revertir a v{v.version}
                          </button>
                        )}
                    </div>
                  </div>
                ))
              ))}

            {panel === "revision" &&
              !isLoading &&
              (revisiones.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {notaActual
                    ? "Esta nota aún no tiene solicitudes de revisión."
                    : "Selecciona o guarda una nota para gestionar su revisión."}
                </p>
              ) : (
                <ol className="relative space-y-3 border-l border-hairline pl-4">
                  {[...revisiones]
                    .sort(
                      (x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime(),
                    )
                    .map((r, i, lista) => {
                      const anterior = lista
                        .slice(0, i)
                        .reverse()
                        .find((p) => p.noteVersion && p.noteVersion !== r.noteVersion);
                      const color =
                        r.action === "approved"
                          ? "bg-brand"
                          : r.action === "changes_requested"
                            ? "bg-destructive"
                            : r.action === "cancelled"
                              ? "bg-muted-foreground"
                              : "bg-info";
                      const etiquetaHito =
                        r.action === "approved"
                          ? "Versión aprobada"
                          : r.action === "changes_requested"
                            ? "Cambios solicitados"
                            : r.action === "requested"
                              ? "Borrador enviado a revisión"
                              : null;
                      return (
                        <li key={r.id} className="relative rounded-lg border border-hairline p-3">
                          <span
                            className={`absolute -left-[21px] top-4 size-2.5 rounded-full ring-2 ring-background ${color}`}
                          />
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium">{REVIEW_ACTION_LABELS[r.action]}</p>
                            {r.noteVersion != null && (
                              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium">
                                v{r.noteVersion}
                              </span>
                            )}
                          </div>
                          {etiquetaHito && (
                            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                              {etiquetaHito}
                            </p>
                          )}
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {r.actorName ?? "Usuario"} · {formatoFechaHora(r.createdAt)}
                            {r.reviewerName ? ` · Revisor: ${r.reviewerName}` : ""}
                          </p>
                          {r.comment && (
                            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">
                              {r.comment}
                            </p>
                          )}
                          {anterior?.noteVersion && r.noteVersion && (
                            <button
                              onClick={() =>
                                setComparar({
                                  noteId: r.noteId,
                                  desde: anterior.noteVersion,
                                  hasta: r.noteVersion,
                                })
                              }
                              className="mt-2 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                            >
                              <GitCompare className="size-3" /> Comparar v{anterior.noteVersion} → v
                              {r.noteVersion}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  {versiones.length > 0 && notaActual && (
                    <li className="relative rounded-lg border border-brand/30 bg-brand-soft p-3">
                      <span className="absolute -left-[21px] top-4 size-2.5 rounded-full bg-brand ring-2 ring-background" />
                      <p className="text-xs font-medium">Versión final · v{notaActual.version}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Contenido vigente de la nota
                      </p>
                    </li>
                  )}
                </ol>
              ))}

            {panel === "auditoria" &&
              !isLoading &&
              (auditoria.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin actividad registrada.</p>
              ) : (
                auditoria.map((a) => (
                  <div key={a.id} className="flex gap-2 rounded-lg border border-hairline p-3">
                    <History className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-xs font-medium">{AUDIT_LABELS[a.action] ?? a.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.actorName ?? "Usuario"} · {formatoFechaHora(a.createdAt)}
                        {a.detail ? ` · ${a.detail}` : ""}
                      </p>
                    </div>
                  </div>
                ))
              ))}
          </div>
        </aside>
      </div>

      <DevDiagnosticsPanel />

      <DatosDeFirmaDialog
        abierto={pedirDatosDeFirma !== null}
        clinicId={clinicId}
        nombreSugerido={pedirDatosDeFirma?.nombreSugerido ?? null}
        onCerrar={() => setPedirDatosDeFirma(null)}
        onGuardado={() => {
          setPedirDatosDeFirma(null);
          firmar.mutate();
        }}
      />

      {comparar && clinicId && versiones.length > 0 && (
        <VersionDiffDialog
          clinicId={clinicId}
          noteId={comparar.noteId}
          versiones={versiones.filter((v) => v.noteId === comparar.noteId)}
          desde={comparar.desde}
          hasta={comparar.hasta}
          onClose={() => setComparar(null)}
        />
      )}
    </div>
  );
}
