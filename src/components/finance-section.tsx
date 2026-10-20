import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { captureMessage } from "@/lib/sentry";
import { WhatsAppButton } from "@/components/whatsapp-button";
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
import {
  ITEM_PAYMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  QUOTE_STATUS_LABELS,
  SIN_FASE_LABEL,
  TREATMENT_ITEM_STATUSES,
  TREATMENT_ITEM_STATUS_LABELS,
  TREATMENT_PLAN_STATUS_LABELS,
  formatMoney,
  groupByPhase,
  itemPaymentState,
  paidCentsByItem,
  type ItemPaymentState,
  type Procedure,
  type Quote,
  type QuoteStatus,
  type TreatmentItemStatus,
} from "@/lib/finance/finance";
import {
  FDI_ALL_ADULT,
  FDI_ALL_PRIMARY,
  SURFACE_LABELS,
  TOOTH_SURFACES,
  toothCommonName,
  type ToothSurface,
} from "@/lib/clinical/odontogram";
import {
  createProcedure,
  createQuote,
  listPayments,
  listProcedures,
  listQuotes,
  listTreatmentPlans,
  reversePayment,
  setQuoteStatus,
  setTreatmentItemStatus,
  updateQuote,
} from "@/lib/finance/finance.functions";
import { MoneyInput } from "@/components/money-input";
import { cn } from "@/lib/utils";
import { listProcedureSupplies } from "@/lib/clinic-operations/procedure-supplies.functions";
import { mensajeDeError } from "@/lib/mensaje-error";
import { NuevoPagoDialog } from "@/components/finance/nuevo-pago-dialog";
import {
  AceptarPresupuestoDialog,
  ConfirmarConsumoDialog,
} from "@/components/finance/dialogos-presupuesto";
import { BloqueoEscritura } from "@/components/solo-lectura";
interface Props {
  clinicId: string;
  clinicaNombre: string;
  /** Moneda de la clínica. Es la fuente para todo lo que se captura acá. */
  currency: string;
  patientId: string;
  puedeEditar: boolean;
  /** `payments:reverse` — más restrictivo que `puedeEditar` a propósito. */
  puedeReversarPagos: boolean;
  /** Dueño de lo que quede en la cola offline (ver `offline-queue.ts`). */
  userId: string;
  /**
   * Pieza que el odontograma mandó a presupuestar (G-1). Al cambiar, abre el
   * diálogo de nuevo presupuesto con esa pieza ya cargada en la primera línea.
   */
  piezaSeed?: PiezaSeed | null;
  /** Se llama al cerrar el diálogo, para que el padre limpie el seed. */
  onPiezaSeedConsumido?: () => void;
  /**
   * "Cobrar" de la cabecera de la ficha: abre el diálogo de pago con el
   * saldo ya cargado (antes solo cambiaba de pestaña y había que buscar
   * "Registrar pago"; auditoría 07-oct-2026).
   */
  abrirPago?: boolean;
  onPagoAbierto?: () => void;
}

interface DraftItem {
  procedureId: string | null;
  nameSnapshot: string;
  quantity: number;
  /**
   * Cents, igual que todo el resto de la cadena. El comentario anterior decía
   * "pesos, la conversión al server se hace vía toCents" y esa conversión no
   * existía en ningún lado: el número tipeado viajaba tal cual a
   * `unitPriceCents`. Invisible en CLP, 100× de error en MXN. Ahora el input
   * es `MoneyInput`, que muestra la unidad visible y devuelve cents.
   */
  unitPrice: number;
  discount: number;
  /**
   * Cómo se está negociando el descuento de esta línea. En "pct" el valor de
   * `discount` es un porcentaje y el server deriva los pesos; en "amount" son
   * pesos directos. El dentista negocia casi siempre en porcentaje, pero el
   * campo guardado sigue siendo cents (ver `resolveItemDiscount`).
   */
  discountMode: "amount" | "pct";
  toothNumber: number | null;
  surface: ToothSurface | null;
  phaseLabel: string;
  notes: string;
  /**
   * Marca del odontograma de la que salió la línea (PR 11b). No se edita en
   * el diálogo: solo viaja para que corregir el presupuesto no corte el
   * vínculo (los ítems se reinsertan al guardar).
   */
  odontogramMarkId: string | null;
}

const emptyItem = (overrides: Partial<DraftItem> = {}): DraftItem => ({
  procedureId: null,
  nameSnapshot: "",
  quantity: 1,
  unitPrice: 0,
  discount: 0,
  discountMode: "amount",
  toothNumber: null,
  surface: null,
  phaseLabel: "",
  notes: "",
  odontogramMarkId: null,
  ...overrides,
});

/** DraftItem → payload del server. Compartido por crear y editar. */
function draftToInput(it: DraftItem) {
  return {
    procedureId: it.procedureId ?? undefined,
    nameSnapshot: it.nameSnapshot.trim(),
    toothNumber: it.toothNumber ?? undefined,
    surface: it.surface ?? undefined,
    quantity: it.quantity,
    unitPriceCents: it.unitPrice,
    discountCents: it.discountMode === "amount" ? it.discount : 0,
    discountPct: it.discountMode === "pct" ? it.discount : null,
    phaseLabel: it.phaseLabel.trim() || null,
    notes: it.notes.trim() || undefined,
    odontogramMarkId: it.odontogramMarkId ?? undefined,
  };
}

/** QuoteItem guardado → DraftItem, para precargar el diálogo de edición. */
function quoteItemToDraft(it: Quote["items"][number]): DraftItem {
  return {
    procedureId: it.procedureId,
    nameSnapshot: it.nameSnapshot,
    quantity: it.quantity,
    unitPrice: it.unitPriceCents,
    discount: it.discountPct ?? it.discountCents,
    discountMode: it.discountPct === null ? "amount" : "pct",
    toothNumber: it.toothNumber,
    surface: it.surface,
    phaseLabel: it.phaseLabel ?? "",
    notes: it.notes ?? "",
    odontogramMarkId: it.odontogramMarkId,
  };
}

/** Descuento de una línea en pesos, con la misma regla que el server. */
function draftDiscountCents(it: DraftItem): number {
  const line = it.quantity * it.unitPrice;
  if (it.discountMode === "amount") return Math.min(it.discount, line);
  return Math.min(Math.round((line * it.discount) / 100), line);
}

