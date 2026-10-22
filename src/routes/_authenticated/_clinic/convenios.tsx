import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
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
import { requirePermission } from "@/lib/access/route-guards";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import {
  formatMoney,
  fromCents,
  pasoDeMoneda,
  repartirCobertura,
  toCents,
  type Agreement,
  type Procedure,
} from "@/lib/finance/finance";
import {
  createAgreement,
  listAgreementCoverage,
  listAgreements,
  setAgreementActive,
  setAgreementCoverage,
  updateAgreement,
} from "@/lib/finance/clinic-finance.functions";
import { listProcedures } from "@/lib/finance/finance.functions";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";

export const Route = createFileRoute("/_authenticated/_clinic/convenios")({
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Convenios | Esmalia" },
      {
        name: "description",
        content:
          "Convenios y seguros de la clínica, con la cobertura que aplica cada uno prestación por prestación.",
      },
    ],
  }),
  component: ConveniosPage,
});

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Tipos sugeridos. Texto libre a propósito: el vocabulario cambia por país
 * (Fonasa e Isapre en Chile, obra social y prepaga en Argentina, EPS en
 * Colombia) y un enum obligaría a migrar la base para vender en el siguiente.
 */
const TIPOS_SUGERIDOS = [
  "Fonasa",
  "Isapre",
  "Convenio de empresa",
  "Seguro complementario",
  "Obra social",
  "Prepaga",
  "EPS",
] as const;

