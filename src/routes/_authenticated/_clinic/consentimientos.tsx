import { useId, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, FileSignature, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  createConsentTemplate,
  listConsentTemplates,
  setConsentTemplateActive,
  setConsentTemplateReviewed,
  updateConsentTemplate,
  type ConsentTemplate,
} from "@/lib/clinical/clinical-documents.functions";
import {
  AVISO_MODELO,
  ETIQUETA_ESTADO_PLANTILLA,
  estadoPlantilla,
} from "@/lib/clinical/consentimientos";
import { requirePermission } from "@/lib/access/route-guards";
import { mensajeDeError } from "@/lib/mensaje-error";

function inputClass() {
  return "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";
}

export const Route = createFileRoute("/_authenticated/_clinic/consentimientos")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Consentimientos | Esmalia" },
      {
        name: "description",
        content: "Textos reutilizables para consentimientos informados que el paciente firma.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConsentimientosPage,
});

type PlantillaForm = {
  title: string;
  procedure: string;
  body: string;
  risks: string;
  alternatives: string;
};

const FORM_VACIO: PlantillaForm = {
  title: "",
  procedure: "",
  body: "",
  risks: "",
  alternatives: "",
};

function PlantillaDialog({
  clinicId,
  plantilla,
}: {
  clinicId: string;
  /** Sin plantilla: crear. Con plantilla: editar (no cambia lo ya firmado). */
  plantilla?: ConsentTemplate;
}) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PlantillaForm>(FORM_VACIO);
  const queryClient = useQueryClient();
  const createFn = useServerFn(createConsentTemplate);
  const updateFn = useServerFn(updateConsentTemplate);

  function abrir(next: boolean) {
    setOpen(next);
    if (next) {
      setForm(
        plantilla
          ? {
              title: plantilla.title,
              procedure: plantilla.procedure ?? plantilla.title,
              body: plantilla.body,
              risks: plantilla.risks ?? "",
              alternatives: plantilla.alternatives ?? "",
            }
          : FORM_VACIO,
      );
    }
  }

  const guardar = useMutation({
    mutationFn: () =>
      plantilla
        ? updateFn({ data: { clinicId, templateId: plantilla.id, ...form } })
        : createFn({ data: { clinicId, ...form } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consent-templates-admin", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["consent-templates", clinicId] });
      toast.success(plantilla ? "Plantilla actualizada." : "Plantilla creada.");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const campo = (k: keyof PlantillaForm) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value })),
    className: inputClass(),
  });

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger asChild>
        {plantilla ? (
          <Button size="sm" variant="outline">
            <Pencil className="size-3.5" /> Editar
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="size-4" /> Nueva plantilla
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {plantilla ? "Editar plantilla de consentimiento" : "Nueva plantilla de consentimiento"}
          </DialogTitle>
          <DialogDescription>
            El texto queda disponible al firmar en la ficha del paciente. Editar la plantilla
            después no cambia lo que ya se firmó.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-titulo`}>Título</Label>
              <input
                id={`${fid}-titulo`}
                {...campo("title")}
                placeholder="Ej. Consentimiento para exodoncia"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-procedimiento`}>Procedimiento</Label>
              <input
                id={`${fid}-procedimiento`}
                {...campo("procedure")}
                placeholder="Ej. Exodoncia (extracción dental)"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-texto`}>Descripción y declaración</Label>
            <textarea
              id={`${fid}-texto`}
              {...campo("body")}
              rows={8}
              placeholder="Explica el procedimiento, sus beneficios y los cuidados posteriores…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-riesgos`}>Riesgos</Label>
            <textarea id={`${fid}-riesgos`} {...campo("risks")} rows={4} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-alternativas`}>Alternativas</Label>
            <textarea id={`${fid}-alternativas`} {...campo("alternatives")} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => guardar.mutate()}
            disabled={
              guardar.isPending ||
              form.title.trim().length < 2 ||
              form.procedure.trim().length < 2 ||
              form.body.trim().length < 10
            }
          >
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Guardar plantilla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConsentimientosPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const fetchTemplates = useServerFn(listConsentTemplates);
  const toggleActive = useServerFn(setConsentTemplateActive);
  const toggleReviewed = useServerFn(setConsentTemplateReviewed);
  const queryClient = useQueryClient();
  const [abiertaId, setAbiertaId] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["consent-templates-admin", clinicId],
    queryFn: () => fetchTemplates({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["consent-templates-admin", clinicId] });
    queryClient.invalidateQueries({ queryKey: ["consent-templates", clinicId] });
  };

  const toggleMutation = useMutation({
    mutationFn: (params: { templateId: string; active: boolean }) =>
      toggleActive({ data: { clinicId: clinicId!, ...params } }),
    onSuccess: invalidar,
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const reviewMutation = useMutation({
    mutationFn: (params: { templateId: string; reviewed: boolean }) =>
      toggleReviewed({ data: { clinicId: clinicId!, ...params } }),
    onSuccess: (_d, params) => {
      invalidar();
      toast.success(params.reviewed ? "Plantilla marcada como revisada." : "Marca quitada.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (!clinicId) {
    return (
      <AppShell title="Consentimientos" access={access}>
        <p className="text-muted-foreground">Necesitas una clínica activa.</p>
      </AppShell>
    );
  }

  const templates = templatesQuery.data ?? [];
  const modelosSinRevisar = templates.filter(
    (t) => estadoPlantilla(t) === "modelo-sin-revisar",
  ).length;

  return (
    <AppShell title="Consentimientos" access={access}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">
            Plantillas de {access.clinic?.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {templatesQuery.isError
              ? "Se firman desde la ficha de cada paciente."
              : `${templates.length} plantilla${templates.length === 1 ? "" : "s"}. Se firman desde la ficha de cada paciente.`}
          </p>
        </div>
        <PlantillaDialog clinicId={clinicId} />
      </div>

      {modelosSinRevisar > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {modelosSinRevisar === 1
              ? "Hay 1 plantilla modelo sin revisar."
              : `Hay ${modelosSinRevisar} plantillas modelo sin revisar.`}{" "}
            {AVISO_MODELO}
          </span>
        </p>
      )}

      {templatesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : templatesQuery.isError ? (
        <ErrorDeCarga
          onReintentar={templatesQuery.refetch}
          mensaje="No pudimos cargar las plantillas."
        />
      ) : templates.length === 0 ? (
        <div className="card-clinical p-8 text-center text-sm text-muted-foreground">
          <FileSignature className="mx-auto mb-3 size-6" />
          Todavía no hay plantillas. Puedes firmar consentimientos redactando el texto en el momento
          desde la ficha del paciente, o crear una plantilla aquí para reusar.
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => {
            const estado = estadoPlantilla(t);
            const abierta = abiertaId === t.id;
            return (
              <div key={t.id} className="card-clinical p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{t.title}</h3>
                      <Badge variant={t.active ? "default" : "secondary"}>
                        {t.active ? "Activa" : "Inactiva"}
                      </Badge>
                      {estado !== "propia" && (
                        <Badge variant={estado === "modelo-sin-revisar" ? "warning" : "success"}>
                          {ETIQUETA_ESTADO_PLANTILLA[estado]}
                        </Badge>
                      )}
                    </div>
                    {t.procedure && <p className="mt-0.5 text-xs">{t.procedure}</p>}
                    {!abierta && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.body}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={abierta}
                      onClick={() => setAbiertaId(abierta ? null : t.id)}
                    >
                      {abierta ? "Ocultar" : "Ver texto"}
                    </Button>
                    <PlantillaDialog clinicId={clinicId} plantilla={t} />
                    {t.source === "esmalia_model" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          reviewMutation.mutate({ templateId: t.id, reviewed: !t.reviewedAt })
                        }
                        disabled={reviewMutation.isPending}
                      >
                        {t.reviewedAt ? "Quitar revisada" : "Marcar revisada"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleMutation.mutate({ templateId: t.id, active: !t.active })}
                      disabled={toggleMutation.isPending}
                    >
                      {t.active ? "Desactivar" : "Activar"}
                    </Button>
                  </div>
                </div>
                {abierta && (
                  <div className="mt-3 space-y-2 border-t border-hairline pt-3 text-sm whitespace-pre-line">
                    <p>{t.body}</p>
                    {t.risks && (
                      <p>
                        <span className="font-medium">Riesgos: </span>
                        {t.risks}
                      </p>
                    )}
                    {t.alternatives && (
                      <p>
                        <span className="font-medium">Alternativas: </span>
                        {t.alternatives}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
