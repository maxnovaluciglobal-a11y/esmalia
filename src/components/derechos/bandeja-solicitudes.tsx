import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Inbox, Loader2, Mail, Plus, Scale, Search } from "lucide-react";
import { toast } from "sonner";

import { CLASE_CAMPO } from "@/components/cita-formulario";
import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  BORRADOR_LEGAL,
  MENSAJE_DEMO_SOLO_LECTURA as MENSAJE_CLINICA_DEMO_UI,
  ETIQUETA_CANAL,
  ETIQUETA_ESTADO,
  ETIQUETA_EVENTO,
  ETIQUETA_SEMAFORO,
  ETIQUETA_TIPO,
  PLAZO_DIAS,
  PRORROGA_DIAS,
  RESPUESTA_SUGERIDA,
  TIPOS_DE_SOLICITUD,
  accionesPermitidas,
  estaCerrada,
  ordenarBandeja,
  puedeProrrogar,
  semaforoDePlazo,
  textoDiasRestantes,
  vencimientoVigente,
  type Semaforo,
  type TipoSolicitud,
} from "@/lib/derechos/derechos";
import {
  actualizarSolicitudTitular,
  enviarRespuestaTitularPorCorreo,
  listarSolicitudesTitular,
  prorrogarSolicitudTitular,
  registrarSolicitudTitular,
  type SolicitudDelTitular,
} from "@/lib/derechos/solicitudes.functions";
import { buscarPacientes } from "@/lib/patients/buscar-pacientes.functions";
import { fecha, fechaHora } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

const VARIANTE_SEMAFORO: Record<
  Semaforo,
  "success" | "warning" | "destructive" | "neutral" | "secondary"
> = {
  cerrada: "success",
  en_plazo: "secondary",
  por_vencer: "warning",
  vence_hoy: "warning",
  vencida: "destructive",
};

function PastillaPlazo({ s, hoy }: { s: SolicitudDelTitular; hoy: string }) {
  const { semaforo, diasRestantes } = semaforoDePlazo(s, hoy);
  if (semaforo === "cerrada") {
    return <Badge variant="success">{ETIQUETA_ESTADO[s.status]}</Badge>;
  }
  return (
    <Badge variant={VARIANTE_SEMAFORO[semaforo]}>
      {ETIQUETA_SEMAFORO[semaforo]} · {textoDiasRestantes(diasRestantes)}
    </Badge>
  );
}

interface Props {
  clinicId: string;
  isDemo: boolean;
}

/**
 * Bandeja de solicitudes de los pacientes sobre sus datos (SEG-09). Solo
 * owner/admin (ruta con `team:manage`; el servidor vuelve a exigirlo).
 */
