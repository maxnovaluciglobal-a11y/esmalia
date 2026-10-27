import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Info } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import {
  BarraEnTinta,
  CifraEnTinta,
  DatosEnTinta,
  Destacado,
  EncabezadoEditorial,
  EtiquetaTinta,
  PANEL,
  TINTA,
  TITULO_PANEL,
  TintaCargando,
} from "@/components/reportes/aplus";
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
import { numero } from "@/lib/formato-fecha";
import { cn } from "@/lib/utils";

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
    return <span className="text-sm text-muted-foreground">Sin datos todavía</span>;
  }
  if (p.porcentaje === null) {
    return (
      <span className="text-sm">
        <span className="cifra text-[15px] text-foreground">{numero(p.numerador)}</span>
        <span className="text-muted-foreground"> de {numero(p.denominador)}</span>
      </span>
    );
  }
  return (
    <span className="text-sm">
      <span className="font-display text-[28px] font-medium leading-none text-foreground [font-variant-numeric:lining-nums]">
        {p.porcentaje}
        <span className="text-brand-600">%</span>
      </span>
      <span className="text-muted-foreground">
        {" "}
        ({numero(p.numerador)} de {numero(p.denominador)}
        {sufijo ? ` ${sufijo}` : ""})
      </span>
    </span>
  );
}

/** Texto de una proporción para la tarjeta en tinta. */
function textoProporcion(p: Proporcion): string {
  if (p.denominador === 0) return "Sin datos";
  if (p.porcentaje === null) return `${numero(p.numerador)} de ${numero(p.denominador)}`;
  return `${p.porcentaje}%`;
}

function BarraProporcion({ etiqueta, p }: { etiqueta: string; p: Proporcion }) {
  return (
    <BarraEnTinta
      etiqueta={etiqueta}
      texto={textoProporcion(p)}
      pct={p.denominador === 0 ? 0 : (p.numerador / p.denominador) * 100}
      nota={
        p.denominador === 0
          ? "Sin citas en este grupo."
          : `${numero(p.numerador)} de ${numero(p.denominador)} citas`
      }
    />
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
    <div className="mt-4 space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2.5">
        <span className="text-sm text-muted-foreground">{etiquetaCon}</span>
        <Cifra p={c.con} />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2.5">
        <span className="text-sm text-muted-foreground">{etiquetaSin}</span>
        <Cifra p={c.sin} />
      </div>
      {c.diferencia !== null && <p className="pt-1 text-sm font-medium">{frase(c.diferencia)}</p>}
    </div>
  );
}

function frase(diferencia: number) {
  return diferencia > 0
    ? `Faltan ${diferencia} puntos menos.`
    : diferencia < 0
      ? `Faltan ${Math.abs(diferencia)} puntos más.`
      : "No hay diferencia.";
}

function Advertencia({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 flex gap-2 rounded-[10px] bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 size-3.5 flex-none" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function Panel({
  titulo,
  children,
  className,
}: {
  titulo: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(PANEL, "p-5", className)}>
      <h2 className={TITULO_PANEL}>{titulo}</h2>
      {children}
    </section>
  );
}

