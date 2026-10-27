import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PatientCombobox } from "@/components/patient-combobox";
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
import { wallTimeInTzToUtc } from "@/lib/clinic-operations/appointments.functions";
import {
  ETIQUETA_INDICADOR,
  ETIQUETA_INDICADOR_BIOLOGICO,
  ETIQUETA_TIPO,
  INDICADORES,
  TIPOS_CICLO,
  VIDA_UTIL_OPCIONES,
  VIDA_UTIL_POR_DEFECTO,
  esPruebaDeEquipo,
  fechaDeVencimiento,
  normalizarCodigo,
  numeroDeCiclo,
  resultadoSegunIndicadores,
  type Indicador,
  type TipoCiclo,
} from "@/lib/esterilizacion/esterilizacion";
import {
  actualizarCiclo,
  citasParaUsoDePaquete,
  darDeBajaPaquete,
  etiquetarPaquetes,
  registrarCiclo,
  usarPaquete,
  type Ciclo,
  type Paquete,
} from "@/lib/esterilizacion/esterilizacion.functions";
import { matrizQr, pathSvgQr } from "@/lib/reserva/qr";
import { fecha, fechaCortaHora } from "@/lib/formato-fecha";
import { listPatients } from "@/lib/patients/patients.functions";
import { mensajeDeError } from "@/lib/mensaje-error";
import { cn } from "@/lib/utils";

/**
 * Diálogos de la pantalla de esterilización (MKT-10): registrar un ciclo,
 * leer sus indicadores, etiquetar paquetes (con QR imprimible), usar un
 * paquete en un paciente y darlo de baja. La base repite cada regla.
 */

export const INPUT =
  "w-full rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:text-base";

function useInvalidar(clinicId: string) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["esterilizacion", clinicId] });
}

/** "AAAA-MM-DDTHH:mm" de ahora en la zona de la clínica (para el input). */
function ahoraLocal(zona: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour") === "24" ? "00" : v("hour")}:${v("minute")}`;
}

