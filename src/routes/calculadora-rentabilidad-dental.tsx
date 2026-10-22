// src/routes/calculadora-rentabilidad-dental.tsx
//
// Lead magnet público (Task 7 del plan de captación). Resultado primero: el
// panel de la derecha se ve completo sin pedir nada — el email sólo se pide
// para guardar el diagnóstico, nunca para verlo (ver LeadForm, que además NO
// promete "te lo mandamos": Esmalia no tiene RESEND_API_KEY todavía).
//
// Regla no-negociable #2 del proyecto, la que más importa acá: el semáforo
// (sano/bajo/atención/alto) SOLO se enciende en ausentismo, overhead total y
// margen — los únicos tres indicadores con fuente citable (spec §5.2.4).
// Personal, insumos, laboratorio, arriendo, aceptación de presupuestos y
// cobranza se muestran tal cual, sin comparación: las cifras por categoría
// que circulan atribuidas al ADA son una atribución falsa (el ADA no publica
// ese desglose) y no se repiten acá.
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";

import { PublicPageShell } from "@/components/site-chrome";
import { canonicalHead, faqJsonLdScript, SITE_URL } from "@/lib/seo";
import { COUNTRIES } from "@/lib/onboarding-types";
import { formatMoney, toCents, fromCents } from "@/lib/finance/finance";
import { MoneyInput } from "@/components/money-input";
import {
  calcularPL,
  calcularFugas,
  bucketDeMargen,
  type EntradaPL,
  type ResultadoPL,
} from "@/lib/marketing/calculadora";
import { LeadForm } from "@/components/marketing/lead-form";
import type { MetaLead, PaisCaptacion } from "@/lib/marketing/leads";
import { registrarEvento } from "@/lib/marketing/eventos";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato-fecha";

// Mismo shape que `ldJsonScript()` (privado en src/lib/seo.ts, no exportado a
// propósito — ver la nota de esa tarea). OJO al gotcha documentado ahí
// (seo.ts:18-24): `head().scripts` NO anida bajo `attrs` — un item de la
// forma `{ attrs: { type: "...", children: "..." } }` produce un
// `<script attrs="[object Object]">` roto en vez de un script funcional.
function ldJsonScript(data: Record<string, unknown>) {
  return { type: "application/ld+json", children: JSON.stringify(data) };
}

// Las 4 preguntas repiten LITERALMENTE las fórmulas de src/lib/marketing/calculadora.ts
// (Task 5) — no son copy de marketing genérico. Es la mitad del valor SEO de
// esta tarea: un buscador generativo (ChatGPT, Perplexity, Google AI Overview)
// puede citar la fórmula real de Esmalia en vez de alucinar una.
const PREGUNTAS_CALCULADORA: { q: string; a: string }[] = [
  {
    q: "¿Cómo se calcula la utilidad de una clínica dental?",
    a: "Utilidad = ingreso neto − costos totales. El ingreso neto es la facturación bruta del mes menos la retención que cobra el medio de pago (tarjeta débito o crédito): esa retención se descuenta del ingreso, nunca de los costos. Los costos totales suman honorarios profesionales, sueldos del equipo de apoyo, insumos clínicos, laboratorio, arriendo y otros gastos fijos y variables.",
  },
  {
    q: "¿Cómo se calcula el margen del dueño de una clínica dental?",
    a: "Margen (%) = utilidad ÷ ingresos brutos del mes × 100. Se calcula sobre la facturación bruta, antes de descontar la retención del medio de pago, para que el porcentaje refleje qué parte de todo lo que factura la clínica termina siendo ganancia real para el dueño.",
  },
  {
    q: "¿Cómo se calcula el punto de equilibrio de una clínica dental?",
    a: "Punto de equilibrio = costos fijos ÷ ratio de contribución, donde el ratio de contribución es (ingreso neto − costos variables) ÷ ingresos. Los honorarios profesionales se tratan como costo variable porque se pagan por producción, y los sueldos del equipo de apoyo como costo fijo porque se pagan atienda o no la clínica — es la diferencia estructural con un negocio que no factura por producción individual.",
  },
  {
    q: "¿Cómo se calcula cuánto dinero se pierde por ausencias y presupuestos no aceptados en una clínica dental?",
    a: "La pérdida por ausencias es citas agendadas por mes × (% de ausencias ÷ 100) × ticket promedio por cita. La oportunidad en presupuestos es presupuestos entregados por mes × (brecha entre tu meta de aceptación y tu aceptación actual ÷ 100) × ticket promedio. El total recuperable suma ambas cifras más la cobranza pendiente de cobro.",
  },
];

