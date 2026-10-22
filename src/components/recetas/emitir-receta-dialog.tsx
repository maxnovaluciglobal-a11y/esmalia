import { useEffect, useId, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BookmarkPlus, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { HojaDocumento } from "@/components/documentos/hoja-documento";
import { CampoMedicamento } from "@/components/recetas/campo-medicamento";
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
import {
  emitirRecetaDelPaciente,
  getDatosParaReceta,
  guardarMedicamentoClinica,
} from "@/lib/clinical/prescriptions.functions";
import {
  estructurarItem,
  RecetaMedicamentoEntradaSchema,
  type RecetaMedicamentoEntrada,
} from "@/lib/clinical/receta-estructurada";
import { alertasDeAlergia, grupoDe, MAX_MEDICAMENTOS } from "@/lib/clinical/recetas";
import {
  ETIQUETA_VIA,
  medicamentoBase,
  presentacionDe,
  VADEMECUM_BASE,
  VIAS,
  type MedicamentoVademecum,
  type ViaAdministracion,
} from "@/lib/clinical/vademecum";
import {
  analizarPlantilla,
  bloqueDeFirma,
  folioDocumento,
  renderPlantilla,
} from "@/lib/documentos/motor";
import { construirContexto, definicionCampo, definicionVariable } from "@/lib/documentos/variables";
import { mensajeDeError } from "@/lib/mensaje-error";

function inputClass() {
  return "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";
}

type Fila = RecetaMedicamentoEntrada & { route: ViaAdministracion };

const FILA_VACIA: Fila = {
  medication: "",
  presentation: "",
  route: "oral",
  dose: "",
  frequency: "",
  duration: "",
  instructions: "",
  catalog: "",
};

function filaDesde(m: MedicamentoVademecum): Fila {
  return {
    medication: m.principioActivo,
    presentation: presentacionDe(m),
    route: m.via,
    dose: m.dosis,
    frequency: m.frecuencia,
    duration: m.duracion,
    instructions: m.indicaciones ?? "",
    catalog: m.codigo,
  };
}

/**
 * Emitir una receta desde la ficha (MKT-05): medicamentos con autocompletado
 * del vademécum y posología sugerida editable, aviso de alergias, vista
 * previa con la plantilla "Receta" del motor y emisión con tu firma y tu
 * registro de la Superintendencia de Salud. Lo que se guarda lo arma el
 * servidor de nuevo con los mismos datos.
 */
export function EmitirRecetaDialog({
  abierto,
  onCerrar,
  clinicId,
  patientId,
}: {
  abierto: boolean;
  onCerrar: () => void;
  clinicId: string;
  patientId: string;
}) {
  const fid = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cargar = useServerFn(getDatosParaReceta);
  const emitir = useServerFn(emitirRecetaDelPaciente);
  const guardarEnVademecum = useServerFn(guardarMedicamentoClinica);

  const datos = useQuery({
    queryKey: ["datos-para-receta", clinicId, patientId],
    queryFn: () => cargar({ data: { clinicId, patientId } }),
    enabled: abierto,
    staleTime: 30_000,
  });

  const [filas, setFilas] = useState<Fila[]>([{ ...FILA_VACIA }]);
  const [indicaciones, setIndicaciones] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [confirmaAlergias, setConfirmaAlergias] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setFilas([{ ...FILA_VACIA }]);
    setIndicaciones("");
    setTemplateId("");
    setCampos({});
    setConfirmaAlergias(false);
  }, [abierto]);

  const plantillas = (datos.data?.plantillas ?? []).filter((p) => p.version);
  const plantilla = plantillas.find((p) => p.id === templateId) ?? plantillas[0] ?? null;
  const cuerpo = plantilla?.version?.body ?? "";
  const analisis = useMemo(() => analizarPlantilla(cuerpo), [cuerpo]);

  const vademecum = useMemo(
    () => [...(datos.data?.vademecumClinica ?? []), ...VADEMECUM_BASE],
    [datos.data?.vademecumClinica],
  );
  const porCodigo = useMemo(() => new Map(vademecum.map((m) => [m.codigo, m])), [vademecum]);
  const alergias = useMemo(() => datos.data?.alergias ?? [], [datos.data?.alergias]);

  // La misma fila que guardará el servidor (para la vista previa y los avisos).
  const items = useMemo(
    () =>
      filas.map((f) =>
        estructurarItem(
          f,
          f.catalog ? (medicamentoBase(f.catalog) ?? porCodigo.get(f.catalog) ?? null) : null,
          grupoDe,
        ),
      ),
    [filas, porCodigo],
  );
  const avisosPorFila = items.map((it) => alertasDeAlergia(it.medication, alergias, it.group));
  const hayAvisos = avisosPorFila.some((a) => a.length > 0);

  const vista = useMemo(() => {
    if (!plantilla || !datos.data) return null;
    const contexto = construirContexto({
      ...datos.data.datos,
      campos,
      receta: {
        // La vista previa no muestra filas todavía vacías.
        items: items.filter((it) => it.medication.trim()),
        indicacionesGenerales: indicaciones.trim() || null,
        alergias,
      },
    });
    const prof = datos.data.datos.profesional;
    return renderPlantilla(cuerpo, contexto, { firma: prof ? bloqueDeFirma(prof) : null });
  }, [plantilla, datos.data, campos, items, indicaciones, alergias, cuerpo]);

  const profesional = datos.data?.profesional ?? null;
  const validacion = RecetaMedicamentoEntradaSchema.array()
    .min(1, "Agrega al menos un medicamento.")
    .safeParse(filas);
  const faltanCampos = analisis.campos.filter(
    (c) => !definicionCampo(c).opcional && !(campos[c] ?? "").trim(),
  );
  const sinDatoEnFicha = (vista?.faltantes ?? []).filter((v) => !v.startsWith("campo."));

  const motivo = datos.isLoading
    ? "Cargando los datos de la ficha…"
    : datos.isError
      ? "No pudimos cargar la ficha."
      : !plantilla
        ? "Tu clínica no tiene una plantilla de receta activa (Ajustes → Plantillas de documentos)."
        : analisis.problemas.length
          ? "La plantilla de receta tiene errores: corrígela en Ajustes → Plantillas de documentos."
          : !profesional
            ? "Para recetar necesitas una ficha de profesional vinculada a tu usuario."
            : datos.data?.exigeSis && !profesional.registroSis
              ? "Carga tu registro de la Superintendencia de Salud en Preferencias para recetar."
              : !profesional.registro
                ? "Carga tu registro profesional en Preferencias para recetar."
                : !validacion.success
                  ? (validacion.error.issues[0]?.message ?? "Revisa los medicamentos.")
                  : faltanCampos.length
                    ? `Completa: ${faltanCampos.map((c) => definicionCampo(c).etiqueta).join(", ")}.`
                    : hayAvisos && !confirmaAlergias
                      ? "Confirma que revisaste las alergias."
                      : null;

  const mut = useMutation({
    mutationFn: () =>
      emitir({
        data: {
          clinicId,
          patientId,
          templateId: plantilla?.id,
          items: filas,
          indicaciones,
          campos,
          alergiasConfirmadas: confirmaAlergias,
        },
      }),
    onSuccess: async (r) => {
      toast.success(`Receta emitida: ${folioDocumento(r.year, r.number)}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["patient-prescriptions", clinicId] }),
        queryClient.invalidateQueries({ queryKey: ["documentos-emitidos", clinicId] }),
      ]);
      onCerrar();
      void navigate({ to: "/documentos/$documentoId", params: { documentoId: r.documentId } });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const guardarMut = useMutation({
    mutationFn: (f: Fila) =>
      guardarEnVademecum({
        data: {
          clinicId,
          principioActivo: f.medication,
          // La presentación se guarda como concentración: es texto libre.
          concentracion: f.presentation?.slice(0, 60) ?? "",
          forma: "",
          grupo: grupoDe(f.medication),
          via: f.route,
          dosis: f.dose,
          frecuencia: f.frequency,
          duracion: f.duration,
          indicaciones: f.instructions ?? "",
        },
      }),
    onSuccess: async ({ id }, f) => {
      toast.success(`${f.medication} quedó en el vademécum de la clínica.`);
      setFilas((prev) => prev.map((x) => (x === f ? { ...x, catalog: `clinica:${id}` } : x)));
      await queryClient.invalidateQueries({ queryKey: ["datos-para-receta", clinicId] });
      await queryClient.invalidateQueries({ queryKey: ["vademecum-clinica", clinicId] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  function cambiar(i: number, cambios: Partial<Fila>) {
    setFilas((prev) => prev.map((f, j) => (j === i ? { ...f, ...cambios } : f)));
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && !mut.isPending && onCerrar()}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva receta</DialogTitle>
          <DialogDescription>
            Sale con los datos del paciente, tu registro de la Superintendencia de Salud y tu firma.
            Las dosis del vademécum son sugerencias: revísalas para este paciente. Una vez emitida
            no se edita; si hay un error, se anula con el motivo y se emite otra.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <form
            id={`${fid}-form`}
            className="min-w-0 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!motivo) mut.mutate();
            }}
          >
            {alergias.length > 0 ? (
              <p
                role="status"
                className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  <span className="font-medium">Alergias anotadas:</span> {alergias.join(", ")}.
                </span>
              </p>
            ) : (
              datos.data && (
                <p className="text-xs text-muted-foreground">
                  No hay alergias anotadas en la anamnesis de este paciente.
                </p>
              )
            )}

            {plantillas.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor={`${fid}-plantilla`}>Plantilla</Label>
                <select
                  id={`${fid}-plantilla`}
                  value={plantilla?.id ?? ""}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
                >
                  {plantillas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {filas.map((f, i) => {
              const avisos = avisosPorFila[i] ?? [];
              const id = (campo: string) => `${fid}-${campo}-${i}`;
              const deLaClinica = f.catalog?.startsWith("clinica:") ?? false;
              return (
                <fieldset
                  key={i}
                  className="space-y-3 rounded-lg border border-hairline p-3"
                  aria-describedby={avisos.length ? id("avisos") : undefined}
                >
                  <div className="flex items-center justify-between gap-2">
                    <legend className="text-sm font-medium">Medicamento {i + 1}</legend>
                    {filas.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Quitar medicamento ${i + 1}`}
                        onClick={() => setFilas((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor={id("med")}>Medicamento (principio activo)</Label>
                      <CampoMedicamento
                        id={id("med")}
                        valor={f.medication}
                        vademecum={vademecum}
                        className={inputClass()}
                        onEscribir={(texto) => cambiar(i, { medication: texto })}
                        onElegir={(m) => cambiar(i, filaDesde(m))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={id("pres")}>Presentación</Label>
                      <input
                        id={id("pres")}
                        value={f.presentation ?? ""}
                        onChange={(e) => cambiar(i, { presentation: e.target.value })}
                        className={inputClass()}
                        placeholder="Ej. 500 mg cápsulas"
                        maxLength={120}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={id("via")}>Vía</Label>
                      <select
                        id={id("via")}
                        value={f.route}
                        onChange={(e) => cambiar(i, { route: e.target.value as ViaAdministracion })}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
                      >
                        {VIAS.map((v) => (
                          <option key={v} value={v}>
                            {ETIQUETA_VIA[v]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={id("dosis")}>Dosis</Label>
                      <input
                        id={id("dosis")}
                        value={f.dose}
                        onChange={(e) => cambiar(i, { dose: e.target.value })}
                        className={inputClass()}
                        placeholder="Ej. 1 cápsula"
                        maxLength={120}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={id("frec")}>Frecuencia</Label>
                      <input
                        id={id("frec")}
                        value={f.frequency}
                        onChange={(e) => cambiar(i, { frequency: e.target.value })}
                        className={inputClass()}
                        placeholder="Ej. cada 8 horas"
                        maxLength={120}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={id("dur")}>Duración</Label>
                      <input
                        id={id("dur")}
                        value={f.duration}
                        onChange={(e) => cambiar(i, { duration: e.target.value })}
                        className={inputClass()}
                        placeholder="Ej. por 7 días"
                        maxLength={120}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={id("ind")}>Indicaciones (opcional)</Label>
                      <input
                        id={id("ind")}
                        value={f.instructions ?? ""}
                        onChange={(e) => cambiar(i, { instructions: e.target.value })}
                        className={inputClass()}
                        placeholder="Ej. después de las comidas"
                        maxLength={500}
                      />
                    </div>
                  </div>
                  {avisos.length > 0 && (
                    <ul
                      id={id("avisos")}
                      role="alert"
                      className="space-y-1 text-sm text-destructive"
                    >
                      {avisos.map((a) => (
                        <li key={a} className="flex gap-1.5">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          {a}
                        </li>
                      ))}
                    </ul>
                  )}
                  {f.medication.trim().length >= 2 && !deLaClinica && (
                    <BloqueoEscritura>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={guardarMut.isPending}
                        onClick={() => guardarMut.mutate(f)}
                      >
                        <BookmarkPlus aria-hidden /> Guardar en el vademécum de la clínica
                      </Button>
                    </BloqueoEscritura>
                  )}
                </fieldset>
              );
            })}

            {filas.length < MAX_MEDICAMENTOS && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setFilas((prev) => [...prev, { ...FILA_VACIA }])}
              >
                <Plus aria-hidden /> Agregar medicamento
              </Button>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-indicaciones`}>Indicaciones generales (opcional)</Label>
              <textarea
                id={`${fid}-indicaciones`}
                value={indicaciones}
                onChange={(e) => setIndicaciones(e.target.value)}
                rows={3}
                maxLength={2000}
                className={inputClass()}
                placeholder="Ej. Dieta blanda y fría las primeras 24 horas."
              />
            </div>

            {analisis.campos.map((c) => {
              const def = definicionCampo(c);
              const idCampo = `${fid}-campo-${c}`;
              return (
                <div key={c} className="space-y-1.5">
                  <Label htmlFor={idCampo}>
                    {def.etiqueta}
                    {def.opcional && (
                      <span className="font-normal text-muted-foreground"> (opcional)</span>
                    )}
                  </Label>
                  <Input
                    id={idCampo}
                    type={def.tipo === "fecha" ? "date" : "text"}
                    value={campos[c] ?? ""}
                    maxLength={300}
                    onChange={(e) => setCampos((prev) => ({ ...prev, [c]: e.target.value }))}
                  />
                </div>
              );
            })}

            {hayAvisos && (
              <label className="flex items-start gap-2 rounded-md border border-destructive-border bg-destructive-soft px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-destructive"
                  checked={confirmaAlergias}
                  onChange={(e) => setConfirmaAlergias(e.target.checked)}
                />
                <span>
                  Revisé las alergias del paciente y quiero recetar igual. Los avisos quedan
                  guardados con la receta.
                </span>
              </label>
            )}

            {profesional && !profesional.tieneFirma && (
              <p className="flex gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-xs">
                <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  No tienes una imagen de firma: la receta sale con tu nombre y registro, y una
                  línea para firmar a mano.{" "}
                  <Link to="/preferencias" className="font-medium underline">
                    Cargar mi firma
                  </Link>
                </span>
              </p>
            )}
            {datos.data?.exigeSis && profesional && !profesional.registroSis && (
              <p className="text-xs text-destructive">
                Falta tu número de registro de la Superintendencia de Salud.{" "}
                <Link to="/preferencias" className="font-medium underline">
                  Cargarlo en Preferencias
                </Link>
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
            {datos.isError ? (
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
          <BloqueoEscritura otroMotivo={motivo}>
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
