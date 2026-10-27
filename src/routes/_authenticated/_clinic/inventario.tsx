import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ClipboardList,
  History,
  Loader2,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Repeat,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ExportarCsvLista } from "@/components/exportar-csv-lista";
import { montoPlanilla, siNoPlanilla } from "@/lib/exportacion/listas-csv";
import { TrialDesbloqueo } from "@/components/trial-desbloqueo";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasPermission } from "@/lib/access/access";
import { getMySubscription } from "@/lib/billing.functions";
import { informesBloqueados } from "@/lib/billing";
import { listBranches } from "@/lib/clinic-operations/clinic-catalog.functions";
import {
  listStockByWarehouse,
  listWarehouses,
} from "@/lib/clinic-operations/clinic-operations.functions";
import type { Sucursal } from "@/lib/clinic-operations/clinic-data";
import { formatMoney, fromCents, toCents } from "@/lib/finance/finance";
import type { Warehouse } from "@/lib/finance/finance";
import {
  createInventoryItem,
  listExpiringLots,
  listInventoryItems,
  listInventoryMovements,
  registerInventoryMovement,
  updateInventoryItem,
  type InventoryItem,
  type InventoryMovementKind,
} from "@/lib/clinic-operations/inventory.functions";
import {
  listInventoryCounts,
  recordInventoryCount,
} from "@/lib/clinic-operations/inventory-counts.functions";
import type { ConsumptionType } from "@/lib/clinic-operations/procedure-supply-consumption";
import { requirePermission } from "@/lib/access/route-guards";
import { mensajeDeError } from "@/lib/mensaje-error";
import { fecha, fechaHora } from "@/lib/formato-fecha";
import { useZonaClinica } from "@/hooks/use-zona-clinica";

const MOVEMENT_LABELS: Record<InventoryMovementKind, string> = {
  entrada: "Entrada",
  salida: "Salida",
  ajuste: "Ajuste (recuento)",
};

/** Roles que pueden registrar movimientos de stock (INSERT en
 * inventory_movements) — mismo set que la policy `inventory_movements_insert_clinical`.
 * reception queda afuera aunque sí puede ver inventario. */
const MOVEMENT_ROLES = new Set(["owner", "admin", "dentist", "assistant"]);

type DialogoControlado = {
  /** Abierto desde el menú de acciones de la fila: el diálogo no pinta su botón. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Estado propio del diálogo, o el de quien lo controla (el menú de la fila). */
function useAbierto({
  open,
  onOpenChange,
}: DialogoControlado): [boolean, (open: boolean) => void, boolean] {
  const [propio, setPropio] = useState(false);
  const controlado = open !== undefined;
  return [
    controlado ? open : propio,
    controlado ? (onOpenChange ?? (() => {})) : setPropio,
    controlado,
  ];
}

function inputClass() {
  return "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-700 pointer-coarse:text-base";
}

const CONSUMPTION_TYPE_LABELS: Record<ConsumptionType, string> = {
  fixed: "Uso único (guante, aguja, cartucho)",
  variable: "Fraccionable (gasas, algodón, gel)",
  shared: "Compartido, no ligado a un procedimiento",
};

/** Select de tipo de consumo + rendimiento — compartido entre crear/editar
 * para no repetir el mismo bloque dos veces. */
function ConsumoFields({
  idPrefix,
  consumptionType,
  onConsumptionTypeChange,
  yieldPct,
  onYieldPctChange,
}: {
  idPrefix: string;
  consumptionType: ConsumptionType;
  onConsumptionTypeChange: (v: ConsumptionType) => void;
  yieldPct: string;
  onYieldPctChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-tipo`}>Tipo de consumo</Label>
        <select
          id={`${idPrefix}-tipo`}
          value={consumptionType}
          onChange={(e) => onConsumptionTypeChange(e.target.value as ConsumptionType)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {(Object.entries(CONSUMPTION_TYPE_LABELS) as [ConsumptionType, string][]).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ),
          )}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-rendimiento`}>Rendimiento esperado (%)</Label>
        <input
          id={`${idPrefix}-rendimiento`}
          type="number"
          min={1}
          max={100}
          step="0.01"
          value={yieldPct}
          onChange={(e) => onYieldPctChange(e.target.value)}
          className={inputClass()}
          placeholder="100 = sin merma"
        />
      </div>
    </div>
  );
}

