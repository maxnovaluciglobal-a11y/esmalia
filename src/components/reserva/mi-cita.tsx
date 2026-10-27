import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, CheckCircle2, Loader2, MapPin, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fechaLarga, hora as horaDe } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import type { HoraDisponible } from "@/lib/reserva/disponibilidad-reserva";
import { horaCorta, horaLocalTexto } from "@/lib/reserva/hora-local";
import {
  cancelarMiCita,
  confirmarMiCita,
  horasParaReagendar,
  reagendarMiCita,
  verMiCita,
  type MiCita,
} from "@/lib/reserva/mi-cita.functions";

import { Aviso } from "./flujo-reserva";
import { EncabezadoReserva, ResumenEnTintaReserva, SelectorDeHora } from "./piezas";

/**
 * Gestión de la cita por link (RES-05 + REC-11): ver, avisar que va,
 * cancelar o cambiar la hora. "Confirmé que voy" es el aviso del paciente;
 * la cita sigue "por confirmar" hasta que la acepta el profesional.
 */

const ESTADO_LEGIBLE: Record<string, string> = {
  tentativa: "Por confirmar por la clínica",
  confirmada: "Confirmada por la clínica",
  "en-sala": "En atención",
  finalizada: "Atendida",
  ausente: "No asististe",
  cancelada: "Cancelada",
};

export function GestionMiCita({ token }: { token: string }) {
  const ver = useServerFn(verMiCita);
  const q = useQuery({
    queryKey: ["mi-cita", token],
    queryFn: () => ver({ data: { token } }),
    retry: false,
  });
  if (q.isPending) {
    return (
      <p className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin text-brand" aria-hidden /> Abriendo tu cita…
      </p>
    );
  }
  if (q.isError) return <Aviso titulo="No pudimos abrir tu cita">{mensajeDeError(q.error)}</Aviso>;
  return <Detalle token={token} cita={q.data} />;
}

type Modo = "ver" | "cancelar" | "reagendar";