export function BandejaSolicitudes({ clinicId, isDemo }: Props) {
  const fetchLista = useServerFn(listarSolicitudesTitular);
  const [filtro, setFiltro] = useState<"abiertas" | "todas">("abiertas");
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);

  const lista = useQuery({
    queryKey: ["solicitudes-titular", clinicId],
    queryFn: () => fetchLista({ data: { clinicId } }),
  });

  const hoy = lista.data?.hoy ?? "";
  const zona = lista.data?.zona;
  const ordenadas = useMemo(() => ordenarBandeja(lista.data?.solicitudes ?? []), [lista.data]);
  const abiertas = ordenadas.filter((s) => !estaCerrada(s.status));
  const visibles = filtro === "abiertas" ? abiertas : ordenadas;
  const conteo = (sem: Semaforo[]) =>
    abiertas.filter((s) => sem.includes(semaforoDePlazo(s, hoy).semaforo)).length;
  const vencidas = conteo(["vencida"]);
  const porVencer = conteo(["por_vencer", "vence_hoy"]);
  const actual = ordenadas.find((s) => s.id === seleccionada) ?? null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="size-4 text-primary" aria-hidden />
            Solicitudes de los pacientes sobre sus datos
          </CardTitle>
          <CardDescription>
            Lo que tus pacientes piden sobre sus datos personales: acceso, rectificación, supresión,
            oposición, portabilidad y bloqueo. Llegan desde el portal del paciente o las registras
            tú si llegaron por otro canal. Tienes {PLAZO_DIAS} días corridos desde que llegan para
            responder, prorrogables una vez por {PRORROGA_DIAS} días con motivo. Cada paso queda
            registrado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="flex items-start gap-2 rounded-lg border border-dashed border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning">
            <Scale className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {BORRADOR_LEGAL}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {abiertas.length} abierta{abiertas.length === 1 ? "" : "s"}
            </Badge>
            {porVencer > 0 ? <Badge variant="warning">{porVencer} por vencer</Badge> : null}
            {vencidas > 0 ? (
              <Badge variant="destructive">
                {vencidas} vencida{vencidas === 1 ? "" : "s"}
              </Badge>
            ) : null}
            <div className="ml-auto flex gap-2">
              <div className="inline-flex rounded-lg border border-border p-0.5" role="group">
                {(["abiertas", "todas"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={filtro === f}
                    onClick={() => setFiltro(f)}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-medium",
                      filtro === f ? "bg-muted text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {f === "abiertas" ? "Abiertas" : "Todas"}
                  </button>
                ))}
              </div>
              <AccionDeshabilitada motivo={isDemo ? MENSAJE_CLINICA_DEMO_UI : null} como="globo">
                <Button size="sm" onClick={() => setRegistrando(true)}>
                  <Plus className="size-4" aria-hidden />
                  Registrar solicitud
                </Button>
              </AccionDeshabilitada>
            </div>
          </div>
        </CardContent>
      </Card>

      {lista.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando solicitudes…
        </p>
      ) : lista.error ? (
        <p className="text-sm text-destructive">{mensajeDeError(lista.error)}</p>
      ) : visibles.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {filtro === "abiertas"
              ? "No hay solicitudes abiertas. Cuando un paciente pida algo sobre sus datos desde el portal, aparece aquí."
              : "Todavía no hay solicitudes registradas."}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {visibles.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSeleccionada(s.id)}
                className="flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {ETIQUETA_TIPO[s.kind]}
                    <span className="font-normal text-muted-foreground">· {s.patientName}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {ETIQUETA_CANAL[s.channel]} · recibida el {fecha(s.received_at, zona)}
                    {estaCerrada(s.status)
                      ? ""
                      : ` · vence el ${fecha(vencimientoVigente(s))}${s.extended_due_date ? " (prorrogada)" : ""}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!estaCerrada(s.status) ? (
                    <Badge variant="outline">{ETIQUETA_ESTADO[s.status]}</Badge>
                  ) : null}
                  <PastillaPlazo s={s} hoy={hoy} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {actual ? (
        <DetalleSolicitud
          clinicId={clinicId}
          s={actual}
          hoy={hoy}
          zona={zona}
          isDemo={isDemo}
          onClose={() => setSeleccionada(null)}
        />
      ) : null}
      {registrando ? (
        <RegistrarSolicitud clinicId={clinicId} hoy={hoy} onClose={() => setRegistrando(false)} />
      ) : null}
    </div>
  );
}

function DetalleSolicitud({
  clinicId,
  s,
  hoy,
  zona,
  isDemo,
  onClose,
}: {
  clinicId: string;
  s: SolicitudDelTitular;
  hoy: string;
  zona: string | undefined;
  isDemo: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const actualizarFn = useServerFn(actualizarSolicitudTitular);
  const prorrogarFn = useServerFn(prorrogarSolicitudTitular);
  const enviarFn = useServerFn(enviarRespuestaTitularPorCorreo);
  const [respuesta, setRespuesta] = useState("");
  const [prorrogando, setProrrogando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const refrescar = () =>
    queryClient.invalidateQueries({ queryKey: ["solicitudes-titular", clinicId] });

  const actualizar = useMutation({
    mutationFn: (accion: "en_revision" | "responder" | "rechazar") =>
      actualizarFn({ data: { clinicId, requestId: s.id, accion, respuesta } }),
    onSuccess: (_r, accion) => {
      toast.success(
        accion === "en_revision"
          ? "La solicitud pasó a revisión."
          : "Respuesta registrada. Ahora puedes enviarla por correo.",
      );
      setRespuesta("");
      void refrescar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const prorrogar = useMutation({
    mutationFn: () => prorrogarFn({ data: { clinicId, requestId: s.id, motivo } }),
    onSuccess: (r) => {
      toast.success(`Plazo prorrogado hasta el ${fecha(r.venceEl)}.`);
      setProrrogando(false);
      setMotivo("");
      void refrescar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const enviar = useMutation({
    mutationFn: () => enviarFn({ data: { clinicId, requestId: s.id } }),
    onSuccess: (r) => {
      if (!r.enviado) {
        toast.error(`No se envió: ${r.motivo ?? "error desconocido"}`);
      } else if (r.redirigidoA) {
        toast.success(
          `Modo de prueba: el correo llegó a ${r.redirigidoA}, no a ${r.destinatario}.`,
        );
      } else {
        toast.success(`Respuesta enviada a ${r.destinatario}.`);
      }
      void refrescar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const acciones = accionesPermitidas(s.status);
  const cerrada = estaCerrada(s.status);
  const sugerida = RESPUESTA_SUGERIDA[s.kind];
  const ocupado = actualizar.isPending || prorrogar.isPending || enviar.isPending;
  const motivoResponder = isDemo
    ? MENSAJE_CLINICA_DEMO_UI
    : respuesta.trim().length < 10
      ? "Escribe la respuesta (al menos 10 caracteres)."
      : null;
  const motivoProrroga = puedeProrrogar(s, hoy)
    ? null
    : s.extended_due_date
      ? "El plazo ya se prorrogó una vez."
      : "El plazo ya venció: no se puede prorrogar.";

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && !ocupado && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {ETIQUETA_TIPO[s.kind]} · {s.patientName}
          </DialogTitle>
          <DialogDescription>
            {ETIQUETA_CANAL[s.channel]} · recibida el {fechaHora(s.received_at, zona)}
            {s.registeredByName ? ` · registró ${s.registeredByName}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <PastillaPlazo s={s} hoy={hoy} />
            {!cerrada ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarClock className="size-3.5" aria-hidden />
                Responder hasta el {fecha(vencimientoVigente(s))}
                {s.extended_due_date ? ` (prorrogada; vencía el ${fecha(s.due_date)})` : ""}
              </span>
            ) : null}
            <Link
              to="/pacientes/$pacienteId"
              params={{ pacienteId: s.patientId }}
              className="ml-auto text-xs text-brand-700 underline"
            >
              Abrir ficha
            </Link>
          </div>

          <section className="space-y-1">
            <h3 className="text-xs font-medium text-muted-foreground">Lo que pide el paciente</h3>
            <p className="whitespace-pre-line rounded-lg bg-muted px-3 py-2">
              {s.detail ?? "Sin detalle."}
            </p>
            {s.extensionReason ? (
              <p className="text-xs text-muted-foreground">
                Motivo de la prórroga: {s.extensionReason}
              </p>
            ) : null}
          </section>

          {cerrada ? (
            <section className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                {ETIQUETA_ESTADO[s.status]}
                {s.respondedAt ? ` el ${fechaHora(s.respondedAt, zona)}` : ""}
                {s.respondedByName ? ` por ${s.respondedByName}` : ""}
              </h3>
              <p className="whitespace-pre-line rounded-lg border border-border px-3 py-2">
                {s.response}
              </p>
              {s.channel === "portal_automatico" ? (
                <p className="text-xs text-muted-foreground">
                  El portal la resolvió en el acto: no hace falta responderla.
                </p>
              ) : s.correoEnviado ? (
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <Mail className="size-3.5" aria-hidden /> Respuesta enviada por correo.
                </p>
              ) : (
                <AccionDeshabilitada motivo={isDemo ? MENSAJE_CLINICA_DEMO_UI : null}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={ocupado}
                    onClick={() => enviar.mutate()}
                  >
                    {enviar.isPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Mail className="size-4" aria-hidden />
                    )}
                    Enviar la respuesta por correo
                  </Button>
                </AccionDeshabilitada>
              )}
            </section>
          ) : (
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="respuesta-titular">Respuesta al paciente</Label>
                {sugerida ? (
                  <button
                    type="button"
                    className="text-xs text-brand-700 underline"
                    onClick={() => setRespuesta(sugerida.rechazo ?? sugerida.respuesta ?? "")}
                  >
                    Usar texto sugerido (borrador)
                  </button>
                ) : null}
              </div>
              <textarea
                id="respuesta-titular"
                value={respuesta}
                onChange={(e) => setRespuesta(e.target.value)}
                rows={6}
                maxLength={8000}
                className={CLASE_CAMPO}
                placeholder="Qué hiciste o por qué no procede. Si no procede, explica el fundamento."
              />
              <p className="text-xs text-muted-foreground">
                La respuesta queda registrada con tu nombre y no se puede editar después. Luego
                puedes enviarla por correo al paciente.
              </p>
            </section>
          )}

          <section className="space-y-1">
            <h3 className="text-xs font-medium text-muted-foreground">Registro</h3>
            <ol className="space-y-1 border-l border-border pl-3 text-xs">
              {s.eventos.map((e) => (
                <li key={e.id}>
                  <span className="font-medium">{ETIQUETA_EVENTO[e.event]}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {fechaHora(e.createdAt, zona)}
                    {e.actorName ? ` · ${e.actorName}` : " · portal o sistema"}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {prorrogando ? (
            <section className="space-y-2 rounded-lg border border-border p-3">
              <Label htmlFor="motivo-prorroga">
                Motivo de la prórroga (+{PRORROGA_DIAS} días, una sola vez)
              </Label>
              <textarea
                id="motivo-prorroga"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                maxLength={1000}
                className={CLASE_CAMPO}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setProrrogando(false)}>
                  Cancelar
                </Button>
                <AccionDeshabilitada
                  motivo={
                    motivo.trim().length < 10 ? "Explica el motivo (al menos 10 caracteres)." : null
                  }
                >
                  <Button size="sm" disabled={ocupado} onClick={() => prorrogar.mutate()}>
                    Prorrogar
                  </Button>
                </AccionDeshabilitada>
              </div>
            </section>
          ) : null}
        </div>

        {!cerrada ? (
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {acciones.includes("en_revision") ? (
                <AccionDeshabilitada motivo={isDemo ? MENSAJE_CLINICA_DEMO_UI : null} como="globo">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={ocupado}
                    onClick={() => actualizar.mutate("en_revision")}
                  >
                    Pasar a revisión
                  </Button>
                </AccionDeshabilitada>
              ) : null}
              {!prorrogando ? (
                <AccionDeshabilitada
                  motivo={isDemo ? MENSAJE_CLINICA_DEMO_UI : motivoProrroga}
                  como="globo"
                >
                  <Button variant="ghost" size="sm" onClick={() => setProrrogando(true)}>
                    Prorrogar plazo
                  </Button>
                </AccionDeshabilitada>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <AccionDeshabilitada motivo={motivoResponder} como="globo">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => actualizar.mutate("rechazar")}
                >
                  Rechazar fundadamente
                </Button>
              </AccionDeshabilitada>
              <AccionDeshabilitada motivo={motivoResponder} como="globo">
                <Button size="sm" disabled={ocupado} onClick={() => actualizar.mutate("responder")}>
                  {actualizar.isPending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : null}
                  Responder
                </Button>
              </AccionDeshabilitada>
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RegistrarSolicitud({
  clinicId,
  hoy,
  onClose,
}: {
  clinicId: string;
  hoy: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const buscarFn = useServerFn(buscarPacientes);
  const registrarFn = useServerFn(registrarSolicitudTitular);
  const [q, setQ] = useState("");
  const [paciente, setPaciente] = useState<{ id: string; nombre: string } | null>(null);
  const [tipo, setTipo] = useState<TipoSolicitud>("acceso");
  const [detalle, setDetalle] = useState("");
  const [recibidaEl, setRecibidaEl] = useState(hoy);

  const busqueda = useQuery({
    queryKey: ["derechos-buscar-paciente", clinicId, q],
    enabled: q.trim().length >= 2 && !paciente,
    queryFn: () => buscarFn({ data: { clinicId, q } }),
  });

  const registrar = useMutation({
    mutationFn: () =>
      registrarFn({
        data: { clinicId, patientId: paciente!.id, tipo, detalle, recibidaEl },
      }),
    onSuccess: () => {
      toast.success("Solicitud registrada. El plazo corre desde el día en que llegó.");
      void queryClient.invalidateQueries({ queryKey: ["solicitudes-titular", clinicId] });
      onClose();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const motivo = !paciente
    ? "Elige al paciente."
    : detalle.trim().length < 5
      ? "Describe lo que pide (al menos 5 caracteres)."
      : !recibidaEl
        ? "Indica cuándo llegó."
        : null;

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && !registrar.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar una solicitud recibida</DialogTitle>
          <DialogDescription>
            Para pedidos que llegaron por correo, en persona o por carta. El plazo de {PLAZO_DIAS}{" "}
            días corre desde el día en que llegó.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="derecho-paciente">Paciente</Label>
            {paciente ? (
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span>{paciente.nombre}</span>
                <button
                  type="button"
                  className="text-xs text-brand-700 underline"
                  onClick={() => {
                    setPaciente(null);
                    setQ("");
                  }}
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    id="derecho-paciente"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Nombre, RUT o teléfono"
                    className="pl-9"
                    autoComplete="off"
                  />
                </div>
                {busqueda.data?.length ? (
                  <ul className="max-h-48 overflow-y-auto rounded-lg border border-border">
                    {busqueda.data.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setPaciente({ id: p.id, nombre: p.nombre })}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          {p.nombre}
                          {p.documento ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {p.documento}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : q.trim().length >= 2 && !busqueda.isFetching ? (
                  <p className="text-xs text-muted-foreground">Sin resultados.</p>
                ) : null}
              </>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="derecho-tipo">Qué pide</Label>
              <select
                id="derecho-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoSolicitud)}
                className={CLASE_CAMPO}
              >
                {TIPOS_DE_SOLICITUD.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_TIPO[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="derecho-recibida">Llegó el</Label>
              <Input
                id="derecho-recibida"
                type="date"
                value={recibidaEl}
                max={hoy}
                onChange={(e) => setRecibidaEl(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="derecho-detalle">Detalle</Label>
            <textarea
              id="derecho-detalle"
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              rows={3}
              maxLength={2000}
              className={CLASE_CAMPO}
              placeholder="Qué pidió y por qué canal llegó"
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