function draftLineTotal(it: DraftItem): number {
  return Math.max(0, it.quantity * it.unitPrice - draftDiscountCents(it));
}

const INPUT_CLASS =
  "rounded-md border border-hairline bg-transparent px-2 py-1 text-xs outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Editor de las líneas de un presupuesto. Extraído de
 * `NuevoPresupuestoDialog`/`EditarPresupuestoDialog`, que tenían el formulario
 * duplicado carácter por carácter — al sumar pieza, superficie, fase y
 * descuento en % (Tanda A) mantener las dos copias en sincronía dejaba de ser
 * viable.
 */
function QuoteItemsEditor({
  items,
  setItems,
  procedures,
  currency,
}: {
  items: DraftItem[];
  setItems: React.Dispatch<React.SetStateAction<DraftItem[]>>;
  procedures: Procedure[];
  currency: string;
}) {
  const patch = (idx: number, cambios: Partial<DraftItem>) =>
    setItems((arr) => arr.map((x, j) => (j === idx ? { ...x, ...cambios } : x)));

  const pickProcedure = (idx: number, procId: string) => {
    if (!procId) return patch(idx, { procedureId: null });
    const p = procedures.find((x) => x.id === procId);
    if (!p) return;
    patch(idx, { procedureId: p.id, nameSnapshot: p.name, unitPrice: p.defaultPriceCents });
  };

  // Fases ya usadas en este presupuesto: alimentan el datalist para que la
  // segunda línea de "Fase 1" se escriba igual que la primera y agrupen juntas.
  const fasesUsadas = useMemo(
    () => [...new Set(items.map((it) => it.phaseLabel.trim()).filter(Boolean))],
    [items],
  );

  return (
    <div className="space-y-2">
      <datalist id="fases-presupuesto">
        {fasesUsadas.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      {items.map((it, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-hairline p-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <select
                value={it.procedureId ?? ""}
                onChange={(e) => pickProcedure(i, e.target.value)}
                aria-label={`Prestación del ítem ${i + 1}`}
                className={cn(INPUT_CLASS, "w-full")}
              >
                <option value="">— Elegir del catálogo o escribir libre —</option>
                {procedures.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {formatMoney(p.defaultPriceCents, p.currency)}
                  </option>
                ))}
              </select>
              <input
                value={it.nameSnapshot}
                onChange={(e) => patch(i, { nameSnapshot: e.target.value })}
                placeholder="Descripción del ítem"
                aria-label={`Descripción del ítem ${i + 1}`}
                className={cn(INPUT_CLASS, "w-full")}
              />
            </div>
            <button
              onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))}
              disabled={items.length === 1}
              aria-label={`Quitar ítem ${i + 1}`}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={it.phaseLabel}
              onChange={(e) => patch(i, { phaseLabel: e.target.value })}
              list="fases-presupuesto"
              placeholder="Fase"
              title="Bloque que agrupa este ítem. Vacío = sin fase."
              aria-label={`Fase del ítem ${i + 1}`}
              className={cn(INPUT_CLASS, "w-28")}
            />

            <select
              value={it.toothNumber ?? ""}
              onChange={(e) =>
                patch(i, {
                  toothNumber: e.target.value ? Number(e.target.value) : null,
                  surface: e.target.value ? it.surface : null,
                })
              }
              title="Pieza dental (FDI)"
              aria-label={`Pieza del ítem ${i + 1}`}
              className={cn(INPUT_CLASS, "w-24")}
            >
              <option value="">Sin pieza</option>
              <optgroup label="Permanente">
                {FDI_ALL_ADULT.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Temporal">
                {FDI_ALL_PRIMARY.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
            </select>

            <select
              value={it.surface ?? ""}
              onChange={(e) =>
                patch(i, { surface: (e.target.value || null) as ToothSurface | null })
              }
              disabled={it.toothNumber === null}
              title="Superficie de la pieza"
              aria-label={`Superficie del ítem ${i + 1}`}
              className={cn(INPUT_CLASS, "w-32 disabled:opacity-40")}
            >
              <option value="">Toda la pieza</option>
              {TOOTH_SURFACES.filter((s) => s !== "whole").map((s) => (
                <option key={s} value={s}>
                  {SURFACE_LABELS[s]}
                </option>
              ))}
            </select>

            <input
              type="number"
              min={1}
              max={20}
              value={it.quantity}
              onChange={(e) => patch(i, { quantity: Number(e.target.value) })}
              title="Cantidad"
              aria-label={`Cantidad del ítem ${i + 1}`}
              className={cn(INPUT_CLASS, "w-14")}
            />
            <MoneyInput
              currency={currency}
              min={0}
              valueCents={it.unitPrice}
              onValueChange={(c) => patch(i, { unitPrice: c ?? 0 })}
              mostrarMoneda={false}
              title="Precio unitario"
              aria-label={`Precio unitario del ítem ${i + 1}`}
              className={cn(INPUT_CLASS, "w-24")}
            />

            <div className="flex items-center">
              {it.discountMode === "amount" ? (
                <MoneyInput
                  currency={currency}
                  min={0}
                  valueCents={it.discount}
                  onValueChange={(c) => patch(i, { discount: c ?? 0 })}
                  mostrarMoneda={false}
                  title="Descuento en dinero"
                  aria-label={`Descuento del ítem ${i + 1}`}
                  placeholder="Desc."
                  className={cn(INPUT_CLASS, "w-16 rounded-r-none")}
                />
              ) : (
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={it.discount}
                  onChange={(e) => patch(i, { discount: Number(e.target.value) })}
                  title="Descuento en %"
                  aria-label={`Descuento del ítem ${i + 1}`}
                  placeholder="Desc."
                  className={cn(INPUT_CLASS, "w-16 rounded-r-none")}
                />
              )}
              <button
                type="button"
                onClick={() =>
                  patch(i, {
                    discountMode: it.discountMode === "amount" ? "pct" : "amount",
                    discount: 0,
                  })
                }
                title="Cambiar entre descuento en pesos y en porcentaje"
                aria-label={`Descuento del ítem ${i + 1} en ${
                  it.discountMode === "amount" ? "pesos" : "porcentaje"
                }. Cambiar.`}
                className="rounded-r-md border border-l-0 border-hairline px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary"
              >
                {it.discountMode === "amount" ? "$" : "%"}
              </button>
            </div>

            <span className="ml-auto cifra text-xs text-muted-foreground">
              {formatMoney(draftLineTotal(it), currency)}
            </span>
          </div>
        </div>
      ))}

      <button
        onClick={() =>
          setItems((arr) => [...arr, emptyItem({ phaseLabel: arr.at(-1)?.phaseLabel ?? "" })])
        }
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
      >
        <Plus className="size-3" /> Agregar otro ítem
      </button>
    </div>
  );
}

