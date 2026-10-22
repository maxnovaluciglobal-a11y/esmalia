import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Ticket } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { MoneyInput } from "@/components/money-input";
import { BloqueoEscritura } from "@/components/solo-lectura";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  avisoDeTramo,
  calcularCopago,
  TIPO_DE_BONO_LABEL,
  TIPOS_DE_BONO,
  TRAMOS_FONASA,
  tipoSugerido,
  type TipoDeBono,
  type TramoFonasa,
} from "@/lib/finance/bono-copago";
import { previsionDelPaciente, registrarCobroConBono } from "@/lib/finance/bono.functions";
import { listPaymentMethods } from "@/lib/finance/clinic-finance.functions";
import {
  formatMoney,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type TreatmentPlan,
} from "@/lib/finance/finance";
import { mensajeDeError } from "@/lib/mensaje-error";

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function esTramo(v: unknown): v is TramoFonasa {
  return typeof v === "string" && (TRAMOS_FONASA as readonly string[]).includes(v);
}

/**
 * Cobro de una prestación con bono Fonasa / isapre o PAD dental (MKT-03).
 * Registro manual: la recepción anota el bono y Esmalia calcula el copago.
 * Queda como dos pagos (bono + copago) que suman al saldo del paciente.
 */
export function CobroConBonoDialog({
  clinicId,
  patientId,
  plans,
  currency,
}: {
  clinicId: string;
  patientId: string;
  plans: TreatmentPlan[];
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<TipoDeBono>("fonasa_mle");
  const [tramo, setTramo] = useState<TramoFonasa | "">("");
  const [asegurador, setAsegurador] = useState("");
  const [numero, setNumero] = useState("");
  const [itemId, setItemId] = useState("");
  const [precio, setPrecio] = useState<number | null>(null);
  const [bono, setBono] = useState<number | null>(null);
  const [copagoPad, setCopagoPad] = useState<number | null>(null);
  const [medioId, setMedioId] = useState("");
  const [metodo, setMetodo] = useState<PaymentMethod>("cash");
  const [grupoId, setGrupoId] = useState(() => crypto.randomUUID());
  const queryClient = useQueryClient();
  const router = useRouter();

  const fetchPrevision = useServerFn(previsionDelPaciente);
  const fetchMedios = useServerFn(listPaymentMethods);
  const cobrarFn = useServerFn(registrarCobroConBono);

  useQuery({
    queryKey: ["prevision-paciente", clinicId, patientId],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetchPrevision({ data: { clinicId, patientId } });
      // Propone tipo, tramo e isapre desde la ficha, sin pisar lo ya tocado.
      setTipo((t) => (t === "fonasa_mle" ? tipoSugerido(r.prevision) : t));
      if (esTramo(r.tramo)) setTramo((t) => t || (r.tramo as TramoFonasa));
      if (r.prevision === "isapre" && r.institucion)
        setAsegurador((a) => a || (r.institucion ?? ""));
      return r;
    },
  });
  const { data: medios = [] } = useQuery({
    queryKey: ["payment-methods", clinicId],
    enabled: open,
    queryFn: () => fetchMedios({ data: { clinicId } }),
  });

  // Prestaciones de los planes vigentes, para imputar el cobro a una línea.
  const lineas = useMemo(
    () =>
      plans
        .filter((p) => p.status !== "cancelled")
        .flatMap((p) =>
          p.items.filter((i) => i.status !== "skipped").map((i) => ({ plan: p, item: i })),
        ),
    [plans],
  );
  const linea = lineas.find((l) => l.item.id === itemId);

  const resultado = calcularCopago(
    tipo === "fonasa_pad"
      ? { tipo, precioCents: precio, copagoCents: copagoPad }
      : { tipo, precioCents: precio, bonoCents: bono },
  );
  const aviso = avisoDeTramo(tipo, tramo || null);
  const motivo = !numero.trim()
    ? "Ingresa el número del bono."
    : tipo === "isapre" && !asegurador.trim()
      ? "Indica la isapre que emitió el bono."
      : !resultado.ok
        ? resultado.motivo
        : null;

  function reiniciar() {
    setNumero("");
    setItemId("");
    setPrecio(null);
    setBono(null);
    setCopagoPad(null);
    setGrupoId(crypto.randomUUID());
  }

  const cobrar = useMutation({
    mutationFn: () =>
      cobrarFn({
        data: {
          clinicId,
          patientId,
          grupoId,
          tipo,
          numeroBono: numero.trim(),
          asegurador: asegurador.trim() || null,
          tramo: tramo || null,
          precioCents: precio ?? 0,
          bonoCents: tipo === "fonasa_pad" ? null : bono,
          copagoCents: tipo === "fonasa_pad" ? copagoPad : null,
          metodoCopago: metodo,
          medioCopagoId: medioId || null,
          paidAt: new Date().toISOString(),
          treatmentPlanId: linea?.plan.id ?? null,
          treatmentItemId: linea?.item.id ?? null,
        },
      }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["payments", clinicId, patientId] });
      queryClient.invalidateQueries({ queryKey: ["patients", clinicId] });
      // El saldo del header de la ficha viene del loader de la ruta.
      void router.invalidate();
      toast.success("Cobro con bono registrado", {
        description: `Bono ${formatMoney(r.bonoCents, currency)} · copago ${formatMoney(r.copagoCents, currency)}`,
      });
      reiniciar();
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <BloqueoEscritura>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Ticket className="size-4" aria-hidden /> Cobrar con bono
          </Button>
        </DialogTrigger>
      </BloqueoEscritura>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cobrar con bono</DialogTitle>
          <DialogDescription>
            Registro manual del bono Fonasa, isapre o PAD dental. Esmalia calcula el copago; el bono
            y el copago quedan como dos pagos del paciente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="bono-tipo">Tipo de bono</Label>
              <select
                id="bono-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoDeBono)}
                className={INPUT}
              >
                {TIPOS_DE_BONO.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_DE_BONO_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="bono-numero">N.º de bono</Label>
              <input
                id="bono-numero"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                maxLength={40}
                inputMode="numeric"
                className={INPUT}
              />
            </div>
            {tipo === "isapre" ? (
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="bono-isapre">Isapre</Label>
                <input
                  id="bono-isapre"
                  value={asegurador}
                  onChange={(e) => setAsegurador(e.target.value)}
                  maxLength={80}
                  className={INPUT}
                />
              </div>
            ) : (
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="bono-tramo">Tramo Fonasa</Label>
                <select
                  id="bono-tramo"
                  value={tramo}
                  onChange={(e) => setTramo(esTramo(e.target.value) ? e.target.value : "")}
                  className={INPUT}
                >
                  <option value="">Sin dato</option>
                  {TRAMOS_FONASA.map((t) => (
                    <option key={t} value={t}>
                      Tramo {t}
                    </option>
                  ))}
                </select>
                {aviso && <p className="text-xs text-warning">{aviso}</p>}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bono-linea">Prestación</Label>
            <select
              id="bono-linea"
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                const l = lineas.find((x) => x.item.id === e.target.value);
                if (l) setPrecio(l.item.patientCents ?? l.item.priceCents);
              }}
              className={INPUT}
            >
              <option value="">Sin imputar a una línea del plan</option>
              {lineas.map(({ plan, item }) => (
                <option key={item.id} value={item.id}>
                  {item.nameSnapshot}
                  {item.toothNumber ? ` · pieza ${item.toothNumber}` : ""} ·{" "}
                  {formatMoney(item.patientCents ?? item.priceCents, plan.currency)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bono-precio">
                {tipo === "fonasa_pad" ? "Precio del PAD" : "Precio de la prestación"}
              </Label>
              <MoneyInput
                id="bono-precio"
                currency={currency}
                min={0}
                valueCents={precio}
                onValueChange={setPrecio}
              />
            </div>
            {tipo === "fonasa_pad" ? (
              <div className="space-y-1.5">
                <Label htmlFor="bono-copago-pad">Copago fijo del PAD</Label>
                <MoneyInput
                  id="bono-copago-pad"
                  currency={currency}
                  min={0}
                  valueCents={copagoPad}
                  onValueChange={setCopagoPad}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="bono-monto">Monto que cubre el bono</Label>
                <MoneyInput
                  id="bono-monto"
                  currency={currency}
                  min={0}
                  valueCents={bono}
                  onValueChange={setBono}
                />
              </div>
            )}
          </div>

          <dl
            className="grid grid-cols-3 gap-2 rounded-lg border border-hairline bg-secondary/40 p-3 text-center"
            aria-live="polite"
          >
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Precio</dt>
              <dd className="cifra text-sm">
                {resultado.ok ? formatMoney(resultado.precioCents, currency) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Bono</dt>
              <dd className="cifra text-sm">
                {resultado.ok ? formatMoney(resultado.bonoCents, currency) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Copago paciente
              </dt>
              <dd className="cifra text-sm font-semibold">
                {resultado.ok ? formatMoney(resultado.copagoCents, currency) : "—"}
              </dd>
            </div>
          </dl>

          {(!resultado.ok || resultado.copagoCents > 0) && (
            <div className="space-y-1.5">
              <Label htmlFor="bono-medio">El paciente paga el copago con</Label>
              {medios.length > 0 ? (
                <select
                  id="bono-medio"
                  value={medioId}
                  onChange={(e) => {
                    setMedioId(e.target.value);
                    const m = medios.find((x) => x.id === e.target.value);
                    // Sin medio elegido = efectivo; un medio propio de la
                    // clínica sin equivalente en el enum cae en "other".
                    setMetodo(m ? (m.legacyKey ?? "other") : "cash");
                  }}
                  className={INPUT}
                >
                  <option value="">Efectivo</option>
                  {medios
                    .filter((m) => m.isActive)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              ) : (
                <select
                  id="bono-medio"
                  value={metodo}
                  onChange={(e) => setMetodo(e.target.value as PaymentMethod)}
                  className={INPUT}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <AccionDeshabilitada motivo={motivo}>
            <Button onClick={() => cobrar.mutate()} disabled={cobrar.isPending}>
              {cobrar.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Registrar cobro
            </Button>
          </AccionDeshabilitada>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
