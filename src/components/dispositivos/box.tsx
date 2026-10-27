import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Megaphone } from "lucide-react";

import {
  RelojDeSucursal,
  type ContextoDispositivo,
} from "@/components/dispositivos/pantalla-dispositivo";
import {
  estadoDeBox,
  llamarDesdeBox,
  type CitaEnBox,
  type EstadoBox,
} from "@/lib/dispositivos/dispositivo-publico.functions";
import { mensajeDeError } from "@/lib/mensaje-error";
import { SEGUNDOS_REFRESCO_BOX } from "@/lib/totem/totem";

/**
 * Pantalla del box (AUT-05): la cita actual y la siguiente, con datos
 * mínimos (hora, nombre corto, tratamiento), y "Llamar al siguiente", que
 * solo se habilita si esa persona ya marcó su llegada. El llamado aparece en
 * la TV de la sala.
 */

const ESTADO: Record<string, string> = {
  tentativa: "Por confirmar",
  confirmada: "Confirmada",
  "en-sala": "En sala",
  finalizada: "Atendida",
};

function hora(iso: string, zona: string) {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: zona,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function Box({ token, dispositivo, alInvalidar }: ContextoDispositivo) {
  const estadoFn = useServerFn(estadoDeBox);
  const llamarFn = useServerFn(llamarDesdeBox);
  const [box, setBox] = useState<EstadoBox | null>(null);
  const [llamando, setLlamando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const leer = useCallback(async () => {
    try {
      const r = await estadoFn({ data: { token } });
      if (r.invalido) {
        alInvalidar();
        return;
      }
      setBox(r.box);
    } catch {
      setAviso("Sin conexión, reintentando…");
    }
  }, [alInvalidar, estadoFn, token]);

  useEffect(() => {
    void leer();
    const id = setInterval(() => void leer(), SEGUNDOS_REFRESCO_BOX * 1000);
    return () => clearInterval(id);
  }, [leer]);

  const llamar = async (c: CitaEnBox) => {
    setLlamando(true);
    setAviso(null);
    try {
      const r = await llamarFn({ data: { token, appointmentId: c.id } });
      if (r.invalido) {
        alInvalidar();
        return;
      }
      setAviso(
        r.resultado.ok
          ? `Llamamos a ${c.paciente}${r.resultado.turno ? ` (N.º ${r.resultado.turno})` : ""}.`
          : r.resultado.motivo,
      );
      await leer();
    } catch (e) {
      setAviso(mensajeDeError(e, "No pudimos llamar al paciente."));
    } finally {
      setLlamando(false);
    }
  };

  const zona = box?.zona ?? dispositivo.zona;

  return (
    <div className="flex min-h-dvh flex-col px-4 py-6 sm:px-8 sm:py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-display text-[clamp(1.75rem,3vw,3rem)] font-semibold leading-tight">
            {box?.box ?? dispositivo.box ?? "Box"}
          </p>
          <p className="truncate text-lg text-muted-foreground">
            {dispositivo.clinica} · {dispositivo.sucursal}
          </p>
        </div>
        <RelojDeSucursal zona={zona} className="text-[clamp(2rem,4vw,3.5rem)] leading-none" />
      </header>

      {box?.sinBox ? (
        <p className="mt-10 text-2xl text-muted-foreground">
          Esta pantalla no tiene un box asignado. Elígelo en Ajustes → Dispositivos.
        </p>
      ) : (
        <main className="mt-8 grid flex-1 content-start gap-6 lg:grid-cols-2">
          <TarjetaCita
            titulo="Ahora"
            cita={box?.actual ?? null}
            zona={zona}
            destacada
            vacio="Nadie en el box."
          />
          <TarjetaCita
            titulo="Siguiente"
            cita={box?.siguiente ?? null}
            zona={zona}
            vacio="No quedan citas hoy."
          />
          <div className="flex flex-col gap-3 lg:col-span-2">
            <button
              type="button"
              disabled={!box?.llamable || llamando}
              onClick={() => box?.llamable && void llamar(box.llamable)}
              className="inline-flex min-h-20 items-center justify-center gap-3 rounded-full bg-foreground px-8 text-2xl font-semibold text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40"
            >
              {llamando ? (
                <Loader2 className="size-7 animate-spin" aria-hidden />
              ) : (
                <Megaphone className="size-7" aria-hidden />
              )}
              {box?.llamable ? `Llamar a ${box.llamable.paciente}` : "Llamar al siguiente"}
            </button>
            <p className="text-lg text-muted-foreground" role="status">
              {aviso ??
                (box && !box.llamable
                  ? "Se habilita cuando el siguiente paciente marque su llegada."
                  : box
                    ? `Quedan ${box.quedan} ${box.quedan === 1 ? "cita" : "citas"} hoy.`
                    : "")}
            </p>
          </div>
        </main>
      )}
    </div>
  );
}

function TarjetaCita({
  titulo,
  cita,
  zona,
  destacada,
  vacio,
}: {
  titulo: string;
  cita: CitaEnBox | null;
  zona: string;
  destacada?: boolean;
  vacio: string;
}) {
  return (
    <section
      aria-label={titulo}
      className={
        destacada
          ? "rounded-[1.75rem] bg-night p-6 text-on-night sm:p-8"
          : "rounded-[1.75rem] border border-border bg-card p-6 sm:p-8"
      }
    >
      <h2 className={destacada ? "kicker text-sm text-brand-on-night" : "kicker text-sm"}>
        {titulo}
      </h2>
      {cita ? (
        <>
          <p className="cifra mt-3 text-5xl leading-none">
            {hora(cita.inicio, zona)}
            {cita.turno != null && (
              <span className="ml-4 text-2xl opacity-70">N.º {cita.turno}</span>
            )}
          </p>
          <p className="mt-4 font-display text-[clamp(2.25rem,4vw,3.5rem)] font-medium leading-none">
            {cita.paciente}
          </p>
          <p
            className={
              destacada ? "mt-3 text-xl text-on-night-2" : "mt-3 text-xl text-muted-foreground"
            }
          >
            {[cita.tratamiento, cita.profesional, ESTADO[cita.estado]].filter(Boolean).join(" · ")}
          </p>
        </>
      ) : (
        <p
          className={
            destacada ? "mt-3 text-2xl text-on-night-2" : "mt-3 text-2xl text-muted-foreground"
          }
        >
          {vacio}
        </p>
      )}
    </section>
  );
}
