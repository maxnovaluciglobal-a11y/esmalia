import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ChevronDown,
  FileDown,
  FileSpreadsheet,
  Loader2,
  Plus,
  Scale,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { CLASE_CAMPO } from "@/components/cita-formulario";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import { descargarCsv } from "@/lib/csv-export";
import {
  CATEGORIAS_DE_DATOS,
  DECISIONES_NOTIFICAR,
  ESTADOS_DE_BRECHA,
  ETIQUETA_CATEGORIA,
  ETIQUETA_DECISION,
  ETIQUETA_ESTADO_BRECHA,
  ETIQUETA_RIESGO,
  NIVELES_DE_RIESGO,
  PASOS_ANTE_UNA_BRECHA,
  brechasACsv,
  contenidoPdfBrechas,
  estadoActualDeBrecha,
  instanteLocal,
  textoTitulares,
  type CategoriaDeDatos,
  type DecisionNotificar,
  type EstadoDeBrecha,
  type FilaExportBrecha,
  type NivelDeRiesgo,
} from "@/lib/derechos/brechas";
import {
  agregarSeguimientoBrecha,
  listarBrechas,
  registrarBrecha,
} from "@/lib/derechos/brechas.functions";
import { BORRADOR_LEGAL, MENSAJE_DEMO_SOLO_LECTURA } from "@/lib/derechos/derechos";
import { fechaHora } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";

const VARIANTE_RIESGO: Record<NivelDeRiesgo, "secondary" | "success" | "warning" | "destructive"> =
  {
    por_evaluar: "secondary",
    bajo: "success",
    medio: "warning",
    alto: "destructive",
  };

const VARIANTE_ESTADO: Record<EstadoDeBrecha, "destructive" | "warning" | "success"> = {
  abierto: "destructive",
  contenido: "warning",
  cerrado: "success",
};

interface Props {
  clinicId: string;
  isDemo: boolean;
}

/**
 * Registro de incidentes de seguridad y brechas de datos (SEG-06). Solo
 * owner/admin (ruta con `team:manage`; el servidor vuelve a exigirlo).
 */
