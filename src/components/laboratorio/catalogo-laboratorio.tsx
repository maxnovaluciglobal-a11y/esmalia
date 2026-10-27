import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Chips, Destacado, PANEL, SinDatos, TITULO_PANEL } from "@/components/reportes/aplus";
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
import type { ClinicRole } from "@/lib/access/access";
import { listLabs } from "@/lib/clinic-operations/clinic-operations.functions";
import {
  listLabCatalog,
  saveLabCatalogItem,
  setLabCatalogItemActive,
} from "@/lib/clinic-operations/lab-catalog.functions";
import {
  MATERIALES,
  MATERIAL_LABELS,
  type ItemCatalogoLab,
  type Material,
} from "@/lib/clinic-operations/lab-orden-detalle";
import { ROLES_GESTIONAN_CATALOGO_LABORATORIO } from "@/lib/clinic-operations/lab-portal-roles";
import { formatMoney } from "@/lib/finance/finance";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function ItemDialog({
  clinicId,
  labId,
  labName,
  currency,
  item,
  abierto,
  onAbierto,
}: {
  clinicId: string;
  labId: string;
  labName: string;
  currency: string;
  item: ItemCatalogoLab | null;
  abierto: boolean;
  onAbierto: (v: boolean) => void;
}) {
  const fid = useId();
  const [name, setName] = useState("");
  const [cost, setCost] = useState<number | null>(null);
  const [dias, setDias] = useState("");
  const [material, setMaterial] = useState<Material | "">("");
  const queryClient = useQueryClient();
  const saveFn = useServerFn(saveLabCatalogItem);

  useEffect(() => {
    if (!abierto) return;
    setName(item?.name ?? "");
    setCost(item?.costCents ?? null);
    setDias(item?.typicalDays != null ? String(item.typicalDays) : "");
    setMaterial(item?.material ?? "");
  }, [abierto, item]);

  const diasNum = dias.trim() === "" ? null : Number(dias);
  const diasValidos = diasNum === null || (Number.isInteger(diasNum) && diasNum >= 0);

  const guardar = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          clinicId,
          labId,
          id: item?.id ?? null,
          name: name.trim(),
          costCents: cost,
          typicalDays: diasNum,
          material: material || null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-catalog", clinicId] });
      toast.success(item ? "Trabajo actualizado" : "Trabajo agregado al catálogo");
      onAbierto(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={abierto} onOpenChange={onAbierto}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? "Editar trabajo" : "Nuevo trabajo"}</DialogTitle>
          <DialogDescription>
            Catálogo de {labName}. Al elegirlo en una orden, se precargan el trabajo, el costo, el
            material y la fecha comprometida.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-nombre`}>Trabajo</Label>
            <input
              id={`${fid}-nombre`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Corona de zirconia monolítica"
              className={INPUT}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-costo`}>Precio de costo</Label>
              <MoneyInput
                id={`${fid}-costo`}
                currency={currency}
                min={0}
                valueCents={cost}
                onValueChange={setCost}
                placeholder="Opcional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-dias`}>Plazo típico (días)</Label>
              <input
                id={`${fid}-dias`}
                type="number"
                inputMode="numeric"
                min={0}
                max={365}
                value={dias}
                onChange={(e) => setDias(e.target.value)}
                placeholder="Ej: 7"
                className={cn(INPUT, "cifra")}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-material`}>Material habitual</Label>
            <select
              id={`${fid}-material`}
              value={material}
              onChange={(e) => setMaterial(e.target.value as Material | "")}
              className={INPUT}
            >
              <option value="">Sin especificar</option>
              {MATERIALES.map((m) => (
                <option key={m} value={m}>
                  {MATERIAL_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => guardar.mutate()}
            disabled={!name.trim() || !diasValidos || guardar.isPending}
          >
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {item ? "Guardar cambios" : "Agregar trabajo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ola 9 · LAB-07: catálogo de trabajos de cada laboratorio, con su precio
 * de costo y plazo típico. Lo ve todo el equipo (el precio, solo quien ve
 * finanzas: lo filtra el servidor); lo editan owner y admin.
 */
export function CatalogoLaboratorio({
  clinicId,
  currency,
  role,
}: {
  clinicId: string;
  currency: string;
  role: ClinicRole | null;
}) {
  const fetchLabs = useServerFn(listLabs);
  const fetchCatalog = useServerFn(listLabCatalog);
  const setActiveFn = useServerFn(setLabCatalogItemActive);
  const queryClient = useQueryClient();
  const puedeEditar = role !== null && ROLES_GESTIONAN_CATALOGO_LABORATORIO.includes(role);
  const [labElegido, setLabElegido] = useState("");
  const [editando, setEditando] = useState<ItemCatalogoLab | null>(null);
  const [dialogo, setDialogo] = useState(false);

  const { data: labs = [] } = useQuery({
    queryKey: ["labs", clinicId],
    queryFn: () => fetchLabs({ data: { clinicId } }),
  });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["lab-catalog", clinicId, "con-inactivos"],
    queryFn: () => fetchCatalog({ data: { clinicId, incluirInactivos: puedeEditar } }),
  });

  const desactivar = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => setActiveFn({ data: { clinicId, ...v } }),
    onSuccess: (_r, v) => {
      queryClient.invalidateQueries({ queryKey: ["lab-catalog", clinicId] });
      toast.success(v.isActive ? "Trabajo reactivado" : "Trabajo desactivado");
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  if (labs.length === 0) return null;
  const labId = labElegido || labs[0].id;
  const lab = labs.find((l) => l.id === labId) ?? labs[0];
  const visibles = items.filter((i) => i.labId === lab.id);

  return (
    <section aria-labelledby="lab-catalogo" className={cn(PANEL, "overflow-hidden")}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-[18px] pb-3">
        <h2 id="lab-catalogo" className={TITULO_PANEL}>
          Catálogo de <Destacado>trabajos</Destacado>
        </h2>
        {puedeEditar && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditando(null);
              setDialogo(true);
            }}
          >
            <Plus className="size-4" /> Agregar trabajo
          </Button>
        )}
      </div>
      {labs.length > 1 && (
        <div className="px-5 pb-3">
          <Chips<string>
            etiqueta="Laboratorio del catálogo"
            valor={lab.id}
            onCambiar={setLabElegido}
            opciones={labs.map((l) => ({
              valor: l.id,
              label: l.name,
              cuenta: items.filter((i) => i.labId === l.id && i.isActive).length,
            }))}
          />
        </div>
      )}
      {isLoading ? (
        <p className="border-t border-hairline px-5 py-4 text-sm text-muted-foreground">
          Cargando catálogo…
        </p>
      ) : visibles.length === 0 ? (
        <SinDatos
          className="border-t border-hairline"
          titulo={`${lab.name} todavía no tiene trabajos cargados`}
          detalle="Carga lo que te hace este laboratorio con su precio y su plazo: al elegirlo en una orden, se completa solo."
        />
      ) : (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {visibles.map((i) => (
            <li
              key={i.id}
              className={cn(
                "grid gap-x-4 gap-y-1.5 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
                !i.isActive && "opacity-60",
              )}
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {i.name}
                  {!i.isActive && (
                    <span className="ml-2 text-xs font-semibold text-muted-foreground">
                      Desactivado
                    </span>
                  )}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {i.material ? MATERIAL_LABELS[i.material] : "Material sin especificar"}
                  {" · "}
                  {i.typicalDays === null ? (
                    "sin plazo típico"
                  ) : (
                    <>
                      <span className="cifra">{i.typicalDays}</span>{" "}
                      {i.typicalDays === 1 ? "día" : "días"}
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="cifra text-sm text-muted-foreground">
                  {i.costCents === null ? "—" : formatMoney(i.costCents, i.currency)}
                </span>
                {puedeEditar && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Editar ${i.name}`}
                      onClick={() => {
                        setEditando(i);
                        setDialogo(true);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      disabled={desactivar.isPending}
                      onClick={() => desactivar.mutate({ id: i.id, isActive: !i.isActive })}
                    >
                      {i.isActive ? "Desactivar" : "Reactivar"}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {puedeEditar && (
        <ItemDialog
          clinicId={clinicId}
          labId={lab.id}
          labName={lab.name}
          currency={currency}
          item={editando}
          abierto={dialogo}
          onAbierto={setDialogo}
        />
      )}
    </section>
  );
}
