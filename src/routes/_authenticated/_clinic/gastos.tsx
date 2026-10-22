import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { DateField, FilterBar, SelectField } from "@/components/filters";
import { MoneyInput } from "@/components/money-input";
import { requirePermission } from "@/lib/access/route-guards";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import { hoyISO, formatoFecha } from "@/lib/clinic-operations/clinic-data";
import { CATEGORIAS_GASTO_SUGERIDAS, formatMoney, type Expense } from "@/lib/finance/finance";
import {
  createExpense,
  deleteExpense,
  listExpenses,
  listPaymentMethods,
  updateExpense,
} from "@/lib/finance/clinic-finance.functions";
import { listBranches } from "@/lib/clinic-operations/clinic-catalog.functions";
import { str } from "@/lib/search";
import { exportarCsv } from "@/lib/csv-export";
import { mensajeDeError } from "@/lib/mensaje-error";

interface GastosSearch {
  desde: string;
  hasta: string;
  categoria: string;
}

function primerDiaDelMes(timeZone?: string): string {
  return `${hoyISO(timeZone).slice(0, 7)}-01`;
}

export const Route = createFileRoute("/_authenticated/_clinic/gastos")({
  validateSearch: (search: Record<string, unknown>): GastosSearch => ({
    desde: str(search.desde) || primerDiaDelMes(),
    hasta: str(search.hasta) || hoyISO(),
    categoria: str(search.categoria),
  }),
  beforeLoad: requirePermission("finance:view"),
  head: () => ({
    meta: [
      { title: "Gastos | Esmalia" },
      {
        name: "description",
        content: "Egresos de la clínica por categoría, sucursal y medio de pago.",
      },
    ],
  }),
  component: GastosPage,
});

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

interface Draft {
  category: string;
  description: string;
  supplier: string;
  /** Cents. El input muestra la unidad visible y convierte con la moneda. */
  amount: number | null;
  incurredOn: string;
  branchId: string;
  paymentMethodId: string;
  notes: string;
}

