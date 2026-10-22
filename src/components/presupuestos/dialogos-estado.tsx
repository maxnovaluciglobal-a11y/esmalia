import { useId, useMemo, useState } from "react";
import { CalendarPlus, CheckCheck, Loader2, MessageSquarePlus, X } from "lucide-react";

import { AccionDeshabilitada } from "@/components/accion-deshabilitada";
import { SignaturePad } from "@/components/signature-pad";
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
import { SIN_FASE_LABEL, formatMoney, groupByPhase, type QuoteItem } from "@/lib/finance/finance";
import { cn } from "@/lib/utils";

const CAMPO =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Aceptación parcial (PLA-02): el paciente dice que sí a una parte del plan.
 * Se eligen las prestaciones (o secciones enteras) que acepta; el plan de
 * tratamiento se crea solo con esas y el presupuesto queda "Aceptado parcial".
 */
export function AceptarParcialDialog({
  items,
  currency,
  pending,
  onConfirm,
}: {
  items: QuoteItem[];
  currency: string;
  pending: boolean;
  onConfirm: (v: { itemIds: string[]; nombre?: string; firma?: string }) => void;
}) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [nombre, setNombre] = useState("");
  const [firma, setFirma] = useState<string | null>(null);
  const secciones = useMemo(() => groupByPhase(items, (it) => it.totalCents), [items]);
  const totalElegido = items
    .filter((it) => elegidas.has(it.id))
    .reduce((s, it) => s + it.totalCents, 0);

  const alternar = (ids: string[], marcar: boolean) =>
    setElegidas((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (marcar) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const motivo =
    elegidas.size === 0
      ? "Marca al menos una prestación."
      : elegidas.size === items.length
        ? "Marcaste todas: usa Aceptar para una aceptación total."
        : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setElegidas(new Set());
          setNombre("");
          setFirma(null);
        }
      }}
    >
      <AccionDeshabilitada
        motivo={items.length < 2 && "Con una sola prestación no hay aceptación parcial."}
        como="globo"
      >
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={pending}>
            <CheckCheck className="size-3.5" /> Aceptar parcial
          </Button>
        </DialogTrigger>
      </AccionDeshabilitada>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aceptación parcial</DialogTitle>
          <DialogDescription>
            Marca lo que el paciente acepta. El plan de tratamiento se crea solo con eso; lo demás
            queda en el presupuesto como no aceptado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {secciones.map((s) => {
            const ids = s.items.map((it) => it.id);
            const todas = ids.every((id) => elegidas.has(id));
            const alguna = ids.some((id) => elegidas.has(id));
            return (
              <fieldset key={s.label ?? "sin-fase"} className="rounded-lg border border-hairline">
                <legend className="sr-only">{s.label ?? SIN_FASE_LABEL}</legend>
                <label className="flex cursor-pointer items-center gap-2 bg-secondary/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={todas}
                    ref={(el) => {
                      if (el) el.indeterminate = alguna && !todas;
                    }}
                    onChange={(e) => alternar(ids, e.target.checked)}
                    className="size-4 accent-brand-700"
                  />
                  <span className="flex-1">{s.label ?? SIN_FASE_LABEL}</span>
                  <span className="cifra normal-case tracking-normal">
                    {formatMoney(s.subtotalCents, currency)}
                  </span>
                </label>
                <ul className="divide-y divide-hairline">
                  {s.items.map((it) => (
                    <li key={it.id}>
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={elegidas.has(it.id)}
                          onChange={(e) => alternar([it.id], e.target.checked)}
                          className="size-4 accent-brand-700"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {it.nameSnapshot}
                          {it.toothNumber ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              · pieza {it.toothNumber}
                            </span>
                          ) : null}
                        </span>
                        <span className="cifra text-xs">
                          {formatMoney(it.totalCents, currency)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-hairline pt-3 text-sm">
          <span className="text-muted-foreground">
            {elegidas.size} de {items.length} prestaciones
          </span>
          <span className="cifra font-semibold">{formatMoney(totalElegido, currency)}</span>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-nombre`}>Nombre de quien aprueba (opcional)</Label>
            <input
              id={`${fid}-nombre`}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className={CAMPO}
              placeholder="Nombre del paciente o responsable"
            />
          </div>
          <SignaturePad label="Firma del paciente (opcional)" onChange={setFirma} />
        </div>
        <DialogFooter>
          <AccionDeshabilitada motivo={motivo}>
            <Button
              onClick={() => {
                onConfirm({
                  itemIds: [...elegidas],
                  nombre: nombre.trim() || undefined,
                  firma: firma ?? undefined,
                });
                setOpen(false);
              }}
              disabled={pending}
            >
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Confirmar aceptación parcial
            </Button>
          </AccionDeshabilitada>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rechazo con motivo opcional: queda en el historial y en la vista global. */
export function RechazarDialog({
  pending,
  onConfirm,
}: {
  pending: boolean;
  onConfirm: (motivo: string | undefined) => void;
}) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setMotivo("");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" disabled={pending}>
          <X className="size-3.5" /> Rechazar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rechazar presupuesto</DialogTitle>
          <DialogDescription>
            Queda marcado como rechazado y no se puede volver a abrir. Para retomarlo, crea un
            presupuesto nuevo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-motivo`}>Motivo (opcional)</Label>
          <textarea
            id={`${fid}-motivo`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            maxLength={500}
            className={CAMPO}
            placeholder="Ej: prefiere esperar al próximo año, le pareció caro"
          />
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm(motivo.trim() || undefined);
              setOpen(false);
            }}
            disabled={pending}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Rechazar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Renovar un vencido (PLA-06): vuelve a "Emitido" con una validez nueva. */
export function RenovarDialog({
  hoy,
  sugerida,
  pending,
  onConfirm,
}: {
  hoy: string;
  /** Validez propuesta: hoy + los días por defecto de la clínica. */
  sugerida: string;
  pending: boolean;
  onConfirm: (validUntil: string) => void;
}) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [dia, setDia] = useState(sugerida);
  const motivo = !dia
    ? "Elige la nueva fecha."
    : dia < hoy
      ? "La fecha no puede ser anterior a hoy."
      : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setDia(sugerida);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={pending}>
          <CalendarPlus className="size-3.5" /> Renovar validez
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Renovar presupuesto</DialogTitle>
          <DialogDescription>
            Vuelve a quedar emitido con la nueva fecha. Revisa antes que los precios sigan vigentes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`${fid}-dia`}>Válido hasta</Label>
          <input
            id={`${fid}-dia`}
            type="date"
            min={hoy}
            value={dia}
            onChange={(e) => setDia(e.target.value)}
            className={CAMPO}
          />
        </div>
        <DialogFooter>
          <AccionDeshabilitada motivo={motivo}>
            <Button
              onClick={() => {
                onConfirm(dia);
                setOpen(false);
              }}
              disabled={pending}
            >
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Renovar
            </Button>
          </AccionDeshabilitada>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ValoresSeguimiento {
  contactado: boolean;
  nota?: string;
  proximaAccion: string | null;
  proximaAccionOn: string | null;
  professionalId: string | null;
}

/**
 * Seguimiento del presupuesto (UX-16): registrar un contacto, la próxima
 * acción con su fecha y el profesional a cargo.
 */
export function SeguimientoDialog({
  inicial,
  profesionales,
  pending,
  onConfirm,
  trigger = "boton",
}: {
  inicial: {
    proximaAccion: string | null;
    proximaAccionOn: string | null;
    professionalId: string | null;
  };
  profesionales: { id: string; nombre: string }[];
  pending: boolean;
  onConfirm: (v: ValoresSeguimiento) => void;
  trigger?: "boton" | "icono";
}) {
  const fid = useId();
  const [open, setOpen] = useState(false);
  const [contactado, setContactado] = useState(true);
  const [nota, setNota] = useState("");
  const [accion, setAccion] = useState(inicial.proximaAccion ?? "");
  const [dia, setDia] = useState(inicial.proximaAccionOn ?? "");
  const [profesional, setProfesional] = useState(inicial.professionalId ?? "");

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setContactado(true);
          setNota("");
          setAccion(inicial.proximaAccion ?? "");
          setDia(inicial.proximaAccionOn ?? "");
          setProfesional(inicial.professionalId ?? "");
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger === "icono" ? (
          <Button size="sm" variant="ghost" aria-label="Registrar seguimiento" disabled={pending}>
            <MessageSquarePlus className="size-4" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={pending}>
            <MessageSquarePlus className="size-3.5" /> Seguimiento
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Seguimiento</DialogTitle>
          <DialogDescription>
            Anota el contacto con el paciente y lo que sigue. Queda en el historial del presupuesto.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={contactado}
              onChange={(e) => setContactado(e.target.checked)}
              className="size-4 accent-brand-700"
            />
            Hablé con el paciente ahora
          </label>
          <div className={cn("space-y-1.5", !contactado && "opacity-50")}>
            <Label htmlFor={`${fid}-nota`}>Qué se habló (opcional)</Label>
            <textarea
              id={`${fid}-nota`}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              disabled={!contactado}
              rows={2}
              maxLength={500}
              className={CAMPO}
              placeholder="Ej: lo va a conversar con su familia"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-accion`}>Próxima acción</Label>
              <input
                id={`${fid}-accion`}
                value={accion}
                onChange={(e) => setAccion(e.target.value)}
                maxLength={200}
                className={CAMPO}
                placeholder="Ej: llamar para confirmar"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-dia`}>Para el</Label>
              <input
                id={`${fid}-dia`}
                type="date"
                value={dia}
                onChange={(e) => setDia(e.target.value)}
                className={CAMPO}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-prof`}>Profesional a cargo</Label>
            <select
              id={`${fid}-prof`}
              value={profesional}
              onChange={(e) => setProfesional(e.target.value)}
              className={CAMPO}
            >
              <option value="">Sin asignar</option>
              {profesionales.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onConfirm({
                contactado,
                nota: contactado ? nota.trim() || undefined : undefined,
                proximaAccion: accion.trim() || null,
                proximaAccionOn: dia || null,
                professionalId: profesional || null,
              });
              setOpen(false);
            }}
            disabled={pending}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