function CrearItemDialog({
  clinicId,
  currency,
  sucursales,
}: {
  clinicId: string;
  currency: string;
  /** Vacío o con 1 elemento = no se muestra el selector (caso común). */
  sucursales: Sucursal[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [minStock, setMinStock] = useState("");
  const [costPesos, setCostPesos] = useState("");
  const [notes, setNotes] = useState("");
  const [branchId, setBranchId] = useState("");
  const [consumptionType, setConsumptionType] = useState<ConsumptionType>("fixed");
  const [yieldPct, setYieldPct] = useState("100");

  const queryClient = useQueryClient();
  const createFn = useServerFn(createInventoryItem);

  const crear = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          clinicId,
          name: name.trim(),
          unit: unit.trim(),
          minStock: minStock.trim() === "" ? null : Number(minStock),
          costCents: costPesos.trim() === "" ? null : toCents(Number(costPesos), currency),
          notes: notes.trim() || undefined,
          branchId: sucursales.length > 1 ? branchId || null : undefined,
          consumptionType,
          yieldPct: yieldPct.trim() === "" ? 100 : Number(yieldPct),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items", clinicId] });
      toast.success("Ítem creado.");
      setOpen(false);
      setName("");
      setUnit("");
      setMinStock("");
      setCostPesos("");
      setNotes("");
      setBranchId("");
      setConsumptionType("fixed");
      setYieldPct("100");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Nuevo ítem
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo ítem de inventario</DialogTitle>
          <DialogDescription>
            El stock inicial se carga después con un movimiento de entrada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="inv-nombre">Nombre</Label>
            <input
              id="inv-nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass()}
              placeholder="Guantes de nitrilo talla M"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-unidad">Unidad</Label>
              <input
                id="inv-unidad"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className={inputClass()}
                placeholder="caja / unidad / ml"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-min">Stock mínimo (opcional)</Label>
              <input
                id="inv-min"
                type="number"
                min={0}
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                className={inputClass()}
                placeholder="Sin alerta configurada"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-costo">Costo unitario (opcional)</Label>
            <input
              id="inv-costo"
              type="number"
              min={0}
              step="0.01"
              value={costPesos}
              onChange={(e) => setCostPesos(e.target.value)}
              className={inputClass()}
              placeholder="Sin costo cargado"
            />
          </div>
          <ConsumoFields
            idPrefix="inv"
            consumptionType={consumptionType}
            onConsumptionTypeChange={setConsumptionType}
            yieldPct={yieldPct}
            onYieldPctChange={setYieldPct}
          />
          <div className="space-y-1.5">
            <Label htmlFor="inv-notas">Notas (opcional)</Label>
            <input
              id="inv-notas"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass()}
            />
          </div>
          {sucursales.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="inv-sucursal">Sucursal (opcional)</Label>
              <select
                id="inv-sucursal"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <option value="">Sin sucursal asignada (compartido)</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => crear.mutate()}
            disabled={
              crear.isPending ||
              !name.trim() ||
              !unit.trim() ||
              !(Number(yieldPct) > 0 && Number(yieldPct) <= 100) ||
              (minStock.trim() !== "" && !(Number(minStock) >= 0)) ||
              (costPesos.trim() !== "" && !(Number(costPesos) >= 0))
            }
          >
            {crear.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Crear ítem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarItemDialog({
  clinicId,
  item,
  currency,
  sucursales,
  ...control
}: {
  clinicId: string;
  item: InventoryItem;
  currency: string;
  sucursales: Sucursal[];
} & DialogoControlado) {
  const [open, setOpen, controlado] = useAbierto(control);
  const [name, setName] = useState(item.name);
  const [unit, setUnit] = useState(item.unit);
  const [minStock, setMinStock] = useState(item.minStock == null ? "" : String(item.minStock));
  const [costPesos, setCostPesos] = useState(
    item.costCents == null ? "" : String(fromCents(item.costCents, currency)),
  );
  const [notes, setNotes] = useState(item.notes ?? "");
  const [isActive, setIsActive] = useState(item.isActive);
  const [branchId, setBranchId] = useState(item.branchId ?? "");
  const [consumptionType, setConsumptionType] = useState<ConsumptionType>(item.consumptionType);
  const [yieldPct, setYieldPct] = useState(String(item.yieldPct));

  const queryClient = useQueryClient();
  const updateFn = useServerFn(updateInventoryItem);

  const guardar = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          clinicId,
          itemId: item.id,
          name: name.trim(),
          unit: unit.trim(),
          minStock: minStock.trim() === "" ? null : Number(minStock),
          costCents: costPesos.trim() === "" ? null : toCents(Number(costPesos), currency),
          notes: notes.trim() || undefined,
          isActive,
          branchId: sucursales.length > 1 ? branchId || null : undefined,
          consumptionType,
          yieldPct: yieldPct.trim() === "" ? 100 : Number(yieldPct),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items", clinicId] });
      toast.success("Ítem actualizado.");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlado && (
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            Editar
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar {item.name}</DialogTitle>
          <DialogDescription>
            El stock actual no se edita aquí — se ajusta con un movimiento.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`ei-nombre-${item.id}`}>Nombre</Label>
            <input
              id={`ei-nombre-${item.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass()}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`ei-unidad-${item.id}`}>Unidad</Label>
              <input
                id={`ei-unidad-${item.id}`}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className={inputClass()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`ei-min-${item.id}`}>Stock mínimo</Label>
              <input
                id={`ei-min-${item.id}`}
                type="number"
                min={0}
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                className={inputClass()}
                placeholder="Sin alerta configurada"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`ei-costo-${item.id}`}>Costo unitario</Label>
            <input
              id={`ei-costo-${item.id}`}
              type="number"
              min={0}
              step="0.01"
              value={costPesos}
              onChange={(e) => setCostPesos(e.target.value)}
              className={inputClass()}
              placeholder="Sin costo cargado"
            />
          </div>
          <ConsumoFields
            idPrefix={`ei-${item.id}`}
            consumptionType={consumptionType}
            onConsumptionTypeChange={setConsumptionType}
            yieldPct={yieldPct}
            onYieldPctChange={setYieldPct}
          />
          <div className="space-y-1.5">
            <Label htmlFor={`ei-notas-${item.id}`}>Notas</Label>
            <input
              id={`ei-notas-${item.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass()}
            />
          </div>
          {sucursales.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor={`ei-sucursal-${item.id}`}>Sucursal</Label>
              <select
                id={`ei-sucursal-${item.id}`}
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <option value="">Sin sucursal asignada (compartido)</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Ítem activo (desmarcar = dar de baja, no borra el historial)
          </label>
        </div>
        <DialogFooter>
          <Button
            onClick={() => guardar.mutate()}
            disabled={
              guardar.isPending ||
              !name.trim() ||
              !unit.trim() ||
              !(Number(yieldPct) > 0 && Number(yieldPct) <= 100) ||
              (minStock.trim() !== "" && !(Number(minStock) >= 0)) ||
              (costPesos.trim() !== "" && !(Number(costPesos) >= 0))
            }
          >
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegistrarMovimientoDialog({
  clinicId,
  item,
  bodegas,
}: {
  clinicId: string;
  item: InventoryItem;
  bodegas: Warehouse[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<InventoryMovementKind>("entrada");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const multiBodega = bodegas.length > 1;

  const queryClient = useQueryClient();
  const registerFn = useServerFn(registerInventoryMovement);

  const registrar = useMutation({
    mutationFn: () =>
      registerFn({
        data: {
          clinicId,
          itemId: item.id,
          kind,
          quantity: Number(quantity),
          reason: reason.trim() || undefined,
          warehouseId: multiBodega && warehouseId ? warehouseId : null,
          lotNumber: kind === "entrada" ? lotNumber.trim() || undefined : undefined,
          expirationDate: kind === "entrada" ? expirationDate || undefined : undefined,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements", clinicId, item.id] });
      queryClient.invalidateQueries({ queryKey: ["inventory-expiring", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-stock", clinicId] });
      toast.success("Movimiento registrado.");
      setOpen(false);
      setQuantity("");
      setReason("");
      setLotNumber("");
      setExpirationDate("");
      setKind("entrada");
      setWarehouseId("");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Repeat className="size-3.5" /> Movimiento
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar movimiento — {item.name}</DialogTitle>
          <DialogDescription>
            Stock actual: {item.currentStock} {item.unit}
            {multiBodega ? " en total, sumando todas las bodegas" : ""}. Un movimiento no se puede
            editar después — un error se corrige con un ajuste nuevo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`mv-tipo-${item.id}`}>Tipo</Label>
            <select
              id={`mv-tipo-${item.id}`}
              value={kind}
              onChange={(e) => setKind(e.target.value as InventoryMovementKind)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {(Object.keys(MOVEMENT_LABELS) as InventoryMovementKind[]).map((k) => (
                <option key={k} value={k}>
                  {MOVEMENT_LABELS[k]}
                </option>
              ))}
            </select>
            {kind === "ajuste" && (
              <p className="text-xs text-muted-foreground">
                El ajuste fija el stock al valor contado (recuento físico), no lo suma ni lo resta.
                {multiBodega
                  ? " Fija el stock de la bodega elegida; las demás quedan como están y el total pasa a ser la suma. Para conciliar la clínica entera, usa “Conteo físico”."
                  : ' Para un conteo de una bodega puntual, usa "Conteo físico" en vez de esto.'}
              </p>
            )}
          </div>
          {multiBodega && (
            <div className="space-y-1.5">
              <Label htmlFor={`mv-bodega-${item.id}`}>Bodega</Label>
              <select
                id={`mv-bodega-${item.id}`}
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <option value="">
                  {kind === "salida" ? "Sin elegir — de donde haya" : "Bodega general"}
                </option>
                {bodegas.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {kind === "salida" && (
                <p className="text-xs text-muted-foreground">
                  Elegir una bodega ata la salida a esa: se rechaza si no le alcanza, aunque la
                  clínica tenga stock en otra. Sin elegir, sale de las bodegas que tengan saldo.
                </p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`mv-cant-${item.id}`}>
              {kind === "ajuste" ? "Stock contado" : "Cantidad"}
            </Label>
            <input
              id={`mv-cant-${item.id}`}
              type="number"
              min={0}
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={inputClass()}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`mv-motivo-${item.id}`}>Motivo (opcional)</Label>
            <input
              id={`mv-motivo-${item.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={inputClass()}
              placeholder="compra, uso en tratamiento, merma, conteo físico…"
            />
          </div>
          {kind === "entrada" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`mv-lote-${item.id}`}>Lote (opcional)</Label>
                <input
                  id={`mv-lote-${item.id}`}
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  className={inputClass()}
                  placeholder="Ej: L-2026-042"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`mv-venc-${item.id}`}>Vencimiento (opcional)</Label>
                <input
                  id={`mv-venc-${item.id}`}
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  className={inputClass()}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => registrar.mutate()}
            disabled={
              registrar.isPending ||
              !quantity.trim() ||
              Number.isNaN(Number(quantity)) ||
              (kind === "ajuste" ? Number(quantity) < 0 : Number(quantity) <= 0)
            }
          >
            {registrar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tanda 3 — reconciliación física: compara lo contado contra lo teórico y
 * el sistema mismo genera el entrada/salida que corrige la diferencia (ver
 * recordInventoryCount). A diferencia de "Movimiento → Ajuste", que fija el
 * total de la clínica entera al valor cargado, esto respeta el resto de las
 * bodegas cuando el conteo fue de una puntual. */
function ConteoFisicoDialog({
  clinicId,
  item,
  bodegas,
  ...control
}: {
  clinicId: string;
  item: InventoryItem;
  bodegas: Warehouse[];
} & DialogoControlado) {
  const [open, setOpen, controlado] = useAbierto(control);
  const [warehouseId, setWarehouseId] = useState("");
  const [countedQuantity, setCountedQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const multiBodega = bodegas.length > 1;

  const queryClient = useQueryClient();
  const countFn = useServerFn(recordInventoryCount);

  const registrar = useMutation({
    mutationFn: () =>
      countFn({
        data: {
          clinicId,
          itemId: item.id,
          warehouseId: multiBodega && warehouseId ? warehouseId : null,
          countedQuantity: Number(countedQuantity),
          notes: notes.trim() || undefined,
        },
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-movements", clinicId, item.id] });
      queryClient.invalidateQueries({ queryKey: ["inventory-stock", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-counts", clinicId, item.id] });
      toast.success(
        result.reconciled
          ? "Conteo guardado — el stock del sistema se ajustó a lo contado."
          : "Conteo guardado — coincide exacto con lo que el sistema tenía.",
      );
      setOpen(false);
      setCountedQuantity("");
      setNotes("");
      setWarehouseId("");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlado && (
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <ClipboardList className="size-3.5" /> Conteo físico
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conteo físico — {item.name}</DialogTitle>
          <DialogDescription>
            El sistema cree que hay {item.currentStock} {item.unit}
            {multiBodega ? " en total, sumando todas las bodegas" : ""}. Cuenta lo que hay realmente
            y el sistema ajusta la diferencia solo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {multiBodega && (
            <div className="space-y-1.5">
              <Label htmlFor={`cf-bodega-${item.id}`}>Bodega contada</Label>
              <select
                id={`cf-bodega-${item.id}`}
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <option value="">Toda la clínica</option>
                {bodegas.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`cf-cant-${item.id}`}>Cantidad contada ({item.unit})</Label>
            <input
              id={`cf-cant-${item.id}`}
              type="number"
              min={0}
              step="any"
              value={countedQuantity}
              onChange={(e) => setCountedQuantity(e.target.value)}
              className={inputClass()}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`cf-notas-${item.id}`}>Notas (opcional)</Label>
            <input
              id={`cf-notas-${item.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass()}
              placeholder="quién contó, en qué contexto…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => registrar.mutate()}
            disabled={
              registrar.isPending ||
              !countedQuantity.trim() ||
              Number.isNaN(Number(countedQuantity)) ||
              Number(countedQuantity) < 0
            }
          >
            {registrar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Guardar conteo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistorialMovimientosDialog({
  clinicId,
  item,
  ...control
}: { clinicId: string; item: InventoryItem } & DialogoControlado) {
  const [open, setOpen, controlado] = useAbierto(control);
  const fetchMovements = useServerFn(listInventoryMovements);
  const zona = useZonaClinica();

  const movementsQuery = useQuery({
    queryKey: ["inventory-movements", clinicId, item.id],
    queryFn: () => fetchMovements({ data: { clinicId, itemId: item.id } }),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlado && (
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <History className="size-3.5" /> Historial
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Historial — {item.name}</DialogTitle>
          <DialogDescription>Movimientos más recientes primero.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          {movementsQuery.isLoading && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando historial…
            </p>
          )}
          {movementsQuery.isError && (
            <p className="py-6 text-sm text-muted-foreground">No pudimos cargar el historial.</p>
          )}
          {movementsQuery.data && movementsQuery.data.items.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">Todavía no hay movimientos.</p>
          )}
          {movementsQuery.data && movementsQuery.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Lote / vence</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movementsQuery.data.items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fechaHora(m.recordedAt, zona)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.kind === "salida" ? "destructive" : "secondary"}>
                        {MOVEMENT_LABELS[m.kind]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {m.quantity} {item.unit}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {m.lotNumber || m.expirationDate ? (
                        <>
                          {m.lotNumber && <span>{m.lotNumber}</span>}
                          {m.lotNumber && m.expirationDate && " · "}
                          {m.expirationDate && <span>vence {fecha(m.expirationDate)}</span>}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.reason ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {movementsQuery.data?.truncated && (
            <p className="pt-3 text-xs text-muted-foreground">
              Hay más movimientos de los que se muestran aquí.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const Route = createFileRoute("/_authenticated/_clinic/inventario")({
  beforeLoad: requirePermission("inventory:view"),
  head: () => ({
    meta: [
      { title: "Inventario | Esmalia" },
      {
        name: "description",
        content: "Control de stock de insumos y materiales de la clínica.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InventarioPage,
});

/**
 * Acciones de una fila: la principal a la vista (registrar un movimiento) y
 * el resto en un menú. Antes eran cuatro botones por fila que se partían en
 * dos renglones en cuanto la tabla se angostaba.
 */
function AccionesDeItem({
  clinicId,
  item,
  bodegas,
  currency,
  sucursales,
  puedeRegistrarMovimiento,
  puedeGestionar,
}: {
  clinicId: string;
  item: InventoryItem;
  bodegas: Warehouse[];
  currency: string;
  sucursales: Sucursal[];
  puedeRegistrarMovimiento: boolean;
  puedeGestionar: boolean;
}) {
  const [abierto, setAbierto] = useState<"historial" | "conteo" | "editar" | null>(null);
  const cerrarSi = (cual: typeof abierto) => (open: boolean) => {
    if (!open && abierto === cual) setAbierto(null);
  };

  return (
    <div className="flex items-center justify-end gap-2">
      {puedeRegistrarMovimiento ? (
        <RegistrarMovimientoDialog clinicId={clinicId} item={item} bodegas={bodegas} />
      ) : (
        <HistorialMovimientosDialog clinicId={clinicId} item={item} />
      )}
      {(puedeRegistrarMovimiento || puedeGestionar) && (
        // modal={false}: el menú se cierra antes de abrir el diálogo y no
        // deja el `pointer-events: none` del body pegado.
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" aria-label={`Más acciones: ${item.name}`}>
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {puedeRegistrarMovimiento && (
              <DropdownMenuItem onSelect={() => setAbierto("historial")}>
                <History className="size-4" aria-hidden /> Historial
              </DropdownMenuItem>
            )}
            {puedeRegistrarMovimiento && (
              <DropdownMenuItem onSelect={() => setAbierto("conteo")}>
                <ClipboardList className="size-4" aria-hidden /> Conteo físico
              </DropdownMenuItem>
            )}
            {puedeGestionar && (
              <DropdownMenuItem onSelect={() => setAbierto("editar")}>
                <Pencil className="size-4" aria-hidden /> Editar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {puedeRegistrarMovimiento && (
        <>
          <HistorialMovimientosDialog
            clinicId={clinicId}
            item={item}
            open={abierto === "historial"}
            onOpenChange={cerrarSi("historial")}
          />
          <ConteoFisicoDialog
            clinicId={clinicId}
            item={item}
            bodegas={bodegas}
            open={abierto === "conteo"}
            onOpenChange={cerrarSi("conteo")}
          />
        </>
      )}
      {puedeGestionar && (
        <EditarItemDialog
          clinicId={clinicId}
          item={item}
          currency={currency}
          sucursales={sucursales}
          open={abierto === "editar"}
          onOpenChange={cerrarSi("editar")}
        />
      )}
    </div>
  );
}

function InventarioPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic!.id;
  const currency = access.clinic!.currency;
  const puedeGestionar = hasPermission(access.role, "inventory:manage");
  const puedeRegistrarMovimiento = access.role != null && MOVEMENT_ROLES.has(access.role);

  const fetchSubscription = useServerFn(getMySubscription);
  const { data: sub } = useQuery({
    queryKey: ["my-subscription", clinicId],
    queryFn: () => fetchSubscription({ data: { clinicId } }),
    staleTime: 60 * 1000,
  });
  const bloqueado = informesBloqueados(sub ?? null);

  // product-2 (auditoría 360): filtro por sucursal. Solo tiene sentido
  // cuando la clínica tiene más de una sucursal ACTIVA — con 0-1 sucursales
  // (el caso común hoy) no se muestra ni el selector ni la columna, para no
  // agregar fricción a la UI de la mayoría de las clínicas.
  const fetchBranches = useServerFn(listBranches);
  const branchesQuery = useQuery({
    queryKey: ["branches", clinicId],
    queryFn: () => fetchBranches({ data: { clinicId } }),
    enabled: !bloqueado,
  });
  const sucursales = branchesQuery.data ?? [];
  const multiSucursal = sucursales.length > 1;
  const [branchFilter, setBranchFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const branchNameById = new Map(sucursales.map((s) => [s.id, s.nombre]));

  // Bodegas (Tanda C). Mismo criterio que el filtro de sucursal de arriba:
  // con una sola bodega —el caso de toda clínica que no la configuró— el
  // selector no aparece y la pantalla se ve exactamente igual que antes.
  const fetchWarehouses = useServerFn(listWarehouses);
  const warehousesQuery = useQuery({
    queryKey: ["warehouses", clinicId],
    queryFn: () => fetchWarehouses({ data: { clinicId } }),
    enabled: !bloqueado,
  });
  const bodegas = warehousesQuery.data ?? [];
  const multiBodega = bodegas.length > 1;
  const [warehouseFilter, setWarehouseFilter] = useState("");

  const fetchStock = useServerFn(listStockByWarehouse);
  const stockQuery = useQuery({
    queryKey: ["inventory-stock", clinicId, warehouseFilter],
    enabled: multiBodega && Boolean(warehouseFilter) && !bloqueado,
    queryFn: () => fetchStock({ data: { clinicId, warehouseId: warehouseFilter || null } }),
  });
  /** Saldo de la bodega elegida; vacío = se muestra el total del ítem. */
  const stockPorBodega = stockQuery.data ?? {};

  const fetchItems = useServerFn(listInventoryItems);
  const itemsQuery = useQuery({
    queryKey: ["inventory-items", clinicId, multiSucursal ? branchFilter : ""],
    enabled: !bloqueado,
    queryFn: () =>
      fetchItems({
        data: {
          clinicId,
          branchId: multiSucursal && branchFilter ? branchFilter : undefined,
          paraInforme: true,
        },
      }),
  });

  const fetchExpiring = useServerFn(listExpiringLots);
  const expiringQuery = useQuery({
    queryKey: ["inventory-expiring", clinicId],
    queryFn: () => fetchExpiring({ data: { clinicId, withinDays: 60 } }),
    enabled: !bloqueado,
  });

  const items = itemsQuery.data?.items ?? [];
  const activeItemsAll = items.filter((i) => i.isActive);
  const activeItems = nameFilter.trim()
    ? activeItemsAll.filter((i) => i.name.toLowerCase().includes(nameFilter.trim().toLowerCase()))
    : activeItemsAll;
  const inactiveItems = items.filter((i) => !i.isActive);
  const lowStockCount = activeItemsAll.filter((i) => i.belowMinStock).length;
  const expiringLots = expiringQuery.data ?? [];
  const hoyISO = new Date().toISOString().slice(0, 10);

  return (
    <AppShell title="Inventario" access={access}>
      {bloqueado ? (
        <TrialDesbloqueo pantalla="Inventario" sub={sub ?? null} />
      ) : (
        <div className="space-y-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">
                Insumos y materiales de {access.clinic!.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {itemsQuery.isLoading
                  ? "Revisando el stock…"
                  : lowStockCount > 0
                    ? `${lowStockCount} ítem${lowStockCount === 1 ? "" : "s"} bajo el stock mínimo.`
                    : "Todo el stock está sobre el mínimo configurado."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="Buscar insumo…"
                aria-label="Buscar insumo por nombre"
                className="w-40 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              {multiSucursal && (
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  aria-label="Filtrar por sucursal"
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <option value="">Todas las sucursales</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              )}
              {multiBodega && (
                <select
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                  aria-label="Ver el stock de una bodega"
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <option value="">Stock total</option>
                  {bodegas.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
              <ExportarCsvLista<InventoryItem>
                clinicId={clinicId}
                rol={access.role}
                lista="inventario"
                filas={activeItems}
                timezone={access.clinic!.timezone}
                filtros={{
                  nombre: nameFilter.trim(),
                  sucursal: branchFilter,
                  bodega: warehouseFilter,
                }}
                columnas={[
                  { header: "Insumo", value: (i) => i.name },
                  { header: "Unidad", value: (i) => i.unit },
                  {
                    header: warehouseFilter ? "Stock en la bodega" : "Stock",
                    value: (i) => (warehouseFilter ? (stockPorBodega[i.id] ?? 0) : i.currentStock),
                  },
                  { header: "Stock mínimo", value: (i) => i.minStock },
                  { header: "Bajo el mínimo", value: (i) => siNoPlanilla(i.belowMinStock) },
                  {
                    header: "Sucursal",
                    value: (i) => (i.branchId ? (branchNameById.get(i.branchId) ?? null) : null),
                  },
                  {
                    header: "Costo unitario",
                    value: (i) => montoPlanilla(i.costCents, currency),
                    dinero: true,
                  },
                  { header: "Moneda", value: () => currency, dinero: true },
                  { header: "Notas", value: (i) => i.notes },
                ]}
              />
              {puedeGestionar && (
                <CrearItemDialog clinicId={clinicId} currency={currency} sucursales={sucursales} />
              )}
            </div>
          </div>

          {expiringLots.length > 0 && (
            <section className="rounded-2xl border border-warning/30 bg-warning/5 p-5">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-warning">
                <AlertTriangle className="size-4" /> Lotes próximos a vencer (60 días)
              </h3>
              <ul className="mt-3 space-y-1.5 text-sm">
                {expiringLots.map((lot) => {
                  const vencido = lot.expirationDate < hoyISO;
                  return (
                    <li
                      key={lot.movementId}
                      className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/60 pt-1.5 first:border-t-0 first:pt-0"
                    >
                      <span>
                        <span className="font-medium">{lot.itemName}</span>
                        {lot.lotNumber && (
                          <span className="text-muted-foreground"> · lote {lot.lotNumber}</span>
                        )}
                        <span className="text-muted-foreground">
                          {" "}
                          · {lot.quantity} {lot.unit}
                        </span>
                      </span>
                      <Badge variant={vencido ? "destructive" : "secondary"}>
                        {vencido ? "Vencido" : "Vence"} {fecha(lot.expirationDate)}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="card-clinical divide-y divide-hairline">
            {itemsQuery.isLoading && (
              <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Cargando inventario…
              </p>
            )}
            {itemsQuery.isError && (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No pudimos cargar el inventario.
              </p>
            )}
            {itemsQuery.data && activeItems.length === 0 && (
              <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
                <Package className="size-4" />
                {nameFilter.trim() && activeItemsAll.length > 0
                  ? `Ningún insumo coincide con "${nameFilter.trim()}".`
                  : "Todavía no hay ítems de inventario cargados."}
              </p>
            )}
            {activeItems.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ítem</TableHead>
                    <TableHead>Stock actual</TableHead>
                    <TableHead>Mínimo</TableHead>
                    <TableHead>Costo unitario</TableHead>
                    {multiSucursal && <TableHead>Sucursal</TableHead>}
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.name}
                        {item.notes && (
                          <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                            {item.notes}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>
                            {warehouseFilter ? (stockPorBodega[item.id] ?? 0) : item.currentStock}{" "}
                            {item.unit}
                          </span>
                          {item.belowMinStock && (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="size-3" /> Bajo mínimo
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.minStock == null
                          ? "Sin alerta configurada"
                          : `${item.minStock} ${item.unit}`}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.costCents == null
                          ? "Sin costo cargado"
                          : formatMoney(item.costCents, currency)}
                      </TableCell>
                      {multiSucursal && (
                        <TableCell className="text-muted-foreground">
                          {item.branchId == null
                            ? "Sin asignar"
                            : (branchNameById.get(item.branchId) ?? "Sin asignar")}
                        </TableCell>
                      )}
                      <TableCell>
                        <AccionesDeItem
                          clinicId={clinicId}
                          item={item}
                          bodegas={bodegas}
                          currency={currency}
                          sucursales={sucursales}
                          puedeRegistrarMovimiento={puedeRegistrarMovimiento}
                          puedeGestionar={puedeGestionar}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          {puedeGestionar && inactiveItems.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-display text-sm font-semibold text-muted-foreground">
                Ítems dados de baja
              </h3>
              <div className="card-clinical divide-y divide-hairline">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ítem</TableHead>
                      <TableHead>Último stock</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inactiveItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-muted-foreground">{item.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.currentStock} {item.unit}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap justify-end gap-2">
                            <HistorialMovimientosDialog clinicId={clinicId} item={item} />
                            <EditarItemDialog
                              clinicId={clinicId}
                              item={item}
                              currency={currency}
                              sucursales={sucursales}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}
