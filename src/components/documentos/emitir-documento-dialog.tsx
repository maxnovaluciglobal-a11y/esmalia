import { useEffect, useId, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { HojaDocumento } from "@/components/documentos/hoja-documento";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import {
  emitirDocumentoDelPaciente,
  getDatosParaEmitir,
  listPlantillasDocumento,
} from "@/lib/documentos/documentos.functions";
import {
  analizarPlantilla,
  bloqueDeFirma,
  folioDocumento,
  renderPlantilla,
} from "@/lib/documentos/motor";
import { periodoValido } from "@/lib/documentos/reembolso";
import {
  ETIQUETA_TIPO_DE_DOCUMENTO,
  TIPOS_SIN_EMISION_DESDE_LA_FICHA,
} from "@/lib/documentos/tipos";
import {
  construirContexto,
  definicionCampo,
  definicionVariable,
  nombreDeCampo,
} from "@/lib/documentos/variables";
import { mensajeDeError } from "@/lib/mensaje-error";

function inputClass() {
  return "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";
}

/** "2026-10-22" + 2 días de reposo → "2026-10-23" (ambos inclusive). */
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Valores iniciales razonables para los campos de fecha. */
function valoresIniciales(campos: readonly string[], hoy: string): Record<string, string> {
  const v: Record<string, string> = {};
  for (const c of campos) {
    if (c === "fecha_atencion" || c === "fecha_alta" || c === "reposo_desde") v[c] = hoy;
    if (c === "periodo_desde") v[c] = `${hoy.slice(0, 8)}01`;
    if (c === "periodo_hasta") v[c] = hoy;
  }
  return v;
}

/**
 * Emitir un documento desde la ficha (DOC-01): elegir la plantilla,
 * completar lo que pide, ver la vista previa con los datos reales y emitir.
 * La vista previa usa el mismo motor que el servidor; lo que se guarda lo
 * arma el servidor de nuevo.
 */
export function EmitirDocumentoDialog({
  abierto,
  onCerrar,
  clinicId,
  patientId,
  timezone,
}: {
  abierto: boolean;
  onCerrar: () => void;
  clinicId: string;
  patientId: string;
  timezone: string;
}) {
  const fid = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listar = useServerFn(listPlantillasDocumento);
  const cargarDatos = useServerFn(getDatosParaEmitir);
  const emitir = useServerFn(emitirDocumentoDelPaciente);
  const hoy = hoyISO(timezone);

  const plantillas = useQuery({
    queryKey: ["plantillas-documento", clinicId],
    queryFn: () => listar({ data: { clinicId } }),
    enabled: abierto,
  });
  // El presupuesto se descarga o se envía desde el presupuesto (PLA-08).
  const activas = (plantillas.data ?? []).filter(
    (p) => p.active && p.version && !TIPOS_SIN_EMISION_DESDE_LA_FICHA.includes(p.kind),
  );

  const [templateId, setTemplateId] = useState<string>("");
  const plantilla = activas.find((p) => p.id === templateId) ?? null;
  const cuerpo = plantilla?.version?.body ?? "";
  const analisis = useMemo(() => analizarPlantilla(cuerpo), [cuerpo]);
  const [campos, setCampos] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!abierto) return;
    setTemplateId("");
    setCampos({});
  }, [abierto]);
  useEffect(() => {
    setCampos(valoresIniciales(analisis.campos, hoy));
  }, [templateId, analisis.campos, hoy]);

  const usaReembolso = analisis.variables.some((v) => v.startsWith("reembolso."));
  const periodo =
    usaReembolso && periodoValido(campos.periodo_desde, campos.periodo_hasta)
      ? { periodoDesde: campos.periodo_desde, periodoHasta: campos.periodo_hasta }
      : {};
  const datos = useQuery({
    queryKey: ["datos-para-emitir", clinicId, patientId, periodo],
    queryFn: () => cargarDatos({ data: { clinicId, patientId, ...periodo } }),
    enabled: abierto && Boolean(plantilla),
    staleTime: 30_000,
  });

  const vista = useMemo(() => {
    if (!plantilla || !datos.data) return null;
    const contexto = construirContexto({ ...datos.data.datos, campos });
    const prof = datos.data.datos.profesional;
    return renderPlantilla(cuerpo, contexto, { firma: prof ? bloqueDeFirma(prof) : null });
  }, [plantilla, datos.data, campos, cuerpo]);

  const profesional = datos.data?.profesional ?? null;
  const faltanCampos = analisis.campos.filter(
    (c) => !definicionCampo(c).opcional && !(campos[c] ?? "").trim(),
  );
  const sinDatoEnFicha = (vista?.faltantes ?? []).filter((v) => !nombreDeCampo(v));
  const periodoInvalido =
    usaReembolso && !periodoValido(campos.periodo_desde, campos.periodo_hasta);

  const motivo = !plantilla
    ? "Elige una plantilla."
    : analisis.problemas.length
      ? "La plantilla tiene errores: corrígela en Ajustes → Plantillas de documentos."
      : datos.isLoading
        ? "Cargando los datos de la ficha…"
        : !profesional
          ? "Para emitir necesitas una ficha de profesional vinculada a tu usuario."
          : !profesional.registro
            ? "Carga tu registro de la Superintendencia de Salud en Preferencias."
            : periodoInvalido
              ? "Revisa el período: la fecha de inicio no puede ser posterior a la de término."
              : faltanCampos.length
                ? `Completa: ${faltanCampos.map((c) => definicionCampo(c).etiqueta).join(", ")}.`
                : null;

  const mut = useMutation({
    mutationFn: () => emitir({ data: { clinicId, patientId, templateId, campos } }),
    onSuccess: async (r) => {
      toast.success(`Documento emitido: ${folioDocumento(r.year, r.number)}.`);
      await queryClient.invalidateQueries({ queryKey: ["documentos-emitidos", clinicId] });
      onCerrar();
      void navigate({ to: "/documentos/$documentoId", params: { documentoId: r.id } });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  function cambiarCampo(nombre: string, valor: string) {
    setCampos((prev) => {
      const next = { ...prev, [nombre]: valor };
      // Reposo: si hay días y fecha de inicio, se propone la de término.
      if (
        (nombre === "dias_reposo" || nombre === "reposo_desde") &&
        analisis.campos.includes("reposo_hasta")
      ) {
        const dias = Number.parseInt(next.dias_reposo ?? "", 10);
        if (next.reposo_desde && Number.isFinite(dias) && dias > 0 && dias < 366) {
          next.reposo_hasta = sumarDias(next.reposo_desde, dias - 1);
        }
      }
      return next;
    });
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && !mut.isPending && onCerrar()}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Emitir documento</DialogTitle>
          <DialogDescription>
            Con los datos de la ficha y tu firma. Una vez emitido no se edita: si hay un error, se
            anula con el motivo y se emite otro.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <form
            id={`${fid}-form`}
            className="min-w-0 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!motivo) mut.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-plantilla`}>Documento</Label>
              <select
                id={`${fid}-plantilla`}
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              >
                <option value="">
                  {plantillas.isLoading ? "Cargando…" : "Elige una plantilla"}
                </option>
                {activas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              {plantilla && (
                <p className="text-xs text-muted-foreground">
                  {ETIQUETA_TIPO_DE_DOCUMENTO[plantilla.kind]} · versión {plantilla.version?.numero}
                  {plantilla.description ? ` · ${plantilla.description}` : ""}
                </p>
              )}
              {plantillas.isError && (
                <p className="text-xs text-destructive">No pudimos cargar las plantillas.</p>
              )}
            </div>

            {analisis.campos.map((c) => {
              const def = definicionCampo(c);
              const id = `${fid}-campo-${c}`;
              const comun = {
                id,
                value: campos[c] ?? "",
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                  cambiarCampo(c, e.target.value),
              };
              return (
                <div key={c} className="space-y-1.5">
                  <Label htmlFor={id}>
                    {def.etiqueta}
                    {def.opcional && (
                      <span className="font-normal text-muted-foreground"> (opcional)</span>
                    )}
                  </Label>
                  {def.tipo === "texto_largo" ? (
                    <textarea {...comun} rows={3} maxLength={4000} className={inputClass()} />
                  ) : def.tipo === "fecha" ? (
                    <Input {...comun} type="date" className="cifra" />
                  ) : def.tipo === "numero" ? (
                    <Input
                      {...comun}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={365}
                      className="cifra"
                    />
                  ) : (
                    <Input {...comun} maxLength={300} />
                  )}
                </div>
              );
            })}

            {plantilla && profesional && !profesional.tieneFirma && (
              <p className="flex gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-xs">
                <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  No tienes una imagen de firma: el documento sale con tu nombre y registro, y una
                  línea para firmar a mano.{" "}
                  <Link to="/preferencias" className="font-medium underline">
                    Cargar mi firma
                  </Link>
                </span>
              </p>
            )}
            {plantilla && profesional?.registro && !profesional.registroEsSis && (
              <p className="text-xs text-muted-foreground">
                Se imprime tu registro profesional ({profesional.registro}). Puedes cargar el de la
                Superintendencia de Salud en Preferencias.
              </p>
            )}
            {sinDatoEnFicha.length > 0 && (
              <div className="rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-xs">
                <p className="font-medium">
                  Sin dato en la ficha (sale una línea para completar a mano):
                </p>
                <p>{sinDatoEnFicha.map((v) => definicionVariable(v)?.etiqueta ?? v).join(", ")}</p>
              </div>
            )}
          </form>

          <div className="min-w-0 space-y-2">
            <p className="kicker">Vista previa</p>
            {!plantilla ? (
              <p className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                Elige una plantilla para ver el documento con los datos del paciente.
              </p>
            ) : datos.isError ? (
              <p className="text-sm text-destructive">{mensajeDeError(datos.error)}</p>
            ) : !vista ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando la ficha…
              </p>
            ) : (
              <HojaDocumento
                bloques={vista.bloques}
                firmaUrl={profesional?.firmaUrl ?? null}
                resaltar
                className="text-sm"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCerrar} disabled={mut.isPending}>
            Cancelar
          </Button>
          <BloqueoEscritura otroMotivo={plantilla ? motivo : null}>
            <Button type="submit" form={`${fid}-form`} disabled={Boolean(motivo) || mut.isPending}>
              {mut.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Emitir y firmar
            </Button>
          </BloqueoEscritura>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
