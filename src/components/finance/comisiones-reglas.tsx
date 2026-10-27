/**
 * Reglas de comisión con "rige desde" (Ola 10 · COM-02 y COM-03), solo
 * owner/admin. Cada profesional muestra su regla vigente y el historial; una
 * regla nueva rige desde la fecha que se elija y nunca reescribe lo ya
 * liquidado (lo exige también la base). Va en /comisiones, debajo de la
 * tabla por profesional, con el mismo lenguaje A+.
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { History, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Destacado, PANEL, Pastilla, TITULO_PANEL } from "@/components/reportes/aplus";
import { ErrorDeCarga } from "@/components/estado-error";
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
import { listProfessionals } from "@/lib/clinic-operations/clinic-catalog.functions";
import {
  createCommissionRuleVersion,
  deleteCommissionRuleVersion,
  listCommissionRuleVersions,
  type VersionReglaVista,
} from "@/lib/finance/commissions.functions";
import { diaSiguiente, versionGeneralVigente } from "@/lib/finance/comisiones-vigencia";
import { listProcedures } from "@/lib/finance/finance.functions";
import { fecha } from "@/lib/formato-fecha";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

const INPUT =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function ChipOpcion({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-semibold pointer-coarse:h-11",
        activo
          ? "border-foreground bg-foreground text-background"
          : "border-control bg-card hover:border-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ReglasDeComisionPanel({ clinicId }: { clinicId: string }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const fetchReglas = useServerFn(listCommissionRuleVersions);
  const fetchPros = useServerFn(listProfessionals);
  const reglas = useQuery({
    queryKey: ["commission-rule-versions", clinicId],
    queryFn: () => fetchReglas({ data: { clinicId } }),
  });
  const pros = useQuery({
    queryKey: ["professionals", clinicId],
    queryFn: () => fetchPros({ data: { clinicId } }),
  });
  const [editando, setEditando] = useState<string | null>(null);
  const [historial, setHistorial] = useState<string | null>(null);

  const borrarFn = useServerFn(deleteCommissionRuleVersion);
  const borrar = useMutation({
    mutationFn: (id: string) => borrarFn({ data: { clinicId, id } }),
    onSuccess: () => {
      toast.success("Regla borrada.");
      queryClient.invalidateQueries({ queryKey: ["commission-rule-versions", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["commission-report"] });
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const datos = reglas.data;
  const hoy = datos?.hoy ?? "";
  return (
    <section aria-labelledby={`${uid}-titulo`} className={cn(PANEL, "overflow-hidden")}>
      <div className="px-5 pt-[18px] pb-3">
        <h2 id={`${uid}-titulo`} className={TITULO_PANEL}>
          Reglas y <Destacado>vigencia</Destacado>
        </h2>
        <p className="mt-2 max-w-[70ch] text-sm text-muted-foreground">
          Cada regla rige desde una fecha. Cambiarla no toca lo anterior: los días previos se siguen
          calculando con la regla de antes y lo liquidado queda congelado.
        </p>
      </div>
      {reglas.isError || pros.isError ? (
        <div className="px-5 pb-5">
          <ErrorDeCarga
            mensaje="No pudimos cargar las reglas de comisión."
            onReintentar={() => void reglas.refetch()}
          />
        </div>
      ) : !datos || !pros.data ? (
        <p className="border-t border-hairline px-5 py-6 text-sm text-muted-foreground">
          Cargando las reglas…
        </p>
      ) : (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {pros.data.map((p) => {
            const propias = datos.versiones.filter((v) => v.professionalId === p.id);
            const vigente = versionGeneralVigente(propias, p.id, hoy);
            const futura = propias.find((v) => v.scope === "general" && v.effectiveFrom > hoy);
            const porPrestacion = propias.filter((v) => v.scope === "prestacion");
            const ultimo = datos.ultimoLiquidado[p.id] ?? null;
            const vista = vigente ? propias.find((v) => v.id === vigente.id) : undefined;
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="font-medium">{p.nombre}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {vista ? vista.regla : "Sin regla configurada"}
                    {vigente &&
                    !vigente.id.startsWith("regla-") &&
                    vigente.effectiveFrom > "2000-01-01"
                      ? ` · rige desde el ${fecha(vigente.effectiveFrom)}`
                      : ""}
                  </p>
                  {futura && (
                    <p className="mt-0.5 text-sm text-foreground/80">
                      Desde el {fecha(futura.effectiveFrom)}: {futura.regla}
                    </p>
                  )}
                  {porPrestacion.length > 0 && (
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                      {porPrestacion.length === 1
                        ? "1 regla por prestación"
                        : `${porPrestacion.length} reglas por prestación`}
                    </p>
                  )}
                  {ultimo && (
                    <p className="mt-1">
                      <Pastilla tono="neutral" icono={Lock}>
                        Liquidado hasta el {fecha(ultimo)}
                      </Pastilla>
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {propias.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full"
                      onClick={() => setHistorial(p.id)}
                    >
                      <History aria-hidden /> Historial
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setEditando(p.id)}
                  >
                    <Plus aria-hidden /> Cambiar regla
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editando && datos && (
        <NuevaReglaDialog
          clinicId={clinicId}
          professionalId={editando}
          nombre={pros.data?.find((p) => p.id === editando)?.nombre ?? ""}
          currency={datos.currency}
          hoy={hoy}
          ultimoLiquidado={datos.ultimoLiquidado[editando] ?? null}
          baseActual={versionGeneralVigente(datos.versiones, editando, hoy)?.base ?? "realizado"}
          onCerrar={() => setEditando(null)}
        />
      )}

      <Dialog open={!!historial} onOpenChange={(o) => !o && setHistorial(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Historial de reglas</DialogTitle>
            <DialogDescription>
              {pros.data?.find((p) => p.id === historial)?.nombre}. La más nueva arriba; las que ya
              se usaron en un período liquidado no se pueden borrar.
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-hairline border-y border-hairline text-sm">
            {(datos?.versiones ?? [])
              .filter((v) => v.professionalId === historial)
              .map((v: VersionReglaVista) => (
                <li key={v.id} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {v.scope === "prestacion" ? `${v.procedureName ?? "Prestación"}: ` : ""}
                      {v.regla}
                    </span>
                    <span className="block text-[12.5px] text-muted-foreground">
                      {v.effectiveFrom <= "2000-01-01"
                        ? "Regla inicial"
                        : `Rige desde el ${fecha(v.effectiveFrom)}`}
                    </span>
                  </span>
                  {!v.bloqueada && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full"
                      disabled={borrar.isPending}
                      onClick={() => borrar.mutate(v.id)}
                      aria-label={`Borrar la regla que rige desde el ${fecha(v.effectiveFrom)}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function NuevaReglaDialog({
  clinicId,
  professionalId,
  nombre,
  currency,
  hoy,
  ultimoLiquidado,
  baseActual,
  onCerrar,
}: {
  clinicId: string;
  professionalId: string;
  nombre: string;
  currency: string;
  hoy: string;
  ultimoLiquidado: string | null;
  baseActual: "realizado" | "cobrado";
  onCerrar: () => void;
}) {
  const fid = useId();
  const queryClient = useQueryClient();
  const minimo = ultimoLiquidado ? diaSiguiente(ultimoLiquidado) : undefined;
  const [scope, setScope] = useState<"general" | "prestacion">("general");
  const [procedureId, setProcedureId] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed" | "none">("percent");
  const [porcentaje, setPorcentaje] = useState("");
  const [fijo, setFijo] = useState<number | null>(null);
  const [base, setBase] = useState<"realizado" | "cobrado">(baseActual);
  const [desde, setDesde] = useState(minimo && minimo > hoy ? minimo : hoy);
  const [nota, setNota] = useState("");

  const fetchProc = useServerFn(listProcedures);
  const procs = useQuery({
    queryKey: ["procedures", clinicId, false],
    queryFn: () => fetchProc({ data: { clinicId, incluirInactivas: false } }),
    enabled: scope === "prestacion",
  });

  const crear = useServerFn(createCommissionRuleVersion);
  const pct = Number(porcentaje.replace(",", "."));
  const bps = Number.isFinite(pct) ? Math.round(pct * 100) : NaN;
  const mutation = useMutation({
    mutationFn: () =>
      crear({
        data: {
          clinicId,
          professionalId,
          scope,
          procedureId: scope === "prestacion" ? procedureId : null,
          kind,
          percentBps: kind === "percent" ? bps : 0,
          fixedCents: kind === "fixed" ? (fijo ?? 0) : 0,
          base,
          effectiveFrom: desde,
          note: nota.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Regla guardada.");
      queryClient.invalidateQueries({ queryKey: ["commission-rule-versions", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["commission-report"] });
      queryClient.invalidateQueries({ queryKey: ["commission-rules", clinicId] });
      queryClient.invalidateQueries({ queryKey: ["mi-desempeno"] });
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const fechaInvalida = Boolean(minimo && desde < minimo);
  const listo =
    !fechaInvalida &&
    /^\d{4}-\d{2}-\d{2}$/.test(desde) &&
    (scope === "general" || Boolean(procedureId)) &&
    (kind !== "percent" || (bps >= 0 && bps <= 10000 && porcentaje.trim() !== "")) &&
    (kind !== "fixed" || fijo !== null);

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar regla de comisión</DialogTitle>
          <DialogDescription>
            {nombre}. La regla nueva vale desde la fecha que elijas; lo anterior no cambia.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Aplica a</legend>
            <div className="flex flex-wrap gap-1.5">
              <ChipOpcion activo={scope === "general"} onClick={() => setScope("general")}>
                Todas las prestaciones
              </ChipOpcion>
              <ChipOpcion activo={scope === "prestacion"} onClick={() => setScope("prestacion")}>
                Una prestación
              </ChipOpcion>
            </div>
          </fieldset>
          {scope === "prestacion" && (
            <div className="space-y-2">
              <Label htmlFor={`${fid}-proc`}>Prestación</Label>
              <select
                id={`${fid}-proc`}
                className={INPUT}
                value={procedureId}
                onChange={(e) => setProcedureId(e.target.value)}
              >
                <option value="">Elige una prestación del arancel</option>
                {(procs.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Reemplaza a la regla general solo para esta prestación.
              </p>
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Tipo</legend>
            <div className="flex flex-wrap gap-1.5">
              <ChipOpcion activo={kind === "percent"} onClick={() => setKind("percent")}>
                Porcentaje
              </ChipOpcion>
              <ChipOpcion activo={kind === "fixed"} onClick={() => setKind("fixed")}>
                Monto fijo por prestación
              </ChipOpcion>
              <ChipOpcion activo={kind === "none"} onClick={() => setKind("none")}>
                Sin comisión
              </ChipOpcion>
            </div>
          </fieldset>
          {kind === "percent" && (
            <div className="space-y-2">
              <Label htmlFor={`${fid}-pct`}>Porcentaje (%)</Label>
              <input
                id={`${fid}-pct`}
                className={INPUT}
                inputMode="decimal"
                value={porcentaje}
                placeholder="40"
                onChange={(e) => setPorcentaje(e.target.value)}
              />
            </div>
          )}
          {kind === "fixed" && (
            <div className="space-y-2">
              <Label htmlFor={`${fid}-fijo`}>Monto por prestación realizada</Label>
              <MoneyInput
                id={`${fid}-fijo`}
                valueCents={fijo}
                onValueChange={setFijo}
                currency={currency}
              />
            </div>
          )}
          {scope === "general" && kind === "percent" && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Se calcula sobre</legend>
              <div className="flex flex-wrap gap-1.5">
                <ChipOpcion activo={base === "realizado"} onClick={() => setBase("realizado")}>
                  Lo realizado
                </ChipOpcion>
                <ChipOpcion activo={base === "cobrado"} onClick={() => setBase("cobrado")}>
                  Lo cobrado
                </ChipOpcion>
              </div>
              <p className="text-xs text-muted-foreground">
                {base === "realizado"
                  ? "Precio de las prestaciones completadas en el período."
                  : "Pagos del período imputados a sus prestaciones (un abono al plan se reparte entre los profesionales del plan)."}
              </p>
            </fieldset>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${fid}-desde`}>Rige desde</Label>
            <input
              id={`${fid}-desde`}
              type="date"
              className={INPUT}
              value={desde}
              min={minimo}
              onChange={(e) => setDesde(e.target.value)}
            />
            {ultimoLiquidado && (
              <p
                className={cn(
                  "text-xs",
                  fechaInvalida ? "text-destructive" : "text-muted-foreground",
                )}
              >
                Liquidado hasta el {fecha(ultimoLiquidado)}: la regla nueva rige desde el{" "}
                {fecha(minimo!)} o después.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${fid}-nota`}>Nota (opcional)</Label>
            <input
              id={`${fid}-nota`}
              className={INPUT}
              maxLength={300}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!listo || mutation.isPending}>
            {mutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Guardar regla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