function Fila({ etiqueta, children }: { etiqueta: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
      <span className="max-w-[38ch] text-sm text-muted-foreground">{etiqueta}</span>
      {children}
    </div>
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

  const ausencia = data?.ausencia;
  const conclusion = !data ? undefined : data.ausencia.denominador === 0 ? (
    "Todavía no hay citas pasadas para medir. Cuando la agenda tenga historia, acá vas a ver si lo que Esmalia automatiza está sirviendo."
  ) : (
    <>
      <b className="font-semibold text-foreground">
        {data.ausencia.porcentaje === null
          ? `Faltaron ${numero(data.ausencia.numerador)} de ${numero(data.ausencia.denominador)} citas.`
          : `Faltó el ${data.ausencia.porcentaje}% de las citas.`}
      </b>{" "}
      {data.porRecordatorio.diferencia !== null && data.porRecordatorio.diferencia > 0
        ? `Con recordatorio faltan ${data.porRecordatorio.diferencia} puntos menos; es una señal, no una prueba.`
        : "Con pocos casos se muestra el conteo en vez del porcentaje: un porcentaje parecería una conclusión y no lo es."}
    </>
  );

  return (
    <AppShell title="Efectividad" access={access}>
      {bloqueado ? (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <LlamadaDesbloqueo
            feature="Efectividad"
            descripcion="Mide si los recordatorios de WhatsApp reducen las ausencias, cuántos mensajes resuelve sola la automatización y cuánto tarda tu equipo en responder — sobre los últimos 90 días de tu propia clínica."
            clinicName={access.clinic?.name}
            clinicEmail={access.email}
          />
        </div>
      ) : (
        <div className="mx-auto max-w-[84rem] space-y-[18px]">
          <div className="pb-2">
            <EncabezadoEditorial
              seccion="Reportes"
              pagina="Efectividad"
              titulo={
                <>
                  Lo que sirvió en los <Destacado>últimos 90 días</Destacado>
                </>
              }
              conclusion={conclusion}
            />
          </div>

          {error ? (
            <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos calcular la efectividad." />
          ) : isPending || !data || !ausencia ? (
            <TintaCargando texto="Calculando la efectividad…" />
          ) : (
            <>
              <section
                aria-label="Ausencias"
                className={cn(TINTA, "grid gap-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]")}
              >
                <div className="min-w-0">
                  <EtiquetaTinta>Ausencias</EtiquetaTinta>
                  {ausencia.denominador === 0 ? (
                    <CifraEnTinta valor="Sin datos" />
                  ) : ausencia.porcentaje === null ? (
                    <CifraEnTinta
                      valor={numero(ausencia.numerador)}
                      sufijo={` de ${numero(ausencia.denominador)}`}
                    />
                  ) : (
                    <CifraEnTinta valor={String(ausencia.porcentaje)} sufijo="%" />
                  )}
                  <p className="mt-3.5 text-sm font-medium text-on-night-2">
                    de las citas que ya pasaron, faltaron
                  </p>
                  <div className="mt-6">
                    <DatosEnTinta
                      datos={[
                        {
                          label: "Respuesta de tu equipo",
                          valor:
                            data.medianaRespuestaMin === null
                              ? "Sin datos"
                              : formatearEspera(data.medianaRespuestaMin),
                          nota: "mediana",
                        },
                        {
                          label: "Se resuelven solos",
                          valor: textoProporcion(data.cobertura.resueltos),
                          nota: "de los mensajes que entran",
                        },
                      ]}
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <EtiquetaTinta>¿Sirve el recordatorio?</EtiquetaTinta>
                  <ul className="mt-3 grid gap-3">
                    <BarraProporcion
                      etiqueta="Faltaron, habiendo recibido recordatorio"
                      p={data.porRecordatorio.con}
                    />
                    <BarraProporcion
                      etiqueta="Faltaron, sin recordatorio"
                      p={data.porRecordatorio.sin}
                    />
                  </ul>
                  <p className="mt-3 text-sm text-on-night">
                    {data.porRecordatorio.diferencia === null
                      ? "Todavía no hay casos suficientes para comparar."
                      : frase(data.porRecordatorio.diferencia)}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-on-night-2">
                    No es un experimento: tu equipo elige a quién le manda recordatorio, y esa
                    elección puede coincidir con quién iba a faltar igual. Tómalo como una señal.
                  </p>
                </div>
              </section>

              <div className="grid items-start gap-[18px] lg:grid-cols-2">
                <Panel
                  titulo={
                    <>
                      Lo que <Destacado>volvió</Destacado>
                    </>
                  }
                >
                  <Fila
                    etiqueta={`Mensajes de seguimiento tras los que el paciente agendó una cita en los ${data.diasParaVolver} días siguientes`}
                  >
                    <Cifra p={data.volvieron.total} sufijo="mensajes" />
                  </Fila>
                  {data.volvieron.porTipo.length > 0 && (
                    <ul className="mt-4 grid gap-2">
                      {data.volvieron.porTipo.map((t) => (
                        <li
                          key={t.kind}
                          className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2 text-sm"
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
                  <Advertencia>
                    Cuenta la fecha en que se creó la cita, sin las canceladas. Los mensajes de los
                    últimos {data.diasParaVolver} días quedan “en curso” hasta que cierre su
                    ventana. Tampoco es un experimento: quien recibe un llamado a control quizá iba
                    a llamar igual.
                  </Advertencia>
                </Panel>

                <Panel
                  titulo={
                    <>
                      ¿Sirve que el paciente <Destacado>avise</Destacado>?
                    </>
                  }
                >
                  <Comparativa
                    c={data.porAviso}
                    etiquetaCon="Faltaron, habiendo avisado que venían"
                    etiquetaSin="Faltaron, sin avisar"
                  />
                </Panel>

                <Panel
                  titulo={
                    <>
                      Mensajes que se resuelven <Destacado>solos</Destacado>
                    </>
                  }
                >
                  <Fila etiqueta="De los mensajes que entraron, cuántos entendió Esmalia sola">
                    <Cifra p={data.cobertura.resueltos} sufijo="mensajes" />
                  </Fila>
                  {data.cobertura.total > 0 && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {data.cobertura.porTipo.agenda} sobre la agenda ·{" "}
                      {data.cobertura.porTipo.aviso} avisando que venían ·{" "}
                      {data.cobertura.porTipo.baja} pidiendo la baja ·{" "}
                      <strong className="text-foreground">{data.cobertura.paraLeer}</strong> los
                      leyó alguien del equipo.
                    </p>
                  )}
                  <Advertencia>
                    Los que leyó una persona{" "}
                    <strong className="text-foreground">no son todos automatizables</strong>: ahí
                    entran un “gracias”, una consulta de precio o una foto. Es el techo de lo que
                    podría ganarse, no lo que se está perdiendo.
                  </Advertencia>
                </Panel>

                <Panel
                  titulo={
                    <>
                      Cuánto tarda tu <Destacado>equipo</Destacado>
                    </>
                  }
                >
                  <Fila etiqueta="Mediana entre el mensaje del paciente y tu respuesta">
                    <span className="font-display text-[28px] font-medium leading-none [font-variant-numeric:lining-nums]">
                      {data.medianaRespuestaMin === null
                        ? "—"
                        : formatearEspera(data.medianaRespuestaMin)}
                    </span>
                  </Fila>
                  {data.sinResponder > 0 && (
                    <p className="mt-3 text-sm">
                      <Link
                        to="/conversaciones"
                        search={{ paciente: undefined }}
                        className="font-medium text-brand-700 underline underline-offset-2"
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
                </Panel>

                {data.solicitudes.total > 0 && (
                  <Panel
                    titulo={
                      <>
                        Pedidos de hora por <Destacado>WhatsApp</Destacado>
                      </>
                    }
                  >
                    <Fila etiqueta="Terminaron con una cita agendada">
                      <Cifra p={data.solicitudes.agendadas} sufijo="pedidos" />
                    </Fila>
                  </Panel>
                )}
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Medido sobre los últimos 90 días de tu propia clínica. Los porcentajes aparecen a
                partir de {MUESTRA_MINIMA} casos.
                {data.recortado &&
                  " La muestra se recortó por volumen: se leyeron los más recientes."}
              </p>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
