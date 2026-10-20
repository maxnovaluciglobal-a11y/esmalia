// src/components/marketing/calculadora-fugas.tsx
//
// Calculadora de fugas de la portada (extraída de routes/index.tsx el
// 19-oct-2026 para reusarla en la landing A+ de /v2, sin cambios).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calcularFugas } from "@/lib/marketing/calculadora";
import { registrarEvento } from "@/lib/marketing/eventos";
import { detectarPaisVisitante, monedaPorPais } from "@/lib/marketing/pais-visitante";

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

export function CalculadoraFugas() {
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