export const Route = createFileRoute("/calculadora-rentabilidad-dental")({
  head: () => {
    const canonical = canonicalHead("/calculadora-rentabilidad-dental");
    const titulo = "Calculadora de rentabilidad dental · Esmalia";
    const descripcion =
      "Calcula el estado de resultados y las fugas de dinero de tu clínica dental en Chile, México, Colombia, Perú o Argentina. Resultado completo al instante, sin registrarte.";
    const url = `${SITE_URL}/calculadora-rentabilidad-dental`;
    return {
      meta: [
        { title: titulo },
        { name: "description", content: descripcion },
        { property: "og:title", content: titulo },
        { property: "og:description", content: descripcion },
        { property: "og:type", content: "website" },
        ...canonical.meta,
      ],
      links: canonical.links,
      // WebApplication describe la calculadora como herramienta puntual (no
      // Esmalia en general — eso ya lo cubre siteJsonLdScripts() en __root.tsx).
      // BreadcrumbList: 2 niveles, Inicio → Calculadora de rentabilidad.
      // FAQPage vía el helper compartido de seo.ts.
      scripts: [
        ldJsonScript({
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Calculadora de rentabilidad para clínicas dentales",
          url,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }),
        ldJsonScript({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Inicio", item: SITE_URL },
            {
              "@type": "ListItem",
              position: 2,
              name: "Calculadora de rentabilidad",
              item: url,
            },
          ],
        }),
        ...faqJsonLdScript(PREGUNTAS_CALCULADORA),
      ],
    };
  },
  component: CalculadoraRentabilidadDental,
});

// ---------------------------------------------------------------------------
// Helpers puros (page-local, sin React) — parseo de texto, reconversión de
// moneda al cambiar país, y las bandas del semáforo.
// ---------------------------------------------------------------------------