export function RegistroBrechas({ clinicId, isDemo }: Props) {
  const fetchLista = useServerFn(listarBrechas);
  const [registrando, setRegistrando] = useState(false);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [exportandoPdf, setExportandoPdf] = useState(false);

  const lista = useQuery({
    queryKey: ["brechas", clinicId],
    queryFn: () => fetchLista({ data: { clinicId } }),
  });

  const zona = lista.data?.zona ?? "America/Santiago";
  const filas: FilaExportBrecha[] = useMemo(() => {
    if (!lista.data) return [];
    const autores = new Map(Object.entries(lista.data.autores));
    return lista.data.incidentes.map((incidente) => {
      const seguimientos = lista.data.seguimientos.filter((s) => s.incident_id === incidente.id);
      return {
        incidente,
        seguimientos,
        estado: estadoActualDeBrecha(incidente, seguimientos),
        autores,
      };
    });
  }, [lista.data]);
  const actual = filas.find((f) => f.incidente.id === seleccionado) ?? null;
  const motivoDemo = isDemo ? MENSAJE_DEMO_SOLO_LECTURA : null;

  function exportarCsv() {
    const hoy = instanteLocal(new Date(), zona).slice(0, 10);
    descargarCsv(brechasACsv(filas, zona), `registro-incidentes-${hoy}.csv`);
  }

  async function exportarPdf() {
    setExportandoPdf(true);
    try {
      const { generarPdfFicha } = await import("@/lib/exportacion/ficha-pdf");
      const bytes = await generarPdfFicha(
        contenidoPdfBrechas(filas, {
          clinicaNombre: lista.data?.clinicaNombre ?? "",
          zona,
          generadoEn: new Date(),
        }),
      );
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `registro-incidentes-${instanteLocal(new Date(), zona).slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setExportandoPdf(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4 text-primary" aria-hidden />
            Registro de incidentes de seguridad
          </CardTitle>
          <CardDescription>
            Anota aquí cualquier acceso, filtración, pérdida o alteración no autorizada de datos de
            tus pacientes, aunque al final no haya que notificarla: qué pasó, cuándo lo supiste, qué
            datos y cuántas personas afectó, cómo evaluaste el riesgo, qué hiciste y si notificaste
            a la Agencia y a los pacientes. Es una bitácora: lo escrito no se edita, se le agregan
            seguimientos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="flex items-start gap-2 rounded-lg border border-dashed border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning">
            <Scale className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {BORRADOR_LEGAL}
          </p>
          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm font-medium text-brand-700">
              <ChevronDown
                className="size-4 transition-transform group-data-[state=open]:rotate-180"
                aria-hidden
              />
              Qué hacer ante una brecha
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol className="mt-3 space-y-2 text-sm">
                {PASOS_ANTE_UNA_BRECHA.map((p, i) => (
                  <li key={p.titulo} className="flex gap-3">
                    <span className="cifra text-muted-foreground">{i + 1}.</span>
                    <span>
                      <span className="font-medium">{p.titulo}.</span>{" "}
                      <span className="text-muted-foreground">{p.detalle}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </CollapsibleContent>
          </Collapsible>
          <div className="flex flex-wrap gap-2">
            <AccionDeshabilitada motivo={motivoDemo} como="globo">
              <Button size="sm" onClick={() => setRegistrando(true)}>
                <Plus className="size-4" aria-hidden />
                Registrar incidente
              </Button>
            </AccionDeshabilitada>
            <AccionDeshabilitada
              motivo={filas.length ? null : "No hay incidentes para exportar."}
              como="globo"
            >
              <Button variant="outline" size="sm" onClick={exportarCsv}>
                <FileSpreadsheet className="size-4" aria-hidden />
                CSV
              </Button>
            </AccionDeshabilitada>
            <AccionDeshabilitada
              motivo={filas.length ? null : "No hay incidentes para exportar."}
              como="globo"
            >
              <Button
                variant="outline"
                size="sm"
                disabled={exportandoPdf}
                onClick={() => void exportarPdf()}
              >
                {exportandoPdf ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <FileDown className="size-4" aria-hidden />
                )}
                PDF
              </Button>
            </AccionDeshabilitada>
          </div>
        </CardContent>
      </Card>

      {lista.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando el registro…
        </p>
      ) : lista.error ? (
        <p className="text-sm text-destructive">{mensajeDeError(lista.error)}</p>
      ) : filas.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No hay incidentes registrados. Si algo pasa, regístralo apenas lo sepas.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {filas.map(({ incidente: i, estado: e }) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => setSeleccionado(i.id)}
                className="flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{i.title}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant={VARIANTE_ESTADO[e.status]}>
                      {ETIQUETA_ESTADO_BRECHA[e.status]}
                    </Badge>
                    <Badge variant={VARIANTE_RIESGO[e.riskLevel]}>
                      Riesgo {ETIQUETA_RIESGO[e.riskLevel].toLowerCase()}
                    </Badge>
                    {e.sensible ? <Badge variant="destructive">Datos de salud</Badge> : null}
                    {e.notificacionPendiente ? (
                      <Badge variant="warning">
                        <AlertTriangle className="size-3" aria-hidden /> Falta notificar
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Detectado el {fechaHora(i.detected_at, zona)} ·{" "}
                  {textoTitulares(e.affectedSubjectsEstimate)} · responsable: {i.responsible_name}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {registrando ? (
        <RegistrarIncidente clinicId={clinicId} zona={zona} onClose={() => setRegistrando(false)} />
      ) : null}
      {actual ? (
        <DetalleIncidente
          clinicId={clinicId}
          fila={actual}
          zona={zona}
          motivoDemo={motivoDemo}
          onClose={() => setSeleccionado(null)}
        />
      ) : null}
    </div>
  );
}

function CategoriasCheck({
  valor,
  onChange,
  idBase,
}: {
  valor: CategoriaDeDatos[];
  onChange: (v: CategoriaDeDatos[]) => void;
  idBase: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">Datos afectados</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {CATEGORIAS_DE_DATOS.map((c) => (
          <label key={c} htmlFor={`${idBase}-${c}`} className="flex items-start gap-2 text-sm">
            <input
              id={`${idBase}-${c}`}
              type="checkbox"
              className="mt-0.5 accent-brand"
              checked={valor.includes(c)}
              onChange={(e) =>
                onChange(e.target.checked ? [...valor, c] : valor.filter((x) => x !== c))
              }
            />
            {ETIQUETA_CATEGORIA[c]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Seleccion<T extends string>({
  id,
  etiqueta,
  valor,
  opciones,
  etiquetas,
  onChange,
  vacio,
}: {
  id: string;
  etiqueta: string;
  valor: T | "";
  opciones: readonly T[];
  etiquetas: Record<T, string>;
  onChange: (v: T | "") => void;
  vacio?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <select
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value as T | "")}
        className={CLASE_CAMPO}
      >
        {vacio !== undefined ? <option value="">{vacio}</option> : null}
        {opciones.map((o) => (
          <option key={o} value={o}>
            {etiquetas[o]}
          </option>
        ))}
      </select>
    </div>
  );
}

function aIso(local: string, zona: string): string | null {
  return local ? wallTimeInTzToUtc(local, zona).toISOString() : null;
}

function RegistrarIncidente({
  clinicId,
  zona,
  onClose,
}: {
  clinicId: string;
  zona: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const registrarFn = useServerFn(registrarBrecha);
  const ahora = instanteLocal(new Date(), zona);
  const [detectado, setDetectado] = useState(ahora);
  const [ocurrido, setOcurrido] = useState("");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categorias, setCategorias] = useState<CategoriaDeDatos[]>([]);
  const [titulares, setTitulares] = useState("");
  const [riesgo, setRiesgo] = useState<NivelDeRiesgo>("por_evaluar");
  const [evaluacion, setEvaluacion] = useState("");
  const [medidas, setMedidas] = useState("");
  const [agencia, setAgencia] = useState<DecisionNotificar>("por_decidir");
  const [aTitulares, setATitulares] = useState<DecisionNotificar>("por_decidir");
  const [fundamento, setFundamento] = useState("");
  const [responsable, setResponsable] = useState("");

  const registrar = useMutation({
    mutationFn: () =>
      registrarFn({
        data: {
          clinicId,
          detectadoEl: aIso(detectado, zona)!,
          ocurridoEl: aIso(ocurrido, zona),
          titulo,
          descripcion,
          categorias,
          titularesEstimados: titulares.trim() === "" ? null : Number(titulares),
          riesgo,
          evaluacion,
          medidas,
          notificarAgencia: agencia,
          notificarTitulares: aTitulares,
          fundamento,
          responsable,
        },
      }),
    onSuccess: () => {
      toast.success("Incidente registrado.");
      void queryClient.invalidateQueries({ queryKey: ["brechas", clinicId] });
      onClose();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const titularesValido = titulares.trim() === "" || /^\d+$/.test(titulares.trim());
  const motivo = !detectado
    ? "Indica cuándo lo supiste."
    : titulo.trim().length < 3
      ? "Ponle un título corto."
      : descripcion.trim().length < 10
        ? "Describe qué pasó (al menos 10 caracteres)."
        : !titularesValido
          ? "Los titulares afectados son un número entero (o déjalo vacío si no lo sabes)."
          : responsable.trim().length < 2
            ? "Indica quién es el responsable."
            : null;

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && !registrar.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Registrar un incidente</DialogTitle>
          <DialogDescription>
            Anota lo que sepas ahora; lo demás va después como seguimiento. Lo que guardes aquí no
            se puede editar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="brecha-detectado">Cuándo lo supo la clínica</Label>
              <Input
                id="brecha-detectado"
                type="datetime-local"
                value={detectado}
                max={ahora}
                onChange={(e) => setDetectado(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brecha-ocurrido">Cuándo ocurrió (si se sabe)</Label>
              <Input
                id="brecha-ocurrido"
                type="datetime-local"
                value={ocurrido}
                max={detectado || ahora}
                onChange={(e) => setOcurrido(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brecha-titulo">Título</Label>
            <Input
              id="brecha-titulo"
              value={titulo}
              maxLength={160}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Por ejemplo: correo con una ficha enviado a otra persona"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brecha-descripcion">Qué pasó</Label>
            <textarea
              id="brecha-descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={4}
              maxLength={4000}
              className={CLASE_CAMPO}
              placeholder="Cómo se detectó, qué se vio o se perdió, desde cuándo"
            />
          </div>
          <CategoriasCheck valor={categorias} onChange={setCategorias} idBase="brecha-cat" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="brecha-titulares">Titulares afectados (estimado)</Label>
              <Input
                id="brecha-titulares"
                inputMode="numeric"
                value={titulares}
                onChange={(e) => setTitulares(e.target.value)}
                placeholder="Vacío si todavía no se sabe"
              />
            </div>
            <Seleccion
              id="brecha-riesgo"
              etiqueta="Riesgo para los titulares"
              valor={riesgo}
              opciones={NIVELES_DE_RIESGO}
              etiquetas={ETIQUETA_RIESGO}
              onChange={(v) => setRiesgo((v || "por_evaluar") as NivelDeRiesgo)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brecha-evaluacion">Evaluación del riesgo</Label>
            <textarea
              id="brecha-evaluacion"
              value={evaluacion}
              onChange={(e) => setEvaluacion(e.target.value)}
              rows={2}
              maxLength={4000}
              className={CLASE_CAMPO}
              placeholder="Por qué ese nivel: qué podría pasarle a los pacientes"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brecha-medidas">Medidas adoptadas</Label>
            <textarea
              id="brecha-medidas"
              value={medidas}
              onChange={(e) => setMedidas(e.target.value)}
              rows={2}
              maxLength={4000}
              className={CLASE_CAMPO}
              placeholder="Qué se hizo para contenerlo"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Seleccion
              id="brecha-agencia"
              etiqueta="¿Notificar a la Agencia?"
              valor={agencia}
              opciones={DECISIONES_NOTIFICAR}
              etiquetas={ETIQUETA_DECISION}
              onChange={(v) => setAgencia((v || "por_decidir") as DecisionNotificar)}
            />
            <Seleccion
              id="brecha-titulares-notif"
              etiqueta="¿Notificar a los titulares?"
              valor={aTitulares}
              opciones={DECISIONES_NOTIFICAR}
              etiquetas={ETIQUETA_DECISION}
              onChange={(v) => setATitulares((v || "por_decidir") as DecisionNotificar)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brecha-fundamento">Fundamento de la decisión</Label>
            <textarea
              id="brecha-fundamento"
              value={fundamento}
              onChange={(e) => setFundamento(e.target.value)}
              rows={2}
              maxLength={2000}
              className={CLASE_CAMPO}
              placeholder="Por qué se notifica o por qué no (también se documenta si no se notifica)"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brecha-responsable">Responsable del incidente</Label>
            <Input
              id="brecha-responsable"
              value={responsable}
              maxLength={120}
              onChange={(e) => setResponsable(e.target.value)}
              placeholder="Nombre de quien coordina la respuesta"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={registrar.isPending}>
            Cancelar
          </Button>
          <AccionDeshabilitada motivo={motivo}>
            <Button disabled={registrar.isPending} onClick={() => registrar.mutate()}>
              {registrar.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Registrar
            </Button>
          </AccionDeshabilitada>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetalleIncidente({
  clinicId,
  fila,
  zona,
  motivoDemo,
  onClose,
}: {
  clinicId: string;
  fila: FilaExportBrecha;
  zona: string;
  motivoDemo: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const seguimientoFn = useServerFn(agregarSeguimientoBrecha);
  const { incidente: i, estado: e, seguimientos, autores } = fila;
  const ahora = instanteLocal(new Date(), zona);

  const [nota, setNota] = useState("");
  const [estado, setEstado] = useState<EstadoDeBrecha | "">("");
  const [riesgo, setRiesgo] = useState<NivelDeRiesgo | "">("");
  const [medidas, setMedidas] = useState("");
  const [titulares, setTitulares] = useState("");
  const [agencia, setAgencia] = useState<DecisionNotificar | "">("");
  const [aTitulares, setATitulares] = useState<DecisionNotificar | "">("");
  const [fundamento, setFundamento] = useState("");
  const [agenciaEl, setAgenciaEl] = useState("");
  const [titularesEl, setTitularesEl] = useState("");

  const guardar = useMutation({
    mutationFn: () =>
      seguimientoFn({
        data: {
          clinicId,
          incidentId: i.id,
          nota,
          estado: estado || null,
          riesgo: riesgo || null,
          evaluacion: "",
          medidas,
          titularesEstimados: titulares.trim() === "" ? null : Number(titulares),
          categorias: null,
          notificarAgencia: agencia || null,
          notificarTitulares: aTitulares || null,
          fundamento,
          agenciaNotificadaEl: aIso(agenciaEl, zona),
          titularesNotificadosEl: aIso(titularesEl, zona),
        },
      }),
    onSuccess: () => {
      toast.success("Seguimiento agregado.");
      setNota("");
      setEstado("");
      setRiesgo("");
      setMedidas("");
      setTitulares("");
      setAgencia("");
      setATitulares("");
      setFundamento("");
      setAgenciaEl("");
      setTitularesEl("");
      void queryClient.invalidateQueries({ queryKey: ["brechas", clinicId] });
    },
    onError: (err: Error) => toast.error(mensajeDeError(err)),
  });

  const titularesValido = titulares.trim() === "" || /^\d+$/.test(titulares.trim());
  const motivo =
    motivoDemo ??
    (nota.trim().length < 3
      ? "Escribe qué pasó o qué se hizo."
      : !titularesValido
        ? "Los titulares afectados son un número entero."
        : null);
  const autor = (id: string | null) => (id ? (autores.get(id) ?? "Usuario eliminado") : "—");

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && !guardar.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{i.title}</DialogTitle>
          <DialogDescription>
            Detectado el {fechaHora(i.detected_at, zona)}
            {i.occurred_at ? ` · ocurrió el ${fechaHora(i.occurred_at, zona)}` : ""} · responsable:{" "}
            {i.responsible_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={VARIANTE_ESTADO[e.status]}>{ETIQUETA_ESTADO_BRECHA[e.status]}</Badge>
            <Badge variant={VARIANTE_RIESGO[e.riskLevel]}>
              Riesgo {ETIQUETA_RIESGO[e.riskLevel].toLowerCase()}
            </Badge>
            {e.sensible ? <Badge variant="destructive">Datos de salud (sensibles)</Badge> : null}
            {e.notificacionPendiente ? <Badge variant="warning">Falta notificar</Badge> : null}
          </div>

          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Titulares afectados (estimado)</dt>
              <dd>{textoTitulares(e.affectedSubjectsEstimate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Datos afectados</dt>
              <dd>
                {e.dataCategories.map((c) => ETIQUETA_CATEGORIA[c]).join("; ") || "Sin indicar"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Notificación a la Agencia</dt>
              <dd>
                {ETIQUETA_DECISION[e.notifyAgency]}
                {e.agencyNotifiedAt ? ` · el ${fechaHora(e.agencyNotifiedAt, zona)}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Notificación a los titulares</dt>
              <dd>
                {ETIQUETA_DECISION[e.notifySubjects]}
                {e.subjectsNotifiedAt ? ` · el ${fechaHora(e.subjectsNotifiedAt, zona)}` : ""}
              </dd>
            </div>
          </dl>

          <section className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">Bitácora</h3>
            <ol className="space-y-3 border-l border-border pl-3">
              <li>
                <p className="text-xs text-muted-foreground">
                  {fechaHora(i.created_at, zona)} · {autor(i.created_by)} · registro inicial
                </p>
                <p className="whitespace-pre-line">{i.description}</p>
                {i.risk_assessment ? (
                  <p className="text-muted-foreground">Evaluación: {i.risk_assessment}</p>
                ) : null}
                {i.measures ? <p className="text-muted-foreground">Medidas: {i.measures}</p> : null}
                {i.notification_reason ? (
                  <p className="text-muted-foreground">Fundamento: {i.notification_reason}</p>
                ) : null}
              </li>
              {seguimientos.map((s) => (
                <li key={s.id}>
                  <p className="text-xs text-muted-foreground">
                    {fechaHora(s.created_at, zona)} · {autor(s.created_by)}
                    {s.status
                      ? ` · pasa a ${ETIQUETA_ESTADO_BRECHA[s.status as EstadoDeBrecha]}`
                      : ""}
                    {s.risk_level
                      ? ` · riesgo ${ETIQUETA_RIESGO[s.risk_level as NivelDeRiesgo].toLowerCase()}`
                      : ""}
                  </p>
                  <p className="whitespace-pre-line">{s.note}</p>
                  {s.measures ? (
                    <p className="text-muted-foreground">Medidas: {s.measures}</p>
                  ) : null}
                  {s.agency_notified_at ? (
                    <p className="text-muted-foreground">
                      Agencia notificada el {fechaHora(s.agency_notified_at, zona)}
                    </p>
                  ) : null}
                  {s.subjects_notified_at ? (
                    <p className="text-muted-foreground">
                      Titulares notificados el {fechaHora(s.subjects_notified_at, zona)}
                    </p>
                  ) : null}
                  {s.notification_reason ? (
                    <p className="text-muted-foreground">Fundamento: {s.notification_reason}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <section className="space-y-3 rounded-lg border border-border p-3">
            <h3 className="text-sm font-medium">Agregar seguimiento</h3>
            <div className="space-y-1.5">
              <Label htmlFor="seg-nota">Qué pasó o qué se hizo</Label>
              <textarea
                id="seg-nota"
                value={nota}
                onChange={(ev) => setNota(ev.target.value)}
                rows={3}
                maxLength={4000}
                className={CLASE_CAMPO}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Seleccion
                id="seg-estado"
                etiqueta="Estado"
                valor={estado}
                opciones={ESTADOS_DE_BRECHA}
                etiquetas={ETIQUETA_ESTADO_BRECHA}
                onChange={setEstado}
                vacio="Sin cambios"
              />
              <Seleccion
                id="seg-riesgo"
                etiqueta="Riesgo"
                valor={riesgo}
                opciones={NIVELES_DE_RIESGO}
                etiquetas={ETIQUETA_RIESGO}
                onChange={setRiesgo}
                vacio="Sin cambios"
              />
              <div className="space-y-1.5">
                <Label htmlFor="seg-titulares">Titulares (estimado)</Label>
                <Input
                  id="seg-titulares"
                  inputMode="numeric"
                  value={titulares}
                  onChange={(ev) => setTitulares(ev.target.value)}
                  placeholder="Sin cambios"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seg-medidas">Medidas nuevas</Label>
              <textarea
                id="seg-medidas"
                value={medidas}
                onChange={(ev) => setMedidas(ev.target.value)}
                rows={2}
                maxLength={4000}
                className={CLASE_CAMPO}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Seleccion
                id="seg-agencia"
                etiqueta="¿Notificar a la Agencia?"
                valor={agencia}
                opciones={DECISIONES_NOTIFICAR}
                etiquetas={ETIQUETA_DECISION}
                onChange={setAgencia}
                vacio="Sin cambios"
              />
              <Seleccion
                id="seg-titulares-notif"
                etiqueta="¿Notificar a los titulares?"
                valor={aTitulares}
                opciones={DECISIONES_NOTIFICAR}
                etiquetas={ETIQUETA_DECISION}
                onChange={setATitulares}
                vacio="Sin cambios"
              />
              <div className="space-y-1.5">
                <Label htmlFor="seg-agencia-el">Se notificó a la Agencia el</Label>
                <Input
                  id="seg-agencia-el"
                  type="datetime-local"
                  value={agenciaEl}
                  max={ahora}
                  onChange={(ev) => setAgenciaEl(ev.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seg-titulares-el">Se notificó a los titulares el</Label>
                <Input
                  id="seg-titulares-el"
                  type="datetime-local"
                  value={titularesEl}
                  max={ahora}
                  onChange={(ev) => setTitularesEl(ev.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seg-fundamento">
                Fundamento (si cambia la decisión de notificar)
              </Label>
              <textarea
                id="seg-fundamento"
                value={fundamento}
                onChange={(ev) => setFundamento(ev.target.value)}
                rows={2}
                maxLength={2000}
                className={CLASE_CAMPO}
              />
            </div>
            <div className="flex justify-end">
              <AccionDeshabilitada motivo={motivo}>
                <Button size="sm" disabled={guardar.isPending} onClick={() => guardar.mutate()}>
                  {guardar.isPending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : null}
                  Agregar seguimiento
                </Button>
              </AccionDeshabilitada>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
