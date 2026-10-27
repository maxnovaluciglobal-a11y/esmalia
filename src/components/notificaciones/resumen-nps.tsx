/**
 * MKT-08 · Resumen NPS en una tarjeta en tinta (lenguaje A+): el número
 * grande, la mezcla promotores / pasivos / detractores y los correos del
 * mes. El cobalto es solo de datos (la barra), como pide el prototipo; la
 * lista blanca vive en tests/sistema-color.
 */
import type { EnviosDelMes } from "@/lib/notificaciones-pacientes/notificaciones.functions";
import type { ResumenNps } from "@/lib/notificaciones-pacientes/reglas";

const ETIQUETA_TIPO: Record<EnviosDelMes["tipo"], string> = {
  confirmation: "Confirmaciones",
  reminder: "Recordatorios",
  nps: "Encuestas",
};

function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`;
}

export function ResumenNpsEnTinta({
  nps,
  envios,
  diasResumen,
  diasEnvios,
}: {
  nps: ResumenNps;
  envios: EnviosDelMes[];
  diasResumen: number;
  diasEnvios: number;
}) {
  const total = nps.respuestas;
  const segmentos = [
    {
      clave: "promotores",
      etiqueta: "Promotores (9-10)",
      n: nps.promotores,
      color: "var(--color-cobalt-on-night)",
    },
    {
      clave: "pasivos",
      etiqueta: "Pasivos (7-8)",
      n: nps.pasivos,
      color: "color-mix(in srgb, var(--color-cobalt-on-night) 45%, var(--color-on-night))",
    },
    {
      clave: "detractores",
      etiqueta: "Detractores (0-6)",
      n: nps.detractores,
      color: "var(--color-on-night-2)",
    },
  ];

  return (
    <section
      aria-label="Resultados de la encuesta"
      className="grid gap-7 overflow-hidden rounded-[14px] border border-night-line bg-night p-[clamp(22px,2.6vw,36px)] text-on-night md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold tracking-[0.01em] text-on-night-2">
          Recomendación (NPS) · últimos {diasResumen} días
        </p>
        <p className="mt-2.5 font-display text-[clamp(3rem,12vw,4.5rem)] font-medium leading-[0.9] tracking-[-0.03em] [font-variant-numeric:lining-nums]">
          {nps.nps === null ? (
            <span className="text-on-night-2">Sin datos</span>
          ) : (
            <>
              {nps.nps > 0 && <span className="text-brand-on-night">+</span>}
              {nps.nps}
            </>
          )}
        </p>
        <p className="mt-3 text-sm font-medium text-on-night-2">
          {nps.enviadas === 0
            ? "Todavía no se mandó ninguna encuesta."
            : `${plural(total, "respuesta", "respuestas")} de ${plural(nps.enviadas, "encuesta", "encuestas")}${
                nps.tasaRespuesta !== null ? ` · ${nps.tasaRespuesta}% respondió` : ""
              }`}
        </p>

        {total > 0 && (
          <figure className="mt-5">
            <figcaption className="sr-only">Mezcla de respuestas</figcaption>
            <div aria-hidden className="flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]">
              {segmentos
                .filter((s) => s.n > 0)
                .map((s) => (
                  <span
                    key={s.clave}
                    className="h-full"
                    style={{ width: `${(s.n / total) * 100}%`, background: s.color }}
                  />
                ))}
            </div>
            <ul className="mt-4 grid gap-2">
              {segmentos.map((s) => (
                <li
                  key={s.clave}
                  className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-baseline gap-2.5 border-b border-night-line pb-2 text-sm"
                >
                  <span
                    aria-hidden
                    className="size-2.5 rounded-[2px]"
                    style={{ background: s.color }}
                  />
                  <span className="min-w-0 truncate">{s.etiqueta}</span>
                  <span className="cifra">{s.n}</span>
                </li>
              ))}
            </ul>
          </figure>
        )}
      </div>

      <div className="min-w-0">
        <p className="text-[13px] font-semibold tracking-[0.01em] text-on-night-2">
          Correos automáticos · últimos {diasEnvios} días
        </p>
        <dl className="mt-4 grid gap-3">
          {envios.map((e) => (
            <div
              key={e.tipo}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-night-line pb-2.5"
            >
              <dt className="text-sm">{ETIQUETA_TIPO[e.tipo]}</dt>
              <dd className="text-right">
                <span className="cifra text-lg text-on-night">{e.enviados}</span>
                <span className="ml-1 text-xs text-on-night-2">enviados</span>
                {(e.omitidos > 0 || e.conError > 0) && (
                  <span className="block text-xs text-on-night-2">
                    {e.omitidos > 0 && plural(e.omitidos, "omitido", "omitidos")}
                    {e.omitidos > 0 && e.conError > 0 && " · "}
                    {e.conError > 0 && plural(e.conError, "con error", "con error")}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-on-night-2">
          Omitido: la clínica está en modo de prueba y el correo no salió. Las bajas y los pacientes
          sin correo no se cuentan.
        </p>
      </div>
    </section>
  );
}
