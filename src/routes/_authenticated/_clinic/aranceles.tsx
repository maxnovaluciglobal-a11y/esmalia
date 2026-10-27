import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BookOpen,
  Boxes,
  Download,
  History,
  Layers,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  TrendingUp,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
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
import { SearchField, FilterBar, SelectField } from "@/components/filters";
import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { CatalogoDialog } from "@/components/arancel/catalogo-dialog";
import { EspecialidadesDialog } from "@/components/arancel/especialidades-dialog";
import { HistorialPreciosDialog } from "@/components/arancel/historial-precios-dialog";
import { RealinearDialog } from "@/components/arancel/realinear-dialog";
import { asegurarEspecialidades, listEspecialidades } from "@/lib/arancel/arancel.functions";
import { posicionEnRango } from "@/lib/arancel/catalogo-chile";
import {
  agruparPorEspecialidad,
  SIN_ESPECIALIDAD,
  type Especialidad,
} from "@/lib/arancel/especialidades";
import { MoneyInput } from "@/components/money-input";
import { requirePermission } from "@/lib/access/route-guards";
import { formatMoney, fromCents, toCents, type Procedure } from "@/lib/finance/finance";
import { parseArancelCsv, type ArancelCsvResult } from "@/lib/arancel-csv";
import {
  createProcedure,
  importProcedures,
  listProcedures,
  setProcedureActive,
  updateProcedure,
} from "@/lib/finance/finance.functions";
import {
  listInventoryItems,
  type InventoryItem,
} from "@/lib/clinic-operations/inventory.functions";
import {
  listProcedureSupplies,
  setProcedureSupplies,
} from "@/lib/clinic-operations/procedure-supplies.functions";
import { listRecipeRecalibrationSuggestions } from "@/lib/clinic-operations/recipe-recalibration.functions";
import {
  listFrequentProcedures,
  setProcedureFavorite,
} from "@/lib/clinic-operations/cita-formulario.functions";
import { coincide, str } from "@/lib/search";
import { useExportarCsvLista } from "@/components/exportar-csv-lista";
import { montoPlanilla, siNoPlanilla } from "@/lib/exportacion/listas-csv";
import { hoyISO } from "@/lib/clinic-operations/clinic-data";
import { cn } from "@/lib/utils";
import { mensajeDeError } from "@/lib/mensaje-error";

interface ArancelesSearch {
  q: string;
  categoria: string;
  /** id de la especialidad, o "sin" para las prestaciones sin especialidad. */
  especialidad: string;
}

export const Route = createFileRoute("/_authenticated/_clinic/aranceles")({
  validateSearch: (search: Record<string, unknown>): ArancelesSearch => ({
    q: str(search.q),
    categoria: str(search.categoria),
    especialidad: str(search.especialidad),
  }),
  beforeLoad: requirePermission("settings:manage"),
  head: () => ({
    meta: [
      { title: "Arancel de precios | Esmalia" },
      {
        name: "description",
        content:
          "Lista de prestaciones de la clínica por especialidad, con precio, valor referencial, costo de laboratorio, catálogo chileno, realineación de precios e importación desde CSV.",
      },
    ],
  }),
  component: ArancelesPage,
});

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

interface Draft {
  name: string;
  code: string;
  category: string;
  /** Los tres montos en cents. `MoneyInput` muestra la unidad visible. */
  price: number | null;
  referencePrice: number | null;
  labCost: number | null;
  durationMin: number | null;
  allowsDiscount: boolean;
  specialtyId: string;
  fonasaCode: string;
  isMai: boolean;
  /** Rango de referencia en cents; vacío = sin dato (regla 11). */
  suggestedMin: number | null;
  suggestedMax: number | null;
}

const draftVacio = (): Draft => ({
  name: "",
  code: "",
  category: "",
  price: null,
  referencePrice: null,
  labCost: null,
  durationMin: null,
  allowsDiscount: true,
  specialtyId: "",
  fonasaCode: "",
  isMai: false,
  suggestedMin: null,
  suggestedMax: null,
});

/** Campo de dinero que distingue vacío ("sin dato") de cero — regla 11. */
function MontoOpcional({
  id,
  label,
  currency,
  value,
  onChange,
  placeholder = "Sin dato",
}: {
  id: string;
  label: string;
  currency: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <MoneyInput
        id={id}
        currency={currency}
        min={0}
        valueCents={value}
        placeholder={placeholder}
        onValueChange={onChange}
      />
    </div>
  );
}

/** Campo numérico que distingue vacío (null) de cero — regla 11. */
function NumeroOpcional({
  id,
  label,
  value,
  onChange,
  placeholder = "Sin dato",
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="number"
        min={0}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={INPUT}
      />
    </div>
  );
}

