// src/routes/index.tsx
//
// Landing (rediseño 06-oct-2026, panel 1b del handoff en
// docs/design_handoff_rediseno/). Orden: hero con la pantalla "Hoy"
// construida en HTML → clínicas piloto → calculadora de fugas → tres
// resultados → nota clínica → Patty (la IA) → seguridad de datos → precios →
// cierre.
//
// Reglas de veracidad que el mockup no podía saber:
// - Las cifras del mockup (−40% ausencias, etc.) eran ilustrativas. Acá solo
//   van hechos del producto: la efectividad real es observacional y no se
//   convierte en promesa (ver /efectividad y el CLAUDE.md del repo).
// - Logos y testimonio requieren permiso de las clínicas piloto: las
//   secciones existen, pero no se renderizan mientras sus datos estén vacíos.
// - /demo pide nombre y email antes de entrar: se dice eso mismo ("solo te
//   pedimos nombre y email"), nunca "sin registro" ni "sin crear cuenta".
// - El resumen diario solo cuenta recordatorios pendientes y mensajes sin
//   responder: los montos se ven en la pantalla Hoy, no llegan "cada mañana".
// - Ningún recordatorio sale solo: Esmalia arma la lista y alguien del equipo
//   la despacha. No escribir "Esmalia confirma tus citas".
// - La franja de seguridad solo dice lo que el producto hace hoy: RLS por
//   clínica, permisos por rol y HTTPS salen de /docs/datos-y-seguridad; el
//   respaldo diario cifrado fuera de Supabase, de .github/workflows/backup.yml
//   (Backblaze B2, cifrado con age). Sin sellos ni certificaciones que no hay.
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, DatabaseBackup, Lock, MessageCircle, ShieldCheck, Users } from "lucide-react";

import { PreciosPlanes } from "@/components/marketing/precios";
import { PattyMark } from "@/components/patty";
import { ESTADO_PATTY_CORTO } from "@/lib/ai/estado";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calcularFugas } from "@/lib/marketing/calculadora";
import { enlaceWhatsAppVentas } from "@/lib/marketing/contacto";
import { registrarEvento } from "@/lib/marketing/eventos";
import { detectarPaisVisitante, monedaPorPais } from "@/lib/marketing/pais-visitante";
import { canonicalHead } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => {
    const canonical = canonicalHead("/");
    return {
      meta: [
        { title: "Software para clínicas dentales en Latinoamérica | Esmalia" },
        {
          name: "description",
          content:
            "Software para clínicas dentales de Chile, Perú, México, Colombia y Argentina: recordatorios por WhatsApp, ficha con odontograma, presupuestos y saldos. 14 días gratis, sin tarjeta.",
        },
        { property: "og:title", content: "Esmalia · Cada silla vacía es plata que no vuelve" },
        {
          property: "og:description",
          content:
            "Agenda, ficha clínica, odontograma, presupuestos y cobranza con recordatorios por WhatsApp. Hecho para clínicas de Chile, Perú, México, Colombia y Argentina.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        ...canonical.meta,
      ],
      links: canonical.links,
    };
  },
  component: Landing,
});

// ── Contenido pendiente de permiso ──────────────────────────────────
// Cargar solo con autorización explícita de cada clínica piloto.
const CLINICAS_PILOTO: readonly string[] = [];
const TESTIMONIO: { cita: string; autor: string; clinica: string } | null = null;

function marcarDemo(lugar: string) {
  registrarEvento("cta_click", { cta: "demo", lugar });
}

// ── Pantalla "Hoy" en HTML (ilustrativa, no son datos reales) ───────

const filasHoy = [
  { h: "09:00", n: "P. González", t: "Control", estado: "Confirmada", tono: "ok" },
  { h: "10:30", n: "R. Fernández", t: "Ortodoncia", estado: "Confirmó por WhatsApp", tono: "ok" },
  { h: "11:15", n: "M. Silva", t: "Endodoncia", estado: "En sala", tono: "sala" },
  { h: "12:00", n: "J. Rojas", t: "Limpieza", estado: "Sin respuesta", tono: "pendiente" },
] as const;

const tonoEstado = {
  ok: "border-success-border bg-success-soft text-success",
  sala: "border-info-border bg-info-soft text-info",
  pendiente: "border-dashed border-warning-border bg-warning-soft text-warning",
} as const;

