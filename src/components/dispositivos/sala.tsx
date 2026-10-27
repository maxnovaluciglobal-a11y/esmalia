import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import {
  RelojDeSucursal,
  type ContextoDispositivo,
} from "@/components/dispositivos/pantalla-dispositivo";
import { EsmaliaLogo } from "@/components/esmalia-logo";
import {
  estadoDeSala,
  type EstadoSala,
  type PersonaEnSala,
} from "@/lib/dispositivos/dispositivo-publico.functions";
import { SEGUNDOS_REFRESCO_SALA } from "@/lib/totem/totem";
import { cn } from "@/lib/utils";

/**
 * TV de la sala de espera (AUT-04): a quién se llama, a qué box, quién sigue
 * y los llamados recientes. Tinta (modo oscuro), cifras enormes para leer de
 * lejos. Solo turno e iniciales (o lo que permita la privacidad del
 * dispositivo): nunca RUT, motivo ni profesional. Pide el estado cada 5 s.
 */
export function Sala({ token, dispositivo, alInvalidar }: ContextoDispositivo) {
  const estadoFn = useServerFn(estadoDeSala);
  const [sala, setSala] = useState<EstadoSala | null>(null);
  const [sinConexion, setSinConexion] = useState(false);

  useEffect(() => {
    let vivo = true;
    const leer = async () => {
      try {
        const r = await estadoFn({ data: { token } });
        if (!vivo) return;
        if (r.invalido) {
          alInvalidar();
          return;
        }
        setSala(r.sala);
        setSinConexion(false);
      } catch {
        if (vivo) setSinConexion(true);
      }
    };
    void leer();
    const id = setInterval(() => void leer(), SEGUNDOS_REFRESCO_SALA * 1000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [alInvalidar, estadoFn, token]);

  const actual = sala?.actual ?? null;

  return (
    <div className="flex min-h-dvh flex-col px-4 py-6 sm:px-10 sm:py-8 xl:px-16">
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="truncate font-display text-[clamp(1.5rem,2.6vw,2.75rem)] font-semibold leading-tight">
            {dispositivo.clinica}
          </p>
          <p className="truncate text-[clamp(1rem,1.4vw,1.5rem)] text-muted-foreground">
            {dispositivo.sucursal} · Sala de espera
          </p>
        </div>
        <RelojDeSucursal
          zona={dispositivo.zona}
          className="text-[clamp(2rem,4vw,4.5rem)] leading-none text-foreground"
        />
      </header>

      <main className="mt-8 grid flex-1 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:gap-12">
        <section
          aria-live="assertive"
          aria-labelledby="sala-llamando"
          className="flex min-h-[18rem] flex-col justify-center rounded-[2rem] bg-night px-6 py-8 text-on-night sm:px-10 xl:px-14"
        >
          <h1
            id="sala-llamando"
            className="kicker text-[clamp(0.9rem,1.2vw,1.25rem)] text-brand-on-night"
          >
            Llamando
          </h1>
          {actual ? (
            <div
              key={`${actual.turno}-${actual.llamadoEn}`}
              className="motion-safe:animate-agenda-revelar"
            >
              <p className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
                {actual.turno && (
                  <span className="cifra text-[clamp(6rem,16vw,15rem)] leading-[0.85]">
                    {actual.turno}
                  </span>
                )}
                {actual.nombre && (
                  <span className="font-display text-[clamp(3rem,7vw,7rem)] font-medium leading-none">
                    {actual.nombre}
                  </span>
                )}
              </p>
              <p className="mt-6 font-display text-[clamp(2rem,4.5vw,4.5rem)] leading-none">
                Pase al <em className="text-brand-on-night">{actual.box ?? "box"}</em>
              </p>
            </div>
          ) : (
            <p className="mt-4 font-display text-[clamp(2.5rem,5vw,5rem)] leading-tight text-on-night-2">
              En un momento te <em className="text-brand-on-night">llamamos</em>.
            </p>
          )}
        </section>

        <div className="flex flex-col gap-8">
          <ListaSala
            titulo="Siguen"
            vacio="Nadie esperando por ahora."
            personas={sala?.enEspera ?? []}
          />
          <ListaSala
            titulo="Llamados recientes"
            vacio="Aún no hay llamados."
            personas={sala?.recientes ?? []}
            tenue
          />
        </div>
      </main>

      <footer className="mt-8 flex items-center justify-between gap-4 text-[clamp(0.9rem,1.1vw,1.2rem)] text-muted-foreground">
        <span>Marca tu llegada en el tótem de recepción.</span>
        <span className="flex items-center gap-2">
          {sinConexion && <span role="status">Sin conexión, reintentando…</span>}
          <EsmaliaLogo size={18} variant="icon" />
        </span>
      </footer>
    </div>
  );
}

function ListaSala({
  titulo,
  vacio,
  personas,
  tenue,
}: {
  titulo: string;
  vacio: string;
  personas: (PersonaEnSala & { box?: string | null })[];
  tenue?: boolean;
}) {
  return (
    <section aria-label={titulo}>
      <h2 className="kicker text-[clamp(0.85rem,1.1vw,1.15rem)]">{titulo}</h2>
      {personas.length === 0 ? (
        <p className="mt-4 text-[clamp(1.1rem,1.5vw,1.6rem)] text-muted-foreground">{vacio}</p>
      ) : (
        <ul className="mt-3 divide-y divide-hairline border-y border-border">
          {personas.slice(0, 6).map((p, n) => (
            <li
              key={`${p.turno ?? ""}-${p.nombre ?? ""}-${n}`}
              className={cn(
                "flex items-baseline justify-between gap-4 py-3 text-[clamp(1.4rem,2vw,2.25rem)]",
                tenue && "text-muted-foreground",
              )}
            >
              <span className="flex items-baseline gap-4">
                {p.turno && <span className="cifra min-w-[2.5ch]">{p.turno}</span>}
                {p.nombre && <span className="font-display">{p.nombre}</span>}
              </span>
              {p.box && <span className="text-[0.75em]">{p.box}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