function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const tone: Record<QuoteStatus, string> = {
    draft: "bg-secondary text-muted-foreground",
    sent: "bg-info-soft text-info",
    accepted: "bg-success-soft text-success",
    converted: "bg-success-soft text-success",
    rejected: "bg-destructive/10 text-destructive",
    expired: "bg-warning-soft text-warning",
  };
  return (
    <span
      className={cn("inline-block rounded px-1.5 py-0.5 text-[11px] font-medium", tone[status])}
    >
      {QUOTE_STATUS_LABELS[status]}
    </span>
  );
}

/** ¿Vale la pena mostrar encabezados de fase en este plan/presupuesto? */
function planTieneFases(contenedor: { items: { phaseLabel: string | null }[] }): boolean {
  return contenedor.items.some((it) => it.phaseLabel !== null);
}

/**
 * Semáforo de cobro de una línea (G-5). Punto de color + la etiqueta corta
 * visible (rediseño fase 5): la auditoría de accesibilidad del 04-sep marcó
 * que el punto solo distinguía por matiz — parcial y pagado eran dos puntos
 * casi iguales para quien no ve bien el color. El detalle con montos sigue
 * en el `title`.
 */
function PagoDot({
  estado,
  pagado,
  total,
  currency,
}: {
  estado: ItemPaymentState;
  pagado: number;
  total: number;
  currency: string;
}) {
  const CORTO: Record<ItemPaymentState, string> = {
    unpaid: "Sin pagar",
    partial: "Parcial",
    paid: "Pagado",
  };
  const tono: Record<ItemPaymentState, string> = {
    unpaid: "bg-muted-foreground/30",
    partial: "bg-warning",
    paid: "bg-success",
  };
  const detalle =
    estado === "unpaid"
      ? ITEM_PAYMENT_LABELS.unpaid
      : `${ITEM_PAYMENT_LABELS[estado]} · ${formatMoney(pagado, currency)} de ${formatMoney(total, currency)}`;
  return (
    <span
      title={detalle}
      className="inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground"
    >
      <span aria-hidden className={cn("size-2 rounded-full", tono[estado])} />
      {/* El texto corto es visual; el lector de pantalla recibe el detalle
          completo (estado + monto pagado) en el span sr-only. */}
      <span aria-hidden>{CORTO[estado]}</span>
      <span className="sr-only">{detalle}</span>
    </span>
  );
}

/** Pieza y superficie de un ítem, con el nombre común en el tooltip. */
function PiezaTag({ tooth, surface }: { tooth: number; surface: ToothSurface | null }) {
  const comun = toothCommonName(tooth);
  const zona = surface && surface !== "whole" ? SURFACE_LABELS[surface] : null;
  return (
    <span
      title={[comun ? `Diente ${tooth} (${comun})` : `Diente ${tooth}`, zona]
        .filter(Boolean)
        .join(" · ")}
      className="shrink-0 rounded bg-secondary px-1.5 py-0.5 cifra text-[11px] text-muted-foreground"
    >
      {tooth}
      {zona && <span className="ml-1 font-sans">{zona.slice(0, 3)}</span>}
    </span>
  );
}

