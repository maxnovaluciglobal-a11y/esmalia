import { ClipboardList, ExternalLink, Phone } from "lucide-react";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import type { FaltanteFicha } from "@/lib/patients/datos-ficha";
import {
  ETIQUETA_MOTIVO_GES,
  EXPLICACION_MOTIVO_GES,
  URL_GES_SALUD_BUCAL,
  type MotivoGes,
} from "@/lib/patients/ges";

/**
 * MKT-01: chip "GES" en la cabecera de la ficha. Al tocarlo se despliega la
 * explicación y el enlace a la información oficial del Minsal. `<details>`
 * nativo: se abre con teclado y con el dedo, y el lector de pantalla lo
 * anuncia como desplegable.
 */
export function AvisoGes({ motivos }: { motivos: readonly MotivoGes[] }) {
  if (motivos.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {motivos.map((m) => (
        <details key={m} className="group">
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full bg-info-soft px-2.5 text-xs font-medium text-info outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7 [&::-webkit-details-marker]:hidden">
            {ETIQUETA_MOTIVO_GES[m]}
          </summary>
          <div className="mt-1.5 max-w-sm rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
            <p>{EXPLICACION_MOTIVO_GES[m]}</p>
            <a
              href={URL_GES_SALUD_BUCAL}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-flex min-h-9 items-center gap-1 font-medium text-brand-700 underline underline-offset-2"
            >
              GES salud bucal en minsal.cl <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        </details>
      ))}
    </div>
  );
}

/** FIC-03: contacto de emergencia en la cabecera, junto a las alertas médicas. */
export function ContactoDeEmergencia({
  contacto,
}: {
  contacto: { nombre: string; relacion: string; telefono: string } | null | undefined;
}) {
  if (!contacto) {
    return <span className="text-muted-foreground">Sin contacto de emergencia</span>;
  }
  const quien = [contacto.nombre, contacto.relacion ? `(${contacto.relacion})` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <span>Emergencia: {quien}</span>
      {contacto.telefono && (
        <a
          href={`tel:${contacto.telefono.replace(/[^+\d]/g, "")}`}
          className="inline-flex min-h-9 items-center gap-1 font-medium text-brand-700 hover:underline sm:min-h-0"
        >
          <Phone className="size-3" aria-hidden /> {contacto.telefono}
        </a>
      )}
    </span>
  );
}

const ACCION_FALTANTE: Record<FaltanteFicha, string> = {
  prevision: "Agregar previsión",
  documento: "Agregar RUT o documento",
  fechaNacimiento: "Agregar fecha de nacimiento",
  direccion: "Agregar dirección y comuna",
  anamnesis: "Completar anamnesis",
};

/**
 * SEG-08: qué le falta a la ficha para cumplir con el Decreto 41, con un
 * botón para completar cada cosa. Sin faltantes no se muestra nada.
 */
export function CompletitudDeLaFicha({
  faltantes,
  onCompletarDatos,
  onCompletarAnamnesis,
  motivoSinPermiso,
}: {
  faltantes: readonly FaltanteFicha[];
  onCompletarDatos: () => void;
  onCompletarAnamnesis: () => void;
  /** Por qué no puede completar los datos (rol o solo lectura); null = puede. */
  motivoSinPermiso: string | null;
}) {
  if (faltantes.length === 0) return null;
  return (
    <section
      aria-labelledby="ficha-incompleta"
      className="mt-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm"
    >
      <h3 id="ficha-incompleta" className="flex items-center gap-2 font-medium text-warning">
        <ClipboardList className="size-4 shrink-0" aria-hidden />
        Ficha incompleta
        <span className="font-normal text-muted-foreground">
          · lo que pide el Decreto 41 para la ficha clínica
        </span>
      </h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {faltantes.map((f) => (
          <li key={f}>
            <AccionDeshabilitada motivo={f === "anamnesis" ? null : motivoSinPermiso} como="globo">
              <button
                type="button"
                onClick={f === "anamnesis" ? onCompletarAnamnesis : onCompletarDatos}
                className="inline-flex min-h-9 items-center rounded-full border border-warning/40 bg-background px-3 text-xs font-medium text-foreground hover:border-brand hover:text-brand-700 disabled:opacity-60"
              >
                {ACCION_FALTANTE[f]}
              </button>
            </AccionDeshabilitada>
          </li>
        ))}
      </ul>
    </section>
  );
}