const numero = (t: string) => {
  const v = t.trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function DialogoRegistrarCiclo({
  clinicId,
  zona,
  responsable,
  equipoSugerido,
  abierto,
  onCambio,
}: {
  clinicId: string;
  zona: string;
  responsable: string;
  equipoSugerido: string;
  abierto: boolean;
  onCambio: (v: boolean) => void;
}) {
  const fid = useId();
  const invalidar = useInvalidar(clinicId);
  const registrarFn = useServerFn(registrarCiclo);
  const [equipo, setEquipo] = useState(equipoSugerido);
  const [serie, setSerie] = useState("");
  const [cuando, setCuando] = useState(() => ahoraLocal(zona));
  const [tipo, setTipo] = useState<TipoCiclo>("envuelto");
  const [temp, setTemp] = useState("134");
  const [presion, setPresion] = useState("2,1");
  const [tiempo, setTiempo] = useState("5");
  const [quimico, setQuimico] = useState<Indicador>("aprobado");
  const [claseQuimico, setClaseQuimico] = useState("");
  const [biologico, setBiologico] = useState<Indicador>("no_aplica");
  const [loteBio, setLoteBio] = useState("");
  const [motivo, setMotivo] = useState("");
  const [quien, setQuien] = useState(responsable);
  const [notas, setNotas] = useState("");
  const resultado = resultadoSegunIndicadores(quimico, biologico);

  const guardar = useMutation({
    mutationFn: () =>
      registrarFn({
        data: {
          clinicId,
          equipment: equipo,
          equipmentSerial: serie || undefined,
          runAt: wallTimeInTzToUtc(cuando, zona).toISOString(),
          cycleType: tipo,
          temperatureC: numero(temp),
          pressureBar: numero(presion),
          exposureMinutes: numero(tiempo),
          chemicalIndicator: quimico,
          chemicalIndicatorClass: claseQuimico || undefined,
          biologicalIndicator: biologico,
          biologicalLot: loteBio || undefined,
          result: resultado,
          failureReason: motivo || undefined,
          responsibleName: quien,
          notes: notas || undefined,
        },
      }),
    onSuccess: (r) => {
      invalidar();
      toast.success(
        r.result === "fallido"
          ? `Ciclo ${numeroDeCiclo(r)} registrado como fallido`
          : `Ciclo ${numeroDeCiclo(r)} registrado`,
      );
      onCambio(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  const listo =
    equipo.trim().length >= 2 && quien.trim().length >= 2 && cuando && !guardar.isPending;

  return (
    <Dialog open={abierto} onOpenChange={onCambio}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar ciclo de autoclave</DialogTitle>
          <DialogDescription>
            Lo que pide el registro sanitario: equipo, parámetros, indicadores y quién responde.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-equipo`}>Equipo</Label>
              <input
                id={`${fid}-equipo`}
                value={equipo}
                onChange={(e) => setEquipo(e.target.value)}
                placeholder="Ej: Autoclave clase B"
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-serie`}>N.º de serie</Label>
              <input
                id={`${fid}-serie`}
                value={serie}
                onChange={(e) => setSerie(e.target.value)}
                placeholder="Opcional"
                className={INPUT}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-cuando`}>Fecha y hora</Label>
              <input
                id={`${fid}-cuando`}
                type="datetime-local"
                value={cuando}
                onChange={(e) => setCuando(e.target.value)}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-tipo`}>Tipo de ciclo</Label>
              <select
                id={`${fid}-tipo`}
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoCiclo)}
                className={INPUT}
              >
                {TIPOS_CICLO.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_TIPO[t]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset className="grid grid-cols-3 gap-3">
            <legend className="sr-only">Parámetros</legend>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-temp`}>Temperatura (°C)</Label>
              <input
                id={`${fid}-temp`}
                inputMode="decimal"
                value={temp}
                onChange={(e) => setTemp(e.target.value)}
                className={cn(INPUT, "cifra")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-presion`}>Presión (bar)</Label>
              <input
                id={`${fid}-presion`}
                inputMode="decimal"
                value={presion}
                onChange={(e) => setPresion(e.target.value)}
                className={cn(INPUT, "cifra")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-tiempo`}>Exposición (min)</Label>
              <input
                id={`${fid}-tiempo`}
                inputMode="decimal"
                value={tiempo}
                onChange={(e) => setTiempo(e.target.value)}
                className={cn(INPUT, "cifra")}
              />
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-quimico`}>Indicador químico</Label>
              <select
                id={`${fid}-quimico`}
                value={quimico}
                onChange={(e) => setQuimico(e.target.value as Indicador)}
                className={INPUT}
              >
                {INDICADORES.map((i) => (
                  <option key={i} value={i}>
                    {ETIQUETA_INDICADOR[i]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-clase`}>Clase del indicador</Label>
              <input
                id={`${fid}-clase`}
                value={claseQuimico}
                onChange={(e) => setClaseQuimico(e.target.value)}
                placeholder="Ej: clase 5"
                className={INPUT}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-bio`}>Indicador biológico</Label>
              <select
                id={`${fid}-bio`}
                value={biologico}
                onChange={(e) => setBiologico(e.target.value as Indicador)}
                className={INPUT}
              >
                {INDICADORES.map((i) => (
                  <option key={i} value={i}>
                    {ETIQUETA_INDICADOR_BIOLOGICO[i]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-lotebio`}>Lote del biológico</Label>
              <input
                id={`${fid}-lotebio`}
                value={loteBio}
                onChange={(e) => setLoteBio(e.target.value)}
                placeholder="Opcional"
                className={INPUT}
              />
            </div>
          </div>
          {resultado === "fallido" && (
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-motivo`}>Qué pasó</Label>
              <input
                id={`${fid}-motivo`}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: el indicador no viró"
                className={INPUT}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-quien`}>Responsable</Label>
              <input
                id={`${fid}-quien`}
                value={quien}
                onChange={(e) => setQuien(e.target.value)}
                className={INPUT}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-notas`}>Notas</Label>
              <input
                id={`${fid}-notas`}
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Opcional"
                className={INPUT}
              />
            </div>
          </div>
          <p className="rounded-[10px] border border-hairline bg-secondary px-3 py-2 text-[13px]">
            Resultado:{" "}
            <b className="font-semibold">
              {resultado === "aprobado"
                ? "aprobado"
                : resultado === "fallido"
                  ? "fallido"
                  : "pendiente"}
            </b>
            {resultado === "pendiente" && " (falta leer el indicador químico)."}
            {resultado === "aprobado" &&
              biologico === "pendiente" &&
              " (el biológico se lee después; si sale positivo, el ciclo pasa a fallido)."}
            {esPruebaDeEquipo(tipo) && " Una prueba del equipo no lleva paquetes."}
          </p>
        </div>
        <DialogFooter>
          <Button onClick={() => guardar.mutate()} disabled={!listo}>
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Registrar ciclo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lectura posterior del indicador biológico (y del químico si quedó pendiente). */
export function DialogoLecturaCiclo({
  clinicId,
  ciclo,
  onCerrar,
}: {
  clinicId: string;
  ciclo: Ciclo;
  onCerrar: () => void;
}) {
  const fid = useId();
  const invalidar = useInvalidar(clinicId);
  const actualizarFn = useServerFn(actualizarCiclo);
  const [quimico, setQuimico] = useState<Indicador>(ciclo.chemicalIndicator);
  const [biologico, setBiologico] = useState<Indicador>(ciclo.biologicalIndicator);
  const [motivo, setMotivo] = useState("");
  const cerrado = ciclo.result !== "pendiente";
  const resultado = resultadoSegunIndicadores(quimico, biologico);
  const bioLeido =
    ciclo.biologicalIndicator === "aprobado" || ciclo.biologicalIndicator === "fallido";

  const guardar = useMutation({
    mutationFn: () =>
      actualizarFn({
        data: {
          clinicId,
          cycleId: ciclo.id,
          chemicalIndicator: cerrado ? undefined : quimico,
          biologicalIndicator: bioLeido ? undefined : biologico,
          result: cerrado && resultado !== "fallido" ? undefined : resultado,
          failureReason: motivo || undefined,
        },
      }),
    onSuccess: (r) => {
      invalidar();
      toast.success(
        r.result === "fallido"
          ? "Ciclo fallido: sus paquetes disponibles quedaron retirados"
          : "Lectura registrada",
      );
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Lectura del ciclo {numeroDeCiclo(ciclo)}</DialogTitle>
          <DialogDescription>
            Si un indicador falla, el ciclo queda fallido y sus paquetes disponibles se retiran.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!cerrado && (
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-q`}>Indicador químico</Label>
              <select
                id={`${fid}-q`}
                value={quimico}
                onChange={(e) => setQuimico(e.target.value as Indicador)}
                className={INPUT}
              >
                {INDICADORES.map((i) => (
                  <option key={i} value={i}>
                    {ETIQUETA_INDICADOR[i]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-b`}>Indicador biológico</Label>
            <select
              id={`${fid}-b`}
              value={biologico}
              disabled={bioLeido}
              onChange={(e) => setBiologico(e.target.value as Indicador)}
              className={INPUT}
            >
              {INDICADORES.map((i) => (
                <option key={i} value={i}>
                  {ETIQUETA_INDICADOR_BIOLOGICO[i]}
                </option>
              ))}
            </select>
            {bioLeido && (
              <p className="text-xs text-muted-foreground">La lectura ya quedó registrada.</p>
            )}
          </div>
          {resultado === "fallido" && (
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-m`}>Qué pasó</Label>
              <input
                id={`${fid}-m`}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: indicador biológico positivo"
                className={INPUT}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
            {guardar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Guardar lectura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Etiquetas imprimibles con QR (el código del paquete, que se escanea al usarlo). */
export function imprimirEtiquetas(
  paquetes: readonly Paquete[],
  ciclos: ReadonlyMap<string, Ciclo>,
  clinica: string,
  zona: string,
) {
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const etiquetas = paquetes
    .map((p) => {
      const { d, lado } = pathSvgQr(matrizQr(p.code), 2);
      const c = ciclos.get(p.cycleId);
      return `<div class="e"><svg viewBox="0 0 ${lado} ${lado}" width="88" height="88" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg><div><b>${esc(p.code)}</b><br>${esc(p.contents)}<br>Ciclo ${c ? esc(numeroDeCiclo(c)) : ""} · ${c ? esc(fechaCortaHora(c.runAt, zona)) : ""}<br><b>Vence ${esc(fecha(p.expiresOn))}</b><br><small>${esc(clinica)}</small></div></div>`;
    })
    .join("");
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) {
    toast.error(
      "El navegador bloqueó la ventana de impresión: permite ventanas emergentes para este sitio.",
    );
    return;
  }
  w.document.write(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas de esterilización</title><style>body{font:12px/1.35 system-ui,sans-serif;margin:8mm;color:#000}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:4mm}.e{display:flex;gap:3mm;align-items:center;border:1px dashed #999;padding:3mm;break-inside:avoid}</style></head><body><div class="g">${etiquetas}</div><script>window.onload=function(){window.print()}</script></body></html>`,
  );
  w.document.close();
}

export function DialogoEtiquetar({
  clinicId,
  ciclo,
  zona,
  onCerrar,
  onCreados,
}: {
  clinicId: string;
  ciclo: Ciclo;
  zona: string;
  onCerrar: () => void;
  onCreados: (codigos: string[]) => void;
}) {
  const fid = useId();
  const invalidar = useInvalidar(clinicId);
  const etiquetarFn = useServerFn(etiquetarPaquetes);
  const [contenido, setContenido] = useState("");
  const [vida, setVida] = useState(VIDA_UTIL_POR_DEFECTO);
  const [cantidad, setCantidad] = useState("1");
  const vence = fechaDeVencimiento(ciclo.runAt, vida, zona);
  const n = Number(cantidad);

  const crear = useMutation({
    mutationFn: () =>
      etiquetarFn({
        data: {
          clinicId,
          cycleId: ciclo.id,
          contents: contenido,
          shelfLifeDays: vida,
          cantidad: n,
        },
      }),
    onSuccess: (creados) => {
      invalidar();
      toast.success(
        `${creados.length} ${creados.length === 1 ? "paquete etiquetado" : "paquetes etiquetados"}`,
      );
      onCreados(creados.map((c) => c.code));
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Etiquetar paquetes del ciclo {numeroDeCiclo(ciclo)}</DialogTitle>
          <DialogDescription>
            Cada paquete recibe un código propio con QR para imprimir y pegar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-c`}>Contenido</Label>
            <input
              id={`${fid}-c`}
              value={contenido}
              onChange={(e) => setContenido(e.target.value)}
              placeholder="Ej: Kit de examen (espejo, sonda, pinza)"
              className={INPUT}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-v`}>Vida útil del estéril</Label>
              <select
                id={`${fid}-v`}
                value={vida}
                onChange={(e) => setVida(Number(e.target.value))}
                className={INPUT}
              >
                {VIDA_UTIL_OPCIONES.map((d) => (
                  <option key={d} value={d}>
                    {d} días
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-n`}>Cantidad</Label>
              <input
                id={`${fid}-n`}
                type="number"
                min={1}
                max={50}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                className={cn(INPUT, "cifra")}
              />
            </div>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Vence el <b className="cifra font-semibold text-foreground">{fecha(vence)}</b>: día del
            ciclo más la vida útil.
          </p>
        </div>
        <DialogFooter>
          <Button
            onClick={() => crear.mutate()}
            disabled={contenido.trim().length < 2 || !(n >= 1 && n <= 50) || crear.isPending}
          >
            {crear.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Etiquetar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DialogoUsarPaquete({
  clinicId,
  codigoInicial,
  abierto,
  onCambio,
}: {
  clinicId: string;
  codigoInicial?: string;
  abierto: boolean;
  onCambio: (v: boolean) => void;
}) {
  const fid = useId();
  const invalidar = useInvalidar(clinicId);
  const usarFn = useServerFn(usarPaquete);
  const fetchPacientes = useServerFn(listPatients);
  const fetchCitas = useServerFn(citasParaUsoDePaquete);
  const [codigo, setCodigo] = useState(codigoInicial ?? "");
  const [pacienteId, setPacienteId] = useState("");
  const [citaId, setCitaId] = useState("");
  const { data: pacientesRes } = useQuery({
    queryKey: ["patients", clinicId],
    enabled: abierto,
    queryFn: () => fetchPacientes({ data: { clinicId } }),
  });
  const { data: citas = [] } = useQuery({
    queryKey: ["esterilizacion", clinicId, "citas", pacienteId],
    enabled: abierto && Boolean(pacienteId),
    queryFn: () => fetchCitas({ data: { clinicId, patientId: pacienteId } }),
  });

  const usar = useMutation({
    mutationFn: () =>
      usarFn({ data: { clinicId, codigo, patientId: pacienteId, appointmentId: citaId || null } }),
    onSuccess: (r) => {
      invalidar();
      toast.success(`Paquete ${r.code} anotado en el paciente`);
      setCodigo("");
      setPacienteId("");
      setCitaId("");
      onCambio(false);
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });

  return (
    <Dialog open={abierto} onOpenChange={onCambio}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Usar paquete en un paciente</DialogTitle>
          <DialogDescription>
            Escanea el QR de la etiqueta (o escribe el código) al abrir el paquete.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-codigo`}>Código del paquete</Label>
            <input
              id={`${fid}-codigo`}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onBlur={() => codigo && setCodigo(normalizarCodigo(codigo))}
              placeholder="E2026-00001"
              autoComplete="off"
              className={cn(INPUT, "cifra uppercase")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-paciente`}>Paciente</Label>
            <PatientCombobox
              id={`${fid}-paciente`}
              value={pacienteId}
              onChange={(v) => {
                setPacienteId(v);
                setCitaId("");
              }}
              pacientes={(pacientesRes?.items ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))}
            />
          </div>
          {pacienteId && (
            <div className="space-y-1.5">
              <Label htmlFor={`${fid}-cita`}>Cita</Label>
              <select
                id={`${fid}-cita`}
                value={citaId}
                onChange={(e) => setCitaId(e.target.value)}
                className={INPUT}
              >
                <option value="">{citas.length ? "Sin cita" : "Sin citas cerca de hoy"}</option>
                {citas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {fechaCortaHora(c.startsAt)} · {c.tratamiento}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => usar.mutate()}
            disabled={codigo.trim().length < 3 || !pacienteId || usar.isPending}
          >
            {usar.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Anotar uso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DialogoBajaPaquete({
  clinicId,
  paquete,
  onCerrar,
}: {
  clinicId: string;
  paquete: Paquete;
  onCerrar: () => void;
}) {
  const fid = useId();
  const invalidar = useInvalidar(clinicId);
  const bajaFn = useServerFn(darDeBajaPaquete);
  const [estado, setEstado] = useState<"descartado" | "retirado">("descartado");
  const [motivo, setMotivo] = useState("");
  const baja = useMutation({
    mutationFn: () => bajaFn({ data: { clinicId, packageId: paquete.id, estado, motivo } }),
    onSuccess: () => {
      invalidar();
      toast.success(`Paquete ${paquete.code} dado de baja`);
      onCerrar();
    },
    onError: (e: Error) => toast.error(mensajeDeError(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Dar de baja el paquete {paquete.code}</DialogTitle>
          <DialogDescription>Queda en el registro con el motivo; no se borra.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-e`}>Tipo de baja</Label>
            <select
              id={`${fid}-e`}
              value={estado}
              onChange={(e) => setEstado(e.target.value as "descartado" | "retirado")}
              className={INPUT}
            >
              <option value="descartado">Descartado (envoltorio dañado, mojado, vencido)</option>
              <option value="retirado">Retirado (se reprocesa)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fid}-m`}>Motivo</Label>
            <input
              id={`${fid}-m`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: envoltorio roto"
              className={INPUT}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={() => baja.mutate()}
            disabled={motivo.trim().length < 3 || baja.isPending}
          >
            {baja.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Dar de baja
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
