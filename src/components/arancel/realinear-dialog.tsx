import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { realinearPrecios } from "@/lib/arancel/arancel.functions";
import { SIN_ESPECIALIDAD, type Especialidad } from "@/lib/arancel/especialidades";
import {
  calcularRealineacion,
  errorDeParametros,
  resumenRealineacion,
  type ParametrosRealineacion,
} from "@/lib/arancel/realineacion";
import { formatMoney, pasoDeMoneda, toCents, type Procedure } from "@/lib/finance/finance";
import { mensajeDeError } from "@/lib/mensaje-error";
import { coincide } from "@/lib/search";
import { cn } from "@/lib/utils";

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type Alcance = "especialidad" | "seleccion" | "todo";
const SIN = "__sin__";

/** Pasos de redondeo en unidades visibles de la moneda. */
function opcionesDeRedondeo(currency: string): { valor: string; label: string }[] {
  const sinDecimales = pasoDeMoneda(currency) === 1;
  const pasos = sinDecimales ? [10, 100, 1000] : [1, 10];
  return [
    { valor: "", label: "Sin redondear" },
    ...pasos.map((p) => ({
      valor: String(toCents(p, currency)),
      label: `Al múltiplo de ${formatMoney(toCents(p, currency), currency)}`,
    })),
  ];
}

/**
 * Realinear precios en lote (ADM-04): por porcentaje o por monto, a una
 * especialidad, a una selección o a todo el arancel. La vista previa usa la
 * misma función que el servidor; confirmar es un segundo paso explícito.
 */