function Detalle({ token, cita }: { token: string; cita: MiCita }) {
  const qc = useQueryClient();
  const confirmar = useServerFn(confirmarMiCita);
  const cancelar = useServerFn(cancelarMiCita);
  const [modo, setModo] = useState<Modo>("ver");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [motivo, setMotivo] = useState("");

  const recargar = () => qc.invalidateQueries({ queryKey: ["mi-cita", token] });
  async function accion(
    fn: () => Promise<{ ok: true } | { ok: false; motivo: string }>,
    ok: string,
  ) {
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await fn();
      if (r.ok) {
        setAviso(ok);
        setModo("ver");
        await recargar();
      } else setError(r.motivo);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setOcupado(false);
    }
  }

  const cancelada = cita.estado === "cancelada";
  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <EncabezadoReserva
        contexto={
          <>
            <b className="font-semibold text-foreground/80">{cita.clinica}</b>
            {cita.paciente ? <span> · Hola, {cita.paciente}</span> : null}
          </>
        }
        antes="Tu"
        enfasis="cita"
      />

      <ResumenEnTintaReserva
        titulo={
          <>
            {fechaLarga(cita.inicio, cita.zona)},{" "}
            <span className="text-brand-on-night">{horaDe(cita.inicio, cita.zona)}</span>
          </>
        }
        filas={[
          { etiqueta: "Motivo", valor: cita.motivo },
          { etiqueta: "Profesional", valor: cita.profesional },
          { etiqueta: "Estado", valor: ESTADO_LEGIBLE[cita.estado] ?? cita.estado },
        ]}
      />

      {(cita.pacienteConfirmo && !cancelada) || cancelada ? (
        <div className="flex flex-wrap gap-2">
          {cita.pacienteConfirmo && !cancelada ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-success-border bg-success-soft px-3 text-sm font-semibold text-success">
              <CheckCircle2 className="size-4" aria-hidden /> Avisaste que vas
            </span>
          ) : null}
          {cancelada ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive-soft px-3 text-sm font-semibold text-destructive">
              <XCircle className="size-4" aria-hidden /> Cancelada
            </span>
          ) : null}
        </div>
      ) : null}

      {cita.sucursal ? (
        <p className="flex items-start gap-2 text-base">
          <MapPin className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            {cita.sucursal}
            {cita.direccion ? ` · ${cita.direccion}` : ""}
            {cita.telefonoClinica ? ` · ${cita.telefonoClinica}` : ""}
          </span>
        </p>
      ) : null}

      {aviso ? (
        <p role="status" className="rounded-[12px] border border-hairline bg-card p-4 text-base">
          {aviso}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {cita.gestionable && modo === "ver" ? (
        <div className="grid gap-3">
          {!cita.pacienteConfirmo ? (
            <Button
              size="lg"
              className="h-12 text-base"
              disabled={ocupado}
              onClick={() =>
                accion(() => confirmar({ data: { token } }), "Listo: la clínica ya sabe que vas.")
              }
            >
              {ocupado ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
              Confirmar que voy
            </Button>
          ) : null}
          {cita.puedeReagendar ? (
            <Button
              size="lg"
              variant="outline"
              className="h-12 text-base"
              onClick={() => setModo("reagendar")}
            >
              <CalendarClock className="size-5" aria-hidden /> Cambiar la hora
            </Button>
          ) : null}
          <Button
            size="lg"
            variant="outline"
            className="h-12 text-base text-destructive hover:text-destructive"
            onClick={() => setModo("cancelar")}
          >
            Cancelar la cita
          </Button>
        </div>
      ) : null}

      {modo === "cancelar" ? (
        <section className="space-y-3 rounded-[14px] border border-border bg-card p-4">
          <h2 className="font-display text-2xl font-medium">¿Cancelar tu cita?</h2>
          <p className="text-base text-muted-foreground">
            La hora queda libre para otra persona. Si quieres, cuéntale a la clínica por qué.
          </p>
          <label htmlFor="mi-cita-motivo" className="sr-only">
            Motivo (opcional)
          </label>
          <textarea
            id="mi-cita-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Motivo (opcional)"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="lg"
              className="h-12 flex-1 text-base"
              onClick={() => setModo("ver")}
            >
              Volver
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="h-12 flex-1 text-base"
              disabled={ocupado}
              onClick={() =>
                accion(
                  () => cancelar({ data: { token, motivo } }),
                  "Tu cita quedó cancelada. La clínica ya fue avisada en su agenda.",
                )
              }
            >
              Sí, cancelar
            </Button>
          </div>
        </section>
      ) : null}

      {modo === "reagendar" ? (
        <Reagendar
          token={token}
          onVolver={() => setModo("ver")}
          onListo={async () => {
            setAviso("Cambiamos tu hora. Queda por confirmar: la clínica la revisa y te avisa.");
            setModo("ver");
            await recargar();
          }}
        />
      ) : null}

      {!cita.gestionable && !cancelada ? (
        <p className="text-base text-muted-foreground">
          Esta cita ya no se puede cambiar desde el link. Si necesitas algo, llama a la clínica.
        </p>
      ) : null}
    </div>
  );
}

function Reagendar({
  token,
  onVolver,
  onListo,
}: {
  token: string;
  onVolver: () => void;
  onListo: () => Promise<void>;
}) {
  const horasFn = useServerFn(horasParaReagendar);
  const reagendar = useServerFn(reagendarMiCita);
  const [desde, setDesde] = useState<string | undefined>(undefined);
  const [fecha, setFecha] = useState<string | null>(null);
  const [hora, setHora] = useState<HoraDisponible | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const q = useQuery({
    queryKey: ["mi-cita-horas", token, desde ?? null],
    queryFn: () => horasFn({ data: { token, desde } }),
    retry: false,
  });
  const dias = q.data?.dias ?? [];
  const fechaVisible = fecha ?? dias.find((d) => d.horas.length > 0)?.fecha ?? null;

  async function guardar() {
    if (!hora || !fechaVisible) return;
    setError(null);
    setGuardando(true);
    try {
      const r = await reagendar({
        data: { token, inicio: horaLocalTexto(fechaVisible, hora.inicio) },
      });
      if (r.ok) await onListo();
      else setError(r.motivo);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="space-y-4 rounded-[14px] border border-border bg-card p-4">
      <h2 className="font-display text-2xl font-medium">Elige otra hora</h2>
      {q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {mensajeDeError(q.error)}
        </p>
      ) : (
        <SelectorDeHora
          dias={dias}
          fecha={fechaVisible}
          onFecha={(f) => {
            setFecha(f);
            setHora(null);
          }}
          hora={hora}
          onHora={setHora}
          cargando={q.isPending}
          hayMas={Boolean(q.data?.siguienteDesde)}
          onMasDias={() => {
            if (q.data?.siguienteDesde) {
              setDesde(q.data.siguienteDesde);
              setFecha(null);
              setHora(null);
            }
          }}
        />
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button variant="outline" size="lg" className="h-12 flex-1 text-base" onClick={onVolver}>
          Volver
        </Button>
        <Button
          size="lg"
          className="h-12 flex-1 text-base"
          disabled={!hora || guardando}
          onClick={guardar}
        >
          {guardando ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
          {hora ? `Cambiar a las ${horaCorta(hora.inicio)}` : "Cambiar la hora"}
        </Button>
      </div>
    </section>
  );
}