function ItemStatusPicker({
  current,
  onChange,
  disabled,
  nombreItem,
}: {
  current: TreatmentItemStatus;
  onChange: (s: TreatmentItemStatus) => void;
  disabled?: boolean;
  /** Para el nombre accesible: sin esto son N selects que se anuncian igual. */
  nombreItem: string;
}) {
  return (
    <select
      aria-label={`Estado de ${nombreItem}`}
      value={current}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as TreatmentItemStatus)}
      className="rounded-md border border-hairline bg-transparent px-1.5 py-0.5 text-[11px] disabled:opacity-50"
    >
      {TREATMENT_ITEM_STATUSES.map((s) => (
        <option key={s} value={s}>
          {TREATMENT_ITEM_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

function NuevoProcedimientoInline({
  clinicId,
  currency,
  onCreated,
}: {
  clinicId: string;
  currency: string;
  onCreated: (p: Procedure) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const createFn = useServerFn(createProcedure);
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          clinicId,
          name: name.trim(),
          category: category.trim() || undefined,
          defaultPriceCents: price ?? 0,
        },
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["procedures", clinicId] });
      onCreated({
        id: res.id,
        code: null,
        name: name.trim(),
        category: category.trim() || null,
        defaultPriceCents: price ?? 0,
        currency,
        durationMin: null,
        isActive: true,
        // Los campos de arancel (Tanda B) toman su default: esta alta rápida
        // desde el presupuesto solo pide nombre, categoría y precio. Se
        // completan después en /aranceles.
        allowsDiscount: true,
        referencePriceCents: null,
        labCostCents: null,
        position: 0,
      });
      setOpen(false);
      setName("");
      setCategory("");
      setPrice(null);
      toast.success("Procedimiento agregado al catálogo");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
        >
          <Plus className="size-3" /> Nuevo procedimiento
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo procedimiento en el catálogo</DialogTitle>
          <DialogDescription>
            Este procedimiento queda disponible para todos los presupuestos futuros de la clínica.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="proc-name">Nombre</Label>
            <input
              id="proc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Limpieza dental"
              className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="proc-cat">Categoría</Label>
              <input
                id="proc-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Preventiva"
                className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proc-price">Precio base</Label>
              <MoneyInput
                id="proc-price"
                currency={currency}
                min={0}
                valueCents={price}
                onValueChange={setPrice}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>
            {create.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Guardar procedimiento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pieza que el odontograma mandó a presupuestar (G-1). */
export interface PiezaSeed {
  tooth: number;
  surface: ToothSurface;
  /** Cambia en cada click aunque la pieza sea la misma, para reabrir el diálogo. */
  nonce: number;
}

/** Encabezado con el total y el descuento comercial en %, compartido por ambos diálogos. */
function TotalesPresupuesto({
  subtotal,
  descuentoPct,
  setDescuentoPct,
  currency,
}: {
  subtotal: number;
  descuentoPct: number;
  setDescuentoPct: (v: number) => void;
  currency: string;
}) {
  const descuento = Math.min(Math.round((subtotal * descuentoPct) / 100), subtotal);
  return (
    <div className="space-y-1.5 border-t border-hairline pt-3 text-sm">
      <div className="flex items-center justify-end gap-3">
        <span className="text-muted-foreground">Subtotal</span>
        <span className="w-32 text-right cifra text-xs">{formatMoney(subtotal, currency)}</span>
      </div>
      <div className="flex items-center justify-end gap-3">
        <label htmlFor="desc-comercial" className="text-muted-foreground">
          Descuento comercial
        </label>
        <div className="flex items-center gap-1">
          <input
            id="desc-comercial"
            type="number"
            min={0}
            max={100}
            value={descuentoPct}
            onChange={(e) => setDescuentoPct(Math.min(100, Math.max(0, Number(e.target.value))))}
            className={cn(INPUT_CLASS, "w-16 text-right")}
          />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
        <span className="w-32 text-right cifra text-xs text-muted-foreground">
          {descuento > 0 ? `− ${formatMoney(descuento, currency)}` : "—"}
        </span>
      </div>
      <div className="flex items-center justify-end gap-3 pt-1">
        <span className="text-muted-foreground">Total</span>
        <span className="w-32 text-right font-display text-lg font-semibold">
          {formatMoney(Math.max(0, subtotal - descuento), currency)}
        </span>
      </div>
    </div>
  );
}

function NuevoPresupuestoDialog({
  clinicId,
  currency,
  patientId,
  procedures,
  seed,
  onSeedConsumido,
}: {
  clinicId: string;
  currency: string;
  patientId: string;
  procedures: Procedure[];
  /** Cuando llega una pieza desde el odontograma, el diálogo se abre solo. */
  seed?: PiezaSeed | null;
  onSeedConsumido?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [descuentoPct, setDescuentoPct] = useState(0);
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [seedAplicado, setSeedAplicado] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const createFn = useServerFn(createQuote);

  // Abrir con la pieza precargada cuando el odontograma manda una. Se compara
  // por `nonce` y no por pieza para que clickear dos veces el mismo diente
  // vuelva a abrir el diálogo.
  if (seed && seed.nonce !== seedAplicado) {
    setSeedAplicado(seed.nonce);
    setItems([
      emptyItem({
        toothNumber: seed.tooth,
        surface: seed.surface === "whole" ? null : seed.surface,
      }),
    ]);
    setNotes("");
    setDescuentoPct(0);
    setOpen(true);
  }

  const subtotal = useMemo(() => items.reduce((s, it) => s + draftLineTotal(it), 0), [items]);

  const cerrar = (next: boolean) => {
    setOpen(next);
    if (!next) onSeedConsumido?.();
  };

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          clinicId,
          patientId,
          notes: notes.trim() || undefined,
          commercialDiscountPct: descuentoPct > 0 ? descuentoPct : null,
          items: items.filter((it) => it.nameSnapshot.trim()).map(draftToInput),
        },
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["quotes", clinicId, patientId] });
      toast.success(`Presupuesto ${res.number} creado`);
      cerrar(false);
      setNotes("");
      setDescuentoPct(0);
      setItems([emptyItem()]);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const puedeCrear = items.some((it) => it.nameSnapshot.trim()) && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <BloqueoEscritura>
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus className="size-4" /> Nuevo presupuesto
          </Button>
        </DialogTrigger>
      </BloqueoEscritura>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nuevo presupuesto</DialogTitle>
          <DialogDescription>
            Agrupa las prestaciones en fases si el tratamiento va por etapas. Cada ítem se convierte
            en un tratamiento del plan cuando aceptes el presupuesto.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ítems
            </p>
            <NuevoProcedimientoInline
              clinicId={clinicId}
              currency={currency}
              onCreated={(p) => {
                setItems((arr) => {
                  const emptyIdx = arr.findIndex((it) => !it.nameSnapshot.trim());
                  const target = emptyIdx >= 0 ? emptyIdx : arr.length;
                  const next = [...arr];
                  if (emptyIdx < 0) next.push(emptyItem());
                  next[target] = {
                    ...next[target],
                    procedureId: p.id,
                    nameSnapshot: p.name,
                    unitPrice: p.defaultPriceCents,
                  };
                  return next;
                });
              }}
            />
          </div>

          <QuoteItemsEditor
            items={items}
            setItems={setItems}
            procedures={procedures}
            currency={currency}
          />

          <div className="space-y-1.5">
            <Label htmlFor="q-notes">Notas</Label>
            <textarea
              id="q-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              placeholder="Observaciones o condiciones del presupuesto"
            />
          </div>

          <TotalesPresupuesto
            subtotal={subtotal}
            descuentoPct={descuentoPct}
            setDescuentoPct={setDescuentoPct}
            currency={currency}
          />
        </div>

        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={!puedeCrear}>
            {create.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Crear presupuesto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Corrige un presupuesto ya enviado sin rechazarlo y recrearlo desde cero
 * (antes la única forma de arreglar un ítem mal cargado era esa, perdiendo
 * el número correlativo — auditoría UX, 30-ago). Mismo formulario que
 * "Nuevo presupuesto", precargado con los ítems actuales; solo disponible
 * mientras el presupuesto sigue en 'draft'/'sent' (ver `canAccept` en
 * `FinanceSection` y el guard server-side en `updateQuote`).
 */
function EditarPresupuestoDialog({
  clinicId,
  patientId,
  quote,
  procedures,
}: {
  clinicId: string;
  patientId: string;
  quote: Quote;
  procedures: Procedure[];
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(quote.notes ?? "");
  const [descuentoPct, setDescuentoPct] = useState(quote.commercialDiscountPct ?? 0);
  const [items, setItems] = useState<DraftItem[]>(quote.items.map(quoteItemToDraft));
  const queryClient = useQueryClient();
  const updateFn = useServerFn(updateQuote);

  function reabrirConValoresActuales(next: boolean) {
    if (next) {
      setNotes(quote.notes ?? "");
      setDescuentoPct(quote.commercialDiscountPct ?? 0);
      setItems(quote.items.map(quoteItemToDraft));
    }
    setOpen(next);
  }

  const subtotal = useMemo(() => items.reduce((s, it) => s + draftLineTotal(it), 0), [items]);

  const update = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          quoteId: quote.id,
          clinicId,
          notes: notes.trim() || undefined,
          validUntil: quote.validUntil ?? undefined,
          commercialDiscountPct: descuentoPct > 0 ? descuentoPct : null,
          items: items.filter((it) => it.nameSnapshot.trim()).map(draftToInput),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotes", clinicId, patientId] });
      toast.success(`Presupuesto ${quote.number} actualizado`);
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const puedeGuardar = items.some((it) => it.nameSnapshot.trim()) && !update.isPending;

  return (
    <Dialog open={open} onOpenChange={reabrirConValoresActuales}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="size-3.5" /> Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Editar presupuesto {quote.number}</DialogTitle>
          <DialogDescription>
            Los cambios se guardan sobre el mismo presupuesto — no se crea uno nuevo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <QuoteItemsEditor
            items={items}
            setItems={setItems}
            procedures={procedures}
            currency={quote.currency}
          />

          <div className="space-y-1.5">
            <Label htmlFor="eq-notes">Notas</Label>
            <textarea
              id="eq-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              placeholder="Observaciones o condiciones del presupuesto"
            />
          </div>

          <TotalesPresupuesto
            subtotal={subtotal}
            descuentoPct={descuentoPct}
            setDescuentoPct={setDescuentoPct}
            currency={quote.currency}
          />
        </div>

        <DialogFooter>
          <Button onClick={() => update.mutate()} disabled={!puedeGuardar}>
            {update.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FinanceSection({
  clinicId,
  clinicaNombre,
  currency: monedaClinica,
  patientId,
  puedeEditar,
  puedeReversarPagos,
  userId,
  piezaSeed,
  onPiezaSeedConsumido,
  abrirPago,
  onPagoAbierto,
}: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [expandedQuote, setExpandedQuote] = useState<string | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  // Presupuestos aceptados donde la firma del paciente SÍ se capturó pero
  // falló la subida a Storage — distinto de "no firmó". Se muestra como
  // banner visible hasta que el staff lo descarta, no como un toast que
  // puede pasar desapercibido.
  const [signatureUploadFailedFor, setSignatureUploadFailedFor] = useState<string | null>(null);
  // "Aceptar" ya pasa por un diálogo (captura nombre/firma) antes de
  // confirmar — "Rechazar" era un solo click sin vuelta atrás, protección
  // asimétrica para dos acciones igual de definitivas (auditoría UX, 30-ago).
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);

  const fetchQuotes = useServerFn(listQuotes);
  const fetchPlans = useServerFn(listTreatmentPlans);
  const fetchProcedures = useServerFn(listProcedures);
  const fetchPayments = useServerFn(listPayments);
  const reversePaymentFn = useServerFn(reversePayment);
  const [reversingPaymentId, setReversingPaymentId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const setStatusFn = useServerFn(setQuoteStatus);
  const setItemFn = useServerFn(setTreatmentItemStatus);

  const {
    data: quotes = [],
    isLoading: qLoading,
    error: qError,
  } = useQuery({
    queryKey: ["quotes", clinicId, patientId],
    queryFn: () => fetchQuotes({ data: { clinicId, patientId } }),
  });
  const {
    data: plans = [],
    isLoading: pLoading,
    error: pError,
  } = useQuery({
    queryKey: ["treatment-plans", clinicId, patientId],
    queryFn: () => fetchPlans({ data: { clinicId, patientId } }),
  });
  const { data: procedures = [] } = useQuery({
    queryKey: ["procedures", clinicId],
    queryFn: () => fetchProcedures({ data: { clinicId } }),
  });
  const { data: payments = [] } = useQuery({
    queryKey: ["payments", clinicId, patientId],
    queryFn: () => fetchPayments({ data: { clinicId, patientId } }),
  });

  /** Cents imputados a cada ítem del plan, para el semáforo por línea (G-5). */
  const pagosPorItem = useMemo(() => paidCentsByItem(payments), [payments]);

  // Resumen de saldo calculado client-side desde plans + payments — tiene que
  // coincidir con el saldo del header (calculado server-side en getPatient).
  // Los planes cancelados no cuentan en la deuda comprometida (misma regla en
  // ambos lados).
  const planesActivos = plans.filter((p) => p.status !== "cancelled");
  // `patientCents ?? priceCents`, igual que `fetchPatientBalances`: con
  // convenio, lo que el paciente debe NO es el precio de la línea. Antes esta
  // tarjeta sumaba el precio de lista y mostraba un número distinto al del
  // header de la misma página (auditoría 04-sep).
  const totalBilled = planesActivos.reduce(
    (s, p) => s + p.items.reduce((si, it) => si + (it.patientCents ?? it.priceCents), 0),
    0,
  );
  const totalPaid = payments.reduce((s, p) => s + p.amountCents, 0);
  const balance = totalBilled - totalPaid;
  // Las filas viejas mandan (se cotizaron en su moneda); si no hay ninguna,
  // la referencia es la clínica y no un "CLP" cableado.
  const currency = planesActivos[0]?.currency ?? payments[0]?.currency ?? monedaClinica;

  const accept = useMutation({
    mutationFn: (v: { quoteId: string; acceptedByName?: string; signatureDataUrl?: string }) =>
      setStatusFn({
        data: {
          quoteId: v.quoteId,
          status: "accepted",
          acceptedByName: v.acceptedByName,
          signatureDataUrl: v.signatureDataUrl,
        },
      }),
    onSuccess: async (result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["quotes", clinicId, patientId] });
      await queryClient.invalidateQueries({ queryKey: ["treatment-plans", clinicId, patientId] });
      // Mismo "saldo fantasma" que NuevoPagoDialog: aceptar un presupuesto
      // cambia "facturado" (se crea el plan de tratamiento), y el header de
      // saldo viene del loader de la ruta, no de React Query.
      void router.invalidate();
      if (result.signatureUploadFailed) {
        // El paciente sí firmó, pero no pudimos guardar la imagen — el
        // presupuesto queda aceptado igual (evidencia de IP + nombre), pero
        // esto NO puede pasar como un success silencioso: el staff necesita
        // saber que la firma no quedó guardada para volver a intentarlo.
        setSignatureUploadFailedFor(variables.quoteId);
        console.error("Falló la subida de la firma del presupuesto", {
          quoteId: variables.quoteId,
        });
        void captureMessage("quote signature upload failed", {
          level: "error",
          extra: { quoteId: variables.quoteId },
        });
        toast.error(
          "Presupuesto aceptado, pero no pudimos guardar la firma del paciente. Vuelve a intentarlo.",
        );
      } else {
        toast.success("Presupuesto aceptado y convertido en plan de tratamiento");
      }
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const reject = useMutation({
    mutationFn: (quoteId: string) => setStatusFn({ data: { quoteId, status: "rejected" } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotes", clinicId, patientId] });
      setConfirmRejectId(null);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const reversePaymentMutation = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      reversePaymentFn({ data: { id: v.id, clinicId, reason: v.reason } }),
    onSuccess: () => {
      toast.success("Pago reversado.");
      queryClient.invalidateQueries({ queryKey: ["payments", clinicId, patientId] });
      setReversingPaymentId(null);
      setReversalReason("");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const setItem = useMutation({
    mutationFn: (v: {
      itemId: string;
      status: TreatmentItemStatus;
      supplyOverrides?: Record<string, number>;
    }) => setItemFn({ data: v }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["treatment-plans", clinicId, patientId] });
      // Tanda 1 — receta de insumos: el tratamiento se completa igual aunque
      // algún insumo no se haya podido descontar por falta de stock, pero
      // avisamos en vez de dejarlo pasar en silencio.
      if (result.skippedSupplyCount > 0) {
        toast.warning(
          result.skippedSupplyCount === 1
            ? "Se completó el tratamiento, pero un insumo no se pudo descontar por falta de stock."
            : `Se completó el tratamiento, pero ${result.skippedSupplyCount} insumos no se pudieron descontar por falta de stock.`,
        );
      }
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  // Tanda 2 — antes de completar un ítem con procedimiento, chequeamos en
  // silencio (sin abrir nada todavía) si su receta tiene algún insumo
  // `variable`. Mismo queryKey que ConfirmarConsumoDialog: React Query
  // dedupe la request, así que esto no duplica tráfico de red.
  const [pendingCompletion, setPendingCompletion] = useState<{
    itemId: string;
    procedureId: string;
    nombreItem: string;
  } | null>(null);
  const fetchSuppliesGate = useServerFn(listProcedureSupplies);
  const { data: gateSupplies } = useQuery({
    queryKey: ["procedure-supplies", clinicId, pendingCompletion?.procedureId],
    enabled: pendingCompletion !== null,
    queryFn: () =>
      fetchSuppliesGate({
        data: { clinicId, procedureId: pendingCompletion!.procedureId },
      }),
  });
  const pendingHasVariableSupplies = (gateSupplies?.supplies ?? []).some(
    (s) => s.consumptionType === "variable",
  );

  useEffect(() => {
    // Receta toda `fixed` (o sin receta): nada que ajustar, se completa
    // directo — cero fricción, mismo comportamiento que la Tanda 1.
    if (pendingCompletion && gateSupplies && !pendingHasVariableSupplies) {
      setItem.mutate({ itemId: pendingCompletion.itemId, status: "completed" });
      setPendingCompletion(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCompletion, gateSupplies, pendingHasVariableSupplies]);

  const isLoading = qLoading || pLoading;
  // `useQuery` con `data = []` por defecto convierte un error del servidor en
  // una lista vacía, y la sección termina diciendo "sin presupuestos" cuando
  // en realidad la consulta falló. Distinguir los dos casos importa: acá se
  // muestra plata, y un error leído como "no hay nada" hace que alguien
  // cobre de menos.
  const loadError = qError ?? pError;

  return (
    <div className="card-clinical p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Presupuestos y tratamientos</h3>
          <p className="text-xs text-muted-foreground">
            Aceptar un presupuesto crea automáticamente el plan de tratamiento con sus ítems.
          </p>
        </div>
        {puedeEditar && (
          <div className="flex flex-wrap items-center gap-2">
            <NuevoPagoDialog
              clinicId={clinicId}
              patientId={patientId}
              userId={userId}
              plans={plans}
              suggestedAmountCents={Math.max(0, balance)}
              currency={currency}
              abrirAhora={Boolean(abrirPago) && !isLoading}
              onAbierto={onPagoAbierto}
            />
            <NuevoPresupuestoDialog
              clinicId={clinicId}
              currency={currency}
              patientId={patientId}
              procedures={procedures}
              seed={piezaSeed}
              onSeedConsumido={onPiezaSeedConsumido}
            />
          </div>
        )}
      </div>

      {(totalBilled > 0 || totalPaid > 0) && (
        <div className="mb-5 grid gap-3 rounded-lg border border-hairline bg-secondary/40 p-3 sm:grid-cols-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Facturado</p>
            <p className="font-display text-base font-semibold">
              {formatMoney(totalBilled, currency)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Pagado</p>
            <p className="font-display text-base font-semibold">
              {formatMoney(totalPaid, currency)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {balance > 0 ? "Saldo pendiente" : balance < 0 ? "A favor del paciente" : "Saldo"}
            </p>
            <p
              className={cn(
                "font-display text-base font-semibold",
                balance > 0 && "text-warning",
                balance < 0 && "text-success",
              )}
            >
              {balance === 0 ? "Al día" : formatMoney(Math.abs(balance), currency)}
            </p>
          </div>
        </div>
      )}

      {isLoading && <p className="text-xs text-muted-foreground">Cargando…</p>}

      {!isLoading && loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <p>
            No pudimos cargar los presupuestos y planes de este paciente, así que lo que ves abajo
            está incompleto — no asumas que no tiene nada cargado. Recarga la página; si sigue
            igual, avisa al equipo antes de cobrarle.
          </p>
        </div>
      )}

      {!isLoading && (
        <div className="space-y-6">
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Planes de tratamiento
            </p>
            {plans.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aún no hay planes de tratamiento activos.
              </p>
            )}
            {plans.map((plan) => {
              const done = plan.items.filter((it) => it.status === "completed").length;
              const isOpen = expandedPlan === plan.id;
              return (
                <div key={plan.id} className="mb-3 rounded-lg border border-hairline">
                  <button
                    onClick={() => setExpandedPlan(isOpen ? null : plan.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="size-4 text-brand" />
                      <div>
                        <p className="text-sm font-medium">{plan.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {TREATMENT_PLAN_STATUS_LABELS[plan.status]} · {done}/{plan.items.length}{" "}
                          ítems completados
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-display text-sm font-semibold">
                        {formatMoney(plan.totalCents, plan.currency)}
                      </span>
                      {isOpen ? (
                        <ChevronUp className="size-4" />
                      ) : (
                        <ChevronDown className="size-4" />
                      )}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-hairline">
                      {groupByPhase(plan.items, (it) => it.patientCents ?? it.priceCents).map(
                        (fase) => (
                          <div key={fase.label ?? "sin-fase"}>
                            {/* El encabezado de fase solo aparece si el plan usa
                              fases: un plan de una sola línea no necesita el
                              ruido de una "Sin fase" que no agrupa nada. */}
                            {planTieneFases(plan) && (
                              <div className="flex items-center justify-between gap-3 bg-secondary/40 px-4 py-1.5">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  {fase.label ?? SIN_FASE_LABEL}
                                </span>
                                <span className="cifra text-xs text-muted-foreground">
                                  {formatMoney(fase.subtotalCents, plan.currency)}
                                </span>
                              </div>
                            )}
                            <div className="divide-y divide-hairline">
                              {fase.items.map((it) => (
                                <div
                                  key={it.id}
                                  className="flex items-center gap-3 px-4 py-2 text-xs"
                                >
                                  <PagoDot
                                    estado={itemPaymentState(
                                      pagosPorItem.get(it.id) ?? 0,
                                      // Contra lo que debe el paciente: con
                                      // convenio, pagar su parte es pagar todo.
                                      it.patientCents ?? it.priceCents,
                                    )}
                                    pagado={pagosPorItem.get(it.id) ?? 0}
                                    total={it.patientCents ?? it.priceCents}
                                    currency={plan.currency}
                                  />
                                  <span className="min-w-0 flex-1 truncate">{it.nameSnapshot}</span>
                                  {it.toothNumber && (
                                    <PiezaTag tooth={it.toothNumber} surface={it.surface} />
                                  )}
                                  <span className="cifra text-muted-foreground">
                                    {it.patientCents !== null &&
                                    it.patientCents !== it.priceCents ? (
                                      <span
                                        title={`Precio ${formatMoney(it.priceCents, plan.currency)} · cubre el convenio ${formatMoney(it.coverageCents ?? 0, plan.currency)}`}
                                      >
                                        {formatMoney(it.patientCents, plan.currency)}
                                        <span className="ml-1 text-[11px] line-through opacity-60">
                                          {formatMoney(it.priceCents, plan.currency)}
                                        </span>
                                      </span>
                                    ) : (
                                      formatMoney(it.priceCents, plan.currency)
                                    )}
                                  </span>
                                  <ItemStatusPicker
                                    nombreItem={it.nameSnapshot}
                                    current={it.status}
                                    disabled={!puedeEditar}
                                    onChange={(s) => {
                                      // Tanda 2: completar con procedimiento
                                      // pasa primero por el gate de la
                                      // receta — cualquier otra transición
                                      // (o sin procedimiento) sigue directo.
                                      if (s === "completed" && it.procedureId) {
                                        setPendingCompletion({
                                          itemId: it.id,
                                          procedureId: it.procedureId,
                                          nombreItem: it.nameSnapshot,
                                        });
                                      } else {
                                        setItem.mutate({ itemId: it.id, status: s });
                                      }
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Presupuestos
            </p>
            {quotes.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin presupuestos registrados todavía.</p>
            )}
            {quotes.map((quote) => {
              const isOpen = expandedQuote === quote.id;
              const canAccept =
                puedeEditar && (quote.status === "draft" || quote.status === "sent");
              return (
                <div key={quote.id} className="mb-3 rounded-lg border border-hairline">
                  <button
                    onClick={() => setExpandedQuote(isOpen ? null : quote.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="size-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{quote.number}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(quote.createdAt).toLocaleDateString("es-CL")} ·{" "}
                          {quote.items.length} ítems
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <QuoteStatusBadge status={quote.status} />
                      <span className="font-display text-sm font-semibold">
                        {formatMoney(quote.totalCents, quote.currency)}
                      </span>
                      {isOpen ? (
                        <ChevronUp className="size-4" />
                      ) : (
                        <ChevronDown className="size-4" />
                      )}
                    </div>
                  </button>
                  {signatureUploadFailedFor === quote.id && (
                    <div className="flex items-start gap-2 border-t border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <p>
                        El paciente firmó, pero no pudimos guardar la imagen de la firma. El
                        presupuesto quedó aceptado igual; vuelve a intentar guardar la firma o
                        registrala aparte.
                      </p>
                      <button
                        type="button"
                        onClick={() => setSignatureUploadFailedFor(null)}
                        className="ml-auto shrink-0 text-warning/70 underline-offset-2 hover:underline"
                      >
                        Descartar
                      </button>
                    </div>
                  )}
                  {isOpen && (
                    <>
                      <div className="border-t border-hairline">
                        {groupByPhase(quote.items, (it) => it.totalCents).map((fase) => (
                          <div key={fase.label ?? "sin-fase"}>
                            {planTieneFases(quote) && (
                              <div className="flex items-center justify-between gap-3 bg-secondary/40 px-4 py-1.5">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  {fase.label ?? SIN_FASE_LABEL}
                                </span>
                                <span className="cifra text-xs text-muted-foreground">
                                  {formatMoney(fase.subtotalCents, quote.currency)}
                                </span>
                              </div>
                            )}
                            <div className="divide-y divide-hairline">
                              {fase.items.map((it) => (
                                <div
                                  key={it.id}
                                  className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 px-4 py-2 text-xs"
                                >
                                  <span className="min-w-0 truncate">{it.nameSnapshot}</span>
                                  {it.toothNumber ? (
                                    <PiezaTag tooth={it.toothNumber} surface={it.surface} />
                                  ) : (
                                    <span />
                                  )}
                                  <span className="text-muted-foreground">×{it.quantity}</span>
                                  {/* El descuento se muestra como se negoció:
                                      en % si así se cargó, en pesos si no. */}
                                  <span className="cifra text-muted-foreground">
                                    {it.discountPct !== null
                                      ? `−${it.discountPct}%`
                                      : it.discountCents > 0
                                        ? `−${formatMoney(it.discountCents, quote.currency)}`
                                        : formatMoney(it.unitPriceCents, quote.currency)}
                                  </span>
                                  <span className="cifra font-medium">
                                    {formatMoney(it.totalCents, quote.currency)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                        {quote.discountCents > 0 && (
                          <div className="flex items-center justify-end gap-3 border-t border-hairline px-4 py-2 text-xs">
                            <span className="text-muted-foreground">
                              Descuento comercial
                              {quote.commercialDiscountPct !== null &&
                                ` (${quote.commercialDiscountPct}%)`}
                            </span>
                            <span className="cifra text-muted-foreground">
                              − {formatMoney(quote.discountCents, quote.currency)}
                            </span>
                          </div>
                        )}
                        {/* Reparto del convenio. Solo aparece si el
                            presupuesto tiene uno: un particular no necesita
                            ver una fila que dice "cubre $0". */}
                        {quote.coverageTotalCents !== null && (
                          <div className="space-y-1 border-t border-hairline bg-secondary/30 px-4 py-2 text-xs">
                            <div className="flex items-center justify-end gap-3">
                              <span className="text-muted-foreground">
                                Cubre {quote.agreementNameSnapshot ?? "el convenio"}
                              </span>
                              <span className="cifra text-muted-foreground">
                                − {formatMoney(quote.coverageTotalCents, quote.currency)}
                              </span>
                            </div>
                            <div className="flex items-center justify-end gap-3">
                              <span className="font-medium">Paga el paciente</span>
                              <span className="cifra font-semibold">
                                {formatMoney(
                                  Math.max(0, quote.totalCents - quote.coverageTotalCents),
                                  quote.currency,
                                )}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-2">
                        {canAccept && (
                          <>
                            <AceptarPresupuestoDialog
                              defaultName=""
                              pending={accept.isPending}
                              onConfirm={(acceptedByName, signatureDataUrl) =>
                                accept.mutate({
                                  quoteId: quote.id,
                                  acceptedByName,
                                  signatureDataUrl,
                                })
                              }
                            />
                            <EditarPresupuestoDialog
                              clinicId={clinicId}
                              patientId={patientId}
                              quote={quote}
                              procedures={procedures}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmRejectId(quote.id)}
                              disabled={reject.isPending}
                            >
                              <X className="size-3.5" /> Rechazar
                            </Button>
                          </>
                        )}
                        <div className="ml-auto">
                          <WhatsAppButton
                            clinicId={clinicId}
                            patientId={patientId}
                            quoteId={quote.id}
                            templateKind="quote_sent"
                            variant="full"
                            label="Enviar por WhatsApp"
                            variables={{
                              numero_presupuesto: quote.number,
                              total: formatMoney(quote.totalCents, quote.currency),
                              clinica: clinicaNombre,
                            }}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </section>

          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pagos registrados
            </p>
            {payments.length === 0 && (
              <p className="text-xs text-muted-foreground">Aún no hay pagos registrados.</p>
            )}
            {payments.map((pay) => {
              const plan = plans.find((p) => p.id === pay.treatmentPlanId);
              return (
                <div
                  key={pay.id}
                  className={cn(
                    "mb-2 flex items-center justify-between gap-3 rounded-lg border border-hairline px-4 py-2 text-xs",
                    pay.reversedAt && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <CircleDollarSign
                      className={cn(
                        "size-4",
                        pay.reversedAt ? "text-muted-foreground" : "text-success",
                      )}
                    />
                    <div>
                      <p className={cn("text-sm font-medium", pay.reversedAt && "line-through")}>
                        {formatMoney(pay.amountCents, pay.currency)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {PAYMENT_METHOD_LABELS[pay.method]}
                        {plan && ` · ${plan.name}`}
                        {!plan && pay.treatmentPlanId === null && " · A cuenta"}
                        {pay.reference && ` · Ref. ${pay.reference}`}
                        {pay.reversedAt && ` · Reversado: ${pay.reversalReason}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {new Date(pay.paidAt).toLocaleString("es-CL", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                    {puedeReversarPagos && !pay.reversedAt && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => setReversingPaymentId(pay.id)}
                      >
                        Reversar
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      )}

      <AlertDialog
        open={reversingPaymentId !== null}
        onOpenChange={(next) => {
          if (!next) {
            setReversingPaymentId(null);
            setReversalReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reversar pago</AlertDialogTitle>
            <AlertDialogDescription>
              El pago no se borra: queda tachado en el historial con el motivo, y deja de contar
              para el saldo del paciente, la caja del turno y los reportes. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo-reversa" className="text-xs">
              Motivo (obligatorio)
            </Label>
            <textarea
              id="motivo-reversa"
              className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              rows={2}
              value={reversalReason}
              onChange={(e) => setReversalReason(e.target.value)}
              placeholder="Ej: se cargó dos veces por error"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                reversingPaymentId &&
                reversePaymentMutation.mutate({ id: reversingPaymentId, reason: reversalReason })
              }
              disabled={reversePaymentMutation.isPending || reversalReason.trim().length < 3}
            >
              {reversePaymentMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Reversar pago
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmRejectId !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmRejectId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rechazar presupuesto</AlertDialogTitle>
            <AlertDialogDescription>
              El presupuesto queda marcado como rechazado — para retomarlo hay que corregirlo y
              volver a enviarlo. ¿Confirmas que lo rechazas?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRejectId && reject.mutate(confirmRejectId)}
              disabled={reject.isPending}
            >
              {reject.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Rechazar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {pendingCompletion && gateSupplies && pendingHasVariableSupplies && (
        <ConfirmarConsumoDialog
          clinicId={clinicId}
          pending={pendingCompletion}
          onClose={() => setPendingCompletion(null)}
          onConfirm={(overrides) => {
            setItem.mutate({
              itemId: pendingCompletion.itemId,
              status: "completed",
              supplyOverrides: overrides,
            });
            setPendingCompletion(null);
          }}
          confirming={setItem.isPending}
        />
      )}
    </div>
  );
}
