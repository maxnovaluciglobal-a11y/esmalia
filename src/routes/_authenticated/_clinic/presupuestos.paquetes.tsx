import { useId, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { AppShell } from "@/components/app-shell";
import { ErrorDeCarga } from "@/components/estado-error";
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
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { hasPermission, type ClinicRole } from "@/lib/access/access";
import { requireAnyPermission } from "@/lib/access/route-guards";
import { precioDeListaDelPaquete } from "@/lib/finance/calculo-presupuesto";
import { formatMoney, type Procedure } from "@/lib/finance/finance";
import { listProcedures } from "@/lib/finance/finance.functions";
import {
  guardarPaquete,
  listPaquetes,
  setPaqueteActivo,
  type Paquete,
} from "@/lib/finance/paquetes.functions";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";
import { EncabezadoEditorial, PANEL_LISTA } from "@/components/a-plus/lista";

/**
 * Paquetes de prestaciones (PLA-12): combos del arancel con un precio
 * cerrado ("Blanqueamiento completo", "Rehabilitación con 3 coronas"). Se
 * suman al presupuesto de una vez desde el editor de la ficha.
 */
export const Route = createFileRoute("/_authenticated/_clinic/presupuestos/paquetes")({
  beforeLoad: requireAnyPermission("finance:view", "patients:manage"),
  head: () => ({
    meta: [{ title: "Paquetes | Esmalia" }, { name: "robots", content: "noindex" }],
  }),
  component: PaquetesPage,
});

/** Los mismos roles que editan el arancel y la RLS de `procedure_packages`. */
const ROLES_QUE_EDITAN: readonly ClinicRole[] = ["owner", "admin", "dentist"];

const CAMPO =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function PaquetesPage() {
  const { access } = Route.useRouteContext();
  const clinicId = access.clinic!.id;
  const moneda = access.clinic!.currency;
  const puedeEditar = Boolean(access.role && ROLES_QUE_EDITAN.includes(access.role));
  const puedeVerLista = hasPermission(access.role, "finance:view");
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<Paquete | "nuevo" | null>(null);

  const fetchPaquetes = useServerFn(listPaquetes);
  const {
    data: paquetes = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["paquetes", clinicId, "todos"],
    queryFn: () => fetchPaquetes({ data: { clinicId, incluirInactivos: true } }),
  });
  const fetchProcedures = useServerFn(listProcedures);
  const { data: procedures = [] } = useQuery({
    queryKey: ["procedures", clinicId],
    queryFn: () => fetchProcedures({ data: { clinicId } }),
  });
  const precioDe = useMemo(() => {
    const mapa = new Map(procedures.map((p) => [p.id, p.defaultPriceCents]));
    return (id: string | null) => (id ? (mapa.get(id) ?? 0) : 0);
  }, [procedures]);

  const activoFn = useServerFn(setPaqueteActivo);
  const activo = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => activoFn({ data: { clinicId, ...v } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["paquetes", clinicId] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <AppShell title="Paquetes" access={access}>
      <div className="mx-auto max-w-[84rem] space-y-6 text-base">
        <EncabezadoEditorial
          contexto={[
            puedeVerLista ? (
              <Link
                key="volver"
                to="/presupuestos"
                className="inline-flex items-center gap-1.5 hover:underline"
              >
                <ArrowLeft className="size-4" aria-hidden /> Presupuestos
              </Link>
            ) : (
              "Presupuestos"
            ),
            !isLoading &&
              paquetes.length > 0 &&
              `${paquetes.filter((p) => p.isActive).length} activos`,
          ]}
          titulo="Paquetes"
          enfasis="de prestaciones"
          acciones={
            puedeEditar && (
              <BloqueoEscritura>
                <Button
                  className="h-10 rounded-full px-4 text-[14.5px] pointer-coarse:h-11"
                  onClick={() => setEditando("nuevo")}
                >
                  <Plus className="size-4" aria-hidden /> Nuevo paquete
                </Button>
              </BloqueoEscritura>
            )
          }
        >
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Combos de prestaciones del arancel con un precio cerrado. En el presupuesto se suman de
            una vez, cada prestación con su parte del precio y el ahorro como descuento.
          </p>
        </EncabezadoEditorial>

        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando paquetes…
          </p>
        ) : isError ? (
          <ErrorDeCarga
            onReintentar={refetch}
            reintentando={isFetching}
            mensaje="No pudimos cargar los paquetes."
          />
        ) : paquetes.length === 0 ? (
          <div className={cn(PANEL_LISTA, "px-5 py-10 text-center text-sm text-muted-foreground")}>
            Todavía no hay paquetes.
            {puedeEditar && " Crea el primero con las prestaciones que más se cotizan juntas."}
          </div>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {paquetes.map((p) => {
              const lista = precioDeListaDelPaquete(p.items, precioDe);
              const ahorro = lista - p.priceCents;
              return (
                <li
                  key={p.id}
                  className={cn(PANEL_LISTA, "space-y-3 p-4 sm:p-5", !p.isActive && "opacity-70")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="flex items-center gap-2 font-display text-[24px] leading-tight font-medium">
                        <Package className="size-4 shrink-0 text-brand" aria-hidden />
                        <span className="truncate">{p.name}</span>
                      </h2>
                      {p.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
                      )}
                      {!p.isActive && (
                        <p className="mt-0.5 text-xs text-muted-foreground">Inactivo</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-display text-[26px] leading-none font-medium [font-variant-numeric:lining-nums]">
                        {formatMoney(p.priceCents, p.currency)}
                      </p>
                      {ahorro > 0 && (
                        <p className="cifra text-xs text-success">
                          Ahorro {formatMoney(ahorro, p.currency)}
                        </p>
                      )}
                    </div>
                  </div>
                  <ul className="space-y-1 border-t border-hairline pt-3 text-sm">
                    {p.items.map((it) => (
                      <li key={it.id} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">
                          {it.quantity > 1 && <span className="cifra">{it.quantity} × </span>}
                          {it.nameSnapshot}
                        </span>
                        <span className="cifra text-xs text-muted-foreground">
                          {it.procedureId
                            ? formatMoney(precioDe(it.procedureId) * it.quantity, p.currency)
                            : "Sin arancel"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {puedeEditar && (
                    <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
                      <BloqueoEscritura>
                        <Button size="sm" variant="outline" onClick={() => setEditando(p)}>
                          <Pencil className="size-3.5" /> Editar
                        </Button>
                      </BloqueoEscritura>
                      <BloqueoEscritura>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={activo.isPending}
                          onClick={() => activo.mutate({ id: p.id, isActive: !p.isActive })}
                        >
                          {p.isActive ? "Desactivar" : "Activar"}
                        </Button>
                      </BloqueoEscritura>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editando && (
        <EditorPaquete
          clinicId={clinicId}
          moneda={moneda}
          procedures={procedures.filter((p) => p.isActive)}
          paquete={editando === "nuevo" ? null : editando}
          onClose={() => setEditando(null)}
        />
      )}
    </AppShell>
  );
}

type LineaBorrador = { procedureId: string; quantity: number };

function EditorPaquete({
  clinicId,
  moneda,
  procedures,
  paquete,
  onClose,
}: {
  clinicId: string;
  moneda: string;
  procedures: Procedure[];
  paquete: Paquete | null;
  onClose: () => void;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState(paquete?.name ?? "");
  const [descripcion, setDescripcion] = useState(paquete?.description ?? "");
  const [precio, setPrecio] = useState<number | null>(paquete?.priceCents ?? null);
  const [lineas, setLineas] = useState<LineaBorrador[]>(
    paquete?.items
      .filter((it) => it.procedureId)
      .map((it) => ({ procedureId: it.procedureId!, quantity: it.quantity })) ?? [
      { procedureId: "", quantity: 1 },
    ],
  );
  const porId = useMemo(() => new Map(procedures.map((p) => [p.id, p])), [procedures]);
  const lista = lineas.reduce(
    (s, l) => s + (porId.get(l.procedureId)?.defaultPriceCents ?? 0) * l.quantity,
    0,
  );

  const guardarFn = useServerFn(guardarPaquete);
  const guardar = useMutation({
    mutationFn: () =>
      guardarFn({
        data: {
          clinicId,
          id: paquete?.id,
          name: nombre.trim(),
          description: descripcion.trim() || undefined,
          priceCents: precio ?? 0,
          items: lineas
            .filter((l) => porId.has(l.procedureId))
            .map((l) => ({
              procedureId: l.procedureId,
              nameSnapshot: porId.get(l.procedureId)!.name,
              quantity: l.quantity,
            })),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["paquetes", clinicId] });
      toast.success(paquete ? "Paquete actualizado" : "Paquete creado");
      onClose();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const validas = lineas.filter((l) => porId.has(l.procedureId));
  const motivo = !nombre.trim()
    ? "Ponle un nombre al paquete."
    : validas.length === 0
      ? "Elige al menos una prestación del arancel."
      : precio === null
        ? "Pon el precio del paquete."
        : null;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{paquete ? "Editar paquete" : "Nuevo paquete"}</DialogTitle>
          <DialogDescription>
            Los presupuestos que ya lo usan no cambian: al sumarlo se copian sus líneas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-nombre`}>Nombre</Label>
            <input
              id={`${fid}-nombre`}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={120}
              className={CAMPO}
              placeholder="Ej: Blanqueamiento completo"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-desc`}>Descripción (opcional)</Label>
            <input
              id={`${fid}-desc`}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              maxLength={500}
              className={CAMPO}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Prestaciones</legend>
            {lineas.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={l.procedureId}
                  onChange={(e) =>
                    setLineas((arr) =>
                      arr.map((x, j) => (j === i ? { ...x, procedureId: e.target.value } : x)),
                    )
                  }
                  aria-label={`Prestación ${i + 1}`}
                  className={cn(CAMPO, "min-w-0 flex-1")}
                >
                  <option value="">Elegir del arancel</option>
                  {procedures.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {formatMoney(p.defaultPriceCents, p.currency)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={l.quantity}
                  onChange={(e) =>
                    setLineas((arr) =>
                      arr.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              quantity: Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                            }
                          : x,
                      ),
                    )
                  }
                  aria-label={`Cantidad de la prestación ${i + 1}`}
                  className={cn(CAMPO, "w-16")}
                />
                <button
                  type="button"
                  onClick={() => setLineas((arr) => arr.filter((_, j) => j !== i))}
                  disabled={lineas.length === 1}
                  aria-label={`Quitar prestación ${i + 1}`}
                  className="rounded-md p-2 text-muted-foreground hover:bg-secondary disabled:opacity-30"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLineas((arr) => [...arr, { procedureId: "", quantity: 1 }])}
              className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
            >
              <Plus className="size-3.5" /> Agregar prestación
            </button>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-sm font-medium">Precio de lista</p>
              <p className="cifra text-sm text-muted-foreground">{formatMoney(lista, moneda)}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-precio`}>Precio del paquete</Label>
              <MoneyInput
                id={`${fid}-precio`}
                currency={moneda}
                min={0}
                valueCents={precio}
                onValueChange={setPrecio}
                className={CAMPO}
              />
              {precio !== null && lista > 0 && precio < lista && (
                <p className="cifra text-xs text-success">
                  Ahorro {formatMoney(lista - precio, moneda)}
                </p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <AccionDeshabilitada motivo={motivo}>
            <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
              {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Guardar paquete
            </Button>
          </AccionDeshabilitada>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
