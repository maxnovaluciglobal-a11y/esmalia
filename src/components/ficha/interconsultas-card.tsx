/**
 * FIC-14 · Interconsultas en la ficha (Ola 9): pedir una derivación a otro
 * especialista, emitir su documento con la plantilla de derivación (Ola 4),
 * marcarla enviada, registrar la respuesta y cerrarla, o cancelarla con su
 * motivo. Las transiciones las valida la base; acá solo se ofrecen las que
 * corresponden a cada estado.
 */
import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Loader2, Plus, Send } from "lucide-react";
import { toast } from "sonner";

import { CLASE_CAMPO, GrupoDeChips } from "@/components/cita-formulario";
import { Label } from "@/components/ui/label";
import {
  ESPECIALIDADES_SUGERIDAS,
  ETIQUETA_ESTADO_INTERCONSULTA,
  ETIQUETA_URGENCIA,
  URGENCIAS_INTERCONSULTA,
  estaAbierta,
  nuevaInterconsultaSchema,
  puedePasarA,
  type CambioDeEstado,
  type EstadoInterconsulta,
  type Interconsulta,
  type UrgenciaInterconsulta,
} from "@/lib/clinical/interconsultas";
import {
  cambiarEstadoInterconsulta,
  crearInterconsulta,
  emitirDerivacion,
  listInterconsultas,
} from "@/lib/clinical/interconsultas.functions";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

const TONO_ESTADO: Record<EstadoInterconsulta, string> = {
  pedida: "border-warning-border bg-warning-soft text-warning",
  enviada: "border-info-border bg-info-soft text-info",
  respondida: "border-success-border bg-success-soft text-success",
  cerrada: "border-control text-muted-foreground",
  cancelada: "border-control text-muted-foreground line-through",
};

