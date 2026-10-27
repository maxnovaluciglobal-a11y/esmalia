import { useEffect, useId, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarX, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

import { CLASE_CAMPO, GrupoDeChips } from "@/components/cita-formulario";
import {
  AvisoPublico,
  EncabezadoPublico,
  PANEL_PUBLICO,
} from "@/components/notificaciones/piezas-publicas";
import { PublicPageShell } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { preguntasPorGrupo, type CuestionarioRiesgo } from "@/lib/clinical/anamnesis";
import { fechaLarga, hora } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import {
  CAMPOS_CONTACTO,
  listaDesdeTexto,
  type Contacto,
} from "@/lib/notificaciones-pacientes/formulario";
import {
  abrirFormularioPrevio,
  enviarFormularioPrevio,
  type EstadoFormulario,
  type FormularioAbierto,
} from "@/lib/notificaciones-pacientes/formulario.functions";
import { cn } from "@/lib/utils";

/**
 * MKT-07 · Formulario antes de la cita: `<dominio>/formulario/<token>`.
 *
 * Página pública, sin login y sin índice. El token viaja solo en el path; el
 * servidor guarda su sha256. El paciente (o su tutor) actualiza sus datos de
 * contacto y responde el cuestionario de salud de la ficha. Lo que envía NO
 * cambia la ficha: queda pendiente hasta que el equipo clínico lo acepta.
 */
export const Route = createFileRoute("/formulario/$token")({
  head: () => ({
    meta: [
      { title: "Antes de tu cita · Esmalia" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: FormularioPage,
});

type Paso =
  | { tipo: "cargando" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "fin"; estado: EstadoFormulario; clinica: string | null }
  | { tipo: "abierto"; info: FormularioAbierto };

function FormularioPage() {
  const { token } = Route.useParams();
  const abrir = useServerFn(abrirFormularioPrevio);
  const [paso, setPaso] = useState<Paso>({ tipo: "cargando" });

  useEffect(() => {
    let vivo = true;
    abrir({ data: { token } })
      .then((info) => {
        if (!vivo) return;
        setPaso(
          info.estado === "abierto"
            ? { tipo: "abierto", info }
            : { tipo: "fin", estado: info.estado, clinica: info.clinica },
        );
      })
      .catch((e) => vivo && setPaso({ tipo: "error", mensaje: mensajeDeError(e) }));
    return () => {
      vivo = false;
    };
  }, [token, abrir]);

  return (
    <PublicPageShell mainClassName="max-w-3xl px-4 sm:px-6">
      {paso.tipo === "cargando" && (
        <p className="flex items-center justify-center gap-2 py-20 text-base text-muted-foreground">
          <Loader2 className="size-5 animate-spin text-brand" aria-hidden /> Abriendo…
        </p>
      )}
      {paso.tipo === "error" && (
        <AvisoPublico
          icono={<XCircle className="size-8 text-destructive" aria-hidden />}
          titulo="No pudimos abrir el formulario"
        >
          <p>{paso.mensaje}</p>
        </AvisoPublico>
      )}
      {paso.tipo === "fin" && <Fin estado={paso.estado} clinica={paso.clinica} />}
      {paso.tipo === "abierto" && (
        <Cuestionario
          token={token}
          info={paso.info}
          onTerminado={(estado) => setPaso({ tipo: "fin", estado, clinica: paso.info.clinica })}
        />
      )}
    </PublicPageShell>
  );
}

function Fin({ estado, clinica }: { estado: EstadoFormulario; clinica: string | null }) {
  const nombre = clinica ?? "la clínica";
  switch (estado) {
    case "enviado":
      return (
        <AvisoPublico
          icono={<CheckCircle2 className="size-8 text-success" aria-hidden />}
          titulo="¡Listo, gracias!"
        >
          <p>{nombre} recibió tus respuestas. El equipo las revisa antes de tu cita.</p>
          <p>Puedes cerrar esta página.</p>
        </AvisoPublico>
      );
    case "respondido":
      return (
        <AvisoPublico
          icono={<CheckCircle2 className="size-8 text-success" aria-hidden />}
          titulo="Este formulario ya se envió"
        >
          <p>
            {nombre} ya tiene tus respuestas. Si quieres cambiar algo, coméntalo en tu cita o
            escríbele a la clínica.
          </p>
        </AvisoPublico>
      );
    case "vencido":
      return (
        <AvisoPublico
          icono={<Clock className="size-8 text-warning" aria-hidden />}
          titulo="Este link ya venció"
        >
          <p>El formulario se podía completar hasta la hora de la cita.</p>
        </AvisoPublico>
      );
    case "cita_cancelada":
      return (
        <AvisoPublico
          icono={<CalendarX className="size-8 text-muted-foreground" aria-hidden />}
          titulo="La cita fue cancelada"
        >
          <p>Este formulario era para una cita que ya no está agendada.</p>
        </AvisoPublico>
      );
    default:
      return (
        <AvisoPublico
          icono={<XCircle className="size-8 text-destructive" aria-hidden />}
          titulo="Este link no es válido"
        >
          <p>Revisa que lo hayas abierto completo desde el correo de la clínica.</p>
        </AvisoPublico>
      );
  }
}

function Cuestionario({
  token,
  info,
  onTerminado,
}: {
  token: string;
  info: FormularioAbierto;
  onTerminado: (estado: EstadoFormulario) => void;
}) {
  const fid = useId();
  const enviar = useServerFn(enviarFormularioPrevio);
  const [contacto, setContacto] = useState<Contacto>(info.contacto);
  const [cuestionario, setCuestionario] = useState<CuestionarioRiesgo>({});
  const [alergias, setAlergias] = useState("");
  const [medicacion, setMedicacion] = useState("");
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onEnviar() {
    setEnviando(true);
    setError(null);
    try {
      const contactoLimpio = Object.fromEntries(
        Object.entries(contacto).map(([k, v]) => [k, v?.trim() || undefined]),
      );
      const r = await enviar({
        data: {
          token,
          contacto: contactoLimpio,
          cuestionario,
          alergias: listaDesdeTexto(alergias),
          medicacion: listaDesdeTexto(medicacion),
          comentario: comentario.trim() || undefined,
        },
      });
      window.scrollTo({ top: 0 });
      onTerminado(r.estado);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  const tipoCampo: Partial<Record<keyof Contacto, string>> = {
    email: "email",
    phone: "tel",
    emergency_contact_phone: "tel",
  };

  return (
    <div className="space-y-8">
      <EncabezadoPublico
        antetitulo="Formulario antes de la cita"
        titulo="Antes de tu cita en"
        enfasis={info.clinica}
      >
        <p>
          {info.nombre ? `Hola, ${info.nombre}. ` : ""}
          {info.cita
            ? `La cita es el ${fechaLarga(info.cita, info.zona)} a las ${hora(info.cita, info.zona)}. `
            : ""}
          Toma unos 3 minutos. Lo que envías lo revisa el equipo clínico antes de pasarlo a la
          ficha.
        </p>
      </EncabezadoPublico>

      <section aria-labelledby={`${fid}-contacto`} className={cn(PANEL_PUBLICO, "space-y-4 p-5")}>
        <h2 id={`${fid}-contacto`} className="font-display text-2xl font-medium">
          Datos de contacto
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {CAMPOS_CONTACTO.map((c) => (
            <div key={c.key} className="space-y-1.5">
              <Label htmlFor={`${fid}-${c.key}`}>{c.label}</Label>
              <input
                id={`${fid}-${c.key}`}
                type={tipoCampo[c.key] ?? "text"}
                autoComplete={
                  c.key === "email"
                    ? "email"
                    : c.key === "phone"
                      ? "tel"
                      : c.key === "address"
                        ? "street-address"
                        : "off"
                }
                maxLength={c.key === "address" ? 200 : 120}
                value={contacto[c.key] ?? ""}
                onChange={(e) => setContacto((prev) => ({ ...prev, [c.key]: e.target.value }))}
                className={cn(CLASE_CAMPO, "text-base")}
              />
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby={`${fid}-salud`} className={cn(PANEL_PUBLICO, "space-y-5 p-5")}>
        <div>
          <h2 id={`${fid}-salud`} className="font-display text-2xl font-medium">
            Tu salud
          </h2>
          <p className="mt-1 text-base text-muted-foreground">
            Responde lo que sepas. Lo que dejes sin responder se conversa en la cita.
          </p>
        </div>
        {/* FIC-09: las mismas preguntas que la ficha, por grupo. */}
        {preguntasPorGrupo().map((g) => (
          <div key={g.key} className="space-y-1">
            <h3 className="font-display text-xl font-semibold">{g.label}</h3>
            <ul className="divide-y divide-hairline">
              {g.preguntas.map((p) => {
                const r = cuestionario[p.key];
                return (
                  <li key={p.key} className="space-y-2 py-3 first:pt-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-medium">{p.label}</p>
                        {p.ayuda && <p className="text-sm text-muted-foreground">{p.ayuda}</p>}
                      </div>
                      <GrupoDeChips
                        id={`${fid}-${p.key}`}
                        etiqueta={p.label}
                        permitirVacio
                        opciones={[
                          { value: "yes", label: "Sí" },
                          { value: "no", label: "No" },
                        ]}
                        value={r?.answer ?? null}
                        onChange={(v) =>
                          setCuestionario((prev) => {
                            const siguiente = { ...prev };
                            if (v === "yes" || v === "no") {
                              siguiente[p.key] = { answer: v, detail: prev[p.key]?.detail };
                            } else {
                              delete siguiente[p.key];
                            }
                            return siguiente;
                          })
                        }
                      />
                    </div>
                    {r?.answer === "yes" && (
                      <input
                        aria-label={`Detalle: ${p.label}`}
                        placeholder="Cuéntanos un poco más (opcional)"
                        maxLength={300}
                        value={r.detail ?? ""}
                        onChange={(e) =>
                          setCuestionario((prev) => ({
                            ...prev,
                            [p.key]: { answer: "yes", detail: e.target.value },
                          }))
                        }
                        className={cn(CLASE_CAMPO, "text-base")}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-alergias`}>Alergias</Label>
          <textarea
            id={`${fid}-alergias`}
            rows={2}
            placeholder="Por ejemplo: penicilina, látex. Una por línea o separadas por coma."
            value={alergias}
            onChange={(e) => setAlergias(e.target.value)}
            className={cn(CLASE_CAMPO, "text-base")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-medicacion`}>Medicamentos que tomas</Label>
          <textarea
            id={`${fid}-medicacion`}
            rows={2}
            placeholder="Nombre y dosis, si la sabes."
            value={medicacion}
            onChange={(e) => setMedicacion(e.target.value)}
            className={cn(CLASE_CAMPO, "text-base")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-comentario`}>¿Algo más que la clínica deba saber?</Label>
          <textarea
            id={`${fid}-comentario`}
            rows={3}
            maxLength={1000}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            className={cn(CLASE_CAMPO, "text-base")}
          />
        </div>
      </section>

      {error && (
        <p role="alert" className="text-base text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Solo lo ve el equipo de {info.clinica ?? "la clínica"}. Se envía una sola vez.
        </p>
        <Button className="h-12 rounded-full px-6 text-base" onClick={onEnviar} disabled={enviando}>
          {enviando && <Loader2 className="animate-spin" aria-hidden />}
          Enviar a la clínica
        </Button>
      </div>
    </div>
  );
}
