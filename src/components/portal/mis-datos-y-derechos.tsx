import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  Send,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import {
  DERECHO_EN_PORTAL,
  ETIQUETA_ESTADO,
  ETIQUETA_TIPO,
  PLAZO_DIAS,
  TIPOS_PEDIBLES_EN_PORTAL,
  estaCerrada,
  type TipoPedibleEnPortal,
} from "@/lib/derechos/derechos";
import {
  cambiarComunicacionPortal,
  descargarMisDatosPortal,
  getMisDerechosPortal,
  solicitarDerechoPortal,
} from "@/lib/derechos/portal-derechos.functions";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

const CLAVE = ["portal-mis-derechos"];

function guardarArchivo(base64: string, mime: string, nombre: string) {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const FORMATOS = [
  { formato: "pdf", etiqueta: "PDF", detalle: "Para leer o imprimir", Icono: FileText },
  { formato: "json", etiqueta: "JSON", detalle: "Para llevarlos a otro sistema", Icono: FileJson },
  {
    formato: "csv",
    etiqueta: "CSV",
    detalle: "Para abrir en una planilla",
    Icono: FileSpreadsheet,
  },
] as const;

const claseCampo =
  "w-full rounded-lg border border-border/60 bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";

/**
 * "Mis datos y mis derechos" del portal del paciente (SEG-09, Ley 21.719):
 * descargar sus datos, darse de baja de mensajes y pedirle a la clínica que
 * corrija, elimine o bloquee datos. Todo pasa por el servidor del portal.
 */
export function MisDatosYDerechos() {
  const queryClient = useQueryClient();
  const fetchEstado = useServerFn(getMisDerechosPortal);
  const descargarFn = useServerFn(descargarMisDatosPortal);
  const comunicacionFn = useServerFn(cambiarComunicacionPortal);
  const solicitarFn = useServerFn(solicitarDerechoPortal);

  const estado = useQuery({ queryKey: CLAVE, queryFn: () => fetchEstado(), retry: false });

  const [tipo, setTipo] = useState<TipoPedibleEnPortal>("rectificacion");
  const [detalle, setDetalle] = useState("");
  const [enviada, setEnviada] = useState<string | null>(null);

  const descargar = useMutation({
    mutationFn: (formato: "pdf" | "json" | "csv") => descargarFn({ data: { formato } }),
    onSuccess: (r) => {
      guardarArchivo(r.base64, r.mime, r.nombreArchivo);
      toast.success("Listo: descargaste una copia de tus datos.");
      void queryClient.invalidateQueries({ queryKey: CLAVE });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const comunicacion = useMutation({
    mutationFn: (v: { canal: "whatsapp" | "correo"; recibir: boolean }) =>
      comunicacionFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(
        v.recibir
          ? "Listo: vuelves a recibir mensajes por ese canal."
          : "Listo: ya no vas a recibir mensajes por ese canal.",
      );
      void queryClient.invalidateQueries({ queryKey: CLAVE });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const solicitar = useMutation({
    mutationFn: () => solicitarFn({ data: { tipo, detalle } }),
    onSuccess: (r) => {
      setEnviada(r.venceEl);
      setDetalle("");
      void queryClient.invalidateQueries({ queryKey: CLAVE });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (estado.isError) return null; // El resto del portal ya muestra el aviso de link vencido.
  if (estado.isLoading || !estado.data) {
    return (
      <section className="flex justify-center p-4" aria-busy="true">
        <Loader2 className="size-5 animate-spin text-brand" aria-label="Cargando tus datos" />
      </section>
    );
  }

  const { clinica, comunicaciones, solicitudes } = estado.data;
  const zona = clinica.zona;
  const derecho = DERECHO_EN_PORTAL[tipo];
  const detalleValido = tipo === "acceso" || detalle.trim().length >= 5;

  const canales = [
    {
      canal: "whatsapp" as const,
      titulo: "WhatsApp",
      Icono: MessageCircle,
      recibe: comunicaciones.whatsapp.recibe,
      bajaEl: comunicaciones.whatsapp.bajaEl,
      sinDato: !comunicaciones.whatsapp.tieneTelefono,
      detalle: "Recordatorios de citas y avisos de la clínica.",
    },
    {
      canal: "correo" as const,
      titulo: "Correo",
      Icono: Mail,
      recibe: comunicaciones.correo.recibe,
      bajaEl: comunicaciones.correo.bajaEl,
      sinDato: !comunicaciones.correo.tieneCorreo,
      detalle: "Presupuestos, documentos y novedades por correo.",
    },
  ];

  return (
    <section className="space-y-4" aria-labelledby="mis-derechos-titulo">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <div>
          <h2 id="mis-derechos-titulo" className="text-base font-semibold">
            Mis datos y mis derechos
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Por ley puedes ver tus datos, llevártelos, pedir que se corrijan o eliminen y decidir
            qué mensajes recibes de {clinica.nombre}.
          </p>
        </div>
      </div>

      {/* Acceso y portabilidad */}
      <div className="space-y-3 rounded-xl border border-border/60 bg-card p-5">
        <div className="flex items-center gap-2">
          <Download className="size-4 text-brand" aria-hidden />
          <h3 className="text-sm font-semibold">Descarga tus datos</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Una copia de tus datos personales, citas, presupuestos, pagos, documentos y
          consentimientos, con un resumen de tu ficha. Elige el formato:
        </p>
        <div className="grid gap-2">
          {FORMATOS.map(({ formato, etiqueta, detalle: d, Icono }) => (
            <button
              key={formato}
              type="button"
              disabled={descargar.isPending}
              onClick={() => descargar.mutate(formato)}
              className="flex w-full items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 disabled:opacity-50"
            >
              {descargar.isPending && descargar.variables === formato ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-brand" aria-hidden />
              ) : (
                <Icono className="size-4 shrink-0 text-brand" aria-hidden />
              )}
              <span className="font-medium">{etiqueta}</span>
              <span className="text-xs text-muted-foreground">{d}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Oposición a comunicaciones */}
      <div className="space-y-3 rounded-xl border border-border/60 bg-card p-5">
        <h3 className="text-sm font-semibold">Mensajes de la clínica</h3>
        <ul className="space-y-3">
          {canales.map((c) => (
            <li key={c.canal} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <c.Icono className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {c.titulo}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {c.recibe
                    ? c.sinDato
                      ? "La clínica no tiene este dato tuyo."
                      : c.detalle
                    : `Te diste de baja el ${fecha(c.bajaEl, zona)}.`}
                </p>
              </div>
              <button
                type="button"
                disabled={comunicacion.isPending}
                onClick={() => comunicacion.mutate({ canal: c.canal, recibir: !c.recibe })}
                className={cn(
                  "shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 disabled:opacity-50",
                  c.recibe
                    ? "border-border/60 text-foreground hover:bg-muted"
                    : "border-brand text-brand-700 hover:bg-brand-soft",
                )}
              >
                {c.recibe ? "Darme de baja" : "Volver a recibir"}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Aunque te des de baja, la clínica puede responderte cuando le escribas, y la respuesta a
          una solicitud sobre tus datos te llega igual.
        </p>
      </div>

      {/* Solicitudes */}
      <div className="space-y-3 rounded-xl border border-border/60 bg-card p-5">
        <h3 className="text-sm font-semibold">Pedir algo sobre tus datos</h3>
        {enviada ? (
          <div className="flex flex-col items-center gap-2 py-3 text-center" role="status">
            <CheckCircle2 className="size-8 text-brand" aria-hidden />
            <p className="text-sm font-medium">Solicitud enviada</p>
            <p className="text-xs text-muted-foreground">
              {clinica.nombre} tiene {PLAZO_DIAS} días corridos para responderte, hasta el{" "}
              {fecha(enviada)}. Vas a ver la respuesta aquí abajo.
            </p>
            <button
              type="button"
              onClick={() => setEnviada(null)}
              className="mt-1 text-xs text-brand-700 underline"
            >
              Hacer otra solicitud
            </button>
          </div>
        ) : (
          <>
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-xs text-muted-foreground">Qué necesitas</legend>
              {TIPOS_PEDIBLES_EN_PORTAL.map((t) => (
                <label
                  key={t}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm",
                    tipo === t ? "border-brand bg-brand-soft" : "border-border/60",
                  )}
                >
                  <input
                    type="radio"
                    name="tipo-derecho"
                    value={t}
                    checked={tipo === t}
                    onChange={() => setTipo(t)}
                    className="accent-brand"
                  />
                  {DERECHO_EN_PORTAL[t].titulo}
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-muted-foreground">{derecho.explicacion}</p>
            <div className="space-y-1.5">
              <label htmlFor="detalle-derecho" className="text-xs text-muted-foreground">
                {tipo === "acceso" ? "Detalle (opcional)" : "Detalle"}
              </label>
              <textarea
                id="detalle-derecho"
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                placeholder={derecho.placeholder}
                rows={3}
                maxLength={2000}
                className={claseCampo}
              />
            </div>
            <button
              type="button"
              disabled={!detalleValido || solicitar.isPending}
              onClick={() => solicitar.mutate()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand bg-transparent px-4 py-3 text-sm font-medium text-brand-700 disabled:opacity-50"
            >
              {solicitar.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
              Enviar solicitud
            </button>
            <p className="text-center text-xs text-muted-foreground">
              La clínica tiene {PLAZO_DIAS} días corridos para responderte.
            </p>
          </>
        )}
      </div>

      {solicitudes.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Tus solicitudes</h3>
          {solicitudes.map((s) => {
            const cerrada = estaCerrada(s.status);
            return (
              <article key={s.id} className="rounded-xl border border-border/60 bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{ETIQUETA_TIPO[s.kind]}</p>
                  <span
                    className={cn(
                      "shrink-0 rounded-sm border px-2 py-0.5 text-xs font-medium",
                      cerrada
                        ? "border-success-border bg-success-soft text-success"
                        : "border-border bg-muted text-foreground",
                    )}
                  >
                    {ETIQUETA_ESTADO[s.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {s.channel === "portal_automatico" ? "Resuelta en el acto" : "Pedida"} el{" "}
                  {fecha(s.receivedAt, zona)}
                  {cerrada ? "" : ` · respuesta hasta el ${fecha(s.venceEl)}`}
                </p>
                {cerrada && s.response && s.channel !== "portal_automatico" ? (
                  <p className="mt-2 whitespace-pre-line rounded-lg bg-muted px-3 py-2 text-sm">
                    {s.response}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