export function InterconsultasCard({
  clinicId,
  patientId,
  puedeEditar,
  puedeEmitir,
  timezone,
}: {
  clinicId: string;
  patientId: string;
  puedeEditar: boolean;
  /** Emitir documentos: owner/admin/dentist (como "Emitir documento"). */
  puedeEmitir: boolean;
  timezone: string;
}) {
  const listar = useServerFn(listInterconsultas);
  const consulta = useQuery({
    queryKey: ["interconsultas", clinicId, patientId],
    queryFn: () => listar({ data: { clinicId, patientId } }),
  });
  const [nueva, setNueva] = useState(false);
  const lista = consulta.data ?? [];
  const abiertas = lista.filter((i) => estaAbierta(i.status)).length;

  return (
    <section
      aria-labelledby="interconsultas-titulo"
      className="rounded-panel border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="interconsultas-titulo"
            className="font-display text-[30px] leading-none font-medium tracking-[-0.01em]"
          >
            Interconsultas
            {abiertas > 0 && (
              <>
                {" "}
                <em className="text-brand-600">
                  · <span className="cifra not-italic">{abiertas}</span>{" "}
                  {abiertas === 1 ? "abierta" : "abiertas"}
                </em>
              </>
            )}
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Derivaciones a otro especialista, con su documento y la respuesta.
          </p>
        </div>
        {puedeEditar && !nueva && (
          <button
            type="button"
            onClick={() => setNueva(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-foreground bg-foreground px-3.5 text-sm font-semibold text-background pointer-coarse:h-11"
          >
            <Plus className="size-4" aria-hidden /> Pedir interconsulta
          </button>
        )}
      </div>

      {nueva && (
        <FormularioInterconsulta
          clinicId={clinicId}
          patientId={patientId}
          onCerrar={() => setNueva(false)}
        />
      )}

      <div className="mt-4">
        {consulta.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando interconsultas…
          </p>
        ) : consulta.isError ? (
          <p className="text-sm text-muted-foreground">{mensajeDeError(consulta.error)}</p>
        ) : lista.length === 0 ? (
          <p className="text-base text-muted-foreground">
            Este paciente no tiene interconsultas registradas.
          </p>
        ) : (
          <ul className="space-y-3">
            {lista.map((i) => (
              <TarjetaInterconsulta
                key={i.id}
                clinicId={clinicId}
                patientId={patientId}
                interconsulta={i}
                timezone={timezone}
                puedeEditar={puedeEditar}
                puedeEmitir={puedeEmitir}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TarjetaInterconsulta({
  clinicId,
  patientId,
  interconsulta: i,
  timezone,
  puedeEditar,
  puedeEmitir,
}: {
  clinicId: string;
  patientId: string;
  interconsulta: Interconsulta;
  timezone: string;
  puedeEditar: boolean;
  puedeEmitir: boolean;
}) {
  const fid = useId();
  const [accion, setAccion] = useState<"respondida" | "cancelada" | null>(null);
  const [texto, setTexto] = useState("");
  const queryClient = useQueryClient();
  const invalidar = () =>
    queryClient.invalidateQueries({ queryKey: ["interconsultas", clinicId, patientId] });

  const cambiar = useServerFn(cambiarEstadoInterconsulta);
  const cambio = useMutation({
    mutationFn: (c: CambioDeEstado) => cambiar({ data: { clinicId, referralId: i.id, ...c } }),
    onSuccess: (_r, c) => {
      void invalidar();
      setAccion(null);
      setTexto("");
      toast.success(`Interconsulta ${ETIQUETA_ESTADO_INTERCONSULTA[c.estado].toLowerCase()}.`);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const emitir = useServerFn(emitirDerivacion);
  const emision = useMutation({
    mutationFn: () => emitir({ data: { clinicId, referralId: i.id } }),
    onSuccess: () => {
      void invalidar();
      void queryClient.invalidateQueries({ queryKey: ["documentos-emitidos"] });
      toast.success("Documento de derivación emitido. Lo encuentras también en Documentos.");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const ocupado = cambio.isPending || emision.isPending;
  const boton =
    "inline-flex h-9 items-center gap-1.5 rounded-full border border-control px-3.5 text-sm font-semibold hover:border-foreground disabled:opacity-50 pointer-coarse:h-11";

  return (
    <li className="rounded-[14px] border border-hairline p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold">
            {i.specialty}
            {i.destination && <span className="font-normal"> · {i.destination}</span>}
          </p>
          <p className="text-sm text-muted-foreground">
            Pedida el {fecha(i.requestedAt, timezone)}
            {i.requestedByName ? ` por ${i.requestedByName}` : ""}
            {i.destinationContact ? ` · ${i.destinationContact}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {i.urgency !== "normal" && (
            <span className="inline-flex h-[26px] items-center rounded-full border border-destructive-border bg-destructive-soft px-2.5 text-[12.5px] font-semibold text-destructive">
              {ETIQUETA_URGENCIA[i.urgency]}
            </span>
          )}
          <span
            className={cn(
              "inline-flex h-[26px] items-center rounded-full border px-2.5 text-[12.5px] font-semibold",
              TONO_ESTADO[i.status],
            )}
          >
            {ETIQUETA_ESTADO_INTERCONSULTA[i.status]}
          </span>
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-[15px]">
        <div>
          <dt className="text-[13px] font-semibold text-muted-foreground">Motivo</dt>
          <dd className="whitespace-pre-wrap">{i.reason}</dd>
        </div>
        {i.request && (
          <div>
            <dt className="text-[13px] font-semibold text-muted-foreground">Se solicita</dt>
            <dd className="whitespace-pre-wrap">{i.request}</dd>
          </div>
        )}
        {i.response && (
          <div className="rounded-[12px] bg-secondary/60 px-3 py-2">
            <dt className="text-[13px] font-semibold text-muted-foreground">
              Respuesta{i.respondedAt ? ` · ${fecha(i.respondedAt, timezone)}` : ""}
            </dt>
            <dd className="whitespace-pre-wrap">{i.response}</dd>
          </div>
        )}
        {i.cancelReason && (
          <div>
            <dt className="text-[13px] font-semibold text-muted-foreground">
              Cancelada{i.cancelledAt ? ` el ${fecha(i.cancelledAt, timezone)}` : ""}
            </dt>
            <dd className="whitespace-pre-wrap text-muted-foreground">{i.cancelReason}</dd>
          </div>
        )}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        {i.issuedDocumentId ? (
          <Link
            to="/documentos/$documentoId"
            params={{ documentoId: i.issuedDocumentId }}
            className={boton}
          >
            <FileText className="size-4" aria-hidden /> Ver derivación
          </Link>
        ) : (
          puedeEmitir &&
          i.status !== "cancelada" && (
            <button
              type="button"
              onClick={() => emision.mutate()}
              disabled={ocupado}
              className={boton}
            >
              {emision.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <FileText className="size-4" aria-hidden />
              )}
              Emitir derivación
            </button>
          )
        )}
        {puedeEditar && puedePasarA(i.status, "enviada") && (
          <button
            type="button"
            onClick={() => cambio.mutate({ estado: "enviada" })}
            disabled={ocupado}
            className={boton}
          >
            <Send className="size-4" aria-hidden /> Marcar enviada
          </button>
        )}
        {puedeEditar && puedePasarA(i.status, "respondida") && accion !== "respondida" && (
          <button
            type="button"
            onClick={() => setAccion("respondida")}
            disabled={ocupado}
            className={boton}
          >
            Registrar respuesta
          </button>
        )}
        {puedeEditar && puedePasarA(i.status, "cerrada") && (
          <button
            type="button"
            onClick={() => cambio.mutate({ estado: "cerrada" })}
            disabled={ocupado}
            className={boton}
          >
            Cerrar
          </button>
        )}
        {puedeEditar && puedePasarA(i.status, "cancelada") && accion !== "cancelada" && (
          <button
            type="button"
            onClick={() => setAccion("cancelada")}
            disabled={ocupado}
            className={cn(boton, "text-muted-foreground")}
          >
            Cancelar interconsulta
          </button>
        )}
      </div>

      {accion && (
        <div className="mt-3 space-y-2">
          <Label htmlFor={`${fid}-texto`}>
            {accion === "respondida" ? "Respuesta del especialista" : "Motivo de la cancelación"}
          </Label>
          <textarea
            id={`${fid}-texto`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={accion === "respondida" ? 4 : 2}
            maxLength={accion === "respondida" ? 4000 : 500}
            className={cn(CLASE_CAMPO, "text-base")}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAccion(null);
                setTexto("");
              }}
              className={boton}
            >
              Volver
            </button>
            <button
              type="button"
              onClick={() =>
                cambio.mutate(
                  accion === "respondida"
                    ? { estado: "respondida", response: texto }
                    : { estado: "cancelada", cancelReason: texto },
                )
              }
              disabled={ocupado || texto.trim().length < (accion === "respondida" ? 2 : 3)}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-foreground bg-foreground px-3.5 text-sm font-semibold text-background disabled:opacity-50 pointer-coarse:h-11"
            >
              {cambio.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {accion === "respondida" ? "Guardar respuesta" : "Cancelar interconsulta"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function FormularioInterconsulta({
  clinicId,
  patientId,
  onCerrar,
}: {
  clinicId: string;
  patientId: string;
  onCerrar: () => void;
}) {
  const fid = useId();
  const [especialidad, setEspecialidad] = useState("");
  const [destino, setDestino] = useState("");
  const [contacto, setContacto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [solicitud, setSolicitud] = useState("");
  const [urgencia, setUrgencia] = useState<UrgenciaInterconsulta>("normal");
  const entrada = {
    specialty: especialidad,
    destination: destino,
    destinationContact: contacto,
    reason: motivo,
    request: solicitud,
    urgency: urgencia,
  };
  const validacion = nuevaInterconsultaSchema.safeParse(entrada);
  const queryClient = useQueryClient();
  const crear = useServerFn(crearInterconsulta);
  const mutacion = useMutation({
    mutationFn: () => crear({ data: { clinicId, patientId, ...entrada } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["interconsultas", clinicId, patientId] });
      toast.success("Interconsulta pedida. Puedes emitir su documento de derivación.");
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  const campo = cn(CLASE_CAMPO, "text-base");

  return (
    <div className="mt-4 space-y-4 rounded-[14px] border border-foreground/20 p-4">
      <p className="font-display text-xl font-semibold">Pedir interconsulta</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-esp`}>Especialidad</Label>
          <input
            id={`${fid}-esp`}
            list={`${fid}-especialidades`}
            value={especialidad}
            onChange={(e) => setEspecialidad(e.target.value)}
            maxLength={80}
            placeholder="Ej. Cirugía maxilofacial"
            className={campo}
          />
          <datalist id={`${fid}-especialidades`}>
            {ESPECIALIDADES_SUGERIDAS.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-destino`}>Profesional o centro (opcional)</Label>
          <input
            id={`${fid}-destino`}
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            maxLength={160}
            placeholder="Ej. Dr. Pérez, Clínica Alemana"
            className={campo}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-contacto`}>Contacto (opcional)</Label>
          <input
            id={`${fid}-contacto`}
            value={contacto}
            onChange={(e) => setContacto(e.target.value)}
            maxLength={160}
            placeholder="Teléfono o correo"
            className={campo}
          />
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium" id={`${fid}-urg`}>
            Urgencia
          </span>
          <GrupoDeChips
            id={`${fid}-urgencia`}
            etiqueta="Urgencia"
            opciones={URGENCIAS_INTERCONSULTA.map((u) => ({
              value: u,
              label: ETIQUETA_URGENCIA[u],
            }))}
            value={urgencia}
            onChange={(v) => setUrgencia((v as UrgenciaInterconsulta) ?? "normal")}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${fid}-motivo`}>Motivo</Label>
        <textarea
          id={`${fid}-motivo`}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Ej. Tercer molar inferior incluido con relación al nervio dentario."
          className={campo}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${fid}-solicitud`}>Qué se solicita (opcional)</Label>
        <textarea
          id={`${fid}-solicitud`}
          value={solicitud}
          onChange={(e) => setSolicitud(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Ej. Evaluación y exodoncia, con informe."
          className={campo}
        />
      </div>
      {!validacion.success && (especialidad || motivo) && (
        <p className="text-sm text-destructive">{validacion.error.issues[0]?.message}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCerrar}
          className="inline-flex h-10 items-center rounded-full border border-control px-4 text-sm font-semibold hover:border-foreground pointer-coarse:h-11"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => mutacion.mutate()}
          disabled={!validacion.success || mutacion.isPending}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-foreground bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50 pointer-coarse:h-11"
        >
          {mutacion.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Pedir interconsulta
        </button>
      </div>
    </div>
  );
}
