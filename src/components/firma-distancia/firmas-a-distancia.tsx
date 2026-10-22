import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Ban,
  Copy,
  Download,
  ExternalLink,
  FileSignature,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { ErrorDeCarga } from "@/components/estado-error";
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
import { Label } from "@/components/ui/label";
import { huellaCorta } from "@/lib/documentos/huella";
import {
  ETIQUETA_CANAL,
  ETIQUETA_ESTADO,
  sePuedeCancelar,
  sePuedeReenviar,
  type CanalDelLink,
  type EstadoSolicitud,
  type TipoSolicitud,
} from "@/lib/firma-distancia/estado";
import {
  filasDeConstancia,
  hojaDeCopiaFirmada,
  huellaDeEvidencia,
  nombreDeCopiaFirmada,
} from "@/lib/firma-distancia/evidencia";
import {
  cancelarFirmaADistancia,
  getEvidenciaDeFirma,
  getPedidoDeFirma,
  listFirmasADistancia,
  pedirFirmaADistancia,
  setPlantillaRequiereFirma,
  type EvidenciaDeFirma,
  type ResultadoDelPedido,
  type SolicitudDeFirma,
} from "@/lib/firma-distancia/firma.functions";
import { fechaHora } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Firma a distancia (Ola 5 · DOC-05) del lado de la clínica: pedir la firma
 * de un documento o la aceptación de un presupuesto, ver en qué estado está
 * (enviada, abierta, firmada, vencida, cancelada), reenviar, cancelar y ver
 * la evidencia con la copia firmada.
 *
 * Se usa en el documento emitido, en el presupuesto y en la ficha (pestaña
 * Documentos, todas las del paciente).
 */

const TONO_ESTADO: Record<EstadoSolicitud, string> = {
  enviada: "border-info-border bg-info-soft text-info",
  abierta: "border-info-border bg-info-soft text-info",
  firmada: "border-success-border bg-success-soft text-success",
  vencida: "border-warning-border bg-warning-soft text-warning",
  cancelada: "border-border bg-muted text-muted-foreground",
  reemplazada: "border-border bg-muted text-muted-foreground",
};

export function ChipEstadoFirma({ estado }: { estado: EstadoSolicitud }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        TONO_ESTADO[estado],
      )}
    >
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}

type Filtro = { patientId: string } | { issuedDocumentId: string } | { quoteId: string };

