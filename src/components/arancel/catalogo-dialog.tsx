import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { importarDelCatalogo } from "@/lib/arancel/arancel.functions";
import { CATALOGO_CHILE, type ItemCatalogo } from "@/lib/arancel/catalogo-chile";
import { NOMBRE_ESPECIALIDAD, SLUGS_ESPECIALIDAD } from "@/lib/arancel/especialidades";
import { formatMoney, type Procedure } from "@/lib/finance/finance";
import { mensajeDeError } from "@/lib/mensaje-error";
import { coincide } from "@/lib/search";

function normalizar(s: string) {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Catálogo chileno propio (ADM-03): la clínica elige prestaciones y las copia
 * a su arancel con un clic. Las que ya tiene (por clave del catálogo o por
 * nombre) aparecen marcadas y no se pueden volver a importar.
 */
export function CatalogoDialog({
  clinicId,
  currency,
  procedures,
  open,
  onOpenChange,
}: {
  clinicId: string;
  currency: string;
  procedures: Procedure[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [usarPiso, setUsarPiso] = useState(false);
  const queryClient = useQueryClient();
  const importarFn = useServerFn(importarDelCatalogo);
  const enClp = currency.toUpperCase() === "CLP";

  const yaEsta = useMemo(() => {
    const claves = new Set(procedures.map((p) => p.catalogKey).filter(Boolean) as string[]);
    const nombres = new Set(procedures.map((p) => normalizar(p.name)));
    return (i: ItemCatalogo) => claves.has(i.key) || nombres.has(normalizar(i.name));
  }, [procedures]);

  const grupos = useMemo(() => {
    const visibles = CATALOGO_CHILE.filter((i) => !q || coincide(q, i.name));
    return SLUGS_ESPECIALIDAD.map((slug) => ({
      slug,
      items: visibles.filter((i) => i.specialty === slug),
    })).filter((g) => g.items.length);
  }, [q]);

  const importar = useMutation({
    mutationFn: () =>
      importarFn({
        data: {
          clinicId,
          claves: [...elegidas],
          precioInicial: usarPiso && enClp ? "piso" : "cero",
        },
      }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["procedures", clinicId] });
      toast.success(
        r.creadas === 1
          ? "1 prestación agregada al arancel"
          : `${r.creadas} prestaciones agregadas al arancel`,
        r.saltadas.length
          ? { description: `${r.saltadas.length} ya estaban en tu arancel y no se duplicaron.` }
          : undefined,
      );
      setElegidas(new Set());
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  function alternarGrupo(items: ItemCatalogo[]) {
    const disponibles = items.filter((i) => !yaEsta(i)).map((i) => i.key);
    setElegidas((prev) => {
      const next = new Set(prev);
      const todas = disponibles.every((k) => next.has(k));
      for (const k of disponibles) {
        if (todas) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  const motivo = elegidas.size === 0 ? "Elige al menos una prestación." : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Agregar desde el catálogo de Esmalia</DialogTitle>
          <DialogDescription>
            Prestaciones frecuentes en Chile, con nombres redactados por Esmalia. Se copian a tu
            arancel y desde ahí las editas como cualquier otra: el catálogo no impone precios.
          </DialogDescription>
        </DialogHeader>

        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar en el catálogo"
          aria-label="Buscar en el catálogo"
          className="w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {grupos.map(({ slug, items }) => (
            <section key={slug} aria-labelledby={`cat-${slug}`}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h3
                  id={`cat-${slug}`}
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {NOMBRE_ESPECIALIDAD[slug]}
                </h3>
                <button
                  type="button"
                  onClick={() => alternarGrupo(items)}
                  className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline"
                >
                  Elegir todas
                </button>
              </div>
              <ul className="divide-y divide-hairline rounded-lg border border-hairline">
                {items.map((i) => {
                  const esta = yaEsta(i);
                  return (
                    <li key={i.key}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm has-[:disabled]:cursor-default">
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 rounded border-hairline"
                          disabled={esta}
                          checked={esta || elegidas.has(i.key)}
                          onChange={(e) =>
                            setElegidas((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(i.key);
                              else next.delete(i.key);
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className={esta ? "text-muted-foreground" : undefined}>
                            {i.name}
                          </span>
                          {esta && (
                            <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              Ya está en tu arancel
                            </span>
                          )}
                        </span>
                        {enClp && i.rangoClp && (
                          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline cifra">
                            {formatMoney(i.rangoClp[0], "CLP")}–{formatMoney(i.rangoClp[1], "CLP")}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {grupos.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nada del catálogo coincide con la búsqueda.
            </p>
          )}
        </div>

        <div className="space-y-2 border-t border-hairline pt-3 text-xs text-muted-foreground">
          {enClp ? (
            <>
              <p>
                El rango (mín–máx) es una referencia orientativa y amplia: queda visible junto a tu
                precio y puedes editarlo o borrarlo. El código Fonasa y la marca MAI los completas
                tú, con el arancel vigente de Fonasa.
              </p>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4 rounded border-hairline"
                  checked={usarPiso}
                  onChange={(e) => setUsarPiso(e.target.checked)}
                />
                Usar el mínimo del rango como precio inicial (si no, entran sin precio)
              </label>
            </>
          ) : (
            <p>
              Tu clínica cobra en {currency}: las prestaciones entran sin precio ni rango, para que
              pongas los tuyos.
            </p>
          )}
        </div>

        <DialogFooter>
          <AccionDeshabilitada motivo={motivo}>
            <Button onClick={() => importar.mutate()} disabled={importar.isPending}>
              {importar.isPending && <Loader2 className="size-3.5 animate-spin" />}
              {elegidas.size
                ? `Agregar ${elegidas.size} ${elegidas.size === 1 ? "prestación" : "prestaciones"}`
                : "Agregar al arancel"}
            </Button>
          </AccionDeshabilitada>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