function PantallaHoy() {
  return (
    <figure
      aria-label="Ejemplo de la pantalla Hoy de Esmalia"
      className="animate-landing-rise min-w-0 rounded-lg border border-border bg-popover shadow-md"
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-hairline px-6 py-4">
        <p className="font-display text-xl font-semibold">Hoy · jueves 8</p>
        <p className="truncate text-xs text-muted-foreground">Clínica Los Aromos</p>
      </div>
      <dl className="grid grid-cols-3 border-b border-hairline">
        {[
          ["Citas", "14"],
          ["Confirmadas", "11"],
          ["Cobrado", "$275.000"],
        ].map(([k, v], i) => (
          <div key={k} className={cn("px-6 py-4", i > 0 && "border-l border-hairline")}>
            <dt className="kicker">{k}</dt>
            <dd className="mt-1 font-display text-3xl font-normal tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="divide-y divide-hairline">
        {filasHoy.map((f) => (
          <li
            key={f.h}
            className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-3 px-6 py-3"
          >
            <span className="text-sm tabular-nums text-muted-foreground">{f.h}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm">{f.n}</span>
              <span className="block truncate text-xs text-muted-foreground">{f.t}</span>
            </span>
            <span
              className={cn(
                "rounded-sm border px-2 py-0.5 text-xs whitespace-nowrap",
                tonoEstado[f.tono],
              )}
            >
              {f.estado}
            </span>
          </li>
        ))}
      </ul>
      <figcaption className="flex items-start gap-2 border-t border-hairline px-6 py-3 text-xs text-muted-foreground">
        <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
        Recepción le envió el recordatorio a R. Fernández · respondió “confirmo” hace 4 min
      </figcaption>
    </figure>
  );
}

// ── Calculadora de fugas embebida ───────────────────────────────────
// Reutiliza `calcularFugas` (misma fórmula que /calculadora-rentabilidad-dental):
// pérdida mensual = citas × % ausencias × ticket. Sin pedir email.

const MONEDAS_CALCULO = [
  { code: "CLP", label: "CLP", ticket: 45000 },
  { code: "PEN", label: "PEN", ticket: 180 },
  { code: "MXN", label: "MXN", ticket: 900 },
  { code: "COP", label: "COP", ticket: 180000 },
  { code: "USD", label: "USD", ticket: 50 },
] as const;

type MonedaCalculo = (typeof MONEDAS_CALCULO)[number]["code"];

function formatearMonto(valor: number, moneda: MonedaCalculo) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(valor);
}

function CalculadoraFugas() {
  const [moneda, setMoneda] = useState<MonedaCalculo>("CLP");
  const [citas, setCitas] = useState(320);
  const [ausencias, setAusencias] = useState(18);
  const [ticket, setTicket] = useState<number>(45000);
  const usada = useRef(false);

  // Arranca en la misma moneda que el selector de precios (zona horaria del
  // visitante). En un efecto, para que el SSR y la hidratación coincidan.
  useEffect(() => {
    const m = monedaPorPais(detectarPaisVisitante());
    const def = MONEDAS_CALCULO.find((x) => x.code === m);
    if (!def || usada.current) return;
    setMoneda(def.code);
    setTicket(def.ticket);
  }, []);

  const perdida = useMemo(() => {
    // calcularFugas trabaja en cents; acá basta con la unidad visible.
    const r = calcularFugas({
      citasPorMes: citas,
      ausenciasPct: ausencias,
      ticketPromedioCents: ticket * 100,
      presupuestosPorMes: 0,
      aceptacionPct: 0,
      aceptacionReferenciaPct: 0,
      retencionCents: 0,
    });
    return r.perdidaAusenciasCents === null ? null : r.perdidaAusenciasCents / 100;
  }, [citas, ausencias, ticket]);

  function alCambiar() {
    if (usada.current) return;
    usada.current = true;
    registrarEvento("calculadora_usada", { lugar: "home" });
  }

  const numero = (v: string) => {
    const n = Number(v.replace(/\D/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <div className="grid min-w-0 gap-10 border-y border-border py-12 lg:grid-cols-[1fr_1.1fr] lg:gap-14">
      <div className="min-w-0">
        <p className="kicker">Calculadora de fugas</p>
        <h2 className="mt-3 font-display text-4xl font-normal leading-[1.05] sm:text-[2.75rem]">
          ¿Cuánto pierde tu clínica este mes?
        </h2>
        <p className="mt-5 max-w-md leading-relaxed text-muted-foreground">
          Tres números y te mostramos la plata que se va en ausencias. Sin dar tu mail; el informe
          en PDF, si lo quieres.
        </p>
        <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link
            to="/calculadora-rentabilidad-dental"
            className="text-brand-700 underline-offset-4 hover:underline"
          >
            Calcular cuánto gana tu clínica →
          </Link>
          <Link
            to="/recursos/fugas-clinica-dental"
            className="text-brand-700 underline-offset-4 hover:underline"
          >
            Las 15 fugas más comunes (PDF) →
          </Link>
        </p>
      </div>

      <div className="min-w-0">
        <div className="grid gap-4 sm:grid-cols-3" onChange={alCambiar}>
          <div className="space-y-1.5">
            <Label htmlFor="calc-citas">Citas al mes</Label>
            <Input
              id="calc-citas"
              inputMode="numeric"
              value={citas.toLocaleString("es-CL")}
              onChange={(e) => setCitas(numero(e.target.value))}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="calc-ausencias">% ausencias</Label>
            <Input
              id="calc-ausencias"
              inputMode="numeric"
              value={ausencias}
              onChange={(e) => setAusencias(Math.min(100, numero(e.target.value)))}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="calc-ticket">Ticket medio</Label>
            <div className="flex">
              <select
                aria-label="Moneda"
                value={moneda}
                onChange={(e) => {
                  const m = e.target.value as MonedaCalculo;
                  setMoneda(m);
                  setTicket(MONEDAS_CALCULO.find((x) => x.code === m)?.ticket ?? ticket);
                }}
                className="h-9 rounded-l-md border border-r-0 border-input bg-transparent px-1.5 text-xs pointer-coarse:text-base"
              >
                {MONEDAS_CALCULO.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}
                  </option>
                ))}
              </select>
              <Input
                id="calc-ticket"
                inputMode="numeric"
                value={ticket.toLocaleString("es-CL")}
                onChange={(e) => setTicket(numero(e.target.value))}
                className="rounded-l-none tabular-nums"
              />
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-hairline pt-6" aria-live="polite">
          <p className="text-sm text-muted-foreground">Con estos números, pierdes aprox.</p>
          <p className="mt-1 font-display text-5xl font-normal tabular-nums text-foreground sm:text-6xl">
            {perdida === null ? "—" : formatearMonto(perdida, moneda)}
            <span className="ml-2 font-body text-base text-muted-foreground">/mes</span>
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            {perdida !== null && perdida > 0 && (
              <>
                Si bajaras las ausencias a la mitad, recuperarías{" "}
                <span className="tabular-nums text-foreground">
                  {formatearMonto(perdida / 2, moneda)}
                </span>{" "}
                al mes.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Resultados ────────────────────────────────────────────

const resultados = [
  {
    cifra: "2 avisos",
    titulo: "Nadie se queda sin recordatorio",
    texto:
      "48 h y 3 h antes de cada cita, Esmalia te deja listo el recordatorio por WhatsApp y alguien de tu equipo lo envía con un toque. Quien no responde aparece en tu cola, no en tu memoria.",
    cta: "Ver la cola de confirmaciones",
  },
  {
    cifra: "Saldo",
    titulo: "Sabes quién te debe",
    texto:
      "El presupuesto aceptado se vuelve plan de tratamiento y cada pago descuenta el saldo. En Hoy ves qué pacientes del día tienen deuda, antes de que entren a consulta.",
    cta: "Ver la caja",
  },
  {
    cifra: "Una ficha",
    titulo: "La historia, en un lugar",
    texto:
      "Odontograma FDI versionado, notas clínicas con revisión y versiones, consentimientos firmados.",
    cta: "Ver una ficha",
  },
] as const;

// ── Seguridad de datos ──────────────────────────────────────────────

const garantias = [
  {
    icono: ShieldCheck,
    titulo: "Cada clínica, aislada",
    texto:
      "La base de datos verifica que perteneces a la clínica antes de devolver una sola fila (row-level security), no solo la pantalla.",
  },
  {
    icono: Users,
    titulo: "Cada rol ve lo suyo",
    texto: "Recepción ve agenda y contactos, pero no la historia clínica ni los pagos.",
  },
  {
    icono: DatabaseBackup,
    titulo: "Respaldo todos los días",
    texto: "Una copia diaria cifrada de tus datos, guardada fuera de la plataforma principal.",
  },
  {
    icono: Lock,
    titulo: "Cifrado en tránsito",
    texto: "Todo viaja por HTTPS. Los servidores están en São Paulo, Brasil.",
  },
] as const;

function FranjaSeguridad() {
  return (
    <section aria-labelledby="seguridad-titulo" className="mx-auto max-w-6xl px-6 py-14">
      <div className="border-y border-border py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2
            id="seguridad-titulo"
            className="max-w-xl font-display text-3xl font-normal leading-tight sm:text-4xl"
          >
            Los datos de tus pacientes, protegidos.
          </h2>
          <Link
            to="/docs/datos-y-seguridad"
            className="inline-flex items-center gap-1.5 text-sm text-brand-700 underline-offset-4 hover:underline"
          >
            Cómo protegemos tus datos
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        <ul className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {garantias.map((g) => (
            <li key={g.titulo} className="min-w-0">
              <g.icono className="size-5 text-brand-700" aria-hidden />
              <h3 className="mt-3 font-medium">{g.titulo}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{g.texto}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Patty, la IA de Esmalia ─────────────────────────────────────────
// Patty está EN HABILITACIÓN (pausada desde el 19-oct-2026, docs/IA.md): la
// sección se queda, pero en futuro y con el estado dicho en voz alta. Cuando
// vuelva: notas (redactar, pulir, resumir, estructurar) y WhatsApp (leer el
// pedido de hora que las reglas no entienden). Patty propone y el
// profesional decide: nunca firma, nunca le escribe sola a un paciente,
// nunca toca la agenda.

const capacidadesPatty = [
  "Redactará y ordenará la nota mientras atiendes: de tus apuntes a una nota SOAP.",
  "Resumirá la nota clínica para que la próxima consulta empiece con contexto.",
  "Con tu número de WhatsApp conectado, leerá los pedidos de hora que no son obvios.",
] as const;

function ConocePatty() {
  return (
    <section
      id="patty"
      aria-labelledby="patty-titulo"
      className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16"
    >
      <div className="grid gap-10 border-t border-border pt-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div className="min-w-0">
          <PattyMark size={44} />
          <h2
            id="patty-titulo"
            className="mt-5 font-display text-4xl font-normal leading-tight sm:text-5xl"
          >
            Conoce a <em className="text-ai">Patty</em>.
          </h2>
          <p className="mt-5 max-w-md leading-relaxed text-muted-foreground">
            Patty es la IA de Esmalia. Propone, no decide: no firma notas, no le escribe a tus
            pacientes por su cuenta y no mueve tu agenda.
          </p>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">{ESTADO_PATTY_CORTO}.</strong> La
            activaremos sobre un proveedor de IA con contrato para datos de salud. Mientras tanto,
            las notas clínicas funcionan igual, sin IA.
          </p>
        </div>
        <div className="min-w-0">
          <ul className="divide-y divide-border border-y border-border">
            {capacidadesPatty.map((c) => (
              <li key={c} className="flex gap-4 py-4 leading-relaxed">
                <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-ai" />
                {c}
              </li>
            ))}
          </ul>
          <p className="mt-6 font-display text-2xl italic">Tú revisas y firmas.</p>
        </div>
      </div>
    </section>
  );
}

// ── Página ──────────────────────────────────────────────────────────

function Landing() {
  const whatsapp = enlaceWhatsAppVentas();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      <main id="main-content">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 pt-14 pb-20 sm:pt-20 lg:grid-cols-[1fr_1.05fr]">
          <div className="min-w-0">
            {/* El H1 lleva la categoría ("software para clínicas dentales") además
                de la frase de marca: sin ella, el título principal no le dice a
                Google ni a los LLM qué es el producto. */}
            <h1>
              <span className="kicker block">Software para clínicas dentales</span>
              <span className="mt-5 block font-display text-[2.9rem] font-normal leading-[0.98] tracking-[-0.02em] sm:text-6xl lg:text-[68px]">
                Cada silla vacía
                <br />
                <em className="text-brand-700">es plata que no vuelve.</em>
              </span>
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              <Link to="/software-dental-latam" className="hover:underline">
                Chile, Perú, México, Colombia y Argentina
              </Link>
            </p>
            <p className="mt-7 max-w-lg text-lg leading-relaxed text-foreground/80">
              Esmalia te arma la lista de citas por confirmar y las mandas por WhatsApp con un
              toque. La ficha y el odontograma quedan en el mismo lugar, y en la pantalla Hoy ves
              qué se cobró y quién debe. Funciona en el navegador, sin instalar nada.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
              <a
                href="/demo"
                onClick={() => marcarDemo("hero")}
                className={buttonVariants({ size: "lg" })}
              >
                Entrar a la demo
              </a>
              <Link
                to="/auth"
                search={{ signup: true }}
                className="text-sm text-brand-700 underline-offset-4 hover:underline"
              >
                o crea tu clínica gratis →
              </Link>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Para la demo solo te pedimos nombre y email, sin tarjeta ni contraseña.
            </p>
            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <li>14 días gratis</li>
              <li aria-hidden>·</li>
              <li>Sin tarjeta</li>
              <li aria-hidden>·</li>
              {/* TODO(export): cuando exista "Exportar todo" en Ajustes, volver a
                  "Si te vas, te llevas tus datos". */}
              <li>Si te vas, te entregamos tus datos en 72 horas</li>
            </ul>
          </div>
          <PantallaHoy />
        </section>

        {CLINICAS_PILOTO.length > 0 && (
          <section className="border-y border-border">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-6">
              <p className="text-sm text-muted-foreground">
                Clínicas piloto que ya operan con Esmalia
              </p>
              <ul className="flex flex-wrap gap-x-10 gap-y-2 font-display text-lg">
                {CLINICAS_PILOTO.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section id="calculadora" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16">
          <CalculadoraFugas />
        </section>

        {/* Tres resultados */}
        <section id="producto" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16">
          <h2 className="max-w-xl font-display text-4xl font-normal leading-tight sm:text-5xl">
            Lo que cambia desde la primera semana.
          </h2>
          <div className="mt-12 grid gap-12 md:grid-cols-3 md:gap-0">
            {resultados.map((r, i) => (
              <div
                key={r.titulo}
                className={cn("md:px-8", i === 0 ? "md:pl-0" : "md:border-l md:border-border")}
              >
                <p className="font-display text-5xl font-normal tabular-nums text-brand-700">
                  {r.cifra}
                </p>
                <h3 className="mt-4 text-xl">{r.titulo}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{r.texto}</p>
                <a
                  href="/demo"
                  onClick={() => marcarDemo(`resultado-${i + 1}`)}
                  className="mt-5 inline-flex items-center gap-1.5 text-sm text-brand-700 underline-offset-4 hover:underline"
                >
                  {r.cta}
                  <ArrowRight className="size-3.5" aria-hidden />
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* Testimonio con permiso, o la nota clínica real del producto */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[0.9fr_1.1fr]">
          {/* Captura real de la clínica demo (09-oct-2026), no foto de stock:
              la ficha con la alerta de alergia y el odontograma. Se rehace
              con scripts/capturar-ficha-landing.mjs cuando cambie la ficha. */}
          <img
            src="/landing/ficha-odontograma.jpg"
            alt="Ficha de un paciente en Esmalia: datos de contacto, convenio, alerta de alergia y el odontograma con una corona y una obturación marcadas"
            width={2240}
            height={1680}
            loading="lazy"
            className="plate aspect-[4/3] w-full rounded-sm border border-hairline object-cover object-top"
          />
          {TESTIMONIO ? (
            <blockquote>
              <p className="font-display text-[30px] italic leading-snug">“{TESTIMONIO.cita}”</p>
              <footer className="mt-5 text-sm text-muted-foreground">
                {TESTIMONIO.autor} · {TESTIMONIO.clinica}
              </footer>
            </blockquote>
          ) : (
            <figure>
              <p className="kicker">Nota clínica · resumen para la próxima consulta</p>
              <blockquote className="mt-4 font-display text-[30px] italic leading-snug">
                “Control de ortodoncia. Ajuste de arco superior, sin molestias referidas. Próximo
                control en 4 semanas.”
              </blockquote>
              <figcaption className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
                Cada nota deja hallazgos, procedimiento y próximo paso listos para la siguiente
                consulta, con versiones y firma del profesional.
              </figcaption>
            </figure>
          )}
        </section>

        <ConocePatty />

        <FranjaSeguridad />

        <section id="precios" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16">
          <PreciosPlanes lugar="precios" />
        </section>

        {/* Cierre */}
        {/* Cierre en banda de tinta (nivel "entre medio y audaz" que eligió
            Walter, 07-oct-2026): el único bloque oscuro de la página, para
            que el último CTA no se pierda en el papel. Sobre tinta el ocre
            va relleno con texto tinta (4,9:1) y el contorno en papel. */}
        <section className="bg-foreground text-background">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-6 py-20 md:flex-row md:items-end">
            <h2 className="max-w-xl font-display text-4xl font-normal leading-tight sm:text-5xl">
              Mira tu agenda de mañana en Esmalia{" "}
              <em className="text-brand">antes de que termine el día.</em>
            </h2>
            <div className="flex flex-wrap gap-3">
              <a
                href="/demo"
                onClick={() => marcarDemo("cierre")}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "border-brand bg-brand text-brand-foreground hover:bg-brand/88",
                )}
              >
                Entrar a la demo
              </a>
              <a
                href={whatsapp.href}
                onClick={() => registrarEvento("cta_click", { cta: "whatsapp", lugar: "cierre" })}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "border-background/60 text-background hover:bg-background/10",
                )}
                {...(whatsapp.esWhatsApp ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                <MessageCircle aria-hidden />
                {whatsapp.esWhatsApp ? "Hablar por WhatsApp" : "Escríbenos"}
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