export function FirmasADistanciaCard({
  clinicId,
  timezone,
  filtro,
  objetivo,
  puedeGestionar,
  motivoNoPedir,
  titulo = "Firma del paciente a distancia",
  descripcion,
  mostrarTitulos = false,
}: {
  clinicId: string;
  timezone: string;
  filtro: Filtro;
  /** Documento o presupuesto al que se le pide la firma (botón "Pedir firma"). */
  objetivo?: { tipo: TipoSolicitud; id: string };
  /** ¿Puede pedir, reenviar y cancelar? (par en el servidor y en la RLS). */
  puedeGestionar: (tipo: TipoSolicitud) => boolean;
  /** Motivo para no ofrecer pedir la firma (anulado, ya aceptado…). */
  motivoNoPedir?: string | null;
  titulo?: string;
  descripcion?: string;
  /** En la ficha: muestra el título de cada documento. */
  mostrarTitulos?: boolean;
}) {
  const listar = useServerFn(listFirmasADistancia);
  const queryKey = ["firmas-a-distancia", clinicId, filtro];
  const consulta = useQuery({
    queryKey,
    queryFn: () => listar({ data: { clinicId, ...filtro } }),
  });
  const [pidiendo, setPidiendo] = useState<{ reemplazaA?: string } | null>(null);
  const [evidencia, setEvidencia] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<SolicitudDeFirma | null>(null);

  const solicitudes = consulta.data ?? [];
  const yaFirmada = solicitudes.some((s) => s.estado === "firmada");
  // Ya firmada: no hay nada más que pedir (la base también lo rechaza).
  const puedePedir = objetivo && puedeGestionar(objetivo.tipo) && !yaFirmada;
  const motivo = motivoNoPedir ?? null;

  if (!objetivo && !consulta.isLoading && !consulta.isError && solicitudes.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby={`firmas-${clinicId}`}
      className="no-imprimir card-clinical space-y-3 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h3 id={`firmas-${clinicId}`} className="font-display text-base font-semibold">
            {titulo}
          </h3>
          <p className="text-sm text-muted-foreground">
            {descripcion ??
              "El paciente lo lee y firma en su celular: confirma su identidad con su RUT y un código que le llega por correo. Firma electrónica simple (Ley 19.799)."}
          </p>
        </div>
        {puedePedir && (
          <BloqueoEscritura otroMotivo={motivo}>
            <Button size="sm" onClick={() => setPidiendo({})} disabled={Boolean(motivo)}>
              <FileSignature aria-hidden /> Pedir firma a distancia
            </Button>
          </BloqueoEscritura>
        )}
      </div>

      {consulta.isError ? (
        <ErrorDeCarga
          onReintentar={() => consulta.refetch()}
          reintentando={consulta.isFetching}
          mensaje="No pudimos cargar las firmas a distancia."
        />
      ) : consulta.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
        </p>
      ) : solicitudes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no se pidió la firma a distancia.</p>
      ) : (
        <ul className="divide-y divide-hairline border-y border-border">
          {solicitudes.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  {mostrarTitulos && <span className="font-medium">{s.titulo}</span>}
                  <ChipEstadoFirma estado={s.estado} />
                  {s.bloqueadaHasta && (
                    <span className="text-xs text-warning">Bloqueada por intentos fallidos</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {s.estado === "firmada" && s.firmadaEl
                    ? `Firmó ${s.firmadoPor ?? s.nombreFirmante} el ${fechaHora(s.firmadaEl, timezone)}`
                    : s.estado === "cancelada" && s.canceladaEl
                      ? `Cancelada el ${fechaHora(s.canceladaEl, timezone)}`
                      : s.estado === "vencida"
                        ? `Venció el ${fechaHora(s.venceEl, timezone)}`
                        : s.estado === "reemplazada"
                          ? "Se mandó un link nuevo"
                          : `${s.abiertaEl ? `Abierta el ${fechaHora(s.abiertaEl, timezone)}` : "Todavía no la abre"} · vence el ${fechaHora(s.venceEl, timezone)}`}
                  {" · "}
                  {ETIQUETA_CANAL[s.canal]} · pedida el {fechaHora(s.creadaEl, timezone)}
                  {s.firmante === "tutor" ? ` · firma el tutor (${s.nombreFirmante})` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(s.estado === "firmada" || s.estado === "cancelada" || s.abiertaEl) && (
                  <Button variant="outline" size="sm" onClick={() => setEvidencia(s.id)}>
                    {s.estado === "firmada" ? "Ver evidencia" : "Ver detalle"}
                  </Button>
                )}
                {puedeGestionar(s.tipo) && sePuedeReenviar(s.estado) && (
                  <BloqueoEscritura>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPidiendo({ reemplazaA: s.id })}
                      disabled={!objetivo && !s.issuedDocumentId && !s.quoteId}
                    >
                      <RotateCw aria-hidden /> Reenviar
                    </Button>
                  </BloqueoEscritura>
                )}
                {puedeGestionar(s.tipo) && sePuedeCancelar(s.estado) && (
                  <BloqueoEscritura>
                    <Button variant="ghost" size="sm" onClick={() => setCancelando(s)}>
                      <Ban aria-hidden /> Cancelar
                    </Button>
                  </BloqueoEscritura>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pidiendo && (
        <PedirFirmaDialog
          clinicId={clinicId}
          timezone={timezone}
          objetivo={
            objetivo ??
            (() => {
              const s = solicitudes.find((x) => x.id === pidiendo.reemplazaA);
              return s
                ? { tipo: s.tipo, id: (s.issuedDocumentId ?? s.quoteId) as string }
                : { tipo: "documento" as const, id: "" };
            })()
          }
          reemplazaA={pidiendo.reemplazaA}
          onCerrar={() => setPidiendo(null)}
        />
      )}
      {evidencia && (
        <EvidenciaDialog
          clinicId={clinicId}
          requestId={evidencia}
          onCerrar={() => setEvidencia(null)}
        />
      )}
      {cancelando && (
        <CancelarDialog
          clinicId={clinicId}
          solicitud={cancelando}
          onCerrar={() => setCancelando(null)}
        />
      )}
    </section>
  );
}

// ─── Pedir (o reenviar) ──────────────────────────────────────────────────────

const ICONO_CANAL: Record<CanalDelLink, typeof MessageCircle> = {
  whatsapp: MessageCircle,
  correo: Mail,
  copiado: Link2,
};

const DETALLE_CANAL: Record<CanalDelLink, string> = {
  whatsapp: "Se abre WhatsApp con el mensaje listo: lo envías tú.",
  correo: "Le llega un correo con el link (sin datos clínicos).",
  copiado: "Copias el link y se lo das por el canal que prefieras.",
};

function PedirFirmaDialog({
  clinicId,
  timezone,
  objetivo,
  reemplazaA,
  onCerrar,
}: {
  clinicId: string;
  timezone: string;
  objetivo: { tipo: TipoSolicitud; id: string };
  reemplazaA?: string;
  onCerrar: () => void;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const vista = useServerFn(getPedidoDeFirma);
  const pedir = useServerFn(pedirFirmaADistancia);
  const consulta = useQuery({
    queryKey: ["pedido-de-firma", clinicId, objetivo.tipo, objetivo.id],
    queryFn: () => vista({ data: { clinicId, tipo: objetivo.tipo, objetivoId: objetivo.id } }),
    staleTime: 0,
  });
  const [canal, setCanal] = useState<CanalDelLink | null>(null);
  const [resultado, setResultado] = useState<ResultadoDelPedido | null>(null);
  const v = consulta.data;
  const reemplaza = reemplazaA ?? v?.abierta?.id;

  useEffect(() => {
    if (!v || canal) return;
    const primero = (["whatsapp", "correo", "copiado"] as const).find(
      (c) => v.canales[c].disponible,
    );
    if (primero) setCanal(primero);
  }, [v, canal]);

  const mut = useMutation({
    mutationFn: () =>
      pedir({
        data: {
          clinicId,
          tipo: objetivo.tipo,
          objetivoId: objetivo.id,
          canal: canal!,
          ...(reemplaza ? { reemplazaA: reemplaza } : {}),
        },
      }),
    onSuccess: async (r) => {
      setResultado(r);
      if (r.waUrl) window.open(r.waUrl, "_blank", "noopener,noreferrer");
      await queryClient.invalidateQueries({ queryKey: ["firmas-a-distancia", clinicId] });
      await queryClient.invalidateQueries({ queryKey: ["presupuesto-detalle", clinicId] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado.");
    } catch {
      toast.error("No pudimos copiar el link: selecciónalo y cópialo a mano.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !mut.isPending && onCerrar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {reemplaza ? "Reenviar link para firmar" : "Pedir firma a distancia"}
          </DialogTitle>
          <DialogDescription>
            El paciente abre el link en su celular, confirma su identidad con su RUT y un código que
            le llega por correo, y firma. El link es de un solo uso y vence en 72 horas.
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-4">
            <p role="status" className="flex items-start gap-2 text-sm text-success">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              Listo: el link vence el {fechaHora(resultado.venceEl, timezone)}.
            </p>
            {resultado.waUrl && (
              <Button asChild className="w-full">
                <a href={resultado.waUrl} target="_blank" rel="noopener noreferrer">
                  <MessageCircle aria-hidden /> Abrir WhatsApp con el mensaje
                </a>
              </Button>
            )}
            {resultado.correo &&
              (resultado.correo.enviado ? (
                <p className="text-sm">
                  Correo enviado
                  {resultado.correo.redirigidoA
                    ? ` a la casilla de pruebas (${resultado.correo.redirigidoA}).`
                    : "."}
                </p>
              ) : (
                <p role="alert" className="text-sm text-destructive">
                  El correo no salió: {resultado.correo.motivo}. Copia el link y mándalo por otro
                  canal.
                </p>
              ))}
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-link`}>Link para el paciente</Label>
              <div className="flex gap-2">
                <input
                  id={`${fid}-link`}
                  readOnly
                  value={resultado.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                />
                <Button type="button" variant="outline" onClick={() => void copiar(resultado.url)}>
                  <Copy aria-hidden /> Copiar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Es personal: quien lo tenga puede intentar firmar, pero sin el RUT y el código del
                correo no avanza.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={onCerrar}>Cerrar</Button>
            </DialogFooter>
          </div>
        ) : consulta.isError ? (
          <ErrorDeCarga
            onReintentar={() => consulta.refetch()}
            reintentando={consulta.isFetching}
            mensaje={mensajeDeError(consulta.error)}
          />
        ) : !v ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Revisando los datos del
            paciente…
          </p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canal && !v.bloqueo) mut.mutate();
            }}
          >
            <dl className="grid gap-1 rounded-md border border-hairline p-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Firma</dt>
                <dd className="text-right">
                  {v.nombreFirmante}
                  {v.firmante === "tutor" ? ` (tutor de ${v.pacienteNombre})` : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Código por correo a</dt>
                <dd className="break-all text-right">{v.correoDelCodigo ?? "Sin correo"}</dd>
              </div>
            </dl>
            {v.bloqueo && (
              <p
                role="alert"
                className="flex gap-2 rounded-md border border-destructive-border bg-destructive-soft p-3 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {v.bloqueo}
              </p>
            )}
            {v.avisoModoPrueba && (
              <p className="flex gap-2 rounded-md border border-warning-border bg-warning-soft p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {v.avisoModoPrueba}
              </p>
            )}
            {reemplaza && (
              <p className="text-sm text-muted-foreground">
                Ya hay un link abierto: al mandar uno nuevo, el anterior deja de servir.
              </p>
            )}

            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">¿Cómo le mandas el link?</legend>
              {(["whatsapp", "correo", "copiado"] as const).map((c) => {
                const Icono = ICONO_CANAL[c];
                const info = v.canales[c];
                return (
                  <label
                    key={c}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm",
                      canal === c ? "border-brand bg-brand-soft" : "border-border",
                      !info.disponible && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${fid}-canal`}
                      value={c}
                      checked={canal === c}
                      disabled={!info.disponible}
                      onChange={() => setCanal(c)}
                      className="mt-1 size-4 shrink-0 accent-brand"
                    />
                    <Icono className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0">
                      <span className="font-medium">{ETIQUETA_CANAL[c]}</span>
                      <span className="block text-xs text-muted-foreground">
                        {info.disponible ? DETALLE_CANAL[c] : info.motivo}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onCerrar} disabled={mut.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!canal || Boolean(v.bloqueo) || mut.isPending}>
                {mut.isPending && <Loader2 className="animate-spin" aria-hidden />}
                {reemplaza ? "Mandar link nuevo" : "Pedir firma"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Cancelar ────────────────────────────────────────────────────────────────

function CancelarDialog({
  clinicId,
  solicitud,
  onCerrar,
}: {
  clinicId: string;
  solicitud: SolicitudDeFirma;
  onCerrar: () => void;
}) {
  const fid = useId();
  const [motivo, setMotivo] = useState("");
  const queryClient = useQueryClient();
  const cancelar = useServerFn(cancelarFirmaADistancia);
  const mut = useMutation({
    mutationFn: () =>
      cancelar({
        data: {
          clinicId,
          requestId: solicitud.id,
          ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
        },
      }),
    onSuccess: async () => {
      toast.success("Pedido de firma cancelado: el link ya no sirve.");
      onCerrar();
      await queryClient.invalidateQueries({ queryKey: ["firmas-a-distancia", clinicId] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !mut.isPending && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar el pedido de firma</DialogTitle>
          <DialogDescription>
            El link deja de servir. Si después hace falta la firma, pide una nueva.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-motivo`}>Motivo (opcional)</Label>
          <textarea
            id={`${fid}-motivo`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={300}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar} disabled={mut.isPending}>
            Volver
          </Button>
          <Button variant="destructive" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="animate-spin" aria-hidden />} Cancelar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Evidencia ───────────────────────────────────────────────────────────────

const ETIQUETA_EVENTO: Record<string, string> = {
  creada: "Pedido creado",
  abierta: "Abrió el link",
  rut_correcto: "RUT correcto",
  rut_incorrecto: "RUT incorrecto",
  bloqueada: "Bloqueada por intentos fallidos",
  codigo_enviado: "Código enviado por correo",
  codigo_incorrecto: "Código incorrecto",
  firmada: "Firmó",
  copia_guardada: "Copia firmada guardada",
  cancelada: "Cancelado por la clínica",
  reemplazada: "Reemplazado por un link nuevo",
};

function useIntegridadDeEvidencia(e: EvidenciaDeFirma | undefined) {
  const [estado, setEstado] = useState<"verificando" | "ok" | "alterada" | null>(null);
  useEffect(() => {
    if (!e?.constancia) return;
    let vivo = true;
    setEstado("verificando");
    void huellaDeEvidencia(e.constancia).then((h) => {
      if (vivo) setEstado(h === e.constancia!.evidenceSha256 ? "ok" : "alterada");
    });
    return () => {
      vivo = false;
    };
  }, [e]);
  return estado;
}

function EvidenciaDialog({
  clinicId,
  requestId,
  onCerrar,
}: {
  clinicId: string;
  requestId: string;
  onCerrar: () => void;
}) {
  const cargar = useServerFn(getEvidenciaDeFirma);
  const consulta = useQuery({
    queryKey: ["evidencia-de-firma", clinicId, requestId],
    queryFn: () => cargar({ data: { clinicId, requestId } }),
  });
  const e = consulta.data;
  const integridad = useIntegridadDeEvidencia(e);
  const [generando, setGenerando] = useState(false);

  async function generarCopia() {
    if (!e?.constancia) return;
    setGenerando(true);
    try {
      const { construirHojaPdf } = await import("@/lib/documentos/pdf");
      const doc = await construirHojaPdf(
        hojaDeCopiaFirmada({ sheet: e.hoja, bloques: e.bloques }, e.constancia, {
          firmaProfesionalUrl: null,
          firmaPacienteUrl: e.firmaPacienteUrl,
        }),
      );
      doc.save(nombreDeCopiaFirmada(e.solicitud.titulo, e.constancia.signedAt, e.zona));
    } catch (err) {
      toast.error(mensajeDeError(err));
    } finally {
      setGenerando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{e ? e.solicitud.titulo : "Firma a distancia"}</DialogTitle>
          <DialogDescription>
            Evidencia de la firma electrónica simple (Ley 19.799). No se edita ni se borra.
          </DialogDescription>
        </DialogHeader>
        {consulta.isError ? (
          <ErrorDeCarga
            onReintentar={() => consulta.refetch()}
            reintentando={consulta.isFetching}
            mensaje={mensajeDeError(consulta.error)}
          />
        ) : !e ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
          </p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <ChipEstadoFirma estado={e.solicitud.estado} />
              <span className="text-sm text-muted-foreground">Paciente: {e.pacienteNombre}</span>
            </div>

            {e.constancia ? (
              <>
                <p className="flex items-center gap-1.5 text-sm" role="status">
                  {integridad === "ok" ? (
                    <>
                      <ShieldCheck className="size-4 text-success" aria-hidden />
                      Evidencia íntegra: la huella coincide con la que guardó la base al firmar.
                    </>
                  ) : integridad === "alterada" ? (
                    <>
                      <ShieldAlert className="size-4 text-destructive" aria-hidden />
                      <span className="text-destructive">
                        La huella no coincide: la evidencia guardada no es la original. Avísanos
                        desde Ayuda.
                      </span>
                    </>
                  ) : (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden /> Verificando la
                      evidencia…
                    </>
                  )}
                </p>
                <dl className="divide-y divide-hairline rounded-md border border-hairline text-sm">
                  {filasDeConstancia(e.constancia).map(([k, val]) => (
                    <div key={k} className="grid gap-1 px-3 py-2 sm:grid-cols-[14rem_1fr]">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd
                        className={cn(
                          "min-w-0 break-words",
                          /Huella|Solicitud/.test(k) && "cifra break-all text-xs",
                        )}
                      >
                        {val}
                      </dd>
                    </div>
                  ))}
                </dl>
                {e.firmaPacienteUrl && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Firma dibujada</p>
                    <img
                      src={e.firmaPacienteUrl}
                      alt={`Firma de ${e.constancia.signerName}`}
                      className="max-h-32 rounded-md border border-hairline bg-white p-2"
                    />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {e.copiaUrl ? (
                    <Button asChild>
                      <a href={e.copiaUrl} target="_blank" rel="noopener noreferrer">
                        <Download aria-hidden /> Copia firmada (PDF)
                      </a>
                    </Button>
                  ) : (
                    <Button onClick={() => void generarCopia()} disabled={generando}>
                      {generando ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <Download aria-hidden />
                      )}
                      Descargar copia firmada
                    </Button>
                  )}
                  {e.copiaSha256 && (
                    <span className="text-xs text-muted-foreground">
                      SHA-256 del PDF guardado:{" "}
                      <span className="cifra">{huellaCorta(e.copiaSha256, 24)}</span>
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {e.solicitud.estado === "cancelada"
                  ? `Cancelada${e.canceladaPor ? ` por ${e.canceladaPor}` : ""} el ${fechaHora(e.solicitud.canceladaEl, e.zona)}${e.motivoCancelacion ? `. Motivo: ${e.motivoCancelacion}` : "."}`
                  : "Todavía no se firma."}{" "}
                El código se manda a {e.codigoA ?? "su correo"}.
              </p>
            )}

            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Bitácora</h4>
              <ol className="space-y-1.5 text-sm">
                {e.eventos.map((ev, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-3">
                    <span>
                      {ETIQUETA_EVENTO[ev.tipo] ?? ev.tipo}
                      {ev.ip && (
                        <span className="text-xs text-muted-foreground"> · IP {ev.ip}</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fechaHora(ev.creadoEl, e.zona)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            {e.solicitud.issuedDocumentId && (
              <a
                href={`/documentos/${e.solicitud.issuedDocumentId}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
              >
                <ExternalLink className="size-4" aria-hidden /> Ver el documento emitido
              </a>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Plantilla: el paciente firma ────────────────────────────────────────────

/**
 * Casilla del editor de plantillas: los documentos emitidos con esta
 * plantilla se pueden mandar a firmar al paciente. Los consentimientos lo
 * requieren siempre (la base lo decide así, `documento_requiere_firma`).
 */
export function RequiereFirmaDelPaciente({
  clinicId,
  plantilla,
  deshabilitado,
}: {
  clinicId: string;
  plantilla: { id: string; kind: string; requiresPatientSignature: boolean };
  deshabilitado: boolean;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const guardar = useServerFn(setPlantillaRequiereFirma);
  const mut = useMutation({
    mutationFn: (requiere: boolean) =>
      guardar({ data: { clinicId, templateId: plantilla.id, requiere } }),
    onSuccess: async (_r, requiere) => {
      await queryClient.invalidateQueries({ queryKey: ["plantillas-documento", clinicId] });
      toast.success(
        requiere
          ? "Listo: sus documentos se pueden mandar a firmar al paciente."
          : "Ya no se pide la firma del paciente para esta plantilla.",
      );
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const siempre = plantilla.kind === "consentimiento";
  return (
    <label
      htmlFor={`${fid}-requiere`}
      className="flex cursor-pointer items-start gap-3 rounded-md border border-hairline p-3 text-sm"
    >
      <input
        id={`${fid}-requiere`}
        type="checkbox"
        checked={siempre || plantilla.requiresPatientSignature}
        disabled={siempre || deshabilitado || mut.isPending}
        onChange={(e) => mut.mutate(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-brand pointer-coarse:size-5"
      />
      <span>
        <span className="font-medium">El paciente firma este documento</span>
        <span className="block text-xs text-muted-foreground">
          {siempre
            ? "Los consentimientos siempre se pueden mandar a firmar a distancia."
            : "Permite pedirle la firma a distancia: lo lee y firma en su celular con su RUT y un código."}
        </span>
      </span>
    </label>
  );
}