/** "" → null (sin dato). Acepta coma o punto decimal. Nunca NaN. */
function numeroDesdeTexto(texto: string): number | null {
  const limpio = texto.trim().replace(",", ".");
  if (limpio === "") return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

function formatearPct(pct: number): string {
  return `${numero(pct, { maximumFractionDigits: 1 })}%`;
}

/**
 * Al cambiar de país cambia la moneda y su factor de cents (CLP=1, MXN=100).
 * Sin esto, cambiar de país dejaría el mismo entero de cents y el número
 * visible saltaría 100× para arriba o para abajo — exactamente lo que el
 * Step 3 de verificación de este task chequea que NO pase. Reconvertimos
 * pasando por la unidad visible: mismo número que el usuario tipeó, ahora
 * codificado con el factor de la moneda nueva.
 */
function reconvertirCents(
  cents: number | null,
  monedaVieja: string,
  monedaNueva: string,
): number | null {
  if (cents === null) return null;
  if (monedaVieja === monedaNueva) return cents;
  return toCents(fromCents(cents, monedaVieja), monedaNueva);
}

/**
 * Overhead = todos los costos menos los honorarios del propio profesional
 * dueño, sobre los ingresos brutos. Es el mismo criterio que usa el ADA HPI
 * para su cifra de referencia (~58%): "overhead sin remunerar al dueño".
 * Página-local porque calcularPL (Task 5) no expone este corte — no hacía
 * falta para el producto real, sólo para esta comparación de referencia.
 */
function calcularOverheadPct(entrada: EntradaPL, resultado: ResultadoPL): number | null {
  if (entrada.ingresosCents <= 0) return null;
  const overheadCents = resultado.costosTotalesCents - entrada.honorariosCents;
  return (overheadCents / entrada.ingresosCents) * 100;
}

type Banda = "sano" | "bajo" | "atencion" | "alto";

/**
 * Fronteras derivadas como bandas alrededor del ÚNICO número ya citado en el
 * spec (§5.2.4), nunca un dato nuevo — ver ruling pre-Task 7 en progress.md.
 * Ausentismo: rango sano de literatura 10-30%, default 15%.
 */
function bandaAusentismo(pct: number): Banda {
  if (pct < 10) return "bajo";
  if (pct <= 30) return "sano";
  if (pct <= 40) return "atencion";
  return "alto";
}

/** Overhead: referencia EE.UU. ≈58% (ADA HPI). Más alto = peor. */
function bandaOverhead(pct: number): Banda {
  if (pct < 48) return "bajo";
  if (pct <= 68) return "sano";
  if (pct <= 78) return "atencion";
  return "alto";
}

/**
 * Margen: referencia EE.UU. ≈24% (ADA HPI). Más alto = mejor, PERO un margen
 * anormalmente alto activa la regla de "un ratio anormalmente bueno no es
 * sano" (spec, principio 5) — por eso "alto" acá es la banda mala (rojo,
 * margen bajo) y "bajo" es la sospechosa (azul, margen alto).
 */
function bandaMargen(pct: number): Banda {
  if (pct < 14) return "alto";
  if (pct <= 19) return "atencion";
  if (pct <= 29) return "sano";
  return "bajo";
}

const SEVERIDAD_BANDA: Record<Banda, number> = { sano: 0, bajo: 1, atencion: 2, alto: 3 };

const BANDA_ESTILO: Record<Banda, { etiqueta: string; icono: LucideIcon; clases: string }> = {
  sano: {
    etiqueta: "Sano",
    icono: CheckCircle2,
    clases: "border-success/30 bg-success-soft text-success",
  },
  atencion: {
    etiqueta: "Atención",
    icono: AlertTriangle,
    clases: "border-warning/30 bg-warning-soft text-warning",
  },
  alto: {
    etiqueta: "Alto",
    icono: XCircle,
    clases: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  // Sin token propio en el sistema de diseño (sólo success/warning/destructive
  // existen) — azul es la convención universal para "informativo", así que se
  // usa la escala de Tailwind directo en vez de inventar un token nuevo para
  // un solo uso.
  bajo: {
    etiqueta: "Atípico",
    icono: Info,
    clases: "border-info-border bg-info-soft text-info",
  },
};

/**
 * La etiqueta visible de margen no puede ser el nombre interno de la banda:
 * "alto" (banda) para margen significa "margen crítico, bajo" — mostrar
 * literalmente "ALTO" ahí se lee como "tu margen es alto" (bueno) cuando el
 * diagnóstico de al lado dice lo contrario ("zona crítica"). Ausentismo y
 * overhead no tienen esta inversión (ahí "alto" significa literalmente
 * número alto, y eso sí es malo), así que sólo margen necesita traducción —
 * el nombre interno de la banda (el que usan bandaMargen/bucketDeMargen y el
 * mapeo a MetaLead) no cambia, sólo lo que lee el usuario en la tarjeta.
 */
function etiquetaVisibleMargen(banda: Banda): string {
  if (banda === "alto") return "Crítico";
  return BANDA_ESTILO[banda].etiqueta;
}

/**
 * `MetaLead.ausencias_bucket` sólo acepta 3 valores (bajo/medio/alto/na), no
 * los 4 estados del semáforo visual. Colapso: bajo→bajo, sano y atención→
 * medio (ambos son "dentro de lo esperable o levemente peor", sólo alto es
 * genuinamente grave), alto→alto. Es SÓLO para analítica interna, no se
 * muestra al visitante.
 */
function bucketAusenciasDesdeBanda(banda: Banda | null): MetaLead["ausencias_bucket"] {
  if (banda === null) return "na";
  if (banda === "bajo") return "bajo";
  if (banda === "alto") return "alto";
  return "medio";
}

/**
 * Sin benchmark citable de aceptación de presupuestos (el 61% que circula es
 * de 2016, sin verificar). El bucket compara contra la meta que el propio
 * visitante fijó, nunca contra un número inventado.
 */
function bucketConversion(
  aceptacionPct: number | null,
  referenciaPct: number | null,
): MetaLead["conversion_bucket"] {
  if (aceptacionPct === null || referenciaPct === null) return "na";
  const diferencia = aceptacionPct - referenciaPct;
  if (diferencia < -5) return "baja";
  if (diferencia > 5) return "alta";
  return "media";
}

// ---------------------------------------------------------------------------
// Diagnóstico narrativo: un párrafo, peor foco primero, con la acción
// concreta — no sólo el número (regla de estructura #6 del brief).
// ---------------------------------------------------------------------------

function fraseAusentismo(pct: number, banda: Banda): string {
  const t = formatearPct(pct);
  if (banda === "alto")
    return `tu ausentismo está alto (${t}) — activa recordatorios automáticos 48 h y 3 h antes, empezando por los pacientes que ya faltaron alguna vez`;
  if (banda === "atencion")
    return `tu ausentismo está en zona de atención (${t}) — refuerza el recordatorio de 48 h con las citas de esta semana`;
  if (banda === "bajo")
    return `tu ausentismo es inusualmente bajo (${t}) — vale la pena confirmar que estés registrando todas las inasistencias`;
  return `tu ausentismo (${t}) está dentro del rango esperado`;
}

function fraseOverhead(pct: number, banda: Banda): string {
  const t = formatearPct(pct);
  if (banda === "alto")
    return `tu overhead está alto (${t} de tus ingresos) — mira primero sueldos e insumos, que suelen ser los rubros que más se salen de control`;
  if (banda === "atencion")
    return `tu overhead está en zona de atención (${t}) — revisa si algún gasto fijo creció sin que lo renegociaras`;
  if (banda === "bajo")
    return `tu overhead es inusualmente bajo (${t}) — puede que no estés cargando tu propio sueldo como costo`;
  return `tu overhead (${t}) está dentro del rango esperado`;
}

function fraseMargen(pct: number, banda: Banda): string {
  const t = formatearPct(pct);
  if (banda === "alto")
    return `tu margen está en zona crítica (${t}) — con estos números el negocio te está pagando muy poco por el riesgo que asumes como dueño`;
  if (banda === "atencion")
    return `tu margen está ajustado (${t}) — antes de bajar precios, mira el rubro con overhead más alto`;
  if (banda === "bajo")
    return `tu margen es inusualmente alto (${t}) — antes de festejar, verifica que no te falte cargar algún costo`;
  return `tu margen (${t}) está dentro del rango esperado`;
}

function construirDiagnostico(
  indicadores: { banda: Banda; frase: string }[],
  totalRecuperableCents: number | null,
  currency: string,
): string | null {
  if (!indicadores.length) return null;
  const ordenados = [...indicadores].sort(
    (a, b) => SEVERIDAD_BANDA[b.banda] - SEVERIDAD_BANDA[a.banda],
  );
  let texto = `Con estos números, ${ordenados[0].frase}.`;
  if (totalRecuperableCents !== null && totalRecuperableCents > 0) {
    texto += ` Sumando lo que cargaste en la sección de fugas, hay ${formatMoney(totalRecuperableCents, currency)} al mes potencialmente recuperables.`;
  }
  return texto;
}

// ---------------------------------------------------------------------------
// Piezas de UI page-local
// ---------------------------------------------------------------------------

function CampoMonto({
  id,
  label,
  currency,
  valueCents,
  onValueChange,
  hint,
}: {
  id: string;
  label: string;
  currency: string;
  valueCents: number | null;
  onValueChange: (v: number | null) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <MoneyInput
        id={id}
        currency={currency}
        valueCents={valueCents}
        onValueChange={onValueChange}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CampoNumero({
  id,
  label,
  texto,
  onTextoChange,
  suffix,
  hint,
  placeholder,
}: {
  id: string;
  label: string;
  texto: string;
  onTextoChange: (v: string) => void;
  suffix?: string;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          value={texto}
          onChange={(e) => onTextoChange(e.target.value)}
          placeholder={placeholder}
          className={cn("tabular-nums", suffix ? "pr-10" : undefined)}
        />
        {suffix && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
          >
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function IndicadorSemaforo({
  titulo,
  pct,
  banda,
  fuenteEtiqueta,
  descripcion,
  etiquetaVisible,
}: {
  titulo: string;
  pct: number | null;
  banda: Banda | null;
  fuenteEtiqueta: string;
  descripcion: string;
  /** Override del texto de la insignia — ver etiquetaVisibleMargen(). Si no
   * se pasa, usa el nombre genérico de la banda (correcto para ausentismo y
   * overhead, donde "alto" nunca se invierte). */
  etiquetaVisible?: string;
}) {
  if (pct === null || banda === null) {
    return (
      <div className="rounded-xl border border-dashed border-hairline p-4">
        <p className="font-display text-sm font-semibold text-foreground">{titulo}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Completa los datos para ver este indicador.
        </p>
      </div>
    );
  }
  const estilo = BANDA_ESTILO[banda];
  const Icono = estilo.icono;
  const etiqueta = etiquetaVisible ?? estilo.etiqueta;
  return (
    <div className={cn("rounded-xl border p-4", estilo.clases)}>
      <div className="flex items-start gap-3">
        <Icono className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="font-display font-semibold">
              {titulo}: {formatearPct(pct)}
            </p>
            <span className="text-xs font-bold uppercase tracking-wide">{etiqueta}</span>
          </div>
          <p className="mt-1 text-sm opacity-90">{descripcion}</p>
          <p className="mt-1.5 text-xs opacity-70">Fuente: {fuenteEtiqueta}</p>
        </div>
      </div>
    </div>
  );
}

function FilaSinJuicio({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline/70 py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{valor}</span>
    </div>
  );
}

function FilaResultado({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{valor}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

type MontosPL = {
  ingresosCents: number | null;
  honorariosCents: number | null;
  sueldosCents: number | null;
  insumosCents: number | null;
  laboratorioCents: number | null;
  fijosCents: number | null;
  variablesCents: number | null;
};

type MontosFugas = {
  ticketPromedioCents: number | null;
  cobranzaPendienteCents: number | null;
};

function CalculadoraRentabilidadDental() {
  const [paisCode, setPaisCode] = useState<PaisCaptacion>("CL");
  const paisActual = COUNTRIES.find((c) => c.code === paisCode) ?? COUNTRIES[0];
  const currency = paisActual.currency;

  const [montosPL, setMontosPL] = useState<MontosPL>({
    ingresosCents: null,
    honorariosCents: null,
    sueldosCents: null,
    insumosCents: null,
    laboratorioCents: null,
    fijosCents: null,
    variablesCents: null,
  });
  const [retencionTexto, setRetencionTexto] = useState("0");

  const [montosFugas, setMontosFugas] = useState<MontosFugas>({
    ticketPromedioCents: null,
    cobranzaPendienteCents: null,
  });
  const [citasTexto, setCitasTexto] = useState("");
  const [ausenciasTexto, setAusenciasTexto] = useState("15");
  const [presupuestosTexto, setPresupuestosTexto] = useState("");
  const [aceptacionTexto, setAceptacionTexto] = useState("");
  const [aceptacionRefTexto, setAceptacionRefTexto] = useState("60");

  function handleCambiarPais(code: PaisCaptacion) {
    const nuevo = COUNTRIES.find((c) => c.code === code);
    if (!nuevo) return;
    const monedaVieja = paisActual.currency;
    const monedaNueva = nuevo.currency;
    setPaisCode(code);
    if (monedaVieja === monedaNueva) return;
    setMontosPL((m) => ({
      ingresosCents: reconvertirCents(m.ingresosCents, monedaVieja, monedaNueva),
      honorariosCents: reconvertirCents(m.honorariosCents, monedaVieja, monedaNueva),
      sueldosCents: reconvertirCents(m.sueldosCents, monedaVieja, monedaNueva),
      insumosCents: reconvertirCents(m.insumosCents, monedaVieja, monedaNueva),
      laboratorioCents: reconvertirCents(m.laboratorioCents, monedaVieja, monedaNueva),
      fijosCents: reconvertirCents(m.fijosCents, monedaVieja, monedaNueva),
      variablesCents: reconvertirCents(m.variablesCents, monedaVieja, monedaNueva),
    }));
    setMontosFugas((m) => ({
      ticketPromedioCents: reconvertirCents(m.ticketPromedioCents, monedaVieja, monedaNueva),
      cobranzaPendienteCents: reconvertirCents(m.cobranzaPendienteCents, monedaVieja, monedaNueva),
    }));
  }

  const retencionPct = numeroDesdeTexto(retencionTexto) ?? 0;
  const citasPorMes = numeroDesdeTexto(citasTexto);
  const ausenciasPct = numeroDesdeTexto(ausenciasTexto);
  const presupuestosPorMes = numeroDesdeTexto(presupuestosTexto);
  const aceptacionPct = numeroDesdeTexto(aceptacionTexto);
  const aceptacionReferenciaPct = numeroDesdeTexto(aceptacionRefTexto);

  const entradaPL: EntradaPL = useMemo(
    () => ({
      ingresosCents: montosPL.ingresosCents ?? 0,
      honorariosCents: montosPL.honorariosCents ?? 0,
      sueldosCents: montosPL.sueldosCents ?? 0,
      insumosCents: montosPL.insumosCents ?? 0,
      laboratorioCents: montosPL.laboratorioCents ?? 0,
      fijosCents: montosPL.fijosCents ?? 0,
      variablesCents: montosPL.variablesCents ?? 0,
      retencionPct,
    }),
    [montosPL, retencionPct],
  );
  const resultadoPL = useMemo(() => calcularPL(entradaPL), [entradaPL]);
  const overheadPctValue = useMemo(
    () => calcularOverheadPct(entradaPL, resultadoPL),
    [entradaPL, resultadoPL],
  );

  // Ambas condiciones, no sólo ingresos: con costos en cero el margen calcula
  // ~100% (basura) y el evento analítico quedaría latcheado para siempre con
  // ese bucket falso — ver hallazgo del revisor, ronda de fix 1.
  const hayDatosPL = (montosPL.ingresosCents ?? 0) > 0 && resultadoPL.costosTotalesCents > 0;

  const entradaFugas = useMemo(
    () => ({
      citasPorMes: citasPorMes ?? 0,
      ausenciasPct: ausenciasPct ?? 0,
      ticketPromedioCents: montosFugas.ticketPromedioCents ?? 0,
      presupuestosPorMes: presupuestosPorMes ?? 0,
      aceptacionPct: aceptacionPct ?? 0,
      aceptacionReferenciaPct: aceptacionReferenciaPct ?? 0,
      retencionCents: montosFugas.cobranzaPendienteCents ?? 0,
    }),
    [
      citasPorMes,
      ausenciasPct,
      montosFugas,
      presupuestosPorMes,
      aceptacionPct,
      aceptacionReferenciaPct,
    ],
  );
  const resultadoFugas = useMemo(() => calcularFugas(entradaFugas), [entradaFugas]);

  const bandaAusenciasValue = ausenciasPct === null ? null : bandaAusentismo(ausenciasPct);
  const bandaOverheadValue = overheadPctValue === null ? null : bandaOverhead(overheadPctValue);
  const bandaMargenValue =
    resultadoPL.margenPct === null ? null : bandaMargen(resultadoPL.margenPct);

  const metaLead: MetaLead = useMemo(
    () => ({
      margen_bucket: bucketDeMargen(resultadoPL.margenPct),
      ausencias_bucket: bucketAusenciasDesdeBanda(bandaAusenciasValue),
      conversion_bucket: bucketConversion(aceptacionPct, aceptacionReferenciaPct),
      retencion_declarada: retencionPct > 0,
      pais: paisCode,
    }),
    [
      resultadoPL.margenPct,
      bandaAusenciasValue,
      aceptacionPct,
      aceptacionReferenciaPct,
      retencionPct,
      paisCode,
    ],
  );

  const diagnostico = useMemo(() => {
    if (!hayDatosPL) return null;
    const indicadores: { banda: Banda; frase: string }[] = [];
    if (ausenciasPct !== null && bandaAusenciasValue) {
      indicadores.push({
        banda: bandaAusenciasValue,
        frase: fraseAusentismo(ausenciasPct, bandaAusenciasValue),
      });
    }
    if (overheadPctValue !== null && bandaOverheadValue) {
      indicadores.push({
        banda: bandaOverheadValue,
        frase: fraseOverhead(overheadPctValue, bandaOverheadValue),
      });
    }
    if (resultadoPL.margenPct !== null && bandaMargenValue) {
      indicadores.push({
        banda: bandaMargenValue,
        frase: fraseMargen(resultadoPL.margenPct, bandaMargenValue),
      });
    }
    return construirDiagnostico(indicadores, resultadoFugas.totalRecuperableCents, currency);
  }, [
    hayDatosPL,
    ausenciasPct,
    bandaAusenciasValue,
    overheadPctValue,
    bandaOverheadValue,
    resultadoPL.margenPct,
    bandaMargenValue,
    resultadoFugas.totalRecuperableCents,
    currency,
  ]);

  useEffect(() => {
    registrarEvento("calculadora_vista");
  }, []);

  const usadaEmitidaRef = useRef(false);
  useEffect(() => {
    if (usadaEmitidaRef.current) return;
    if (!hayDatosPL) return;
    usadaEmitidaRef.current = true;
    registrarEvento("calculadora_usada", {
      pais: paisCode,
      margen_bucket: metaLead.margen_bucket,
      ausencias_bucket: metaLead.ausencias_bucket,
      conversion_bucket: metaLead.conversion_bucket,
    });
  }, [hayDatosPL, paisCode, metaLead]);

  const personalPct =
    resultadoPL.distribucion.honorarios === null || resultadoPL.distribucion.sueldos === null
      ? null
      : resultadoPL.distribucion.honorarios + resultadoPL.distribucion.sueldos;

  const fmtPctOpcional = (pct: number | null) => (pct === null ? "Sin datos" : formatearPct(pct));
  const fmtMoneyOpcional = (cents: number | null) =>
    cents === null ? "Sin datos" : formatMoney(cents, currency);

  return (
    <PublicPageShell>
      <div className="max-w-3xl">
        <p className="font-display text-xs font-bold uppercase tracking-wider text-brand-700">
          Calculadora gratuita
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Calculadora de rentabilidad para tu clínica dental
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Carga los números de tu clínica y mira al instante cuánto te queda, dónde se te está yendo
          el dinero y qué conviene resolver primero. El resultado se ve completo sin registrarte —
          sólo te pedimos el email si quieres guardarlo.
        </p>
      </div>

      <div className="mt-8">
        <p className="font-display text-xs font-bold uppercase tracking-wider text-muted-foreground">
          País de tu clínica
        </p>
        <div role="group" aria-label="País de tu clínica" className="mt-3 flex flex-wrap gap-2">
          {COUNTRIES.map((c) => {
            const activo = c.code === paisCode;
            return (
              <button
                key={c.code}
                type="button"
                aria-pressed={activo}
                onClick={() => handleCambiarPais(c.code)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  activo
                    ? "border-foreground bg-foreground text-background"
                    : "border-hairline bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
              >
                {c.label} <span className="opacity-70">· {c.currency}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_400px] lg:items-start">
        {/* Columna izquierda: inputs. P&L primero, fugas después (regla #4). */}
        <div className="space-y-10">
          <section>
            <h2 className="font-display text-xl font-bold text-foreground">
              1. Tu estado de resultados del mes
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Lo que factura tu clínica y en qué se va.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <CampoMonto
                id="pl-ingresos"
                label="Ingresos del mes (facturación bruta)"
                currency={currency}
                valueCents={montosPL.ingresosCents}
                onValueChange={(v) => setMontosPL((m) => ({ ...m, ingresosCents: v }))}
              />
              <CampoNumero
                id="pl-retencion"
                label="Retención del medio de pago"
                texto={retencionTexto}
                onTextoChange={setRetencionTexto}
                suffix="%"
                hint="Comisión de tarjeta débito/crédito. 0 si cobras en efectivo o transferencia."
              />
              <CampoMonto
                id="pl-honorarios"
                label="Honorarios profesionales"
                currency={currency}
                valueCents={montosPL.honorariosCents}
                onValueChange={(v) => setMontosPL((m) => ({ ...m, honorariosCents: v }))}
                hint="Lo que se paga por producción — variable."
              />
              <CampoMonto
                id="pl-sueldos"
                label="Sueldos del equipo de apoyo"
                currency={currency}
                valueCents={montosPL.sueldosCents}
                onValueChange={(v) => setMontosPL((m) => ({ ...m, sueldosCents: v }))}
                hint="Fijo — se paga atienda o no."
              />
              <CampoMonto
                id="pl-insumos"
                label="Insumos clínicos"
                currency={currency}
                valueCents={montosPL.insumosCents}
                onValueChange={(v) => setMontosPL((m) => ({ ...m, insumosCents: v }))}
              />
              <CampoMonto
                id="pl-laboratorio"
                label="Laboratorio"
                currency={currency}
                valueCents={montosPL.laboratorioCents}
                onValueChange={(v) => setMontosPL((m) => ({ ...m, laboratorioCents: v }))}
              />
              <CampoMonto
                id="pl-fijos"
                label="Arriendo y otros gastos fijos"
                currency={currency}
                valueCents={montosPL.fijosCents}
                onValueChange={(v) => setMontosPL((m) => ({ ...m, fijosCents: v }))}
              />
              <CampoMonto
                id="pl-variables"
                label="Otros gastos variables"
                currency={currency}
                valueCents={montosPL.variablesCents}
                onValueChange={(v) => setMontosPL((m) => ({ ...m, variablesCents: v }))}
              />
            </div>
          </section>

          <section>
            <h2 className="font-display text-xl font-bold text-foreground">2. Fugas de dinero</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ausencias y presupuestos que no se cierran son dinero que ya generaste y no cobraste.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <CampoNumero
                id="fugas-citas"
                label="Citas agendadas por mes"
                texto={citasTexto}
                onTextoChange={setCitasTexto}
                placeholder="Ej: 200"
              />
              <CampoNumero
                id="fugas-ausencias"
                label="% de ausencias (no-show)"
                texto={ausenciasTexto}
                onTextoChange={setAusenciasTexto}
                suffix="%"
                hint="Default 15% — rango sano de literatura: 10-30%."
              />
              <CampoMonto
                id="fugas-ticket"
                label="Ticket promedio por cita"
                currency={currency}
                valueCents={montosFugas.ticketPromedioCents}
                onValueChange={(v) => setMontosFugas((m) => ({ ...m, ticketPromedioCents: v }))}
              />
              <CampoNumero
                id="fugas-presupuestos"
                label="Presupuestos entregados por mes"
                texto={presupuestosTexto}
                onTextoChange={setPresupuestosTexto}
                placeholder="Ej: 40"
              />
              <CampoNumero
                id="fugas-aceptacion"
                label="% de presupuestos que se aceptan hoy"
                texto={aceptacionTexto}
                onTextoChange={setAceptacionTexto}
                suffix="%"
              />
              <CampoNumero
                id="fugas-aceptacion-meta"
                label="Tu meta de aceptación"
                texto={aceptacionRefTexto}
                onTextoChange={setAceptacionRefTexto}
                suffix="%"
                hint="Sin benchmark citable — tú defines contra qué compararte."
              />
              <CampoMonto
                id="fugas-cobranza"
                label="Saldo pendiente de cobro (cobranza)"
                currency={currency}
                valueCents={montosFugas.cobranzaPendienteCents}
                onValueChange={(v) => setMontosFugas((m) => ({ ...m, cobranzaPendienteCents: v }))}
              />
            </div>
          </section>
        </div>

        {/* Columna derecha: resultado en vivo (regla #3) + LeadForm debajo (regla #7). */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div
            aria-live="polite"
            aria-atomic="true"
            className="space-y-6 rounded-3xl border border-hairline bg-card p-6 shadow-sm"
          >
            <div>
              <p className="font-display text-xs font-bold uppercase tracking-wider text-brand-700">
                Resultado en vivo · {paisActual.label} ({currency})
              </p>
              {diagnostico ? (
                <p className="mt-2 text-sm leading-relaxed text-foreground">{diagnostico}</p>
              ) : (
                <p className="mt-2 text-sm italic leading-relaxed text-muted-foreground">
                  Completa al menos tus ingresos y costos del mes para ver tu diagnóstico aquí.
                </p>
              )}
            </div>

            <div className="space-y-2 border-t border-hairline pt-4">
              <FilaResultado
                label="Ingreso neto"
                valor={formatMoney(resultadoPL.ingresoNetoCents, currency)}
              />
              {retencionPct > 0 && (
                <FilaResultado
                  label="Retención descontada"
                  valor={formatMoney(resultadoPL.retencionCents, currency)}
                />
              )}
              <FilaResultado
                label="Costos totales"
                valor={formatMoney(resultadoPL.costosTotalesCents, currency)}
              />
              <FilaResultado
                label="Utilidad"
                valor={formatMoney(resultadoPL.utilidadCents, currency)}
              />
              <FilaResultado
                label="Punto de equilibrio"
                valor={fmtMoneyOpcional(resultadoPL.puntoEquilibrioCents)}
              />
            </div>

            <div className="space-y-3 border-t border-hairline pt-4">
              <IndicadorSemaforo
                titulo="Ausentismo"
                pct={ausenciasPct}
                banda={bandaAusenciasValue}
                fuenteEtiqueta="literatura revisada por pares (PubMed)"
                descripcion="Media 15,2% / mediana 12,9% en revisión sistemática de inasistencias a citas de salud."
              />
              <IndicadorSemaforo
                titulo="Overhead total"
                pct={overheadPctValue}
                banda={bandaOverheadValue}
                fuenteEtiqueta="referencia EE.UU. — ADA Health Policy Institute"
                descripcion="No transferible a LatAm: el mix de seguros, el costo laboral y el de laboratorio son distintos."
              />
              <IndicadorSemaforo
                titulo="Margen del dueño"
                pct={resultadoPL.margenPct}
                banda={bandaMargenValue}
                fuenteEtiqueta="referencia EE.UU. — ADA Health Policy Institute"
                descripcion="No transferible a LatAm — usalo como brújula, no como sentencia."
                etiquetaVisible={
                  bandaMargenValue ? etiquetaVisibleMargen(bandaMargenValue) : undefined
                }
              />
            </div>

            <div className="space-y-1 border-t border-hairline pt-4">
              <p className="font-display text-sm font-semibold text-foreground">
                Sin comparación (todavía)
              </p>
              <div className="rounded-xl border border-dashed border-hairline bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
                Para personal, insumos, laboratorio, arriendo, aceptación de presupuestos y cobranza
                no existe un benchmark público confiable para clínicas de Latinoamérica. Te
                mostramos tu número tal cual, sin compararlo contra nada que no podamos citar.
              </div>
              <div className="pt-1">
                <FilaSinJuicio
                  label="Personal (honorarios + sueldos)"
                  valor={fmtPctOpcional(personalPct)}
                />
                <FilaSinJuicio
                  label="Insumos"
                  valor={fmtPctOpcional(resultadoPL.distribucion.insumos)}
                />
                <FilaSinJuicio
                  label="Laboratorio"
                  valor={fmtPctOpcional(resultadoPL.distribucion.laboratorio)}
                />
                <FilaSinJuicio
                  label="Arriendo y fijos"
                  valor={fmtPctOpcional(resultadoPL.distribucion.fijos)}
                />
                <FilaSinJuicio
                  label="Otros variables"
                  valor={fmtPctOpcional(resultadoPL.distribucion.variables)}
                />
                <FilaSinJuicio
                  label="Aceptación de presupuestos"
                  valor={aceptacionPct === null ? "Sin datos" : formatearPct(aceptacionPct)}
                />
                <FilaSinJuicio
                  label="Cobranza pendiente"
                  valor={formatMoney(montosFugas.cobranzaPendienteCents ?? 0, currency)}
                />
              </div>
            </div>

            <div className="space-y-2 border-t border-hairline pt-4">
              <p className="font-display text-sm font-semibold text-foreground">
                Fugas recuperables al mes
              </p>
              <FilaResultado
                label="Pérdida por ausencias"
                valor={fmtMoneyOpcional(resultadoFugas.perdidaAusenciasCents)}
              />
              <FilaResultado
                label="Oportunidad en presupuestos"
                valor={fmtMoneyOpcional(resultadoFugas.oportunidadPresupuestosCents)}
              />
              <FilaResultado
                label="Cobranza pendiente"
                valor={formatMoney(resultadoFugas.retencionCents, currency)}
              />
              <FilaResultado
                label="Total recuperable"
                valor={fmtMoneyOpcional(resultadoFugas.totalRecuperableCents)}
              />
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-hairline bg-card p-6">
            <h2 className="font-display text-lg font-bold text-foreground">
              Guarda este diagnóstico
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Déjanos tu email o WhatsApp y te ayudamos a mirar en detalle dónde tienes más para
              ganar.
            </p>
            <div className="mt-4">
              <LeadForm
                source="calculadora"
                pais={paisCode}
                meta={metaLead}
                tituloExito="Guardamos tu diagnóstico de rentabilidad."
              />
            </div>
          </div>
        </aside>
      </div>

      <details className="mt-14 rounded-2xl border border-hairline bg-card p-6">
        <summary className="cursor-pointer font-display font-semibold text-foreground">
          De dónde salen estos números (nota metodológica)
        </summary>
        <div className="mt-4 space-y-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            <strong className="text-foreground">Ausentismo (10-30%, referencia 15%).</strong>{" "}
            Literatura revisada por pares indexada en PubMed: media 15,2% y mediana 12,9% en una
            revisión sistemática de inasistencias a citas de salud, y 14,3% en un estudio pediátrico
            dental sobre 7.379 visitas. Es el único indicador de esta calculadora con respaldo
            académico directo — por eso es el único que no lleva la etiqueta "referencia EE.UU."
          </p>
          <p>
            <strong className="text-foreground">
              Overhead total (≈58%) y margen del dueño (≈24%).
            </strong>{" "}
            ADA Health Policy Institute, <em>2026 Survey of Dental Practice</em> (datos del
            ejercicio 2025), n=423 para overhead y n=367 para margen. Son cifras de clínicas de
            Estados Unidos: el mix de seguros, el costo laboral y el costo de laboratorio son
            estructuralmente distintos en Chile, México, Colombia, Perú y Argentina, así que
            tratalas como una brújula ajena, no como una sentencia local.
          </p>
          <p>
            <strong className="text-foreground">
              Personal, insumos, laboratorio, arriendo, aceptación de presupuestos y cobranza: sin
              semáforo, a propósito.
            </strong>{" "}
            No existe un benchmark público y verificable para clínicas dentales de Latinoamérica en
            ninguno de estos rubros. Las cifras específicas por categoría (personal, insumos,
            laboratorio, arriendo) que circulan atribuidas al ADA son una atribución falsa: el ADA
            no publica ese desglose. No las repetimos aquí. Te mostramos tu número tal cual lo
            cargaste, sin compararlo contra nada que no podamos citar.
          </p>
          <p>
            Ninguno de estos rangos es "el promedio de nuestras clínicas": Esmalia todavía no tiene
            esa base. Úsalos como brújula, no como sentencia.
          </p>
        </div>
      </details>
    </PublicPageShell>
  );
}