function ConvenioDialog({ clinicId, convenio }: { clinicId: string; convenio?: Agreement }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(() => ({
    name: convenio?.name ?? "",
    kind: convenio?.kind ?? "",
    contactName: convenio?.contactName ?? "",
    contactPhone: convenio?.contactPhone ?? "",
    contactEmail: convenio?.contactEmail ?? "",
    notes: convenio?.notes ?? "",
  }));
  const queryClient = useQueryClient();
  const createFn = useServerFn(createAgreement);
  const updateFn = useServerFn(updateAgreement);
  const patch = (c: Partial<typeof d>) => setD((prev) => ({ ...prev, ...c }));

  const guardar = useMutation({
    mutationFn: () => {
      const payload = {
        clinicId,
        name: d.name.trim(),
        kind: d.kind.trim() || null,
        contactName: d.contactName.trim() || null,
        contactPhone: d.contactPhone.trim() || null,
        contactEmail: d.contactEmail.trim() || null,
        notes: d.notes.trim() || null,
      };
      return convenio
        ? updateFn({ data: { ...payload, agreementId: convenio.id } }).then(() => undefined)
        : createFn({ data: payload }).then(() => undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agreements", clinicId] });
      toast.success(convenio ? "Convenio actualizado" : "Convenio creado");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {convenio ? (
          <Button variant="ghost" size="sm">
            <Pencil className="size-3.5" /> Editar
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="size-4" /> Nuevo convenio
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{convenio ? "Editar convenio" : "Nuevo convenio"}</DialogTitle>
          <DialogDescription>
            Después de crearlo, define qué cubre de cada prestación. Los pacientes que tengan este
            convenio verán el presupuesto ya repartido.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Nombre</Label>
              <input
                id="c-name"
                value={d.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Ej: Isapre Colmena"
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-kind">Tipo</Label>
              <input
                id="c-kind"
                list="tipos-convenio"
                value={d.kind}
                onChange={(e) => patch({ kind: e.target.value })}
                placeholder="Ej: Isapre"
                className={INPUT}
              />
              <datalist id="tipos-convenio">
                {TIPOS_SUGERIDOS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-cname">Contacto</Label>
              <input
                id="c-cname"
                value={d.contactName}
                onChange={(e) => patch({ contactName: e.target.value })}
                placeholder="Opcional"
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-cphone">Teléfono</Label>
              <input
                id="c-cphone"
                value={d.contactPhone}
                onChange={(e) => patch({ contactPhone: e.target.value })}
                placeholder="Opcional"
                className={INPUT}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="c-cemail">Email</Label>
            <input
              id="c-cemail"
              type="email"
              value={d.contactEmail}
              onChange={(e) => patch({ contactEmail: e.target.value })}
              placeholder="Para reclamar un rechazo"
              className={INPUT}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="c-notes">Notas</Label>
            <textarea
              id="c-notes"
              rows={2}
              value={d.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Topes, condiciones, lo que haga falta recordar"
              className={INPUT}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => guardar.mutate()} disabled={!d.name.trim() || guardar.isPending}>
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {convenio ? "Guardar cambios" : "Crear convenio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Fila de cobertura: porcentaje o monto fijo, nunca las dos. */
function FilaCobertura({
  clinicId,
  agreementId,
  procedure,
  actual,
  currency,
}: {
  clinicId: string;
  agreementId: string;
  procedure: Procedure;
  actual: { coveragePct: number | null; coverageFixedCents: number | null } | undefined;
  currency: string;
}) {
  const queryClient = useQueryClient();
  const setFn = useServerFn(setAgreementCoverage);

  const modoInicial = actual?.coverageFixedCents !== null && actual ? "fijo" : "pct";
  const [modo, setModo] = useState<"pct" | "fijo">(modoInicial);
  /**
   * Lo que el usuario ve: un porcentaje en modo "pct", un monto en unidades
   * visibles en modo "fijo". Nunca cents — la conversión pasa en los tres
   * bordes de abajo (guardar, previsualizar, y este valor inicial).
   */
  const [valor, setValor] = useState<number | null>(
    actual?.coverageFixedCents != null
      ? fromCents(actual.coverageFixedCents, currency)
      : (actual?.coveragePct ?? null),
  );

  const guardar = useMutation({
    mutationFn: (v: number | null) =>
      setFn({
        data: {
          clinicId,
          agreementId,
          procedureId: procedure.id,
          coveragePct: v !== null && modo === "pct" ? v : null,
          coverageFixedCents: v !== null && modo === "fijo" ? toCents(v, currency) : null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agreement-coverage", clinicId, agreementId] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const previsualizacion = repartirCobertura(
    procedure.defaultPriceCents,
    valor === null
      ? null
      : {
          coveragePct: modo === "pct" ? valor : null,
          coverageFixedCents: modo === "fijo" ? toCents(valor, currency) : null,
        },
  );

  return (
    <tr className="border-b border-hairline last:border-0">
      <td className="px-4 py-2">{procedure.name}</td>
      <td className="px-3 py-2 text-right text-xs cifra text-muted-foreground">
        {formatMoney(procedure.defaultPriceCents, currency)}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <input
            type="number"
            inputMode="decimal"
            step={modo === "pct" ? 1 : pasoDeMoneda(currency)}
            min={0}
            max={modo === "pct" ? 100 : undefined}
            value={valor ?? ""}
            placeholder="No cubre"
            aria-label={`Cobertura de ${procedure.name}`}
            onChange={(e) => setValor(e.target.value === "" ? null : Number(e.target.value))}
            onBlur={() => guardar.mutate(valor)}
            className="w-24 rounded-md border border-hairline bg-transparent px-2 py-1 text-right text-xs outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <button
            type="button"
            onClick={() => {
              setModo(modo === "pct" ? "fijo" : "pct");
              setValor(null);
            }}
            title="Cambiar entre porcentaje y monto fijo"
            aria-label={`Cobertura de ${procedure.name} en ${modo === "pct" ? "porcentaje" : "monto fijo"}. Cambiar.`}
            className="rounded-md border border-hairline px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary"
          >
            {modo === "pct" ? "%" : "$"}
          </button>
        </div>
      </td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">
        {previsualizacion.patientCents === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatMoney(previsualizacion.patientCents, currency)
        )}
      </td>
    </tr>
  );
}

function CoberturaDelConvenio({
  clinicId,
  agreementId,
  procedures,
  currency,
}: {
  clinicId: string;
  agreementId: string;
  procedures: Procedure[];
  currency: string;
}) {
  const fetchCoverage = useServerFn(listAgreementCoverage);
  const {
    data: cobertura = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["agreement-coverage", clinicId, agreementId],
    queryFn: () => fetchCoverage({ data: { clinicId, agreementId } }),
  });

  const porProcedimiento = useMemo(
    () => new Map(cobertura.map((c) => [c.procedureId, c])),
    [cobertura],
  );

  if (isLoading)
    return <p className="px-4 py-3 text-xs text-muted-foreground">Cargando cobertura…</p>;

  // Sin esto, un error mostraba la tabla como si el convenio no cubriera nada.
  if (isError)
    return (
      <ErrorDeCarga
        onReintentar={refetch}
        mensaje="No pudimos cargar la cobertura de este convenio."
        className="m-3"
      />
    );

  if (procedures.length === 0)
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Carga tu arancel primero: la cobertura se define prestación por prestación.
      </p>
    );

  return (
    <div className="overflow-x-auto border-t border-hairline">
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="border-b border-hairline text-xs text-muted-foreground">
            <th className="px-4 py-2 text-left font-medium">Prestación</th>
            <th className="px-3 py-2 text-right font-medium">Precio</th>
            <th className="px-3 py-2 text-right font-medium">Cubre</th>
            <th className="px-3 py-2 text-right font-medium">Paga el paciente</th>
          </tr>
        </thead>
        <tbody>
          {procedures.map((p) => (
            <FilaCobertura
              key={p.id}
              clinicId={clinicId}
              agreementId={agreementId}
              procedure={p}
              actual={porProcedimiento.get(p.id)}
              currency={currency}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConveniosPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic?.id;
  const currency = access.clinic?.currency ?? "CLP";
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState<string | null>(null);

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  const fetchAgreements = useServerFn(listAgreements);
  const fetchProcedures = useServerFn(listProcedures);
  const setActiveFn = useServerFn(setAgreementActive);

  const {
    data: convenios = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["agreements", clinicId, "todos"],
    enabled: Boolean(clinicId) && !bloqueado,
    queryFn: () =>
      fetchAgreements({ data: { clinicId: clinicId!, incluirInactivos: true, paraInforme: true } }),
  });
  const { data: procedures = [] } = useQuery({
    queryKey: ["procedures", clinicId],
    enabled: Boolean(clinicId) && !bloqueado,
    queryFn: () => fetchProcedures({ data: { clinicId: clinicId! } }),
  });

  const setActive = useMutation({
    mutationFn: (v: { agreementId: string; isActive: boolean }) =>
      setActiveFn({ data: { clinicId: clinicId!, ...v } }),
    onSuccess: (_r, v) => {
      queryClient.invalidateQueries({ queryKey: ["agreements", clinicId] });
      toast.success(v.isActive ? "Convenio reactivado" : "Convenio dado de baja");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <AppShell title="Convenios" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Convenios" sub={sub ?? null} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-sm text-muted-foreground">
              Cuando un paciente tiene convenio, el presupuesto se parte solo entre lo que cubre el
              convenio y lo que paga él — y el saldo que ves en la ficha y en la agenda pasa a ser
              solo su parte.
            </p>
            <ConvenioDialog clinicId={clinicId!} />
          </div>

          {isLoading && <p className="text-sm text-muted-foreground">Cargando convenios…</p>}

          {isError && (
            <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar los convenios." />
          )}

          {!isLoading && !isError && convenios.length === 0 && (
            <div className="card-clinical p-8 text-center">
              <p className="mb-1 font-display text-lg font-semibold">Todavía no hay convenios</p>
              <p className="mx-auto mb-4 max-w-md text-sm text-muted-foreground">
                Si atiendes Fonasa, Isapre o convenios de empresa, cárgalos aquí una vez y define
                qué cubre cada uno. Sin esto, cada presupuesto con convenio se calcula a mano.
              </p>
              <div className="flex justify-center">
                <ConvenioDialog clinicId={clinicId!} />
              </div>
            </div>
          )}

          {convenios.map((c) => {
            const isOpen = abierto === c.id;
            return (
              <section
                key={c.id}
                className={cn("card-clinical overflow-hidden", !c.isActive && "opacity-60")}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <button
                    onClick={() => setAbierto(isOpen ? null : c.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{c.name}</span>
                        {c.kind && (
                          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {c.kind}
                          </span>
                        )}
                        {!c.isActive && (
                          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            De baja
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[c.contactName, c.contactPhone, c.contactEmail]
                          .filter(Boolean)
                          .join(" · ") || "Sin datos de contacto"}
                      </p>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="ml-auto size-4 shrink-0" />
                    ) : (
                      <ChevronDown className="ml-auto size-4 shrink-0" />
                    )}
                  </button>
                  <div className="flex gap-1">
                    <ConvenioDialog clinicId={clinicId!} convenio={c} />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ agreementId: c.id, isActive: !c.isActive })}
                    >
                      {c.isActive ? "Dar de baja" : "Reactivar"}
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <CoberturaDelConvenio
                    clinicId={clinicId!}
                    agreementId={c.id}
                    procedures={procedures}
                    currency={currency}
                  />
                )}
              </section>
            );
          })}

          <p className="text-xs text-muted-foreground">
            Dejar la cobertura vacía significa que el convenio no cubre esa prestación. Un convenio
            dado de baja no reparte presupuestos nuevos, pero los ya emitidos conservan lo que
            decían.
          </p>
        </div>
      )}
    </AppShell>
  );
}