function GastoDialog({
  clinicId,
  currency,
  timezone,
  expense,
  categoriasUsadas,
}: {
  clinicId: string;
  currency: string;
  timezone: string | undefined;
  /** Sin `expense` el diálogo crea; con él, edita. */
  expense?: Expense;
  categoriasUsadas: string[];
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const createFn = useServerFn(createExpense);
  const updateFn = useServerFn(updateExpense);
  const fetchBranches = useServerFn(listBranches);
  const fetchMethods = useServerFn(listPaymentMethods);

  const inicial = (): Draft => ({
    category: expense?.category ?? "",
    description: expense?.description ?? "",
    supplier: expense?.supplier ?? "",
    amount: expense?.amountCents ?? null,
    incurredOn: expense?.incurredOn ?? hoyISO(timezone),
    branchId: expense?.branchId ?? "",
    paymentMethodId: expense?.paymentMethodId ?? "",
    notes: expense?.notes ?? "",
  });
  const [d, setD] = useState<Draft>(inicial);
  const patch = (cambios: Partial<Draft>) => setD((prev) => ({ ...prev, ...cambios }));

  const { data: sucursales = [] } = useQuery({
    queryKey: ["branches", clinicId],
    enabled: open,
    queryFn: () => fetchBranches({ data: { clinicId } }),
    staleTime: 60 * 1000,
  });
  const { data: medios = [] } = useQuery({
    queryKey: ["payment-methods", clinicId],
    enabled: open,
    queryFn: () => fetchMethods({ data: { clinicId } }),
    staleTime: 60 * 1000,
  });

  const guardar = useMutation({
    mutationFn: () => {
      const payload = {
        clinicId,
        category: d.category.trim(),
        description: d.description.trim(),
        supplier: d.supplier.trim() || null,
        amountCents: d.amount ?? 0,
        incurredOn: d.incurredOn,
        branchId: d.branchId || null,
        paymentMethodId: d.paymentMethodId || null,
        notes: d.notes.trim() || null,
      };
      return expense
        ? updateFn({ data: { ...payload, expenseId: expense.id } }).then(() => undefined)
        : createFn({ data: payload }).then(() => undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["finance-summary", clinicId] });
      toast.success(expense ? "Gasto actualizado" : "Gasto registrado");
      setOpen(false);
      if (!expense) setD(inicial());
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const listo =
    d.category.trim() && d.description.trim() && (d.amount ?? 0) > 0 && !guardar.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setD(inicial());
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        {expense ? (
          <Button variant="ghost" size="sm" aria-label={`Editar gasto: ${expense.description}`}>
            <Pencil className="size-3.5" /> Editar
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="size-4" /> Registrar gasto
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{expense ? "Editar gasto" : "Registrar gasto"}</DialogTitle>
          <DialogDescription>
            Lo que sale de la clínica. Junto con lo cobrado, es lo que arma el resultado del período
            en Finanzas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-cat">Categoría *</Label>
              <input
                id="g-cat"
                list="categorias-gasto"
                value={d.category}
                onChange={(e) => patch({ category: e.target.value })}
                placeholder="Ej: Insumos clínicos"
                className={INPUT}
              />
              <datalist id="categorias-gasto">
                {[...new Set([...categoriasUsadas, ...CATEGORIAS_GASTO_SUGERIDAS])].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-fecha">Fecha</Label>
              <input
                id="g-fecha"
                type="date"
                value={d.incurredOn}
                onChange={(e) => patch({ incurredOn: e.target.value })}
                className={INPUT}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="g-desc">Descripción *</Label>
            <input
              id="g-desc"
              value={d.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Ej: Compra de guantes y mascarillas"
              className={INPUT}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-monto">Monto *</Label>
              <MoneyInput
                id="g-monto"
                currency={currency}
                min={0}
                valueCents={d.amount}
                onValueChange={(amount) => patch({ amount })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-prov">Proveedor</Label>
              <input
                id="g-prov"
                value={d.supplier}
                onChange={(e) => patch({ supplier: e.target.value })}
                placeholder="Opcional"
                className={INPUT}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-suc">Sucursal</Label>
              <select
                id="g-suc"
                value={d.branchId}
                onChange={(e) => patch({ branchId: e.target.value })}
                className={INPUT}
              >
                <option value="">Toda la clínica</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-medio">Medio de pago</Label>
              <select
                id="g-medio"
                value={d.paymentMethodId}
                onChange={(e) => patch({ paymentMethodId: e.target.value })}
                className={INPUT}
              >
                <option value="">Sin especificar</option>
                {medios.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="g-notas">Notas</Label>
            <textarea
              id="g-notas"
              rows={2}
              value={d.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Nº de factura, detalle, lo que haga falta"
              className={INPUT}
            />
          </div>
        </div>

        <DialogFooter className="flex-col items-end gap-1.5 sm:flex-row sm:items-center">
          {!listo && !guardar.isPending && (
            <p id="motivo-guardar-gasto" className="text-xs text-muted-foreground">
              Falta{" "}
              {[
                !d.category.trim() && "categoría",
                !d.description.trim() && "descripción",
                !((d.amount ?? 0) > 0) && "monto",
              ]
                .filter(Boolean)
                .join(", ")}
            </p>
          )}
          <Button
            onClick={() => guardar.mutate()}
            disabled={!listo}
            aria-describedby={!listo && !guardar.isPending ? "motivo-guardar-gasto" : undefined}
          >
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {expense ? "Guardar cambios" : "Registrar gasto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GastosPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const clinicId = access.clinic?.id;
  const currency = access.clinic?.currency ?? "CLP";
  const timezone = access.clinic?.timezone;
  const queryClient = useQueryClient();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId: clinicId! } }),
    enabled: Boolean(clinicId),
    staleTime: 60 * 1000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  const fetchExpenses = useServerFn(listExpenses);
  const deleteFn = useServerFn(deleteExpense);

  const {
    data: gastos = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["expenses", clinicId, search.desde, search.hasta],
    enabled: Boolean(clinicId) && !bloqueado,
    queryFn: () =>
      fetchExpenses({ data: { clinicId: clinicId!, desde: search.desde, hasta: search.hasta } }),
  });

  const borrar = useMutation({
    mutationFn: (expenseId: string) => deleteFn({ data: { clinicId: clinicId!, expenseId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["finance-summary", clinicId] });
      toast.success("Gasto borrado");
      setConfirmDeleteId(null);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const categorias = useMemo(() => [...new Set(gastos.map((g) => g.category))].sort(), [gastos]);

  const filtrados = useMemo(
    () => (search.categoria ? gastos.filter((g) => g.category === search.categoria) : gastos),
    [gastos, search.categoria],
  );

  const total = useMemo(() => filtrados.reduce((sum, g) => sum + g.amountCents, 0), [filtrados]);

  const porCategoria = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of filtrados) map.set(g.category, (map.get(g.category) ?? 0) + g.amountCents);
    return [...map.entries()].sort(([, a], [, b]) => b - a);
  }, [filtrados]);

  const set = (patch: Partial<GastosSearch>) =>
    navigate({ search: (prev: GastosSearch) => ({ ...prev, ...patch }) });

  return (
    <AppShell title="Gastos" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Gastos" sub={sub ?? null} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {/* Con error no hay total: mostrar $0 sería fabricar un dato. */}
              <p className="font-display text-2xl font-semibold tabular-nums">
                {isError ? "Sin datos" : formatMoney(total, currency)}
              </p>
              {!isError && (
                <p className="text-xs text-muted-foreground">
                  {filtrados.length} {filtrados.length === 1 ? "gasto" : "gastos"} en el período
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {filtrados.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    exportarCsv<Expense>(
                      filtrados,
                      [
                        { header: "Fecha", value: (g) => g.incurredOn },
                        { header: "Categoría", value: (g) => g.category },
                        { header: "Descripción", value: (g) => g.description },
                        { header: "Proveedor", value: (g) => g.supplier },
                        { header: "Medio de pago", value: (g) => g.methodNameSnapshot },
                        { header: "Monto", value: (g) => g.amountCents },
                        { header: "Moneda", value: (g) => g.currency },
                        { header: "Notas", value: (g) => g.notes },
                      ],
                      "gastos",
                      hoyISO(timezone),
                    )
                  }
                >
                  <Download className="size-4" /> Exportar CSV
                </Button>
              )}
              <GastoDialog
                clinicId={clinicId!}
                currency={currency}
                timezone={timezone}
                categoriasUsadas={categorias}
              />
            </div>
          </div>

          <FilterBar
            activos={search.categoria ? 1 : 0}
            onReset={() =>
              set({
                desde: primerDiaDelMes(timezone),
                hasta: hoyISO(timezone),
                categoria: "",
              })
            }
          >
            <DateField label="Desde" value={search.desde} onChange={(desde) => set({ desde })} />
            <DateField label="Hasta" value={search.hasta} onChange={(hasta) => set({ hasta })} />
            <SelectField
              label="Categoría"
              value={search.categoria}
              onChange={(categoria) => set({ categoria })}
              allLabel="Todas las categorías"
              options={categorias.map((c) => ({ value: c, label: c }))}
            />
          </FilterBar>

          {isLoading && <p className="text-sm text-muted-foreground">Cargando gastos…</p>}

          {isError && (
            <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar los gastos." />
          )}

          {!isLoading && !isError && gastos.length === 0 && (
            <div className="card-clinical p-8 text-center">
              <p className="mb-1 font-display text-lg font-semibold">Sin gastos en este período</p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                Carga arriendo, sueldos, insumos y laboratorio aquí. Finanzas los resta de lo
                cobrado y te dice si el mes cerró en verde.
              </p>
            </div>
          )}

          {!isLoading && gastos.length > 0 && filtrados.length === 0 && (
            <div className="card-clinical p-8 text-center">
              <p className="mb-1 font-display text-lg font-semibold">
                Sin gastos en la categoría seleccionada
              </p>
              <button
                type="button"
                onClick={() => set({ categoria: "" })}
                className="text-sm text-brand-700 hover:underline"
              >
                Ver todas las categorías
              </button>
            </div>
          )}

          {!isLoading && porCategoria.length > 1 && (
            <section className="card-clinical p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Por categoría
              </p>
              <div className="space-y-2">
                {porCategoria.map(([categoria, monto]) => (
                  <div key={categoria} className="flex items-center gap-3 text-sm">
                    <span className="w-40 shrink-0 truncate">{categoria}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${total ? (monto / total) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-xs cifra">
                      {formatMoney(monto, currency)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!isLoading && filtrados.length > 0 && (
            <section className="card-clinical overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium">Fecha</th>
                      <th className="px-3 py-2 text-left font-medium">Categoría</th>
                      <th className="px-3 py-2 text-left font-medium">Descripción</th>
                      <th className="px-3 py-2 text-left font-medium">Proveedor</th>
                      <th className="px-3 py-2 text-left font-medium">Medio</th>
                      <th className="px-3 py-2 text-right font-medium">Monto</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtrados.map((g) => (
                      <tr key={g.id} className="border-b border-hairline last:border-0">
                        <td className="whitespace-nowrap px-4 py-2 cifra text-xs text-muted-foreground">
                          {formatoFecha(g.incurredOn)}
                        </td>
                        <td className="px-3 py-2">{g.category}</td>
                        <td className="px-3 py-2">{g.description}</td>
                        <td className="px-3 py-2 text-muted-foreground">{g.supplier ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {g.methodNameSnapshot ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right cifra">
                          {formatMoney(g.amountCents, g.currency)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <GastoDialog
                              clinicId={clinicId!}
                              currency={currency}
                              timezone={timezone}
                              expense={g}
                              categoriasUsadas={categorias}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Borrar gasto: ${g.description}`}
                              onClick={() => setConfirmDeleteId(g.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <AlertDialog
            open={confirmDeleteId !== null}
            onOpenChange={(o) => !o && setConfirmDeleteId(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Borrar este gasto?</AlertDialogTitle>
                <AlertDialogDescription>
                  {(() => {
                    const g = gastos.find((x) => x.id === confirmDeleteId);
                    if (!g)
                      return "Se elimina definitivamente y el resultado del período se recalcula sin él.";
                    return `Se borra "${g.description}" por ${formatMoney(g.amountCents, g.currency)} del ${formatoFecha(g.incurredOn)}. El resultado del período se recalcula sin él. No se puede deshacer.`;
                  })()}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => confirmDeleteId && borrar.mutate(confirmDeleteId)}
                  disabled={borrar.isPending}
                >
                  Borrar gasto
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </AppShell>
  );
}
