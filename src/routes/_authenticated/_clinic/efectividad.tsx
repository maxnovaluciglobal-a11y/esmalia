import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarCheck,
  Inbox,
  Loader2,
  MessageSquare,
  TrendingDown,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { LlamadaDesbloqueo } from "@/components/llamada-desbloqueo";
import { requirePermission } from "@/lib/access/route-guards";
import { requiereLlamadaOSuscripcion } from "@/lib/billing";
import { getMySubscription } from "@/lib/billing.functions";
import {
  MUESTRA_MINIMA,
  formatearEspera,
  type Comparacion,
  type Proporcion,
} from "@/lib/messaging/efectividad";
import { getEfectividad } from "@/lib/messaging/efectividad.functions";
import { MESSAGE_TEMPLATE_KIND_LABELS, type MessageTemplateKind } from "@/lib/messaging/messaging";

export const Route = createFileRoute("/_authenticated/_clinic/efectividad")({
  beforeLoad: requirePermission("dashboard:view"),
  head: () => ({
    meta: [
      { title: "Efectividad | Esmalia" },
      {
        name: "description",
        content:
          "Si la automatización está sirviendo: ausencias con y sin recordatorio, cuántos mensajes se resuelven solos y cuánto tarda tu equipo en responder.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EfectividadPage,
});

/** Muestra el porcentaje sólo cuando existe; si no, el conteo crudo. */
function Cifra({ p, sufijo }: { p: Proporcion; sufijo?: string }) {
  if (p.denominador === 0) {
    return <span className="text-muted-foreground">sin datos todavía</span>;
  }
  if (p.porcentaje === null) {
    return (
      <span>
        <span className="font-display text-2xl font-bold text-foreground">{p.numerador}</span>
        <span className="text-muted-foreground"> de {p.denominador}</span>
      </span>
    );
  }
  return (
    <span>
      <span className="font-display text-2xl font-bold text-foreground">{p.porcentaje}%</span>
      <span className="text-muted-foreground">
        {" "}
        ({p.numerador} de {p.denominador}
        {sufijo ? ` ${sufijo}` : ""})
      </span>
    </span>
  );
}

function Comparativa({
  c,
  etiquetaCon,
  etiquetaSin,
}: {
  c: Comparacion;
  etiquetaCon: string;
  etiquetaSin: string;
}) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{etiquetaCon}</span>
        <Cifra p={c.con} />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{etiquetaSin}</span>
        <Cifra p={c.sin} />
      </div>
      {c.diferencia !== null && (
        <p className="pt-1 text-sm text-foreground">
          {c.diferencia > 0
            ? `Faltan ${c.diferencia} puntos menos.`
            : c.diferencia < 0
              ? `Faltan ${Math.abs(c.diferencia)} puntos más.`
              : "No hay diferencia."}
        </p>
      )}
    </div>
  );
}

function Tarjeta({
  titulo,
  icono,
  children,
}: {
  titulo: string;
  icono: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-card p-5">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
        {icono}
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function EfectividadPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  const bloqueado = requiereLlamadaOSuscripcion(
    sub ?? null,
    access.clinic?.onboardingCallAt ?? null,
  );

  const fetchEfectividad = useServerFn(getEfectividad);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["efectividad", clinicId],
    queryFn: () => fetchEfectividad({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId) && !bloqueado,
  });

  return (
    <AppShell title="Efectividad" access={access}>
      <div className="mx-auto max-w-3xl px-4 py-8">
        {bloqueado ? (
          <LlamadaDesbloqueo
            feature="Efectividad"
            descripcion="Mide si los recordatorios de WhatsApp reducen las ausencias, cuántos mensajes resuelve sola la automatización y cuánto tarda tu equipo en responder — sobre los últimos 90 días de tu propia clínica."
            clinicName={access.clinic?.name}
            clinicEmail={access.email}
          />
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
              Efectividad
            </h1>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
              Si lo que Esmalia automatiza está sirviendo, medido sobre los últimos 90 días de tu
              propia clínica. Cuando la muestra es chica se muestra el conteo en vez del porcentaje:
              con pocos casos, un porcentaje parece una conclusión y no lo es.
            </p>

            {isPending && (
              <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Calculando…
              </p>
            )}
            {error && (
              <ErrorDeCarga
                onReintentar={refetch}
                mensaje="No pudimos calcular la efectividad."
                className="mt-8"
              />
            )}

            {data && (
              <div className="mt-8 space-y-4">
                <Tarjeta titulo="Ausencias" icono={<TrendingDown className="h-4 w-4" />}>
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-muted-foreground">
                      De las citas que ya pasaron, cuántas faltaron
                    </span>
                    <Cifra p={data.ausencia} sufijo="citas" />
                  </div>
                </Tarjeta>

                <Tarjeta
                  titulo="¿Sirve el recordatorio?"
                  icono={<MessageSquare className="h-4 w-4" />}
                >
                  <Comparativa
                    c={data.porRecordatorio}
                    etiquetaCon="Faltaron, habiendo recibido recordatorio"
                    etiquetaSin="Faltaron, sin recordatorio"
                  />
                  <p className="mt-3 flex gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                    <span>
                      Esto <strong className="text-foreground">no es un experimento</strong>. Tu
                      equipo elige a quién le manda recordatorio, y esa elección puede coincidir con
                      quién iba a faltar igual. Tómalo como una señal, no como una prueba de que el
                      recordatorio causó la diferencia.
                    </span>
                  </p>
                </Tarjeta>

                <Tarjeta titulo="Lo que volvió" icono={<CalendarCheck className="h-4 w-4" />}>
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-muted-foreground">
                      Mensajes de seguimiento tras los que el paciente agendó una cita en los{" "}
                      {data.diasParaVolver} días siguientes
                    </span>
                    <Cifra p={data.volvieron.total} sufijo="mensajes" />
                  </div>
                  {data.volvieron.porTipo.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {data.volvieron.porTipo.map((t) => (
                        <li
                          key={t.kind}
                          className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                        >
                          <span className="text-muted-foreground">
                            {MESSAGE_TEMPLATE_KIND_LABELS[t.kind as MessageTemplateKind] ?? t.kind}
                          </span>
                          <span className="cifra">
                            {t.volvieron.numerador} de {t.volvieron.denominador}
                            {t.enCurso > 0 && (
                              <span className="text-muted-foreground"> · {t.enCurso} en curso</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 flex gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                    <span>
                      Cuenta la fecha en que se creó la cita, sin las canceladas. Los mensajes de
                      los últimos {data.diasParaVolver} días quedan “en curso” hasta que cierre su
                      ventana. Tampoco es un experimento: quien recibe un recall quizá iba a llamar
                      igual.
                    </span>
                  </p>
                </Tarjeta>

                <Tarjeta
                  titulo="¿Sirve que el paciente avise?"
                  icono={<TrendingDown className="h-4 w-4" />}
                >
                  <Comparativa
                    c={data.porAviso}
                    etiquetaCon="Faltaron, habiendo avisado que venían"
                    etiquetaSin="Faltaron, sin avisar"
                  />
                </Tarjeta>

                <Tarjeta
                  titulo="Mensajes que se resuelven solos"
                  icono={<Inbox className="h-4 w-4" />}
                >
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-muted-foreground">
                      De los mensajes que entraron, cuántos entendió Esmalia sola
                    </span>
                    <Cifra p={data.cobertura.resueltos} sufijo="mensajes" />
                  </div>
                  {data.cobertura.total > 0 && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {data.cobertura.porTipo.agenda} sobre la agenda ·{" "}
                      {data.cobertura.porTipo.aviso} avisando que venían ·{" "}
                      {data.cobertura.porTipo.baja} pidiendo la baja ·{" "}
                      <strong className="text-foreground">{data.cobertura.paraLeer}</strong> los
                      leyó alguien del equipo.
                    </p>
                  )}
                  <p className="mt-3 flex gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                    <span>
                      Los que leyó una persona{" "}
                      <strong className="text-foreground">no son todos automatizables</strong>: ahí
                      entran un “gracias”, una consulta de precio o una foto. Es el techo de lo que
                      podría ganarse, no lo que se está perdiendo.
                    </span>
                  </p>
                </Tarjeta>

                <Tarjeta titulo="Cuánto tarda tu equipo" icono={<Inbox className="h-4 w-4" />}>
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-muted-foreground">
                      Mediana entre el mensaje del paciente y tu respuesta
                    </span>
                    <span className="font-display text-2xl font-bold text-foreground">
                      {data.medianaRespuestaMin === null
                        ? "—"
                        : formatearEspera(data.medianaRespuestaMin)}
                    </span>
                  </div>
                  {data.sinResponder > 0 && (
                    <p className="mt-2 text-sm">
                      <Link
                        to="/conversaciones"
                        search={{ paciente: undefined }}
                        className="text-success underline underline-offset-2"
                      >
                        {data.sinResponder}{" "}
                        {data.sinResponder === 1
                          ? "conversación sigue sin responder"
                          : "conversaciones siguen sin responder"}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        y no cuentan en esa mediana: no son una respuesta lenta, son otra cosa.
                      </span>
                    </p>
                  )}
                </Tarjeta>

                {data.solicitudes.total > 0 && (
                  <Tarjeta
                    titulo="Pedidos de hora por WhatsApp"
                    icono={<MessageSquare className="h-4 w-4" />}
                  >
                    <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm text-muted-foreground">
                        Terminaron con una cita agendada
                      </span>
                      <Cifra p={data.solicitudes.agendadas} sufijo="pedidos" />
                    </div>
                  </Tarjeta>
                )}

                <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
                  Los porcentajes aparecen a partir de {MUESTRA_MINIMA} casos.
                  {data.recortado &&
                    " La muestra se recortó por volumen: se leyeron los más recientes."}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