function PrestacionDialog({
  clinicId,
  currency,
  procedure,
  categorias,
  especialidades,
  especialidadInicial,
}: {
  clinicId: string;
  currency: string;
  /** Sin `procedure` el diálogo crea; con él, edita. */
  procedure?: Procedure;
  categorias: string[];
  especialidades: Especialidad[];
  /** Al crear con un filtro de especialidad puesto, la propone. */
  especialidadInicial?: string;
}) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(() =>
    procedure
      ? {
          name: procedure.name,
          code: procedure.code ?? "",
          category: procedure.category ?? "",
          price: procedure.defaultPriceCents,
          referencePrice: procedure.referencePriceCents,
          labCost: procedure.labCostCents,
          durationMin: procedure.durationMin,
          allowsDiscount: procedure.allowsDiscount,
          specialtyId: procedure.specialtyId ?? "",
          fonasaCode: procedure.fonasaCode ?? "",
          isMai: procedure.isMai ?? false,
          suggestedMin: procedure.suggestedMinCents ?? null,
          suggestedMax: procedure.suggestedMaxCents ?? null,
        }
      : { ...draftVacio(), specialtyId: especialidadInicial ?? "" },
  );
  const queryClient = useQueryClient();
  const createFn = useServerFn(createProcedure);
  const updateFn = useServerFn(updateProcedure);

  const patch = (cambios: Partial<Draft>) => setD((prev) => ({ ...prev, ...cambios }));
  const motivoGuardar = !d.name.trim()
    ? "Escribe el nombre de la prestación."
    : d.suggestedMin !== null && d.suggestedMax !== null && d.suggestedMin > d.suggestedMax
      ? "El mínimo del rango no puede ser mayor que el máximo."
      : null;

  const guardar = useMutation({
    mutationFn: () => {
      const payload = {
        clinicId,
        name: d.name.trim(),
        code: d.code.trim() || null,
        category: d.category.trim() || null,
        defaultPriceCents: d.price ?? 0,
        durationMin: d.durationMin,
        allowsDiscount: d.allowsDiscount,
        referencePriceCents: d.referencePrice,
        labCostCents: d.labCost,
        position: procedure?.position ?? 0,
        specialtyId: d.specialtyId || null,
        fonasaCode: d.fonasaCode.trim() || null,
        isMai: d.isMai,
        suggestedMinCents: d.suggestedMin,
        suggestedMaxCents: d.suggestedMax,
      };
      // create devuelve {id} y update {ok}; acá solo importa que terminó bien.
      return procedure
        ? updateFn({ data: { ...payload, procedureId: procedure.id } }).then(() => undefined)
        : createFn({ data: payload }).then(() => undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procedures", clinicId] });
      toast.success(procedure ? "Prestación actualizada" : "Prestación creada");
      setOpen(false);
      if (!procedure) setD({ ...draftVacio(), specialtyId: especialidadInicial ?? "" });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {procedure ? (
          <Button variant="ghost" size="sm">
            <Pencil className="size-3.5" /> Editar
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="size-4" /> Nueva prestación
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{procedure ? "Editar prestación" : "Nueva prestación"}</DialogTitle>
          <DialogDescription>
            El precio final es lo que se le cobra al paciente. El valor referencial es lo que
            declaras ante un convenio, si corresponde.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">Nombre</Label>
            <input
              id="p-name"
              value={d.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Ej: Destartraje supragingival"
              className={INPUT}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-esp">Especialidad</Label>
            <select
              id="p-esp"
              value={d.specialtyId}
              onChange={(e) => patch({ specialtyId: e.target.value })}
              className={INPUT}
            >
              <option value="">{SIN_ESPECIALIDAD}</option>
              {especialidades
                .filter((e) => e.isActive || e.id === d.specialtyId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-code">Código</Label>
              <input
                id="p-code"
                value={d.code}
                onChange={(e) => patch({ code: e.target.value })}
                placeholder="Opcional"
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-cat">Categoría</Label>
              <input
                id="p-cat"
                list="categorias-arancel"
                value={d.category}
                onChange={(e) => patch({ category: e.target.value })}
                placeholder="Ej: Odontopediatría"
                className={INPUT}
              />
              <datalist id="categorias-arancel">
                {categorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-price">Precio final</Label>
              <MoneyInput
                id="p-price"
                currency={currency}
                min={0}
                valueCents={d.price}
                onValueChange={(price) => patch({ price })}
              />
            </div>
            <MontoOpcional
              id="p-ref"
              label="Valor referencial"
              currency={currency}
              value={d.referencePrice}
              onChange={(referencePrice) => patch({ referencePrice })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <MontoOpcional
              id="p-lab"
              label="Costo de laboratorio"
              currency={currency}
              value={d.labCost}
              onChange={(labCost) => patch({ labCost })}
            />
            <NumeroOpcional
              id="p-dur"
              label="Duración (min)"
              value={d.durationMin}
              onChange={(durationMin) => patch({ durationMin })}
            />
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">
            La duración se propone sola al agendar una cita con esta prestación.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-fonasa">Código Fonasa</Label>
              <input
                id="p-fonasa"
                value={d.fonasaCode}
                onChange={(e) => patch({ fonasaCode: e.target.value })}
                placeholder="Opcional"
                maxLength={20}
                className={INPUT}
              />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={d.isMai}
                onChange={(e) => patch({ isMai: e.target.checked })}
                className="size-4 rounded border-hairline"
              />
              Tiene equivalente MAI (Fonasa institucional)
            </label>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Rango de referencia</legend>
            <p className="text-xs text-muted-foreground">
              Solo para orientarte: se muestra junto al precio y nunca se impone.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <MontoOpcional
                id="p-rmin"
                label="Mínimo"
                currency={currency}
                value={d.suggestedMin}
                onChange={(suggestedMin) => patch({ suggestedMin })}
              />
              <MontoOpcional
                id="p-rmax"
                label="Máximo"
                currency={currency}
                value={d.suggestedMax}
                onChange={(suggestedMax) => patch({ suggestedMax })}
              />
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={d.allowsDiscount}
              onChange={(e) => patch({ allowsDiscount: e.target.checked })}
              className="size-4 rounded border-hairline"
            />
            Permite descuento en el presupuesto
          </label>
        </div>

        <DialogFooter>
          <AccionDeshabilitada motivo={motivoGuardar}>
            <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
              {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
              {procedure ? "Guardar cambios" : "Crear prestación"}
            </Button>
          </AccionDeshabilitada>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Línea de receta en edición dentro del diálogo — no persiste hasta "Guardar receta". */
interface LineaReceta {
  itemId: string;
  quantity: number;
}

/**
 * Receta de insumos por procedimiento (Tanda 1). Reemplaza la receta
 * completa al guardar — son pocas líneas de configuración, no vale la pena
 * un diff incremental línea por línea.
 */
function RecetaDialog({
  clinicId,
  procedure,
  items,
}: {
  clinicId: string;
  procedure: Procedure;
  items: InventoryItem[];
}) {
  const [open, setOpen] = useState(false);
  const [lineas, setLineas] = useState<LineaReceta[]>([]);
  const [nuevoItemId, setNuevoItemId] = useState("");
  const [nuevaCantidad, setNuevaCantidad] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const fetchSupplies = useServerFn(listProcedureSupplies);
  const saveFn = useServerFn(setProcedureSupplies);

  // `retry: false`: un error acá es de configuración (tabla/columna
  // faltante, permisos), no algo transitorio — reintentar con backoff solo
  // demora mostrar el aviso real. `isPending` en vez de `isLoading`: en
  // React Query v5, `isLoading` puede volver a false durante la pausa ENTRE
  // reintentos (antes de que la query resuelva de verdad), dejando un hueco
  // donde no se ve ni el spinner ni el error — `isPending` se mantiene true
  // hasta que la query realmente termina.
  const { data, isPending, error } = useQuery({
    queryKey: ["procedure-supplies", clinicId, procedure.id],
    enabled: open,
    retry: false,
    queryFn: () => fetchSupplies({ data: { clinicId, procedureId: procedure.id } }),
  });

  // Solo re-sembramos el borrador cuando llega una carga nueva del server —
  // si dependiéramos de `data` en el array de deps, cada tecleo del usuario
  // (que no toca `data`) igual sería estable, pero re-declarar `lineas` acá
  // dejaría el efecto corriendo en cada apertura del diálogo sin necesidad.
  useEffect(() => {
    if (data) setLineas(data.supplies.map((s) => ({ itemId: s.itemId, quantity: s.quantity })));
  }, [data]);

  // Tanda 4 — recalibración sugerida: solo se calcula con la receta ya
  // cargada (open), nunca aplica nada sola — "Aplicar" solo prellena la
  // cantidad en el borrador de acá abajo, todavía hace falta "Guardar
  // receta" para que quede en firme.
  const fetchSuggestions = useServerFn(listRecipeRecalibrationSuggestions);
  const { data: suggestionsData } = useQuery({
    queryKey: ["recipe-recalibration-suggestions", clinicId, procedure.id],
    enabled: open,
    queryFn: () => fetchSuggestions({ data: { clinicId, procedureId: procedure.id } }),
  });
  const [descartadas, setDescartadas] = useState<Set<string>>(new Set());
  const sugerencias = (suggestionsData?.suggestions ?? []).filter(
    (s) => !descartadas.has(s.itemId),
  );

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const guardar = useMutation({
    mutationFn: () => saveFn({ data: { clinicId, procedureId: procedure.id, supplies: lineas } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procedure-supplies", clinicId, procedure.id] });
      toast.success("Receta de insumos guardada");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const agregarLinea = () => {
    if (!nuevoItemId || nuevaCantidad === null || nuevaCantidad <= 0) return;
    if (lineas.some((l) => l.itemId === nuevoItemId)) {
      toast.error("Ese insumo ya está en la receta.");
      return;
    }
    setLineas((prev) => [...prev, { itemId: nuevoItemId, quantity: nuevaCantidad }]);
    setNuevoItemId("");
    setNuevaCantidad(null);
  };

  // "shared" (desinfectante de sillón, etc.) no correlaciona 1:1 con un
  // procedimiento — no se ofrece como opción de receta.
  const itemsDisponibles = items.filter(
    (i) => i.consumptionType !== "shared" && !lineas.some((l) => l.itemId === i.id),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Boxes className="size-3.5" /> Receta
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Receta de insumos — {procedure.name}</DialogTitle>
          <DialogDescription>
            Insumos que se descuentan automáticamente del inventario al marcar este tratamiento como
            realizado. Sin líneas aquí, no se descuenta nada.
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <p className="text-sm text-muted-foreground">Cargando receta…</p>
        ) : error ? (
          // Mismo criterio que loadError en FinanceSection: un error del
          // server no puede leerse como "sin insumos" — acá se editaría la
          // receta a ciegas, sobre datos que en realidad no se pudieron traer.
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
            No pudimos cargar la receta: {(error as Error).message}
          </div>
        ) : (
          <div className="space-y-3">
            {sugerencias.length > 0 && (
              <div className="space-y-2">
                {sugerencias.map((s) => (
                  <div
                    key={s.itemId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs"
                  >
                    <span>
                      <strong>{s.itemName}</strong>: la receta dice {s.currentQuantity} {s.unit},
                      pero los últimos 3 conteos físicos sugieren {s.suggestedQuantity.toFixed(2)}{" "}
                      {s.unit}.
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setLineas((prev) =>
                            prev.map((l) =>
                              l.itemId === s.itemId ? { ...l, quantity: s.suggestedQuantity } : l,
                            ),
                          );
                          setDescartadas((prev) => new Set(prev).add(s.itemId));
                        }}
                      >
                        Aplicar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDescartadas((prev) => new Set(prev).add(s.itemId))}
                      >
                        Descartar
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {lineas.length === 0 && (
              <p className="text-sm text-muted-foreground">Todavía no tiene insumos asociados.</p>
            )}
            {lineas.length > 0 && (
              <ul className="space-y-1.5">
                {lineas.map((l) => {
                  const item = itemById.get(l.itemId);
                  return (
                    <li
                      key={l.itemId}
                      className="flex items-center justify-between gap-2 rounded-lg border border-hairline px-3 py-1.5 text-sm"
                    >
                      <span>{item?.name ?? "Insumo eliminado"}</span>
                      <span className="flex items-center gap-2">
                        <span className=" tabular-nums text-muted-foreground">
                          {l.quantity} {item?.unit}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setLineas((prev) => prev.filter((x) => x.itemId !== l.itemId))
                          }
                        >
                          Quitar
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex items-end gap-2 border-t border-hairline pt-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="receta-item">Insumo</Label>
                <select
                  id="receta-item"
                  value={nuevoItemId}
                  onChange={(e) => setNuevoItemId(e.target.value)}
                  className={INPUT}
                  disabled={itemsDisponibles.length === 0}
                >
                  <option value="">
                    {itemsDisponibles.length === 0 ? "Sin insumos disponibles" : "Elegir…"}
                  </option>
                  {itemsDisponibles.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.unit})
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-28 space-y-1.5">
                <Label htmlFor="receta-cant">Cantidad</Label>
                <input
                  id="receta-cant"
                  type="number"
                  min={0}
                  step="any"
                  value={nuevaCantidad ?? ""}
                  onChange={(e) =>
                    setNuevaCantidad(e.target.value === "" ? null : Number(e.target.value))
                  }
                  className={INPUT}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={agregarLinea}
                disabled={!nuevoItemId || nuevaCantidad === null || nuevaCantidad <= 0}
              >
                Agregar
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={() => guardar.mutate()}
            disabled={isPending || Boolean(error) || guardar.isPending}
          >
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Guardar receta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportarCsvDialog({ clinicId, currency }: { clinicId: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ArancelCsvResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const importFn = useServerFn(importProcedures);

  const importar = useMutation({
    mutationFn: () =>
      importFn({
        data: {
          clinicId,
          filas: (preview?.filas ?? []).map((f) => ({
            name: f.name,
            code: f.code || null,
            category: f.category || null,
            // El parser devuelve unidades visibles; la conversión a cents es
            // acá, con la moneda de la clínica, igual que en el diálogo.
            defaultPriceCents: toCents(f.price, currency),
            durationMin: f.durationMin,
            allowsDiscount: f.allowsDiscount,
            referencePriceCents:
              f.referencePrice == null ? null : toCents(f.referencePrice, currency),
            labCostCents: f.labCost == null ? null : toCents(f.labCost, currency),
            position: 0,
          })),
        },
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["procedures", clinicId] });
      toast.success(`${res.creadas} prestaciones nuevas, ${res.actualizadas} actualizadas`);
      setOpen(false);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPreview(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="size-4" /> Importar CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar arancel desde CSV</DialogTitle>
          <DialogDescription>
            El archivo necesita una columna <strong>Nombre</strong>. Si además trae Código,
            Categoría, Precio, Valor referencial, Costo laboratorio o Duración, se usan. Una
            prestación que ya exista (por código, o por nombre si no hay código) se actualiza en
            lugar de duplicarse.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="Archivo CSV del arancel"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return setPreview(null);
              setPreview(parseArancelCsv(await file.text()));
            }}
            className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
          />

          {preview && (
            <div className="space-y-2 rounded-lg border border-hairline p-3 text-xs">
              <p className="font-medium">
                {preview.filas.length} prestaciones listas para importar
              </p>
              {preview.errores.length > 0 && (
                <ul className="space-y-0.5 text-warning">
                  {preview.errores.slice(0, 5).map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                  {preview.errores.length > 5 && <li>y {preview.errores.length - 5} más…</li>}
                </ul>
              )}
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-muted-foreground">
                {preview.filas.slice(0, 8).map((f, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="truncate">
                      {f.category ? `${f.category} · ` : ""}
                      {f.name}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatMoney(toCents(f.price, currency), currency)}
                    </span>
                  </li>
                ))}
                {preview.filas.length > 8 && <li>y {preview.filas.length - 8} más…</li>}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={() => importar.mutate()}
            disabled={!preview?.filas.length || importar.isPending}
          >
            {importar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Importar {preview?.filas.length ? `${preview.filas.length} prestaciones` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArancelesPage() {
  const { access } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const clinicId = access.clinic?.id;
  const currency = access.clinic?.currency ?? "CLP";
  const zona = access.clinic?.timezone;
  const queryClient = useQueryClient();
  const [herramienta, setHerramienta] = useState<
    "catalogo" | "realinear" | "especialidades" | "historial" | null
  >(null);

  const fetchProcedures = useServerFn(listProcedures);
  const setActiveFn = useServerFn(setProcedureActive);
  const fetchInventoryItems = useServerFn(listInventoryItems);
  const fetchEspecialidades = useServerFn(listEspecialidades);
  const asegurarFn = useServerFn(asegurarEspecialidades);

  const {
    data: procedures = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["procedures", clinicId, "todas"],
    enabled: Boolean(clinicId),
    queryFn: () => fetchProcedures({ data: { clinicId: clinicId!, incluirInactivas: true } }),
  });

  // ADM-02: la primera vez (o después del reset de la demo) siembra las
  // especialidades estándar; es idempotente y no pisa nombres de la clínica.
  // Si falla, el arancel se ve igual, agrupado como "Sin especialidad".
  const { data: especialidades = [] } = useQuery({
    queryKey: ["especialidades", clinicId],
    enabled: Boolean(clinicId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sembradas = await asegurarFn({ data: { clinicId: clinicId! } })
        .then((r) => r.sembradas)
        .catch(() => 0);
      if (sembradas > 0) void queryClient.invalidateQueries({ queryKey: ["procedures", clinicId] });
      return fetchEspecialidades({ data: { clinicId: clinicId! } });
    },
  });

  // Cargado una vez a nivel página, no por diálogo — todas las filas de
  // "Receta" comparten el mismo catálogo de insumos de la clínica.
  const { data: inventoryData } = useQuery({
    queryKey: ["inventory-items", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchInventoryItems({ data: { clinicId: clinicId!, branchId: null } }),
  });
  const inventoryItems = inventoryData?.items ?? [];

  const setActive = useMutation({
    mutationFn: (v: { procedureId: string; isActive: boolean }) =>
      setActiveFn({ data: { clinicId: clinicId!, ...v } }),
    onSuccess: (_r, v) => {
      queryClient.invalidateQueries({ queryKey: ["procedures", clinicId] });
      toast.success(v.isActive ? "Prestación reactivada" : "Prestación dada de baja");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  // Favoritos (AGE-12): con estrella aparecen primero en los botones de
  // procedimientos frecuentes del formulario de cita.
  const fetchFrecuentes = useServerFn(listFrequentProcedures);
  const setFavoritoFn = useServerFn(setProcedureFavorite);
  const { data: usoProcedimientos } = useQuery({
    queryKey: ["procedimientos-frecuentes", clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => fetchFrecuentes({ data: { clinicId: clinicId! } }),
  });
  const favoritos = useMemo(() => new Set(usoProcedimientos?.favoritos ?? []), [usoProcedimientos]);
  const setFavorito = useMutation({
    mutationFn: (v: { procedureId: string; favorito: boolean }) =>
      setFavoritoFn({ data: { clinicId: clinicId!, ...v } }),
    onSuccess: (_r, v) => {
      queryClient.invalidateQueries({ queryKey: ["procedimientos-frecuentes", clinicId] });
      toast.success(
        v.favorito ? "Marcada como favorita: aparece primero al agendar." : "Ya no es favorita.",
      );
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const categorias = useMemo(
    () =>
      [...new Set(procedures.map((p) => p.category).filter((c): c is string => Boolean(c)))].sort(),
    [procedures],
  );
  const especialidadPorId = useMemo(
    () => new Map(especialidades.map((e) => [e.id, e])),
    [especialidades],
  );
  const conteoPorEspecialidad = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of procedures)
      if (p.specialtyId) m.set(p.specialtyId, (m.get(p.specialtyId) ?? 0) + 1);
    return m;
  }, [procedures]);

  const filtradas = useMemo(
    () =>
      procedures.filter((p) => {
        if (search.categoria && (p.category ?? "") !== search.categoria) return false;
        if (search.especialidad) {
          const tiene = Boolean(p.specialtyId && especialidadPorId.has(p.specialtyId));
          if (search.especialidad === "sin" ? tiene : p.specialtyId !== search.especialidad)
            return false;
        }
        if (search.q && !coincide(search.q, p.name, p.code, p.category, p.fonasaCode)) return false;
        return true;
      }),
    [procedures, search.q, search.categoria, search.especialidad, especialidadPorId],
  );

  const exportarArancel = useExportarCsvLista<Procedure>({
    clinicId: clinicId!,
    rol: access.role,
    lista: "arancel",
    filas: filtradas,
    timezone: zona ?? "America/Santiago",
    filtros: { q: search.q, categoria: search.categoria, especialidad: search.especialidad },
    columnas: [
      { header: "Código", value: (p) => p.code },
      { header: "Nombre", value: (p) => p.name },
      {
        header: "Especialidad",
        value: (p) => (p.specialtyId && especialidadPorId.get(p.specialtyId)?.name) || null,
      },
      { header: "Categoría", value: (p) => p.category },
      {
        header: "Precio",
        value: (p) => montoPlanilla(p.defaultPriceCents, currency),
        dinero: true,
      },
      {
        header: "Valor referencial",
        value: (p) => montoPlanilla(p.referencePriceCents, currency),
        dinero: true,
      },
      {
        header: "Costo laboratorio",
        value: (p) => montoPlanilla(p.labCostCents, currency),
        dinero: true,
      },
      { header: "Moneda", value: () => currency, dinero: true },
      { header: "Duración", value: (p) => p.durationMin },
      { header: "Permite descuento", value: (p) => siNoPlanilla(p.allowsDiscount) },
      { header: "Código Fonasa", value: (p) => p.fonasaCode ?? null },
      { header: "MAI", value: (p) => siNoPlanilla(p.isMai) },
      {
        header: "Rango mínimo",
        value: (p) => montoPlanilla(p.suggestedMinCents, currency),
        dinero: true,
      },
      {
        header: "Rango máximo",
        value: (p) => montoPlanilla(p.suggestedMaxCents, currency),
        dinero: true,
      },
      { header: "Activa", value: (p) => siNoPlanilla(p.isActive) },
    ],
  });

  // Agrupa por especialidad (ADM-02) para que el arancel se lea como la lista
  // de precios que es, y no como una tabla plana de 300 filas.
  const grupos = useMemo(
    () => agruparPorEspecialidad(filtradas, especialidades),
    [filtradas, especialidades],
  );

  const set = (patch: Partial<ArancelesSearch>) =>
    navigate({ search: (prev: ArancelesSearch) => ({ ...prev, ...patch }) });

  const especialidadInicial =
    search.especialidad && search.especialidad !== "sin" ? search.especialidad : undefined;
  const nuevaPrestacion = (
    <PrestacionDialog
      clinicId={clinicId!}
      currency={currency}
      categorias={categorias}
      especialidades={especialidades}
      especialidadInicial={especialidadInicial}
    />
  );
  const vigentes = procedures.filter((p) => p.isActive);

  return (
    <AppShell title="Arancel de precios" access={access}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {procedures.length} prestaciones · {procedures.filter((p) => !p.isActive).length} dadas
            de baja
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setHerramienta("catalogo")}>
              <BookOpen className="size-4" aria-hidden /> Catálogo
            </Button>
            <AccionDeshabilitada
              motivo={vigentes.length === 0 ? "Primero agrega prestaciones al arancel." : null}
              como="globo"
            >
              <Button variant="outline" size="sm" onClick={() => setHerramienta("realinear")}>
                <TrendingUp className="size-4" aria-hidden /> Realinear precios
              </Button>
            </AccionDeshabilitada>
            <ImportarCsvDialog clinicId={clinicId!} currency={currency} />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Más acciones del arancel">
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setHerramienta("especialidades")}>
                  <Layers className="size-4" aria-hidden /> Especialidades
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setHerramienta("historial")}>
                  <History className="size-4" aria-hidden /> Historial de precios
                </DropdownMenuItem>
                {procedures.length > 0 && exportarArancel.puede && (
                  <DropdownMenuItem
                    disabled={exportarArancel.enCurso || exportarArancel.vacia}
                    onSelect={() => void exportarArancel.exportar()}
                  >
                    <Download className="size-4" aria-hidden /> Exportar CSV
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {nuevaPrestacion}
          </div>
        </div>

        <FilterBar
          activos={[search.q, search.categoria, search.especialidad].filter(Boolean).length}
          onReset={() => set({ q: "", categoria: "", especialidad: "" })}
        >
          <SearchField
            label="Buscar"
            value={search.q}
            onChange={(q) => set({ q })}
            placeholder="Nombre, código o código Fonasa"
          />
          <SelectField
            label="Especialidad"
            value={search.especialidad}
            onChange={(especialidad) => set({ especialidad })}
            allLabel="Todas las especialidades"
            options={[
              ...[...especialidades]
                .filter((e) => conteoPorEspecialidad.has(e.id))
                .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "es"))
                .map((e) => ({ value: e.id, label: e.name })),
              { value: "sin", label: SIN_ESPECIALIDAD },
            ]}
          />
          <SelectField
            label="Categoría"
            value={search.categoria}
            onChange={(categoria) => set({ categoria })}
            allLabel="Todas las categorías"
            options={categorias.map((c) => ({ value: c, label: c }))}
          />
        </FilterBar>

        {isLoading && <p className="text-sm text-muted-foreground">Cargando arancel…</p>}

        {isError && <ErrorDeCarga onReintentar={refetch} mensaje="No pudimos cargar el arancel." />}

        {!isLoading && !isError && procedures.length === 0 && (
          <div className="card-clinical p-8 text-center">
            <p className="mb-1 font-display text-lg font-semibold">Tu arancel está vacío</p>
            <p className="mx-auto mb-4 max-w-md text-sm text-muted-foreground">
              Carga tu lista de precios una vez y después presupuestas eligiendo de aquí, sin
              escribir el nombre y el monto en cada presupuesto. Parte desde el catálogo de Esmalia
              o, si ya la tienes en una planilla, impórtala.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => setHerramienta("catalogo")}>
                <BookOpen className="size-4" aria-hidden /> Agregar desde el catálogo
              </Button>
              <ImportarCsvDialog clinicId={clinicId!} currency={currency} />
              {nuevaPrestacion}
            </div>
          </div>
        )}

        {!isLoading &&
          grupos.map(({ especialidad, titulo, items }) => (
            <section
              key={especialidad?.id ?? "sin"}
              aria-label={titulo}
              className="card-clinical overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 border-b border-hairline bg-secondary/40 px-4 py-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {titulo}
                  {especialidad && !especialidad.isActive && (
                    <span className="ml-2 font-normal normal-case tracking-normal">
                      (desactivada)
                    </span>
                  )}
                </h2>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="overflow-x-auto">
                {/* Anchos fijos: las columnas quedan alineadas entre grupos. */}
                <table className="w-full min-w-[72rem] table-fixed text-sm">
                  <colgroup>
                    <col />
                    <col className="w-24" />
                    <col className="w-44" />
                    <col className="w-24" />
                    <col className="w-24" />
                    <col className="w-20" />
                    <col className="w-16" />
                    <col className="w-72" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-hairline text-xs text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium">Prestación</th>
                      <th className="px-3 py-2 text-left font-medium">Código</th>
                      <th className="px-3 py-2 text-right font-medium">Precio</th>
                      <th className="px-3 py-2 text-right font-medium">V. ref.</th>
                      <th className="px-3 py-2 text-right font-medium">Lab.</th>
                      <th className="px-3 py-2 text-right font-medium">Duración</th>
                      <th className="px-3 py-2 text-center font-medium">Dscto</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                      <FilaPrestacion
                        key={p.id}
                        p={p}
                        clinicId={clinicId!}
                        currency={currency}
                        categorias={categorias}
                        especialidades={especialidades}
                        favorita={favoritos.has(p.id)}
                        favoritoPendiente={setFavorito.isPending}
                        onFavorito={() =>
                          setFavorito.mutate({ procedureId: p.id, favorito: !favoritos.has(p.id) })
                        }
                        activoPendiente={setActive.isPending}
                        onActivo={() =>
                          setActive.mutate({ procedureId: p.id, isActive: !p.isActive })
                        }
                        inventoryItems={inventoryItems}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

        {!isLoading && procedures.length > 0 && filtradas.length === 0 && (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">
            Ninguna prestación coincide con el filtro.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Precios en {currency}. Dar de baja no borra la prestación: los presupuestos y tratamientos
          que la usaron siguen mostrándola. Realinear precios tampoco cambia los presupuestos ya
          emitidos.
        </p>
      </div>

      {clinicId && (
        <>
          <CatalogoDialog
            clinicId={clinicId}
            currency={currency}
            procedures={procedures}
            open={herramienta === "catalogo"}
            onOpenChange={(v) => setHerramienta(v ? "catalogo" : null)}
          />
          <RealinearDialog
            clinicId={clinicId}
            currency={currency}
            procedures={vigentes}
            especialidades={especialidades}
            open={herramienta === "realinear"}
            onOpenChange={(v) => setHerramienta(v ? "realinear" : null)}
          />
          <EspecialidadesDialog
            clinicId={clinicId}
            especialidades={especialidades}
            conteo={conteoPorEspecialidad}
            open={herramienta === "especialidades"}
            onOpenChange={(v) => setHerramienta(v ? "especialidades" : null)}
          />
          <HistorialPreciosDialog
            clinicId={clinicId}
            zona={zona}
            open={herramienta === "historial"}
            onOpenChange={(v) => setHerramienta(v ? "historial" : null)}
          />
        </>
      )}
    </AppShell>
  );
}

/** Una fila del arancel. */
function FilaPrestacion({
  p,
  clinicId,
  currency,
  categorias,
  especialidades,
  favorita,
  favoritoPendiente,
  onFavorito,
  activoPendiente,
  onActivo,
  inventoryItems,
}: {
  p: Procedure;
  clinicId: string;
  currency: string;
  categorias: string[];
  especialidades: Especialidad[];
  favorita: boolean;
  favoritoPendiente: boolean;
  onFavorito: () => void;
  activoPendiente: boolean;
  onActivo: () => void;
  inventoryItems: InventoryItem[];
}) {
  const rango = posicionEnRango(p.defaultPriceCents, p.suggestedMinCents, p.suggestedMaxCents);
  return (
    <tr className={cn("border-b border-hairline last:border-0", !p.isActive && "opacity-50")}>
      <td className="px-4 py-2">
        <span className="inline-flex items-center gap-1.5">
          <button
            type="button"
            aria-pressed={favorita}
            aria-label={
              favorita ? `Quitar ${p.name} de favoritas` : `Marcar ${p.name} como favorita`
            }
            title="Favorita: aparece primero al agendar una cita"
            disabled={favoritoPendiente || !p.isActive}
            onClick={onFavorito}
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-secondary disabled:opacity-40 pointer-coarse:size-11",
              favorita ? "text-brand-700" : "text-muted-foreground",
            )}
          >
            <Star className={cn("size-3.5", favorita && "fill-current")} aria-hidden />
          </button>
          {p.name}
        </span>
        {!p.isActive && (
          <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
            De baja
          </span>
        )}
        {(p.category || p.fonasaCode || p.isMai) && (
          <span className="mt-0.5 flex flex-wrap gap-1.5 pl-7 text-[11px] text-muted-foreground">
            {p.category && <span>{p.category}</span>}
            {p.fonasaCode && <span className="cifra">Fonasa {p.fonasaCode}</span>}
            {p.isMai && <span className="rounded bg-secondary px-1">MAI</span>}
          </span>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground">{p.code ?? "—"}</td>
      <td className="px-3 py-2 text-right">
        <span className="cifra">{formatMoney(p.defaultPriceCents, p.currency)}</span>
        {rango !== "sin-rango" && (
          // Solo informa: el rango de referencia nunca se impone.
          <span
            className="block whitespace-nowrap text-[11px] text-muted-foreground"
            title="Rango de referencia: solo orienta, no se impone"
          >
            {rango === "debajo" ? "bajo " : rango === "encima" ? "sobre " : "ref. "}
            <span className="cifra">
              {p.suggestedMinCents != null ? formatMoney(p.suggestedMinCents, p.currency) : "…"}–
              {p.suggestedMaxCents != null ? formatMoney(p.suggestedMaxCents, p.currency) : "…"}
            </span>
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
        {p.referencePriceCents === null ? "—" : formatMoney(p.referencePriceCents, p.currency)}
      </td>
      <td className="px-3 py-2 text-right text-xs cifra text-muted-foreground">
        {p.labCostCents === null ? "—" : formatMoney(p.labCostCents, p.currency)}
      </td>
      <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
        {p.durationMin == null ? "—" : `${p.durationMin} min`}
      </td>
      <td className="px-3 py-2 text-center text-xs text-muted-foreground">
        {p.allowsDiscount ? "Sí" : "No"}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-1">
          <RecetaDialog clinicId={clinicId} procedure={p} items={inventoryItems} />
          <PrestacionDialog
            clinicId={clinicId}
            currency={currency}
            procedure={p}
            categorias={categorias}
            especialidades={especialidades}
          />
          <Button variant="ghost" size="sm" disabled={activoPendiente} onClick={onActivo}>
            {p.isActive ? "Dar de baja" : "Reactivar"}
          </Button>
        </div>
      </td>
    </tr>
  );
}