export function RealinearDialog({
  clinicId,
  currency,
  procedures,
  especialidades,
  open,
  onOpenChange,
}: {
  clinicId: string;
  currency: string;
  /** Solo las vigentes: las dadas de baja no se realinean. */
  procedures: Procedure[];
  especialidades: Especialidad[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [alcance, setAlcance] = useState<Alcance>("especialidad");
  const [especialidadId, setEspecialidadId] = useState("");
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [buscar, setBuscar] = useState("");
  const [modo, setModo] = useState<"percent" | "amount">("percent");
  const [sentido, setSentido] = useState<1 | -1>(1);
  const [porcentaje, setPorcentaje] = useState<number | null>(null);
  const [monto, setMonto] = useState<number | null>(null);
  const [redondeo, setRedondeo] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const queryClient = useQueryClient();
  const realinearFn = useServerFn(realinearPrecios);

  const vigentes = useMemo(() => procedures.filter((p) => p.isActive), [procedures]);
  const conPrestaciones = useMemo(() => {
    const ids = new Set(vigentes.map((p) => p.specialtyId ?? SIN));
    return especialidades.filter((e) => ids.has(e.id));
  }, [vigentes, especialidades]);
  const haySinEspecialidad = vigentes.some(
    (p) => !p.specialtyId || !especialidades.some((e) => e.id === p.specialtyId),
  );

  const elegidas = useMemo(() => {
    if (alcance === "todo") return vigentes;
    if (alcance === "seleccion") return vigentes.filter((p) => seleccion.has(p.id));
    if (!especialidadId) return [];
    if (especialidadId === SIN)
      return vigentes.filter(
        (p) => !p.specialtyId || !especialidades.some((e) => e.id === p.specialtyId),
      );
    return vigentes.filter((p) => p.specialtyId === especialidadId);
  }, [alcance, vigentes, seleccion, especialidadId, especialidades]);

  const parametros: ParametrosRealineacion = {
    modo,
    porcentaje: modo === "percent" && porcentaje !== null ? sentido * porcentaje : null,
    montoCents: modo === "amount" && monto !== null ? sentido * monto : null,
    redondeoCents: redondeo ? Number(redondeo) : null,
  };
  const errorParams = errorDeParametros(parametros);
  const cambios = useMemo(
    () =>
      calcularRealineacion(
        elegidas.map((p) => ({ id: p.id, name: p.name, priceCents: p.defaultPriceCents })),
        parametros,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elegidas, modo, sentido, porcentaje, monto, redondeo],
  );
  const resumen = resumenRealineacion(cambios);

  const etiquetaAlcance =
    alcance === "todo"
      ? "Todo el arancel"
      : alcance === "seleccion"
        ? `${seleccion.size} prestaciones elegidas`
        : especialidadId === SIN
          ? SIN_ESPECIALIDAD
          : (especialidades.find((e) => e.id === especialidadId)?.name ?? "Especialidad");

  const motivo = !elegidas.length
    ? alcance === "especialidad"
      ? "Elige una especialidad."
      : "Elige al menos una prestación."
    : errorParams
      ? errorParams
      : !cambios.length
        ? "Con esos valores ningún precio cambia."
        : null;

  function reiniciar() {
    setConfirmando(false);
    setSeleccion(new Set());
    setPorcentaje(null);
    setMonto(null);
  }

  const aplicar = useMutation({
    mutationFn: () =>
      realinearFn({
        data: {
          clinicId,
          parametros,
          alcance: etiquetaAlcance,
          prestaciones: elegidas.map((p) => ({
            id: p.id,
            name: p.name,
            priceCents: p.defaultPriceCents,
          })),
        },
      }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["procedures", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["realineaciones", clinicId] });
      toast.success(
        r.cambiadas === 1 ? "1 precio actualizado" : `${r.cambiadas} precios actualizados`,
        { description: "Los presupuestos ya emitidos conservan su precio." },
      );
      reiniciar();
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast.error(mensajeDeError(e));
      setConfirmando(false);
    },
  });

  const filtradasSeleccion = vigentes.filter(
    (p) => !buscar || coincide(buscar, p.name, p.code, p.category),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setConfirmando(false);
      }}
    >
      <DialogContent className="flex max-h-[92vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Realinear precios</DialogTitle>
          <DialogDescription>
            Sube o baja varios precios de lista a la vez. Revisa el antes y el después antes de
            aplicar. Los presupuestos y planes ya emitidos no cambian.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">A qué prestaciones</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Alcance">
              {(
                [
                  ["especialidad", "Una especialidad"],
                  ["seleccion", "Elegir una por una"],
                  ["todo", "Todo el arancel"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={alcance === v}
                  onClick={() => {
                    setAlcance(v);
                    setConfirmando(false);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition-colors",
                    alcance === v
                      ? "border-foreground bg-foreground text-background"
                      : "border-hairline hover:bg-secondary",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {alcance === "especialidad" && (
              <select
                aria-label="Especialidad"
                value={especialidadId}
                onChange={(e) => {
                  setEspecialidadId(e.target.value);
                  setConfirmando(false);
                }}
                className={INPUT}
              >
                <option value="">Elegir especialidad…</option>
                {conPrestaciones.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
                {haySinEspecialidad && <option value={SIN}>{SIN_ESPECIALIDAD}</option>}
              </select>
            )}

            {alcance === "seleccion" && (
              <div className="space-y-2">
                <input
                  type="search"
                  value={buscar}
                  onChange={(e) => setBuscar(e.target.value)}
                  placeholder="Buscar prestación"
                  aria-label="Buscar prestación"
                  className={INPUT}
                />
                <ul className="max-h-44 divide-y divide-hairline overflow-y-auto rounded-lg border border-hairline">
                  {filtradasSeleccion.map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 rounded border-hairline"
                          checked={seleccion.has(p.id)}
                          onChange={(e) => {
                            setConfirmando(false);
                            setSeleccion((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(p.id);
                              else next.delete(p.id);
                              return next;
                            });
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground cifra">
                          {formatMoney(p.defaultPriceCents, currency)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Cuánto</legend>
            <div className="space-y-1.5">
              <Label htmlFor="real-sentido">Subir o bajar</Label>
              <select
                id="real-sentido"
                value={sentido}
                onChange={(e) => {
                  setSentido(Number(e.target.value) === -1 ? -1 : 1);
                  setConfirmando(false);
                }}
                className={INPUT}
              >
                <option value={1}>Subir</option>
                <option value={-1}>Bajar</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="real-modo">En</Label>
              <select
                id="real-modo"
                value={modo}
                onChange={(e) => {
                  setModo(e.target.value === "amount" ? "amount" : "percent");
                  setConfirmando(false);
                }}
                className={INPUT}
              >
                <option value="percent">Porcentaje</option>
                <option value="amount">Monto fijo</option>
              </select>
            </div>
            {modo === "percent" ? (
              <div className="space-y-1.5">
                <Label htmlFor="real-pct">Porcentaje (%)</Label>
                <input
                  id="real-pct"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  value={porcentaje ?? ""}
                  onChange={(e) => {
                    setPorcentaje(e.target.value === "" ? null : Math.abs(Number(e.target.value)));
                    setConfirmando(false);
                  }}
                  placeholder="Ej: 5"
                  className={INPUT}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="real-monto">Monto por prestación</Label>
                <MoneyInput
                  id="real-monto"
                  currency={currency}
                  min={0}
                  valueCents={monto}
                  onValueChange={(c) => {
                    setMonto(c === null ? null : Math.abs(c));
                    setConfirmando(false);
                  }}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="real-redondeo">Redondeo</Label>
              <select
                id="real-redondeo"
                value={redondeo}
                onChange={(e) => {
                  setRedondeo(e.target.value);
                  setConfirmando(false);
                }}
                className={INPUT}
              >
                {opcionesDeRedondeo(currency).map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>

          <section aria-labelledby="real-previa" className="space-y-2">
            <h3 id="real-previa" className="text-sm font-medium">
              Vista previa
            </h3>
            {cambios.length === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline px-3 py-4 text-center text-sm text-muted-foreground">
                {motivo ?? "Sin cambios."}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {resumen.cantidad} {resumen.cantidad === 1 ? "precio cambia" : "precios cambian"}{" "}
                  ({etiquetaAlcance}).
                  {resumen.bajanACero > 0 &&
                    ` ${resumen.bajanACero} ${resumen.bajanACero === 1 ? "queda" : "quedan"} en cero.`}
                </p>
                <div className="max-h-56 overflow-auto rounded-lg border border-hairline">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-hairline text-xs text-muted-foreground">
                        <th className="px-3 py-1.5 text-left font-medium">Prestación</th>
                        <th className="px-3 py-1.5 text-right font-medium">Antes</th>
                        <th className="px-3 py-1.5 text-right font-medium">Después</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cambios.map((c) => (
                        <tr key={c.procedureId} className="border-b border-hairline last:border-0">
                          <td className="max-w-[12rem] truncate px-3 py-1.5 sm:max-w-none">
                            {c.name}
                          </td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground cifra">
                            {formatMoney(c.oldCents, currency)}
                          </td>
                          <td className="px-3 py-1.5 text-right cifra">
                            {formatMoney(c.newCents, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>

        <DialogFooter className="items-center gap-2">
          {confirmando ? (
            <>
              <p className="text-xs text-muted-foreground sm:mr-auto">
                Vas a cambiar {resumen.cantidad}{" "}
                {resumen.cantidad === 1 ? "precio de lista" : "precios de lista"}. Queda registrado
                con tu nombre.
              </p>
              <Button variant="outline" onClick={() => setConfirmando(false)}>
                Volver
              </Button>
              <Button onClick={() => aplicar.mutate()} disabled={aplicar.isPending}>
                {aplicar.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Sí, aplicar
              </Button>
            </>
          ) : (
            <AccionDeshabilitada motivo={motivo}>
              <Button onClick={() => setConfirmando(true)}>
                {cambios.length
                  ? `Aplicar a ${cambios.length} ${cambios.length === 1 ? "prestación" : "prestaciones"}`
                  : "Aplicar"}
              </Button>
            </AccionDeshabilitada>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
